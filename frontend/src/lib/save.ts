import { Platform } from "react-native";
import * as MediaLibrary from "expo-media-library";
import { decryptToPlayableUri } from "@/src/lib/media";

export type SaveResult = { ok: true } | { ok: false; reason: "permission" | "web" | "error" };

// Decrypts the media to a local file and saves it to the phone's photo library.
export async function saveMediaToGallery(
  mediaId: string,
  mediaNonce: string,
  mime: string,
  partnerPub: string,
): Promise<SaveResult> {
  if (Platform.OS === "web") return { ok: false, reason: "web" };
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    let granted = perm.granted;
    if (!granted) {
      const req = await MediaLibrary.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return { ok: false, reason: "permission" };
    const fileUri = await decryptToPlayableUri(mediaId, mediaNonce, mime, partnerPub);
    await MediaLibrary.saveToLibraryAsync(fileUri);
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}
