import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, Image, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError } from "./src/api";
import { colors } from "./src/theme";
import { registerPushToken } from "./src/push";
import { applyChecklistToggle, formatShortDate, groceryEstimateAmount, recurringBudgetSetAside, mealWeeksForMonth, currentMealWeekNumber, weekDayDatesForWeek } from "./src/planningLogic";
import {
  groupPlanTasksByBucket, defaultPlanAnchorDate,
  dailyTaskOccursOnDate, isDailyTaskDoneOnDate, toggleDailyTaskDoneOnDate,
  timeToMinutes, minutesToTime, snapMinutes, comparePlannedToActual
} from "./src/planLogic";
import { formatFileSize, folderPath, childFolders, documentsInFolder } from "./src/documentsLogic";
import {
  uniqueId, computeBillSplitAmounts, netBalancesByPerson, settleUpPersonIous, friendsWithoutEmailFromIous
} from "./src/iouLogic";
import type { BillSplitParticipant, NetBalanceGroup } from "./src/iouLogic";
import {
  monthKeysForScope, reportCategoriesForScope, budgetVsActualByCategory, groupTransactionsByTag, cashFlowByMonth, spentByLineInMonth
} from "./src/reportsLogic";
import type { ReportScope } from "./src/reportsLogic";
import type { Account, AccountType, ActualLog, Debt, Document, DocumentsData, Friend, Household, HouseholdAccess, HouseholdState, Iou, IouDirection, JournalEntry, Note, Paycheck, PaycheckRecurrence, PlanBucket, PlanRecurrence, PlanTask, PlannedMeal, PrivateData, SinkingFund, User, WealthAsset, WealthItemType, WealthLiability } from "./src/types";
import {
  isHoldingAssetClass, assetValue, computeTrailingMonthKeys, computeNetWorthAtDate, computeNetWorthTrend,
  accountsWithBalances, debtPayoffProgressPercent, applyDebtPayment
} from "./src/wealthLogic";
import { ensurePaycheckOccurrencesGenerated } from "./src/paychecksLogic";

type Tab = "home" | "budget" | "calendar" | "notes" | "journal" | "plan" | "documents" | "meals" | "more";
const tabs: Array<{ id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "home", label: "Home", icon: "home-outline" },
  { id: "budget", label: "Budget", icon: "wallet-outline" },
  { id: "calendar", label: "Calendar", icon: "calendar-outline" },
  { id: "notes", label: "Notes", icon: "document-text-outline" },
  { id: "journal", label: "Journal", icon: "create-outline" },
  { id: "plan", label: "Plan", icon: "layers-outline" },
  { id: "documents", label: "Documents", icon: "folder-outline" },
  { id: "meals", label: "Meals", icon: "restaurant-outline" },
  { id: "more", label: "More", icon: "grid-outline" }
];

const journalMoods = ["Happy", "Calm", "Neutral", "Stressed", "Sad", "Grateful", "Excited"];

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}

