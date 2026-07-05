import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError } from "./src/api";
import { colors } from "./src/theme";
import { registerPushToken } from "./src/push";
import { applyChecklistToggle, firstWeekDayDates, formatShortDate } from "./src/planningLogic";
import {
  groupPlanTasksByBucket, defaultPlanAnchorDate,
  dailyTaskOccursOnDate, isDailyTaskDoneOnDate, toggleDailyTaskDoneOnDate,
  timeToMinutes, snapMinutes
} from "./src/planLogic";
import type { Household, HouseholdAccess, HouseholdState, JournalEntry, Note, PlanBucket, PlanRecurrence, PlanTask, PlannedMeal, PrivateData, User } from "./src/types";

type Tab = "home" | "budget" | "calendar" | "notes" | "journal" | "plan" | "meals" | "more";
const tabs: Array<{ id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "home", label: "Home", icon: "home-outline" },
  { id: "budget", label: "Budget", icon: "wallet-outline" },
  { id: "calendar", label: "Calendar", icon: "calendar-outline" },
  { id: "notes", label: "Notes", icon: "document-text-outline" },
  { id: "journal", label: "Journal", icon: "create-outline" },
  { id: "plan", label: "Plan", icon: "layers-outline" },
  { id: "meals", label: "Meals", icon: "restaurant-outline" },
  { id: "more", label: "More", icon: "grid-outline" }
];

const journalMoods = ["Happy", "Calm", "Neutral", "Stressed", "Sad", "Grateful", "Excited"];

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}

