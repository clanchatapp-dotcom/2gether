import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Modal,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/lib/api";
import { fetchAndDecryptMedia, decryptToPlayableUri } from "@/src/lib/media";
import { saveMediaToGallery } from "@/src/lib/save";
import { PrivacyGuard } from "@/src/components/PrivacyGuard";
import { C, F, S, R, type } from "@/src/theme/theme";

const { width } = Dimensions.get("window");
const GAP = 2;
const TILE = (width - GAP * 2) / 3;

type Item = {
  id: string;
  kind: string;
  media_id: string;
  media_nonce: string;
  media_mime?: string;
  view_once?: boolean;
  allow_save?: boolean;
  sender_id: string;
  created_at: string;
};

export default function Gallery() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { partner } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Item | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getGallery();
      setItems(res.items || []);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openable = (it: Item) => !it.view_once;

  return (
    <PrivacyGuard partnerPub={partner?.public_key} label="the gallery">
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + S.sm }]}>
          <Pressable testID="gallery-back" onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={C.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Shared Gallery</Text>
            <View style={styles.lockRow}>
              <Ionicons name="shield-checkmark" size={11} color={C.success} />
              <Text style={styles.lockText}>Private · screenshots blocked</Text>
            </View>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={C.brandPrimary} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center} testID="gallery-empty">
            <View style={styles.emptyIcon}>
              <Ionicons name="images-outline" size={30} color={C.brandPrimary} />
            </View>
            <Text style={styles.emptyTitle}>No shared media yet</Text>
            <Text style={styles.emptyText}>Photos and videos you send each other appear here.</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            numColumns={3}
            contentContainerStyle={{ padding: 0, paddingBottom: insets.bottom + S.xl }}
            columnWrapperStyle={{ gap: GAP }}
            ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
            renderItem={({ item }) => (
              <GalleryTile
                item={item}
                partnerPub={partner?.public_key || ""}
                onPress={() => {
                  if (openable(item)) {
                    Haptics.selectionAsync();
                    setActive(item);
                  }
                }}
              />
            )}
          />
        )}

        {active ? (
          <ViewerModal item={active} partnerPub={partner?.public_key || ""} onClose={() => setActive(null)} />
        ) : null}
      </View>
    </PrivacyGuard>
  );
}