// Unlike money() above (rounds to whole currency units), this always shows
// exact cents - needed anywhere a user must match a precise split to a
// total (bill-splitting), since rounded numbers can make a correct split
// look "impossible" (same rounding bug already found and fixed on web).
function exactMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
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
  const [subScreen, setSubScreen] = useState<"sharedExpenses" | "reports" | "wealth" | "bills" | "paychecks" | null>(null);
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
      else setError(cause instanceof Error ? cause.message : "Unable to load FamilyLoop");
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
  const page = subScreen === "sharedExpenses" ? <SharedExpenses state={state} onSave={save} onBack={() => setSubScreen(null)} />
    : subScreen === "reports" ? <Reports state={state} onBack={() => setSubScreen(null)} />
    : subScreen === "wealth" ? <Wealth state={state} onSave={save} onBack={() => setSubScreen(null)} />
    : subScreen === "bills" ? <Bills state={state} onBack={() => setSubScreen(null)} onOpenBudget={() => { setSubScreen(null); setTab("budget"); }} />
    : subScreen === "paychecks" ? <Paychecks state={state} onSave={save} onBack={() => setSubScreen(null)} />
    : tab === "home" ? <Home state={state} />
    : tab === "budget" ? <Budget state={state} />
    : tab === "calendar" ? <Calendar state={state} access={access} onSave={save} />
    : tab === "notes" ? <Notes state={state} onSave={save} />
    : tab === "journal" ? <Journal privateData={activePrivateData} onSave={saveJournal} />
    : tab === "plan" ? <Plan privateData={activePrivateData} onSave={savePlans} sinkingFundNames={(state.goals?.sinkingFunds || []).map((fund) => fund.name)} />
    : tab === "documents" ? <DocumentsScreen notes={state.notes.entries} wealthAssets={state.goals?.netWorth?.assets || []} wealthLiabilities={state.goals?.netWorth?.liabilities || []} />
    : tab === "meals" ? <Meals state={state} onSave={save} />
    : <More state={state} user={user} households={households} onSelect={async (id) => {
        await api.selectHousehold(id); setLoading(true); await loadWorkspace();
      }} onSignOut={async () => { await api.signOut(); setUser(null); setState(null); }}
      onOpenSharedExpenses={() => setSubScreen("sharedExpenses")} onOpenReports={() => setSubScreen("reports")}
      onOpenWealth={() => setSubScreen("wealth")} onOpenBills={() => setSubScreen("bills")} onOpenPaychecks={() => setSubScreen("paychecks")} />;

  return <SafeAreaView style={styles.app}>
    <StatusBar style="dark" />
    <View style={styles.header}>
      <View><Text style={styles.brand}>FamilyLoop</Text><Text style={styles.household}>{selected?.name || state.household.name}</Text></View>
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
      {category.lines.map((line) => {
        const recurring = line.recurringBill?.enabled ? recurringBudgetSetAside(line.recurringBill, state.budget.month) : null;
        const detail = recurring
          ? `${recurring.frequency} · due ${recurring.nextDueDate} · set aside ${money(recurring.monthlyAmount, state.household.currency)}/mo`
          : line.dueDay ? `Due day ${line.dueDay}` : "No due date";
        return <Row key={line.id} title={line.name} detail={detail} value={`${money(spentByLine[line.id] || 0, state.household.currency)} / ${money(recurring?.monthlyAmount ?? line.planned, state.household.currency)}`} />;
      })}</Card>)}
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
  // Defaults to whichever week actually contains today (not always week 1) - opening this screen
  // on, say, the 20th of the month used to show/plan into a permanently empty week 1 on mobile,
  // the same bug already fixed on web. Remembers the last-viewed week per month in shared state
  // (selectedWeekByMonth), same field web already uses, so switching away and back keeps it.
  const weeks = mealWeeksForMonth(state.budget.month);
  const [week, setWeek] = useState(() => state.meals.selectedWeekByMonth?.[state.budget.month] ?? currentMealWeekNumber(state.budget.month));
  const [day, setDay] = useState("Monday"); const [slot, setSlot] = useState("Breakfast"); const [recipeId, setRecipeId] = useState(state.meals.recipes[0]?.id || ""); const [customMeal, setCustomMeal] = useState(""); const [servings, setServings] = useState("3");
  const current = state.meals.plannedWeek.filter((meal) => (!meal.month || meal.month === state.budget.month) && Number(meal.week || 1) === week);
  const weekDayDates = weekDayDatesForWeek(state.budget.month, week);

  const selectWeek = async (nextWeek: number) => {
    setWeek(nextWeek);
    const next = structuredClone(state);
    next.meals.selectedWeekByMonth = { ...next.meals.selectedWeekByMonth, [state.budget.month]: nextWeek };
    await onSave(next);
  };

  const plan = async () => {
    const recipe = state.meals.recipes.find((item) => item.id === recipeId);
    const mealName = recipe ? recipe.name : customMeal.trim();
    if (!mealName) return Alert.alert("Meal name needed", "Choose a recipe or type a meal name.");
    const next = structuredClone(state); const planned: PlannedMeal = { month: state.budget.month, week, day, slot, recipeId: recipe?.id || "", meal: mealName, servings: Math.max(1, Number(servings || 3)) };
    const existing = slot === "Snack" ? -1 : next.meals.plannedWeek.findIndex((item) => (!item.month || item.month === state.budget.month) && Number(item.week || 1) === week && item.day === day && (item.slot || "Dinner") === slot);
    if (existing >= 0) next.meals.plannedWeek[existing] = planned; else next.meals.plannedWeek.push(planned); next.meals.feedback = `${mealName} planned for ${day} ${slot}.`; await onSave(next);
  };
  const saveWeek = async () => { const next = structuredClone(state); const label = `${state.budget.month} · Week ${week}`; next.meals.savedWeeks ||= []; if (!next.meals.savedWeeks.includes(label)) next.meals.savedWeeks.push(label); next.meals.feedback = `${label} saved.`; await onSave(next); };
  const postGroceries = async () => {
    const next = structuredClone(state);
    const line = next.budget.categories.flatMap((category) => category.lines).find((item) => item.name.toLowerCase().includes("grocer"));
    if (!line) return Alert.alert("Budget setup needed", "Add a Groceries subcategory before posting.");
    const estimate = groceryEstimateAmount(current, state.meals.recipes);
    if (estimate <= 0) return Alert.alert("Nothing planned yet", "Plan at least one meal this week before posting a grocery estimate.");
    const amount = Number(next.meals.groceryEstimate || estimate);
    next.transactions.unshift({ date: new Date().toISOString().slice(0, 10), payee: "Meal plan groceries", lineId: line.id, amount, memo: "Posted from mobile meal planner" });
    next.meals.feedback = `${money(amount, state.household.currency)} posted to Groceries.`;
    await onSave(next);
  };
  return <Page><Title eyebrow="MEALS">Weekly meal plan</Title><Card>
    <Text style={styles.label}>Week</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{weeks.map((item) => <Pressable key={item.number} style={[styles.choice, week === item.number && styles.choiceActive]} onPress={() => void selectWeek(item.number)}><Text style={[styles.choiceText, week === item.number && styles.choiceTextActive]}>{item.label}</Text></Pressable>)}</ScrollView>
    <View style={styles.actionRow}><Pressable style={styles.secondarySmall} onPress={() => void saveWeek()}><Text style={styles.secondaryButtonText}>Save week</Text></Pressable><Pressable style={styles.secondarySmall} onPress={() => void postGroceries()}><Text style={styles.secondaryButtonText}>Post groceries</Text></Pressable></View>{state.meals.feedback ? <Text style={styles.successText}>{state.meals.feedback}</Text> : null}
    <Text style={styles.label}>Day</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{days.map((item) => <Pressable key={item} style={[styles.choice, day === item && styles.choiceActive]} onPress={() => setDay(item)}><Text style={[styles.choiceText, day === item && styles.choiceTextActive]}>{item.slice(0, 3)}</Text></Pressable>)}</ScrollView>
    <Text style={styles.label}>Meal</Text><View style={styles.choiceRow}>{slots.map((item) => <Pressable key={item} style={[styles.choice, slot === item && styles.choiceActive]} onPress={() => setSlot(item)}><Text style={[styles.choiceText, slot === item && styles.choiceTextActive]}>{item}</Text></Pressable>)}</View>
    <Text style={styles.label}>Recipe</Text>{state.meals.recipes.map((recipe) => <Pressable key={recipe.id} style={[styles.recipeChoice, recipeId === recipe.id && styles.choiceActive]} onPress={() => { setRecipeId(recipe.id); setCustomMeal(""); }}><Text style={[styles.choiceText, recipeId === recipe.id && styles.choiceTextActive]}>{recipe.name}</Text></Pressable>)}<TextInput style={styles.input} value={customMeal} onChangeText={(text) => { setCustomMeal(text); setRecipeId(""); }} placeholder="Or type any meal (no recipe)" /><TextInput style={styles.input} value={servings} onChangeText={setServings} keyboardType="number-pad" placeholder="Servings" /><Pressable style={styles.primaryButton} onPress={() => void plan()}><Text style={styles.primaryButtonText}>Plan meal</Text></Pressable>
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
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [mood, setMood] = useState(""); const [gratitude, setGratitude] = useState("");
  const entries = [...privateData.journal.entries].sort((a, b) => b.entryDate.localeCompare(a.entryDate));

  const addEntry = async () => {
    if (!title.trim() && !body.trim() && !gratitude.trim()) return;
    const now = new Date().toISOString();
    const entry: JournalEntry = { id: `journal-${Date.now()}`, entryDate: now.slice(0, 10), title: title.trim(), body: body.trim(), mood, tags: [], photos: [], createdAt: now, updatedAt: now, gratitude: gratitude.trim() };
    await onSave({ entries: [...privateData.journal.entries, entry] });
    setTitle(""); setBody(""); setMood(""); setGratitude("");
  };

  const deleteEntry = async (entryId: string) => {
    await onSave({ entries: privateData.journal.entries.filter((entry) => entry.id !== entryId) });
  };

  const updateGratitude = async (entryId: string, value: string) => {
    await onSave({ entries: privateData.journal.entries.map((entry) => entry.id === entryId ? { ...entry, gratitude: value } : entry) });
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
      <Text style={styles.label}>🙏 Grateful for</Text>
      <TextInput style={styles.input} value={gratitude} onChangeText={setGratitude} placeholder="One thing you're grateful for today" />
      <Pressable style={styles.primaryButton} onPress={() => void addEntry()}><Text style={styles.primaryButtonText}>Add entry</Text></Pressable>
    </Card>
    {entries.map((entry) => <Card key={entry.id}>
      <View style={styles.noteHeader}>
        <Text style={styles.noteTitle}>{entry.title || "Untitled entry"}</Text>
        <Pressable onPress={() => void deleteEntry(entry.id)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>
      <Text style={styles.muted}>{entry.entryDate}{entry.mood ? ` · ${entry.mood}` : ""}</Text>
      {entry.body ? <Text style={styles.noteBody}>{entry.body}</Text> : null}
      <TextInput style={[styles.input, { marginTop: 6 }]} defaultValue={entry.gratitude || ""} onEndEditing={(event) => void updateGratitude(entry.id, event.nativeEvent.text)} placeholder="🙏 Grateful for..." />
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

function describeLinkedActualLogs(task: PlanTask, linkedLogs: ActualLog[]): string {
  if (!linkedLogs.length) return "";
  if (linkedLogs.length === 1) {
    const [log] = linkedLogs;
    if (!log) return "";
    const { startDeltaMinutes, durationDeltaMinutes } = comparePlannedToActual({
      plannedStartTime: task.startTime,
      plannedDurationMinutes: task.durationMinutes || 30,
      actualStartTime: log.startTime,
      actualEndTime: log.endTime
    });
    const parts = [`Actual ${log.startTime || "?"}–${log.endTime || "?"}`];
    if (startDeltaMinutes) parts.push(`started ${Math.abs(startDeltaMinutes)} min ${startDeltaMinutes > 0 ? "late" : "early"}`);
    if (durationDeltaMinutes) parts.push(`ran ${Math.abs(durationDeltaMinutes)} min ${durationDeltaMinutes > 0 ? "over" : "under"}`);
    if (log.note) parts.push(log.note);
    return parts.join(" · ");
  }
  return `Overlaps: ${linkedLogs.map((log) => log.note).join(", ")}`;
}

function Plan({ privateData, onSave, sinkingFundNames }: { privateData: PrivateData; onSave: (plans: PrivateData["plans"]) => Promise<void>; sinkingFundNames: string[] }) {
  const [bucket, setBucket] = useState<PlanBucket>("daily");
  const [title, setTitle] = useState("");
  const [goalName, setGoalName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [recurrence, setRecurrence] = useState<PlanRecurrence>("none");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({});
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logStart, setLogStart] = useState("");
  const [logEnd, setLogEnd] = useState("");
  const [logNote, setLogNote] = useState("");
  const [logLinkedTaskIds, setLogLinkedTaskIds] = useState<string[]>([]);

  const grouped = groupPlanTasksByBucket(privateData.plans.tasks);
  const tasks = bucket === "daily"
    ? grouped.daily
        .filter((task) => dailyTaskOccursOnDate(task, selectedDate))
        .slice()
        .sort((a, b) => (timeToMinutes(a.startTime) ?? Infinity) - (timeToMinutes(b.startTime) ?? Infinity))
    : grouped[bucket];
  const logsToday = privateData.plans.actualLogs?.[selectedDate] || [];

  const saveTasks = (nextTasks: PlanTask[]) => onSave({ tasks: nextTasks, actualLogs: privateData.plans.actualLogs });

  const addTask = async () => {
    if (!title.trim()) return;
    const task: PlanTask = {
      id: `plan-${Date.now()}`, title: title.trim(), notes: "", bucket,
      anchorDate: bucket === "daily" ? selectedDate : defaultPlanAnchorDate(bucket),
      createdAt: new Date().toISOString(), subtasks: [],
      ...(bucket === "daily"
        ? { startTime: startTime.trim() || undefined, durationMinutes, recurrence, completedDates: [] }
        : { done: false, goalName: goalName || undefined })
    };
    await saveTasks([...privateData.plans.tasks, task]);
    setTitle("");
    setStartTime("");
    setDurationMinutes(30);
    setRecurrence("none");
    setGoalName("");
  };

  const changeTaskGoal = async (taskId: string, nextGoalName: string) => {
    await saveTasks(privateData.plans.tasks.map((task) => task.id === taskId ? { ...task, goalName: nextGoalName || undefined } : task));
  };

  const toggleTask = async (taskId: string) => {
    await saveTasks(privateData.plans.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return task.bucket === "daily" ? toggleDailyTaskDoneOnDate(task, selectedDate) : { ...task, done: !task.done };
    }));
  };

  const deleteTask = async (taskId: string) => {
    await saveTasks(privateData.plans.tasks.filter((task) => task.id !== taskId));
  };

  const adjustDuration = async (taskId: string, delta: number) => {
    await saveTasks(privateData.plans.tasks.map((task) => task.id === taskId
      ? { ...task, durationMinutes: Math.max(15, snapMinutes((task.durationMinutes || 30) + delta)) }
      : task));
  };

  const changeStartTime = async (taskId: string, value: string) => {
    await saveTasks(privateData.plans.tasks.map((task) => task.id === taskId ? { ...task, startTime: value.trim() || undefined } : task));
  };

  const addSubtask = async (taskId: string) => {
    const text = (subtaskDrafts[taskId] || "").trim();
    if (!text) return;
    await saveTasks(privateData.plans.tasks.map((task) => task.id === taskId
      ? { ...task, subtasks: [...(task.subtasks || []), { id: `sub-${Date.now()}`, text, done: false }] }
      : task));
    setSubtaskDrafts((prev) => ({ ...prev, [taskId]: "" }));
  };

  const toggleSubtask = async (taskId: string, subtaskId: string) => {
    await saveTasks(privateData.plans.tasks.map((task) => task.id === taskId
      ? { ...task, subtasks: (task.subtasks || []).map((subtask) => subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask) }
      : task));
  };

  const deleteSubtask = async (taskId: string, subtaskId: string) => {
    await saveTasks(privateData.plans.tasks.map((task) => task.id === taskId
      ? { ...task, subtasks: (task.subtasks || []).filter((subtask) => subtask.id !== subtaskId) }
      : task));
  };

  const shiftDay = (delta: number) => {
    const next = new Date(`${selectedDate}T00:00:00`);
    next.setDate(next.getDate() + delta);
    setSelectedDate(next.toISOString().slice(0, 10));
    resetLogForm();
  };

  const resetLogForm = () => {
    setEditingLogId(null);
    setLogStart("");
    setLogEnd("");
    setLogNote("");
    setLogLinkedTaskIds([]);
  };

  const startEditLog = (log: ActualLog) => {
    setEditingLogId(log.id);
    setLogStart(log.startTime);
    setLogEnd(log.endTime);
    setLogNote(log.note);
    setLogLinkedTaskIds(log.linkedTaskIds || []);
  };

  const toggleLinkedTask = (taskId: string) => {
    setLogLinkedTaskIds((prev) => prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]);
  };

  const saveLog = async () => {
    if (!logStart.trim() || !logEnd.trim() || !logNote.trim()) return;
    const actualLogs = { ...(privateData.plans.actualLogs || {}) };
    const logs = actualLogs[selectedDate] || [];
    actualLogs[selectedDate] = editingLogId
      ? logs.map((log) => log.id === editingLogId
          ? { ...log, startTime: logStart.trim(), endTime: logEnd.trim(), note: logNote.trim(), linkedTaskIds: logLinkedTaskIds }
          : log)
      : [...logs, { id: `actual-${Date.now()}`, startTime: logStart.trim(), endTime: logEnd.trim(), note: logNote.trim(), linkedTaskIds: logLinkedTaskIds }];
    await onSave({ tasks: privateData.plans.tasks, actualLogs });
    resetLogForm();
  };

  const deleteLog = async (logId: string) => {
    const actualLogs = { ...(privateData.plans.actualLogs || {}) };
    actualLogs[selectedDate] = (actualLogs[selectedDate] || []).filter((log) => log.id !== logId);
    await onSave({ tasks: privateData.plans.tasks, actualLogs });
    if (editingLogId === logId) resetLogForm();
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
          <Text style={[styles.rowDetail, { flex: 1 }]}>
            Duration: {durationMinutes} min{startTime.trim() && timeToMinutes(startTime.trim()) != null ? ` · Ends ${minutesToTime((timeToMinutes(startTime.trim()) as number) + durationMinutes)}` : ""}
          </Text>
          <Pressable style={styles.planStepperButton} onPress={() => setDurationMinutes((minutes) => Math.max(15, minutes - 15))}><Text style={styles.secondaryButtonText}>-15</Text></Pressable>
          <Pressable style={styles.planStepperButton} onPress={() => setDurationMinutes((minutes) => minutes + 15)}><Text style={styles.secondaryButtonText}>+15</Text></Pressable>
        </View>
        <View style={styles.choiceRow}>
          {(["none", "daily", "weekdays", "weekly", "monthly"] as PlanRecurrence[]).map((item) => <Pressable key={item} style={[styles.choice, recurrence === item && styles.choiceActive]} onPress={() => setRecurrence(item)}><Text style={[styles.choiceText, recurrence === item && styles.choiceTextActive]}>{planRecurrenceLabels[item]}</Text></Pressable>)}
        </View>
      </>}
      {bucket !== "daily" && sinkingFundNames.length > 0 && <View style={styles.choiceRow}>
        <Pressable style={[styles.choice, !goalName && styles.choiceActive]} onPress={() => setGoalName("")}><Text style={[styles.choiceText, !goalName && styles.choiceTextActive]}>No goal</Text></Pressable>
        {sinkingFundNames.map((name) => <Pressable key={name} style={[styles.choice, goalName === name && styles.choiceActive]} onPress={() => setGoalName(name)}><Text style={[styles.choiceText, goalName === name && styles.choiceTextActive]}>{name}</Text></Pressable>)}
      </View>}
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
                ? [
                    task.startTime && timeToMinutes(task.startTime) != null
                      ? `${task.startTime}–${minutesToTime((timeToMinutes(task.startTime) as number) + Number(task.durationMinutes || 30))}`
                      : "Unscheduled",
                    `${task.durationMinutes || 30} min`,
                    planRecurrenceLabels[task.recurrence || "none"]
                  ].join(" · ")
                : [task.anchorDate, task.goalName].filter(Boolean).join(" · ")}
            </Text>
          </Pressable>
          <Pressable onPress={() => void deleteTask(task.id)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
        </View>
        {bucket === "daily" && <View style={styles.actionRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={task.startTime || ""} onChangeText={(value) => void changeStartTime(task.id, value)} placeholder="Start time (HH:MM)" />
          <Pressable style={styles.planStepperButton} onPress={() => void adjustDuration(task.id, -15)}><Text style={styles.secondaryButtonText}>-15</Text></Pressable>
          <Pressable style={styles.planStepperButton} onPress={() => void adjustDuration(task.id, 15)}><Text style={styles.secondaryButtonText}>+15</Text></Pressable>
        </View>}
        {bucket !== "daily" && sinkingFundNames.length > 0 && <View style={styles.choiceRow}>
          <Pressable style={[styles.choice, !task.goalName && styles.choiceActive]} onPress={() => void changeTaskGoal(task.id, "")}><Text style={[styles.choiceText, !task.goalName && styles.choiceTextActive]}>No goal</Text></Pressable>
          {sinkingFundNames.map((name) => <Pressable key={name} style={[styles.choice, task.goalName === name && styles.choiceActive]} onPress={() => void changeTaskGoal(task.id, name)}><Text style={[styles.choiceText, task.goalName === name && styles.choiceTextActive]}>{name}</Text></Pressable>)}
        </View>}
        {bucket === "daily" && (() => {
          const linkedLogs = logsToday.filter((log) => log.linkedTaskIds.includes(task.id));
          const label = describeLinkedActualLogs(task, linkedLogs);
          return label ? <Text style={styles.rowDetail}>{label}</Text> : null;
        })()}
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
    {bucket === "daily" && <Card>
      <Text style={styles.rowTitle}>{editingLogId ? "Edit what actually happened" : "Log what actually happened"} ({formatPlanDayLabel(selectedDate)})</Text>
      <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={logStart} onChangeText={setLogStart} placeholder="Start (HH:MM)" />
        <TextInput style={[styles.input, { flex: 1 }]} value={logEnd} onChangeText={setLogEnd} placeholder="End (HH:MM)" />
      </View>
      <TextInput style={styles.input} value={logNote} onChangeText={setLogNote} placeholder="What did you actually do?" />
      {tasks.length > 0 && <View style={styles.subtaskList}>
        <Text style={styles.rowDetail}>Link to planned task(s) — optional</Text>
        {tasks.map((task) => <Pressable key={task.id} style={styles.checkRow} onPress={() => toggleLinkedTask(task.id)}>
          <Ionicons name={logLinkedTaskIds.includes(task.id) ? "checkbox" : "square-outline"} size={20} color={logLinkedTaskIds.includes(task.id) ? colors.green : colors.muted} />
          <Text style={styles.checkText}>{task.title}</Text>
        </Pressable>)}
      </View>}
      <View style={styles.actionRow}>
        <Pressable style={styles.primaryButton} onPress={() => void saveLog()}><Text style={styles.primaryButtonText}>{editingLogId ? "Save changes" : "Log it"}</Text></Pressable>
        {editingLogId && <Pressable style={styles.secondarySmall} onPress={resetLogForm}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>}
        {editingLogId && <Pressable style={styles.secondarySmall} onPress={() => void deleteLog(editingLogId)}><Text style={[styles.secondaryButtonText, { color: colors.coral }]}>Delete</Text></Pressable>}
      </View>
      {logsToday.length > 0 && <View style={styles.subtaskList}>
        {logsToday.map((log) => {
          const linkedTitles = log.linkedTaskIds.map((id) => tasks.find((task) => task.id === id)?.title).filter(Boolean);
          return <Pressable key={log.id} style={styles.row} onPress={() => startEditLog(log)}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{log.note}</Text>
              <Text style={styles.rowDetail}>{log.startTime}–{log.endTime}{linkedTitles.length ? ` · ${linkedTitles.join(", ")}` : ""}</Text>
            </View>
            <Pressable onPress={() => void deleteLog(log.id)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
          </Pressable>;
        })}
      </View>}
    </Card>}
  </Page>;
}

function DocumentRow({ document, notes, folders, wealthAssets, wealthLiabilities, onDownload, onDelete, onLinkNote, onMove, onLinkWealth }: {
  document: Document; notes: Note[]; folders: DocumentsData["folders"]; wealthAssets: WealthAsset[]; wealthLiabilities: WealthLiability[];
  onDownload: () => void; onDelete: () => void; onLinkNote: (noteId: string | null) => void; onMove: (folderId: string | null) => void;
  onLinkWealth: (wealthItemType: WealthItemType | null, wealthItemId: string | null) => void
}) {
  const [showNotePicker, setShowNotePicker] = useState(false);
  const linkedNote = document.noteId ? notes.find((note) => note.id === document.noteId) : null;
  const linkedWealthItem = document.wealthItemId
    ? (document.wealthItemType === "liability" ? wealthLiabilities : wealthAssets).find((item) => item.id === document.wealthItemId)
    : null;

  const promptMove = () => {
    const options = [
      ...folders.filter((folder) => folder.id !== document.folderId).map((folder) => ({ text: folder.name, onPress: () => onMove(folder.id) })),
      ...(document.folderId ? [{ text: "All documents (root)", onPress: () => onMove(null) }] : []),
      { text: "Cancel", style: "cancel" as const }
    ];
    Alert.alert("Move to folder", document.name, options);
  };

  const promptWealthLink = () => {
    const options = [
      ...(document.wealthItemId ? [{ text: "Remove tag", onPress: () => onLinkWealth(null, null) }] : []),
      ...wealthAssets.filter((asset) => asset.id).map((asset) => ({ text: `Asset: ${asset.name}`, onPress: () => onLinkWealth("asset", asset.id as string) })),
      ...wealthLiabilities.filter((liability) => liability.id).map((liability) => ({ text: `Liability: ${liability.name}`, onPress: () => onLinkWealth("liability", liability.id as string) })),
      { text: "Cancel", style: "cancel" as const }
    ];
    Alert.alert("Tag to a wealth item", document.name, options);
  };

  return <View style={styles.planTaskBlock}>
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{document.name}</Text>
        <Text style={styles.rowDetail}>{[formatFileSize(document.sizeBytes), document.status === "pending" ? "Uploading…" : document.contentType].filter(Boolean).join(" · ")}</Text>
        {linkedNote ? <Text style={styles.rowDetail}>Linked to “{linkedNote.title || "Untitled note"}”</Text> : null}
        {linkedWealthItem ? <Text style={styles.rowDetail}>Tagged to {document.wealthItemType === "liability" ? "Liability" : "Asset"}: {linkedWealthItem.name}</Text> : null}
      </View>
      <Pressable onPress={promptMove}><Ionicons name="folder-outline" size={20} color={colors.text} /></Pressable>
      <Pressable onPress={onDownload}><Ionicons name="download-outline" size={20} color={colors.text} /></Pressable>
      <Pressable onPress={() => setShowNotePicker((prev) => !prev)}><Ionicons name="link-outline" size={20} color={linkedNote ? colors.green : colors.muted} /></Pressable>
      <Pressable onPress={promptWealthLink}><Ionicons name="cash-outline" size={20} color={linkedWealthItem ? colors.green : colors.muted} /></Pressable>
      <Pressable onPress={onDelete}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
    </View>
    {showNotePicker ? <View style={styles.subtaskList}>
      <Pressable style={styles.checkRow} onPress={() => { onLinkNote(null); setShowNotePicker(false); }}>
        <Ionicons name={!document.noteId ? "radio-button-on" : "radio-button-off"} size={18} color={colors.muted} />
        <Text style={styles.checkText}>No linked note</Text>
      </Pressable>
      {notes.map((note) => <Pressable key={note.id} style={styles.checkRow} onPress={() => { onLinkNote(note.id); setShowNotePicker(false); }}>
        <Ionicons name={document.noteId === note.id ? "radio-button-on" : "radio-button-off"} size={18} color={colors.muted} />
        <Text style={styles.checkText}>{note.title || "Untitled note"}</Text>
      </Pressable>)}
    </View> : null}
  </View>;
}

function DocumentsScreen({ notes, wealthAssets, wealthLiabilities }: { notes: Note[]; wealthAssets: WealthAsset[]; wealthLiabilities: WealthLiability[] }) {
  const [data, setData] = useState<DocumentsData | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [error, setError] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api.documents();
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load documents");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const showError = (title: string, cause: unknown) => Alert.alert(title, cause instanceof Error ? cause.message : "Unknown error");

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await api.createDocumentFolder(newFolderName.trim(), currentFolderId);
      setNewFolderName("");
      await load();
    } catch (cause) { showError("Could not create folder", cause); }
  };

  const deleteFolder = (folderId: string) => {
    Alert.alert("Delete folder?", "It must be empty.", [{ text: "Cancel" }, {
      text: "Delete", style: "destructive", onPress: async () => {
        try { await api.deleteDocumentFolder(folderId); await load(); }
        catch (cause) { showError("Could not delete folder", cause); }
      }
    }]);
  };

  const startRenameFolder = (folderId: string, currentName: string) => {
    setRenamingFolderId(folderId);
    setRenameDraft(currentName);
  };

  const saveRenameFolder = async () => {
    const folderId = renamingFolderId;
    const name = renameDraft.trim();
    setRenamingFolderId(null);
    if (!folderId || !name) return;
    try { await api.updateDocumentFolder(folderId, { name }); await load(); }
    catch (cause) { showError("Could not rename folder", cause); }
  };

  const linkFolderWealthItem = async (folderId: string, wealthItemType: WealthItemType | null, wealthItemId: string | null) => {
    try { await api.updateDocumentFolder(folderId, { wealthItemType, wealthItemId }); await load(); }
    catch (cause) { showError("Could not tag folder", cause); }
  };

  const promptFolderWealthLink = (folder: DocumentsData["folders"][number]) => {
    const options = [
      ...(folder.wealthItemId ? [{ text: "Remove tag", onPress: () => void linkFolderWealthItem(folder.id, null, null) }] : []),
      ...wealthAssets.filter((asset) => asset.id).map((asset) => ({ text: `Asset: ${asset.name}`, onPress: () => void linkFolderWealthItem(folder.id, "asset", asset.id as string) })),
      ...wealthLiabilities.filter((liability) => liability.id).map((liability) => ({ text: `Liability: ${liability.name}`, onPress: () => void linkFolderWealthItem(folder.id, "liability", liability.id as string) })),
      { text: "Cancel", style: "cancel" as const }
    ];
    Alert.alert("Tag folder to a wealth item", folder.name, options);
  };

  const uploadDocument = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setUploading(true);
    try {
      const { documentId, uploadUrl } = await api.requestDocumentUploadUrl({
        name: asset.name,
        contentType: asset.mimeType || "application/octet-stream",
        sizeBytes: asset.size || 0,
        folderId: currentFolderId
      });
      // In MEMORY_DB (test/preview) mode the server returns a placeholder URL
      // rather than a real signed GCS URL — only a real deployment with
      // GCS_BUCKET configured issues an http(s) signed URL this PUT reaches.
      if (/^https?:\/\//.test(uploadUrl)) {
        await FileSystem.uploadAsync(uploadUrl, asset.uri, {
          httpMethod: "PUT",
          headers: { "Content-Type": asset.mimeType || "application/octet-stream" }
        });
      }
      await api.confirmDocumentUpload(documentId);
      await load();
    } catch (cause) {
      showError("Upload failed", cause);
    } finally {
      setUploading(false);
    }
  };

  const downloadDocument = async (documentId: string) => {
    try {
      const { url } = await api.documentDownloadUrl(documentId);
      await Linking.openURL(url);
    } catch (cause) { showError("Could not open document", cause); }
  };

  const deleteDocument = (documentId: string) => {
    Alert.alert("Delete document?", "This cannot be undone.", [{ text: "Cancel" }, {
      text: "Delete", style: "destructive", onPress: async () => {
        try { await api.deleteDocument(documentId); await load(); }
        catch (cause) { showError("Could not delete document", cause); }
      }
    }]);
  };

  const linkNote = async (documentId: string, noteId: string | null) => {
    try { await api.updateDocument(documentId, { noteId }); await load(); }
    catch (cause) { showError("Could not link note", cause); }
  };

  const moveDocument = async (documentId: string, folderId: string | null) => {
    try { await api.updateDocument(documentId, { folderId }); await load(); }
    catch (cause) { showError("Could not move document", cause); }
  };

  const linkWealthItem = async (documentId: string, wealthItemType: WealthItemType | null, wealthItemId: string | null) => {
    try { await api.updateDocument(documentId, { wealthItemType, wealthItemId }); await load(); }
    catch (cause) { showError("Could not tag wealth item", cause); }
  };

  if (!data) {
    return <Page><Title eyebrow="DOCUMENTS">Household documents</Title>
      {error ? <Text style={styles.formError}>{error}</Text> : <ActivityIndicator color={colors.green} />}
    </Page>;
  }

  const subfolders = childFolders(data.folders, currentFolderId);
  const documents = documentsInFolder(data.documents, currentFolderId);
  const breadcrumb = folderPath(data.folders, currentFolderId);

  return <Page>
    <Title eyebrow="DOCUMENTS">Household documents</Title>
    <Text style={styles.muted}>Shared with your whole household — deeds, patta, tax receipts and other property documents.</Text>
    <View style={styles.documentsBreadcrumbRow}>
      <Pressable onPress={() => setCurrentFolderId(null)}><Text style={[styles.documentsBreadcrumbText, !currentFolderId && styles.documentsBreadcrumbActive]}>All documents</Text></Pressable>
      {breadcrumb.map((folder) => <View key={folder.id} style={styles.documentsBreadcrumbItem}>
        <Text style={styles.muted}> / </Text>
        <Pressable onPress={() => setCurrentFolderId(folder.id)}><Text style={[styles.documentsBreadcrumbText, currentFolderId === folder.id && styles.documentsBreadcrumbActive]}>{folder.name}</Text></Pressable>
      </View>)}
    </View>
    <Card>
      <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={newFolderName} onChangeText={setNewFolderName} placeholder="New folder name" />
        <Pressable style={styles.secondarySmall} onPress={() => void createFolder()}><Text style={styles.secondaryButtonText}>Add folder</Text></Pressable>
      </View>
      <Pressable style={styles.primaryButton} onPress={() => void uploadDocument()} disabled={uploading}>
        <Text style={styles.primaryButtonText}>{uploading ? "Uploading…" : "Upload a document"}</Text>
      </Pressable>
    </Card>
    {subfolders.length ? <Card>{subfolders.map((folder) => {
      const linkedWealthItem = folder.wealthItemId
        ? (folder.wealthItemType === "liability" ? wealthLiabilities : wealthAssets).find((item) => item.id === folder.wealthItemId)
        : null;
      if (renamingFolderId === folder.id) {
        return <View key={folder.id} style={styles.row}>
          <TextInput style={[styles.input, styles.rowCopy]} value={renameDraft} onChangeText={setRenameDraft} autoFocus onSubmitEditing={() => void saveRenameFolder()} />
          <Pressable onPress={() => void saveRenameFolder()}><Ionicons name="checkmark-outline" size={20} color={colors.green} /></Pressable>
          <Pressable onPress={() => setRenamingFolderId(null)}><Ionicons name="close-outline" size={20} color={colors.muted} /></Pressable>
        </View>;
      }
      return <View key={folder.id} style={styles.row}>
        <Pressable style={styles.rowCopy} onPress={() => setCurrentFolderId(folder.id)}>
          <Text style={styles.rowTitle}>{folder.name}</Text>
          {linkedWealthItem ? <Text style={styles.rowDetail}>Tagged to {folder.wealthItemType === "liability" ? "Liability" : "Asset"}: {linkedWealthItem.name}</Text> : null}
        </Pressable>
        <Pressable onPress={() => startRenameFolder(folder.id, folder.name)}><Ionicons name="pencil-outline" size={18} color={colors.text} /></Pressable>
        <Pressable onPress={() => promptFolderWealthLink(folder)}><Ionicons name="cash-outline" size={20} color={linkedWealthItem ? colors.green : colors.muted} /></Pressable>
        <Pressable onPress={() => deleteFolder(folder.id)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>;
    })}</Card> : null}
    <Card>{documents.length
      ? documents.map((document) => <DocumentRow
          key={document.id} document={document} notes={notes} folders={data.folders}
          wealthAssets={wealthAssets} wealthLiabilities={wealthLiabilities}
          onDownload={() => void downloadDocument(document.id)}
          onDelete={() => deleteDocument(document.id)}
          onLinkNote={(noteId) => void linkNote(document.id, noteId)}
          onMove={(folderId) => void moveDocument(document.id, folderId)}
          onLinkWealth={(wealthItemType, wealthItemId) => void linkWealthItem(document.id, wealthItemType, wealthItemId)}
        />)
      : <Text style={styles.muted}>No documents in this folder yet.</Text>}</Card>
  </Page>;
}

function SubScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <View style={styles.subScreenHeader}>
    <Pressable style={styles.subScreenBack} onPress={onBack}><Ionicons name="arrow-back" size={22} color={colors.text} /></Pressable>
    <Title eyebrow="MONEY">{title}</Title>
  </View>;
}

