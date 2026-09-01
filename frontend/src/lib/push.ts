import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { api } from "@/src/lib/api";

/**
 * Register device for push notifications.
 * Sends the device token to the backend so it can send push notifications.
 */
export async function registerForPush(userId: string): Promise<void> {
  try {
    // Skip on web platform
    if (Platform.OS === "web") {
      console.log("[Push] Skipping push registration on web");
      return;
    }

    console.log(`[Push] Registering device for push notifications (user: ${userId})`);

    // Request permission
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      console.log("[Push] Requesting notification permissions...");
      const result = await Notifications.requestPermissionsAsync();
      if (result.status !== "granted") {
        console.warn("[Push] Push notification permission denied");
        return;
      }
    }

    // Get the device token
    const token = await Notifications.getExpoPushTokenAsync();
    console.log(`[Push] Got device token: ${token.data}`);

    // Determine platform
    const platform = Platform.OS === "ios" ? "ios" : "android";

    // Register with backend using the api module
    try {
      console.log(`[Push] Sending device token to backend...`);
      const result = await api.registerPush(platform, token.data, userId);
      console.log(`[Push] Successfully registered with backend:`, result);
    } catch (e: any) {
      console.warn("[Push] Failed to register with backend:", e.message);
    }
  } catch (e) {
    console.error("[Push] Error in registerForPush:", e);
  }
}

/**
 * Set up push notification handler.
 * Call this once in your app's root component.
 */
export function setupPushNotificationHandler(): void {
  if (Platform.OS === "web") return;

  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      console.log("[Push] Received notification:", notification);
      return {
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      };
    },
  });
}
