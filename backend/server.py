from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import secrets
import string
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-change-me')
JWT_ALGO = 'HS256'
TOKEN_DAYS = 30

app = FastAPI(title="Twogether API")
api_router = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


# ----------------------------- Helpers -----------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8')[:72], bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode('utf-8')[:72], hashed.encode('utf-8'))
    except Exception:
        return False


def make_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def gen_code(n: int = 6) -> str:
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no ambiguous chars
    return "".join(secrets.choice(alphabet) for _ in range(n))


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def public_user(u: dict) -> dict:
    return {
        "id": u["id"],
        "email": u["email"],
        "display_name": u.get("display_name"),
        "public_key": u.get("public_key"),
        "pair_id": u.get("pair_id"),
        "partner_id": u.get("partner_id"),
    }


# ----------------------------- Models -----------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=200)
    display_name: str = Field(min_length=1, max_length=60)
    public_key: str = Field(min_length=1, max_length=500)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PublicKeyIn(BaseModel):
    public_key: str = Field(min_length=1, max_length=500)


class RedeemIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)


class MessageIn(BaseModel):
    nonce: str
    ciphertext: str
    kind: str = "text"  # text | image | video
    media_url: Optional[str] = None
    view_once: bool = False
    allow_save: bool = True


class WorryIn(BaseModel):
    nonce: str
    ciphertext: str


class EventIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    note: Optional[str] = Field(default=None, max_length=500)
    date: str  # ISO date string
    shared: bool = True
    color: Optional[str] = None


# ----------------------------- Auth -----------------------------
@api_router.get("/")
async def root():
    return {"message": "Twogether API", "status": "ok"}


@api_router.post("/auth/register")
async def register(body: RegisterIn):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(body.password),
        "display_name": body.display_name,
        "public_key": body.public_key,
        "pair_id": None,
        "partner_id": None,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    return {"access_token": make_token(user["id"]), "user": public_user(user)}


@api_router.post("/auth/login")
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {"access_token": make_token(user["id"]), "user": public_user(user)}


@api_router.get("/me")
async def me(user=Depends(get_current_user)):
    return {"user": public_user(user)}


@api_router.put("/me/public-key")
async def update_public_key(body: PublicKeyIn, user=Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"public_key": body.public_key}})
    user["public_key"] = body.public_key
    return {"user": public_user(user)}


# ----------------------------- Pairing -----------------------------
@api_router.post("/pair/create")
async def pair_create(user=Depends(get_current_user)):
    if user.get("pair_id"):
        pair = await db.pairs.find_one({"id": user["pair_id"]}, {"_id": 0})
        if pair and pair.get("status") == "active":
            raise HTTPException(status_code=400, detail="You are already paired")
        if pair and pair.get("status") == "pending":
            return {"code": pair["code"], "pair_id": pair["id"], "status": "pending"}
    # generate unique code
    code = gen_code()
    while await db.pairs.find_one({"code": code, "status": "pending"}):
        code = gen_code()
    pair = {
        "id": str(uuid.uuid4()),
        "code": code,
        "user_a": user["id"],
        "user_b": None,
        "status": "pending",
        "created_at": now_iso(),
    }
    await db.pairs.insert_one(pair)
    await db.users.update_one({"id": user["id"]}, {"$set": {"pair_id": pair["id"]}})
    return {"code": code, "pair_id": pair["id"], "status": "pending"}


@api_router.post("/pair/redeem")
async def pair_redeem(body: RedeemIn, user=Depends(get_current_user)):
    if user.get("pair_id"):
        existing = await db.pairs.find_one({"id": user["pair_id"]})
        if existing and existing.get("status") == "active":
            raise HTTPException(status_code=400, detail="You are already paired")
    code = body.code.strip().upper()
    pair = await db.pairs.find_one({"code": code, "status": "pending"})
    if not pair:
        raise HTTPException(status_code=404, detail="Invalid or expired invite code")
    if pair["user_a"] == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot pair with yourself")
    # activate
    await db.pairs.update_one(
        {"id": pair["id"]},
        {"$set": {"user_b": user["id"], "status": "active", "activated_at": now_iso()}},
    )
    # clean up any old pending pair the redeeming user created
    if user.get("pair_id") and user["pair_id"] != pair["id"]:
        await db.pairs.delete_one({"id": user["pair_id"], "status": "pending"})
    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"pair_id": pair["id"], "partner_id": pair["user_a"]}}
    )
    await db.users.update_one(
        {"id": pair["user_a"]}, {"$set": {"pair_id": pair["id"], "partner_id": user["id"]}}
    )
    return {"pair_id": pair["id"], "status": "active"}


