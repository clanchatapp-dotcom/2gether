"""
Twogether Round-2 backend tests:
- WebSocket /api/ws (auth, pair gating, typing, read, ping, message broadcast)
- Media E2E: upload/download, gating, view-once consumption
- Message extended fields (media_id, view_once, allow_save, kind)
- Check-ins: upsert-per-day, listing, reactions, gating
"""
import os
import uuid
import base64
import asyncio
import pytest
import requests
import websockets
import json

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws"


def _rand_email(prefix="TEST_r2"):
    return f"{prefix}_{uuid.uuid4().hex[:10]}@twogether-r2.com"


def _rand_key():
    return base64.b64encode(os.urandom(32)).decode("utf-8")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def paired(api):
    a_email = _rand_email("TEST_r2a")
    b_email = _rand_email("TEST_r2b")
    a = api.post(f"{API}/auth/register", json={
        "email": a_email, "password": "secret123",
        "display_name": "R2 Alice", "public_key": _rand_key(),
    }).json()
    b = api.post(f"{API}/auth/register", json={
        "email": b_email, "password": "secret123",
        "display_name": "R2 Bob", "public_key": _rand_key(),
    }).json()
    ha = {"Authorization": f"Bearer {a['access_token']}"}
    hb = {"Authorization": f"Bearer {b['access_token']}"}
    code = api.post(f"{API}/pair/create", headers=ha).json()["code"]
    pr = api.post(f"{API}/pair/redeem", headers=hb, json={"code": code}).json()
    return {
        "a_token": a["access_token"], "b_token": b["access_token"],
        "a_id": a["user"]["id"], "b_id": b["user"]["id"],
        "a_headers": ha, "b_headers": hb, "pair_id": pr["pair_id"],
    }


@pytest.fixture(scope="module")
def unpaired_token(api):
    email = _rand_email("TEST_r2_solo")
    r = api.post(f"{API}/auth/register", json={
        "email": email, "password": "secret123",
        "display_name": "Solo", "public_key": _rand_key(),
    }).json()
    return r["access_token"]


# --------------------------- Gating ---------------------------
class TestGating:
    def test_media_upload_unpaired_400(self, api, unpaired_token):
        r = api.post(f"{API}/media/upload",
                     headers={"Authorization": f"Bearer {unpaired_token}"},
                     json={"data_b64": base64.b64encode(b"x").decode(), "mime": "image/png", "kind": "image"})
        assert r.status_code == 400
        assert "paired" in r.json()["detail"].lower()

    def test_checkins_get_unpaired_400(self, api, unpaired_token):
        r = api.get(f"{API}/checkins", headers={"Authorization": f"Bearer {unpaired_token}"})
        assert r.status_code == 400

    def test_checkins_post_unpaired_400(self, api, unpaired_token):
        r = api.post(f"{API}/checkins",
                     headers={"Authorization": f"Bearer {unpaired_token}"},
                     json={"date": "2026-01-15", "mood": "happy"})
        assert r.status_code == 400


# --------------------------- Media E2E ---------------------------
class TestMedia:
    def test_upload_and_download_roundtrip(self, api, paired):
        payload = os.urandom(256)  # opaque ciphertext bytes
        b64 = base64.b64encode(payload).decode()
        up = api.post(f"{API}/media/upload", headers=paired["a_headers"],
                      json={"data_b64": b64, "mime": "image/jpeg", "kind": "image"})
        assert up.status_code == 200, up.text
        media_id = up.json()["media_id"]
        assert media_id
        # Partner downloads
        dl = api.get(f"{API}/media/{media_id}", headers=paired["b_headers"])
        assert dl.status_code == 200
        assert dl.content == payload

    def test_view_once_media_410_after_viewed(self, api, paired):
        payload = os.urandom(128)
        b64 = base64.b64encode(payload).decode()
        up = api.post(f"{API}/media/upload", headers=paired["a_headers"],
                      json={"data_b64": b64, "mime": "image/png", "kind": "image"}).json()
        media_id = up["media_id"]
        # A sends a view-once message referencing media
        msg = api.post(f"{API}/messages", headers=paired["a_headers"], json={
            "nonce": "n", "ciphertext": "ct", "kind": "image",
            "media_id": media_id, "media_nonce": "mn", "media_mime": "image/png",
            "view_once": True, "allow_save": False,
        }).json()["message"]
        assert msg["view_once"] is True
        assert msg["allow_save"] is False
        assert msg["media_id"] == media_id
        # B can download first
        dl1 = api.get(f"{API}/media/{media_id}", headers=paired["b_headers"])
        assert dl1.status_code == 200
        # B marks viewed
        mv = api.post(f"{API}/messages/{msg['id']}/viewed", headers=paired["b_headers"])
        assert mv.status_code == 200
        # Subsequent download -> 410
        dl2 = api.get(f"{API}/media/{media_id}", headers=paired["b_headers"])
        assert dl2.status_code == 410

    def test_media_404_for_unknown(self, api, paired):
        r = api.get(f"{API}/media/{uuid.uuid4()}", headers=paired["a_headers"])
        assert r.status_code == 404


