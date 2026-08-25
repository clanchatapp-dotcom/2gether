"""
Round 3 backend tests: GET /api/gallery + system messages + regression.
- /api/gallery returns only messages with media_id, newest-first, gated to active pair
- kind='system' messages stored (ciphertext-only) and EXCLUDED from gallery
- Media round-trip + view_once 410 (regression)
- Worries/events/checkins/pair still functional
"""
import os
import uuid
import base64
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _email(p="TEST_r3"):
    return f"{p}_{uuid.uuid4().hex[:10]}@twogether-r3.com"


def _key():
    return base64.b64encode(os.urandom(32)).decode()


@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def paired(http):
    a = http.post(f"{API}/auth/register", json={
        "email": _email("TEST_r3a"), "password": "secret123",
        "display_name": "R3 Alice", "public_key": _key(),
    }).json()
    b = http.post(f"{API}/auth/register", json={
        "email": _email("TEST_r3b"), "password": "secret123",
        "display_name": "R3 Bob", "public_key": _key(),
    }).json()
    ha = {"Authorization": f"Bearer {a['access_token']}"}
    hb = {"Authorization": f"Bearer {b['access_token']}"}
    code = http.post(f"{API}/pair/create", headers=ha).json()["code"]
    pr = http.post(f"{API}/pair/redeem", headers=hb, json={"code": code}).json()
    return {"ha": ha, "hb": hb, "a_id": a["user"]["id"], "b_id": b["user"]["id"],
            "pair_id": pr["pair_id"]}


@pytest.fixture(scope="module")
def solo(http):
    r = http.post(f"{API}/auth/register", json={
        "email": _email("TEST_r3solo"), "password": "secret123",
        "display_name": "Solo", "public_key": _key(),
    }).json()
    return {"Authorization": f"Bearer {r['access_token']}"}


# ---------------- Gallery gating ----------------
def test_gallery_requires_active_pair(http, solo):
    r = http.get(f"{API}/gallery", headers=solo)
    assert r.status_code == 400
    assert "paired" in r.json()["detail"].lower()


def test_gallery_no_auth_401(http):
    r = http.get(f"{API}/gallery")
    assert r.status_code == 401


# ---------------- Gallery content semantics ----------------
class TestGalleryContent:
    def test_empty_gallery_initially(self, http, paired):
        # For a fresh pair, gallery is empty
        r = http.get(f"{API}/gallery", headers=paired["ha"])
        assert r.status_code == 200
        assert r.json()["items"] == []

    def test_text_and_system_excluded_media_included_newest_first(self, http, paired):
        # 1) Text message (must NOT appear)
        http.post(f"{API}/messages", headers=paired["ha"], json={
            "nonce": "n_txt", "ciphertext": "ct_txt", "kind": "text",
        }).raise_for_status()

        # 2) System (screenshot alert) message — must NOT appear in gallery
        sys_r = http.post(f"{API}/messages", headers=paired["ha"], json={
            "nonce": "n_sys", "ciphertext": "ct_sys", "kind": "system",
        })
        assert sys_r.status_code == 200
        sys_msg = sys_r.json()["message"]
        assert sys_msg["kind"] == "system"
        assert sys_msg["media_id"] is None
        assert "_id" not in sys_msg

        # 3) Two media messages — should both appear, newest first
        m1_payload = os.urandom(64)
        up1 = http.post(f"{API}/media/upload", headers=paired["ha"], json={
            "data_b64": base64.b64encode(m1_payload).decode(),
            "mime": "image/jpeg", "kind": "image",
        }).json()
        msg1 = http.post(f"{API}/messages", headers=paired["ha"], json={
            "nonce": "n_m1", "ciphertext": "ct_m1", "kind": "image",
            "media_id": up1["media_id"], "media_nonce": "mn1",
            "media_mime": "image/jpeg", "view_once": False, "allow_save": True,
        }).json()["message"]

        m2_payload = os.urandom(64)
        up2 = http.post(f"{API}/media/upload", headers=paired["hb"], json={
            "data_b64": base64.b64encode(m2_payload).decode(),
            "mime": "video/mp4", "kind": "video",
        }).json()
        msg2 = http.post(f"{API}/messages", headers=paired["hb"], json={
            "nonce": "n_m2", "ciphertext": "ct_m2", "kind": "video",
            "media_id": up2["media_id"], "media_nonce": "mn2",
            "media_mime": "video/mp4", "view_once": True, "allow_save": False,
        }).json()["message"]

        # Query gallery from both sides
        for h in (paired["ha"], paired["hb"]):
            r = http.get(f"{API}/gallery", headers=h)
            assert r.status_code == 200
            items = r.json()["items"]
            ids = [it["id"] for it in items]
            # All returned items MUST have a media_id
            for it in items:
                assert it.get("media_id"), f"Gallery item missing media_id: {it}"
                assert it.get("kind") in ("image", "video"), f"unexpected kind {it.get('kind')}"
                assert "_id" not in it
            assert msg1["id"] in ids
            assert msg2["id"] in ids
            # newest first: msg2 (posted last) should come before msg1
            assert ids.index(msg2["id"]) < ids.index(msg1["id"])
            # text + system messages must be absent
            assert sys_msg["id"] not in ids

        # Flags preserved
        r = http.get(f"{API}/gallery", headers=paired["ha"]).json()["items"]
        by_id = {it["id"]: it for it in r}
        assert by_id[msg2["id"]]["view_once"] is True
        assert by_id[msg2["id"]]["allow_save"] is False
        assert by_id[msg1["id"]]["view_once"] is False
        assert by_id[msg1["id"]]["allow_save"] is True


