"""
Twogether backend integration tests.
Covers: auth, /me, public-key update, pair create/redeem/get,
messages (E2E ciphertext), worries, events, and error cases.
"""
import os
import uuid
import base64
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://clanchat-mobile-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _rand_email(prefix="TEST_user"):
    # Avoid ".test" TLD which pydantic EmailStr rejects as reserved.
    return f"{prefix}_{uuid.uuid4().hex[:10]}@twogether-test.com"


def _rand_key():
    # 32 bytes of fake public key material, base64 encoded
    return base64.b64encode(os.urandom(32)).decode("utf-8")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def pair_users(api):
    """Register two users and pair them; return dict with tokens/ids/pair_id."""
    a_email = _rand_email("TEST_alice")
    b_email = _rand_email("TEST_bob")
    a = api.post(f"{API}/auth/register", json={
        "email": a_email, "password": "secret123",
        "display_name": "TEST Alice", "public_key": _rand_key(),
    })
    b = api.post(f"{API}/auth/register", json={
        "email": b_email, "password": "secret123",
        "display_name": "TEST Bob", "public_key": _rand_key(),
    })
    assert a.status_code == 200, a.text
    assert b.status_code == 200, b.text
    aj, bj = a.json(), b.json()

    ha = {"Authorization": f"Bearer {aj['access_token']}"}
    hb = {"Authorization": f"Bearer {bj['access_token']}"}

    # Create invite from A
    cr = api.post(f"{API}/pair/create", headers=ha)
    assert cr.status_code == 200, cr.text
    code = cr.json()["code"]
    # Redeem from B
    rr = api.post(f"{API}/pair/redeem", headers=hb, json={"code": code})
    assert rr.status_code == 200, rr.text
    return {
        "a_token": aj["access_token"], "b_token": bj["access_token"],
        "a_id": aj["user"]["id"], "b_id": bj["user"]["id"],
        "a_headers": ha, "b_headers": hb,
        "pair_id": rr.json()["pair_id"],
        "a_email": a_email, "b_email": b_email,
    }


# --------------------------- Health ---------------------------
class TestHealth:
    def test_root(self, api):
        r = api.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


# --------------------------- Auth ---------------------------
class TestAuth:
    def test_register_success(self, api):
        email = _rand_email()
        r = api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "TEST User", "public_key": _rand_key(),
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert "access_token" in body and body["access_token"]
        u = body["user"]
        assert u["email"] == email.lower()
        assert u["display_name"] == "TEST User"
        assert "password_hash" not in u
        assert "_id" not in u

    def test_register_duplicate_email_409(self, api):
        email = _rand_email()
        payload = {"email": email, "password": "secret123",
                   "display_name": "Dup", "public_key": _rand_key()}
        r1 = api.post(f"{API}/auth/register", json=payload)
        assert r1.status_code == 200
        r2 = api.post(f"{API}/auth/register", json=payload)
        assert r2.status_code == 409

    def test_login_success(self, api):
        email = _rand_email()
        api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "L", "public_key": _rand_key(),
        })
        r = api.post(f"{API}/auth/login", json={"email": email, "password": "secret123"})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_login_wrong_password_401(self, api):
        email = _rand_email()
        api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "L", "public_key": _rand_key(),
        })
        r = api.post(f"{API}/auth/login", json={"email": email, "password": "WRONG"})
        assert r.status_code == 401

    def test_me_requires_token(self, api):
        r = api.get(f"{API}/me")
        assert r.status_code == 401

    def test_me_with_token(self, api):
        email = _rand_email()
        rr = api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "Me", "public_key": _rand_key(),
        }).json()
        r = api.get(f"{API}/me", headers={"Authorization": f"Bearer {rr['access_token']}"})
        assert r.status_code == 200
        u = r.json()["user"]
        assert u["email"] == email.lower()
        assert "password_hash" not in u

    def test_update_public_key(self, api):
        email = _rand_email()
        rr = api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "K", "public_key": _rand_key(),
        }).json()
        new_key = _rand_key()
        r = api.put(f"{API}/me/public-key",
                    headers={"Authorization": f"Bearer {rr['access_token']}"},
                    json={"public_key": new_key})
        assert r.status_code == 200
        assert r.json()["user"]["public_key"] == new_key
        # verify via /me
        r2 = api.get(f"{API}/me", headers={"Authorization": f"Bearer {rr['access_token']}"})
        assert r2.json()["user"]["public_key"] == new_key


