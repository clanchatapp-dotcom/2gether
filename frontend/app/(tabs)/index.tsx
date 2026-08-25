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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/lib/api";
import { encryptMessage, decryptMessage } from "@/src/lib/crypto";
import { C, F, S, R, type } from "@/src/theme/theme";

type Msg = {
  id: string;
  sender_id: string;
  nonce: string;
  ciphertext: string;
  created_at: string;
};

export default function Chat() {
  const insets = useSafeAreaInsets();
  const { user, partner } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [callModal, setCallModal] = useState<null | "voice" | "video">(null);
  const listRef = useRef<FlatList<Msg>>(null);
  const lastTs = useRef<string | null>(null);

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
      await decryptBatch(msgs);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [decryptBatch]);

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

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    if (messages.length) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !partner?.public_key || sending) return;
    setSending(true);
    setDraft("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const enc = await encryptMessage(body, partner.public_key);
      const res = await api.sendMessage({ ...enc, kind: "text" });
      const m: Msg = res.message;
      lastTs.current = m.created_at;
      setMessages((prev) => [...prev, m]);
      setTexts((prev) => ({ ...prev, [m.id]: body }));
    } catch {
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }: { item: Msg }) => {
    const mine = item.sender_id === user?.id;
    return (
      <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={[styles.msgText, mine ? styles.msgTextMine : styles.msgTextTheirs]}>
            {texts[item.id] ?? "…"}
          </Text>
          <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>
            {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
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
          <View style={styles.e2eRow}>
            <Ionicons name="lock-closed" size={11} color={C.success} />
            <Text style={styles.e2eText}>End-to-end encrypted</Text>
          </View>
        </View>
        <Pressable testID="chat-voice-call" style={styles.callBtn} onPress={() => setCallModal("voice")}>
          <Ionicons name="call" size={20} color={C.brandPrimary} />
        </Pressable>
        <Pressable testID="chat-video-call" style={styles.callBtn} onPress={() => setCallModal("video")}>
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
        />
      )}

      {/* Composer */}
      <View style={[styles.composer, { paddingBottom: insets.bottom + 64 }]}>
        <TextInput
          testID="chat-input"
          style={styles.input}
          placeholder="Message…"
          placeholderTextColor={C.muted}
          value={draft}
          onChangeText={setDraft}
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

      {/* Call coming-soon modal */}
      <Modal visible={callModal !== null} transparent animationType="fade" onRequestClose={() => setCallModal(null)}>
        <Pressable style={styles.modalScrim} onPress={() => setCallModal(null)}>
          <View style={styles.modalCard} testID="chat-call-modal">
            <View style={styles.modalIcon}>
              <Ionicons name={callModal === "video" ? "videocam" : "call"} size={28} color={C.brandPrimary} />
            </View>
            <Text style={styles.modalTitle}>
              {callModal === "video" ? "Video" : "Voice"} calling
            </Text>
            <Text style={styles.modalText}>
              Encrypted {callModal === "video" ? "video" : "voice"} calls activate once you install
              the Twogether app build on your device. Coming soon!
            </Text>
            <Pressable style={styles.modalBtn} onPress={() => setCallModal(null)}>
              <Text style={styles.modalBtnText}>Got it</Text>
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
