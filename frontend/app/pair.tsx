import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { C, F, S, R, type } from "@/src/theme/theme";

export default function Pair() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, pairStatus, pairCode, createInvite, redeemInvite, refreshPair, signOut } = useAuth();
  const [mode, setMode] = useState<"choose" | "invite" | "join">("choose");
  const [code, setCode] = useState<string | null>(pairCode);
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (pairStatus === "active") router.replace("/(tabs)");
  }, [pairStatus, router]);

  // Poll for the partner to redeem the invite.
  useEffect(() => {
    if (mode !== "invite") return;
    const t = setInterval(() => refreshPair(), 3000);
    return () => clearInterval(t);
  }, [mode, refreshPair]);

  const startInvite = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const c = await createInvite();
      setCode(c);
      setMode("invite");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [createInvite]);

  const submitJoin = async () => {
    setError(null);
    if (joinCode.trim().length < 4) {
      setError("Enter the invite code your partner shared.");
      return;
    }
    setLoading(true);
    try {
      await redeemInvite(joinCode.trim().toUpperCase());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + S.xl, paddingBottom: insets.bottom + S.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <Text style={styles.hello}>Hi {user?.display_name} 👋</Text>
          <Pressable testID="pair-signout" onPress={signOut} hitSlop={10}>
            <Text style={styles.signout}>Sign out</Text>
          </Pressable>
        </View>

        {mode === "choose" && (
          <View testID="pair-choose">
            <Text style={styles.title}>Connect with your person</Text>
            <Text style={styles.subtitle}>
              Twogether links exactly two people. Invite your partner, or enter the code they sent you.
            </Text>

            <Pressable testID="pair-create-button" style={styles.card} onPress={startInvite}>
              <View style={styles.cardIcon}>
                <Ionicons name="qr-code-outline" size={22} color={C.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Invite my partner</Text>
                <Text style={styles.cardText}>Generate a code to share with them.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={C.muted} />
            </Pressable>

            <Pressable
              testID="pair-join-button"
              style={styles.card}
              onPress={() => setMode("join")}
            >
              <View style={styles.cardIcon}>
                <Ionicons name="key-outline" size={22} color={C.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>I have a code</Text>
                <Text style={styles.cardText}>Enter your partner's invite code.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={C.muted} />
            </Pressable>
          </View>
        )}

        {mode === "invite" && (
          <View testID="pair-invite">
            <Pressable onPress={() => setMode("choose")} style={styles.back}>
              <Ionicons name="chevron-back" size={24} color={C.onSurface} />
            </Pressable>
            <Text style={styles.title}>Share your code</Text>
            <Text style={styles.subtitle}>
              Send this code to your partner. Once they enter it, you'll be connected.
            </Text>

            <Pressable style={styles.codeBox} onPress={copyCode} testID="pair-code-box">
              <Text style={styles.codeText}>{code}</Text>
              <View style={styles.copyRow}>
                <Ionicons
                  name={copied ? "checkmark" : "copy-outline"}
                  size={16}
                  color={C.brandPrimary}
                />
                <Text style={styles.copyText}>{copied ? "Copied!" : "Tap to copy"}</Text>
              </View>
            </Pressable>

            <View style={styles.waiting}>
              <Ionicons name="hourglass-outline" size={18} color={C.onSurfaceSecondary} />
              <Text style={styles.waitingText}>Waiting for your partner to join…</Text>
            </View>
          </View>
        )}

        {mode === "join" && (
          <View testID="pair-join">
            <Pressable onPress={() => setMode("choose")} style={styles.back}>
              <Ionicons name="chevron-back" size={24} color={C.onSurface} />
            </Pressable>
            <Text style={styles.title}>Enter invite code</Text>
            <Text style={styles.subtitle}>Type the code your partner shared with you.</Text>

            <TextInput
              testID="pair-code-input"
              style={styles.input}
              placeholder="ABC123"
              placeholderTextColor={C.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              value={joinCode}
              onChangeText={setJoinCode}
            />
            <Pressable
              testID="pair-join-submit"
              style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
              disabled={loading}
              onPress={submitJoin}
            >
              <Text style={styles.primaryText}>{loading ? "Connecting…" : "Connect"}</Text>
            </Pressable>
          </View>
        )}

        {error ? (
          <Text style={styles.error} testID="pair-error">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: S.xl, flexGrow: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: S.xl },
  hello: { fontFamily: F.semibold, fontSize: type.lg, color: C.onSurface },
  signout: { fontFamily: F.medium, fontSize: type.base, color: C.brandPrimary },
  back: { marginBottom: S.md, width: 40 },
  title: { fontFamily: F.bold, fontSize: type.display, color: C.onSurface, lineHeight: 40 },
  subtitle: {
    fontFamily: F.regular,
    fontSize: type.lg,
    color: C.onSurfaceSecondary,
    marginTop: S.sm,
    marginBottom: S.xl,
    lineHeight: 24,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
    backgroundColor: C.surfaceSecondary,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: R.pill,
    backgroundColor: C.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontFamily: F.semibold, fontSize: type.lg, color: C.onSurface },
  cardText: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, marginTop: 2 },
  codeBox: {
    backgroundColor: C.brandTertiary,
    borderRadius: R.lg,
    paddingVertical: S["2xl"],
    alignItems: "center",
    marginBottom: S.xl,
  },
  codeText: { fontFamily: F.bold, fontSize: 44, letterSpacing: 8, color: C.onBrandTertiary },
  copyRow: { flexDirection: "row", alignItems: "center", gap: S.xs, marginTop: S.md },
  copyText: { fontFamily: F.medium, fontSize: type.base, color: C.brandPrimary },
  waiting: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: S.sm },
  waitingText: { fontFamily: F.medium, fontSize: type.base, color: C.onSurfaceSecondary },
  input: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: R.md,
    paddingHorizontal: S.lg,
    paddingVertical: S.lg,
    fontFamily: F.bold,
    fontSize: type["2xl"],
    letterSpacing: 6,
    textAlign: "center",
    color: C.onSurface,
    marginBottom: S.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  primaryBtn: { backgroundColor: C.brandPrimary, borderRadius: R.lg, paddingVertical: S.lg, alignItems: "center" },
  primaryText: { fontFamily: F.semibold, fontSize: type.lg, color: C.onBrandPrimary },
  error: { fontFamily: F.medium, fontSize: type.base, color: C.error, marginTop: S.lg, textAlign: "center" },
});
