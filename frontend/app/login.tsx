import { useState } from "react";
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
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { C, F, S, R, type } from "@/src/theme/theme";

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (e: any) {
      setError(e.message || "Could not sign in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + S.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable testID="login-back" onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={C.onSurface} />
        </Pressable>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to reconnect with your person.</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="login-email-input"
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            testID="login-password-input"
            style={styles.input}
            placeholder="Your password"
            placeholderTextColor={C.muted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error ? (
            <Text style={styles.error} testID="login-error">
              {error}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + S.md }]}>
        <Pressable
          testID="login-submit-button"
          style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
          disabled={loading}
          onPress={submit}
        >
          <Text style={styles.primaryText}>{loading ? "Signing in…" : "Sign in"}</Text>
        </Pressable>
        <Pressable testID="login-to-register" onPress={() => router.replace("/register")}>
          <Text style={styles.switchText}>
            New here? <Text style={styles.switchLink}>Create an account</Text>
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  scroll: { paddingHorizontal: S.xl, flexGrow: 1 },
  back: { marginBottom: S.lg, width: 40 },
  title: { fontFamily: F.bold, fontSize: type.display, color: C.onSurface },
  subtitle: { fontFamily: F.regular, fontSize: type.lg, color: C.onSurfaceSecondary, marginTop: S.xs },
  form: { marginTop: S.xl },
  label: { fontFamily: F.medium, fontSize: type.base, color: C.onSurfaceSecondary, marginBottom: S.sm },
  input: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: R.md,
    paddingHorizontal: S.lg,
    paddingVertical: S.lg,
    fontFamily: F.regular,
    fontSize: type.lg,
    color: C.onSurface,
    marginBottom: S.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  error: { fontFamily: F.medium, fontSize: type.base, color: C.error, marginTop: -S.sm },
  footer: { paddingHorizontal: S.xl, gap: S.md },
  primaryBtn: { backgroundColor: C.brandPrimary, borderRadius: R.lg, paddingVertical: S.lg, alignItems: "center" },
  primaryText: { fontFamily: F.semibold, fontSize: type.lg, color: C.onBrandPrimary },
  switchText: { textAlign: "center", fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary },
  switchLink: { fontFamily: F.semibold, color: C.brandPrimary },
});
