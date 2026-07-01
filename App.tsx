import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError } from "./src/api";
import { colors } from "./src/theme";
import type { Household, HouseholdState, Note, User } from "./src/types";

type Tab = "home" | "budget" | "calendar" | "notes" | "more";
const tabs: Array<{ id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "home", label: "Home", icon: "home-outline" },
  { id: "budget", label: "Budget", icon: "wallet-outline" },
  { id: "calendar", label: "Calendar", icon: "calendar-outline" },
  { id: "notes", label: "Notes", icon: "document-text-outline" },
  { id: "more", label: "More", icon: "grid-outline" }
];

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [state, setState] = useState<HouseholdState | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadWorkspace = useCallback(async () => {
    try {
      setError("");
      const session = await api.session();
      setUser(session.user);
      if (!session.authenticated || !session.user) return setState(null);
      const [nextHouseholds, nextState] = await Promise.all([api.households(), api.state()]);
      setHouseholds(nextHouseholds);
      setState(nextState);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setUser(null);
      else setError(cause instanceof Error ? cause.message : "Unable to load Famelo");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  const save = useCallback(async (next: HouseholdState) => {
    setState(next);
    setSaving(true);
    try { await api.saveState(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Changes could not be saved"); }
    finally { setSaving(false); }
  }, []);

  if (loading) return <Centered><ActivityIndicator size="large" color={colors.green} /></Centered>;
  if (!user || !state) return <AuthScreen onAuthenticated={loadWorkspace} />;

  const selected = households.find((item) => item.selected);
  const page = tab === "home" ? <Home state={state} />
    : tab === "budget" ? <Budget state={state} />
    : tab === "calendar" ? <Calendar state={state} />
    : tab === "notes" ? <Notes state={state} onSave={save} />
    : <More state={state} user={user} households={households} onSelect={async (id) => {
        await api.selectHousehold(id); setLoading(true); await loadWorkspace();
      }} onSignOut={async () => { await api.signOut(); setUser(null); setState(null); }} />;

  return <SafeAreaView style={styles.app}>
    <StatusBar style="dark" />
    <View style={styles.header}>
      <View><Text style={styles.brand}>Famelo</Text><Text style={styles.household}>{selected?.name || state.household.name}</Text></View>
      {saving ? <ActivityIndicator color={colors.green} /> : <View style={styles.saved}><Ionicons name="cloud-done-outline" size={18} color={colors.green} /><Text style={styles.savedText}>Saved</Text></View>}
    </View>
    {error ? <Pressable style={styles.error} onPress={() => setError("")}><Text style={styles.errorText}>{error}</Text></Pressable> : null}
    <View style={styles.page}>{page}</View>
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} style={styles.tab} onPress={() => setTab(item.id)}>
        <Ionicons name={item.icon} size={23} color={tab === item.id ? colors.green : colors.muted} />
        <Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{item.label}</Text>
      </Pressable>)}
    </View>
  </SafeAreaView>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const submit = async (demo = false) => {
    if (!demo && (!email.trim() || !password)) return setMessage("Enter your email and password.");
    setBusy(true); setMessage("");
    try { demo ? await api.demo() : await api.signIn(email.trim(), password); await onAuthenticated(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Sign in failed"); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.authPage}><StatusBar style="light" />
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.authInner}>
      <View style={styles.logo}><Text style={styles.logoText}>F</Text></View>
      <Text style={styles.authTitle}>Your household, working together.</Text>
      <Text style={styles.authCopy}>Budgets, meals, notes and family plans in one shared place.</Text>
      <View style={styles.authCard}>
        <Text style={styles.label}>Email</Text><TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Text style={styles.label}>Password</Text><TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
        {message ? <Text style={styles.formError}>{message}</Text> : null}
        <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void submit()}><Text style={styles.primaryButtonText}>{busy ? "Opening..." : "Sign in"}</Text></Pressable>
        <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => void submit(true)}><Text style={styles.secondaryButtonText}>Try demo</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function Page({ children, onRefresh }: React.PropsWithChildren<{ onRefresh?: () => void }>) {
  return <ScrollView contentContainerStyle={styles.content} refreshControl={onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} /> : undefined}>{children}</ScrollView>;
}
function Title({ eyebrow, children }: React.PropsWithChildren<{ eyebrow: string }>) { return <View style={styles.titleBlock}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{children}</Text></View>; }
function Card({ children }: React.PropsWithChildren) { return <View style={styles.card}>{children}</View>; }
function Metric({ label, value, accent = colors.green }: { label: string; value: string; accent?: string }) { return <View style={[styles.metric, { borderTopColor: accent }]}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function Centered({ children }: React.PropsWithChildren) { return <SafeAreaView style={styles.centered}>{children}</SafeAreaView>; }

function Home({ state }: { state: HouseholdState }) {
  const planned = state.budget.categories.flatMap((c) => c.lines).reduce((sum, line) => sum + Number(line.planned || 0), 0);
  const spent = state.transactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return <Page><Title eyebrow="HOUSEHOLD">Today</Title><View style={styles.metricGrid}>
    <Metric label="Available" value={money(state.budget.income - planned, state.household.currency)} />
    <Metric label="Spent" value={money(spent, state.household.currency)} accent={colors.blue} />
    <Metric label="Upcoming" value={String(state.calendar.events.length + state.calendar.chores.length)} accent={colors.gold} />
    <Metric label="Recipes" value={String(state.meals.recipes.length)} accent={colors.coral} />
  </View><Card><Text style={styles.cardTitle}>Coming up</Text>{state.calendar.events.slice(0, 4).map((item) => <Row key={`${item.date}-${item.title}`} title={item.title} detail={item.date} badge={item.type} />)}</Card>
  <Card><Text style={styles.cardTitle}>Recent transactions</Text>{state.transactions.slice(-4).reverse().map((item, index) => <Row key={`${item.date}-${item.payee}-${index}`} title={item.payee} detail={item.date} value={money(item.amount, state.household.currency)} />)}</Card></Page>;
}

function Budget({ state }: { state: HouseholdState }) {
  const spentByLine = useMemo(() => Object.fromEntries(state.transactions.reduce((map, item) => map.set(item.lineId, (map.get(item.lineId) || 0) + Number(item.amount)), new Map<string, number>())), [state.transactions]);
  return <Page><Title eyebrow="BUDGET">{state.budget.month}</Title><Card><Text style={styles.cardTitle}>Monthly income</Text><Text style={styles.heroValue}>{money(state.budget.income, state.household.currency)}</Text></Card>
    {state.budget.categories.map((category) => <Card key={category.name}><View style={styles.categoryHeader}><View style={[styles.dot, { backgroundColor: category.color }]} /><Text style={styles.cardTitle}>{category.name}</Text></View>
      {category.lines.map((line) => <Row key={line.id} title={line.name} detail={line.dueDay ? `Due day ${line.dueDay}` : "No due date"} value={`${money(spentByLine[line.id] || 0, state.household.currency)} / ${money(line.planned, state.household.currency)}`} />)}</Card>)}
  </Page>;
}

function Calendar({ state }: { state: HouseholdState }) { return <Page><Title eyebrow="CALENDAR">Schedule</Title><Card><Text style={styles.cardTitle}>Events and reminders</Text>{state.calendar.events.map((item) => <Row key={`${item.date}-${item.title}`} title={item.title} detail={item.date} badge={item.type} />)}</Card><Card><Text style={styles.cardTitle}>Chore rotation</Text>{state.calendar.chores.map((item) => <Row key={item.title} title={item.title} detail={`${item.assignee} · ${item.cadence}`} badge={item.nextDue} />)}</Card></Page>; }

function Notes({ state, onSave }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void> }) {
  const notes = state.notes.entries.filter((note) => !note.trashed && !note.archived);
  const toggle = (note: Note, itemId: string) => onSave({ ...state, notes: { ...state.notes, entries: state.notes.entries.map((entry) => entry.id === note.id ? { ...entry, checklist: entry.checklist.map((item) => item.id === itemId ? { ...item, done: !item.done } : item) } : entry) } });
  return <Page><Title eyebrow="NOTES">Household notes</Title>{notes.map((note) => <View key={note.id} style={[styles.note, { backgroundColor: note.color || colors.surface }]}><View style={styles.noteHeader}><Text style={styles.noteTitle}>{note.title}</Text>{note.pinned ? <Ionicons name="pin" size={18} color={colors.gold} /> : null}</View>{note.body ? <Text style={styles.noteBody}>{note.body}</Text> : null}{note.checklist.map((item) => <Pressable key={item.id} style={styles.checkRow} onPress={() => void toggle(note, item.id)}><Ionicons name={item.done ? "checkbox" : "square-outline"} size={24} color={item.done ? colors.green : colors.muted} /><Text style={[styles.checkText, item.done && styles.done]}>{item.text}</Text></Pressable>)}</View>)}</Page>;
}

function More({ state, user, households, onSelect, onSignOut }: { state: HouseholdState; user: User; households: Household[]; onSelect: (id: string) => Promise<void>; onSignOut: () => Promise<void> }) {
  return <Page><Title eyebrow="ACCOUNT">More</Title><Card><Text style={styles.cardTitle}>{user.name}</Text><Text style={styles.muted}>{user.email}</Text></Card><Card><Text style={styles.cardTitle}>Households</Text>{households.map((item) => <Pressable key={item.id} style={styles.householdRow} onPress={() => void onSelect(item.id)}><View><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.rowDetail}>{item.country} · {item.currency} · {item.role}</Text></View>{item.selected ? <Ionicons name="checkmark-circle" size={24} color={colors.green} /> : <Ionicons name="chevron-forward" size={20} color={colors.muted} />}</Pressable>)}</Card><Card><Text style={styles.cardTitle}>Meals and recipes</Text><Text style={styles.muted}>{state.meals.plannedWeek.length} planned meals · {state.meals.recipes.length} saved recipes</Text></Card><Pressable style={styles.dangerButton} onPress={() => Alert.alert("Sign out?", "You will need to sign in again.", [{ text: "Cancel" }, { text: "Sign out", style: "destructive", onPress: () => void onSignOut() }])}><Text style={styles.dangerText}>Sign out</Text></Pressable></Page>;
}

