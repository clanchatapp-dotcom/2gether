import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { useCall } from "@/src/context/CallContext";
import { api } from "@/src/lib/api";
import { useRealtime } from "@/src/lib/realtime";
import { encryptMessage, decryptMessage } from "@/src/lib/crypto";
import { pickMedia, encryptAndUpload } from "@/src/lib/media";
import { MediaBubble } from "@/src/components/MediaBubble";
import { C, F, S, R, type } from "@/src/theme/theme";

type Msg = {
  id: string;
  sender_id: string;
  nonce: string;
  ciphertext: string;
  kind?: string;
  media_id?: string;
  media_nonce?: string;
  media_mime?: string;
  view_once?: boolean;
  allow_save?: boolean;
  expire_seconds?: number | null;
  expires_at?: string | null;
  viewed?: boolean;
  created_at: string;
};

export default function Chat() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, partner } = useAuth();
  const { startCall } = useCall();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [readAll, setReadAll] = useState(false);
  const [mediaModal, setMediaModal] = useState(false);
  const [permModal, setPermModal] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);
  const [allowSave, setAllowSave] = useState(true);
  const [expireSeconds, setExpireSeconds] = useState(0);
  const [uploading, setUploading] = useState(false);
  const listRef = useRef<FlatList<Msg>>(null);
  const lastTs = useRef<string | null>(null);
  const typingTimeout = useRef<any>(null);
  const isTypingRef = useRef(false);
  const typingClearTimer = useRef<any>(null);

  const decryptBatch = useCallback(
    async (items: Msg[]) => {
      if (!partner?.public_key) return;
      const updates: Record<string, string> = {};
      for (const m of items) {
        const t = await decryptMessage(m.ciphertext, m.nonce, partner.public_key);
        updates[m.id] = t ?? "🔒 Unable to decrypt";
      }
      setTexts((prev) => ({ ...prev, ...updates }));
    },
    [partner],
  );

  const loadAll = useCallback(async () => {
    try {
      const res = await api.getMessages();
      const msgs: Msg[] = res.messages || [];
      setMessages(msgs);
      if (msgs.length) lastTs.current = msgs[msgs.length - 1].created_at;
      const lastMine = [...msgs].reverse().find((m) => m.sender_id === user?.id);
      setReadAll(!!lastMine?.viewed);
      await decryptBatch(msgs);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [decryptBatch, user]);

  const poll = useCallback(async () => {
    try {
      const res = await api.getMessages(lastTs.current || undefined);
      const fresh: Msg[] = res.messages || [];
      if (fresh.length) {
        lastTs.current = fresh[fresh.length - 1].created_at;
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          return [...prev, ...fresh.filter((m) => !ids.has(m.id))];
        });
        await decryptBatch(fresh);
      }
    } catch {
      // ignore
    }
  }, [decryptBatch]);

  // ---- Realtime (WebSocket) ----
  const handleEvent = useCallback(
    async (e: any) => {
      if (e.type === "message") {
        const m: Msg = e.message;
        setMessages((prev) => {
          if (prev.some((x) => x.id === m.id)) return prev;
          return [...prev, m];
        });
        lastTs.current = m.created_at;
        if (m.sender_id !== user?.id && partner?.public_key) {
          const t = await decryptMessage(m.ciphertext, m.nonce, partner.public_key);
          setTexts((prev) => ({ ...prev, [m.id]: t ?? "🔒 Unable to decrypt" }));
        }
      } else if (e.type === "typing") {
        if (e.user_id !== user?.id) setPartnerTyping(!!e.is_typing);
      } else if (e.type === "read") {
        if (e.user_id !== user?.id) setReadAll(true);
      } else if (e.type === "expiry_started") {
        setMessages((prev) =>
          prev.map((m) => (m.media_id === e.media_id ? { ...m, expires_at: e.expires_at } : m)),
        );
      }
    },
    [user, partner],
  );

  const { send: wsSend } = useRealtime(handleEvent, !!partner);

  const markRead = useCallback(() => {
    wsSend({ type: "read" });
  }, [wsSend]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Fallback polling (WebSocket is primary) — catches anything missed offline.
  useEffect(() => {
    const t = setInterval(poll, 10000);
    return () => clearInterval(t);
  }, [poll]);

  // Mark partner messages as read whenever the latest message is theirs.
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    if (last.sender_id !== user?.id) markRead();
  }, [messages, user, markRead]);

  useEffect(() => {
    if (messages.length || partnerTyping) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length, partnerTyping]);

  const onChangeDraft = (text: string) => {
    setDraft(text);
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      wsSend({ type: "typing", is_typing: true });
    }
    clearTimeout(typingClearTimer.current);
    typingClearTimer.current = setTimeout(() => {
      isTypingRef.current = false;
      wsSend({ type: "typing", is_typing: false });
    }, 2000);
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !partner?.public_key || sending) return;
    setSending(true);
    setDraft("");
    clearTimeout(typingClearTimer.current);
    isTypingRef.current = false;
    wsSend({ type: "typing", is_typing: false });
    setReadAll(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const enc = await encryptMessage(body, partner.public_key);
      const res = await api.sendMessage({ ...enc, kind: "text" });
      const m: Msg = res.message;
      lastTs.current = m.created_at;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      setTexts((prev) => ({ ...prev, [m.id]: body }));
    } catch {
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  const lastMineId = [...messages].reverse().find((m) => m.sender_id === user?.id && m.kind !== "system")?.id;

  const sendMedia = async (kind: "image" | "video") => {
    if (!partner?.public_key) return;
    setMediaModal(false);
    const picked = await pickMedia(kind);
    if (!picked.ok) {
      if (picked.reason === "permission") setPermModal(true);
      return;
    }
    setUploading(true);
    setReadAll(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const media = await encryptAndUpload(picked.uri, picked.mime, kind, partner.public_key);
      const enc = await encryptMessage("", partner.public_key); // empty caption placeholder
      const res = await api.sendMessage({
        ...enc,
        kind,
        media_id: media.media_id,
        media_nonce: media.media_nonce,
        media_mime: media.media_mime,
        view_once: viewOnce,
        allow_save: allowSave,
        expire_seconds: expireSeconds || null,
      });
      const m: Msg = res.message;
      lastTs.current = m.created_at;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      setTexts((prev) => ({ ...prev, [m.id]: "" }));
    } catch (e) {
      // silently ignore; could show toast
    } finally {
      setUploading(false);
      setViewOnce(false);
      setAllowSave(true);
      setExpireSeconds(0);
    }
  };

  const renderItem = ({ item }: { item: Msg }) => {
    const mine = item.sender_id === user?.id;
    if (item.kind === "system") {
      return (
        <View style={styles.systemRow} testID={`system-${item.id}`}>
          <View style={styles.systemPill}>
            <Ionicons name="warning" size={12} color={C.warning} />
            <Text style={styles.systemText}>
              {mine ? "You" : partner?.display_name || "Partner"} {texts[item.id] ?? "…"}
            </Text>
          </View>
        </View>
      );
    }
    const showRead = mine && item.id === lastMineId && (readAll || item.viewed);
    const isMedia = item.kind === "image" || item.kind === "video";
    const caption = texts[item.id];
    return (
      <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={{ maxWidth: "78%", alignItems: mine ? "flex-end" : "flex-start" }}>
          {isMedia && item.media_id ? (
            <MediaBubble
              msg={item as any}
              mine={mine}
              partnerPub={partner?.public_key || ""}
              onViewed={(id) => api.markViewed(id).catch(() => {})}
            />
          ) : (
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              <Text style={[styles.msgText, mine ? styles.msgTextMine : styles.msgTextTheirs]}>
                {caption ?? "…"}
              </Text>
              <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>
                {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Text>
            </View>
          )}
          {isMedia && caption ? (
            <Text style={[styles.mediaCaption, mine && { textAlign: "right" }]}>{caption}</Text>
          ) : null}
          {showRead ? (
            <View style={styles.readRow} testID="chat-read-receipt">
              <Ionicons name="checkmark-done" size={12} color={C.brandPrimary} />
              <Text style={styles.readText}>Read</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const initial = (partner?.display_name || "?").charAt(0).toUpperCase();

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + S.sm }]} testID="chat-header">
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName}>{partner?.display_name || "Your partner"}</Text>
          {partnerTyping ? (
            <Text style={styles.typingText} testID="chat-typing">
              typing…
            </Text>
          ) : (
            <View style={styles.e2eRow}>
              <Ionicons name="lock-closed" size={11} color={C.success} />
              <Text style={styles.e2eText}>End-to-end encrypted</Text>
            </View>
          )}
        </View>
        <Pressable testID="chat-gallery" style={styles.callBtn} onPress={() => router.push("/gallery")}>
          <Ionicons name="images" size={19} color={C.brandPrimary} />
        </Pressable>
        <Pressable testID="chat-voice-call" style={styles.callBtn} onPress={() => startCall("voice")}>
          <Ionicons name="call" size={20} color={C.brandPrimary} />
        </Pressable>
        <Pressable testID="chat-video-call" style={styles.callBtn} onPress={() => startCall("video")}>
          <Ionicons name="videocam" size={20} color={C.brandPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.brandPrimary} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.center} testID="chat-empty">
          <View style={styles.emptyIcon}>
            <Ionicons name="heart" size={30} color={C.brandPrimary} />
          </View>
          <Text style={styles.emptyTitle}>Start your conversation</Text>
          <Text style={styles.emptyText}>
            Say hello to {partner?.display_name || "your partner"}. Everything here is private and
            encrypted.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          testID="chat-list"
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: S.lg, paddingBottom: S.md }}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            partnerTyping ? (
              <View style={[styles.bubbleRow, styles.rowTheirs]}>
                <View style={[styles.bubble, styles.bubbleTheirs, styles.typingBubble]}>
                  <View style={styles.typingDot} />
                  <View style={[styles.typingDot, { opacity: 0.6 }]} />
                  <View style={[styles.typingDot, { opacity: 0.3 }]} />
                </View>
              </View>
            ) : null
          }
        />
      )}

      {/* Composer */}
      <View style={[styles.composer, { paddingBottom: insets.bottom + 64 }]}>
        <Pressable
          testID="chat-attach-button"
          style={styles.attachBtn}
          onPress={() => setMediaModal(true)}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color={C.brandPrimary} size="small" />
          ) : (
            <Ionicons name="add" size={26} color={C.brandPrimary} />
          )}
        </Pressable>
        <TextInput
          testID="chat-input"
          style={styles.input}
          placeholder="Message…"
          placeholderTextColor={C.muted}
          value={draft}
          onChangeText={onChangeDraft}
          multiline
        />
        <Pressable
          testID="chat-send-button"
          style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
          onPress={send}
          disabled={!draft.trim() || sending}
        >
          <Ionicons name="arrow-up" size={22} color={C.onBrandPrimary} />
        </Pressable>
      </View>

      {/* Media picker modal */}
      <Modal visible={mediaModal} transparent animationType="slide" onRequestClose={() => setMediaModal(false)}>
        <View style={styles.sheetScrim}>
          <Pressable style={{ flex: 1 }} onPress={() => setMediaModal(false)} />
          <View style={[styles.mediaSheet, { paddingBottom: insets.bottom + S.lg }]} testID="chat-media-modal">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Share privately</Text>
            <Text style={styles.sheetHint}>Encrypted on your device before it's sent.</Text>

            <Pressable style={styles.optRow} onPress={() => setViewOnce((v) => !v)} testID="media-viewonce-toggle">
              <View style={styles.optLeft}>
                <View style={styles.optIcon}>
                  <Ionicons name="flame-outline" size={18} color={C.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optTitle}>View once</Text>
                  <Text style={styles.optSub}>Disappears after your partner opens it</Text>
                </View>
              </View>
              <View style={[styles.switchTrack, viewOnce && styles.switchOn]}>
                <View style={[styles.switchThumb, viewOnce && styles.switchThumbOn]} />
              </View>
            </Pressable>

            <Pressable style={styles.optRow} onPress={() => setAllowSave((v) => !v)} testID="media-save-toggle">
              <View style={styles.optLeft}>
                <View style={styles.optIcon}>
                  <Ionicons name="download-outline" size={18} color={C.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optTitle}>Allow saving</Text>
                  <Text style={styles.optSub}>Let your partner keep a copy</Text>
                </View>
              </View>
              <View style={[styles.switchTrack, allowSave && styles.switchOn]}>
                <View style={[styles.switchThumb, allowSave && styles.switchThumbOn]} />
              </View>
            </Pressable>

            <View style={styles.expireSection}>
              <View style={styles.optLeft}>
                <View style={styles.optIcon}>
                  <Ionicons name="timer-outline" size={18} color={C.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optTitle}>Auto-expire</Text>
                  <Text style={styles.optSub}>Vanishes after your partner opens it</Text>
                </View>
              </View>
              <View style={styles.expireChips}>
                {[
                  { label: "Off", s: 0 },
                  { label: "1h", s: 3600 },
                  { label: "24h", s: 86400 },
                  { label: "7d", s: 604800 },
                ].map((opt) => {
                  const on = expireSeconds === opt.s;
                  return (
                    <Pressable
                      key={opt.label}
                      testID={`media-expire-${opt.label}`}
                      style={[styles.expireChip, on && styles.expireChipOn]}
                      onPress={() => { Haptics.selectionAsync(); setExpireSeconds(opt.s); }}
                    >
                      <Text style={[styles.expireChipText, on && styles.expireChipTextOn]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.pickRow}>
              <Pressable style={styles.pickBtn} onPress={() => sendMedia("image")} testID="media-pick-photo">
                <Ionicons name="image" size={24} color={C.onBrandPrimary} />
                <Text style={styles.pickText}>Photo</Text>
              </Pressable>
              <Pressable style={styles.pickBtn} onPress={() => sendMedia("video")} testID="media-pick-video">
                <Ionicons name="videocam" size={24} color={C.onBrandPrimary} />
                <Text style={styles.pickText}>Video</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Permission needed modal */}
      <Modal visible={permModal} transparent animationType="fade" onRequestClose={() => setPermModal(false)}>
        <Pressable style={styles.modalScrim} onPress={() => setPermModal(false)}>
          <View style={styles.modalCard} testID="chat-perm-modal">
            <View style={styles.modalIcon}>
              <Ionicons name="images" size={28} color={C.brandPrimary} />
            </View>
            <Text style={styles.modalTitle}>Allow photo access</Text>
            <Text style={styles.modalText}>
              To share photos and videos, Twogether needs permission to your library. Enable it in
              Settings.
            </Text>
            <Pressable style={styles.modalBtn} onPress={() => { setPermModal(false); Linking.openSettings(); }}>
              <Text style={styles.modalBtnText}>Open Settings</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
    paddingHorizontal: S.lg,
    paddingBottom: S.md,
    backgroundColor: C.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: R.pill,
    backgroundColor: C.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: F.bold, fontSize: type.lg, color: C.onBrandTertiary },
  headerName: { fontFamily: F.semibold, fontSize: type.lg, color: C.onSurface },
  e2eRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  e2eText: { fontFamily: F.regular, fontSize: type.sm, color: C.success },
  typingText: { fontFamily: F.medium, fontSize: type.sm, color: C.brandPrimary, marginTop: 1 },
  systemRow: { alignItems: "center", marginVertical: S.sm },
  systemPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.xs,
    backgroundColor: "#F7EEDC",
    paddingHorizontal: S.md,
    paddingVertical: 6,
    borderRadius: R.pill,
    maxWidth: "85%",
  },
  systemText: { fontFamily: F.medium, fontSize: type.sm, color: "#8A6D1E", textAlign: "center" },
  readRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3, marginRight: 2 },
  readText: { fontFamily: F.medium, fontSize: 10, color: C.brandPrimary },
  typingBubble: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: S.md },
  typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.muted },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: R.pill,
    backgroundColor: C.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: S["2xl"] },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: R.pill,
    backgroundColor: C.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: S.lg,
  },
  emptyTitle: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface, marginBottom: S.xs },
  emptyText: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, textAlign: "center", lineHeight: 22 },
  bubbleRow: { flexDirection: "row", marginBottom: S.sm },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "78%", borderRadius: R.lg, paddingHorizontal: S.lg, paddingVertical: S.md },
  bubbleMine: { backgroundColor: C.brandPrimary, borderBottomRightRadius: R.sm },
  bubbleTheirs: { backgroundColor: C.surfaceSecondary, borderBottomLeftRadius: R.sm, borderWidth: 1, borderColor: C.border },
  msgText: { fontFamily: F.regular, fontSize: type.lg, lineHeight: 22 },
  msgTextMine: { color: C.onBrandPrimary },
  msgTextTheirs: { color: C.onSurface },
  time: { fontFamily: F.regular, fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  timeMine: { color: "rgba(255,255,255,0.7)" },
  timeTheirs: { color: C.muted },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: S.sm,
    paddingHorizontal: S.lg,
    paddingTop: S.sm,
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  input: {
    flex: 1,
    backgroundColor: C.surfaceSecondary,
    borderRadius: R.lg,
    paddingHorizontal: S.lg,
    paddingVertical: Platform.OS === "ios" ? S.md : S.sm,
    fontFamily: F.regular,
    fontSize: type.lg,
    color: C.onSurface,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: C.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: R.pill,
    backgroundColor: C.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: R.pill,
    backgroundColor: C.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  mediaCaption: { fontFamily: F.regular, fontSize: type.base, color: C.onSurface, marginTop: 4, maxWidth: 260 },
  sheetScrim: { flex: 1, backgroundColor: "rgba(43,37,36,0.5)" },
  mediaSheet: { backgroundColor: C.surface, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, padding: S.xl },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.borderStrong, alignSelf: "center", marginBottom: S.lg },
  sheetTitle: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface },
  sheetHint: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, marginTop: 2, marginBottom: S.lg },
  optRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: S.md },
  optLeft: { flexDirection: "row", alignItems: "center", gap: S.md, flex: 1 },
  optIcon: { width: 38, height: 38, borderRadius: R.pill, backgroundColor: C.brandTertiary, alignItems: "center", justifyContent: "center" },
  optTitle: { fontFamily: F.semibold, fontSize: type.lg, color: C.onSurface },
  optSub: { fontFamily: F.regular, fontSize: type.sm, color: C.onSurfaceSecondary, marginTop: 1 },
  switchTrack: { width: 48, height: 28, borderRadius: R.pill, backgroundColor: C.surfaceTertiary, padding: 3, justifyContent: "center" },
  switchOn: { backgroundColor: C.brandPrimary },
  switchThumb: { width: 22, height: 22, borderRadius: R.pill, backgroundColor: "#fff" },
  switchThumbOn: { alignSelf: "flex-end" },
  pickRow: { flexDirection: "row", gap: S.md, marginTop: S.lg },
  pickBtn: { flex: 1, backgroundColor: C.brandPrimary, borderRadius: R.lg, paddingVertical: S.lg, alignItems: "center", gap: S.xs },
  pickText: { fontFamily: F.semibold, fontSize: type.base, color: C.onBrandPrimary },
  expireSection: { paddingVertical: S.md },
  expireChips: { flexDirection: "row", gap: S.sm, marginTop: S.md },
  expireChip: {
    flex: 1,
    paddingVertical: S.sm,
    borderRadius: R.md,
    backgroundColor: C.surfaceSecondary,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  expireChipOn: { backgroundColor: C.brandPrimary, borderColor: C.brandPrimary },
  expireChipText: { fontFamily: F.semibold, fontSize: type.base, color: C.onSurfaceSecondary },
  expireChipTextOn: { color: C.onBrandPrimary },
  modalScrim: { flex: 1, backgroundColor: "rgba(43,37,36,0.5)", alignItems: "center", justifyContent: "center", padding: S["2xl"] },
  modalCard: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.xl, alignItems: "center", width: "100%" },
  modalIcon: {
    width: 64,
    height: 64,
    borderRadius: R.pill,
    backgroundColor: C.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: S.lg,
  },
  modalTitle: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface, marginBottom: S.sm },
  modalText: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, textAlign: "center", lineHeight: 22, marginBottom: S.xl },
  modalBtn: { backgroundColor: C.brandPrimary, borderRadius: R.lg, paddingVertical: S.md, paddingHorizontal: S["2xl"], alignSelf: "stretch", alignItems: "center" },
  modalBtnText: { fontFamily: F.semibold, fontSize: type.lg, color: C.onBrandPrimary },
});
