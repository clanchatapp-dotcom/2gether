import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  LiveKitRoom,
  AudioSession,
  useTracks,
  VideoTrack,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  registerGlobals,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import { api } from "@/src/lib/api";
import { C, F, S, R, type } from "@/src/theme/theme";

registerGlobals();

export default function LiveCall({
  isVideo,
  partnerName,
  onEnd,
}: {
  isVideo: boolean;
  partnerName: string;
  onEnd: () => void;
}) {
  const [creds, setCreds] = useState<{ server_url: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    AudioSession.startAudioSession().catch(() => {});
    api
      .livekitToken()
      .then((res) => mounted && setCreds({ server_url: res.server_url, token: res.token }))
      .catch((e) => mounted && setError(e.message || "Couldn't start the call"));
    return () => {
      mounted = false;
      AudioSession.stopAudioSession().catch(() => {});
    };
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="warning" size={28} color={C.brandSecondary} />
        <Text style={styles.centerText}>{error}</Text>
        <Pressable style={styles.endBtn} onPress={onEnd}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>
    );
  }

  if (!creds) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" size="large" />
        <Text style={styles.centerText}>Connecting…</Text>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={creds.server_url}
      token={creds.token}
      connect
      audio
      video={isVideo}
      onDisconnected={onEnd}
      onError={(e: any) => setError(e?.message || "Call error")}
      style={{ flex: 1 }}
    >
      <RoomView isVideo={isVideo} partnerName={partnerName} onEnd={onEnd} />
    </LiveKitRoom>
  );
}

function RoomView({ isVideo, partnerName, onEnd }: { isVideo: boolean; partnerName: string; onEnd: () => void }) {
  const insets = useSafeAreaInsets();
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(isVideo);

  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remoteTrack = tracks.find((t) => !t.participant.isLocal);
  const localTrack = tracks.find((t) => t.participant.isLocal);
  const remoteJoined = participants.some((p) => !p.isLocal);
  // Show remote full-screen once they join; otherwise show my own camera full-screen.
  const mainTrack = remoteTrack || localTrack;

  const toggleMute = async () => {
    Haptics.selectionAsync();
    const next = !muted;
    setMuted(next);
    await localParticipant.setMicrophoneEnabled(!next);
  };
  const toggleCam = async () => {
    Haptics.selectionAsync();
    const next = !camOn;
    setCamOn(next);
    await localParticipant.setCameraEnabled(next);
  };
  const end = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await room.disconnect();
    } catch {}
    onEnd();
  };

  return (
    <View style={styles.room}>
      {isVideo && mainTrack && camOn ? (
        <VideoTrack trackRef={mainTrack} style={StyleSheet.absoluteFill} objectFit="cover" />
      ) : (
        <View style={styles.audioBg}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(partnerName || "?").charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{partnerName}</Text>
          <Text style={styles.status}>{remoteJoined ? "Connected" : "Ringing…"}</Text>
        </View>
      )}

      {isVideo && camOn && remoteTrack && localTrack ? (
        <View style={[styles.pip, { top: insets.top + 12 }]}>
          <VideoTrack trackRef={localTrack} style={StyleSheet.absoluteFill} objectFit="cover" />
        </View>
      ) : null}

      {isVideo && !remoteJoined ? (
        <View style={[styles.ringing, { top: insets.top + 24 }]}>
          <Text style={styles.ringingText}>Ringing {partnerName}…</Text>
        </View>
      ) : null}

      <View style={[styles.controls, { paddingBottom: insets.bottom + S["2xl"] }]}>
        <Pressable style={styles.ctrl} onPress={toggleMute} testID="call-mute">
          <View style={[styles.ctrlIcon, muted && styles.ctrlActive]}>
            <Ionicons name={muted ? "mic-off" : "mic"} size={24} color={muted ? C.surfaceInverse : "#fff"} />
          </View>
        </Pressable>
        {isVideo ? (
          <Pressable style={styles.ctrl} onPress={toggleCam} testID="call-video">
            <View style={[styles.ctrlIcon, !camOn && styles.ctrlActive]}>
              <Ionicons name={camOn ? "videocam" : "videocam-off"} size={24} color={!camOn ? C.surfaceInverse : "#fff"} />
            </View>
          </Pressable>
        ) : null}
        <Pressable style={styles.endBtn} onPress={end} testID="call-end">
          <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.surfaceInverse, alignItems: "center", justifyContent: "center", gap: S.lg },
  centerText: { fontFamily: F.medium, fontSize: type.lg, color: "#fff" },
  room: { flex: 1, backgroundColor: C.surfaceInverse },
  audioBg: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: S.md },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: R.pill,
    backgroundColor: C.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: F.bold, fontSize: 52, color: "#fff" },
  name: { fontFamily: F.bold, fontSize: type.display, color: "#fff", marginTop: S.md },
  status: { fontFamily: F.medium, fontSize: type.lg, color: "rgba(255,255,255,0.7)" },
  pip: {
    position: "absolute",
    right: 12,
    width: 100,
    height: 150,
    borderRadius: R.md,
    overflow: "hidden",
    backgroundColor: "#000",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  ringing: { position: "absolute", alignSelf: "center" },
  ringingText: { fontFamily: F.medium, fontSize: type.lg, color: "#fff" },
  controls: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: S["2xl"] },
  ctrl: { alignItems: "center" },
  ctrlIcon: {
    width: 60,
    height: 60,
    borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlActive: { backgroundColor: "#fff" },
  endBtn: {
    width: 68,
    height: 68,
    borderRadius: R.pill,
    backgroundColor: C.error,
    alignItems: "center",
    justifyContent: "center",
  },
});
