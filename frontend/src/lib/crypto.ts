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