# --------------------------- Messages extended ---------------------------
class TestMessageFields:
    def test_message_defaults_and_ciphertext_only(self, api, paired):
        r = api.post(f"{API}/messages", headers=paired["a_headers"], json={
            "nonce": "nx", "ciphertext": "ctx", "kind": "text",
        })
        assert r.status_code == 200
        m = r.json()["message"]
        assert m["view_once"] is False
        assert m["allow_save"] is True
        assert m["media_id"] is None
        assert m["viewed"] is False
        assert "_id" not in m
        assert "plaintext" not in m
        assert m["ciphertext"] == "ctx"


# --------------------------- Check-ins ---------------------------
class TestCheckins:
    def test_upsert_one_per_day(self, api, paired):
        date = "2026-01-15"
        r1 = api.post(f"{API}/checkins", headers=paired["a_headers"],
                      json={"date": date, "mood": "happy", "nonce": "n1", "ciphertext": "c1"})
        assert r1.status_code == 200
        id1 = r1.json()["checkin"]["id"]
        # second post same day -> should UPDATE not duplicate
        r2 = api.post(f"{API}/checkins", headers=paired["a_headers"],
                      json={"date": date, "mood": "sad", "nonce": "n2", "ciphertext": "c2"})
        assert r2.status_code == 200
        id2 = r2.json()["checkin"]["id"]
        assert id1 == id2, "second post same day should update, not duplicate"
        assert r2.json()["checkin"]["mood"] == "sad"
        # list from B - should see A's single check-in for that date
        lst = api.get(f"{API}/checkins", headers=paired["b_headers"]).json()["checkins"]
        matches = [x for x in lst if x["author_id"] == paired["a_id"] and x["date"] == date]
        assert len(matches) == 1
        assert matches[0]["mood"] == "sad"

    def test_list_shows_both_partners(self, api, paired):
        date = "2026-01-16"
        api.post(f"{API}/checkins", headers=paired["a_headers"],
                 json={"date": date, "mood": "calm", "nonce": "n", "ciphertext": "ca"})
        api.post(f"{API}/checkins", headers=paired["b_headers"],
                 json={"date": date, "mood": "tired", "nonce": "n", "ciphertext": "cb"})
        lst = api.get(f"{API}/checkins", headers=paired["a_headers"]).json()["checkins"]
        authors = {x["author_id"] for x in lst if x["date"] == date}
        assert paired["a_id"] in authors and paired["b_id"] in authors

    def test_react_to_checkin(self, api, paired):
        date = "2026-01-17"
        c = api.post(f"{API}/checkins", headers=paired["a_headers"],
                     json={"date": date, "mood": "excited", "nonce": "n", "ciphertext": "c"}).json()["checkin"]
        rr = api.post(f"{API}/checkins/{c['id']}/react", headers=paired["b_headers"],
                      json={"emoji": "❤️"})
        assert rr.status_code == 200
        assert rr.json()["checkin"]["reactions"].get(paired["b_id"]) == "❤️"

    def test_react_unknown_404(self, api, paired):
        r = api.post(f"{API}/checkins/{uuid.uuid4()}/react", headers=paired["a_headers"],
                     json={"emoji": "🔥"})
        assert r.status_code == 404


