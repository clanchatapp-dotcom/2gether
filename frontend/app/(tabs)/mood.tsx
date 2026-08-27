import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/lib/api";
import { encryptMessage, decryptMessage } from "@/src/lib/crypto";
import { C, F, S, R, type } from "@/src/theme/theme";

const MOODS = [
  { key: "loved", emoji: "🥰", label: "Loved" },
  { key: "great", emoji: "😊", label: "Great" },
  { key: "okay", emoji: "🙂", label: "Okay" },
  { key: "meh", emoji: "😐", label: "Meh" },
  { key: "tired", emoji: "😴", label: "Tired" },
  { key: "low", emoji: "😔", label: "Low" },
  { key: "anxious", emoji: "😥", label: "Anxious" },
  { key: "upset", emoji: "😤", label: "Upset" },
];
const REACTIONS = ["❤️", "🥰", "🫂", "👍", "😢"];

type Checkin = {
  id: string;
  author_id: string;
  date: string;
  mood: string;
  nonce: string;
  ciphertext: string;
  reactions: Record<string, string>;
  created_at: string;
};

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const moodOf = (k: string) => MOODS.find((m) => m.key === k) || { emoji: "🙂", label: k };

export default function Mood() {
  const insets = useSafeAreaInsets();
  const { user, partner } = useAuth();
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getCheckins();
      const items: Checkin[] = res.checkins || [];
      setCheckins(items);
      if (partner?.public_key) {
        const updates: Record<string, string> = {};
        for (const c of items) {
          if (c.ciphertext) {
            const t = await decryptMessage(c.ciphertext, c.nonce, partner.public_key);
            updates[c.id] = t ?? "";
          }
        }
        setNotes(updates);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [partner]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const myToday = checkins.find((c) => c.author_id === user?.id && c.date === todayIso());

  const submit = async () => {
    if (!selectedMood || !partner?.public_key || saving) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const enc = note.trim()
        ? await encryptMessage(note.trim(), partner.public_key)
        : { nonce: "", ciphertext: "" };
      await api.addCheckin({ date: todayIso(), mood: selectedMood, nonce: enc.nonce, ciphertext: enc.ciphertext });
      setSelectedMood(null);
      setNote("");
      load();
    } catch {
    } finally {
      setSaving(false);
    }
  };

  const react = async (id: string, emoji: string) => {
    Haptics.selectionAsync();
    setCheckins((prev) =>
      prev.map((c) => (c.id === id ? { ...c, reactions: { ...c.reactions, [user!.id]: emoji } } : c)),
    );
    try {
      await api.reactCheckin(id, emoji);
    } catch {}
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + S.sm }]}>
        <Text style={styles.headerTitle}>Daily Check-in</Text>
        <Text style={styles.headerSub}>A gentle moment to share how you feel</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingBottom: insets.bottom + 96 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Today's prompt */}
        <View style={styles.promptCard} testID="checkin-prompt">
          <Text style={styles.promptTitle}>
            {myToday ? "Update today's mood" : "How are you feeling today?"}
          </Text>
          <View style={styles.moodGrid}>
            {MOODS.map((m) => {
              const active = selectedMood === m.key || (!selectedMood && myToday?.mood === m.key);
              return (
                <Pressable
                  key={m.key}
                  testID={`mood-${m.key}`}
                  style={[styles.moodChip, active && styles.moodChipActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedMood(m.key);
                  }}
                >
                  <Text style={styles.moodEmoji}>{m.emoji}</Text>
                  <Text style={[styles.moodLabel, active && styles.moodLabelActive]}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            testID="checkin-note-input"
            style={styles.noteInput}
            placeholder="Add a note for your partner (optional)"
            placeholderTextColor={C.muted}
            value={note}
            onChangeText={setNote}
            multiline
          />
          <Pressable
            testID="checkin-submit"
            style={[styles.submitBtn, (!selectedMood || saving) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={!selectedMood || saving}
          >
            <Text style={styles.submitText}>{saving ? "Sharing…" : myToday ? "Update" : "Share how I feel"}</Text>
          </Pressable>
        </View>

        <Text style={styles.timelineLabel}>Recent moods</Text>

        {loading ? (
          <ActivityIndicator color={C.brandPrimary} style={{ marginTop: S.xl }} />
        ) : checkins.length === 0 ? (
          <View style={styles.empty} testID="checkin-empty">
            <Text style={styles.emptyEmoji}>💞</Text>
            <Text style={styles.emptyText}>No check-ins yet. Share how you feel to start.</Text>
          </View>
        ) : (
          checkins.map((c) => {
            const mine = c.author_id === user?.id;
            const m = moodOf(c.mood);
            const myReaction = user ? c.reactions?.[user.id] : undefined;
            const partnerReaction = partner ? c.reactions?.[partner.id] : undefined;
            return (
              <View key={c.id} style={styles.checkinCard} testID={`checkin-${c.id}`}>
                <View style={styles.checkinTop}>
                  <Text style={styles.bigEmoji}>{m.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkinWho}>
                      {mine ? "You" : partner?.display_name || "Partner"} felt {m.label.toLowerCase()}
                    </Text>
                    <Text style={styles.checkinDate}>
                      {new Date(c.created_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                    </Text>
                  </View>
                </View>
                {notes[c.id] ? <Text style={styles.checkinNote}>{notes[c.id]}</Text> : null}

                {/* Reactions */}
                <View style={styles.reactRow}>
                  {mine ? (
                    partnerReaction ? (
                      <View style={styles.reactShown}>
                        <Text style={styles.reactShownEmoji}>{partnerReaction}</Text>
                        <Text style={styles.reactShownText}>{partner?.display_name} reacted</Text>
                      </View>
                    ) : (
                      <Text style={styles.reactWaiting}>Waiting for a reaction…</Text>
                    )
                  ) : (
                    REACTIONS.map((emoji) => (
                      <Pressable
                        key={emoji}
                        testID={`react-${c.id}-${emoji}`}
                        style={[styles.reactBtn, myReaction === emoji && styles.reactBtnActive]}
                        onPress={() => react(c.id, emoji)}
                      >
                        <Text style={styles.reactEmoji}>{emoji}</Text>
                      </Pressable>
                    ))
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  header: {
    paddingHorizontal: S.lg,
    paddingBottom: S.md,
    backgroundColor: C.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  headerTitle: { fontFamily: F.bold, fontSize: type["2xl"], color: C.onSurface },
  headerSub: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, marginTop: 2 },
  promptCard: {
    backgroundColor: C.brandTertiary,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.xl,
  },
  promptTitle: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface, marginBottom: S.md },
  moodGrid: { flexDirection: "row", flexWrap: "wrap", gap: S.sm },
  moodChip: {
    width: "23%",
    aspectRatio: 1,
    borderRadius: R.md,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: 2,
    borderColor: "transparent",
  },
  moodChipActive: { borderColor: C.brandPrimary },
  moodEmoji: { fontSize: 26 },
  moodLabel: { fontFamily: F.medium, fontSize: 11, color: C.onSurfaceSecondary },
  moodLabelActive: { color: C.brandPrimary, fontFamily: F.semibold },
  noteInput: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    fontFamily: F.regular,
    fontSize: type.base,
    color: C.onSurface,
    minHeight: 60,
    textAlignVertical: "top",
    marginTop: S.md,
  },
  submitBtn: { backgroundColor: C.brandPrimary, borderRadius: R.lg, paddingVertical: S.md, alignItems: "center", marginTop: S.md },
  submitText: { fontFamily: F.semibold, fontSize: type.lg, color: C.onBrandPrimary },
  timelineLabel: { fontFamily: F.semibold, fontSize: type.base, color: C.muted, marginBottom: S.md },
  empty: { alignItems: "center", paddingTop: S.xl, gap: S.sm },
  emptyEmoji: { fontSize: 40 },
  emptyText: { fontFamily: F.regular, fontSize: type.base, color: C.muted, textAlign: "center" },
  checkinCard: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    borderWidth: 1,
    borderColor: C.border,
  },
  checkinTop: { flexDirection: "row", alignItems: "center", gap: S.md },
  bigEmoji: { fontSize: 34 },
  checkinWho: { fontFamily: F.semibold, fontSize: type.lg, color: C.onSurface },
  checkinDate: { fontFamily: F.regular, fontSize: type.sm, color: C.muted, marginTop: 1 },
  checkinNote: { fontFamily: F.regular, fontSize: type.base, color: C.onSurface, lineHeight: 22, marginTop: S.md },
  reactRow: { flexDirection: "row", alignItems: "center", gap: S.sm, marginTop: S.md },
  reactBtn: {
    width: 40,
    height: 40,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  reactBtnActive: { backgroundColor: C.brandTertiary, borderColor: C.brandPrimary },
  reactEmoji: { fontSize: 18 },
  reactShown: { flexDirection: "row", alignItems: "center", gap: S.sm },
  reactShownEmoji: { fontSize: 20 },
  reactShownText: { fontFamily: F.medium, fontSize: type.sm, color: C.onSurfaceSecondary },
  reactWaiting: { fontFamily: F.regular, fontSize: type.sm, color: C.muted },
});