function mobileAssetValue(asset: NonNullable<HouseholdState["goals"]>["netWorth"] extends infer N ? N extends { assets: Array<infer A> } ? A : never : never) {
  return asset.assetClass === "stock" ? Number(asset.shares || 0) * Number(asset.price || 0) : Number(asset.value || 0);
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [state, setState] = useState<HouseholdState | null>(null);
  const [access, setAccess] = useState<HouseholdAccess | null>(null);
  const [privateData, setPrivateData] = useState<PrivateData | null>(null);
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
      // privateData is scoped to the user, not the household, so it stays the same
      // regardless of which household is selected — fetched here alongside it anyway.
      const [nextHouseholds, nextState, nextAccess, nextPrivateData] = await Promise.all([api.households(), api.state(), api.householdAccess(), api.privateData()]);
      setHouseholds(nextHouseholds);
      setState(nextState);
      setAccess(nextAccess);
      setPrivateData(nextPrivateData);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setUser(null);
      else setError(cause instanceof Error ? cause.message : "Unable to load Famelo");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    if (!user) return;
    void registerPushToken();
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void registerPushToken();
    });
    return () => subscription.remove();
  }, [user?.id]);

  const save = useCallback(async (next: HouseholdState) => {
    setState(next);
    setSaving(true);
    try { await api.saveState(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Changes could not be saved"); }
    finally { setSaving(false); }
  }, []);

  const saveJournal = useCallback(async (journal: PrivateData["journal"]) => {
    setPrivateData((prev) => prev ? { ...prev, journal } : prev);
    setSaving(true);
    try { await api.saveJournal(journal); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Journal could not be saved"); }
    finally { setSaving(false); }
  }, []);

  const savePlans = useCallback(async (plans: PrivateData["plans"]) => {
    setPrivateData((prev) => prev ? { ...prev, plans } : prev);
    setSaving(true);
    try { await api.savePlans(plans); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Plans could not be saved"); }
    finally { setSaving(false); }
  }, []);

  if (loading) return <Centered><ActivityIndicator size="large" color={colors.green} /></Centered>;
  if (!user || !state) return <AuthScreen onAuthenticated={loadWorkspace} />;

  const selected = households.find((item) => item.selected);
  const activePrivateData = privateData || { journal: { entries: [] }, plans: { tasks: [] } };
  const page = tab === "home" ? <Home state={state} />
    : tab === "budget" ? <Budget state={state} />
    : tab === "calendar" ? <Calendar state={state} access={access} onSave={save} />
    : tab === "notes" ? <Notes state={state} onSave={save} />
    : tab === "journal" ? <Journal privateData={activePrivateData} onSave={saveJournal} />
    : tab === "plan" ? <Plan privateData={activePrivateData} onSave={savePlans} />
    : tab === "meals" ? <Meals state={state} onSave={save} />
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

function Calendar({ state, access, onSave }: { state: HouseholdState; access: HouseholdAccess | null; onSave: (next: HouseholdState) => Promise<void> }) {
  const members = access?.members.filter((member) => member.status === "active") || [];
  const [editing, setEditing] = useState<{ kind: "event" | "chore"; index: number } | null>(null);
  const [title, setTitle] = useState(""); const [date, setDate] = useState(`${state.budget.month}-01`); const [owner, setOwner] = useState(members[0]?.email || "");
  const begin = (kind: "event" | "chore", index: number) => {
    const item = kind === "event" ? state.calendar.events[index] : state.calendar.chores[index];
    if (!item) return;
    setEditing({ kind, index }); setTitle(item.title); setDate(kind === "event" ? (item as typeof state.calendar.events[number]).date : (item as typeof state.calendar.chores[number]).startDate || (item as typeof state.calendar.chores[number]).nextDue); setOwner(kind === "event" ? (item as typeof state.calendar.events[number]).owner || members[0]?.email || "" : (item as typeof state.calendar.chores[number]).assignee || members[0]?.email || "");
  };
  const saveItem = async () => {
    if (!title.trim() || !date) return;
    const member = members.find((item) => item.email === owner);
    const next = structuredClone(state);
    if (editing?.kind === "chore") next.calendar.chores = next.calendar.chores.map((item, index) => index === editing.index ? { ...item, title: title.trim(), startDate: date, nextDue: date, assignee: owner, assigneeName: member?.name || owner } : item);
    else if (editing?.kind === "event") next.calendar.events = next.calendar.events.map((item, index) => index === editing.index ? { ...item, title: title.trim(), date, owner, ownerName: member?.name || owner } : item);
    else next.calendar.events.push({ id: `event-${Date.now()}`, title: title.trim(), date, type: "reminder", owner, ownerName: member?.name || owner });
    await onSave(next); setEditing(null); setTitle("");
  };
  return <Page><Title eyebrow="CALENDAR">Shared schedule</Title><Card><Text style={styles.cardTitle}>{editing ? "Edit calendar item" : "Add reminder"}</Text>
    <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title" /><TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
    <Text style={styles.label}>Assign to</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{members.map((member) => <Pressable key={member.email} style={[styles.choice, owner === member.email && styles.choiceActive]} onPress={() => setOwner(member.email)}><Text style={[styles.choiceText, owner === member.email && styles.choiceTextActive]}>{member.name}</Text></Pressable>)}</ScrollView>
    <Pressable style={styles.primaryButton} onPress={() => void saveItem()}><Text style={styles.primaryButtonText}>{editing ? "Save changes" : "Add reminder"}</Text></Pressable>
  </Card><Card><Text style={styles.cardTitle}>Events and reminders</Text>{state.calendar.events.map((item, index) => <Pressable key={item.id || `${item.date}-${item.title}`} onPress={() => begin("event", index)}><Row title={item.title} detail={`${item.date} · ${item.ownerName || item.owner || "Unassigned"}`} badge={item.type} /></Pressable>)}</Card><Card><Text style={styles.cardTitle}>Chore rotation</Text>{state.calendar.chores.map((item, index) => <Pressable key={item.id || item.title} onPress={() => begin("chore", index)}><Row title={item.title} detail={`${item.assigneeName || item.assignee} · ${item.cadence}`} badge={item.nextDue} /></Pressable>)}</Card></Page>;
}

function Meals({ state, onSave }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void> }) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const slots = ["Breakfast", "Lunch", "Dinner", "Snack"];
  const [day, setDay] = useState("Monday"); const [slot, setSlot] = useState("Breakfast"); const [recipeId, setRecipeId] = useState(state.meals.recipes[0]?.id || ""); const [servings, setServings] = useState("3");
  const current = state.meals.plannedWeek.filter((meal) => (!meal.month || meal.month === state.budget.month) && Number(meal.week || 1) === 1);
  const weekDayDates = firstWeekDayDates(state.budget.month);
  const plan = async () => {
    const recipe = state.meals.recipes.find((item) => item.id === recipeId); if (!recipe) return;
    const next = structuredClone(state); const planned: PlannedMeal = { month: state.budget.month, week: 1, day, slot, recipeId, meal: recipe.name, servings: Math.max(1, Number(servings || 3)) };
    const existing = slot === "Snack" ? -1 : next.meals.plannedWeek.findIndex((item) => (!item.month || item.month === state.budget.month) && Number(item.week || 1) === 1 && item.day === day && (item.slot || "Dinner") === slot);
    if (existing >= 0) next.meals.plannedWeek[existing] = planned; else next.meals.plannedWeek.push(planned); next.meals.feedback = `${recipe.name} planned for ${day} ${slot}.`; await onSave(next);
  };
  const saveWeek = async () => { const next = structuredClone(state); const label = `${state.budget.month} · Week 1`; next.meals.savedWeeks ||= []; if (!next.meals.savedWeeks.includes(label)) next.meals.savedWeeks.push(label); next.meals.feedback = `${label} saved.`; await onSave(next); };
  const postGroceries = async () => { const next = structuredClone(state); const line = next.budget.categories.flatMap((category) => category.lines).find((item) => item.name.toLowerCase().includes("grocer")); if (!line) return Alert.alert("Budget setup needed", "Add a Groceries subcategory before posting."); const amount = Number(next.meals.groceryEstimate || 185); next.transactions.unshift({ date: new Date().toISOString().slice(0, 10), payee: "Meal plan groceries", lineId: line.id, amount, memo: "Posted from mobile meal planner" }); next.meals.feedback = `${money(amount, state.household.currency)} posted to Groceries.`; await onSave(next); };
  return <Page><Title eyebrow="MEALS">Weekly meal plan</Title><Card><View style={styles.actionRow}><Pressable style={styles.secondarySmall} onPress={() => void saveWeek()}><Text style={styles.secondaryButtonText}>Save week</Text></Pressable><Pressable style={styles.secondarySmall} onPress={() => void postGroceries()}><Text style={styles.secondaryButtonText}>Post groceries</Text></Pressable></View>{state.meals.feedback ? <Text style={styles.successText}>{state.meals.feedback}</Text> : null}
    <Text style={styles.label}>Day</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{days.map((item) => <Pressable key={item} style={[styles.choice, day === item && styles.choiceActive]} onPress={() => setDay(item)}><Text style={[styles.choiceText, day === item && styles.choiceTextActive]}>{item.slice(0, 3)}</Text></Pressable>)}</ScrollView>
    <Text style={styles.label}>Meal</Text><View style={styles.choiceRow}>{slots.map((item) => <Pressable key={item} style={[styles.choice, slot === item && styles.choiceActive]} onPress={() => setSlot(item)}><Text style={[styles.choiceText, slot === item && styles.choiceTextActive]}>{item}</Text></Pressable>)}</View>
    <Text style={styles.label}>Recipe</Text>{state.meals.recipes.map((recipe) => <Pressable key={recipe.id} style={[styles.recipeChoice, recipeId === recipe.id && styles.choiceActive]} onPress={() => setRecipeId(recipe.id)}><Text style={[styles.choiceText, recipeId === recipe.id && styles.choiceTextActive]}>{recipe.name}</Text></Pressable>)}<TextInput style={styles.input} value={servings} onChangeText={setServings} keyboardType="number-pad" placeholder="Servings" /><Pressable style={styles.primaryButton} onPress={() => void plan()}><Text style={styles.primaryButtonText}>Plan meal</Text></Pressable>
  </Card>{weekDayDates.map(({ day: mealDay, date }) => <Card key={mealDay}><Text style={styles.cardTitle}>{mealDay}</Text><Text style={styles.muted}>{formatShortDate(date)}</Text>{slots.flatMap((mealSlot) => { const items = current.filter((item) => item.day === mealDay && (item.slot || "Dinner") === mealSlot); return items.length ? items.map((item, index) => <Row key={`${mealSlot}-${item.recipeId}-${index}`} title={item.meal} detail={`${mealSlot} · ${item.servings} servings`} />) : [<Pressable key={`${mealSlot}-open`} onPress={() => { setDay(mealDay); setSlot(mealSlot); }}><Row title="Open" detail={mealSlot} /></Pressable>]; })}</Card>)}</Page>;
}

function Notes({ state, onSave }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void> }) {
  const notes = state.notes.entries.filter((note) => !note.trashed && !note.archived);
  const toggle = (note: Note, itemId: string) => {
    const current = note.checklist.find((item) => item.id === itemId);
    if (!current) return;
    const nextChecklist = applyChecklistToggle(note.checklist, itemId, !current.done);
    onSave({ ...state, notes: { ...state.notes, entries: state.notes.entries.map((entry) => entry.id === note.id ? { ...entry, checklist: nextChecklist } : entry) } });
  };
  return <Page><Title eyebrow="NOTES">Household notes</Title>{notes.map((note) => <View key={note.id} style={[styles.note, { backgroundColor: note.color || colors.surface }]}><View style={styles.noteHeader}><Text style={styles.noteTitle}>{note.title}</Text>{note.pinned ? <Ionicons name="pin" size={18} color={colors.gold} /> : null}</View>{note.body ? <Text style={styles.noteBody}>{note.body}</Text> : null}{note.checklist.map((item) => <Pressable key={item.id} style={[styles.checkRow, item.parentId && styles.checkRowChild]} onPress={() => void toggle(note, item.id)}><Ionicons name={item.done ? "checkbox" : "square-outline"} size={24} color={item.done ? colors.green : colors.muted} /><Text style={[styles.checkText, item.done && styles.done]}>{item.text}</Text></Pressable>)}</View>)}</Page>;
}

function Journal({ privateData, onSave }: { privateData: PrivateData; onSave: (journal: PrivateData["journal"]) => Promise<void> }) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [mood, setMood] = useState("");
  const entries = [...privateData.journal.entries].sort((a, b) => b.entryDate.localeCompare(a.entryDate));

  const addEntry = async () => {
    if (!title.trim() && !body.trim()) return;
    const now = new Date().toISOString();
    const entry: JournalEntry = { id: `journal-${Date.now()}`, entryDate: now.slice(0, 10), title: title.trim(), body: body.trim(), mood, tags: [], photos: [], createdAt: now, updatedAt: now };
    await onSave({ entries: [...privateData.journal.entries, entry] });
    setTitle(""); setBody(""); setMood("");
  };

  const deleteEntry = async (entryId: string) => {
    await onSave({ entries: privateData.journal.entries.filter((entry) => entry.id !== entryId) });
  };

  const addPhoto = async (entryId: string) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Photo access needed", "Allow photo library access to attach photos to journal entries.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.5 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.base64) return;
    const dataUrl = `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`;
    const now = new Date().toISOString();
    const nextEntries = privateData.journal.entries.map((entry) => entry.id === entryId
      ? { ...entry, photos: [...entry.photos, { id: `photo-${Date.now()}`, dataUrl, createdAt: now }].slice(0, 8) }
      : entry);
    await onSave({ entries: nextEntries });
  };

  return <Page><Title eyebrow="JOURNAL">Your private journal</Title>
    <Text style={styles.muted}>Private to you — never shared with other household members.</Text>
    <Card>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Give today a title" />
      <Text style={styles.label}>Mood</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
        {journalMoods.map((item) => <Pressable key={item} style={[styles.choice, mood === item && styles.choiceActive]} onPress={() => setMood(mood === item ? "" : item)}><Text style={[styles.choiceText, mood === item && styles.choiceTextActive]}>{item}</Text></Pressable>)}
      </ScrollView>
      <TextInput style={[styles.input, styles.multilineInput]} value={body} onChangeText={setBody} placeholder="What happened today?" multiline />
      <Pressable style={styles.primaryButton} onPress={() => void addEntry()}><Text style={styles.primaryButtonText}>Add entry</Text></Pressable>
    </Card>
    {entries.map((entry) => <Card key={entry.id}>
      <View style={styles.noteHeader}>
        <Text style={styles.noteTitle}>{entry.title || "Untitled entry"}</Text>
        <Pressable onPress={() => void deleteEntry(entry.id)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>
      <Text style={styles.muted}>{entry.entryDate}{entry.mood ? ` · ${entry.mood}` : ""}</Text>
      {entry.body ? <Text style={styles.noteBody}>{entry.body}</Text> : null}
      {entry.photos.length ? <ScrollView horizontal style={styles.journalPhotoRow}>{entry.photos.map((photo) => <Image key={photo.id} source={{ uri: photo.dataUrl }} style={styles.journalPhoto} />)}</ScrollView> : null}
      <Pressable style={styles.secondarySmall} onPress={() => void addPhoto(entry.id)}><Text style={styles.secondaryButtonText}>+ Add photo</Text></Pressable>
    </Card>)}
  </Page>;
}