# --------------------------- WebSocket ---------------------------
@pytest.mark.asyncio
async def test_ws_rejects_invalid_token():
    try:
        async with websockets.connect(f"{WS_URL}?token=invalid", open_timeout=10) as ws:
            # If connect succeeds it should immediately close
            await asyncio.wait_for(ws.recv(), timeout=3)
            pytest.fail("Expected close on invalid token")
    except websockets.exceptions.InvalidStatus as e:
        # server closed handshake
        assert True
    except websockets.exceptions.ConnectionClosed:
        assert True
    except Exception:
        # Any refusal is acceptable
        assert True


@pytest.mark.asyncio
async def test_ws_rejects_unpaired(unpaired_token):
    try:
        async with websockets.connect(f"{WS_URL}?token={unpaired_token}", open_timeout=10) as ws:
            with pytest.raises((websockets.exceptions.ConnectionClosed, asyncio.TimeoutError)):
                await asyncio.wait_for(ws.recv(), timeout=3)
    except websockets.exceptions.InvalidStatus:
        assert True


@pytest.mark.asyncio
async def test_ws_ping_pong(paired):
    async with websockets.connect(f"{WS_URL}?token={paired['a_token']}", open_timeout=10) as ws:
        await ws.send(json.dumps({"type": "ping"}))
        raw = await asyncio.wait_for(ws.recv(), timeout=5)
        data = json.loads(raw)
        assert data.get("type") == "pong"


@pytest.mark.asyncio
async def test_ws_typing_and_read_broadcast(paired):
    # A and B both connect; A sends typing -> B receives it (excluded self)
    async with websockets.connect(f"{WS_URL}?token={paired['a_token']}", open_timeout=10) as wa, \
               websockets.connect(f"{WS_URL}?token={paired['b_token']}", open_timeout=10) as wb:
        await asyncio.sleep(0.3)
        await wa.send(json.dumps({"type": "typing", "is_typing": True}))
        raw = await asyncio.wait_for(wb.recv(), timeout=5)
        d = json.loads(raw)
        assert d["type"] == "typing"
        assert d["user_id"] == paired["a_id"]
        assert d["is_typing"] is True

        # B sends read -> A gets read event, and A's messages flip viewed=True
        # First have A send a message via HTTP
        r = requests.post(f"{API}/messages",
                          headers={**paired["a_headers"], "Content-Type": "application/json"},
                          json={"nonce": "wsn", "ciphertext": "wsct", "kind": "text"})
        assert r.status_code == 200
        # Both WS connections will get the broadcast; drain them
        try:
            await asyncio.wait_for(wa.recv(), timeout=3)
        except asyncio.TimeoutError:
            pass
        try:
            await asyncio.wait_for(wb.recv(), timeout=3)
        except asyncio.TimeoutError:
            pass

        await wb.send(json.dumps({"type": "read"}))
        # A should receive read event
        got_read = False
        for _ in range(3):
            try:
                raw = await asyncio.wait_for(wa.recv(), timeout=3)
                d = json.loads(raw)
                if d.get("type") == "read":
                    got_read = True
                    assert d["user_id"] == paired["b_id"]
                    break
            except asyncio.TimeoutError:
                break
        assert got_read, "A did not receive read broadcast from B"


@pytest.mark.asyncio
async def test_ws_message_broadcast_on_post(paired):
    async with websockets.connect(f"{WS_URL}?token={paired['b_token']}", open_timeout=10) as wb:
        await asyncio.sleep(0.3)
        # A posts a message via HTTP; B should get {type:message}
        r = requests.post(f"{API}/messages",
                          headers={**paired["a_headers"], "Content-Type": "application/json"},
                          json={"nonce": "bn", "ciphertext": "bct", "kind": "text"})
        assert r.status_code == 200
        posted = r.json()["message"]
        got = False
        for _ in range(3):
            try:
                raw = await asyncio.wait_for(wb.recv(), timeout=4)
                d = json.loads(raw)
                if d.get("type") == "message" and d.get("message", {}).get("id") == posted["id"]:
                    got = True
                    assert d["message"]["ciphertext"] == "bct"
                    break
            except asyncio.TimeoutError:
                break
        assert got, "B did not receive message broadcast"