function GalleryTile({
  item,
  partnerPub,
  onPress,
}: {
  item: Item;
  partnerPub: string;
  onPress: () => void;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const isVideo = item.kind === "video";

  useEffect(() => {
    let active = true;
    if (item.view_once || isVideo || !partnerPub) return;
    fetchAndDecryptMedia(item.media_id, item.media_nonce, item.media_mime || "image/jpeg", partnerPub)
      .then((u) => active && setUri(u))
      .catch(() => active && setErr(true));
    return () => {
      active = false;
    };
  }, [item, partnerPub, isVideo]);

  return (
    <Pressable style={styles.tile} onPress={onPress} testID={`gallery-tile-${item.id}`}>
      {item.view_once ? (
        <View style={styles.lockedTile}>
          <Ionicons name="flame" size={22} color={C.warning} />
          <Text style={styles.lockedText}>View once</Text>
        </View>
      ) : isVideo ? (
        <View style={styles.videoTile}>
          <Ionicons name="play-circle" size={30} color="#fff" />
        </View>
      ) : uri ? (
        <Image source={{ uri }} style={styles.tileImg} contentFit="cover" />
      ) : (
        <View style={styles.tileLoading}>
          {err ? <Ionicons name="eye-off" size={18} color={C.muted} /> : <ActivityIndicator size="small" color={C.brandPrimary} />}
        </View>
      )}
    </Pressable>
  );
}

function ViewerModal({ item, partnerPub, onClose }: { item: Item; partnerPub: string; onClose: () => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const isVideo = item.kind === "video";

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (isVideo) {
          const v = await decryptToPlayableUri(item.media_id, item.media_nonce, item.media_mime || "video/mp4", partnerPub);
          if (active) setVideoUri(v);
        } else {
          const u = await fetchAndDecryptMedia(item.media_id, item.media_nonce, item.media_mime || "image/jpeg", partnerPub);
          if (active) setUri(u);
        }
      } catch {
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [item, isVideo, partnerPub]);

  const save = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const r = await saveMediaToGallery(item.media_id, item.media_nonce, item.media_mime || "image/jpeg", partnerPub);
    if (r.ok) showToast("Saved to your photos");
    else if (r.reason === "web") showToast("Saving works on the mobile app");
    else if (r.reason === "permission") showToast("Allow photo access to save");
    else showToast("Couldn't save");
  };

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <PrivacyGuard partnerPub={partnerPub} label="a photo">
        <View style={styles.viewerScrim}>
          <Pressable style={styles.viewerClose} onPress={onClose} testID="gallery-viewer-close">
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : videoUri ? (
            <VideoPlayerView uri={videoUri} />
          ) : uri ? (
            <Image source={{ uri }} style={styles.viewerImg} contentFit="contain" />
          ) : (
            <Text style={styles.viewerErr}>Couldn't load</Text>
          )}

          {item.allow_save ? (
            <Pressable style={[styles.saveFab, { }]} onPress={save} testID="gallery-save-button">
              <Ionicons name="download" size={20} color="#fff" />
              <Text style={styles.saveFabText}>Save</Text>
            </Pressable>
          ) : (
            <View style={styles.noSave}>
              <Ionicons name="lock-closed" size={14} color="rgba(255,255,255,0.8)" />
              <Text style={styles.noSaveText}>Saving disabled by sender</Text>
            </View>
          )}

          {toast ? (
            <View style={styles.toast} testID="gallery-toast">
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          ) : null}
        </View>
      </PrivacyGuard>
    </Modal>
  );
}

function VideoPlayerView({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={styles.viewerVideo} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
    paddingHorizontal: S.lg,
    paddingBottom: S.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  headerTitle: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface },
  lockRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  lockText: { fontFamily: F.regular, fontSize: type.sm, color: C.success },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: S["2xl"] },
  emptyIcon: { width: 72, height: 72, borderRadius: R.pill, backgroundColor: C.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: S.lg },
  emptyTitle: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface, marginBottom: S.xs },
  emptyText: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, textAlign: "center" },
  tile: { width: TILE, height: TILE, backgroundColor: C.surfaceTertiary },
  tileImg: { width: "100%", height: "100%" },
  tileLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  lockedTile: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: C.brandTertiary },
  lockedText: { fontFamily: F.medium, fontSize: type.sm, color: C.onBrandTertiary },
  videoTile: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#2B2524" },
  viewerScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", alignItems: "center", justifyContent: "center" },
  viewerClose: { position: "absolute", top: 50, right: 20, zIndex: 2, padding: 8 },
  viewerImg: { width: "100%", height: "78%" },
  viewerVideo: { width: "100%", height: "70%" },
  viewerErr: { color: "#fff", fontFamily: F.medium, fontSize: type.lg },
  saveFab: {
    position: "absolute",
    bottom: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
    backgroundColor: C.brandPrimary,
    paddingHorizontal: S.xl,
    paddingVertical: S.md,
    borderRadius: R.pill,
  },
  saveFabText: { fontFamily: F.semibold, fontSize: type.lg, color: "#fff" },
  noSave: { position: "absolute", bottom: 66, flexDirection: "row", alignItems: "center", gap: S.xs },
  noSaveText: { fontFamily: F.medium, fontSize: type.base, color: "rgba(255,255,255,0.8)" },
  toast: { position: "absolute", bottom: 120, backgroundColor: C.surfaceInverse, paddingHorizontal: S.lg, paddingVertical: S.sm, borderRadius: R.pill },
  toastText: { fontFamily: F.medium, fontSize: type.base, color: C.onSurfaceInverse },
});
