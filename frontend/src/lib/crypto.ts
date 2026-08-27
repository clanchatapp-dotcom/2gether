// End-to-end encryption using NaCl box (Curve25519 + XSalsa20-Poly1305).
// The device secret key NEVER leaves the phone (stored in secure keychain).
// Only the public key is uploaded to the server. Because NaCl box uses a
// shared DH key, both partners encrypt & decrypt with (partnerPublicKey, mySecretKey).
import nacl from "tweetnacl";
import util from "tweetnacl-util";
import * as Crypto from "expo-crypto";
import { storage } from "@/src/utils/storage";

// tweetnacl needs a synchronous CSPRNG; expo-crypto provides it.
nacl.setPRNG((x: Uint8Array, n: number) => {
  const bytes = Crypto.getRandomBytes(n);
  for (let i = 0; i < n; i++) x[i] = bytes[i];
});

const SECRET_KEY = "tw_secret_key_v1";

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}

// Derive a stable 32-byte NaCl box secret key from the user's password + a
// per-user salt (their email). Deterministic across devices/reinstalls: the
// same password+email always yields the same keypair, so a reinstalled or new
// device regenerates the SAME key and can still decrypt existing messages.
// Uses an iterated SHA-512 (tweetnacl.hash) as a lightweight KDF.
function deriveSecretKey(password: string, salt: string): Uint8Array {
  const pw = util.decodeUTF8(password);
  const saltBytes = util.decodeUTF8(`twogether-kdf-v1:${salt.trim().toLowerCase()}`);
  let h = nacl.hash(concat(saltBytes, pw)); // 64 bytes
  for (let i = 0; i < 20000; i++) h = nacl.hash(concat(h, pw));
  return h.slice(0, 32);
}

// Derive the keypair from password+email, persist the secret locally, and
// return the public key (uploaded to the server). Call on register and login.
export async function deriveAndStoreKeypair(password: string, email: string): Promise<string> {
  const secret = deriveSecretKey(password, email);
  const kp = nacl.box.keyPair.fromSecretKey(secret);
  await storage.secureSet(SECRET_KEY, util.encodeBase64(kp.secretKey));
  return util.encodeBase64(kp.publicKey);
}

// Read-only: public key for the secret already on this device (or null).
// Used at boot (no password available) to keep the server key in sync.
export async function getExistingPublicKey(): Promise<string | null> {
  const b64 = await storage.secureGet(SECRET_KEY, "");
  if (!b64) return null;
  const kp = nacl.box.keyPair.fromSecretKey(util.decodeBase64(b64 as string));
  return util.encodeBase64(kp.publicKey);
}

export async function ensureKeypair(): Promise<string> {
  const existing = await storage.secureGet(SECRET_KEY, "");
  if (existing) {
    const kp = nacl.box.keyPair.fromSecretKey(util.decodeBase64(existing as string));
    return util.encodeBase64(kp.publicKey);
  }
  const kp = nacl.box.keyPair();
  await storage.secureSet(SECRET_KEY, util.encodeBase64(kp.secretKey));
  return util.encodeBase64(kp.publicKey);
}

async function getSecret(): Promise<Uint8Array | null> {
  const b64 = await storage.secureGet(SECRET_KEY, "");
  if (!b64) return null;
  return util.decodeBase64(b64 as string);
}

export async function encryptMessage(
  plaintext: string,
  partnerPublicKey: string,
): Promise<{ nonce: string; ciphertext: string }> {
  const secret = await getSecret();
  if (!secret) throw new Error("Missing encryption key");
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(
    util.decodeUTF8(plaintext),
    nonce,
    util.decodeBase64(partnerPublicKey),
    secret,
  );
  return { nonce: util.encodeBase64(nonce), ciphertext: util.encodeBase64(box) };
}

export async function decryptMessage(
  ciphertext: string,
  nonce: string,
  partnerPublicKey: string,
): Promise<string | null> {
  const secret = await getSecret();
  if (!secret) return null;
  try {
    const open = nacl.box.open(
      util.decodeBase64(ciphertext),
      util.decodeBase64(nonce),
      util.decodeBase64(partnerPublicKey),
      secret,
    );
    if (!open) return null;
    return util.encodeUTF8(open);
  } catch {
    return null;
  }
}

// Binary (media) E2E encryption — same shared-key model as messages.
export async function encryptBytes(
  bytes: Uint8Array,
  partnerPublicKey: string,
): Promise<{ nonce: string; cipher: Uint8Array }> {
  const secret = await getSecret();
  if (!secret) throw new Error("Missing encryption key");
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const cipher = nacl.box(bytes, nonce, util.decodeBase64(partnerPublicKey), secret);
  return { nonce: util.encodeBase64(nonce), cipher };
}

export async function decryptBytes(
  cipher: Uint8Array,
  nonce: string,
  partnerPublicKey: string,
): Promise<Uint8Array | null> {
  const secret = await getSecret();
  if (!secret) return null;
  try {
    return nacl.box.open(cipher, util.decodeBase64(nonce), util.decodeBase64(partnerPublicKey), secret);
  } catch {
    return null;
  }
}
