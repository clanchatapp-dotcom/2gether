import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as ScreenCapture from "expo-screen-capture";
import { encryptMessage } from "@/src/lib/crypto";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";

// Blocks screenshots on Android (FLAG_SECURE). On iOS blocking is impossible,
// so we DETECT a screenshot and notify the partner with an encrypted system message.
// Also triggers a temporary blur overlay to prevent screenshot content visibility.
export function useScreenshotGuard(
  partnerPub: string | undefined,
  contextLabel: string,
  onScreenshot?: (userName: string) => void,
) {
  const { user } = useAuth();

  useEffect(() => {
    // Screenshot blocking (Android) and detection (iOS) are device-only.
    // On web the module has no listener support, so no-op gracefully.
    if (Platform.OS === "web") return;
    let active = true;
    ScreenCapture.preventScreenCaptureAsync?.().catch(() => {});

    let sub: any = null;
    try {
      sub = ScreenCapture.addScreenshotListener?.(async () => {
        if (!active || !partnerPub || !user) return;
        try {
          // Send encrypted system message to partner with current user's name
          const userName = user.display_name || "Your partner";
          const enc = await encryptMessage(`📸 ${userName} took a screenshot of ${contextLabel}`, partnerPub);
          await api.sendMessage({ ...enc, kind: "system" });
          
          // Trigger callback to show blur overlay on the current device
          onScreenshot?.(userName);
        } catch {}
      });
    } catch {}

    return () => {
      active = false;
      ScreenCapture.allowScreenCaptureAsync?.().catch(() => {});
      // @ts-ignore
      sub?.remove?.();
    };
  }, [partnerPub, contextLabel, user, onScreenshot]);
}

export const isIOS = Platform.OS === "ios";
