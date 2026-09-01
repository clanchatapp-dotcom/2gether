import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

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

    // Register with backend
    try {
      const response = await fetch("http://localhost:3000/api/register-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          platform,
          device_token: token.data,
        }),
      });

      if (response.ok) {
        console.log("[Push] Successfully registered with backend");
      } else {
        console.warn(`[Push] Backend registration failed: ${response.status}`);
      }
    } catch (e) {
      console.warn("[Push] Failed to register with backend:", e);
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