# --------------------------- Pairing ---------------------------
class TestPairing:
    def test_create_idempotent_pending(self, api):
        email = _rand_email()
        tok = api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "P", "public_key": _rand_key(),
        }).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        r1 = api.post(f"{API}/pair/create", headers=h)
        r2 = api.post(f"{API}/pair/create", headers=h)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["code"] == r2.json()["code"]
        assert r1.json()["status"] == "pending"

    def test_redeem_invalid_code_404(self, api):
        email = _rand_email()
        tok = api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "P", "public_key": _rand_key(),
        }).json()["access_token"]
        r = api.post(f"{API}/pair/redeem",
                     headers={"Authorization": f"Bearer {tok}"},
                     json={"code": "ZZZZZZ"})
        assert r.status_code == 404

    def test_redeem_self_pair_400(self, api):
        email = _rand_email()
        tok = api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "P", "public_key": _rand_key(),
        }).json()["access_token"]
        h = {"Authorization": f"Bearer {tok}"}
        code = api.post(f"{API}/pair/create", headers=h).json()["code"]
        r = api.post(f"{API}/pair/redeem", headers=h, json={"code": code})
        assert r.status_code == 400

    def test_pair_active_flow_and_get(self, api, pair_users):
        # GET /api/pair returns 'active' and partner info for both
        r = api.get(f"{API}/pair", headers=pair_users["a_headers"])
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "active"
        assert body["partner"]["id"] == pair_users["b_id"]
        assert body["partner"]["display_name"] == "TEST Bob"
        assert body["partner"]["public_key"]

    def test_redeem_when_already_active_400(self, api, pair_users):
        # Register C and create a pending code
        c_email = _rand_email("TEST_carol")
        tokc = api.post(f"{API}/auth/register", json={
            "email": c_email, "password": "secret123",
            "display_name": "TEST Carol", "public_key": _rand_key(),
        }).json()["access_token"]
        code = api.post(f"{API}/pair/create",
                        headers={"Authorization": f"Bearer {tokc}"}).json()["code"]
        # A tries to redeem while already active
        r = api.post(f"{API}/pair/redeem",
                     headers=pair_users["a_headers"], json={"code": code})
        assert r.status_code == 400


# --------------------------- Messages ---------------------------
class TestMessages:
    def test_messages_require_pair(self, api):
        email = _rand_email()
        tok = api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "M", "public_key": _rand_key(),
        }).json()["access_token"]
        r = api.get(f"{API}/messages", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 400
        assert "paired" in r.json()["detail"].lower()

    def test_send_and_list(self, api, pair_users):
        r = api.post(f"{API}/messages", headers=pair_users["a_headers"], json={
            "nonce": "n1", "ciphertext": "ct-hello", "kind": "text",
        })
        assert r.status_code == 200
        msg = r.json()["message"]
        assert msg["ciphertext"] == "ct-hello"
        assert "_id" not in msg
        # B lists
        lst = api.get(f"{API}/messages", headers=pair_users["b_headers"])
        assert lst.status_code == 200
        msgs = lst.json()["messages"]
        assert any(m["id"] == msg["id"] and m["ciphertext"] == "ct-hello" for m in msgs)
        # ensure only nonce/ciphertext plus meta; no plaintext field
        for m in msgs:
            assert "plaintext" not in m
            assert "_id" not in m

    def test_after_filter(self, api, pair_users):
        # Insert m1
        m1 = api.post(f"{API}/messages", headers=pair_users["a_headers"], json={
            "nonce": "n2", "ciphertext": "ct-1"
        }).json()["message"]
        # Insert m2
        import time
        time.sleep(1.1)
        m2 = api.post(f"{API}/messages", headers=pair_users["b_headers"], json={
            "nonce": "n3", "ciphertext": "ct-2"
        }).json()["message"]
        r = api.get(f"{API}/messages", headers=pair_users["a_headers"],
                    params={"after": m1["created_at"]})
        assert r.status_code == 200
        ids = [m["id"] for m in r.json()["messages"]]
        assert m2["id"] in ids
        assert m1["id"] not in ids


# --------------------------- Worries ---------------------------
class TestWorries:
    def test_worries_require_pair(self, api):
        email = _rand_email()
        tok = api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "W", "public_key": _rand_key(),
        }).json()["access_token"]
        r = api.get(f"{API}/worries", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 400

    def test_create_list_resolve(self, api, pair_users):
        r = api.post(f"{API}/worries", headers=pair_users["a_headers"],
                     json={"nonce": "wn1", "ciphertext": "wct1"})
        assert r.status_code == 200
        w = r.json()["worry"]
        assert w["resolved"] is False
        # list
        lst = api.get(f"{API}/worries", headers=pair_users["b_headers"]).json()["worries"]
        assert any(x["id"] == w["id"] for x in lst)
        # resolve
        rr = api.patch(f"{API}/worries/{w['id']}", headers=pair_users["b_headers"])
        assert rr.status_code == 200
        assert rr.json()["worry"]["resolved"] is True


# --------------------------- Events ---------------------------
class TestEvents:
    def test_events_require_pair(self, api):
        email = _rand_email()
        tok = api.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123",
            "display_name": "E", "public_key": _rand_key(),
        }).json()["access_token"]
        r = api.get(f"{API}/events", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 400

    def test_create_list_delete(self, api, pair_users):
        r = api.post(f"{API}/events", headers=pair_users["a_headers"], json={
            "title": "TEST Anniversary", "date": "2026-02-14", "note": "dinner",
        })
        assert r.status_code == 200
        e = r.json()["event"]
        assert e["title"] == "TEST Anniversary"
        # list
        lst = api.get(f"{API}/events", headers=pair_users["b_headers"]).json()["events"]
        assert any(x["id"] == e["id"] for x in lst)
        # delete
        d = api.delete(f"{API}/events/{e['id']}", headers=pair_users["a_headers"])
        assert d.status_code == 200
        # verify removed
        lst2 = api.get(f"{API}/events", headers=pair_users["a_headers"]).json()["events"]
        assert not any(x["id"] == e["id"] for x in lst2)
