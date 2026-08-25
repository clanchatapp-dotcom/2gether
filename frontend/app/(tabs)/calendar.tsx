import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/src/lib/api";
import { C, F, S, R, type } from "@/src/theme/theme";

type EventItem = {
  id: string;
  title: string;
  note?: string;
  date: string; // yyyy-mm-dd
  shared: boolean;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtLong(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

export default function Calendar() {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(toISO(today));
  const [events, setEvents] = useState<EventItem[]>([]);
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [shared, setShared] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.getEvents();
      setEvents(res.events || []);
    } catch {}
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const eventsByDate = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.date] = (acc[e.date] || 0) + 1;
    return acc;
  }, {});

  const dayEvents = events
    .filter((e) => e.date === selected)
    .sort((a, b) => a.title.localeCompare(b.title));

  const changeMonth = (delta: number) => {
    Haptics.selectionAsync();
    setCursor(new Date(year, month + delta, 1));
  };

  const addEvent = async () => {
    if (!title.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await api.addEvent({ title: title.trim(), note: note.trim() || null, date: selected, shared });
      setTitle("");
      setNote("");
      setShared(true);
      setModal(false);
      load();
    } catch {}
  };

  const removeEvent = async (id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    try {
      await api.deleteEvent(id);
    } catch {}
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + S.sm }]}>
        <Text style={styles.headerTitle}>Our Calendar</Text>
        <Text style={styles.headerSub}>Stay in each other's day</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: S.lg, paddingBottom: insets.bottom + 96 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.calCard}>
          <View style={styles.monthRow}>
            <Pressable testID="cal-prev" onPress={() => changeMonth(-1)} hitSlop={10}>
              <Ionicons name="chevron-back" size={22} color={C.onSurface} />
            </Pressable>
            <Text style={styles.monthLabel}>
              {MONTHS[month]} {year}
            </Text>
            <Pressable testID="cal-next" onPress={() => changeMonth(1)} hitSlop={10}>
              <Ionicons name="chevron-forward" size={22} color={C.onSurface} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={styles.weekday}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((d, i) => {
              if (d === null) return <View key={i} style={styles.cell} />;
              const iso = toISO(new Date(year, month, d));
              const isSelected = iso === selected;
              const isToday = iso === toISO(today);
              const hasEvent = !!eventsByDate[iso];
              return (
                <Pressable
                  key={i}
                  testID={`cal-day-${d}`}
                  style={styles.cell}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelected(iso);
                  }}
                >
                  <View style={[styles.dayInner, isSelected && styles.daySelected]}>
                    <Text
                      style={[
                        styles.dayText,
                        isToday && !isSelected && styles.dayToday,
                        isSelected && styles.dayTextSelected,
                      ]}
                    >
                      {d}
                    </Text>
                  </View>
                  {hasEvent ? (
                    <View style={[styles.dot, isSelected && { backgroundColor: C.onBrandPrimary }]} />
                  ) : (
                    <View style={styles.dotPlaceholder} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>{fmtLong(selected)}</Text>
        </View>

        {dayEvents.length === 0 ? (
          <View style={styles.empty} testID="cal-empty">
            <Ionicons name="calendar-outline" size={26} color={C.muted} />
            <Text style={styles.emptyText}>No plans yet. Schedule a date night!</Text>
          </View>
        ) : (
          dayEvents.map((e) => (
            <View key={e.id} style={styles.eventCard} testID={`event-${e.id}`}>
              <View style={[styles.eventTag, e.shared ? styles.tagShared : styles.tagPersonal]}>
                <Ionicons
                  name={e.shared ? "heart" : "person"}
                  size={14}
                  color={e.shared ? C.onBrandTertiary : C.onSurfaceSecondary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventTitle}>{e.title}</Text>
                {e.note ? <Text style={styles.eventNote}>{e.note}</Text> : null}
              </View>
              <Pressable testID={`event-delete-${e.id}`} onPress={() => removeEvent(e.id)} hitSlop={8}>
                <Ionicons name="close" size={18} color={C.muted} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Pressable
        testID="cal-add-button"
        style={[styles.fab, { bottom: insets.bottom + 76 }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setModal(true);
        }}
      >
        <Ionicons name="add" size={28} color={C.onBrandPrimary} />
      </Pressable>

      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <KeyboardAvoidingView
          style={styles.sheetScrim}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setModal(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + S.lg }]} testID="cal-add-modal">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>New plan</Text>
            <Text style={styles.sheetDate}>{fmtLong(selected)}</Text>
            <TextInput
              testID="event-title-input"
              style={styles.sheetInput}
              placeholder="What's the plan?"
              placeholderTextColor={C.muted}
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              testID="event-note-input"
              style={[styles.sheetInput, { height: 72, textAlignVertical: "top" }]}
              placeholder="Add a note (optional)"
              placeholderTextColor={C.muted}
              value={note}
              onChangeText={setNote}
              multiline
            />
            <Pressable style={styles.toggleRow} onPress={() => setShared((s) => !s)} testID="event-shared-toggle">
              <View style={[styles.checkbox, shared && styles.checkboxOn]}>
                {shared ? <Ionicons name="checkmark" size={14} color={C.onBrandPrimary} /> : null}
              </View>
              <Text style={styles.toggleText}>Shared date (we're both in)</Text>
            </Pressable>
            <Pressable testID="event-save-button" style={styles.saveBtn} onPress={addEvent}>
              <Text style={styles.saveText}>Add to calendar</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

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
  headerSub: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, marginTop: 2 },
  calCard: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: S.md },
  monthLabel: { fontFamily: F.semibold, fontSize: type.lg, color: C.onSurface },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontFamily: F.medium, fontSize: type.sm, color: C.muted, marginBottom: S.sm },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 4 },
  dayInner: { width: 34, height: 34, borderRadius: R.pill, alignItems: "center", justifyContent: "center" },
  daySelected: { backgroundColor: C.brandPrimary },
  dayText: { fontFamily: F.medium, fontSize: type.base, color: C.onSurface },
  dayToday: { color: C.brandPrimary, fontFamily: F.bold },
  dayTextSelected: { color: C.onBrandPrimary, fontFamily: F.bold },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.brandPrimary, marginTop: 2 },
  dotPlaceholder: { width: 5, height: 5, marginTop: 2 },
  listHeader: { marginTop: S.xl, marginBottom: S.md },
  listTitle: { fontFamily: F.semibold, fontSize: type.lg, color: C.onSurface },
  empty: { alignItems: "center", paddingVertical: S["2xl"], gap: S.sm },
  emptyText: { fontFamily: F.regular, fontSize: type.base, color: C.muted },
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: S.md,
    backgroundColor: C.surfaceSecondary,
    borderRadius: R.md,
    padding: S.lg,
    marginBottom: S.sm,
    borderWidth: 1,
    borderColor: C.border,
  },
  eventTag: { width: 36, height: 36, borderRadius: R.pill, alignItems: "center", justifyContent: "center" },
  tagShared: { backgroundColor: C.brandTertiary },
  tagPersonal: { backgroundColor: C.surfaceTertiary },
  eventTitle: { fontFamily: F.semibold, fontSize: type.lg, color: C.onSurface },
  eventNote: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, marginTop: 2 },
  fab: {
    position: "absolute",
    right: S.lg,
    width: 56,
    height: 56,
    borderRadius: R.pill,
    backgroundColor: C.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  sheetScrim: { flex: 1, backgroundColor: "rgba(43,37,36,0.5)" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, padding: S.xl },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.borderStrong, alignSelf: "center", marginBottom: S.lg },
  sheetTitle: { fontFamily: F.bold, fontSize: type.xl, color: C.onSurface },
  sheetDate: { fontFamily: F.regular, fontSize: type.base, color: C.onSurfaceSecondary, marginBottom: S.lg },
  sheetInput: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: R.md,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    fontFamily: F.regular,
    fontSize: type.lg,
    color: C.onSurface,
    marginBottom: S.md,
    borderWidth: 1,
    borderColor: C.border,
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: S.md, marginBottom: S.lg },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: R.sm,
    borderWidth: 2,
    borderColor: C.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: C.brandPrimary, borderColor: C.brandPrimary },
  toggleText: { fontFamily: F.medium, fontSize: type.base, color: C.onSurface },
  saveBtn: { backgroundColor: C.brandPrimary, borderRadius: R.lg, paddingVertical: S.lg, alignItems: "center" },
  saveText: { fontFamily: F.semibold, fontSize: type.lg, color: C.onBrandPrimary },
});