async function inviteNewFriend(name: string, email: string, householdName: string, existing: Friend[]): Promise<Friend[]> {
  const trimmedEmail = email.trim();
  const trimmedName = name.trim();
  if (!trimmedEmail) return existing;
  const normalized = trimmedEmail.toLowerCase();
  if (existing.some((friend) => friend.email.toLowerCase() === normalized)) return existing;
  const friend: Friend = { id: uniqueId("friend"), name: trimmedName || trimmedEmail, email: trimmedEmail, invitedAt: "" };
  try {
    await api.inviteFriend(friend.name, friend.email, householdName);
    friend.invitedAt = new Date().toISOString();
  } catch { /* invite email is best-effort; the friend record is kept either way */ }
  return [...existing, friend];
}

function SharedExpenses({ state, onSave, onBack }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void>; onBack: () => void }) {
  const ious = state.ious || [];
  const friends = state.friends || [];
  const currency = state.household.currency;
  const today = () => new Date().toISOString().slice(0, 10);

  const [debtPerson, setDebtPerson] = useState("");
  const [debtEmail, setDebtEmail] = useState("");
  const [debtAmount, setDebtAmount] = useState("");
  const [debtDirection, setDebtDirection] = useState<IouDirection>("i_owe");
  const [debtReason, setDebtReason] = useState("");
  const [debtDate, setDebtDate] = useState(today);

  const [billReason, setBillReason] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billDate, setBillDate] = useState(today);
  const [splitType, setSplitType] = useState<"equal" | "exact" | "percentage">("equal");
  const [splitRows, setSplitRows] = useState<Array<{ person: string; email: string; amount: string; percent: string }>>([{ person: "", email: "", amount: "", percent: "" }]);

  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [settleAmount, setSettleAmount] = useState("");

  const [newFriendName, setNewFriendName] = useState("");
  const [newFriendEmail, setNewFriendEmail] = useState("");

  const submitDebt = async () => {
    const amount = Number(debtAmount);
    if (!debtPerson.trim() || !(amount > 0)) return Alert.alert("Missing info", "Enter a person and a positive amount.");
    const nextFriends = await inviteNewFriend(debtPerson, debtEmail, state.household.name, friends);
    const nextIou: Iou = {
      id: uniqueId("iou"), person: debtPerson.trim(), amount, direction: debtDirection,
      reason: debtReason.trim(), date: debtDate || today(), accountId: "", settled: false, settledDate: ""
    };
    await onSave({ ...state, friends: nextFriends, ious: [...ious, nextIou] });
    setDebtPerson(""); setDebtEmail(""); setDebtAmount(""); setDebtReason("");
  };

  const updateSplitRow = (index: number, patch: Partial<{ person: string; email: string; amount: string; percent: string }>) => {
    setSplitRows((prev) => prev.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };
  const addSplitRow = () => setSplitRows((prev) => [...prev, { person: "", email: "", amount: "", percent: "" }]);
  const removeSplitRow = (index: number) => setSplitRows((prev) => prev.length > 1 ? prev.filter((_, rowIndex) => rowIndex !== index) : prev);

  const splitParticipants: BillSplitParticipant[] = splitRows.map((row) => ({ amount: Number(row.amount) || 0, percent: Number(row.percent) || 0 }));
  const splitResult = computeBillSplitAmounts(splitType, Number(billAmount) || 0, splitParticipants);

  const submitSplitBill = async () => {
    const total = Number(billAmount);
    const namedRows = splitRows.filter((row) => row.person.trim());
    if (!billReason.trim() || !(total > 0) || !namedRows.length) return Alert.alert("Missing info", "Enter what it was for, the total bill, and at least one friend.");
    if (!splitResult.ok) return Alert.alert("Can't split", splitResult.error);
    let nextFriends = friends;
    const newIous: Iou[] = [];
    for (const row of splitRows) {
      if (!row.person.trim()) continue;
      const index = splitRows.indexOf(row);
      const friendAmount = splitResult.friendAmounts[index] ?? 0;
      nextFriends = await inviteNewFriend(row.person, row.email, state.household.name, nextFriends);
      newIous.push({
        id: uniqueId("iou"), person: row.person.trim(), amount: friendAmount, direction: "owed_to_me",
        reason: billReason.trim(), date: billDate || today(), accountId: "", settled: false, settledDate: ""
      });
    }
    await onSave({ ...state, friends: nextFriends, ious: [...ious, ...newIous] });
    setBillReason(""); setBillAmount(""); setSplitRows([{ person: "", email: "", amount: "", percent: "" }]); setSplitType("equal");
  };

  const balances = netBalancesByPerson(ious);

  const confirmSettleUp = async (personKey: string) => {
    const amount = Number(settleAmount);
    if (!(amount > 0)) return Alert.alert("Missing info", "Enter a positive amount to settle.");
    const result = settleUpPersonIous(ious, personKey, amount, today(), () => uniqueId("iou"));
    if (!result.ok) return Alert.alert("Can't settle up", result.error);
    await onSave({ ...state, ious: result.ious });
    setSettlingKey(null); setSettleAmount("");
  };

  const knownNames = new Set(friends.map((friend) => friend.name.trim().toLowerCase()));
  const virtualFriends: Friend[] = friendsWithoutEmailFromIous(ious, knownNames).map((name) => ({ id: "", name, email: "", invitedAt: "" }));
  const friendRows = [...friends, ...virtualFriends].sort((a, b) => a.name.localeCompare(b.name));

  const submitAddFriend = async () => {
    if (!newFriendName.trim()) return;
    const nextFriends = await inviteNewFriend(newFriendName, newFriendEmail, state.household.name, friends);
    await onSave({ ...state, friends: nextFriends });
    setNewFriendName(""); setNewFriendEmail("");
  };

  const updateFriendEmail = async (name: string, email: string) => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;
    const key = name.trim().toLowerCase();
    const existing = friends.find((friend) => friend.name.trim().toLowerCase() === key);
    if (existing && existing.email.toLowerCase() === trimmedEmail.toLowerCase()) return;
    let nextFriends: Friend[];
    if (existing) {
      let invitedAt = existing.invitedAt;
      try { await api.inviteFriend(existing.name, trimmedEmail, state.household.name); invitedAt = new Date().toISOString(); } catch { /* best-effort */ }
      nextFriends = friends.map((friend) => friend.id === existing.id ? { ...friend, email: trimmedEmail, invitedAt } : friend);
    } else {
      nextFriends = await inviteNewFriend(name, trimmedEmail, state.household.name, friends);
    }
    await onSave({ ...state, friends: nextFriends });
  };

  return <Page>
    <SubScreenHeader title="Shared Expenses" onBack={onBack} />

    <Card>
      <Text style={styles.cardTitle}>Record a debt</Text>
      <Text style={styles.label}>Person</Text>
      <TextInput style={styles.input} value={debtPerson} onChangeText={setDebtPerson} placeholder="Jordan" />
      <Text style={styles.label}>Email (optional, invites new friends)</Text>
      <TextInput style={styles.input} value={debtEmail} onChangeText={setDebtEmail} placeholder="jordan@example.com" autoCapitalize="none" keyboardType="email-address" />
      <Text style={styles.label}>Amount</Text>
      <TextInput style={styles.input} value={debtAmount} onChangeText={setDebtAmount} placeholder="0.00" keyboardType="decimal-pad" />
      <View style={styles.choiceRow}>
        <Pressable style={[styles.choice, debtDirection === "i_owe" && styles.choiceActive]} onPress={() => setDebtDirection("i_owe")}><Text style={[styles.choiceText, debtDirection === "i_owe" && styles.choiceTextActive]}>I owe them</Text></Pressable>
        <Pressable style={[styles.choice, debtDirection === "owed_to_me" && styles.choiceActive]} onPress={() => setDebtDirection("owed_to_me")}><Text style={[styles.choiceText, debtDirection === "owed_to_me" && styles.choiceTextActive]}>They owe me</Text></Pressable>
      </View>
      <Text style={styles.label}>Reason (optional)</Text>
      <TextInput style={styles.input} value={debtReason} onChangeText={setDebtReason} placeholder="What was it for" />
      <Text style={styles.label}>Date</Text>
      <TextInput style={styles.input} value={debtDate} onChangeText={setDebtDate} placeholder="YYYY-MM-DD" />
      <Pressable style={styles.primaryButton} onPress={() => void submitDebt()}><Text style={styles.primaryButtonText}>Add debt</Text></Pressable>
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Split a bill with friends</Text>
      <Text style={styles.muted}>Enter the total bill including your own share — only your friends' shares become debts.</Text>
      <Text style={styles.label}>What for</Text>
      <TextInput style={styles.input} value={billReason} onChangeText={setBillReason} placeholder="Dinner, groceries..." />
      <Text style={styles.label}>Total bill (including your share)</Text>
      <TextInput style={styles.input} value={billAmount} onChangeText={setBillAmount} placeholder="0.00" keyboardType="decimal-pad" />
      <Text style={styles.label}>Date</Text>
      <TextInput style={styles.input} value={billDate} onChangeText={setBillDate} placeholder="YYYY-MM-DD" />
      <View style={styles.choiceRow}>
        {(["equal", "exact", "percentage"] as const).map((type) => <Pressable key={type} style={[styles.choice, splitType === type && styles.choiceActive]} onPress={() => setSplitType(type)}>
          <Text style={[styles.choiceText, splitType === type && styles.choiceTextActive]}>{type === "equal" ? "Equal" : type === "exact" ? "Exact amounts" : "Percentage"}</Text>
        </Pressable>)}
      </View>
      {splitRows.map((row, index) => <View key={index} style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={row.person} onChangeText={(value) => updateSplitRow(index, { person: value })} placeholder="Friend's name" />
        {splitType === "percentage"
          ? <TextInput style={[styles.input, { width: 80 }]} value={row.percent} onChangeText={(value) => updateSplitRow(index, { percent: value })} placeholder="%" keyboardType="decimal-pad" />
          : splitType === "equal"
          ? <View style={[styles.input, { width: 100, justifyContent: "center" }]}><Text style={styles.rowTitle}>{exactMoney(splitResult.ok ? (splitResult.friendAmounts[index] ?? 0) : 0, currency)}</Text></View>
          : <TextInput style={[styles.input, { width: 100 }]} value={row.amount} onChangeText={(value) => updateSplitRow(index, { amount: value })} placeholder="0.00" keyboardType="decimal-pad" />}
        <Pressable style={styles.planStepperButton} onPress={() => removeSplitRow(index)}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
      </View>)}
      <Pressable style={styles.secondarySmall} onPress={addSplitRow}><Text style={styles.secondaryButtonText}>+ Add another person</Text></Pressable>
      <View style={[styles.row, { borderBottomWidth: 0 }]}>
        <Text style={styles.rowTitle}>Your remaining share</Text>
        <Text style={[styles.rowValue, splitResult.ok && splitResult.payerAmount < 0 && { color: colors.coral }]}>{splitResult.ok ? exactMoney(splitResult.payerAmount, currency) : "—"}</Text>
      </View>
      {!splitResult.ok ? <Text style={styles.formError}>{splitResult.error}</Text> : null}
      <Pressable style={styles.primaryButton} onPress={() => void submitSplitBill()}><Text style={styles.primaryButtonText}>Split and add</Text></Pressable>
    </Card>

    {balances.length
      ? balances.map((group) => <IouBalanceCard key={group.key} group={group} currency={currency}
          settling={settlingKey === group.key} settleAmount={settleAmount} onSettleAmountChange={setSettleAmount}
          onToggleSettle={() => {
            if (settlingKey === group.key) { setSettlingKey(null); return; }
            setSettlingKey(group.key); setSettleAmount(group.net ? Math.abs(group.net).toFixed(2) : "");
          }}
          onConfirmSettle={() => void confirmSettleUp(group.key)}
        />)
      : <Card><Text style={styles.muted}>No shared expenses yet</Text></Card>}

    <Card>
      <Text style={styles.cardTitle}>Friends</Text>
      <Text style={styles.muted}>Everyone you've split a debt or expense with — add an email any time to send them an invite.</Text>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={newFriendName} onChangeText={setNewFriendName} placeholder="Jordan" />
      <Text style={styles.label}>Email (optional)</Text>
      <TextInput style={styles.input} value={newFriendEmail} onChangeText={setNewFriendEmail} placeholder="jordan@example.com" autoCapitalize="none" keyboardType="email-address" />
      <Pressable style={styles.secondarySmall} onPress={() => void submitAddFriend()}><Text style={styles.secondaryButtonText}>Add friend</Text></Pressable>
      {friendRows.length
        ? friendRows.map((friend, index) => <FriendListRow key={friend.id || `${friend.name}-${index}`} friend={friend} onEmailChange={(email) => void updateFriendEmail(friend.name, email)} />)
        : <Text style={styles.muted}>No friends yet</Text>}
    </Card>
  </Page>;
}

