import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import util from "tweetnacl-util";
import { api } from "@/src/lib/api";
import { encryptBytes, decryptBytes } from "@/src/lib/crypto";

const BASE = (process.env.EXPO_PUBLIC_BACKEND_URL || "") + "/api";
const MAX_BYTES = 20 * 1024 * 1024; // 20MB cap

export type PickResult =
  | { ok: true; uri: string; mime: string; kind: "image" | "video" }
  | { ok: false; reason: "canceled" | "permission" | "toobig" };

export async function pickMedia(kind: "image" | "video"): Promise<PickResult> {
  const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
  let status = perm.status;
  let canAskAgain = perm.canAskAgain;
  if (status !== "granted") {
    const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
    status = req.status;
    canAskAgain = req.canAskAgain;
  }
  if (status !== "granted") return { ok: false, reason: "permission" };

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kind === "video" ? ["videos"] : ["images"],
    quality: 0.7,
    videoMaxDuration: 60,
  });
  if (result.canceled || !result.assets?.length) return { ok: false, reason: "canceled" };
  const a = result.assets[0];
  const mime = a.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg");
  return { ok: true, uri: a.uri, mime, kind };
}

async function readBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === "web") {
    const buf = await (await fetch(uri)).arrayBuffer();
    return new Uint8Array(buf);
  }
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any });
  return util.decodeBase64(b64);
}

export async function encryptAndUpload(
  uri: string,
  mime: string,
  kind: string,
  partnerPub: string,
): Promise<{ media_id: string; media_nonce: string; media_mime: string }> {
  const bytes = await readBytes(uri);
  if (bytes.length > MAX_BYTES) throw new Error("File too large (max 20MB).");
  const { nonce, cipher } = await encryptBytes(bytes, partnerPub);
  const data_b64 = util.encodeBase64(cipher);
  const res = await api.uploadMedia(data_b64, mime, kind);
  return { media_id: res.media_id, media_nonce: nonce, media_mime: mime };
}

async function fetchCipherBytes(mediaId: string): Promise<Uint8Array> {
  const token = await api.getToken();
  console.log(`[Media] Fetching media ${mediaId} with token: ${token ? "present" : "MISSING"}`);
  
  if (!token) {
    throw new Error("No authentication token. Please log in again.");
  }

  const url = `${BASE}/media/${mediaId}`;
  console.log(`[Media] Download URL: ${url}`);
  
  if (Platform.OS === "web") {
    console.log(`[Media] Using web fetch`);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    console.log(`[Media] Web fetch response status: ${r.status}`);
    if (r.status === 410) throw new Error("consumed");
    if (!r.ok) throw new Error(`Failed to load media: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  
  // Native: fetch binary via a file download (RN fetch().arrayBuffer() is unreliable).
  const tmp = `${FileSystem.cacheDirectory}dl_${mediaId}.bin`;
  console.log(`[Media] Native download to: ${tmp}`);
  
  try {
    const res = await FileSystem.downloadAsync(url, tmp, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[Media] Native download response status: ${res.status}`);
    
    if (res.status === 410) throw new Error("consumed");
    if (res.status >= 400) throw new Error(`Failed to load media: HTTP ${res.status}`);
    
    const b64 = await FileSystem.readAsStringAsync(res.uri, { encoding: "base64" as any });
    console.log(`[Media] Downloaded and decoded ${b64.length} base64 chars`);
    return util.decodeBase64(b64);
  } catch (e: any) {
    console.error(`[Media] Download error:`, e);
    throw e;
  }
}

export async function fetchAndDecryptMedia(
  mediaId: string,
  mediaNonce: string,
  mime: string,
  partnerPub: string,
): Promise<string> {
  console.log(`[Media] fetchAndDecryptMedia start: ${mediaId}`);
  try {
    const cipher = await fetchCipherBytes(mediaId);
    console.log(`[Media] Got cipher bytes: ${cipher.length} bytes`);
    
    const plain = await decryptBytes(cipher, mediaNonce, partnerPub);
    console.log(`[Media] Decrypted: ${plain ? plain.length + " bytes" : "null"}`);
    
    if (!plain) throw new Error("Unable to decrypt");
    
    const dataUri = `data:${mime};base64,${util.encodeBase64(plain)}`;
    console.log(`[Media] Created data URI: ${dataUri.slice(0, 50)}...`);
    return dataUri;
  } catch (e: any) {
    console.error(`[Media] fetchAndDecryptMedia error:`, e);
    throw e;
  }
}

// Returns a playable file/blob URI (for expo-video) by decrypting to a local file (native) or blob (web).
export async function decryptToPlayableUri(
  mediaId: string,
  mediaNonce: string,
  mime: string,
  partnerPub: string,
): Promise<string> {
  console.log(`[Media] decryptToPlayableUri start: ${mediaId}`);
  try {
    const cipher = await fetchCipherBytes(mediaId);
    console.log(`[Media] Got cipher for playable: ${cipher.length} bytes`);
    
    const plain = await decryptBytes(cipher, mediaNonce, partnerPub);
    console.log(`[Media] Decrypted for playable: ${plain ? plain.length + " bytes" : "null"}`);
    
    if (!plain) throw new Error("Unable to decrypt");
    
    if (Platform.OS === "web") {
      const blob = new Blob([plain], { type: mime });
      const uri = URL.createObjectURL(blob);
      console.log(`[Media] Created blob URI for web`);
      return uri;
    }
    
    const ext = mime.includes("mp4") ? "mp4" : mime.split("/")[1] || "mp4";
    const path = `${FileSystem.cacheDirectory}tw_${mediaId}.${ext}`;
    console.log(`[Media] Writing playable to: ${path}`);
    
    await FileSystem.writeAsStringAsync(path, util.encodeBase64(plain), { encoding: "base64" as any });
    console.log(`[Media] Wrote playable file successfully`);
    return path;
  } catch (e: any) {
    console.error(`[Media] decryptToPlayableUri error:`, e);
    throw e;
  }
}