function Row({ title, detail, value, badge }: { title: string; detail: string; value?: string; badge?: string }) { return <View style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>{value ? <Text style={styles.rowValue}>{value}</Text> : null}{badge ? <Text style={styles.badge}>{badge}</Text> : null}</View>; }

export default function App() { return <SafeAreaProvider><AppContent /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background }, centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  header: { height: 68, paddingHorizontal: 20, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, brand: { fontSize: 22, fontWeight: "800", color: colors.text }, household: { marginTop: 2, color: colors.muted, fontSize: 13 }, saved: { flexDirection: "row", gap: 5, alignItems: "center" }, savedText: { color: colors.green, fontWeight: "700" },
  error: { backgroundColor: "#fff0f0", padding: 10 }, errorText: { color: colors.coral, textAlign: "center", fontWeight: "700" }, page: { flex: 1 }, content: { padding: 18, paddingBottom: 32, gap: 14 },
  titleBlock: { marginBottom: 2 }, eyebrow: { color: colors.muted, fontWeight: "800", fontSize: 12 }, title: { marginTop: 3, color: colors.text, fontWeight: "800", fontSize: 30 },
  card: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 16 }, cardTitle: { color: colors.text, fontWeight: "800", fontSize: 18 }, muted: { color: colors.muted, marginTop: 5 }, heroValue: { color: colors.green, fontSize: 32, fontWeight: "800", marginTop: 8 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, metric: { width: "48%", minHeight: 96, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderTopWidth: 4, borderRadius: 8, padding: 13 }, metricLabel: { color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase" }, metricValue: { color: colors.text, fontWeight: "800", fontSize: 22, marginTop: 8 },
  row: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 }, rowCopy: { flex: 1 }, rowTitle: { color: colors.text, fontWeight: "700", fontSize: 15 }, rowDetail: { color: colors.muted, fontSize: 12, marginTop: 3 }, rowValue: { color: colors.text, fontWeight: "800", fontSize: 13, maxWidth: "43%", textAlign: "right" }, badge: { color: colors.green, backgroundColor: colors.greenSoft, fontWeight: "700", fontSize: 11, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, overflow: "hidden" },
  categoryHeader: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 4 }, dot: { height: 20, width: 5, borderRadius: 3 },
  note: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 16 }, noteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, noteTitle: { color: colors.text, fontWeight: "800", fontSize: 20 }, noteBody: { color: colors.text, marginVertical: 10, lineHeight: 21 }, checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }, checkText: { flex: 1, color: colors.text, fontSize: 15 }, done: { textDecorationLine: "line-through", color: colors.muted },
  householdRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }, dangerButton: { alignItems: "center", padding: 15, borderRadius: 8, backgroundColor: "#fff0f0", borderWidth: 1, borderColor: "#ffd6d6" }, dangerText: { color: colors.coral, fontWeight: "800" },
  tabBar: { minHeight: 64, paddingTop: 7, flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }, tab: { flex: 1, alignItems: "center", gap: 3 }, tabText: { color: colors.muted, fontSize: 10, fontWeight: "700" }, tabTextActive: { color: colors.green },
  authPage: { flex: 1, backgroundColor: colors.navy }, authInner: { flex: 1, paddingHorizontal: 24, justifyContent: "center" }, logo: { width: 52, height: 52, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#43d6a5" }, logoText: { color: colors.navy, fontSize: 28, fontWeight: "900" }, authTitle: { color: "white", fontSize: 34, lineHeight: 40, fontWeight: "800", marginTop: 22, maxWidth: 340 }, authCopy: { color: "#c2cce0", lineHeight: 22, marginTop: 10, marginBottom: 25 }, authCard: { backgroundColor: "white", borderRadius: 8, padding: 18, gap: 9 }, label: { color: colors.text, fontWeight: "700", marginTop: 3 }, input: { height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 13, fontSize: 16, color: colors.text, backgroundColor: "#f8fafc" }, formError: { color: colors.coral, marginVertical: 3 }, primaryButton: { height: 52, alignItems: "center", justifyContent: "center", backgroundColor: colors.green, borderRadius: 7, marginTop: 6 }, primaryButtonText: { color: "white", fontSize: 16, fontWeight: "800" }, secondaryButton: { height: 48, alignItems: "center", justifyContent: "center", borderRadius: 7, borderWidth: 1, borderColor: colors.border }, secondaryButtonText: { color: colors.text, fontWeight: "800" }
});
