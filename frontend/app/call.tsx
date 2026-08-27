import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { C, F, S, R, type } from "@/src/theme/theme";

// Real LiveKit calling only runs in a development/production build (not Expo Go / web).
const CAN_CALL = Platform.OS !== "web" && Constants.executionEnvironment !== "storeClient";
let LiveCall: any = null;
if (CAN_CALL) {
  try {
    LiveCall = require("@/src/components/LiveCall").default;
  } catch {
    LiveCall = null;
  }
}

export default function CallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { partner } = useAuth();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isVideo = mode === "video";

  // On a real device build, render the live call engine.
  if (CAN_CALL && LiveCall) {
    return (
      <View style={{ flex: 1, backgroundColor: C.surfaceInverse }}>
        <LiveCall
          isVideo={isVideo}
          partnerName={partner?.display_name || "Your partner"}
          onEnd={() => router.back()}
        />
      </View>
    );
  }

  return <CallScaffold />;
}

function CallScaffold() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { partner } = useAuth();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isVideo = mode === "video";

  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(isVideo);
  const [speaker, setSpeaker] = useState(true);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const initial = (partner?.display_name || "?").charAt(0).toUpperCase();
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  const end = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    router.back();
  };

  return (
    <View style={styles.container} testID="call-screen">
      <LinearGradient colors={["#3A2E2C", C.surfaceInverse]} style={StyleSheet.absoluteFill} />

      <View style={[styles.top, { paddingTop: insets.top + S.xl }]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.name}>{partner?.display_name || "Your partner"}</Text>
        <View style={styles.statusRow}>
          <Ionicons name="lock-closed" size={12} color="rgba(255,255,255,0.7)" />
          <Text style={styles.status}>{isVideo ? "Video call" : "Voice call"} · {mmss}</Text>
        </View>

        <View style={styles.banner} testID="call-banner">
          <Ionicons name="information-circle" size={16} color={C.brandSecondary} />
          <Text style={styles.bannerText}>
            Calling activates on your installed app build. This is a preview of the call
            screen.
          </Text>
        </View>
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + S["2xl"] }]}>
        <View style={styles.row}>
          <CtrlButton
            testID="call-mute"
            icon={muted ? "mic-off" : "mic"}
            label={muted ? "Unmute" : "Mute"}
            active={muted}
            onPress={() => { Haptics.selectionAsync(); setMuted((m) => !m); }}
          />
          <CtrlButton
            testID="call-speaker"
            icon={speaker ? "volume-high" : "volume-mute"}
            label="Speaker"
            active={speaker}
            onPress={() => { Haptics.selectionAsync(); setSpeaker((s) => !s); }}
          />
          <CtrlButton
            testID="call-video"
            icon={videoOn ? "videocam" : "videocam-off"}
            label={videoOn ? "Video" : "Video off"}
            active={videoOn}
            onPress={() => { Haptics.selectionAsync(); setVideoOn((v) => !v); }}
          />
        </View>

        <Pressable style={styles.endBtn} onPress={end} testID="call-end">
          <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
        </Pressable>
      </View>
    </View>
  );
}

function CtrlButton({
  icon,
  label,
  active,
  onPress,
  testID,
}: {
  icon: any;
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable style={styles.ctrl} onPress={onPress} testID={testID}>
      <View style={[styles.ctrlIcon, active && styles.ctrlActive]}>
        <Ionicons name={icon} size={24} color={active ? C.surfaceInverse : "#fff"} />
      </View>
      <Text style={styles.ctrlLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.surfaceInverse },
  top: { alignItems: "center", flex: 1, paddingHorizontal: S.xl },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: R.pill,
    backgroundColor: C.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: S["3xl"],
  },
  avatarText: { fontFamily: F.bold, fontSize: 52, color: C.onBrandPrimary },
  name: { fontFamily: F.bold, fontSize: type.display, color: "#fff", marginTop: S.xl },
  statusRow: { flexDirection: "row", alignItems: "center", gap: S.xs, marginTop: S.sm },
  status: { fontFamily: F.medium, fontSize: type.lg, color: "rgba(255,255,255,0.7)" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.sm,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: R.md,
    padding: S.md,
    marginTop: S["2xl"],
  },
  bannerText: { flex: 1, fontFamily: F.regular, fontSize: type.sm, color: "rgba(255,255,255,0.85)", lineHeight: 18 },
  controls: { alignItems: "center", gap: S["2xl"] },
  row: { flexDirection: "row", gap: S["2xl"] },
  ctrl: { alignItems: "center", gap: S.sm },
  ctrlIcon: {
    width: 60,
    height: 60,
    borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlActive: { backgroundColor: "#fff" },
  ctrlLabel: { fontFamily: F.medium, fontSize: type.sm, color: "rgba(255,255,255,0.85)" },
  endBtn: {
    width: 68,
    height: 68,
    borderRadius: R.pill,
    backgroundColor: C.error,
    alignItems: "center",
    justifyContent: "center",
  },
});
