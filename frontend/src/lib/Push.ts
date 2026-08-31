import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "@/src/lib/api";

// Registers this device with the backend so it can receive push notifications
// for new messages. Safe to call every login — the backend upserts.
export async function registerForPush(userId: string): Promise<void> {
  try {
    if (Platform.OS === "web") return;             // no push on web
    if (!Device.isDevice) return;                  // no push in simulators

    // 1) Permission
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;

    // 2) Token
    const projectId =
      (Constants.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )).data;
    if (!token) return;

    // 3) Send to backend
    await api.registerPush(Platform.OS, token, userId);
  } catch (e) {
    // Non-blocking — user still gets in-app realtime via WebSocket.
    console.warn("[push] register failed:", e);
  }
}