function IouBalanceCard({ group, currency, settling, settleAmount, onSettleAmountChange, onToggleSettle, onConfirmSettle }: {
  group: NetBalanceGroup; currency: string; settling: boolean; settleAmount: string;
  onSettleAmountChange: (value: string) => void; onToggleSettle: () => void; onConfirmSettle: () => void;
}) {
  const isSettled = group.direction === "settled";
  const headline = isSettled ? "All settled up" : group.direction === "owed_to_me" ? `${group.label} owes you ${exactMoney(Math.abs(group.net), currency)}` : `You owe ${group.label} ${exactMoney(Math.abs(group.net), currency)}`;
  return <Card>
    <View style={styles.iouPersonHead}>
      <Text style={styles.cardTitle}>{group.label}</Text>
      {!isSettled ? <Pressable style={styles.secondarySmall} onPress={onToggleSettle}><Text style={styles.secondaryButtonText}>{settling ? "Cancel" : "Settle up"}</Text></Pressable> : null}
    </View>
    <Text style={[styles.rowTitle, { fontSize: 17, marginTop: 6 }, !isSettled && group.direction === "i_owe" && { color: colors.coral }, !isSettled && group.direction === "owed_to_me" && { color: colors.green }]}>{headline}</Text>
    <Text style={styles.muted}>{group.records.length} record{group.records.length === 1 ? "" : "s"}</Text>
    {settling ? <View style={[styles.actionRow, { marginTop: 10 }]}>
      <TextInput style={[styles.input, { flex: 1 }]} value={settleAmount} onChangeText={onSettleAmountChange} keyboardType="decimal-pad" placeholder="Amount to settle" />
      <Pressable style={styles.secondarySmall} onPress={onConfirmSettle}><Text style={styles.secondaryButtonText}>Confirm</Text></Pressable>
    </View> : null}
  </Card>;
}

