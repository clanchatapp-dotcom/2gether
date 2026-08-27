"""
Round 9 — Encryption disabled (pass-through) validation.
Backend still stores nonce/ciphertext but now they carry PLAINTEXT.
Also validates media view-once, auto-expire, gallery, worries, check-ins.
"""
import os
import uuid
import base64
import time
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _email(prefix="TEST_r9"):
    return f"{prefix}_{uuid.uuid4().hex[:10]}@twogether-test.com"


# 1x1 red PNG bytes (plain, no encryption)
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
)


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def pair(api):
    a_email = _email("TEST_r9_A")
    b_email = _email("TEST_r9_B")
    a = api.post(f"{API}/auth/register", json={
        "email": a_email, "password": "secret123",
        "display_name": "R9_A", "public_key": "e2e-off",
    })
    b = api.post(f"{API}/auth/register", json={
        "email": b_email, "password": "secret123",
        "display_name": "R9_B", "public_key": "e2e-off",
    })
    assert a.status_code == 200, a.text
    assert b.status_code == 200, b.text
    aj, bj = a.json(), b.json()
    ha = {"Authorization": f"Bearer {aj['access_token']}"}
    hb = {"Authorization": f"Bearer {bj['access_token']}"}
    code = api.post(f"{API}/pair/create", headers=ha).json()["code"]
    r = api.post(f"{API}/pair/redeem", headers=hb, json={"code": code})
    assert r.status_code == 200
    return {"ha": ha, "hb": hb, "a_id": aj["user"]["id"], "b_id": bj["user"]["id"],
            "a_email": a_email, "b_email": b_email}


# ------------------ Text messaging (plaintext round-trip) ------------------
class TestPlaintextMessaging:
    def test_send_receives_plaintext_both_sides(self, api, pair):
        # A sends
        payloads = ["hello from A #1", "second line from A 😀", "third: with punctuation!"]
        sent_ids = []
        for p in payloads:
            r = api.post(f"{API}/messages", headers=pair["ha"],
                         json={"nonce": "", "ciphertext": p, "kind": "text"})
            assert r.status_code == 200, r.text
            m = r.json()["message"]
            assert m["ciphertext"] == p
            assert m["nonce"] == ""
            sent_ids.append(m["id"])

        # B lists — sees exact plaintext
        lst = api.get(f"{API}/messages", headers=pair["hb"]).json()["messages"]
        by_id = {m["id"]: m for m in lst}
        for mid, p in zip(sent_ids, payloads):
            assert mid in by_id
            assert by_id[mid]["ciphertext"] == p, "ciphertext field should carry plaintext now"

        # B sends
        r = api.post(f"{API}/messages", headers=pair["hb"],
                     json={"nonce": "", "ciphertext": "reply from B", "kind": "text"})
        assert r.status_code == 200
        assert r.json()["message"]["ciphertext"] == "reply from B"

    def test_history_persistence_after_relogin(self, api, pair):
        # Re-login as A and re-check history
        r = api.post(f"{API}/auth/login",
                     json={"email": pair["a_email"], "password": "secret123"})
        assert r.status_code == 200
        tok = r.json()["access_token"]
        lst = api.get(f"{API}/messages",
                      headers={"Authorization": f"Bearer {tok}"}).json()["messages"]
        texts = [m["ciphertext"] for m in lst]
        # earlier plaintext still visible as-is
        assert "hello from A #1" in texts
        assert "reply from B" in texts


# ------------------ Media upload + view (no encryption) ------------------
class TestMediaPlain:
    def test_upload_download_image_bytes_identical(self, api, pair):
        data_b64 = base64.b64encode(PNG_BYTES).decode()
        r = api.post(f"{API}/media/upload", headers=pair["ha"],
                     json={"data_b64": data_b64, "mime": "image/png", "kind": "image"})
        assert r.status_code == 200, r.text
        media_id = r.json()["media_id"]

        # A sends media message (view-once OFF)
        msg = api.post(f"{API}/messages", headers=pair["ha"], json={
            "nonce": "", "ciphertext": "", "kind": "image",
            "media_id": media_id, "media_nonce": "", "media_mime": "image/png",
            "view_once": False, "allow_save": True,
        })
        assert msg.status_code == 200

        # B fetches raw bytes
        rr = requests.get(f"{API}/media/{media_id}",
                          headers=pair["hb"])
        assert rr.status_code == 200
        assert rr.content == PNG_BYTES, "Media must be stored/served as plain bytes"

        # A can also re-fetch own media (view_once=False)
        r2 = requests.get(f"{API}/media/{media_id}", headers=pair["ha"])
        assert r2.status_code == 200


class TestViewOnce:
    def test_view_once_consumed_after_recipient_opens(self, api, pair):
        data_b64 = base64.b64encode(PNG_BYTES).decode()
        media_id = api.post(f"{API}/media/upload", headers=pair["ha"],
                            json={"data_b64": data_b64, "mime": "image/png",
                                  "kind": "image"}).json()["media_id"]
        msg = api.post(f"{API}/messages", headers=pair["ha"], json={
            "nonce": "", "ciphertext": "", "kind": "image",
            "media_id": media_id, "media_nonce": "", "media_mime": "image/png",
            "view_once": True, "allow_save": False,
        }).json()["message"]

        # B opens (mark viewed → server consumes it)
        mv = api.post(f"{API}/messages/{msg['id']}/viewed", headers=pair["hb"])
        assert mv.status_code == 200
        # Now fetching media should return 410
        rr = requests.get(f"{API}/media/{media_id}", headers=pair["hb"])
        assert rr.status_code == 410, f"expected 410 after view-once, got {rr.status_code}"


