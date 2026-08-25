import { useEffect, useState } from "react";
import { View, Text, StyleSheet, AppState } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useScreenshotGuard } from "@/src/lib/screenshot";
import { C, F, S, R, type } from "@/src/theme/theme";

// Wraps private content: blocks/detects screenshots and hides content when the
// app goes to the background (prevents it appearing in the iOS app switcher snapshot).
export function PrivacyGuard({
  partnerPub,
  label,
  children,
}: {
  partnerPub?: string;
  label: string;
  children: React.ReactNode;
}) {
  useScreenshotGuard(partnerPub, label);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      setHidden(state !== "active");
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {hidden ? (
        <View style={styles.cover} testID="privacy-cover">
          <Ionicons name="lock-closed" size={30} color={C.brandPrimary} />
          <Text style={styles.coverText}>Hidden for privacy</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: S.md,
  },
  coverText: { fontFamily: F.semibold, fontSize: type.lg, color: C.onSurfaceSecondary },
});
