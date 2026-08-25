import * as Calendar from "expo-calendar";
import { Platform } from "react-native";

export type SyncResult =
  | { ok: true }
  | { ok: false; reason: "permission" | "error" };

async function ensurePermission(): Promise<boolean> {
  const cur = await Calendar.getCalendarPermissionsAsync();
  let status = cur.status;
  if (status !== "granted") {
    const req = await Calendar.requestCalendarPermissionsAsync();
    status = req.status;
  }
  return status === "granted";
}

async function getWritableCalendarId(): Promise<string> {
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const existing = cals.find((c) => c.title === "Twogether" && c.allowsModifications);
  if (existing) return existing.id;

  let source: any;
  if (Platform.OS === "ios") {
    const def = await Calendar.getDefaultCalendarAsync();
    source = def.source;
  } else {
    const writable = cals.find((c) => c.allowsModifications);
    source =
      writable?.source ||
      ({ isLocalAccount: true, name: "Twogether", type: Calendar.SourceType.LOCAL } as any);
  }
  return Calendar.createCalendarAsync({
    title: "Twogether",
    color: "#D92525",
    entityType: Calendar.EntityTypes.EVENT,
    sourceId: source?.id,
    source,
    name: "Twogether",
    ownerAccount: "Twogether",
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
}

// Writes an all-day event on the given yyyy-mm-dd date to the phone calendar.
export async function syncEventToPhone(title: string, dateIso: string, note?: string): Promise<SyncResult> {
  try {
    const granted = await ensurePermission();
    if (!granted) return { ok: false, reason: "permission" };
    const calId = await getWritableCalendarId();
    const [y, m, d] = dateIso.split("-").map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0);
    const end = new Date(y, m - 1, d + 1, 0, 0, 0);
    await Calendar.createEventAsync(calId, {
      title: `💞 ${title}`,
      startDate: start,
      endDate: end,
      allDay: true,
      notes: note || "Added from Twogether",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}
