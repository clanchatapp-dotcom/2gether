import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/lib/api";
import { encryptMessage, decryptMessage } from "@/src/lib/crypto";
import { PrivacyGuard } from "@/src/components/PrivacyGuard";
import { C, F, S, R, type } from "@/src/theme/theme";

type Worry = {
  id: string;
  author_id: string;
  nonce: string;
  ciphertext: string;
  resolved: boolean;
  created_at: string;
};

export default function Worries() {
  const insets = useSafeAreaInsets();
  const { user, partner } = useAuth();
  const [worries, setWorries] = useState<Worry[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getWorries();
      const items: Worry[] = res.worries || [];
      setWorries(items);
      if (partner?.public_key) {
        const updates: Record<string, string> = {};
        for (const w of items) {
          const t = await decryptMessage(w.ciphertext, w.nonce, partner.public_key);
          updates[w.id] = t ?? "🔒 Unable to decrypt";
        }
        setTexts(updates);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [partner]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || !partner?.public_key || saving) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const enc = await encryptMessage(body, partner.public_key);
      await api.addWorry(enc);
      setDraft("");
      setModal(false);
      load();
    } catch {
    } finally {
      setSaving(false);
    }
  };

  const resolve = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setWorries((prev) => prev.map((w) => (w.id === id ? { ...w, resolved: true } : w)));
    try {
      await api.resolveWorry(id);
    } catch {}
  };

  const active = worries.filter((w) => !w.resolved);
  const resolved = worries.filter((w) => w.resolved);

  return (
    <PrivacyGuard partnerPub={partner?.public_key} label="the worries space">
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + S.sm }]}>
        <Text style={styles.headerTitle}>Worries</Text>
        <Text style={styles.headerSub}>A calm space to raise what's on your mind</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.brandPrimary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: S.lg, paddingBottom: insets.bottom + 96 }}
          showsVerticalScrollIndicator={false}
        >
          {worries.length === 0 ? (
            <View style={styles.empty} testID="worries-empty">
              <View style={styles.emptyIcon}>
                <Ionicons name="leaf-outline" size={30} color={C.brandPrimary} />
              </View>
              <Text style={styles.emptyTitle}>Everything's okay</Text>
              <Text style={styles.emptyText}>
                A safe space to share what's on your mind — gently, and away from the everyday chat.
              </Text>
            </View>
          ) : (
            <>
              {active.map((w) => (
                <WorryCard
                  key={w.id}
                  worry={w}
                  text={texts[w.id]}
                  mine={w.author_id === user?.id}
                  onResolve={() => resolve(w.id)}
                />
              ))}
              {resolved.length > 0 ? (
                <Text style={styles.sectionLabel}>Resolved</Text>
              ) : null}
              {resolved.map((w) => (
                <WorryCard
                  key={w.id}
                  worry={w}
                  text={texts[w.id]}
                  mine={w.author_id === user?.id}
                  onResolve={() => {}}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}

      <Pressable
        testID="worry-add-button"
        style={[styles.fab, { bottom: S.xl }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setModal(true);
        }}
      >
        <Ionicons name="add" size={26} color={C.onBrandPrimary} />
        <Text style={styles.fabText}>Share</Text>
      </Pressable>

      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <KeyboardAvoidingView
          style={styles.sheetScrim}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setModal(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + S.lg }]} testID="worry-add-modal">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>What's on your mind?</Text>
            <Text style={styles.sheetHint}>
              Take your time. Write it out calmly — {partner?.display_name || "your partner"} will read
              it here, not in the chat.
            </Text>
            <TextInput
              testID="worry-input"
              style={styles.sheetInput}
              placeholder="I've been feeling…"
              placeholderTextColor={C.muted}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <Pressable
              testID="worry-save-button"
              style={[styles.saveBtn, (!draft.trim() || saving) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={!draft.trim() || saving}
            >
              <Text style={styles.saveText}>{saving ? "Sharing…" : "Share gently"}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </PrivacyGuard>
  );
}

function WorryCard({
  worry,
  text,
  mine,
  onResolve,
}: {
  worry: Worry;
  text?: string;
  mine: boolean;
  onResolve: () => void;
}) {
  return (
    <View style={[styles.card, worry.resolved && styles.cardResolved]} testID={`worry-${worry.id}`}>
      <View style={styles.cardTop}>
        <Text style={styles.author}>{mine ? "You wrote" : "Your partner wrote"}</Text>
        <Text style={styles.date}>
          {new Date(worry.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
        </Text>
      </View>
      <Text style={styles.body}>{text ?? "…"}</Text>
      {worry.resolved ? (
        <View style={styles.resolvedTag}>
          <Ionicons name="checkmark-circle" size={16} color={C.success} />
          <Text style={styles.resolvedText}>Resolved together</Text>
        </View>
      ) : (
        <Pressable style={styles.resolveBtn} onPress={onResolve} testID={`worry-resolve-${worry.id}`}>
          <Ionicons name="checkmark" size={16} color={C.success} />
          <Text style={styles.resolveText}>Mark as resolved</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surfaceSecondary },
  header: {
    paddingHorizontal: S.lg,
    paddingBottom: S.md,
    backgroundColor: C.surfaceSecondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  headerTitle: { fontFamily: F.bold, fontSize: type["2xl"], color: C.onSurface },
  headerSub: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: S["3xl"], paddingHorizontal: S.lg },
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
  sectionLabel: { fontFamily: F.semibold, fontSize: type.base, color: C.muted, marginTop: S.lg, marginBottom: S.sm },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardResolved: { opacity: 0.7 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: S.sm },
  author: { fontFamily: F.semibold, fontSize: type.base, color: C.brandPrimary },
  date: { fontFamily: F.regular, fontSize: type.sm, color: C.muted },
  body: { fontFamily: F.regular, fontSize: type.lg, color: C.onSurface, lineHeight: 24 },
  resolveBtn: { flexDirection: "row", alignItems: "center", gap: S.xs, marginTop: S.md },
  resolveText: { fontFamily: F.medium, fontSize: type.base, color: C.success },
  resolvedTag: { flexDirection: "row", alignItems: "center", gap: S.xs, marginTop: S.md },
  resolvedText: { fontFamily: F.medium, fontSize: type.base, color: C.success },
  fab: {
    position: "absolute",
    right: S.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: S.xs,
    paddingHorizontal: S.lg,
    height: 52,
    borderRadius: R.pill,
    backgroundColor: C.brandPrimary,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabText: { fontFamily: F.semibold, fontSize: type.base, color: C.onBrandPrimary },
  sheetScrim: { flex: 1, backgroundColor: "rgba(43,37,36,0.55)" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, padding: S.xl },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.borderStrong, alignSelf: "center", marginBottom: S.lg },
  sheetTitle: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface },
  sheetHint: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, marginTop: S.xs, marginBottom: S.lg, lineHeight: 22 },
  sheetInput: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: R.md,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    fontFamily: F.regular,
    fontSize: type.lg,
    color: C.onSurface,
    minHeight: 120,
    textAlignVertical: "top",
    marginBottom: S.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  saveBtn: { backgroundColor: C.brandPrimary, borderRadius: R.lg, paddingVertical: S.lg, alignItems: "center" },
  saveText: { fontFamily: F.semibold, fontSize: type.lg, color: C.onBrandPrimary },
});
