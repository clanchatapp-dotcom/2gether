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

export default function Register() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim() || !email.trim() || password.length < 6) {
      setError("Enter your name, email, and a password (6+ characters).");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (e: any) {
      setError(e.message || "Could not create account.");
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
        <Pressable testID="register-back" onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={C.onSurface} />
        </Pressable>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>One account, one connection. Let's set you up.</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            testID="register-name-input"
            style={styles.input}
            placeholder="e.g. Sam"
            placeholderTextColor={C.muted}
            value={name}
            onChangeText={setName}
          />
          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="register-email-input"
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
            testID="register-password-input"
            style={styles.input}
            placeholder="At least 6 characters"
            placeholderTextColor={C.muted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error ? (
            <Text style={styles.error} testID="register-error">
              {error}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + S.md }]}>
        <Pressable
          testID="register-submit-button"
          style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
          disabled={loading}
          onPress={submit}
        >
          <Text style={styles.primaryText}>{loading ? "Creating…" : "Create account"}</Text>
        </Pressable>
        <Pressable testID="register-to-login" onPress={() => router.replace("/login")}>
          <Text style={styles.switchText}>
            Already have an account? <Text style={styles.switchLink}>Sign in</Text>
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
