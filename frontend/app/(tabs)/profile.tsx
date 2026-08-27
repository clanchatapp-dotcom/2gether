import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { C, F, S, R, type } from "@/src/theme/theme";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, partner, signOut, unpairAndReset } = useAuth() as any;
  const [confirm, setConfirm] = useState<null | "signout" | "unpair">(null);

  const myInitial = (user?.display_name || "?").charAt(0).toUpperCase();
  const theirInitial = (partner?.display_name || "?").charAt(0).toUpperCase();

  const doSignOut = async () => {
    setConfirm(null);
    await signOut();
    router.replace("/welcome");
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + S.sm }]}>
        <Text style={styles.headerTitle}>Us</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingBottom: insets.bottom + 96 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Pair card */}
        <View style={styles.pairCard}>
          <View style={styles.avatars}>
            <View style={[styles.avatar, { backgroundColor: C.brandPrimary }]}>
              <Text style={[styles.avatarText, { color: C.onBrandPrimary }]}>{myInitial}</Text>
            </View>
            <View style={styles.heartBadge}>
              <Ionicons name="heart" size={16} color={C.brandPrimary} />
            </View>
            <View style={[styles.avatar, styles.avatarOverlap]}>
              <Text style={styles.avatarText}>{theirInitial}</Text>
            </View>
          </View>
          <Text style={styles.pairNames}>
            {user?.display_name} & {partner?.display_name}
          </Text>
          <View style={styles.connected}>
            <View style={styles.connectedDot} />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
        </View>

        {/* Encryption */}
        <Text style={styles.sectionLabel}>Privacy & security</Text>
        <View style={styles.group}>
          <Row icon="lock-closed" title="Private to the two of you" subtitle="Only you and your partner can see your chats." tint />
          <Divider />
          <Row
            icon="images-outline"
            title="Photo & video controls"
            subtitle="Per-item save, view-once & auto-expire controls."
          />
          <Divider />
          <Row
            icon="scan-outline"
            title="Screenshot protection"
            subtitle="Activates on the installed app build on your device."
          />
        </View>

        {/* Account */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.group}>
          <Row icon="person-outline" title={user?.display_name || ""} subtitle={user?.email || ""} />
        </View>

        <Pressable
          testID="profile-unpair"
          style={styles.dangerBtn}
          onPress={() => setConfirm("unpair")}
        >
          <Ionicons name="heart-dislike-outline" size={18} color={C.error} />
          <Text style={styles.dangerText}>Disconnect from partner</Text>
        </Pressable>

        <Pressable
          testID="profile-signout"
          style={styles.signoutBtn}
          onPress={() => {
            Haptics.selectionAsync();
            setConfirm("signout");
          }}
        >
          <Text style={styles.signoutText}>Sign out</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={confirm !== null} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <Pressable style={styles.scrim} onPress={() => setConfirm(null)}>
          <View style={styles.confirmCard} testID="profile-confirm-modal">
            <Text style={styles.confirmTitle}>
              {confirm === "unpair" ? "Disconnect?" : "Sign out?"}
            </Text>
            <Text style={styles.confirmText}>
              {confirm === "unpair"
                ? "This ends your connection. You'll each need to pair again to reconnect."
                : "You can sign back in anytime with your email and password."}
            </Text>
            <Pressable
              style={styles.confirmBtn}
              testID="profile-confirm-yes"
              onPress={async () => {
                if (confirm === "unpair") {
                  setConfirm(null);
                  await unpairAndReset?.();
                  router.replace("/pair");
                } else {
                  doSignOut();
                }
              }}
            >
              <Text style={styles.confirmBtnText}>
                {confirm === "unpair" ? "Disconnect" : "Sign out"}
              </Text>
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={() => setConfirm(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Row({
  icon,
  title,
  subtitle,
  tint,
}: {
  icon: any;
  title: string;
  subtitle: string;
  tint?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, tint && { backgroundColor: C.brandTertiary }]}>
        <Ionicons name={icon} size={18} color={tint ? C.brandPrimary : C.onSurfaceSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
    </View>
  );
}

const Divider = () => <View style={styles.divider} />;

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
  pairCard: {
    alignItems: "center",
    backgroundColor: C.brandTertiary,
    borderRadius: R.lg,
    paddingVertical: S.xl,
    marginBottom: S.xl,
  },
  avatars: { flexDirection: "row", alignItems: "center", marginBottom: S.md },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: R.pill,
    backgroundColor: C.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: C.brandTertiary,
  },
  avatarOverlap: { marginLeft: -14, backgroundColor: C.surface },
  avatarText: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface },
  heartBadge: {
    width: 28,
    height: 28,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: -8,
    zIndex: 2,
  },
  pairNames: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface },
  connected: { flexDirection: "row", alignItems: "center", gap: S.xs, marginTop: S.xs },
  connectedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.success },
  connectedText: { fontFamily: F.medium, fontSize: type.base, color: C.success },
  sectionLabel: { fontFamily: F.semibold, fontSize: type.base, color: C.muted, marginBottom: S.sm, marginTop: S.md },
  group: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: R.lg,
    paddingHorizontal: S.lg,
    marginBottom: S.md,
    borderWidth: 1,
    borderColor: C.border,
  },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.lg },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: R.pill,
    backgroundColor: C.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontFamily: F.semibold, fontSize: type.lg, color: C.onSurface },
  rowSub: { fontFamily: F.regular, fontSize: type.sm, color: C.onSurfaceSecondary, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.border },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: S.sm,
    paddingVertical: S.lg,
    marginTop: S.md,
  },
  dangerText: { fontFamily: F.semibold, fontSize: type.lg, color: C.error },
  signoutBtn: { alignItems: "center", paddingVertical: S.md },
  signoutText: { fontFamily: F.medium, fontSize: type.base, color: C.onSurfaceSecondary },
  scrim: { flex: 1, backgroundColor: "rgba(43,37,36,0.5)", alignItems: "center", justifyContent: "center", padding: S["2xl"] },
  confirmCard: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.xl, width: "100%" },
  confirmTitle: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface, marginBottom: S.sm },
  confirmText: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, lineHeight: 22, marginBottom: S.xl },
  confirmBtn: { backgroundColor: C.error, borderRadius: R.lg, paddingVertical: S.lg, alignItems: "center", marginBottom: S.sm },
  confirmBtnText: { fontFamily: F.semibold, fontSize: type.lg, color: C.onError },
  cancelBtn: { alignItems: "center", paddingVertical: S.md },
  cancelText: { fontFamily: F.medium, fontSize: type.base, color: C.onSurfaceSecondary },
});
