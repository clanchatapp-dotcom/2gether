import { useEffect } from "react";
import { Platform } from "react-native";
import * as ScreenCapture from "expo-screen-capture";
import { encryptMessage } from "@/src/lib/crypto";
import { api } from "@/src/lib/api";

// Blocks screenshots on Android (FLAG_SECURE). On iOS blocking is impossible,
// so we DETECT a screenshot and notify the partner with an encrypted system message.
export function useScreenshotGuard(partnerPub: string | undefined, contextLabel: string) {
  useEffect(() => {
    // Screenshot blocking (Android) and detection (iOS) are device-only.
    // On web the module has no listener support, so no-op gracefully.
    if (Platform.OS === "web") return;
    let active = true;
    ScreenCapture.preventScreenCaptureAsync?.().catch(() => {});

    let sub: any = null;
    try {
      sub = ScreenCapture.addScreenshotListener?.(async () => {
        if (!active || !partnerPub) return;
        try {
          const enc = await encryptMessage(`📸 took a screenshot of ${contextLabel}`, partnerPub);
          await api.sendMessage({ ...enc, kind: "system" });
        } catch {}
      });
    } catch {}

    return () => {
      active = false;
      ScreenCapture.allowScreenCaptureAsync?.().catch(() => {});
      // @ts-ignore
      sub?.remove?.();
    };
  }, [partnerPub, contextLabel]);
}

export const isIOS = Platform.OS === "ios";
