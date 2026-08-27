import { storage } from "@/src/utils/storage";
import { getApiBase } from "@/src/lib/config";

const TOKEN_KEY = "tw_token_v1";

async function req(path: string, opts: any = {}) {
  const token = await storage.secureGet(TOKEN_KEY, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(getApiBase() + path, { ...opts, headers });
  const text = await res.text();
  const looksHtml = text.trim().startsWith("<");

  // A proxy/region gate (or a wrong Server address) returns an HTML page
  // instead of our JSON API. Surface a clean, actionable message rather than
  // dumping raw HTML into the UI.
  if (looksHtml) {
    if (/region restricted/i.test(text)) {
      throw new Error(
        "This server is region-restricted (preview only). The app owner needs to deploy to production and use that URL in Server settings.",
      );
    }
    throw new Error(
      "Can't reach the app server. Check the Server address in login → Server settings.",
    );
  }

  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

export const api = {
  setToken: (t: string) => storage.secureSet(TOKEN_KEY, t),
  getToken: () => storage.secureGet(TOKEN_KEY, ""),
  clearToken: () => storage.secureRemove(TOKEN_KEY),

  register: (body: any) => req("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: any) => req("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  me: () => req("/me"),
  updatePublicKey: (public_key: string) =>
    req("/me/public-key", { method: "PUT", body: JSON.stringify({ public_key }) }),

  pairCreate: () => req("/pair/create", { method: "POST" }),
  pairRedeem: (code: string) => req("/pair/redeem", { method: "POST", body: JSON.stringify({ code }) }),
  getPair: () => req("/pair"),
  unpair: () => req("/pair", { method: "DELETE" }),

  getMessages: (after?: string) =>
    req("/messages" + (after ? `?after=${encodeURIComponent(after)}` : "")),
  sendMessage: (body: any) => req("/messages", { method: "POST", body: JSON.stringify(body) }),
  markViewed: (id: string) => req(`/messages/${id}/viewed`, { method: "POST" }),
  uploadMedia: (data_b64: string, mime: string, kind: string) =>
    req("/media/upload", { method: "POST", body: JSON.stringify({ data_b64, mime, kind }) }),

  getWorries: () => req("/worries"),
  addWorry: (body: any) => req("/worries", { method: "POST", body: JSON.stringify(body) }),
  resolveWorry: (id: string) => req(`/worries/${id}`, { method: "PATCH" }),

  getEvents: () => req("/events"),
  addEvent: (body: any) => req("/events", { method: "POST", body: JSON.stringify(body) }),
  deleteEvent: (id: string) => req(`/events/${id}`, { method: "DELETE" }),

  getCheckins: () => req("/checkins"),
  addCheckin: (body: any) => req("/checkins", { method: "POST", body: JSON.stringify(body) }),
  reactCheckin: (id: string, emoji: string) =>
    req(`/checkins/${id}/react`, { method: "POST", body: JSON.stringify({ emoji }) }),

  getGallery: () => req("/gallery"),
  livekitToken: () => req("/livekit/token", { method: "POST" }),
};
