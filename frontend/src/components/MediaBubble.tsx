import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, Dimensions } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Haptics from "expo-haptics";
import { fetchAndDecryptMedia, decryptToPlayableUri } from "@/src/lib/media";
import { C, F, S, R, type } from "@/src/theme/theme";

const { width } = Dimensions.get("window");
const MEDIA_W = Math.min(width * 0.62, 260);

type Msg = {
  id: string;
  kind: string;
  media_id?: string;
  media_nonce?: string;
  media_mime?: string;
  view_once?: boolean;
  allow_save?: boolean;
  viewed?: boolean;
  sender_id: string;
};

export function MediaBubble({
  msg,
  mine,
  partnerPub,
  onViewed,
}: {
  msg: Msg;
  mine: boolean;
  partnerPub: string;
  onViewed: (id: string) => void;
}) {
  const isVideo = msg.kind === "video";
  const viewOnce = !!msg.view_once;
  const recipientViewOnce = viewOnce && !mine;

  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consumed, setConsumed] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);

  // Auto-load inline thumbnail for normal (non-view-once) images.
  useEffect(() => {
    let active = true;
    if (!msg.media_id || !msg.media_nonce || !partnerPub) return;
    if (isVideo || recipientViewOnce) return; // videos & recipient view-once load on demand
    setLoading(true);
    fetchAndDecryptMedia(msg.media_id, msg.media_nonce, msg.media_mime || "image/jpeg", partnerPub)
      .then((u) => active && setUri(u))
      .catch((e) => active && setError(e.message === "consumed" ? "Viewed" : "Couldn't load"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [msg.media_id, msg.media_nonce, partnerPub, isVideo, recipientViewOnce, msg.media_mime]);

  const openImageOnce = async () => {
    if (consumed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    setError(null);
    try {
      const u = await fetchAndDecryptMedia(msg.media_id!, msg.media_nonce!, msg.media_mime || "image/jpeg", partnerPub);
      setUri(u);
      setViewer(true);
      onViewed(msg.id);
      setConsumed(true);
    } catch (e: any) {
      setError(e.message === "consumed" ? "Viewed" : "Couldn't load");
    } finally {
      setLoading(false);
    }
  };

  const openVideo = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    setError(null);
    try {
      const u = await decryptToPlayableUri(msg.media_id!, msg.media_nonce!, msg.media_mime || "video/mp4", partnerPub);
      setVideoUri(u);
      setViewer(true);
      if (recipientViewOnce) {
        onViewed(msg.id);
        setConsumed(true);
      }
    } catch (e: any) {
      setError(e.message === "consumed" ? "Viewed" : "Couldn't load");
    } finally {
      setLoading(false);
    }
  };

  const bubbleBg = mine ? styles.mine : styles.theirs;

  // ---- View-once covered card (recipient) ----
  if (recipientViewOnce && !viewer) {
    return (
      <View style={[styles.card, bubbleBg]}>
        <Pressable
          testID={`media-viewonce-${msg.id}`}
          style={styles.coverBox}
          onPress={isVideo ? openVideo : openImageOnce}
          disabled={consumed}
        >
          {loading ? (
            <ActivityIndicator color={C.brandPrimary} />
          ) : consumed || error === "Viewed" ? (
            <>
              <Ionicons name="eye-off" size={22} color={C.muted} />
              <Text style={styles.coverText}>Opened</Text>
            </>
          ) : (
            <>
              <Ionicons name={isVideo ? "play-circle" : "eye"} size={26} color={C.brandPrimary} />
              <Text style={styles.coverText}>Tap to view once</Text>
            </>
          )}
        </Pressable>
        <View style={styles.metaRow}>
          <Ionicons name="flame" size={11} color={mine ? "rgba(255,255,255,0.85)" : C.warning} />
          <Text style={[styles.metaText, mine && { color: "rgba(255,255,255,0.85)" }]}>View once</Text>
        </View>
        {renderViewer()}
      </View>
    );
  }

  // ---- Video card ----
  if (isVideo) {
    return (
      <View style={[styles.card, bubbleBg]}>
        <Pressable style={styles.videoCard} onPress={openVideo} testID={`media-video-${msg.id}`}>
          {loading ? (
            <ActivityIndicator color={C.brandPrimary} />
          ) : (
            <>
              <Ionicons name="play-circle" size={40} color={C.brandPrimary} />
              <Text style={styles.videoText}>{error || "Encrypted video"}</Text>
            </>
          )}
        </Pressable>
        {viewOnce ? (
          <View style={styles.metaRow}>
            <Ionicons name="flame" size={11} color={mine ? "rgba(255,255,255,0.85)" : C.warning} />
            <Text style={[styles.metaText, mine && { color: "rgba(255,255,255,0.85)" }]}>View once</Text>
          </View>
        ) : null}
        {renderViewer()}
      </View>
    );
  }

  // ---- Inline image ----
  return (
    <View style={[styles.card, bubbleBg]}>
      <Pressable testID={`media-image-${msg.id}`} onPress={() => uri && setViewer(true)}>
        <View style={styles.imgWrap}>
          {loading ? (
            <ActivityIndicator color={C.brandPrimary} />
          ) : uri ? (
            <Image source={{ uri }} style={styles.img} contentFit="cover" />
          ) : (
            <View style={styles.imgFallback}>
              <Ionicons name="image-outline" size={22} color={C.muted} />
              <Text style={styles.coverText}>{error || "Loading"}</Text>
            </View>
          )}
        </View>
      </Pressable>
      {msg.allow_save === false ? (
        <View style={styles.metaRow}>
          <Ionicons name="lock-closed" size={11} color={mine ? "rgba(255,255,255,0.85)" : C.muted} />
          <Text style={[styles.metaText, mine && { color: "rgba(255,255,255,0.85)" }]}>Saving off</Text>
        </View>
      ) : null}
      {renderViewer()}
    </View>
  );

  function renderViewer() {
    return (
      <Modal visible={viewer} transparent animationType="fade" onRequestClose={() => setViewer(false)}>
        <View style={styles.viewerScrim}>
          <Pressable style={styles.viewerClose} onPress={() => setViewer(false)} testID="media-viewer-close">
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {videoUri ? (
            <VideoPlayerView uri={videoUri} />
          ) : uri ? (
            <Image source={{ uri }} style={styles.viewerImg} contentFit="contain" />
          ) : null}
          {viewOnce ? (
            <Text style={styles.viewerHint}>This can only be viewed once</Text>
          ) : null}
        </View>
      </Modal>
    );
  }
}

function VideoPlayerView({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={styles.viewerVideo} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  card: { borderRadius: R.lg, padding: 4, maxWidth: MEDIA_W + 8 },
  mine: { backgroundColor: C.brandPrimary },
  theirs: { backgroundColor: C.surfaceSecondary, borderWidth: 1, borderColor: C.border },
  imgWrap: { width: MEDIA_W, height: MEDIA_W, borderRadius: R.md, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: C.surfaceTertiary },
  img: { width: "100%", height: "100%" },
  imgFallback: { alignItems: "center", gap: S.xs },
  coverBox: { width: MEDIA_W, height: MEDIA_W * 0.7, borderRadius: R.md, alignItems: "center", justifyContent: "center", gap: S.sm, backgroundColor: C.surfaceTertiary },
  coverText: { fontFamily: F.medium, fontSize: type.base, color: C.onSurfaceSecondary },
  videoCard: { width: MEDIA_W, height: MEDIA_W * 0.62, borderRadius: R.md, alignItems: "center", justifyContent: "center", gap: S.xs, backgroundColor: C.surfaceTertiary },
  videoText: { fontFamily: F.medium, fontSize: type.sm, color: C.onSurfaceSecondary },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingTop: 4, paddingBottom: 2 },
  metaText: { fontFamily: F.medium, fontSize: 10, color: C.warning },
  viewerScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", alignItems: "center", justifyContent: "center" },
  viewerClose: { position: "absolute", top: 50, right: 20, zIndex: 2, padding: 8 },
  viewerImg: { width: "100%", height: "80%" },
  viewerVideo: { width: "100%", height: "70%" },
  viewerHint: { position: "absolute", bottom: 60, color: "#fff", fontFamily: F.medium, fontSize: type.base, opacity: 0.8 },
});