function FriendListRow({ friend, onEmailChange }: { friend: Friend; onEmailChange: (email: string) => void }) {
  const [draft, setDraft] = useState(friend.email);
  return <View style={styles.householdRow}>
    <View style={styles.rowCopy}>
      <Text style={styles.rowTitle}>{friend.name}</Text>
      <Text style={styles.rowDetail}>{friend.invitedAt ? "Invited" : friend.email ? "Not yet invited" : "No email yet"}</Text>
    </View>
    <TextInput style={[styles.input, { width: 160, height: 42 }]} value={draft} onChangeText={setDraft} placeholder="Add email to invite" autoCapitalize="none" keyboardType="email-address" onEndEditing={() => onEmailChange(draft)} />
  </View>;
}

function Reports({ state, onBack }: { state: HouseholdState; onBack: () => void }) {
  const currency = state.household.currency;
  const currentMonth = state.budget.month;
  const [scopeType, setScopeType] = useState<"month" | "range" | "year">("month");
  const [scopeMonth, setScopeMonth] = useState(currentMonth);
  const [rangeStart, setRangeStart] = useState(currentMonth + "-01");
  const [rangeEnd, setRangeEnd] = useState(today());
  const [scopeYear, setScopeYear] = useState(String(new Date(currentMonth + "-01").getFullYear()));
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  function today() { return new Date().toISOString().slice(0, 10); }

  const scope: ReportScope = scopeType === "month" ? { type: "month", month: scopeMonth }
    : scopeType === "range" ? { type: "range", start: rangeStart, end: rangeEnd }
    : { type: "year", year: Number(scopeYear) || new Date().getFullYear() };
  const monthKeys = monthKeysForScope(scope, currentMonth);

  const categories = reportCategoriesForScope(state.budget.categories, state.transactions, monthKeys);
  const budgetVsActual = budgetVsActualByCategory(state.budget.categories, state.transactions, monthKeys);
  const budgetVsActualByCategoryTotals = new Map<string, { planned: number; actual: number; variance: number }>();
  budgetVsActual.forEach((row) => {
    const existing = budgetVsActualByCategoryTotals.get(row.category) || { planned: 0, actual: 0, variance: 0 };
    budgetVsActualByCategoryTotals.set(row.category, { planned: existing.planned + row.planned, actual: existing.actual + row.actual, variance: existing.variance + row.variance });
  });
  const tagGroups = groupTransactionsByTag(state.transactions);
  const cashFlow = cashFlowByMonth(state.transactions, monthKeys);
  const maxCashFlow = Math.max(...cashFlow.map((month) => Math.max(month.income, month.expenses)), 1);

  return <Page>
    <SubScreenHeader title="Reports" onBack={onBack} />

    <Card>
      <Text style={styles.cardTitle}>Scope</Text>
      <View style={styles.choiceRow}>
        {(["month", "range", "year"] as const).map((type) => <Pressable key={type} style={[styles.choice, scopeType === type && styles.choiceActive]} onPress={() => setScopeType(type)}>
          <Text style={[styles.choiceText, scopeType === type && styles.choiceTextActive]}>{type === "month" ? "Month" : type === "range" ? "Range" : "Year"}</Text>
        </Pressable>)}
      </View>
      {scopeType === "month" ? <><Text style={styles.label}>Month (YYYY-MM)</Text><TextInput style={styles.input} value={scopeMonth} onChangeText={setScopeMonth} placeholder="2026-07" /></>
        : scopeType === "range" ? <>
          <Text style={styles.label}>Start (YYYY-MM-DD)</Text><TextInput style={styles.input} value={rangeStart} onChangeText={setRangeStart} placeholder="2026-01-01" />
          <Text style={styles.label}>End (YYYY-MM-DD)</Text><TextInput style={styles.input} value={rangeEnd} onChangeText={setRangeEnd} placeholder="2026-07-21" />
        </>
        : <><Text style={styles.label}>Year</Text><TextInput style={styles.input} value={scopeYear} onChangeText={setScopeYear} placeholder="2026" keyboardType="number-pad" /></>}
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Category report</Text>
      {categories.length ? categories.map((category) => <View key={category.name} style={styles.planTaskBlock}>
        <Pressable style={styles.categoryHeader} onPress={() => setExpandedCategory(expandedCategory === category.name ? null : category.name)}>
          <View style={[styles.dot, { backgroundColor: category.color }]} />
          <Text style={[styles.rowTitle, { flex: 1 }]}>{category.name}</Text>
          <Text style={styles.rowValue}>{money(category.value, currency)}</Text>
          <Ionicons name={expandedCategory === category.name ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
        </Pressable>
        {expandedCategory === category.name ? <View style={styles.subtaskList}>
          {category.lines.length ? category.lines.map((line) => <View key={line.name} style={styles.reportSubcategoryRow}>
            <Text style={styles.rowDetail}>{line.name}</Text>
            <Text style={styles.rowDetail}>{money(line.value, currency)}</Text>
          </View>) : <Text style={styles.muted}>No subcategory spend</Text>}
        </View> : null}
      </View>) : <Text style={styles.muted}>No spend in this period</Text>}
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Budget vs Expense</Text>
      {budgetVsActualByCategoryTotals.size
        ? [...budgetVsActualByCategoryTotals.entries()].map(([category, totals]) => <Row key={category} title={category}
            detail={`Planned ${money(totals.planned, currency)} · Actual ${money(totals.actual, currency)}`}
            value={`${totals.variance >= 0 ? "+" : ""}${money(totals.variance, currency)}`} />)
        : <Text style={styles.muted}>No budget or spend in this period</Text>}
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Group by tag</Text>
      {tagGroups.length ? tagGroups.map((group) => <Row key={group.key} title={group.label} detail={`${group.transactions.length} transaction${group.transactions.length === 1 ? "" : "s"}`} value={money(group.total, currency)} />) : <Text style={styles.muted}>No tagged transactions</Text>}
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Cash flow</Text>
      {cashFlow.length ? <View style={styles.cashFlowChart}>
        {cashFlow.map((month) => <View key={month.month} style={styles.cashFlowColumn}>
          <View style={styles.cashFlowBars}>
            <View style={[styles.cashFlowBar, { height: Math.max(4, (month.income / maxCashFlow) * 100), backgroundColor: colors.green }]} />
            <View style={[styles.cashFlowBar, { height: Math.max(4, (month.expenses / maxCashFlow) * 100), backgroundColor: colors.coral }]} />
          </View>
          <Text style={styles.cashFlowLabel}>{month.month.slice(5)}</Text>
        </View>)}
      </View> : <Text style={styles.muted}>No data in this period</Text>}
      <View style={styles.choiceRow}>
        <View style={styles.cashFlowLegendItem}><View style={[styles.dot, { backgroundColor: colors.green }]} /><Text style={styles.rowDetail}>Income</Text></View>
        <View style={styles.cashFlowLegendItem}><View style={[styles.dot, { backgroundColor: colors.coral }]} /><Text style={styles.rowDetail}>Expenses</Text></View>
      </View>
    </Card>
  </Page>;
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { checking: "Checking", savings: "Savings", cash: "Cash", credit_card: "Credit card", other: "Other" };
const ACCOUNT_TYPE_ORDER: AccountType[] = ["checking", "savings", "cash", "other", "credit_card"];

// Out of scope for this pass (see the mobile catch-up plan): stock/fund holdings
// management with live price refresh, multi-currency display, and debt-to-budget-line
// auto-EMI linking - this screen covers accounts/balances, plain net-worth rows, and
// manual debt payoff tracking only.
function Wealth({ state, onSave, onBack }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void>; onBack: () => void }) {
  const currency = state.household.currency;
  const today = () => new Date().toISOString().slice(0, 10);
  const accounts = state.accounts || [];
  const debts = state.goals?.debts || [];
  const netWorthAssets = state.goals?.netWorth?.assets || [];
  const netWorthLiabilities = state.goals?.netWorth?.liabilities || [];
  const plainAssets = netWorthAssets.filter((asset) => !isHoldingAssetClass(asset.assetClass));
  const holdingAssets = netWorthAssets.filter((asset) => isHoldingAssetClass(asset.assetClass));

  const currentMonth = state.budget.month;
  const trendMonths = computeTrailingMonthKeys(currentMonth, 6);
  const trend = computeNetWorthTrend(state, trendMonths);
  const maxTrend = Math.max(...trend.map((point) => Math.abs(point.value)), 1);
  const netWorthNow = computeNetWorthAtDate(state, today());

  const balances = accountsWithBalances(state, today());
  const accountsByType = ACCOUNT_TYPE_ORDER.map((type) => ({ type, items: balances.filter((account) => account.type === type) })).filter((group) => group.items.length);

  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState<AccountType>("checking");
  const [newAccountOpening, setNewAccountOpening] = useState("");

  const submitAddAccount = async () => {
    if (!newAccountName.trim()) return Alert.alert("Missing info", "Enter an account name.");
    const account: Account = {
      id: uniqueId("account"), name: newAccountName.trim(), type: newAccountType,
      openingBalance: Number(newAccountOpening) || 0, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: today()
    };
    await onSave({ ...state, accounts: [...accounts, account] });
    setNewAccountName(""); setNewAccountOpening("");
  };

  const closeAccount = (accountId: string) => {
    Alert.alert("Close this account?", "New transactions after today will be blocked, but you can still backdate entries.", [{ text: "Cancel" }, {
      text: "Close", onPress: () => void onSave({ ...state, accounts: accounts.map((account) => account.id === accountId ? { ...account, closedAt: today() } : account) })
    }]);
  };

  const deleteAccount = (accountId: string) => {
    Alert.alert("Delete this account?", "This cannot be undone. Its linked net worth entry (if any) will be removed too.", [{ text: "Cancel" }, {
      text: "Delete", style: "destructive", onPress: () => void onSave({
        ...state, accounts: accounts.filter((account) => account.id !== accountId),
        goals: state.goals ? {
          ...state.goals,
          netWorth: state.goals.netWorth ? {
            assets: state.goals.netWorth.assets.filter((asset) => !accounts.find((account) => account.id === accountId && account.netWorthAssetId === asset.id)),
            liabilities: state.goals.netWorth.liabilities.filter((liability) => !accounts.find((account) => account.id === accountId && account.netWorthLiabilityId === liability.id))
          } : state.goals.netWorth
        } : state.goals
      })
    }]);
  };

  const [payingDebtId, setPayingDebtId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");

  const confirmDebtPayment = async (debt: Debt) => {
    const amount = Number(paymentAmount);
    if (!(amount > 0)) return Alert.alert("Missing info", "Enter a positive payment amount.");
    const result = applyDebtPayment(debt, amount, today(), () => uniqueId("payment"));
    if (!result) return Alert.alert("Already paid off", "This debt has no remaining balance.");
    const nextDebts = debts.map((item) => item === debt ? result.debt : item);
    // A debt linked to a net-worth liability by id stays in sync one-way (debt -> liability),
    // same as the web app - the liability's own .value is never independently editable once linked.
    // Guarded on a truthy debt.id: the one-time web-side migration that assigns matching ids to
    // every debt/liability pair only runs when the household has opened the web app at least once,
    // so an un-migrated household can have several debts AND liabilities all missing an id - without
    // this guard, `undefined === undefined` would match the debt to the first id-less liability found.
    const nextLiabilities = debt.id ? netWorthLiabilities.map((liability) => liability.id === debt.id ? { ...liability, value: result.debt.balance } : liability) : netWorthLiabilities;
    await onSave({ ...state, goals: { ...state.goals, debts: nextDebts, netWorth: state.goals?.netWorth ? { ...state.goals.netWorth, liabilities: nextLiabilities } : state.goals?.netWorth } });
    setPayingDebtId(null); setPaymentAmount("");
  };

  // Out of scope for this pass: auto-contribution (roundup/percent-of-paycheck),
  // which needs its own watermarked processing against transactions/paycheck
  // occurrences to avoid double-crediting - manual contributions only for now.
  const sinkingFunds = state.goals?.sinkingFunds || [];
  const [newFundName, setNewFundName] = useState("");
  const [newFundTarget, setNewFundTarget] = useState("");
  const [newFundDate, setNewFundDate] = useState("");
  const [contributingFundIndex, setContributingFundIndex] = useState<number | null>(null);
  const [contributionAmount, setContributionAmount] = useState("");

  const submitAddFund = async () => {
    if (!newFundName.trim()) return Alert.alert("Missing info", "Enter a goal name.");
    const fund: SinkingFund = { name: newFundName.trim(), target: Math.max(0, Number(newFundTarget) || 0), saved: 0, targetDate: newFundDate };
    await onSave({ ...state, goals: { ...state.goals, sinkingFunds: [...sinkingFunds, fund] } });
    setNewFundName(""); setNewFundTarget(""); setNewFundDate("");
  };

  const deleteFund = (index: number) => {
    Alert.alert("Delete this goal?", "This cannot be undone.", [{ text: "Cancel" }, {
      text: "Delete", style: "destructive", onPress: () => void onSave({ ...state, goals: { ...state.goals, sinkingFunds: sinkingFunds.filter((_, itemIndex) => itemIndex !== index) } })
    }]);
  };

  const confirmContribution = async (index: number) => {
    const amount = Number(contributionAmount);
    if (!(amount > 0)) return Alert.alert("Missing info", "Enter a positive contribution amount.");
    const nextFunds = sinkingFunds.map((fund, itemIndex) => itemIndex === index ? { ...fund, saved: Math.max(0, Number(fund.saved || 0) + amount) } : fund);
    await onSave({ ...state, goals: { ...state.goals, sinkingFunds: nextFunds } });
    setContributingFundIndex(null); setContributionAmount("");
  };

  const [newItemKind, setNewItemKind] = useState<"asset" | "liability">("asset");
  const [newItemName, setNewItemName] = useState("");
  const [newItemValue, setNewItemValue] = useState("");
  const [newItemAssetClass, setNewItemAssetClass] = useState<"cash" | "property" | "other">("cash");

  const submitAddNetWorthItem = async () => {
    if (!newItemName.trim() || !state.goals) return Alert.alert("Missing info", "Enter a name.");
    const value = Number(newItemValue) || 0;
    const netWorth = state.goals.netWorth || { assets: [], liabilities: [] };
    const nextNetWorth = newItemKind === "asset"
      ? { ...netWorth, assets: [...netWorth.assets, { id: uniqueId("asset"), name: newItemName.trim(), value, assetClass: newItemAssetClass }] }
      : { ...netWorth, liabilities: [...netWorth.liabilities, { id: uniqueId("liability"), name: newItemName.trim(), value }] };
    await onSave({ ...state, goals: { ...state.goals, netWorth: nextNetWorth } });
    setNewItemName(""); setNewItemValue("");
  };

  const deleteNetWorthItem = (kind: "asset" | "liability", id: string) => {
    if (!state.goals?.netWorth) return;
    Alert.alert(`Delete this ${kind}?`, "This cannot be undone.", [{ text: "Cancel" }, {
      text: "Delete", style: "destructive", onPress: () => void onSave({
        ...state, goals: {
          ...state.goals, netWorth: {
            assets: kind === "asset" ? state.goals!.netWorth!.assets.filter((item) => item.id !== id) : state.goals!.netWorth!.assets,
            liabilities: kind === "liability" ? state.goals!.netWorth!.liabilities.filter((item) => item.id !== id) : state.goals!.netWorth!.liabilities
          }
        }
      })
    }]);
  };

  return <Page>
    <SubScreenHeader title="Wealth" onBack={onBack} />

    <Card>
      <Text style={styles.cardTitle}>Net worth</Text>
      <Text style={styles.heroValue}>{money(netWorthNow, currency)}</Text>
      <Text style={styles.muted}>Trailing 6 months</Text>
      <View style={styles.cashFlowChart}>
        {trend.map((point) => <View key={point.month} style={styles.cashFlowColumn}>
          <View style={styles.cashFlowBars}><View style={[styles.cashFlowBar, { height: Math.max(4, (Math.abs(point.value) / maxTrend) * 100), backgroundColor: point.value >= 0 ? colors.green : colors.coral }]} /></View>
          <Text style={styles.cashFlowLabel}>{point.month.slice(5)}</Text>
        </View>)}
      </View>
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Accounts</Text>
      {accountsByType.length
        ? accountsByType.map((group) => <View key={group.type}>
            <Text style={[styles.label, { marginTop: 10 }]}>{ACCOUNT_TYPE_LABELS[group.type]}</Text>
            {group.items.map((account) => <View key={account.id} style={styles.row}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{account.name}{account.closedAt ? " (closed)" : ""}</Text>
                <Text style={styles.rowDetail}>{account.closedAt ? `Closed ${account.closedAt}` : `Since ${account.createdAt}`}</Text>
              </View>
              <Text style={[styles.rowValue, account.type === "credit_card" && account.balance > 0 && { color: colors.coral }]}>{money(account.balance, currency)}</Text>
              {!account.closedAt ? <Pressable style={styles.planStepperButton} onPress={() => closeAccount(account.id)}><Ionicons name="lock-closed-outline" size={18} color={colors.muted} /></Pressable> : null}
              <Pressable style={styles.planStepperButton} onPress={() => deleteAccount(account.id)}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
            </View>)}
          </View>)
        : <Text style={styles.muted}>No accounts yet</Text>}
      <Text style={[styles.label, { marginTop: 14 }]}>Add account</Text>
      <TextInput style={styles.input} value={newAccountName} onChangeText={setNewAccountName} placeholder="Checking" />
      <View style={styles.choiceRow}>
        {ACCOUNT_TYPE_ORDER.map((type) => <Pressable key={type} style={[styles.choice, newAccountType === type && styles.choiceActive]} onPress={() => setNewAccountType(type)}>
          <Text style={[styles.choiceText, newAccountType === type && styles.choiceTextActive]}>{ACCOUNT_TYPE_LABELS[type]}</Text>
        </Pressable>)}
      </View>
      <Text style={styles.label}>Opening balance</Text>
      <TextInput style={styles.input} value={newAccountOpening} onChangeText={setNewAccountOpening} placeholder="0.00" keyboardType="decimal-pad" />
      <Pressable style={styles.secondarySmall} onPress={() => void submitAddAccount()}><Text style={styles.secondaryButtonText}>Add account</Text></Pressable>
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Debt payoff tracker</Text>
      {debts.length ? debts.map((debt, index) => {
        const progress = debtPayoffProgressPercent(debt);
        const isPaying = payingDebtId === (debt.id || String(index));
        return <View key={debt.id || index} style={[styles.row, { flexDirection: "column", alignItems: "stretch" }]}>
          <View style={styles.iouPersonHead}>
            <Text style={styles.rowTitle}>{debt.name}</Text>
            <Text style={styles.rowValue}>{money(debt.balance, currency)}</Text>
          </View>
          <Text style={styles.rowDetail}>{debt.rate}% APR · {money(debt.minimum, currency)}/mo minimum</Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
          <Text style={styles.muted}>{progress}% paid off</Text>
          {isPaying
            ? <View style={[styles.actionRow, { marginTop: 8 }]}>
                <TextInput style={[styles.input, { flex: 1 }]} value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="decimal-pad" placeholder="Payment amount" />
                <Pressable style={styles.secondarySmall} onPress={() => void confirmDebtPayment(debt)}><Text style={styles.secondaryButtonText}>Confirm</Text></Pressable>
              </View>
            : <Pressable style={[styles.secondarySmall, { marginTop: 8 }]} onPress={() => { setPayingDebtId(debt.id || String(index)); setPaymentAmount(""); }}><Text style={styles.secondaryButtonText}>Record EMI payment</Text></Pressable>}
        </View>;
      }) : <Text style={styles.muted}>No debts tracked</Text>}
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Savings goals</Text>
      {sinkingFunds.length ? sinkingFunds.map((fund, index) => {
        const progress = Math.min(100, Math.round((Number(fund.saved || 0) / Math.max(Number(fund.target || 0), 1)) * 100));
        const isContributing = contributingFundIndex === index;
        return <View key={`${fund.name}-${index}`} style={[styles.row, { flexDirection: "column", alignItems: "stretch" }]}>
          <View style={styles.iouPersonHead}>
            <Text style={styles.rowTitle}>{fund.name}</Text>
            <Pressable onPress={() => deleteFund(index)}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
          </View>
          <Text style={styles.rowDetail}>{money(fund.saved, currency)} of {money(fund.target, currency)}{fund.targetDate ? ` · by ${fund.targetDate}` : ""}</Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
          <Text style={styles.muted}>{progress}% saved · {money(Math.max(0, fund.target - fund.saved), currency)} remaining</Text>
          {isContributing
            ? <View style={[styles.actionRow, { marginTop: 8 }]}>
                <TextInput style={[styles.input, { flex: 1 }]} value={contributionAmount} onChangeText={setContributionAmount} keyboardType="decimal-pad" placeholder="Amount to add" />
                <Pressable style={styles.secondarySmall} onPress={() => void confirmContribution(index)}><Text style={styles.secondaryButtonText}>Confirm</Text></Pressable>
              </View>
            : <Pressable style={[styles.secondarySmall, { marginTop: 8 }]} onPress={() => { setContributingFundIndex(index); setContributionAmount(""); }}><Text style={styles.secondaryButtonText}>Add to savings</Text></Pressable>}
        </View>;
      }) : <Text style={styles.muted}>No savings goals yet</Text>}
      <Text style={[styles.label, { marginTop: 14 }]}>Add a goal</Text>
      <TextInput style={styles.input} value={newFundName} onChangeText={setNewFundName} placeholder="Vacation fund" />
      <Text style={styles.label}>Target amount</Text>
      <TextInput style={styles.input} value={newFundTarget} onChangeText={setNewFundTarget} placeholder="0.00" keyboardType="decimal-pad" />
      <Text style={styles.label}>Target date (optional)</Text>
      <TextInput style={styles.input} value={newFundDate} onChangeText={setNewFundDate} placeholder="YYYY-MM-DD" />
      <Pressable style={styles.secondarySmall} onPress={() => void submitAddFund()}><Text style={styles.secondaryButtonText}>Add goal</Text></Pressable>
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Other assets &amp; liabilities</Text>
      <Text style={styles.muted}>Stock and fund holdings aren't editable here yet — use the web app to manage those.</Text>
      {plainAssets.length ? <Text style={[styles.label, { marginTop: 10 }]}>Assets</Text> : null}
      {plainAssets.map((asset, index) => <Pressable key={asset.id || index} onLongPress={() => asset.id && deleteNetWorthItem("asset", asset.id)}>
        <Row title={asset.name} detail={asset.assetClass || "other"} value={money(assetValue(asset), currency)} />
      </Pressable>)}
      {holdingAssets.length ? <Text style={styles.muted}>{holdingAssets.length} stock/fund holding{holdingAssets.length === 1 ? "" : "s"} (view on web)</Text> : null}
      {netWorthLiabilities.length ? <Text style={[styles.label, { marginTop: 10 }]}>Liabilities</Text> : null}
      {netWorthLiabilities.map((liability, index) => <Pressable key={liability.id || index} onLongPress={() => liability.id && deleteNetWorthItem("liability", liability.id)}>
        <Row title={liability.name} detail="Liability" value={money(Number(liability.value || 0), currency)} />
      </Pressable>)}
      <Text style={[styles.label, { marginTop: 14 }]}>Add asset or liability</Text>
      <View style={styles.choiceRow}>
        <Pressable style={[styles.choice, newItemKind === "asset" && styles.choiceActive]} onPress={() => setNewItemKind("asset")}><Text style={[styles.choiceText, newItemKind === "asset" && styles.choiceTextActive]}>Asset</Text></Pressable>
        <Pressable style={[styles.choice, newItemKind === "liability" && styles.choiceActive]} onPress={() => setNewItemKind("liability")}><Text style={[styles.choiceText, newItemKind === "liability" && styles.choiceTextActive]}>Liability</Text></Pressable>
      </View>
      <TextInput style={styles.input} value={newItemName} onChangeText={setNewItemName} placeholder="Name" />
      {newItemKind === "asset" ? <View style={styles.choiceRow}>
        {(["cash", "property", "other"] as const).map((assetClass) => <Pressable key={assetClass} style={[styles.choice, newItemAssetClass === assetClass && styles.choiceActive]} onPress={() => setNewItemAssetClass(assetClass)}>
          <Text style={[styles.choiceText, newItemAssetClass === assetClass && styles.choiceTextActive]}>{assetClass === "cash" ? "Cash" : assetClass === "property" ? "Property" : "Other"}</Text>
        </Pressable>)}
      </View> : null}
      <Text style={styles.label}>Value</Text>
      <TextInput style={styles.input} value={newItemValue} onChangeText={setNewItemValue} placeholder="0.00" keyboardType="decimal-pad" />
      <Pressable style={styles.secondarySmall} onPress={() => void submitAddNetWorthItem()}><Text style={styles.secondaryButtonText}>Add {newItemKind}</Text></Pressable>
      <Text style={styles.muted}>Long-press a row to delete it.</Text>
    </Card>
  </Page>;
}

type BillRow = { id: string; name: string; category: string; color: string; planned: number; dueDay: number; paid: boolean };

// A bill isn't its own object - it's just a budget line with dueDay set (see
// billsRows() on web, "Bills are the lines in your Budget with a due date
// set"). No add/edit UI here either, for the same reason: open Budget to add
// a new one or change an amount.
function billsRows(state: HouseholdState): BillRow[] {
  const dismissed = state.budget.dismissedReminders?.[state.budget.month] || [];
  const rows: BillRow[] = [];
  state.budget.categories.forEach((category) => {
    category.lines.forEach((line) => {
      if (!line.dueDay) return;
      const spent = spentByLineInMonth(state.transactions, line.id, state.budget.month);
      const planned = Number(line.planned || 0);
      rows.push({
        id: line.id, name: line.name, category: category.name, color: category.color, planned, dueDay: line.dueDay,
        paid: spent >= planned || dismissed.includes(`bill:${line.id}`)
      });
    });
  });
  return rows.sort((a, b) => a.dueDay - b.dueDay);
}

function Bills({ state, onBack, onOpenBudget }: { state: HouseholdState; onBack: () => void; onOpenBudget: () => void }) {
  const currency = state.household.currency;
  const today = new Date().getDate();
  const [filter, setFilter] = useState<"all" | "due" | "overdue">("all");
  const allBills = billsRows(state);
  const filtered = allBills.filter((bill) => {
    if (filter === "due") return !bill.paid && bill.dueDay >= today && bill.dueDay - today <= 7;
    if (filter === "overdue") return !bill.paid && bill.dueDay < today;
    return true;
  });
  const byCategory = new Map<string, { name: string; color: string; total: number }>();
  allBills.forEach((bill) => {
    const existing = byCategory.get(bill.category) || { name: bill.category, color: bill.color, total: 0 };
    existing.total += bill.planned;
    byCategory.set(bill.category, existing);
  });
  const categoryBreakdown = [...byCategory.values()].sort((a, b) => b.total - a.total);
  const maxCategory = Math.max(1, ...categoryBreakdown.map((category) => category.total));

  return <Page>
    <SubScreenHeader title="Bills" onBack={onBack} />
    <Card>
      <View style={styles.choiceRow}>
        {([["all", "All"], ["due", "Due soon"], ["overdue", "Overdue"]] as const).map(([value, label]) => <Pressable key={value} style={[styles.choice, filter === value && styles.choiceActive]} onPress={() => setFilter(value)}>
          <Text style={[styles.choiceText, filter === value && styles.choiceTextActive]}>{label}</Text>
        </Pressable>)}
      </View>
      {filtered.length ? filtered.map((bill) => <Row key={bill.id} title={bill.name}
        detail={`${bill.category} · Due day ${bill.dueDay}${bill.paid ? " · Paid" : bill.dueDay < today ? " · Overdue" : ""}`}
        value={money(bill.planned, currency)} />) : <Text style={styles.muted}>No bills match this filter.</Text>}
    </Card>
    <Card>
      <Text style={styles.cardTitle}>By category</Text>
      {categoryBreakdown.length ? categoryBreakdown.map((category) => <View key={category.name} style={{ marginBottom: 10 }}>
        <View style={styles.iouPersonHead}><Text style={styles.rowDetail}>{category.name}</Text><Text style={styles.rowDetail}>{money(category.total, currency)}</Text></View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round((category.total / maxCategory) * 100)}%`, backgroundColor: category.color }]} /></View>
      </View>) : <Text style={styles.muted}>No recurring bills yet.</Text>}
    </Card>
    <Card>
      <Text style={styles.cardTitle}>Add or edit a bill</Text>
      <Text style={styles.muted}>Bills are the lines in your Budget with a due date set — open Budget to add a new one or change an amount.</Text>
      <Pressable style={styles.secondarySmall} onPress={onOpenBudget}><Text style={styles.secondaryButtonText}>Open Budget →</Text></Pressable>
    </Card>
  </Page>;
}

const PAYCHECK_RECURRENCE_LABELS: Record<PaycheckRecurrence, string> = { once: "One-time", bonus: "Bonus", weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly" };

// Out of scope for this pass: assigning a paycheck to specific bills
// (assignedLineIds) - the paycheck/occurrence CRUD and materialization below
// is the core of the screen; bill-assignment can follow as its own change.
function Paychecks({ state, onSave, onBack }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void>; onBack: () => void }) {
  const currency = state.household.currency;
  const accounts = state.accounts || [];
  const today = () => new Date().toISOString().slice(0, 10);

  // Materializes/self-heals occurrence rows on every visit to this screen (same
  // convention as the web app's ensurePaycheckOccurrencesGenerated, which runs on
  // every render) - only actually saves when something changed, so this settles
  // after one pass instead of looping.
  useEffect(() => {
    const result = ensurePaycheckOccurrencesGenerated(state.paychecks || [], state.paycheckOccurrences || [], () => uniqueId("paycheck-occurrence"));
    const paychecksChanged = JSON.stringify(result.paychecks) !== JSON.stringify(state.paychecks || []);
    const occurrencesChanged = JSON.stringify(result.paycheckOccurrences) !== JSON.stringify(state.paycheckOccurrences || []);
    if (paychecksChanged || occurrencesChanged) void onSave({ ...state, paychecks: result.paychecks, paycheckOccurrences: result.paycheckOccurrences });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.paychecks, state.paycheckOccurrences]);

  const paychecks = state.paychecks || [];
  const occurrences = state.paycheckOccurrences || [];
  const currentMonth = state.budget.month;
  const monthOccurrences = occurrences.filter((occurrence) => occurrence.date.slice(0, 7) === currentMonth).sort((a, b) => a.date.localeCompare(b.date));

  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDate, setNewDate] = useState(today);
  const [newRecurrence, setNewRecurrence] = useState<PaycheckRecurrence>("once");
  const [newEndDate, setNewEndDate] = useState("");
  const [newDepositAccountId, setNewDepositAccountId] = useState("");

  const submitAddPaycheck = async () => {
    if (!newName.trim() || !(Number(newAmount) > 0) || !newDate) return Alert.alert("Missing info", "Enter a name, a positive amount, and a date.");
    const paycheck: Paycheck = {
      id: uniqueId("paycheck"), name: newName.trim(), date: newDate, amount: Number(newAmount),
      recurrence: newRecurrence, endDate: newEndDate || undefined, assignedLineIds: [], depositAccountId: newDepositAccountId || undefined
    };
    await onSave({ ...state, paychecks: [...paychecks, paycheck] });
    setNewName(""); setNewAmount(""); setNewEndDate(""); setNewDepositAccountId(""); setNewRecurrence("once");
  };

  const deletePaycheck = (paycheckId: string) => {
    Alert.alert("Delete this paycheck?", "Its individual pay dates will be removed too. This cannot be undone.", [{ text: "Cancel" }, {
      text: "Delete", style: "destructive", onPress: () => void onSave({
        ...state, paychecks: paychecks.filter((paycheck) => paycheck.id !== paycheckId),
        paycheckOccurrences: occurrences.filter((occurrence) => occurrence.seriesId !== paycheckId)
      })
    }]);
  };

  const deleteOccurrence = (occurrenceId: string) => {
    void onSave({ ...state, paycheckOccurrences: occurrences.filter((occurrence) => occurrence.id !== occurrenceId) });
  };

  const updateOccurrenceAmount = (occurrenceId: string, value: string) => {
    const amount = Number(value);
    if (!(amount >= 0)) return;
    void onSave({ ...state, paycheckOccurrences: occurrences.map((occurrence) => occurrence.id === occurrenceId ? { ...occurrence, amount } : occurrence) });
  };

  return <Page>
    <SubScreenHeader title="Paycheck/Income" onBack={onBack} />

    <Card>
      <Text style={styles.cardTitle}>This month's pay dates</Text>
      {monthOccurrences.length
        ? monthOccurrences.map((occurrence) => {
            const paycheck = paychecks.find((item) => item.id === occurrence.seriesId);
            return <View key={occurrence.id} style={styles.row}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{paycheck?.name || "Paycheck"}</Text>
                <Text style={styles.rowDetail}>{occurrence.date}</Text>
              </View>
              <TextInput style={[styles.input, { width: 100, height: 42 }]} defaultValue={String(occurrence.amount)} onEndEditing={(event) => updateOccurrenceAmount(occurrence.id, event.nativeEvent.text)} keyboardType="decimal-pad" />
              <Pressable style={styles.planStepperButton} onPress={() => deleteOccurrence(occurrence.id)}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
            </View>;
          })
        : <Text style={styles.muted}>No pay dates this month</Text>}
    </Card>

    <Card>
      <Text style={styles.cardTitle}>All paychecks</Text>
      {paychecks.length ? paychecks.map((paycheck) => <View key={paycheck.id} style={styles.row}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{paycheck.name}</Text>
          <Text style={styles.rowDetail}>{PAYCHECK_RECURRENCE_LABELS[paycheck.recurrence || "once"]} · Since {paycheck.date}{paycheck.endDate ? ` · Ends ${paycheck.endDate}` : ""}</Text>
        </View>
        <Text style={styles.rowValue}>{money(paycheck.amount, currency)}</Text>
        <Pressable style={styles.planStepperButton} onPress={() => deletePaycheck(paycheck.id)}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
      </View>) : <Text style={styles.muted}>No paychecks yet</Text>}
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Add paycheck/income</Text>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Jordan's salary" />
      <Text style={styles.label}>Amount</Text>
      <TextInput style={styles.input} value={newAmount} onChangeText={setNewAmount} placeholder="0.00" keyboardType="decimal-pad" />
      <Text style={styles.label}>Date</Text>
      <TextInput style={styles.input} value={newDate} onChangeText={setNewDate} placeholder="YYYY-MM-DD" />
      <Text style={styles.label}>Repeats</Text>
      <View style={styles.choiceRow}>
        {(Object.keys(PAYCHECK_RECURRENCE_LABELS) as PaycheckRecurrence[]).map((value) => <Pressable key={value} style={[styles.choice, newRecurrence === value && styles.choiceActive]} onPress={() => setNewRecurrence(value)}>
          <Text style={[styles.choiceText, newRecurrence === value && styles.choiceTextActive]}>{PAYCHECK_RECURRENCE_LABELS[value]}</Text>
        </Pressable>)}
      </View>
      {newRecurrence !== "once" && newRecurrence !== "bonus" ? <View>
        <Text style={styles.label}>End date (optional)</Text>
        <TextInput style={styles.input} value={newEndDate} onChangeText={setNewEndDate} placeholder="YYYY-MM-DD" />
      </View> : null}
      {accounts.length ? <View>
        <Text style={styles.label}>Deposit account (optional)</Text>
        <View style={styles.choiceRow}>
          <Pressable style={[styles.choice, !newDepositAccountId && styles.choiceActive]} onPress={() => setNewDepositAccountId("")}><Text style={[styles.choiceText, !newDepositAccountId && styles.choiceTextActive]}>Not linked</Text></Pressable>
          {accounts.filter((account) => account.type !== "credit_card").map((account) => <Pressable key={account.id} style={[styles.choice, newDepositAccountId === account.id && styles.choiceActive]} onPress={() => setNewDepositAccountId(account.id)}>
            <Text style={[styles.choiceText, newDepositAccountId === account.id && styles.choiceTextActive]}>{account.name}</Text>
          </Pressable>)}
        </View>
      </View> : null}
      <Pressable style={styles.primaryButton} onPress={() => void submitAddPaycheck()}><Text style={styles.primaryButtonText}>Add paycheck</Text></Pressable>
    </Card>
  </Page>;
}

function More({ state, user, households, onSelect, onSignOut, onOpenSharedExpenses, onOpenReports, onOpenWealth, onOpenBills, onOpenPaychecks }: { state: HouseholdState; user: User; households: Household[]; onSelect: (id: string) => Promise<void>; onSignOut: () => Promise<void>; onOpenSharedExpenses: () => void; onOpenReports: () => void; onOpenWealth: () => void; onOpenBills: () => void; onOpenPaychecks: () => void }) {
  const assets = state.goals?.netWorth?.assets.reduce((sum, item) => sum + mobileAssetValue(item), 0) || 0;
  const liabilities = state.goals?.netWorth?.liabilities.reduce((sum, item) => sum + Number(item.value || 0), 0) || 0;
  return <Page><Title eyebrow="ACCOUNT">More</Title><Card><Text style={styles.cardTitle}>{user.name}</Text><Text style={styles.muted}>{user.email}</Text></Card><Pressable style={styles.card} onPress={onOpenWealth}><View style={styles.iouPersonHead}><Text style={styles.cardTitle}>Household wealth</Text><Ionicons name="chevron-forward" size={20} color={colors.muted} /></View><Text style={styles.heroValue}>{money(assets - liabilities, state.household.currency)}</Text><Text style={styles.muted}>Assets {money(assets, state.household.currency)} · Liabilities {money(liabilities, state.household.currency)}</Text><Text style={styles.muted}>{(state.accounts || []).length} accounts · {state.goals?.debts?.length || 0} debt accounts with EMI plans</Text></Pressable><Card><Text style={styles.cardTitle}>Households</Text>{households.map((item) => <Pressable key={item.id} style={styles.householdRow} onPress={() => void onSelect(item.id)}><View><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.rowDetail}>{item.country} · {item.currency} · {item.role}</Text></View>{item.selected ? <Ionicons name="checkmark-circle" size={24} color={colors.green} /> : <Ionicons name="chevron-forward" size={20} color={colors.muted} />}</Pressable>)}</Card><Card><Text style={styles.cardTitle}>Money</Text><Pressable style={styles.householdRow} onPress={onOpenPaychecks}><View><Text style={styles.rowTitle}>Paycheck/Income</Text><Text style={styles.rowDetail}>Recurring income and pay dates</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={styles.householdRow} onPress={onOpenBills}><View><Text style={styles.rowTitle}>Bills</Text><Text style={styles.rowDetail}>Upcoming and overdue, by category</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={styles.householdRow} onPress={onOpenSharedExpenses}><View><Text style={styles.rowTitle}>Shared Expenses</Text><Text style={styles.rowDetail}>Split bills, track IOUs, manage friends</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={[styles.householdRow, { borderBottomWidth: 0 }]} onPress={onOpenReports}><View><Text style={styles.rowTitle}>Reports</Text><Text style={styles.rowDetail}>Category, budget vs actual, tags</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable></Card><Card><Text style={styles.cardTitle}>Meals and recipes</Text><Text style={styles.muted}>{state.meals.plannedWeek.length} planned meals · {state.meals.recipes.length} saved recipes</Text></Card><Pressable style={styles.dangerButton} onPress={() => Alert.alert("Sign out?", "You will need to sign in again.", [{ text: "Cancel" }, { text: "Sign out", style: "destructive", onPress: () => void onSignOut() }])}><Text style={styles.dangerText}>Sign out</Text></Pressable></Page>;
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
  documentsBreadcrumbRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", paddingVertical: 6 }, documentsBreadcrumbItem: { flexDirection: "row", alignItems: "center" }, documentsBreadcrumbText: { color: colors.muted, fontWeight: "700" }, documentsBreadcrumbActive: { color: colors.text },
  tabBar: { minHeight: 64, paddingTop: 7, flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }, tab: { flex: 1, alignItems: "center", gap: 3 }, tabText: { color: colors.muted, fontSize: 10, fontWeight: "700" }, tabTextActive: { color: colors.green },
  authPage: { flex: 1, backgroundColor: colors.navy }, authInner: { flex: 1, paddingHorizontal: 24, justifyContent: "center" }, logo: { width: 52, height: 52, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#43d6a5" }, logoText: { color: colors.navy, fontSize: 28, fontWeight: "900" }, authTitle: { color: "white", fontSize: 34, lineHeight: 40, fontWeight: "800", marginTop: 22, maxWidth: 340 }, authCopy: { color: "#c2cce0", lineHeight: 22, marginTop: 10, marginBottom: 25 }, authCard: { backgroundColor: "white", borderRadius: 8, padding: 18, gap: 9 }, label: { color: colors.text, fontWeight: "700", marginTop: 3 }, input: { height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 13, fontSize: 16, color: colors.text, backgroundColor: "#f8fafc" }, formError: { color: colors.coral, marginVertical: 3 }, primaryButton: { height: 52, alignItems: "center", justifyContent: "center", backgroundColor: colors.green, borderRadius: 7, marginTop: 6 }, primaryButtonText: { color: "white", fontSize: 16, fontWeight: "800" }, secondaryButton: { height: 48, alignItems: "center", justifyContent: "center", borderRadius: 7, borderWidth: 1, borderColor: colors.border }, secondaryButtonText: { color: colors.text, fontWeight: "800" },
  subScreenHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 }, subScreenBack: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  iouPersonHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reportSubcategoryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  cashFlowChart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", height: 120, marginTop: 10 }, cashFlowColumn: { alignItems: "center", gap: 6 }, cashFlowBars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 100 }, cashFlowBar: { width: 12, borderRadius: 3 }, cashFlowLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" }, cashFlowLegendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden", marginTop: 8 }, progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.green }
});
