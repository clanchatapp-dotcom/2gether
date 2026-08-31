import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, AppState, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useScreenshotGuard } from "@/src/lib/screenshot";
import { C, F, S, R, type } from "@/src/theme/theme";

// Wraps private content: blocks/detects screenshots and hides content when the
// app goes to the background (prevents it appearing in the iOS app switcher snapshot).
// Also shows a temporary blur overlay when a screenshot is detected.
export function PrivacyGuard({
  partnerPub,
  label,
  children,
}: {
  partnerPub?: string;
  label: string;
  children: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(false);
  const [screenshotBlurred, setScreenshotBlurred] = useState(false);
  const blurOpacity = useState(new Animated.Value(0))[0];

  const handleScreenshot = useCallback((userName: string) => {
    // Show blur overlay immediately
    setScreenshotBlurred(true);
    
    // Animate blur in
    Animated.timing(blurOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    // Auto-fade out after 2 seconds
    const timer = setTimeout(() => {
      Animated.timing(blurOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        setScreenshotBlurred(false);
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [blurOpacity]);

  useScreenshotGuard(partnerPub, label, handleScreenshot);

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
      {screenshotBlurred ? (
        <Animated.View
          style={[
            styles.screenshotBlur,
            {
              opacity: blurOpacity,
            },
          ]}
          testID="screenshot-blur"
        >
          <View style={styles.screenshotAlert}>
            <Ionicons name="camera" size={32} color={C.error} />
            <Text style={styles.screenshotAlertText}>Screenshot detected</Text>
            <Text style={styles.screenshotAlertSub}>Your partner has been notified</Text>
          </View>
        </Animated.View>
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
  screenshotBlur: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  screenshotAlert: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    paddingHorizontal: S.xl,
    paddingVertical: S["2xl"],
    alignItems: "center",
    gap: S.md,
    borderWidth: 2,
    borderColor: C.error,
  },
  screenshotAlertText: {
    fontFamily: F.bold,
    fontSize: type.lg,
    color: C.error,
    textAlign: "center",
  },
  screenshotAlertSub: {
    fontFamily: F.regular,
    fontSize: type.base,
    color: C.onSurfaceSecondary,
    textAlign: "center",
  },
});