@api_router.get("/pair")
async def pair_get(user=Depends(get_current_user)):
    if not user.get("pair_id"):
        return {"status": "none", "partner": None}
    pair = await db.pairs.find_one({"id": user["pair_id"]}, {"_id": 0})
    if not pair:
        return {"status": "none", "partner": None}
    partner = None
    if pair.get("status") == "active":
        partner_id = pair["user_b"] if pair["user_a"] == user["id"] else pair["user_a"]
        p = await db.users.find_one({"id": partner_id}, {"_id": 0})
        if p:
            partner = {
                "id": p["id"],
                "display_name": p.get("display_name"),
                "public_key": p.get("public_key"),
            }
    return {"status": pair.get("status"), "code": pair.get("code"), "pair_id": pair["id"], "partner": partner}


@api_router.delete("/pair")
async def pair_unpair(user=Depends(get_current_user)):
    if not user.get("pair_id"):
        return {"status": "none"}
    pair = await db.pairs.find_one({"id": user["pair_id"]})
    if pair:
        for uid in [pair.get("user_a"), pair.get("user_b")]:
            if uid:
                await db.users.update_one({"id": uid}, {"$set": {"pair_id": None, "partner_id": None}})
        await db.pairs.update_one({"id": pair["id"]}, {"$set": {"status": "ended", "ended_at": now_iso()}})
    return {"status": "ended"}


# ----------------------------- Messages -----------------------------
async def require_active_pair(user: dict) -> dict:
    if not user.get("pair_id"):
        raise HTTPException(status_code=400, detail="Not paired")
    pair = await db.pairs.find_one({"id": user["pair_id"]})
    if not pair or pair.get("status") != "active":
        raise HTTPException(status_code=400, detail="Not paired")
    return pair


@api_router.get("/messages")
async def get_messages(after: Optional[str] = None, user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    query = {"pair_id": pair["id"]}
    if after:
        query["created_at"] = {"$gt": after}
    msgs = await db.messages.find(query, {"_id": 0}).sort("created_at", 1).to_list(500)
    return {"messages": msgs}


@api_router.post("/messages")
async def send_message(body: MessageIn, user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    msg = {
        "id": str(uuid.uuid4()),
        "pair_id": pair["id"],
        "sender_id": user["id"],
        "nonce": body.nonce,
        "ciphertext": body.ciphertext,
        "kind": body.kind,
        "media_url": body.media_url,
        "view_once": body.view_once,
        "allow_save": body.allow_save,
        "viewed": False,
        "created_at": now_iso(),
    }
    await db.messages.insert_one(msg)
    msg.pop("_id", None)
    return {"message": msg}


@api_router.post("/messages/{message_id}/viewed")
async def mark_viewed(message_id: str, user=Depends(get_current_user)):
    await require_active_pair(user)
    await db.messages.update_one({"id": message_id}, {"$set": {"viewed": True}})
    return {"ok": True}


# ----------------------------- Worries -----------------------------
@api_router.get("/worries")
async def get_worries(user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    items = await db.worries.find({"pair_id": pair["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"worries": items}


@api_router.post("/worries")
async def add_worry(body: WorryIn, user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    worry = {
        "id": str(uuid.uuid4()),
        "pair_id": pair["id"],
        "author_id": user["id"],
        "nonce": body.nonce,
        "ciphertext": body.ciphertext,
        "resolved": False,
        "created_at": now_iso(),
    }
    await db.worries.insert_one(worry)
    worry.pop("_id", None)
    return {"worry": worry}


@api_router.patch("/worries/{worry_id}")
async def resolve_worry(worry_id: str, user=Depends(get_current_user)):
    await require_active_pair(user)
    await db.worries.update_one({"id": worry_id}, {"$set": {"resolved": True}})
    item = await db.worries.find_one({"id": worry_id}, {"_id": 0})
    return {"worry": item}


# ----------------------------- Calendar -----------------------------
@api_router.get("/events")
async def get_events(user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    items = await db.events.find({"pair_id": pair["id"]}, {"_id": 0}).sort("date", 1).to_list(500)
    return {"events": items}


@api_router.post("/events")
async def add_event(body: EventIn, user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    event = {
        "id": str(uuid.uuid4()),
        "pair_id": pair["id"],
        "author_id": user["id"],
        "title": body.title,
        "note": body.note,
        "date": body.date,
        "shared": body.shared,
        "color": body.color,
        "created_at": now_iso(),
    }
    await db.events.insert_one(event)
    event.pop("_id", None)
    return {"event": event}


@api_router.delete("/events/{event_id}")
async def delete_event(event_id: str, user=Depends(get_current_user)):
    await require_active_pair(user)
    await db.events.delete_one({"id": event_id})
    return {"ok": True}


# ----------------------------- App wiring -----------------------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.pairs.create_index("code")
    await db.messages.create_index([("pair_id", 1), ("created_at", 1)])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