# ---------------- Media regression ----------------
class TestMediaRegression:
    def test_upload_download_byte_exact(self, http, paired):
        payload = os.urandom(512)
        up = http.post(f"{API}/media/upload", headers=paired["ha"], json={
            "data_b64": base64.b64encode(payload).decode(),
            "mime": "image/png", "kind": "image",
        })
        assert up.status_code == 200
        mid = up.json()["media_id"]
        dl = http.get(f"{API}/media/{mid}", headers=paired["hb"])
        assert dl.status_code == 200
        assert dl.content == payload

    def test_view_once_consumed_410(self, http, paired):
        payload = os.urandom(128)
        up = http.post(f"{API}/media/upload", headers=paired["ha"], json={
            "data_b64": base64.b64encode(payload).decode(),
            "mime": "image/png", "kind": "image",
        }).json()
        msg = http.post(f"{API}/messages", headers=paired["ha"], json={
            "nonce": "vn", "ciphertext": "vc", "kind": "image",
            "media_id": up["media_id"], "media_nonce": "mn",
            "media_mime": "image/png", "view_once": True, "allow_save": False,
        }).json()["message"]
        # B fetches, marks viewed
        assert http.get(f"{API}/media/{up['media_id']}", headers=paired["hb"]).status_code == 200
        assert http.post(f"{API}/messages/{msg['id']}/viewed", headers=paired["hb"]).status_code == 200
        # Now consumed -> 410
        assert http.get(f"{API}/media/{up['media_id']}", headers=paired["hb"]).status_code == 410


# ---------------- General regression ----------------
class TestRegression:
    def test_messages_list_includes_system(self, http, paired):
        # Sanity: kind='system' is accepted, stored ciphertext-only, and returned by /messages.
        r = http.post(f"{API}/messages", headers=paired["ha"], json={
            "nonce": "sn", "ciphertext": "sc", "kind": "system",
        })
        assert r.status_code == 200
        sm = r.json()["message"]
        assert sm["kind"] == "system"
        assert sm["media_id"] is None
        listing = http.get(f"{API}/messages", headers=paired["hb"]).json()["messages"]
        assert any(m["id"] == sm["id"] and m["kind"] == "system" for m in listing)
        # And it should NOT be in gallery
        gallery = http.get(f"{API}/gallery", headers=paired["hb"]).json()["items"]
        assert not any(it["id"] == sm["id"] for it in gallery)

    def test_worries_crud(self, http, paired):
        w = http.post(f"{API}/worries", headers=paired["ha"], json={
            "nonce": "wn", "ciphertext": "wc",
        }).json()["worry"]
        assert w["resolved"] is False
        assert "_id" not in w
        lst = http.get(f"{API}/worries", headers=paired["hb"]).json()["worries"]
        assert any(x["id"] == w["id"] for x in lst)
        res = http.patch(f"{API}/worries/{w['id']}", headers=paired["hb"]).json()["worry"]
        assert res["resolved"] is True

    def test_events_crud(self, http, paired):
        ev = http.post(f"{API}/events", headers=paired["ha"], json={
            "title": "TEST_r3 date night", "date": "2026-02-14",
            "shared": True, "note": "sushi",
        }).json()["event"]
        assert ev["title"] == "TEST_r3 date night"
        assert "_id" not in ev
        got = http.get(f"{API}/events", headers=paired["hb"]).json()["events"]
        assert any(e["id"] == ev["id"] for e in got)
        d = http.delete(f"{API}/events/{ev['id']}", headers=paired["ha"])
        assert d.status_code == 200

    def test_checkin_still_works(self, http, paired):
        r = http.post(f"{API}/checkins", headers=paired["ha"], json={
            "date": "2026-01-20", "mood": "loved", "nonce": "n", "ciphertext": "c",
        })
        assert r.status_code == 200
        assert r.json()["checkin"]["mood"] == "loved"

    def test_pair_status(self, http, paired):
        p = http.get(f"{API}/pair", headers=paired["ha"]).json()
        assert p["status"] == "active"
        assert p["partner"]["id"] == paired["b_id"]

    def test_auth_login(self, http):
        email = _email("TEST_r3_login")
        http.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "L", "public_key": _key(),
        })
        r = http.post(f"{API}/auth/login", json={"email": email, "password": "secret123"})
        assert r.status_code == 200
        assert "access_token" in r.json()
        # wrong password
        assert http.post(f"{API}/auth/login", json={"email": email, "password": "nope"}).status_code == 401
