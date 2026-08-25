import { View, Text, StyleSheet, Pressable, ImageBackground } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { C, F, S, R, type } from "@/src/theme/theme";

const HERO =
  "https://images.unsplash.com/photo-1480618376353-2950ee462b17?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200";

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container} testID="welcome-screen">
      <ImageBackground source={{ uri: HERO }} style={styles.hero}>
        <LinearGradient
          colors={["rgba(43,37,36,0.15)", "rgba(43,37,36,0.55)", C.surface]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
      </ImageBackground>

      <View style={[styles.content, { paddingBottom: insets.bottom + S.xl }]}>
        <View style={styles.logoRow}>
          <Image
            source={require("../assets/images/logo.png")}
            style={styles.logo}
            contentFit="contain"
          />
        </View>
        <Text style={styles.title}>A space just for the two of you</Text>
        <Text style={styles.subtitle}>
          Private, end-to-end encrypted, and built for one relationship. No groups, no noise —
          just you and your person.
        </Text>

        <View style={styles.features}>
          <Feature icon="lock-closed" text="End-to-end encrypted" />
          <Feature icon="heart" text="Shared calendar & worries space" />
          <Feature icon="people" text="Exactly two, always private" />
        </View>

        <Pressable
          testID="welcome-get-started-button"
          style={styles.primaryBtn}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/register");
          }}
        >
          <Text style={styles.primaryText}>Get started</Text>
        </Pressable>
        <Pressable
          testID="welcome-login-link"
          style={styles.secondaryBtn}
          onPress={() => router.push("/login")}
        >
          <Text style={styles.secondaryText}>I already have an account</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Feature({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={16} color={C.brandPrimary} />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surface },
  hero: { height: "48%", width: "100%" },
  content: { flex: 1, paddingHorizontal: S.xl, marginTop: -S["2xl"] },
  logoRow: { alignItems: "flex-start", marginBottom: S.sm },
  logo: { width: 96, height: 96 },
  title: {
    fontFamily: F.bold,
    fontSize: type.display,
    color: C.onSurface,
    lineHeight: 40,
    marginBottom: S.md,
  },
  subtitle: {
    fontFamily: F.regular,
    fontSize: type.lg,
    color: C.onSurfaceSecondary,
    lineHeight: 24,
  },
  features: { marginTop: S.xl, gap: S.md },
  feature: { flexDirection: "row", alignItems: "center", gap: S.md },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: R.pill,
    backgroundColor: C.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { fontFamily: F.medium, fontSize: type.base, color: C.onSurface },
  primaryBtn: {
    marginTop: "auto",
    backgroundColor: C.brandPrimary,
    borderRadius: R.lg,
    paddingVertical: S.lg,
    alignItems: "center",
  },
  primaryText: { fontFamily: F.semibold, fontSize: type.lg, color: C.onBrandPrimary },
  secondaryBtn: { paddingVertical: S.md, alignItems: "center", marginTop: S.xs },
  secondaryText: { fontFamily: F.medium, fontSize: type.base, color: C.onSurfaceSecondary },
});
