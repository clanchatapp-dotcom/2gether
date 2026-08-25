from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, WebSocket, WebSocketDisconnect, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import secrets
import string
import base64
import requests
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
from livekit import api as lk_api

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-change-me')
JWT_ALGO = 'HS256'
TOKEN_DAYS = 30

LIVEKIT_URL = os.environ.get("LIVEKIT_URL")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET")

# ----------------------------- Object Storage (Emergent managed) -----------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "twogether"
_storage_key = None


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> bytes:
    global _storage_key
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content


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


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = decode_token(creds.credentials)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ----------------------------- Realtime (WebSocket) -----------------------------
class ConnectionManager:
    def __init__(self):
        self.rooms: dict = {}  # pair_id -> list of {"user_id", "ws"}

    async def connect(self, pair_id: str, user_id: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(pair_id, []).append({"user_id": user_id, "ws": ws})

    def disconnect(self, pair_id: str, ws: WebSocket):
        conns = self.rooms.get(pair_id, [])
        self.rooms[pair_id] = [c for c in conns if c["ws"] is not ws]

    async def broadcast(self, pair_id: str, data: dict, exclude_ws: Optional[WebSocket] = None):
        for c in list(self.rooms.get(pair_id, [])):
            if exclude_ws is not None and c["ws"] is exclude_ws:
                continue
            try:
                await c["ws"].send_json(data)
            except Exception:
                pass


manager = ConnectionManager()


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
    kind: str = "text"  # text | image | video | system
    media_id: Optional[str] = None
    media_nonce: Optional[str] = None
    media_mime: Optional[str] = None
    view_once: bool = False
    allow_save: bool = True
    expire_seconds: Optional[int] = None  # media auto-expires this many seconds after sending


class MediaUploadIn(BaseModel):
    data_b64: str  # base64 of the ENCRYPTED (ciphertext) bytes
    mime: str = "application/octet-stream"
    kind: str = "image"


class WorryIn(BaseModel):
    nonce: str
    ciphertext: str


class EventIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    note: Optional[str] = Field(default=None, max_length=500)
    date: str  # ISO date string
    shared: bool = True
    color: Optional[str] = None


class CheckinIn(BaseModel):
    date: str  # yyyy-mm-dd
    mood: str = Field(min_length=1, max_length=40)
    nonce: str = ""
    ciphertext: str = ""


class ReactIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


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
    expire_seconds = body.expire_seconds if (body.expire_seconds and body.expire_seconds > 0) else None
    msg = {
        "id": str(uuid.uuid4()),
        "pair_id": pair["id"],
        "sender_id": user["id"],
        "nonce": body.nonce,
        "ciphertext": body.ciphertext,
        "kind": body.kind,
        "media_id": body.media_id,
        "media_nonce": body.media_nonce,
        "media_mime": body.media_mime,
        "view_once": body.view_once,
        "allow_save": body.allow_save,
        "expire_seconds": expire_seconds,  # timer starts when partner first opens
        "expires_at": None,
        "viewed": False,
        "created_at": now_iso(),
    }
    await db.messages.insert_one(msg)
    msg.pop("_id", None)
    if expire_seconds and body.media_id:
        await db.media.update_one({"id": body.media_id}, {"$set": {"expire_seconds": expire_seconds}})
    await manager.broadcast(pair["id"], {"type": "message", "message": msg})
    return {"message": msg}


@api_router.post("/messages/{message_id}/viewed")
async def mark_viewed(message_id: str, user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    m = await db.messages.find_one({"id": message_id, "pair_id": pair["id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Message not found")
    await db.messages.update_one({"id": message_id}, {"$set": {"viewed": True}})
    # For view-once media viewed by the recipient, consume the media so it can't be re-fetched.
    if m.get("view_once") and m.get("media_id") and m.get("sender_id") != user["id"]:
        await db.media.update_one({"id": m["media_id"]}, {"$set": {"consumed": True}})
    await manager.broadcast(pair["id"], {"type": "read", "user_id": user["id"]}, exclude_ws=None)
    return {"ok": True}


# ----------------------------- E2E Media -----------------------------
@api_router.post("/media/upload")
async def media_upload(body: MediaUploadIn, user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    try:
        raw = base64.b64decode(body.data_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid media data")
    media_id = str(uuid.uuid4())
    path = f"{APP_NAME}/uploads/{user['id']}/{media_id}.bin"
    try:
        await run_in_threadpool(put_object, path, raw, "application/octet-stream")
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else 500
        if code == 402:
            raise HTTPException(status_code=402, detail="Storage limit reached")
        raise HTTPException(status_code=502, detail="Upload failed")
    doc = {
        "id": media_id,
        "pair_id": pair["id"],
        "owner_id": user["id"],
        "storage_path": path,
        "mime": body.mime,
        "kind": body.kind,
        "size": len(raw),
        "consumed": False,
        "created_at": now_iso(),
    }
    await db.media.insert_one(doc)
    return {"media_id": media_id}


@api_router.get("/media/{media_id}")
async def media_download(media_id: str, user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    doc = await db.media.find_one({"id": media_id, "pair_id": pair["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Media not found")
    if doc.get("consumed"):
        raise HTTPException(status_code=410, detail="This media is no longer available")
    if doc.get("expires_at") and now_iso() > doc["expires_at"]:
        await db.media.update_one({"id": media_id}, {"$set": {"consumed": True}})
        raise HTTPException(status_code=410, detail="This media has expired")
    # Start the auto-expire timer when the RECIPIENT (not the sender) first opens it.
    if not doc.get("expires_at") and doc.get("expire_seconds") and doc.get("owner_id") != user["id"]:
        exp = (datetime.now(timezone.utc) + timedelta(seconds=int(doc["expire_seconds"]))).isoformat()
        await db.media.update_one({"id": media_id}, {"$set": {"expires_at": exp}})
        await db.messages.update_many({"media_id": media_id}, {"$set": {"expires_at": exp}})
        await manager.broadcast(pair["id"], {"type": "expiry_started", "media_id": media_id, "expires_at": exp})
    try:
        data = await run_in_threadpool(get_object, doc["storage_path"])
    except Exception:
        raise HTTPException(status_code=502, detail="Download failed")
    return Response(content=data, media_type="application/octet-stream")


@api_router.get("/gallery")
async def gallery(user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    now = now_iso()
    items = await db.messages.find(
        {
            "pair_id": pair["id"],
            "media_id": {"$ne": None},
            "$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}],
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(300)
    return {"items": items}


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


# ----------------------------- LiveKit calling -----------------------------
@api_router.post("/livekit/token")
async def livekit_token(user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    if not (LIVEKIT_URL and LIVEKIT_API_KEY and LIVEKIT_API_SECRET):
        raise HTTPException(status_code=503, detail="Calling is not configured")
    room = f"pair_{pair['id']}"
    token = (
        lk_api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(user["id"])
        .with_name(user.get("display_name") or "Partner")
        .with_ttl(timedelta(minutes=30))
        .with_grants(
            lk_api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
            )
        )
        .to_jwt()
    )
    return {"server_url": LIVEKIT_URL, "token": token, "room": room}


# ----------------------------- Daily Check-in -----------------------------
@api_router.get("/checkins")
async def get_checkins(user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    items = await db.checkins.find({"pair_id": pair["id"]}, {"_id": 0}).sort("created_at", -1).to_list(60)
    return {"checkins": items}


@api_router.post("/checkins")
async def add_checkin(body: CheckinIn, user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    existing = await db.checkins.find_one({"pair_id": pair["id"], "author_id": user["id"], "date": body.date})
    if existing:
        await db.checkins.update_one(
            {"id": existing["id"]},
            {"$set": {"mood": body.mood, "nonce": body.nonce, "ciphertext": body.ciphertext, "created_at": now_iso()}},
        )
        doc = await db.checkins.find_one({"id": existing["id"]}, {"_id": 0})
    else:
        doc = {
            "id": str(uuid.uuid4()),
            "pair_id": pair["id"],
            "author_id": user["id"],
            "date": body.date,
            "mood": body.mood,
            "nonce": body.nonce,
            "ciphertext": body.ciphertext,
            "reactions": {},
            "created_at": now_iso(),
        }
        await db.checkins.insert_one(dict(doc))
    await manager.broadcast(pair["id"], {"type": "checkin"})
    return {"checkin": doc}


@api_router.post("/checkins/{checkin_id}/react")
async def react_checkin(checkin_id: str, body: ReactIn, user=Depends(get_current_user)):
    pair = await require_active_pair(user)
    c = await db.checkins.find_one({"id": checkin_id, "pair_id": pair["id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Check-in not found")
    await db.checkins.update_one({"id": checkin_id}, {"$set": {f"reactions.{user['id']}": body.emoji}})
    doc = await db.checkins.find_one({"id": checkin_id}, {"_id": 0})
    await manager.broadcast(pair["id"], {"type": "checkin"})
    return {"checkin": doc}


# ----------------------------- App wiring -----------------------------
app.include_router(api_router)


@app.websocket("/api/ws")
async def ws_endpoint(websocket: WebSocket, token: str = ""):
    user_id = decode_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user or not user.get("pair_id"):
        await websocket.close(code=4403)
        return
    pair = await db.pairs.find_one({"id": user["pair_id"]})
    if not pair or pair.get("status") != "active":
        await websocket.close(code=4403)
        return
    pair_id = pair["id"]
    await manager.connect(pair_id, user_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            t = data.get("type")
            if t == "typing":
                await manager.broadcast(
                    pair_id,
                    {"type": "typing", "user_id": user_id, "is_typing": bool(data.get("is_typing"))},
                    exclude_ws=websocket,
                )
            elif t == "read":
                await db.messages.update_many(
                    {"pair_id": pair_id, "sender_id": {"$ne": user_id}, "viewed": False},
                    {"$set": {"viewed": True}},
                )
                await manager.broadcast(
                    pair_id,
                    {"type": "read", "user_id": user_id},
                    exclude_ws=websocket,
                )
            elif t == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(pair_id, websocket)
    except Exception:
        manager.disconnect(pair_id, websocket)


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
    await db.media.create_index("id")
    try:
        await run_in_threadpool(init_storage)
        logger.info("Object storage initialized")
    except Exception as e:
        logger.warning(f"Object storage init failed (will retry on demand): {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
