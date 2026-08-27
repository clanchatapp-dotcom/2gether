"""Round 8 — Deterministic keypair / reinstall survival regression.

The crypto derivation happens client-side; this test only exercises the
backend guarantees the flow depends on:
  - register/login return the same user.public_key when the client uploads
    the same base64 key
  - PUT /me/public-key persists a new key
  - after a "reinstall" (same email+password re-derives the SAME key),
    the /me public_key MUST still match what was originally uploaded
"""
import os
import time
import uuid
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://clanchat-mobile-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _mk_email(tag: str) -> str:
    return f"TEST_det_{tag}_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}@twogether-test.com"


class TestDeterministicKeyBackendContract:
    def test_public_key_persists_across_login(self):
        # deterministic public key the client would derive from (email,password)
        det_pk = "DET_PK_" + uuid.uuid4().hex[:32]
        email = _mk_email("persist")
        pw = "secret123"

        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": pw, "display_name": "A", "public_key": det_pk,
        })
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["user"]["public_key"] == det_pk
        original_user_id = j["user"]["id"]

        # login again -> same public_key returned (server-stored value)
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
        assert r2.status_code == 200, r2.text
        j2 = r2.json()
        assert j2["user"]["id"] == original_user_id
        assert j2["user"]["public_key"] == det_pk, "public_key drifted on server between register and login"

    def test_reinstall_same_pk_no_op_update(self):
        """Client re-derives the SAME key after reinstall and calls PUT /me/public-key.
        Server should accept the (unchanged) key and return the same value."""
        det_pk = "DET_PK_" + uuid.uuid4().hex[:32]
        email = _mk_email("reinstall")
        pw = "secret123"

        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": pw, "display_name": "A", "public_key": det_pk,
        })
        assert r.status_code == 200
        token = r.json()["access_token"]

        # simulate reinstall: client re-derives => same det_pk => PUT with same key
        h = {"Authorization": f"Bearer {token}"}
        r2 = requests.put(f"{API}/me/public-key", json={"public_key": det_pk}, headers=h)
        assert r2.status_code == 200
        assert r2.json()["user"]["public_key"] == det_pk

        # /me still shows the same key
        r3 = requests.get(f"{API}/me", headers=h)
        assert r3.status_code == 200
        assert r3.json()["user"]["public_key"] == det_pk

    def test_full_pair_send_decrypt_roundtrip_survives_pk_reupload(self):
        """Register A+B, pair them, A sends a message, then simulate A's
        reinstall by re-uploading the SAME public_key. Message row is unchanged,
        partner's view of A.public_key is unchanged -> B can still decrypt."""
        det_a = "DET_A_" + uuid.uuid4().hex[:32]
        det_b = "DET_B_" + uuid.uuid4().hex[:32]
        email_a = _mk_email("A")
        email_b = _mk_email("B")
        pw = "secret123"

        ra = requests.post(f"{API}/auth/register", json={
            "email": email_a, "password": pw, "display_name": "A", "public_key": det_a})
        rb = requests.post(f"{API}/auth/register", json={
            "email": email_b, "password": pw, "display_name": "B", "public_key": det_b})
        assert ra.status_code == 200 and rb.status_code == 200
        ta, tb = ra.json()["access_token"], rb.json()["access_token"]
        ha, hb = {"Authorization": f"Bearer {ta}"}, {"Authorization": f"Bearer {tb}"}

        r = requests.post(f"{API}/pair/create", headers=ha)
        assert r.status_code == 200
        code = r.json()["code"]
        r = requests.post(f"{API}/pair/redeem", json={"code": code}, headers=hb)
        assert r.status_code == 200

        # B fetches pair -> partner.public_key should be A's det_a
        rp = requests.get(f"{API}/pair", headers=hb).json()
        assert rp["partner"]["public_key"] == det_a

        # A sends a message (opaque nonce/ct — server just stores them)
        msg = requests.post(f"{API}/messages", json={
            "nonce": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "ciphertext": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "kind": "text",
        }, headers=ha)
        assert msg.status_code == 200
        mid = msg.json()["message"]["id"]

        # simulate reinstall: A re-derives SAME key, PUTs it
        r = requests.put(f"{API}/me/public-key", json={"public_key": det_a}, headers=ha)
        assert r.status_code == 200
        assert r.json()["user"]["public_key"] == det_a

        # B re-fetches pair -> partner.public_key STILL == det_a
        rp2 = requests.get(f"{API}/pair", headers=hb).json()
        assert rp2["partner"]["public_key"] == det_a, "A's public_key changed after reinstall — decryption would break"

        # message row is unchanged
        ml = requests.get(f"{API}/messages", headers=hb).json()["messages"]
        row = [m for m in ml if m["id"] == mid][0]
        assert row["nonce"] == "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        assert row["ciphertext"] == "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

    def test_wrong_password_401(self):
        email = _mk_email("wrongpw")
        det_pk = "DET_" + uuid.uuid4().hex[:32]
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "secret123", "display_name": "A", "public_key": det_pk})
        assert r.status_code == 200
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": "WRONG"})
        assert r2.status_code == 401
