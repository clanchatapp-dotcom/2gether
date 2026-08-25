"""
Round 4 backend tests:

1) EXPIRY-AFTER-VIEW state machine
   - POST /api/messages with expire_seconds>0 on media stores expire_seconds; expires_at=null (timer NOT started)
   - GET /api/media/{id} by SENDER (owner) does NOT start the timer; still returns bytes; repeatable
   - GET /api/media/{id} by RECIPIENT (non-owner) FIRST time sets expires_at = now + expire_seconds,
     returns bytes 200, and broadcasts a WebSocket {type:'expiry_started', media_id, expires_at}
   - After expiry: GET /api/media/{id} => 410 and item is excluded from /api/gallery
   - Regression: no expire_seconds => no expiry; view_once still 410 after mark viewed; byte round-trip preserved

2) LIVEKIT TOKEN endpoint
   - POST /api/livekit/token returns {server_url (wss://...), token (JWT), room=pair_<pairId>}
   - Both partners get the SAME room string
   - Returns 400 'Not paired' for a user with no active pair
"""
import asyncio
import base64
import json
import os
import time
import uuid
from urllib.parse import urlparse

import jwt as pyjwt
import pytest
import requests
import websockets

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _email(p="TEST_r4"):
    return f"{p}_{uuid.uuid4().hex[:10]}@twogether-r4.com"


def _key():
    return base64.b64encode(os.urandom(32)).decode()


def _ws_url(token: str) -> str:
    parsed = urlparse(BASE_URL)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return f"{scheme}://{parsed.netloc}/api/ws?token={token}"


@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def paired(http):
    a = http.post(f"{API}/auth/register", json={
        "email": _email("TEST_r4a"), "password": "secret123",
        "display_name": "R4 Alice", "public_key": _key(),
    }).json()
    b = http.post(f"{API}/auth/register", json={
        "email": _email("TEST_r4b"), "password": "secret123",
        "display_name": "R4 Bob", "public_key": _key(),
    }).json()
    ha = {"Authorization": f"Bearer {a['access_token']}"}
    hb = {"Authorization": f"Bearer {b['access_token']}"}
    code = http.post(f"{API}/pair/create", headers=ha).json()["code"]
    pr = http.post(f"{API}/pair/redeem", headers=hb, json={"code": code}).json()
    return {
        "ha": ha, "hb": hb,
        "a_id": a["user"]["id"], "b_id": b["user"]["id"],
        "a_tok": a["access_token"], "b_tok": b["access_token"],
        "pair_id": pr["pair_id"],
    }


@pytest.fixture(scope="module")
def solo(http):
    r = http.post(f"{API}/auth/register", json={
        "email": _email("TEST_r4solo"), "password": "secret123",
        "display_name": "R4 Solo", "public_key": _key(),
    }).json()
    return {"h": {"Authorization": f"Bearer {r['access_token']}"}}


# -------------------- helpers --------------------
def _upload_media(http, headers, payload=b"secret-bytes"):
    r = http.post(f"{API}/media/upload", headers=headers, json={
        "data_b64": base64.b64encode(payload).decode(),
        "mime": "image/jpeg",
        "kind": "image",
    })
    assert r.status_code == 200, r.text
    return r.json()["media_id"]


