import { storage } from "@/src/utils/storage";

// Lets the user point the app at the correct backend on-device (e.g. after a
// preview URL changes) WITHOUT rebuilding the APK. Falls back to the value
// baked in at build time via EXPO_PUBLIC_BACKEND_URL.
const OVERRIDE_KEY = "tw_api_base_v1";

// Turn whatever the user (or env) provides into a clean host origin:
// - trims whitespace and trailing slashes
// - adds https:// if the scheme is missing
// - strips a trailing /api so we never end up with /api/api
export function normalizeHost(raw: string): string {
  let s = (raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  s = s.replace(/\/+$/, "");
  s = s.replace(/\/api$/i, "");
  return s;
}

const ENV_HOST = normalizeHost(process.env.EXPO_PUBLIC_BACKEND_URL || "");

let cachedHost = ENV_HOST;

// Load any saved override once at app start (called from AuthProvider boot).
export async function loadApiBase(): Promise<void> {
  const stored = await storage.getItem<string>(OVERRIDE_KEY, "");
  const n = normalizeHost(stored || "");
  cachedHost = n || ENV_HOST;
}

// Full base URL used for API calls, e.g. https://host/api
export function getApiBase(): string {
  return (cachedHost || ENV_HOST) + "/api";
}

// The host currently in effect (for display in the settings screen).
export function getServerHost(): string {
  return cachedHost || ENV_HOST;
}

// Save (or clear) the override. Empty string reverts to the build-time value.
export async function setServerHost(url: string): Promise<void> {
  const n = normalizeHost(url);
  cachedHost = n || ENV_HOST;
  if (n) await storage.setItem(OVERRIDE_KEY, n);
  else await storage.removeItem(OVERRIDE_KEY);
}
