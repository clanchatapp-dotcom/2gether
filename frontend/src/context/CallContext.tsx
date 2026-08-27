import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, Modal, Vibration, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { useRealtime } from "@/src/lib/realtime";
import { C, F, S, R, type } from "@/src/theme/theme";

type CallState = {
  startCall: (mode: "voice" | "video") => void;
};

const CallCtx = createContext<CallState>({ startCall: () => {} });
export const useCall = () => useContext(CallCtx);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { partner } = useAuth();
  const [incoming, setIncoming] = useState<{ name: string; mode: "voice" | "video" } | null>(null);
  const [declinedToast, setDeclinedToast] = useState(false);
  const outgoing = useRef(false);
  const ringTimer = useRef<any>(null);

  const stopRing = useCallback(() => {
    clearInterval(ringTimer.current);
    if (Platform.OS !== "web") Vibration.cancel();
  }, []);

  const startRing = useCallback(() => {
    if (Platform.OS !== "web") {
      Vibration.vibrate([0, 600, 800], true);
    }
    ringTimer.current = setInterval(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }, 1500);
  }, []);

  const handleEvent = useCallback(
    (e: any) => {
      if (e.type === "call_invite") {
        setIncoming({ name: e.name || "Your partner", mode: e.mode === "video" ? "video" : "voice" });
        startRing();
      } else if (e.type === "call_cancel") {
        setIncoming(null);
        stopRing();
      } else if (e.type === "call_decline") {
        if (outgoing.current) {
          outgoing.current = false;
          setDeclinedToast(true);
          setTimeout(() => setDeclinedToast(false), 2500);
        }
      }
    },
    [startRing, stopRing],
  );

  const { send: wsSend } = useRealtime(handleEvent, !!partner);

  useEffect(() => () => stopRing(), [stopRing]);

  const startCall = useCallback(
    (mode: "voice" | "video") => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      outgoing.current = true;
      wsSend({ type: "call_invite", mode });
      router.push(`/call?mode=${mode}`);
    },
    [wsSend, router],
  );

  const accept = () => {
    const mode = incoming?.mode || "voice";
    stopRing();
    wsSend({ type: "call_accept" });
    setIncoming(null);
    router.push(`/call?mode=${mode}`);
  };

  const decline = () => {
    stopRing();
    wsSend({ type: "call_decline" });
    setIncoming(null);
  };

  return (
    <CallCtx.Provider value={{ startCall }}>
      {children}

      <Modal visible={!!incoming} transparent animationType="slide" onRequestClose={decline}>
        <View style={styles.scrim}>
          <View style={styles.header}>
            <Text style={styles.incomingLabel}>
              Incoming {incoming?.mode === "video" ? "video" : "voice"} call
            </Text>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(incoming?.name || "?").charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.name}>{incoming?.name}</Text>
            <View style={styles.e2e}>
              <Ionicons name="lock-closed" size={12} color="rgba(255,255,255,0.7)" />
              <Text style={styles.e2eText}>Private call</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable style={styles.actionCol} onPress={decline} testID="incoming-decline">
              <View style={[styles.actionBtn, styles.declineBtn]}>
                <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
              </View>
              <Text style={styles.actionLabel}>Decline</Text>
            </Pressable>
            <Pressable style={styles.actionCol} onPress={accept} testID="incoming-accept">
              <View style={[styles.actionBtn, styles.acceptBtn]}>
                <Ionicons name={incoming?.mode === "video" ? "videocam" : "call"} size={28} color="#fff" />
              </View>
              <Text style={styles.actionLabel}>Accept</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {declinedToast ? (
        <View style={styles.declinedToast} pointerEvents="none">
          <Text style={styles.declinedText}>Call declined</Text>
        </View>
      ) : null}
    </CallCtx.Provider>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: C.surfaceInverse, justifyContent: "space-between", paddingVertical: 80 },
  header: { alignItems: "center", marginTop: 40 },
  incomingLabel: { fontFamily: F.medium, fontSize: type.lg, color: "rgba(255,255,255,0.7)", marginBottom: S.xl },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: R.pill,
    backgroundColor: C.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: F.bold, fontSize: 46, color: "#fff" },
  name: { fontFamily: F.bold, fontSize: type.display, color: "#fff", marginTop: S.lg },
  e2e: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: S.sm },
  e2eText: { fontFamily: F.regular, fontSize: type.sm, color: "rgba(255,255,255,0.7)" },
  actions: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: S.xl },
  actionCol: { alignItems: "center", gap: S.sm },
  actionBtn: { width: 68, height: 68, borderRadius: R.pill, alignItems: "center", justifyContent: "center" },
  declineBtn: { backgroundColor: C.error },
  acceptBtn: { backgroundColor: C.success },
  actionLabel: { fontFamily: F.medium, fontSize: type.base, color: "#fff" },
  declinedToast: {
    position: "absolute",
    top: 80,
    alignSelf: "center",
    backgroundColor: C.surfaceInverse,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderRadius: R.pill,
  },
  declinedText: { fontFamily: F.medium, fontSize: type.base, color: "#fff" },
});