def _send_media_msg(http, headers, media_id, expire_seconds=None, view_once=False, allow_save=True):
    body = {
        "nonce": "n" + uuid.uuid4().hex[:6],
        "ciphertext": "ct-media",
        "kind": "image",
        "media_id": media_id,
        "media_nonce": "mn",
        "media_mime": "image/jpeg",
        "view_once": view_once,
        "allow_save": allow_save,
    }
    if expire_seconds is not None:
        body["expire_seconds"] = expire_seconds
    r = http.post(f"{API}/messages", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()["message"]


# ==================== EXPIRY-AFTER-VIEW ====================
class TestExpiryAfterView:
    def test_send_message_does_not_start_timer(self, http, paired):
        payload = b"first-payload-" + os.urandom(8)
        mid = _upload_media(http, paired["ha"], payload)
        msg = _send_media_msg(http, paired["ha"], mid, expire_seconds=60)
        # message stored w/ expire_seconds and expires_at=None
        assert msg["expire_seconds"] == 60
        assert msg["expires_at"] is None
        assert msg["media_id"] == mid
        # gallery should include it (still active/no expires_at)
        gal = http.get(f"{API}/gallery", headers=paired["ha"]).json()["items"]
        assert any(it["id"] == msg["id"] for it in gal)

    def test_owner_download_does_not_start_timer(self, http, paired):
        payload = b"owner-view-" + os.urandom(8)
        mid = _upload_media(http, paired["ha"], payload)
        _send_media_msg(http, paired["ha"], mid, expire_seconds=60)
        # A (owner) downloads twice; timer must not start (expires_at stays null)
        r1 = http.get(f"{API}/media/{mid}", headers=paired["ha"])
        assert r1.status_code == 200
        assert r1.content == payload  # byte-exact
        r2 = http.get(f"{API}/media/{mid}", headers=paired["ha"])
        assert r2.status_code == 200
        assert r2.content == payload
        # verify via gallery -> message.expires_at still None
        msgs = http.get(f"{API}/messages", headers=paired["ha"]).json()["messages"]
        m = next(x for x in msgs if x.get("media_id") == mid)
        assert m["expires_at"] is None, f"Owner download should NOT start timer, got {m['expires_at']}"

    def test_recipient_first_download_starts_timer_and_broadcasts_ws(self, http, paired):
        payload = b"recipient-first-" + os.urandom(8)
        mid = _upload_media(http, paired["ha"], payload)
        sent = _send_media_msg(http, paired["ha"], mid, expire_seconds=30)
        assert sent["expires_at"] is None

        received = {"expiry_started": None}

        async def ws_and_download():
            # B connects; also A connects to confirm broadcast reaches sender
            url_b = _ws_url(paired["b_tok"])
            async with websockets.connect(url_b) as ws_b:
                # Drain the initial "message" broadcast if any
                await asyncio.sleep(0.3)

                # Kick off the recipient download in a thread
                loop = asyncio.get_running_loop()
                dl_future = loop.run_in_executor(
                    None,
                    lambda: http.get(f"{API}/media/{mid}", headers=paired["hb"]),
                )

                # Listen for the expiry_started event (up to 8s)
                try:
                    while True:
                        raw = await asyncio.wait_for(ws_b.recv(), timeout=8.0)
                        evt = json.loads(raw)
                        if evt.get("type") == "expiry_started" and evt.get("media_id") == mid:
                            received["expiry_started"] = evt
                            break
                except asyncio.TimeoutError:
                    pass

                dl_resp = await dl_future
                return dl_resp

        loop = asyncio.new_event_loop()
        try:
            dl_resp = loop.run_until_complete(ws_and_download())
        finally:
            loop.close()
        assert dl_resp.status_code == 200, dl_resp.text
        assert dl_resp.content == payload  # byte-exact even on first recipient view

        assert received["expiry_started"] is not None, "WebSocket expiry_started event not received"
        assert received["expiry_started"]["media_id"] == mid
        assert received["expiry_started"]["expires_at"]

        # Now expires_at is set on the message; still visible in gallery (not yet expired)
        msgs = http.get(f"{API}/messages", headers=paired["hb"]).json()["messages"]
        m = next(x for x in msgs if x.get("media_id") == mid)
        assert m["expires_at"] is not None
        gal = http.get(f"{API}/gallery", headers=paired["hb"]).json()["items"]
        assert any(it["id"] == sent["id"] for it in gal)

    def test_recipient_second_download_does_not_reset_timer(self, http, paired):
        payload = b"stable-timer-" + os.urandom(8)
        mid = _upload_media(http, paired["ha"], payload)
        _send_media_msg(http, paired["ha"], mid, expire_seconds=120)
        r1 = http.get(f"{API}/media/{mid}", headers=paired["hb"])
        assert r1.status_code == 200
        m1 = next(x for x in http.get(f"{API}/messages", headers=paired["ha"]).json()["messages"]
                  if x.get("media_id") == mid)
        exp1 = m1["expires_at"]
        assert exp1
        time.sleep(1.5)
        r2 = http.get(f"{API}/media/{mid}", headers=paired["hb"])
        assert r2.status_code == 200
        assert r2.content == payload
        m2 = next(x for x in http.get(f"{API}/messages", headers=paired["ha"]).json()["messages"]
                  if x.get("media_id") == mid)
        assert m2["expires_at"] == exp1, "expires_at must NOT be reset on subsequent recipient views"

    def test_media_expires_after_wait_returns_410_and_hidden_from_gallery(self, http, paired):
        payload = b"gonna-expire-" + os.urandom(8)
        mid = _upload_media(http, paired["ha"], payload)
        sent = _send_media_msg(http, paired["ha"], mid, expire_seconds=1)
        # Recipient triggers timer
        r = http.get(f"{API}/media/{mid}", headers=paired["hb"])
        assert r.status_code == 200
        time.sleep(2.2)
        # Now expired
        r2 = http.get(f"{API}/media/{mid}", headers=paired["hb"])
        assert r2.status_code == 410, r2.text
        # Owner also gets 410 (consumed flag was set)
        r3 = http.get(f"{API}/media/{mid}", headers=paired["ha"])
        assert r3.status_code == 410
        # Gallery excludes it (expires_at in the past)
        gal = http.get(f"{API}/gallery", headers=paired["hb"]).json()["items"]
        assert not any(it["id"] == sent["id"] for it in gal), "Expired item must be excluded from gallery"
        gal_a = http.get(f"{API}/gallery", headers=paired["ha"]).json()["items"]
        assert not any(it["id"] == sent["id"] for it in gal_a)

    # ---------------- Regression ----------------
    def test_regression_no_expire_seconds_no_timer(self, http, paired):
        payload = b"no-expiry-" + os.urandom(8)
        mid = _upload_media(http, paired["ha"], payload)
        msg = _send_media_msg(http, paired["ha"], mid)  # no expire_seconds
        assert msg.get("expire_seconds") in (None, 0)
        assert msg["expires_at"] is None
        # Recipient views many times
        for _ in range(3):
            r = http.get(f"{API}/media/{mid}", headers=paired["hb"])
            assert r.status_code == 200
            assert r.content == payload
        m2 = next(x for x in http.get(f"{API}/messages", headers=paired["ha"]).json()["messages"]
                  if x.get("media_id") == mid)
        assert m2["expires_at"] is None

    def test_regression_view_once_returns_410_after_mark_viewed(self, http, paired):
        payload = b"view-once-" + os.urandom(8)
        mid = _upload_media(http, paired["ha"], payload)
        msg = _send_media_msg(http, paired["ha"], mid, view_once=True)
        # B downloads once
        r = http.get(f"{API}/media/{mid}", headers=paired["hb"])
        assert r.status_code == 200
        assert r.content == payload
        # B marks viewed
        mv = http.post(f"{API}/messages/{msg['id']}/viewed", headers=paired["hb"])
        assert mv.status_code == 200
        # Subsequent download -> 410
        r2 = http.get(f"{API}/media/{mid}", headers=paired["hb"])
        assert r2.status_code == 410

    def test_media_bytes_roundtrip_exact(self, http, paired):
        payload = os.urandom(1024)  # 1KB random ciphertext
        mid = _upload_media(http, paired["ha"], payload)
        _send_media_msg(http, paired["ha"], mid)
        r = http.get(f"{API}/media/{mid}", headers=paired["hb"])
        assert r.status_code == 200
        assert r.content == payload
        assert len(r.content) == 1024


# ==================== LIVEKIT TOKEN ====================
class TestLiveKitToken:
    def test_token_returned_for_paired_user(self, http, paired):
        r = http.post(f"{API}/livekit/token", headers=paired["ha"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert "server_url" in body and body["server_url"].startswith("wss://")
        assert "token" in body and body["token"]
        assert "room" in body and body["room"] == f"pair_{paired['pair_id']}"
        # Decode JWT (without verifying signature) - should have identity and video grants
        decoded = pyjwt.decode(body["token"], options={"verify_signature": False})
        # Identity should be the user id (sub in LiveKit JWT)
        assert decoded.get("sub") == paired["a_id"] or decoded.get("identity") == paired["a_id"], decoded
        vg = decoded.get("video") or {}
        assert vg.get("room") == body["room"]
        assert vg.get("roomJoin") is True

    def test_both_partners_get_same_room(self, http, paired):
        ra = http.post(f"{API}/livekit/token", headers=paired["ha"]).json()
        rb = http.post(f"{API}/livekit/token", headers=paired["hb"]).json()
        assert ra["room"] == rb["room"] == f"pair_{paired['pair_id']}"
        # server_url identical
        assert ra["server_url"] == rb["server_url"]
        # tokens differ (identity differs)
        assert ra["token"] != rb["token"]

    def test_token_400_not_paired(self, http, solo):
        r = http.post(f"{API}/livekit/token", headers=solo["h"])
        assert r.status_code == 400, r.text
        assert "paired" in r.json()["detail"].lower()

    def test_token_401_no_auth(self, http):
        r = http.post(f"{API}/livekit/token")
        assert r.status_code == 401


# ==================== Regression: full basic suite ====================
class TestRegression:
    def test_auth_me(self, http, paired):
        r = http.get(f"{API}/me", headers=paired["ha"])
        assert r.status_code == 200
        assert r.json()["user"]["id"] == paired["a_id"]

    def test_pair_get_active(self, http, paired):
        r = http.get(f"{API}/pair", headers=paired["hb"])
        assert r.status_code == 200
        assert r.json()["status"] == "active"
        assert r.json()["partner"]["id"] == paired["a_id"]

    def test_send_text_and_list(self, http, paired):
        r = http.post(f"{API}/messages", headers=paired["ha"], json={
            "nonce": "rn", "ciphertext": "reg-hello", "kind": "text",
        })
        assert r.status_code == 200
        mid = r.json()["message"]["id"]
        lst = http.get(f"{API}/messages", headers=paired["hb"]).json()["messages"]
        assert any(m["id"] == mid for m in lst)

    def test_worries_events_checkins(self, http, paired):
        w = http.post(f"{API}/worries", headers=paired["ha"], json={"nonce": "wn", "ciphertext": "wct"})
        assert w.status_code == 200
        e = http.post(f"{API}/events", headers=paired["ha"], json={
            "title": "TEST reg", "date": "2026-03-10",
        })
        assert e.status_code == 200
        c = http.post(f"{API}/checkins", headers=paired["ha"], json={
            "date": "2026-01-10", "mood": "happy",
        })
        assert c.status_code == 200
        cid = c.json()["checkin"]["id"]
        # upsert same day: mood changes, id stable
        c2 = http.post(f"{API}/checkins", headers=paired["ha"], json={
            "date": "2026-01-10", "mood": "meh",
        })
        assert c2.status_code == 200
        assert c2.json()["checkin"]["id"] == cid
        assert c2.json()["checkin"]["mood"] == "meh"
        # react
        rr = http.post(f"{API}/checkins/{cid}/react", headers=paired["hb"], json={"emoji": "❤"})
        assert rr.status_code == 200
        assert rr.json()["checkin"]["reactions"][paired["b_id"]] == "❤"

    def test_websocket_typing_and_pong(self, http, paired):
        received = {"typing": None, "pong": None}

        async def run():
            url_a = _ws_url(paired["a_tok"])
            url_b = _ws_url(paired["b_tok"])
            async with websockets.connect(url_a) as wa, websockets.connect(url_b) as wb:
                await asyncio.sleep(0.3)
                # A sends typing -> B should receive
                await wa.send(json.dumps({"type": "typing", "is_typing": True}))
                try:
                    while True:
                        raw = await asyncio.wait_for(wb.recv(), timeout=4.0)
                        evt = json.loads(raw)
                        if evt.get("type") == "typing":
                            received["typing"] = evt
                            break
                except asyncio.TimeoutError:
                    pass
                # ping-pong on A
                await wa.send(json.dumps({"type": "ping"}))
                try:
                    while True:
                        raw = await asyncio.wait_for(wa.recv(), timeout=4.0)
                        evt = json.loads(raw)
                        if evt.get("type") == "pong":
                            received["pong"] = evt
                            break
                except asyncio.TimeoutError:
                    pass

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(run())
        finally:
            loop.close()
        assert received["typing"] and received["typing"]["is_typing"] is True
        assert received["pong"] == {"type": "pong"}
