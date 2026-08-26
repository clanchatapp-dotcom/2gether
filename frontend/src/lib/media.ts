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
  const url = `${BASE}/media/${mediaId}`;
  if (Platform.OS === "web") {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 410) throw new Error("consumed");
    if (!r.ok) throw new Error("Failed to load media");
    return new Uint8Array(await r.arrayBuffer());
  }
  // Native: fetch binary via a file download (RN fetch().arrayBuffer() is unreliable).
  const tmp = `${FileSystem.cacheDirectory}dl_${mediaId}.bin`;
  const res = await FileSystem.downloadAsync(url, tmp, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 410) throw new Error("consumed");
  if (res.status >= 400) throw new Error("Failed to load media");
  const b64 = await FileSystem.readAsStringAsync(res.uri, { encoding: "base64" as any });
  return util.decodeBase64(b64);
}

export async function fetchAndDecryptMedia(
  mediaId: string,
  mediaNonce: string,
  mime: string,
  partnerPub: string,
): Promise<string> {
  const cipher = await fetchCipherBytes(mediaId);
  const plain = await decryptBytes(cipher, mediaNonce, partnerPub);
  if (!plain) throw new Error("Unable to decrypt");
  return `data:${mime};base64,${util.encodeBase64(plain)}`;
}

// Returns a playable file/blob URI (for expo-video) by decrypting to a local file (native) or blob (web).
export async function decryptToPlayableUri(
  mediaId: string,
  mediaNonce: string,
  mime: string,
  partnerPub: string,
): Promise<string> {
  const cipher = await fetchCipherBytes(mediaId);
  const plain = await decryptBytes(cipher, mediaNonce, partnerPub);
  if (!plain) throw new Error("Unable to decrypt");
  if (Platform.OS === "web") {
    const blob = new Blob([plain], { type: mime });
    return URL.createObjectURL(blob);
  }
  const ext = mime.includes("mp4") ? "mp4" : mime.split("/")[1] || "mp4";
  const path = `${FileSystem.cacheDirectory}tw_${mediaId}.${ext}`;
  await FileSystem.writeAsStringAsync(path, util.encodeBase64(plain), { encoding: "base64" as any });
  return path;
}