class TestAutoExpire:
    def test_expiry_starts_on_first_recipient_open(self, api, pair):
        data_b64 = base64.b64encode(PNG_BYTES).decode()
        media_id = api.post(f"{API}/media/upload", headers=pair["ha"],
                            json={"data_b64": data_b64, "mime": "image/png",
                                  "kind": "image"}).json()["media_id"]
        msg = api.post(f"{API}/messages", headers=pair["ha"], json={
            "nonce": "", "ciphertext": "", "kind": "image",
            "media_id": media_id, "media_nonce": "", "media_mime": "image/png",
            "view_once": False, "allow_save": True, "expire_seconds": 3,
        }).json()["message"]
        assert msg["expire_seconds"] == 3
        assert msg["expires_at"] is None

        # B opens for the first time → expires_at should be set
        rr = requests.get(f"{API}/media/{media_id}", headers=pair["hb"])
        assert rr.status_code == 200

        # Poll messages to see expires_at set
        lst = api.get(f"{API}/messages", headers=pair["hb"]).json()["messages"]
        target = next(m for m in lst if m["id"] == msg["id"])
        assert target["expires_at"] is not None, "expires_at should be set after first open"

        # After the TTL passes, media should be 410
        time.sleep(4)
        rr2 = requests.get(f"{API}/media/{media_id}", headers=pair["hb"])
        assert rr2.status_code == 410


class TestGallery:
    def test_gallery_lists_shared_media(self, api, pair):
        # Add a fresh non-expiring media
        data_b64 = base64.b64encode(PNG_BYTES).decode()
        media_id = api.post(f"{API}/media/upload", headers=pair["ha"],
                            json={"data_b64": data_b64, "mime": "image/png",
                                  "kind": "image"}).json()["media_id"]
        api.post(f"{API}/messages", headers=pair["ha"], json={
            "nonce": "", "ciphertext": "", "kind": "image",
            "media_id": media_id, "media_nonce": "", "media_mime": "image/png",
            "view_once": False, "allow_save": True,
        })
        r = api.get(f"{API}/gallery", headers=pair["hb"])
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(it.get("media_id") == media_id for it in items)


# ------------------ Worries plaintext ------------------
class TestWorriesPlain:
    def test_add_and_read_plaintext(self, api, pair):
        r = api.post(f"{API}/worries", headers=pair["ha"],
                     json={"nonce": "", "ciphertext": "I'm worried about the trip"})
        assert r.status_code == 200
        w = r.json()["worry"]
        assert w["ciphertext"] == "I'm worried about the trip"
        # B reads
        lst = api.get(f"{API}/worries", headers=pair["hb"]).json()["worries"]
        assert any(x["id"] == w["id"] and x["ciphertext"] == "I'm worried about the trip"
                   for x in lst)


# ------------------ Check-ins plaintext note ------------------
class TestCheckinsPlain:
    def test_checkin_note_plaintext(self, api, pair):
        today = "2026-01-05"
        r = api.post(f"{API}/checkins", headers=pair["ha"], json={
            "date": today, "mood": "😊", "nonce": "", "ciphertext": "feeling good today",
        })
        assert r.status_code == 200
        doc = r.json()["checkin"]
        assert doc["mood"] == "😊"
        assert doc["ciphertext"] == "feeling good today"
        # B lists
        lst = api.get(f"{API}/checkins", headers=pair["hb"]).json()["checkins"]
        assert any(c["id"] == doc["id"] and c["ciphertext"] == "feeling good today"
                   for c in lst)


# ------------------ Regression ------------------
class TestRegression:
    def test_wrong_password_401(self, api, pair):
        r = api.post(f"{API}/auth/login",
                     json={"email": pair["a_email"], "password": "WRONG"})
        assert r.status_code == 401

    def test_register_login_pair_still_work(self, api):
        e1, e2 = _email("TEST_r9_reg1"), _email("TEST_r9_reg2")
        r1 = api.post(f"{API}/auth/register", json={
            "email": e1, "password": "secret123",
            "display_name": "reg1", "public_key": "e2e-off",
        })
        r2 = api.post(f"{API}/auth/register", json={
            "email": e2, "password": "secret123",
            "display_name": "reg2", "public_key": "e2e-off",
        })
        assert r1.status_code == 200 and r2.status_code == 200
        h1 = {"Authorization": f"Bearer {r1.json()['access_token']}"}
        h2 = {"Authorization": f"Bearer {r2.json()['access_token']}"}
        code = api.post(f"{API}/pair/create", headers=h1).json()["code"]
        r = api.post(f"{API}/pair/redeem", headers=h2, json={"code": code})
        assert r.status_code == 200
        assert r.json()["status"] == "active"
