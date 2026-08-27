// Encryption has been intentionally DISABLED for Twogether.
// Messages and media are stored/transferred as plain content. These functions
// are kept as thin pass-throughs so the rest of the app (chat, media, gallery,
// worries, mood, screenshot guard) keeps working unchanged. Screenshot
// blocking and the media view-once / disappearing / save-to-gallery features
// are unaffected — they don't depend on encryption.

const DISABLED_KEY = "e2e-off";

// Auth still records a non-empty "public_key" per user so existing partner
// guards (`if (partner?.public_key)`) stay truthy. It's no longer a real key.
export async function deriveAndStoreKeypair(_password: string, _email: string): Promise<string> {
  return DISABLED_KEY;
}

export async function getExistingPublicKey(): Promise<string | null> {
  return null;
}

export async function ensureKeypair(): Promise<string> {
  return DISABLED_KEY;
}

// Text: store the plaintext directly (no nonce, no ciphertext).
export async function encryptMessage(
  plaintext: string,
  _partnerPublicKey: string,
): Promise<{ nonce: string; ciphertext: string }> {
  return { nonce: "", ciphertext: plaintext };
}

export async function decryptMessage(
  ciphertext: string,
  _nonce: string,
  _partnerPublicKey: string,
): Promise<string | null> {
  return ciphertext ?? "";
}

// Media bytes: upload/return the raw bytes unchanged.
export async function encryptBytes(
  bytes: Uint8Array,
  _partnerPublicKey: string,
): Promise<{ nonce: string; cipher: Uint8Array }> {
  return { nonce: "", cipher: bytes };
}

export async function decryptBytes(
  cipher: Uint8Array,
  _nonce: string,
  _partnerPublicKey: string,
): Promise<Uint8Array | null> {
  return cipher;
}