const planRecurrenceLabels: Record<PlanRecurrence, string> = {
  none: "Does not repeat", daily: "Every day", weekdays: "Every weekday", weekly: "Every week", monthly: "Every month"
};

function formatPlanDayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  const today = new Date().toISOString().slice(0, 10);
  if (dateKey === today) return `Today · ${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function Plan({ privateData, onSave }: { privateData: PrivateData; onSave: (plans: PrivateData["plans"]) => Promise<void> }) {
  const [bucket, setBucket] = useState<PlanBucket>("daily");
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [recurrence, setRecurrence] = useState<PlanRecurrence>("none");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({});

  const grouped = groupPlanTasksByBucket(privateData.plans.tasks);
  const tasks = bucket === "daily"
    ? grouped.daily
        .filter((task) => dailyTaskOccursOnDate(task, selectedDate))
        .slice()
        .sort((a, b) => (timeToMinutes(a.startTime) ?? Infinity) - (timeToMinutes(b.startTime) ?? Infinity))
    : grouped[bucket];

  const addTask = async () => {
    if (!title.trim()) return;
    const task: PlanTask = {
      id: `plan-${Date.now()}`, title: title.trim(), notes: "", bucket,
      anchorDate: bucket === "daily" ? selectedDate : defaultPlanAnchorDate(bucket),
      createdAt: new Date().toISOString(), subtasks: [],
      ...(bucket === "daily"
        ? { startTime: startTime.trim() || undefined, durationMinutes, recurrence, completedDates: [] }
        : { done: false })
    };
    await onSave({ tasks: [...privateData.plans.tasks, task] });
    setTitle("");
    setStartTime("");
    setDurationMinutes(30);
    setRecurrence("none");
  };

  const toggleTask = async (taskId: string) => {
    await onSave({
      tasks: privateData.plans.tasks.map((task) => {
        if (task.id !== taskId) return task;
        return task.bucket === "daily" ? toggleDailyTaskDoneOnDate(task, selectedDate) : { ...task, done: !task.done };
      })
    });
  };

  const deleteTask = async (taskId: string) => {
    await onSave({ tasks: privateData.plans.tasks.filter((task) => task.id !== taskId) });
  };

  const adjustDuration = async (taskId: string, delta: number) => {
    await onSave({
      tasks: privateData.plans.tasks.map((task) => task.id === taskId
        ? { ...task, durationMinutes: Math.max(15, snapMinutes((task.durationMinutes || 30) + delta)) }
        : task)
    });
  };

  const changeStartTime = async (taskId: string, value: string) => {
    await onSave({ tasks: privateData.plans.tasks.map((task) => task.id === taskId ? { ...task, startTime: value.trim() || undefined } : task) });
  };

  const addSubtask = async (taskId: string) => {
    const text = (subtaskDrafts[taskId] || "").trim();
    if (!text) return;
    await onSave({
      tasks: privateData.plans.tasks.map((task) => task.id === taskId
        ? { ...task, subtasks: [...(task.subtasks || []), { id: `sub-${Date.now()}`, text, done: false }] }
        : task)
    });
    setSubtaskDrafts((prev) => ({ ...prev, [taskId]: "" }));
  };

  const toggleSubtask = async (taskId: string, subtaskId: string) => {
    await onSave({
      tasks: privateData.plans.tasks.map((task) => task.id === taskId
        ? { ...task, subtasks: (task.subtasks || []).map((subtask) => subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask) }
        : task)
    });
  };

  const deleteSubtask = async (taskId: string, subtaskId: string) => {
    await onSave({
      tasks: privateData.plans.tasks.map((task) => task.id === taskId
        ? { ...task, subtasks: (task.subtasks || []).filter((subtask) => subtask.id !== subtaskId) }
        : task)
    });
  };

  const shiftDay = (delta: number) => {
    const next = new Date(`${selectedDate}T00:00:00`);
    next.setDate(next.getDate() + delta);
    setSelectedDate(next.toISOString().slice(0, 10));
  };

  return <Page><Title eyebrow="PLAN">Daily, weekly and monthly tasks</Title>
    <Text style={styles.muted}>Private to you — never shared with other household members.</Text>
    <View style={styles.choiceRow}>
      {(["daily", "weekly", "monthly"] as PlanBucket[]).map((item) => <Pressable key={item} style={[styles.choice, bucket === item && styles.choiceActive]} onPress={() => setBucket(item)}><Text style={[styles.choiceText, bucket === item && styles.choiceTextActive]}>{item.charAt(0).toUpperCase() + item.slice(1)}</Text></Pressable>)}
    </View>
    {bucket === "daily" && <View style={styles.dayNavRow}>
      <Pressable style={styles.planStepperButton} onPress={() => shiftDay(-1)}><Ionicons name="chevron-back" size={18} color={colors.text} /></Pressable>
      <Pressable style={styles.dayNavLabel} onPress={() => setSelectedDate(new Date().toISOString().slice(0, 10))}><Text style={styles.rowTitle}>{formatPlanDayLabel(selectedDate)}</Text></Pressable>
      <Pressable style={styles.planStepperButton} onPress={() => shiftDay(1)}><Ionicons name="chevron-forward" size={18} color={colors.text} /></Pressable>
    </View>}
    <Card>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder={`Add a ${bucket} task`} />
      {bucket === "daily" && <>
        <View style={styles.actionRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={startTime} onChangeText={setStartTime} placeholder="Start time (HH:MM, optional)" />
        </View>
        <View style={styles.actionRow}>
          <Text style={[styles.rowDetail, { flex: 1 }]}>Duration: {durationMinutes} min</Text>
          <Pressable style={styles.planStepperButton} onPress={() => setDurationMinutes((minutes) => Math.max(15, minutes - 15))}><Text style={styles.secondaryButtonText}>-15</Text></Pressable>
          <Pressable style={styles.planStepperButton} onPress={() => setDurationMinutes((minutes) => minutes + 15)}><Text style={styles.secondaryButtonText}>+15</Text></Pressable>
        </View>
        <View style={styles.choiceRow}>
          {(["none", "daily", "weekdays", "weekly", "monthly"] as PlanRecurrence[]).map((item) => <Pressable key={item} style={[styles.choice, recurrence === item && styles.choiceActive]} onPress={() => setRecurrence(item)}><Text style={[styles.choiceText, recurrence === item && styles.choiceTextActive]}>{planRecurrenceLabels[item]}</Text></Pressable>)}
        </View>
      </>}
      <Pressable style={styles.primaryButton} onPress={() => void addTask()}><Text style={styles.primaryButtonText}>Add task</Text></Pressable>
    </Card>
    <Card>{tasks.length ? tasks.map((task) => {
      const done = bucket === "daily" ? isDailyTaskDoneOnDate(task, selectedDate) : Boolean(task.done);
      return <View key={task.id} style={styles.planTaskBlock}>
        <View style={styles.row}>
          <Pressable style={styles.rowCopy} onPress={() => void toggleTask(task.id)}>
            <Text style={[styles.rowTitle, done && styles.done]}>{task.title}</Text>
            <Text style={styles.rowDetail}>
              {bucket === "daily"
                ? [task.startTime || "Unscheduled", `${task.durationMinutes || 30} min`, planRecurrenceLabels[task.recurrence || "none"]].join(" · ")
                : task.anchorDate}
            </Text>
          </Pressable>
          <Pressable onPress={() => void deleteTask(task.id)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
        </View>
        {bucket === "daily" && <View style={styles.actionRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={task.startTime || ""} onChangeText={(value) => void changeStartTime(task.id, value)} placeholder="Start time (HH:MM)" />
          <Pressable style={styles.planStepperButton} onPress={() => void adjustDuration(task.id, -15)}><Text style={styles.secondaryButtonText}>-15</Text></Pressable>
          <Pressable style={styles.planStepperButton} onPress={() => void adjustDuration(task.id, 15)}><Text style={styles.secondaryButtonText}>+15</Text></Pressable>
        </View>}
        <View style={styles.subtaskList}>
          {(task.subtasks || []).map((subtask) => <View key={subtask.id} style={styles.checkRow}>
            <Pressable onPress={() => void toggleSubtask(task.id, subtask.id)}><Ionicons name={subtask.done ? "checkbox" : "square-outline"} size={20} color={subtask.done ? colors.green : colors.muted} /></Pressable>
            <Text style={[styles.checkText, subtask.done && styles.done]}>{subtask.text}</Text>
            <Pressable onPress={() => void deleteSubtask(task.id, subtask.id)}><Ionicons name="close" size={16} color={colors.muted} /></Pressable>
          </View>)}
          <View style={styles.actionRow}>
            <TextInput style={[styles.input, { flex: 1 }]} value={subtaskDrafts[task.id] || ""} onChangeText={(value) => setSubtaskDrafts((prev) => ({ ...prev, [task.id]: value }))} placeholder="Add subtask" />
            <Pressable style={styles.secondarySmall} onPress={() => void addSubtask(task.id)}><Text style={styles.secondaryButtonText}>Add</Text></Pressable>
          </View>
        </View>
      </View>;
    }) : <Text style={styles.muted}>No {bucket} tasks yet.</Text>}</Card>
  </Page>;
}

function More({ state, user, households, onSelect, onSignOut }: { state: HouseholdState; user: User; households: Household[]; onSelect: (id: string) => Promise<void>; onSignOut: () => Promise<void> }) {
  const assets = state.goals?.netWorth?.assets.reduce((sum, item) => sum + mobileAssetValue(item), 0) || 0;
  const liabilities = state.goals?.netWorth?.liabilities.reduce((sum, item) => sum + Number(item.value || 0), 0) || 0;
  return <Page><Title eyebrow="ACCOUNT">More</Title><Card><Text style={styles.cardTitle}>{user.name}</Text><Text style={styles.muted}>{user.email}</Text></Card><Card><Text style={styles.cardTitle}>Household wealth</Text><Text style={styles.heroValue}>{money(assets - liabilities, state.household.currency)}</Text><Text style={styles.muted}>Assets {money(assets, state.household.currency)} · Liabilities {money(liabilities, state.household.currency)}</Text><Text style={styles.muted}>{state.goals?.debts?.length || 0} debt accounts with EMI plans</Text></Card><Card><Text style={styles.cardTitle}>Households</Text>{households.map((item) => <Pressable key={item.id} style={styles.householdRow} onPress={() => void onSelect(item.id)}><View><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.rowDetail}>{item.country} · {item.currency} · {item.role}</Text></View>{item.selected ? <Ionicons name="checkmark-circle" size={24} color={colors.green} /> : <Ionicons name="chevron-forward" size={20} color={colors.muted} />}</Pressable>)}</Card><Card><Text style={styles.cardTitle}>Meals and recipes</Text><Text style={styles.muted}>{state.meals.plannedWeek.length} planned meals · {state.meals.recipes.length} saved recipes</Text></Card><Pressable style={styles.dangerButton} onPress={() => Alert.alert("Sign out?", "You will need to sign in again.", [{ text: "Cancel" }, { text: "Sign out", style: "destructive", onPress: () => void onSignOut() }])}><Text style={styles.dangerText}>Sign out</Text></Pressable></Page>;
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
  note: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 16 }, noteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, noteTitle: { color: colors.text, fontWeight: "800", fontSize: 20 }, noteBody: { color: colors.text, marginVertical: 10, lineHeight: 21 }, checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }, checkRowChild: { marginLeft: 24 }, checkText: { flex: 1, color: colors.text, fontSize: 15 }, done: { textDecorationLine: "line-through", color: colors.muted },
  journalPhotoRow: { marginTop: 10 }, journalPhoto: { width: 72, height: 72, borderRadius: 8, marginRight: 8 },
  multilineInput: { height: 90, textAlignVertical: "top", paddingTop: 12 },
  householdRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }, dangerButton: { alignItems: "center", padding: 15, borderRadius: 8, backgroundColor: "#fff0f0", borderWidth: 1, borderColor: "#ffd6d6" }, dangerText: { color: colors.coral, fontWeight: "800" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 8 }, choice: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, choiceActive: { backgroundColor: colors.green, borderColor: colors.green }, choiceText: { color: colors.text, fontWeight: "700" }, choiceTextActive: { color: "white" }, recipeChoice: { padding: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 7, marginTop: 7 }, actionRow: { flexDirection: "row", gap: 8, marginBottom: 8 }, secondarySmall: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 7 }, successText: { color: colors.green, fontWeight: "700", marginVertical: 7 },
  dayNavRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 8 }, dayNavLabel: { flex: 1, alignItems: "center" }, planStepperButton: { minHeight: 44, minWidth: 52, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 7 }, planTaskBlock: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }, subtaskList: { marginLeft: 8, marginBottom: 8 },
  tabBar: { minHeight: 64, paddingTop: 7, flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }, tab: { flex: 1, alignItems: "center", gap: 3 }, tabText: { color: colors.muted, fontSize: 10, fontWeight: "700" }, tabTextActive: { color: colors.green },
  authPage: { flex: 1, backgroundColor: colors.navy }, authInner: { flex: 1, paddingHorizontal: 24, justifyContent: "center" }, logo: { width: 52, height: 52, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#43d6a5" }, logoText: { color: colors.navy, fontSize: 28, fontWeight: "900" }, authTitle: { color: "white", fontSize: 34, lineHeight: 40, fontWeight: "800", marginTop: 22, maxWidth: 340 }, authCopy: { color: "#c2cce0", lineHeight: 22, marginTop: 10, marginBottom: 25 }, authCard: { backgroundColor: "white", borderRadius: 8, padding: 18, gap: 9 }, label: { color: colors.text, fontWeight: "700", marginTop: 3 }, input: { height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 13, fontSize: 16, color: colors.text, backgroundColor: "#f8fafc" }, formError: { color: colors.coral, marginVertical: 3 }, primaryButton: { height: 52, alignItems: "center", justifyContent: "center", backgroundColor: colors.green, borderRadius: 7, marginTop: 6 }, primaryButtonText: { color: "white", fontSize: 16, fontWeight: "800" }, secondaryButton: { height: 48, alignItems: "center", justifyContent: "center", borderRadius: 7, borderWidth: 1, borderColor: colors.border }, secondaryButtonText: { color: colors.text, fontWeight: "800" }
});
