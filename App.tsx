import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, Image, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl,
  SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
// "expo-file-system/legacy", not the package root: since SDK 54 the root still exports uploadAsync/writeAsStringAsync
// but every one of those throws at runtime ("imported from expo-file-system is deprecated").
import * as FileSystem from "expo-file-system/legacy";
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
import { formatFileSize, folderPath, childFolders, documentsInFolder, documentExpiryBadge, documentOpenedLabel } from "./src/documentsLogic";
import {
  uniqueId, computeBillSplitAmounts, netBalancesByPerson, settleUpPersonIous, friendsWithoutEmailFromIous
} from "./src/iouLogic";
import type { BillSplitParticipant, NetBalanceGroup } from "./src/iouLogic";
import {
  monthKeysForScope, reportCategoriesForScope, budgetVsActualByCategory, groupTransactionsByTag, cashFlowByMonth, spentByLineInMonth,
  flowSegments, resolveFlowSelection, transactionAmountForLines, transactionsForLines
} from "./src/reportsLogic";
import type { ReportScope } from "./src/reportsLogic";
import type { Account, AccountType, ActualLog, BudgetLine, CalendarEvent, CalendarImportDraft, ChoreRecurrence, Debt, Decision, Document, DocumentsData, Friend, Household, HouseholdAccess, HouseholdState, Iou, IouDirection, JournalEntry, Note, Paycheck, PaycheckRecurrence, PlanBucket, PlanRecurrence, PlanTask, PlannedMeal, PrivateData, ReminderPhotoDraft, ReminderRecurrence, SinkingFund, User, WealthAsset, WealthItemType, WealthLiability } from "./src/types";
import { advanceRecurringReminder, buildCalendarCsv, buildCalendarIcs, buildPhotoReminderEvent, calendarDraftToItem, icsEventsToCalendarDrafts, parseCalendarCsv, parseIcsText, resolveImportAssignees, sanitizeCalendarDrafts, choreCadenceLabels, choreCompletedKeys, completionKeyFor, currentChoreOccurrenceDate, effectiveAssignees, isChoreOccurrenceComplete, isReminderComplete, isValidClockTime, normalizeReminderPhotoDraft, reminderTiming, repairChoreCompletion, toggleChoreCompletion } from "./src/calendarLogic";
import {
  isHoldingAssetClass, assetValue, computeTrailingMonthKeys, computeNetWorthAtDate, computeNetWorthTrend,
  accountsWithBalances, debtPayoffProgressPercent, applyDebtPayment, accountAllowsDate, buildTransfer, transfersNewestFirst, updateHolding, costDisplayValue, applyQuote, adoptHoldingGroup, newHoldingRow, newHoldingGroup, renameHoldingGroup, changeHoldingGroupClass, purgeBlankHoldings, removeHoldingGroup, formatRelativeTime, holdingsInGroup, groupStockHoldings, assetClassLabelForHoldings, holdingGainLoss, groupGainLoss
} from "./src/wealthLogic";
import type { CostEntryMode, HoldingField } from "./src/wealthLogic";
import { ensurePaycheckOccurrencesGenerated, budgetIncomeFromPaychecks, paycheckIncomeForMonth } from "./src/paychecksLogic";
import { sortDecisions, createDecision, updateDecision, addDecisionItem, editDecisionItem, removeDecisionItem, moveDecisionItem, markDecided, reopenDecision } from "./src/decisionsLogic";
import type { DecisionListKey } from "./src/decisionsLogic";
import { autoContributeChoice, setAutoContributeMode, setAutoContributePercent, withGoalAutoContributions } from "./src/goalsLogic";
import type { AutoContributeChoice } from "./src/goalsLogic";
import { noteLinkedImages, imageContentType, photoFileName } from "./src/notePhotosLogic";
import { parseBankCsvTransactions, buildBankStreamDrafts, reviewDrafts, pendingDraftCountsByAccount, acceptDraft, dismissDraft, updateDraft, clearDraftsForAccount, moveDraftToTransfer, setCategorizationRule, displayDraftAmount, storedDraftAmount } from "./src/bankStreamLogic";
import type { DraftReview, ParsedBankRow } from "./src/bankStreamLogic";
import { addCategory, addLine, updateLine, budgetDeletionImpact, deleteBudgetLines, allBudgetLines, lineSnapshot, makeTransaction, parseTagsInput, transactionAssignmentLabel, splitEditorInitialRows, splitRemaining, canSaveSplit, applySplit, removeSplit } from "./src/budgetLogic";

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

function localDateKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

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
  const [subScreen, setSubScreen] = useState<"sharedExpenses" | "reports" | "wealth" | "bills" | "paychecks" | "decisions" | "bankStream" | null>(null);
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

  const save = useCallback(async (nextState: HouseholdState) => {
    // Web recomputes the month's budget income from paychecks on every render, so keep it in sync here too.
    const withIncome = nextState.paychecks ? { ...nextState, budget: { ...nextState.budget, income: budgetIncomeFromPaychecks(nextState) } } : nextState;
    // Savings goals with auto-contribute on keep accumulating as purchases/paychecks are recorded (web does this every render).
    const next = withGoalAutoContributions(repairChoreCompletion(withIncome), localDateKey());
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
    : subScreen === "bankStream" ? <BankStream state={state} onSave={save} onBack={() => setSubScreen(null)} />
    : subScreen === "decisions" ? <Decisions state={state} user={user} onSave={save} onBack={() => setSubScreen(null)} />
    : tab === "home" ? <Home state={state} />
    : tab === "budget" ? <Budget state={state} onSave={save} onOpenPaychecks={() => setSubScreen("paychecks")} />
    : tab === "calendar" ? <Calendar state={state} access={access} user={user} onSave={save} />
    : tab === "notes" ? <Notes state={state} onSave={save} />
    : tab === "journal" ? <Journal privateData={activePrivateData} onSave={saveJournal} />
    : tab === "plan" ? <Plan privateData={activePrivateData} onSave={savePlans} sinkingFundNames={(state.goals?.sinkingFunds || []).map((fund) => fund.name)} />
    : tab === "documents" ? <DocumentsScreen notes={state.notes.entries} wealthAssets={state.goals?.netWorth?.assets || []} wealthLiabilities={state.goals?.netWorth?.liabilities || []} viewerName={user.name} />
    : tab === "meals" ? <Meals state={state} onSave={save} />
    : <More state={state} user={user} households={households} onSelect={async (id) => {
        await api.selectHousehold(id); setLoading(true); await loadWorkspace();
      }} onSignOut={async () => { await api.signOut(); setUser(null); setState(null); }}
      onOpenSharedExpenses={() => setSubScreen("sharedExpenses")} onOpenReports={() => setSubScreen("reports")}
      onOpenWealth={() => setSubScreen("wealth")} onOpenBills={() => setSubScreen("bills")} onOpenPaychecks={() => setSubScreen("paychecks")} onOpenDecisions={() => setSubScreen("decisions")} onOpenBankStream={() => setSubScreen("bankStream")} />;

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

function Budget({ state, onSave, onOpenPaychecks }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void>; onOpenPaychecks: () => void }) {
  const currency = state.household.currency;
  const todayKey = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
  const allLines = allBudgetLines(state);
  const accounts = (state.accounts || []).filter((account) => !account.closedAt);

  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineName, setLineName] = useState(""); const [linePlanned, setLinePlanned] = useState(""); const [lineDueDay, setLineDueDay] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{ title: string; lineIds: string[]; categoryIndex?: number } | null>(null);

  const [editingTxIndex, setEditingTxIndex] = useState<number | null>(null);
  const [txPayee, setTxPayee] = useState(""); const [txAmount, setTxAmount] = useState(""); const [txDate, setTxDate] = useState(todayKey());
  const [txLineId, setTxLineId] = useState(allLines[0]?.id || ""); const [txAccountId, setTxAccountId] = useState(""); const [txTags, setTxTags] = useState("");
  const [showAllTx, setShowAllTx] = useState(false);
  // Split editor: which ledger transaction is being split across categories, and its working rows (amounts kept as
  // text so typing "12." doesn't get rewritten under the user).
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  const [splitRows, setSplitRows] = useState<Array<{ lineId: string; amount: string }>>([]);

  const editingSplit = editingTxIndex !== null && Boolean(state.transactions[editingTxIndex]?.splits?.length);
  // The picked category can disappear (deleted line) - fall back to the first remaining one.
  useEffect(() => { if (!allLines.some((line) => line.id === txLineId)) setTxLineId(allLines[0]?.id || ""); }, [allLines.map((line) => line.id).join("|")]);

  const beginLineEdit = (line: BudgetLine) => { setEditingLineId(line.id); setLineName(line.name); setLinePlanned(String(line.planned ?? 0)); setLineDueDay(line.dueDay ? String(line.dueDay) : ""); };
  const saveLineEdit = async () => {
    if (!editingLineId) return;
    if (!lineName.trim()) return Alert.alert("Missing info", "Enter a name.");
    const dueDay = lineDueDay.trim() ? Math.round(Number(lineDueDay)) : null;
    if (dueDay !== null && !(dueDay >= 1 && dueDay <= 31)) return Alert.alert("Invalid due day", "Enter a day of the month from 1 to 31, or leave it blank.");
    await onSave(updateLine(state, editingLineId, { name: lineName.trim(), planned: Math.max(0, Number(linePlanned) || 0), dueDay }));
    setEditingLineId(null);
  };

  const submitAddCategory = async () => {
    const next = addCategory(state, newCategoryName);
    if (!next) return Alert.alert("Can't add category", "Enter a name that isn't already used by another category.");
    await onSave(next);
    setNewCategoryName("");
  };

  const requestDelete = (title: string, lineIds: string[], categoryIndex?: number) => {
    const impact = budgetDeletionImpact(state, lineIds);
    if (impact.total === 0) {
      Alert.alert(title, "This cannot be undone.", [{ text: "Cancel" }, { text: "Remove", style: "destructive", onPress: () => void onSave(deleteBudgetLines(state, lineIds, "", categoryIndex)) }]);
      return;
    }
    setPendingDelete({ title, lineIds, categoryIndex });
  };
  const confirmPendingDelete = async (targetLineId: string) => {
    if (!pendingDelete) return;
    await onSave(deleteBudgetLines(state, pendingDelete.lineIds, targetLineId, pendingDelete.categoryIndex));
    setPendingDelete(null); setEditingLineId(null);
  };
  const pendingImpact = pendingDelete ? budgetDeletionImpact(state, pendingDelete.lineIds) : null;

  const resetTxForm = () => { setEditingTxIndex(null); setTxPayee(""); setTxAmount(""); setTxDate(todayKey()); setTxAccountId(""); setTxTags(""); };
  const beginTxEdit = (index: number) => {
    const item = state.transactions[index];
    if (!item) return;
    setEditingTxIndex(index); setTxPayee(item.payee); setTxAmount(String(item.amount)); setTxDate(item.date); setTxLineId(item.lineId || allLines[0]?.id || ""); setTxAccountId(item.accountId || ""); setTxTags((item.tags || []).join(", "));
  };
  const submitTransaction = async () => {
    const amount = Number(txAmount);
    if (!txPayee.trim() || !txAmount.trim() || !Number.isFinite(amount)) return Alert.alert("Missing info", "Enter a payee and an amount.");
    if (!txLineId) return Alert.alert("Missing info", "Add a budget subcategory first, then pick one.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(txDate)) return Alert.alert("Invalid date", "Use the format YYYY-MM-DD.");
    const account = (state.accounts || []).find((item) => item.id === txAccountId);
    if (!accountAllowsDate(account, txDate)) return Alert.alert("Account is closed", `${account?.name || "That account"} is closed — pick a date on or before its close date, or choose a different account.`);
    const input = { date: txDate, payee: txPayee.trim(), amount, lineId: txLineId, accountId: txAccountId, tags: parseTagsInput(txTags) };
    if (editingTxIndex !== null) {
      const existing = state.transactions[editingTxIndex];
      if (!existing) return;
      // A split transaction keeps its splits (and its amount, which they must add up to) - only the details that don't
      // affect the split can change here; edit the split itself with the scissors button.
      const updated = existing.splits?.length
        ? { ...existing, date: input.date, payee: input.payee, accountId: input.accountId, tags: input.tags }
        : { ...existing, ...input, ...lineSnapshot(state, txLineId) };
      await onSave({ ...state, transactions: state.transactions.map((item, index) => index === editingTxIndex ? updated : item) });
    } else {
      await onSave({ ...state, transactions: [makeTransaction(state, input), ...state.transactions] });
    }
    resetTxForm();
  };
  const openSplit = (index: number) => {
    const item = state.transactions[index];
    if (!item) return;
    setSplitIndex(index);
    setSplitRows(splitEditorInitialRows(item).map((row) => ({ lineId: row.lineId, amount: String(row.amount) })));
  };
  const splitTransaction = splitIndex !== null ? state.transactions[splitIndex] : undefined;
  const numericSplitRows = splitRows.map((row) => ({ lineId: row.lineId, amount: row.amount.trim() === "" ? 0 : Number(row.amount) }));
  const saveSplit = async () => {
    if (splitIndex === null) return;
    const result = applySplit(state, splitIndex, numericSplitRows);
    if (!result.ok) return Alert.alert("Can't save the split", result.error);
    await onSave(result.state);
    setSplitIndex(null);
  };
  const undoSplit = () => {
    if (splitIndex === null) return;
    void onSave(removeSplit(state, splitIndex));
    setSplitIndex(null);
  };
  const deleteTransaction = (index: number) => {
    const item = state.transactions[index];
    if (!item) return;
    Alert.alert("Delete transaction?", `${item.payee} · ${money(Number(item.amount), currency)}`, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => {
      void onSave({ ...state, transactions: state.transactions.filter((_, itemIndex) => itemIndex !== index) });
      if (editingTxIndex === index) resetTxForm();
    } }]);
  };

  const orderedTransactions = state.transactions.map((item, index) => ({ item, index })).sort((a, b) => b.item.date.localeCompare(a.item.date));
  const visibleTransactions = showAllTx ? orderedTransactions : orderedTransactions.slice(0, 15);
  const accountName = (id?: string) => (state.accounts || []).find((account) => account.id === id)?.name;

  return <Page><Title eyebrow="BUDGET">{state.budget.month}</Title>
    <Card>
      <Text style={styles.cardTitle}>Monthly income</Text>
      <Text style={styles.heroValue}>{money(state.budget.income, currency)}</Text>
      <Text style={styles.muted}>Calculated from your paychecks for this month.</Text>
      <Pressable style={styles.secondarySmall} onPress={onOpenPaychecks}><Text style={styles.secondaryButtonText}>Manage in Paychecks</Text></Pressable>
    </Card>

    <Card>
      <Text style={styles.cardTitle}>{editingTxIndex !== null ? "Edit transaction" : "Add transaction"}</Text>
      <TextInput style={styles.input} value={txPayee} onChangeText={setTxPayee} placeholder="Payee" />
      <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }, editingSplit && { opacity: 0.5 }]} value={txAmount} onChangeText={setTxAmount} editable={!editingSplit} placeholder="Amount (negative = refund/income)" keyboardType="numbers-and-punctuation" />
        <TextInput style={[styles.input, { flex: 1 }]} value={txDate} onChangeText={setTxDate} placeholder="YYYY-MM-DD" />
      </View>
      {editingSplit
        ? <Text style={styles.muted}>Split across {state.transactions[editingTxIndex as number]?.splits?.length} categories - its amount and categories are changed with the scissors button in the list below.</Text>
        : <>
      <Text style={styles.label}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{allLines.map((line) => <Pressable key={line.id} style={[styles.choice, txLineId === line.id && styles.choiceActive]} onPress={() => setTxLineId(line.id)}><Text style={[styles.choiceText, txLineId === line.id && styles.choiceTextActive]}>{line.category} · {line.name}</Text></Pressable>)}</ScrollView>
        </>}
      {accounts.length ? <>
        <Text style={styles.label}>Account (optional)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
          <Pressable style={[styles.choice, !txAccountId && styles.choiceActive]} onPress={() => setTxAccountId("")}><Text style={[styles.choiceText, !txAccountId && styles.choiceTextActive]}>None</Text></Pressable>
          {accounts.map((account) => <Pressable key={account.id} style={[styles.choice, txAccountId === account.id && styles.choiceActive]} onPress={() => setTxAccountId(account.id)}><Text style={[styles.choiceText, txAccountId === account.id && styles.choiceTextActive]}>{account.name}</Text></Pressable>)}
        </ScrollView>
      </> : null}
      <TextInput style={styles.input} value={txTags} onChangeText={setTxTags} placeholder="Tags (comma separated, optional)" />
      <View style={styles.actionRow}>
        <Pressable style={styles.primaryButton} onPress={() => void submitTransaction()}><Text style={styles.primaryButtonText}>{editingTxIndex !== null ? "Save changes" : "Add transaction"}</Text></Pressable>
        {editingTxIndex !== null ? <Pressable style={styles.secondarySmall} onPress={resetTxForm}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable> : null}
      </View>
    </Card>

    {splitTransaction && splitIndex !== null ? <Card>
      <View style={styles.iouPersonHead}><Text style={styles.cardTitle}>Split {splitTransaction.payee}</Text><Text style={styles.rowValue}>{money(Number(splitTransaction.amount), currency)}</Text></View>
      <Text style={styles.muted}>Divide this transaction across categories. The amounts must add up to the total.</Text>
      {splitRows.map((row, rowIndex) => <View key={rowIndex} style={styles.planTaskBlock}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{allLines.map((line) => <Pressable key={line.id} style={[styles.choice, row.lineId === line.id && styles.choiceActive]} onPress={() => setSplitRows((prev) => prev.map((item, itemIndex) => itemIndex === rowIndex ? { ...item, lineId: line.id } : item))}><Text style={[styles.choiceText, row.lineId === line.id && styles.choiceTextActive]}>{line.category} · {line.name}</Text></Pressable>)}</ScrollView>
        <View style={styles.actionRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={row.amount} onChangeText={(value) => setSplitRows((prev) => prev.map((item, itemIndex) => itemIndex === rowIndex ? { ...item, amount: value } : item))} placeholder="Amount" keyboardType="numbers-and-punctuation" />
          <Pressable style={styles.planStepperButton} onPress={() => setSplitRows((prev) => prev.filter((_, itemIndex) => itemIndex !== rowIndex))} accessibilityLabel="Remove this split row"><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
        </View>
      </View>)}
      <Pressable style={styles.secondarySmall} onPress={() => setSplitRows((prev) => [...prev, { lineId: "", amount: "0" }])}><Text style={styles.secondaryButtonText}>+ Add split</Text></Pressable>
      <Text style={[styles.rowTitle, { marginTop: 8, color: canSaveSplit(splitTransaction, numericSplitRows) ? colors.green : colors.coral }]}>{Math.abs(splitRemaining(splitTransaction, numericSplitRows)) < 0.005 ? "Fully allocated" : `${money(splitRemaining(splitTransaction, numericSplitRows), currency)} remaining`}</Text>
      <View style={styles.actionRow}>
        <Pressable style={[styles.primaryButton, !canSaveSplit(splitTransaction, numericSplitRows) && { opacity: 0.5 }]} disabled={!canSaveSplit(splitTransaction, numericSplitRows)} onPress={() => void saveSplit()}><Text style={styles.primaryButtonText}>Save split</Text></Pressable>
        <Pressable style={styles.secondarySmall} onPress={() => setSplitIndex(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
        {splitTransaction.splits?.length ? <Pressable style={styles.secondarySmall} onPress={undoSplit}><Text style={[styles.secondaryButtonText, { color: colors.coral }]}>Remove split</Text></Pressable> : null}
      </View>
    </Card> : null}

    {pendingDelete && pendingImpact ? <Card>
      <Text style={styles.cardTitle}>{pendingDelete.title}</Text>
      <Text style={styles.muted}>{[
        pendingImpact.plannedAmount > 0 ? `${money(pendingImpact.plannedAmount, currency)} planned` : null,
        pendingImpact.transactionCount ? `${pendingImpact.transactionCount} transaction${pendingImpact.transactionCount === 1 ? "" : "s"}` : null,
        pendingImpact.draftCount ? `${pendingImpact.draftCount} Bank Stream draft${pendingImpact.draftCount === 1 ? "" : "s"}` : null,
        pendingImpact.recurringExpenseCount ? `${pendingImpact.recurringExpenseCount} recurring bill${pendingImpact.recurringExpenseCount === 1 ? "" : "s"}` : null,
        pendingImpact.debtCount ? `${pendingImpact.debtCount} Wealth item${pendingImpact.debtCount === 1 ? "" : "s"}` : null,
        pendingImpact.paycheckCount ? `${pendingImpact.paycheckCount} paycheck${pendingImpact.paycheckCount === 1 ? "" : "s"}` : null
      ].filter(Boolean).join(", ")} still linked. Pick where to move them, or leave them unassigned.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
        <Pressable style={styles.choice} onPress={() => void confirmPendingDelete("")}><Text style={styles.choiceText}>Leave unassigned</Text></Pressable>
        {allLines.filter((line) => !pendingDelete.lineIds.includes(line.id)).map((line) => <Pressable key={line.id} style={styles.choice} onPress={() => void confirmPendingDelete(line.id)}><Text style={styles.choiceText}>{line.category} · {line.name}</Text></Pressable>)}
      </ScrollView>
      <Pressable style={styles.secondarySmall} onPress={() => setPendingDelete(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
    </Card> : null}

    {state.budget.categories.map((category, categoryIndex) => <Card key={category.name}>
      <View style={styles.categoryHeader}>
        <View style={[styles.dot, { backgroundColor: category.color }]} /><Text style={[styles.cardTitle, { flex: 1 }]}>{category.name}</Text>
        <Pressable onPress={() => requestDelete(`Remove ${category.name}?`, category.lines.map((line) => line.id), categoryIndex)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>
      {category.lines.map((line) => {
        const spent = spentByLineInMonth(state.transactions, line.id, state.budget.month);
        const recurring = line.recurringBill?.enabled ? recurringBudgetSetAside(line.recurringBill, state.budget.month) : null;
        const detail = recurring
          ? `${recurring.frequency} · due ${recurring.nextDueDate} · set aside ${money(recurring.monthlyAmount, currency)}/mo`
          : line.dueDay ? `Due day ${line.dueDay}` : "No due date";
        if (editingLineId === line.id) {
          return <View key={line.id} style={styles.planTaskBlock}>
            <TextInput style={styles.input} value={lineName} onChangeText={setLineName} placeholder="Subcategory name" />
            <View style={styles.actionRow}>
              <TextInput style={[styles.input, { flex: 1 }]} value={linePlanned} onChangeText={setLinePlanned} placeholder="Planned amount" keyboardType="decimal-pad" editable={!recurring} />
              <TextInput style={[styles.input, { flex: 1 }]} value={lineDueDay} onChangeText={setLineDueDay} placeholder="Due day (1-31)" keyboardType="number-pad" editable={!recurring} />
            </View>
            {recurring ? <Text style={styles.muted}>Recurring bill — the amount and due date are managed on the web app.</Text> : null}
            <View style={styles.actionRow}>
              <Pressable style={styles.primaryButton} onPress={() => void saveLineEdit()}><Text style={styles.primaryButtonText}>Save</Text></Pressable>
              <Pressable style={styles.secondarySmall} onPress={() => setEditingLineId(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
              <Pressable style={styles.planStepperButton} onPress={() => requestDelete(`Remove ${line.name}?`, [line.id])}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
            </View>
          </View>;
        }
        return <Pressable key={line.id} onPress={() => beginLineEdit(line)}><Row title={line.name} detail={detail} value={`${money(spent, currency)} / ${money(recurring?.monthlyAmount ?? line.planned, currency)}`} /></Pressable>;
      })}
      <Pressable style={styles.secondarySmall} onPress={() => void onSave(addLine(state, categoryIndex))}><Text style={styles.secondaryButtonText}>+ Add subcategory</Text></Pressable>
    </Card>)}

    <Card>
      <Text style={styles.cardTitle}>Add category</Text>
      <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={newCategoryName} onChangeText={setNewCategoryName} placeholder="Category name" />
        <Pressable style={styles.secondarySmall} onPress={() => void submitAddCategory()}><Text style={styles.secondaryButtonText}>Add</Text></Pressable>
      </View>
    </Card>

    <Card>
      <Text style={styles.cardTitle}>Transactions</Text>
      {orderedTransactions.length ? visibleTransactions.map(({ item, index }) => <View key={`${index}-${item.date}-${item.payee}`} style={styles.row}>
        <Pressable style={styles.rowCopy} onPress={() => beginTxEdit(index)}>
          <Text style={styles.rowTitle}>{item.payee}</Text>
          <Text style={styles.rowDetail}>{[item.date, transactionAssignmentLabel(state, item), accountName(item.accountId)].filter(Boolean).join(" · ")}</Text>
        </Pressable>
        <Text style={styles.rowValue}>{money(Number(item.amount), currency)}</Text>
        <Pressable onPress={() => openSplit(index)} accessibilityLabel={`Split ${item.payee} across categories`}><Ionicons name="cut-outline" size={18} color={item.splits?.length ? colors.green : colors.muted} /></Pressable>
        <Pressable onPress={() => deleteTransaction(index)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>) : <Text style={styles.muted}>No transactions yet</Text>}
      {orderedTransactions.length > 15 ? <Pressable style={styles.secondarySmall} onPress={() => setShowAllTx((prev) => !prev)}><Text style={styles.secondaryButtonText}>{showAllTx ? "Show fewer" : `Show all (${orderedTransactions.length})`}</Text></Pressable> : null}
    </Card>
  </Page>;
}

const reminderRecurrenceLabels: Record<ReminderRecurrence, string> = { once: "Once", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

function Calendar({ state, access, user, onSave }: { state: HouseholdState; access: HouseholdAccess | null; user: User; onSave: (next: HouseholdState) => Promise<void> }) {
  const members = access?.members.filter((member) => member.status === "active") || [];
  const [editing, setEditing] = useState<{ kind: "event" | "chore"; index: number } | null>(null);
  const [addKind, setAddKind] = useState<"event" | "chore">("event");
  const [title, setTitle] = useState(""); const [date, setDate] = useState(`${state.budget.month}-01`); const [owner, setOwner] = useState(members[0]?.email || "");
  const [recurrence, setRecurrence] = useState<ReminderRecurrence>("once");
  const [time, setTime] = useState("09:00");
  const [choreRecurrence, setChoreRecurrence] = useState<ChoreRecurrence>("once");
  const kind = editing?.kind || addKind;
  const begin = (targetKind: "event" | "chore", index: number) => {
    const item = targetKind === "event" ? state.calendar.events[index] : state.calendar.chores[index];
    if (!item) return;
    setEditing({ kind: targetKind, index }); setTitle(item.title); setDate(targetKind === "event" ? (item as typeof state.calendar.events[number]).date : (item as typeof state.calendar.chores[number]).startDate || (item as typeof state.calendar.chores[number]).nextDue); setOwner(targetKind === "event" ? (item as typeof state.calendar.events[number]).owner || members[0]?.email || "" : (item as typeof state.calendar.chores[number]).assignee || members[0]?.email || "");
    setRecurrence(targetKind === "event" ? (item as typeof state.calendar.events[number]).recurrence || "once" : "once");
    setTime(targetKind === "event" ? ((item as typeof state.calendar.events[number]).dateTime || "").slice(11, 16) || "09:00" : "09:00");
    setChoreRecurrence(targetKind === "chore" ? (item as typeof state.calendar.chores[number]).recurrence || "once" : "once");
  };
  // "From photo": the picture is sent inline to the server's vision model (never stored) and comes back
  // as a DRAFT the user reviews and edits before anything is added - same as web's dialog.
  const [photoDraft, setPhotoDraft] = useState<(ReminderPhotoDraft & { previewUri: string }) | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const pickPhotoReminder = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Photo access needed", "Allow photo library access to read a reminder from a photo.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.6 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.base64) return;
    setReadingPhoto(true);
    try {
      const draft = normalizeReminderPhotoDraft(await api.reminderFromImage(asset.base64, imageContentType(asset.mimeType)));
      setPhotoDraft({ ...draft, time: draft.time || "09:00", previewUri: asset.uri });
    } catch (cause) {
      Alert.alert("Couldn't read that photo", cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setReadingPhoto(false);
    }
  };
  const submitPhotoDraft = async () => {
    if (!photoDraft) return;
    const event = buildPhotoReminderEvent(photoDraft, { email: user.email, name: user.name }, () => `event-${Date.now()}`);
    if (!event) return Alert.alert("Missing info", "Enter a title and a date (YYYY-MM-DD).");
    const next = structuredClone(state);
    next.calendar.events.push(event);
    await onSave(next);
    setPhotoDraft(null);
  };
  // Export / import (.ics and .csv, same formats as web, so a file from either app imports into the other).
  // iOS shares a real file from the cache directory; Android's share sheet only takes text, so it gets the
  // file contents as text instead.
  const [importDrafts, setImportDrafts] = useState<CalendarImportDraft[] | null>(null);
  const [importSelected, setImportSelected] = useState<boolean[]>([]);
  const [importNote, setImportNote] = useState("");
  const exportCalendar = async (format: "ics" | "csv") => {
    if (!state.calendar.events.length && !state.calendar.chores.length) return Alert.alert("Nothing to export", "Add a reminder or chore first.");
    const text = format === "ics" ? buildCalendarIcs(state.calendar.events, state.calendar.chores) : buildCalendarCsv(state.calendar.events, state.calendar.chores);
    const name = `familyloop-calendar.${format}`;
    try {
      if (Platform.OS === "ios" && FileSystem.cacheDirectory) {
        const uri = `${FileSystem.cacheDirectory}${name}`;
        await FileSystem.writeAsStringAsync(uri, text);
        await Share.share({ url: uri, title: name });
      } else {
        await Share.share({ title: name, message: text });
      }
    } catch (cause) {
      Alert.alert("Couldn't export the calendar", cause instanceof Error ? cause.message : "Unknown error");
    }
  };
  const pickImportFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    const asset = picked.canceled ? null : picked.assets?.[0];
    if (!asset) return;
    if (asset.size && asset.size > 2_000_000) return Alert.alert("File too large", "Calendar files over 2MB can't be imported.");
    try {
      const text = await FileSystem.readAsStringAsync(asset.uri);
      const isIcs = asset.name.toLowerCase().endsWith(".ics") || /^\s*BEGIN:VCALENDAR/i.test(text);
      const { drafts, skipped } = sanitizeCalendarDrafts(isIcs ? icsEventsToCalendarDrafts(parseIcsText(text)) : parseCalendarCsv(text));
      if (!drafts.length) return Alert.alert("Nothing to import", `No calendar items found in ${asset.name}.${skipped ? ` ${skipped} row${skipped === 1 ? " was" : "s were"} skipped for a missing title or invalid date.` : ""}`);
      const capped = drafts.slice(0, 500);
      setImportDrafts(capped);
      setImportSelected(capped.map(() => true));
      setImportNote([skipped ? `${skipped} row${skipped === 1 ? "" : "s"} skipped (missing title or invalid date)` : "", drafts.length > capped.length ? `only the first ${capped.length} are shown` : ""].filter(Boolean).join(" · "));
    } catch (cause) {
      Alert.alert("Couldn't read that file", cause instanceof Error ? cause.message : "Unknown error");
    }
  };
  const submitImport = async () => {
    if (!importDrafts) return;
    const chosen = importDrafts.filter((_, index) => importSelected[index]);
    if (!chosen.length) return;
    const memberList = members.map((member) => ({ name: member.name, email: member.email }));
    const next = structuredClone(state);
    let imported = 0;
    chosen.forEach((draft) => {
      const assignees = resolveImportAssignees(draft.assigneeKeys, memberList, { email: user.email, name: user.name });
      const result = calendarDraftToItem(draft, assignees, () => uniqueId(draft.kind));
      if (!result) return;
      if (result.kind === "chore") next.calendar.chores.push(result.item); else next.calendar.events.push(result.item);
      imported += 1;
    });
    await onSave(next);
    setImportDrafts(null);
    Alert.alert("Import complete", `Imported ${imported} calendar item${imported === 1 ? "" : "s"}.`);
  };
  const resetForm = () => { setEditing(null); setTitle(""); setDate(`${state.budget.month}-01`); setRecurrence("once"); setTime("09:00"); setChoreRecurrence("once"); };
  const saveItem = async () => {
    if (!title.trim() || !date) return;
    const member = members.find((item) => item.email === owner);
    const ownerName = member?.name || owner;
    const ownerAssignee = owner ? [{ key: owner, name: ownerName, email: owner }] : [];
    const next = structuredClone(state);
    if (editing?.kind === "chore") {
      next.calendar.chores = next.calendar.chores.map((item, index) => index === editing.index ? {
        ...item, title: title.trim(), startDate: date, nextDue: date, assignee: owner, assigneeName: ownerName,
        // keep a multi-assignee list set on web unless the single owner picked here actually changed
        assignees: item.assignee === owner && item.assignees?.length ? item.assignees : ownerAssignee,
        recurrence: choreRecurrence, cadence: choreCadenceLabels[choreRecurrence]
      } : item);
    } else if (editing?.kind === "event") {
      const existing = state.calendar.events[editing.index];
      let timing: Partial<ReturnType<typeof reminderTiming> & object> = {};
      if (existing?.type === "reminder") {
        if (time.trim() && !isValidClockTime(time)) return Alert.alert("Invalid time", "Use 24-hour HH:MM, for example 14:30.");
        // Rescheduling moves the notification with it. If neither the date nor the time changed, leave
        // reminderAt/notifyAt alone - web lets those be set independently of the event's own time.
        const unchanged = Boolean(existing.notifyAt) && existing.date === date && ((existing.dateTime || "").slice(11, 16) || "09:00") === (time.trim() || "09:00");
        if (!unchanged) {
          const fresh = reminderTiming(date, time);
          if (!fresh) return Alert.alert("Invalid date", "Use the format YYYY-MM-DD.");
          timing = fresh;
        }
      }
      next.calendar.events = next.calendar.events.map((item, index) => index === editing.index ? {
        ...item, title: title.trim(), date, owner, ownerName,
        assignees: item.owner === owner && item.assignees?.length ? item.assignees : ownerAssignee,
        ...(item.type === "reminder" ? { recurrence, ...timing } : {})
      } : item);
    } else if (kind === "chore") {
      next.calendar.chores.push({ id: `chore-${Date.now()}`, title: title.trim(), assignee: owner, assigneeName: ownerName, assignees: ownerAssignee, cadence: choreCadenceLabels[choreRecurrence], nextDue: date, startDate: date, recurrence: choreRecurrence, completedBy: {} });
    } else {
      if (time.trim() && !isValidClockTime(time)) return Alert.alert("Invalid time", "Use 24-hour HH:MM, for example 14:30.");
      const timing = reminderTiming(date, time);
      if (!timing) return Alert.alert("Invalid date", "Use the format YYYY-MM-DD.");
      next.calendar.events.push({ id: `event-${Date.now()}`, title: title.trim(), date, ...timing, type: "reminder", annual: false, owner, ownerName, assignees: ownerAssignee, recurrence, completedBy: [] });
    }
    await onSave(next); resetForm();
  };
  const deleteEvent = (index: number) => {
    const item = state.calendar.events[index];
    if (!item) return;
    Alert.alert("Delete event?", item.title, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => {
      const next = structuredClone(state);
      next.calendar.events = next.calendar.events.filter((_, itemIndex) => itemIndex !== index);
      void onSave(next);
    } }]);
  };
  const deleteChore = (index: number) => {
    const item = state.calendar.chores[index];
    if (!item) return;
    Alert.alert("Delete chore?", item.title, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => {
      const next = structuredClone(state);
      next.calendar.chores = next.calendar.chores.filter((_, itemIndex) => itemIndex !== index);
      void onSave(next);
    } }]);
  };
  const toggleReminderDone = async (index: number) => {
    const event = state.calendar.events[index];
    if (!event) return;
    const assignees = effectiveAssignees(event);
    const key = completionKeyFor(assignees, user.email);
    if (!key) return;
    const already = (event.completedBy || []).includes(key);
    let target: CalendarEvent = { ...event, completedBy: already ? (event.completedBy || []).filter((item) => item !== key) : [...(event.completedBy || []), key] };
    // Only a genuinely completing action (not un-checking) rolls a recurring reminder forward -
    // otherwise "Mark done" then "Undo" would leave it silently jumped to the wrong next date.
    if (!already && isReminderComplete(target.completedBy, assignees.map((assignee) => assignee.key))) target = advanceRecurringReminder(target);
    const next = structuredClone(state);
    next.calendar.events = next.calendar.events.map((item, itemIndex) => itemIndex === index ? target : item);
    await onSave(next);
  };
  // Completion is recorded per occurrence DATE (web's shape) against the occurrence the chore is on right
  // now; the recurrence anchor (startDate) is never moved by completing something.
  const toggleChoreDone = async (index: number) => {
    const chore = state.calendar.chores[index];
    const occurrence = chore ? currentChoreOccurrenceDate(chore) : null;
    if (!chore || !occurrence) return;
    const key = completionKeyFor(effectiveAssignees(chore), user.email);
    if (!key) return;
    const next = structuredClone(state);
    next.calendar.chores = next.calendar.chores.map((item, itemIndex) => itemIndex === index ? toggleChoreCompletion(item, occurrence, key) : item);
    await onSave(next);
  };
  return <Page><Title eyebrow="CALENDAR">Shared schedule</Title>
    {photoDraft ? <Card>
      <Text style={styles.cardTitle}>Reminder from photo</Text>
      <Image source={{ uri: photoDraft.previewUri }} style={styles.reminderPhotoPreview} resizeMode="contain" />
      <Text style={styles.muted}>Review what was read from the photo, then add it as a reminder.</Text>
      {photoDraft.title || photoDraft.date ? null : <Text style={styles.formError}>Couldn't read a title or date from this photo - fill them in below.</Text>}
      <TextInput style={styles.input} value={photoDraft.title} onChangeText={(value) => setPhotoDraft((prev) => prev ? { ...prev, title: value } : prev)} placeholder="Title" />
      <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={photoDraft.date} onChangeText={(value) => setPhotoDraft((prev) => prev ? { ...prev, date: value } : prev)} placeholder="YYYY-MM-DD" />
        <TextInput style={[styles.input, { flex: 1 }]} value={photoDraft.time} onChangeText={(value) => setPhotoDraft((prev) => prev ? { ...prev, time: value } : prev)} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} />
      </View>
      <TextInput style={styles.input} value={photoDraft.location} onChangeText={(value) => setPhotoDraft((prev) => prev ? { ...prev, location: value } : prev)} placeholder="Location (optional)" />
      <View style={styles.actionRow}>
        <Pressable style={styles.primaryButton} onPress={() => void submitPhotoDraft()}><Text style={styles.primaryButtonText}>Add reminder</Text></Pressable>
        <Pressable style={styles.secondarySmall} onPress={() => setPhotoDraft(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
      </View>
    </Card> : null}
    <Card><Text style={styles.cardTitle}>{editing ? "Edit calendar item" : "Add to calendar"}</Text>
    {!editing && !photoDraft ? <Pressable style={styles.secondarySmall} disabled={readingPhoto} onPress={() => void pickPhotoReminder()}>{readingPhoto ? <ActivityIndicator size="small" color={colors.green} /> : <Text style={styles.secondaryButtonText}>📷 Add reminder from a photo</Text>}</Pressable> : null}
    {!editing && <View style={styles.choiceRow}>
      <Pressable style={[styles.choice, addKind === "event" && styles.choiceActive]} onPress={() => setAddKind("event")}><Text style={[styles.choiceText, addKind === "event" && styles.choiceTextActive]}>Reminder</Text></Pressable>
      <Pressable style={[styles.choice, addKind === "chore" && styles.choiceActive]} onPress={() => setAddKind("chore")}><Text style={[styles.choiceText, addKind === "chore" && styles.choiceTextActive]}>Chore</Text></Pressable>
    </View>}
    <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title" /><TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
    {kind === "event" && (editing === null || state.calendar.events[editing.index]?.type === "reminder") ? <TextInput style={styles.input} value={time} onChangeText={setTime} placeholder="Time (HH:MM, 24-hour) - when you'll be reminded" keyboardType="numbers-and-punctuation" maxLength={5} /> : null}
    <Text style={styles.label}>Assign to</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{members.map((member) => <Pressable key={member.email} style={[styles.choice, owner === member.email && styles.choiceActive]} onPress={() => setOwner(member.email)}><Text style={[styles.choiceText, owner === member.email && styles.choiceTextActive]}>{member.name}</Text></Pressable>)}</ScrollView>
    {kind === "event" && <>
      <Text style={styles.label}>Repeat</Text>
      <View style={styles.choiceRow}>{(["once", "weekly", "monthly", "yearly"] as ReminderRecurrence[]).map((item) => <Pressable key={item} style={[styles.choice, recurrence === item && styles.choiceActive]} onPress={() => setRecurrence(item)}><Text style={[styles.choiceText, recurrence === item && styles.choiceTextActive]}>{reminderRecurrenceLabels[item]}</Text></Pressable>)}</View>
    </>}
    {kind === "chore" && <>
      <Text style={styles.label}>Repeat</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{(Object.keys(choreCadenceLabels) as ChoreRecurrence[]).map((item) => <Pressable key={item} style={[styles.choice, choreRecurrence === item && styles.choiceActive]} onPress={() => setChoreRecurrence(item)}><Text style={[styles.choiceText, choreRecurrence === item && styles.choiceTextActive]}>{choreCadenceLabels[item]}</Text></Pressable>)}</ScrollView>
    </>}
    <View style={styles.actionRow}>
      <Pressable style={styles.primaryButton} onPress={() => void saveItem()}><Text style={styles.primaryButtonText}>{editing ? "Save changes" : kind === "chore" ? "Add chore" : "Add reminder"}</Text></Pressable>
      {editing && <Pressable style={styles.secondarySmall} onPress={resetForm}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>}
    </View>
  </Card><Card><Text style={styles.cardTitle}>Events and reminders</Text>{state.calendar.events.map((item, index) => {
    const assignees = effectiveAssignees(item);
    const key = completionKeyFor(assignees, user.email);
    const completed = item.completedBy || [];
    const done = key ? completed.includes(key) : false;
    const recurrenceLabel = item.recurrence && item.recurrence !== "once" ? reminderRecurrenceLabels[item.recurrence] : null;
    const timeLabel = item.type === "reminder" && item.dateTime ? item.dateTime.slice(11, 16) : null;
    return <View key={item.id || `${item.date}-${item.title}`} style={styles.row}>
      <Pressable style={styles.rowCopy} onPress={() => begin("event", index)}><Row title={item.title} detail={[item.date, timeLabel, item.ownerName || item.owner || "Unassigned", recurrenceLabel].filter(Boolean).join(" · ")} badge={item.type} /></Pressable>
      {item.type === "reminder" ? (key
        ? <Pressable style={styles.planStepperButton} onPress={() => void toggleReminderDone(index)}><Text style={styles.secondaryButtonText}>{done ? "✓ Done" : "Mark done"}</Text></Pressable>
        : <Text style={styles.rowDetail}>{completed.length}/{assignees.length} done</Text>) : null}
      <Pressable onPress={() => deleteEvent(index)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
    </View>;
  })}</Card><Card><Text style={styles.cardTitle}>Chore rotation</Text>{state.calendar.chores.map((item, index) => {
    const occurrence = currentChoreOccurrenceDate(item);
    const assignees = effectiveAssignees(item);
    const key = completionKeyFor(assignees, user.email);
    const done = occurrence ? isChoreOccurrenceComplete(item, occurrence) : false;
    const mine = key && occurrence ? choreCompletedKeys(item, occurrence).includes(key) : false;
    return <View key={item.id || item.title} style={styles.row}>
      <Pressable style={styles.rowCopy} onPress={() => begin("chore", index)}><Row title={item.title} detail={`${item.assigneeName || item.assignee} · ${item.cadence}`} badge={occurrence || item.nextDue} /></Pressable>
      {occurrence ? (key
        ? <Pressable style={styles.planStepperButton} onPress={() => void toggleChoreDone(index)}><Text style={styles.secondaryButtonText}>{mine ? "✓ Done" : "Mark done"}</Text></Pressable>
        : <Text style={styles.rowDetail}>{choreCompletedKeys(item, occurrence).length}/{assignees.length} done</Text>) : null}
      <Pressable onPress={() => deleteChore(index)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
    </View>;
  })}</Card>
    {importDrafts ? <Card>
      <Text style={styles.cardTitle}>Import preview</Text>
      {importNote ? <Text style={styles.muted}>{importNote}</Text> : null}
      <Pressable style={styles.checkRow} onPress={() => setImportSelected(importSelected.every(Boolean) ? importSelected.map(() => false) : importSelected.map(() => true))}>
        <Ionicons name={importSelected.every(Boolean) ? "checkbox" : "square-outline"} size={24} color={importSelected.every(Boolean) ? colors.green : colors.muted} />
        <Text style={styles.checkText}>Select all ({importDrafts.length})</Text>
      </Pressable>
      {importDrafts.map((draft, index) => <Pressable key={`${index}-${draft.title}`} style={styles.checkRow} onPress={() => setImportSelected((prev) => prev.map((value, itemIndex) => itemIndex === index ? !value : value))}>
        <Ionicons name={importSelected[index] ? "checkbox" : "square-outline"} size={24} color={importSelected[index] ? colors.green : colors.muted} />
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{draft.title}</Text>
          <Text style={styles.rowDetail}>{[draft.date, draft.time, draft.kind === "chore" ? "Chore" : draft.type === "reminder" ? "Reminder" : draft.type, draft.recurrence !== "once" ? `repeats ${draft.recurrence}` : null].filter(Boolean).join(" · ")}</Text>
        </View>
      </Pressable>)}
      <View style={styles.actionRow}>
        <Pressable style={styles.primaryButton} disabled={!importSelected.some(Boolean)} onPress={() => void submitImport()}><Text style={styles.primaryButtonText}>Import {importSelected.filter(Boolean).length} item{importSelected.filter(Boolean).length === 1 ? "" : "s"}</Text></Pressable>
        <Pressable style={styles.secondarySmall} onPress={() => setImportDrafts(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
      </View>
    </Card> : null}
    <Card>
      <Text style={styles.cardTitle}>Export &amp; import</Text>
      <Text style={styles.muted}>Share your calendar as an .ics (works with Apple, Google and Outlook calendars) or .csv file, or import one - including files exported from the web app.</Text>
      <View style={styles.actionRow}>
        <Pressable style={styles.secondarySmall} onPress={() => void exportCalendar("ics")}><Text style={styles.secondaryButtonText}>Export .ics</Text></Pressable>
        <Pressable style={styles.secondarySmall} onPress={() => void exportCalendar("csv")}><Text style={styles.secondaryButtonText}>Export .csv</Text></Pressable>
      </View>
      <Pressable style={styles.secondarySmall} onPress={() => void pickImportFile()}><Text style={styles.secondaryButtonText}>Import from a file</Text></Pressable>
    </Card></Page>;
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

const noteColorOptions = [
  { value: "#ffffff", label: "White" },
  { value: "#fff7d6", label: "Yellow" },
  { value: "#eef7ff", label: "Blue" },
  { value: "#eaf8ef", label: "Green" },
  { value: "#fff0ee", label: "Coral" }
];

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function Notes({ state, onSave }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void> }) {
  const [addTitle, setAddTitle] = useState(""); const [addBody, setAddBody] = useState(""); const [addColor, setAddColor] = useState("#ffffff");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState(""); const [editBody, setEditBody] = useState(""); const [editColor, setEditColor] = useState("#ffffff");
  const [checklistDrafts, setChecklistDrafts] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);

  // A note's photos are Documents rows linked to it via noteId (web does the same), so they come from
  // the Documents API; each ready image needs its own short-lived signed URL to display.
  const [documents, setDocuments] = useState<Document[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [uploadingNoteId, setUploadingNoteId] = useState<string | null>(null);
  const loadDocuments = useCallback(async () => {
    try { setDocuments((await api.documents()).documents); }
    catch { /* photos are optional - a failed load just means none show */ }
  }, []);
  useEffect(() => { void loadDocuments(); }, [loadDocuments]);
  useEffect(() => {
    documents.filter((item) => item.noteId && item.status === "ready" && item.contentType?.startsWith("image/") && !imageUrls[item.id]).forEach((item) => {
      api.documentDownloadUrl(item.id).then(({ url }) => setImageUrls((prev) => ({ ...prev, [item.id]: url }))).catch(() => undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents]);

  const addPhoto = async (note: Note) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Photo access needed", "Allow photo library access to attach photos to notes.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    setUploadingNoteId(note.id);
    try {
      const contentType = imageContentType(asset.mimeType);
      const { documentId, uploadUrl } = await api.requestDocumentUploadUrl({ name: photoFileName(asset.fileName, asset.mimeType), contentType, sizeBytes: asset.fileSize || 0, folderId: null, noteId: note.id });
      // In MEMORY_DB (test/preview) mode the server returns a placeholder URL instead of a signed one.
      if (/^https?:\/\//.test(uploadUrl)) await FileSystem.uploadAsync(uploadUrl, asset.uri, { httpMethod: "PUT", headers: { "Content-Type": contentType } });
      await api.confirmDocumentUpload(documentId);
      await loadDocuments();
    } catch (cause) {
      Alert.alert("Couldn't attach that photo", cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setUploadingNoteId(null);
    }
  };

  const removePhoto = (photo: Document) => {
    Alert.alert("Remove this photo from the note?", "This cannot be undone.", [{ text: "Cancel" }, { text: "Remove", style: "destructive", onPress: async () => {
      try { await api.deleteDocument(photo.id); await loadDocuments(); }
      catch (cause) { Alert.alert("Couldn't remove the photo", cause instanceof Error ? cause.message : "Unknown error"); }
    } }]);
  };

  const notes = sortNotes(state.notes.entries.filter((note) => !note.trashed && !note.archived));
  const archivedNotes = sortNotes(state.notes.entries.filter((note) => !note.trashed && note.archived));

  const saveNotes = (entries: Note[]) => onSave({ ...state, notes: { ...state.notes, entries } });

  const addNote = async () => {
    if (!addTitle.trim() && !addBody.trim()) return;
    const note: Note = { id: `note-${Date.now()}`, title: addTitle.trim(), body: addBody.trim(), checklist: [], pinned: false, archived: false, trashed: false, color: addColor, createdAt: new Date().toISOString() };
    await saveNotes([...state.notes.entries, note]);
    setAddTitle(""); setAddBody(""); setAddColor("#ffffff");
  };

  const startEdit = (note: Note) => { setEditingId(note.id); setEditTitle(note.title); setEditBody(note.body); setEditColor(note.color || "#ffffff"); };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async () => {
    const noteId = editingId;
    if (!noteId) return;
    await saveNotes(state.notes.entries.map((entry) => entry.id === noteId ? { ...entry, title: editTitle.trim(), body: editBody.trim(), color: editColor } : entry));
    setEditingId(null);
  };

  const togglePin = (note: Note) => void saveNotes(state.notes.entries.map((entry) => entry.id === note.id ? { ...entry, pinned: !entry.pinned } : entry));
  const toggleArchive = (note: Note) => void saveNotes(state.notes.entries.map((entry) => entry.id === note.id ? { ...entry, archived: !entry.archived } : entry));
  const deleteNote = (note: Note) => {
    Alert.alert("Delete note?", note.title || "Untitled note", [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => void saveNotes(state.notes.entries.map((entry) => entry.id === note.id ? { ...entry, trashed: true } : entry)) }]);
  };

  const toggle = (note: Note, itemId: string) => {
    const current = note.checklist.find((item) => item.id === itemId);
    if (!current) return;
    const nextChecklist = applyChecklistToggle(note.checklist, itemId, !current.done);
    void saveNotes(state.notes.entries.map((entry) => entry.id === note.id ? { ...entry, checklist: nextChecklist } : entry));
  };

  const addChecklistItem = (note: Note) => {
    const text = (checklistDrafts[note.id] || "").trim();
    if (!text) return;
    void saveNotes(state.notes.entries.map((entry) => entry.id === note.id ? { ...entry, checklist: [...entry.checklist, { id: `item-${Date.now()}`, text, done: false }] } : entry));
    setChecklistDrafts((prev) => ({ ...prev, [note.id]: "" }));
  };

  const renderColorChips = (selected: string, onSelect: (value: string) => void) => (
    <View style={styles.choiceRow}>{noteColorOptions.map((option) => <Pressable key={option.value} style={[styles.colorSwatch, { backgroundColor: option.value }, selected === option.value && styles.colorSwatchActive]} onPress={() => onSelect(option.value)} accessibilityLabel={option.label} />)}</View>
  );

  const renderNote = (note: Note) => {
    if (editingId === note.id) {
      return <View key={note.id} style={[styles.note, { backgroundColor: editColor || colors.surface }]}>
        <TextInput style={styles.input} value={editTitle} onChangeText={setEditTitle} placeholder="Title" />
        <TextInput style={[styles.input, styles.multilineInput]} value={editBody} onChangeText={setEditBody} placeholder="Note" multiline />
        {renderColorChips(editColor, setEditColor)}
        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={() => void saveEdit()}><Text style={styles.primaryButtonText}>Save</Text></Pressable>
          <Pressable style={styles.secondarySmall} onPress={cancelEdit}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
        </View>
      </View>;
    }
    return <View key={note.id} style={[styles.note, { backgroundColor: note.color || colors.surface }]}>
      <View style={styles.noteHeader}>
        <Pressable style={styles.rowCopy} onPress={() => startEdit(note)}><Text style={styles.noteTitle}>{note.title || "Untitled note"}</Text></Pressable>
        <Pressable disabled={uploadingNoteId === note.id} onPress={() => void addPhoto(note)} accessibilityLabel="Add a photo to this note">{uploadingNoteId === note.id ? <ActivityIndicator size="small" color={colors.green} /> : <Ionicons name="camera-outline" size={18} color={colors.muted} />}</Pressable>
        <Pressable onPress={() => togglePin(note)}><Ionicons name={note.pinned ? "pin" : "pin-outline"} size={18} color={note.pinned ? colors.gold : colors.muted} /></Pressable>
        <Pressable onPress={() => toggleArchive(note)}><Ionicons name={note.archived ? "arrow-undo-outline" : "archive-outline"} size={18} color={colors.muted} /></Pressable>
        <Pressable onPress={() => deleteNote(note)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>
      {note.body ? <Text style={styles.noteBody}>{note.body}</Text> : null}
      {noteLinkedImages(documents, note.id).length ? <ScrollView horizontal style={styles.journalPhotoRow}>{noteLinkedImages(documents, note.id).map((photo) => <Pressable key={photo.id} onPress={() => removePhoto(photo)} accessibilityLabel={`Remove photo ${photo.name}`}>
        {imageUrls[photo.id] ? <Image source={{ uri: imageUrls[photo.id] }} style={styles.journalPhoto} /> : <View style={[styles.journalPhoto, { backgroundColor: colors.panel }]} />}
      </Pressable>)}</ScrollView> : null}
      {note.checklist.map((item) => <Pressable key={item.id} style={[styles.checkRow, item.parentId && styles.checkRowChild]} onPress={() => toggle(note, item.id)}><Ionicons name={item.done ? "checkbox" : "square-outline"} size={24} color={item.done ? colors.green : colors.muted} /><Text style={[styles.checkText, item.done && styles.done]}>{item.text}</Text></Pressable>)}
      <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={checklistDrafts[note.id] || ""} onChangeText={(value) => setChecklistDrafts((prev) => ({ ...prev, [note.id]: value }))} placeholder="Add checklist item" onSubmitEditing={() => addChecklistItem(note)} />
        <Pressable style={styles.secondarySmall} onPress={() => addChecklistItem(note)}><Text style={styles.secondaryButtonText}>Add</Text></Pressable>
      </View>
    </View>;
  };

  return <Page><Title eyebrow="NOTES">Household notes</Title>
    <Card>
      <TextInput style={styles.input} value={addTitle} onChangeText={setAddTitle} placeholder="Title" />
      <TextInput style={[styles.input, styles.multilineInput]} value={addBody} onChangeText={setAddBody} placeholder="Note" multiline />
      {renderColorChips(addColor, setAddColor)}
      <Pressable style={styles.primaryButton} onPress={() => void addNote()}><Text style={styles.primaryButtonText}>Add note</Text></Pressable>
    </Card>
    {notes.map(renderNote)}
    {archivedNotes.length ? <>
      <Pressable style={styles.secondarySmall} onPress={() => setShowArchived((prev) => !prev)}><Text style={styles.secondaryButtonText}>{showArchived ? "Hide" : "Show"} archived ({archivedNotes.length})</Text></Pressable>
      {showArchived ? archivedNotes.map(renderNote) : null}
    </> : null}
  </Page>;
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

function DocumentRow({ document, notes, folders, wealthAssets, wealthLiabilities, viewerName, onDownload, onDelete, onLinkNote, onMove, onLinkWealth, onChangeExpiry }: {
  document: Document; notes: Note[]; folders: DocumentsData["folders"]; wealthAssets: WealthAsset[]; wealthLiabilities: WealthLiability[]; viewerName: string;
  onDownload: () => void; onDelete: () => void; onLinkNote: (noteId: string | null) => void; onMove: (folderId: string | null) => void;
  onLinkWealth: (wealthItemType: WealthItemType | null, wealthItemId: string | null) => void; onChangeExpiry: (expiryDate: string | null) => void
}) {
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [expiryDraft, setExpiryDraft] = useState(document.expiryDate || "");
  const linkedNote = document.noteId ? notes.find((note) => note.id === document.noteId) : null;
  const linkedWealthItem = document.wealthItemId
    ? (document.wealthItemType === "liability" ? wealthLiabilities : wealthAssets).find((item) => item.id === document.wealthItemId)
    : null;
  const expiryBadge = documentExpiryBadge(document.expiryDate);
  const expiryToneColor = expiryBadge?.tone === "danger" ? colors.coral : expiryBadge?.tone === "warning" ? colors.gold : colors.muted;

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
        <Text style={styles.rowDetail}>{documentOpenedLabel(document.lastOpenedAt, document.lastOpenedByName, viewerName)}</Text>
        {linkedNote ? <Text style={styles.rowDetail}>Linked to “{linkedNote.title || "Untitled note"}”</Text> : null}
        {linkedWealthItem ? <Text style={styles.rowDetail}>Tagged to {document.wealthItemType === "liability" ? "Liability" : "Asset"}: {linkedWealthItem.name}</Text> : null}
        {expiryBadge ? <Text style={[styles.rowDetail, { color: expiryToneColor }]}>{expiryBadge.label}</Text> : null}
        <View style={styles.actionRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]} value={expiryDraft} onChangeText={setExpiryDraft}
            placeholder="Expiry date (YYYY-MM-DD)"
            onEndEditing={() => onChangeExpiry(expiryDraft.trim() || null)}
          />
        </View>
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

function DocumentsScreen({ notes, wealthAssets, wealthLiabilities, viewerName }: { notes: Note[]; wealthAssets: WealthAsset[]; wealthLiabilities: WealthLiability[]; viewerName: string }) {
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
      // Separate from the download-url fetch above on purpose - only this explicit
      // open/download click counts as "opened" (matches web's /api/documents/:id/open).
      await api.openDocument(documentId);
      await load();
    } catch (cause) { showError("Could not open document", cause); }
  };

  const changeExpiry = async (documentId: string, expiryDate: string | null) => {
    try { await api.updateDocument(documentId, { expiryDate }); await load(); }
    catch (cause) { showError("Could not update expiry date", cause); }
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
          wealthAssets={wealthAssets} wealthLiabilities={wealthLiabilities} viewerName={viewerName}
          onDownload={() => void downloadDocument(document.id)}
          onDelete={() => deleteDocument(document.id)}
          onLinkNote={(noteId) => void linkNote(document.id, noteId)}
          onMove={(folderId) => void moveDocument(document.id, folderId)}
          onLinkWealth={(wealthItemType, wealthItemId) => void linkWealthItem(document.id, wealthItemType, wealthItemId)}
          onChangeExpiry={(expiryDate) => void changeExpiry(document.id, expiryDate)}
        />)
      : <Text style={styles.muted}>No documents in this folder yet.</Text>}</Card>
  </Page>;
}

function Decisions({ state, user, onSave, onBack }: { state: HouseholdState; user: User; onSave: (next: HouseholdState) => Promise<void>; onBack: () => void }) {
  const decisions = state.decisions || [];
  const [newTitle, setNewTitle] = useState(""); const [newNotes, setNewNotes] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({});
  const [outcomeDrafts, setOutcomeDrafts] = useState<Record<string, string>>({});
  const author = { key: user.email, name: user.name };

  const saveDecisions = (next: Decision[]) => onSave({ ...state, decisions: next });
  const change = (decisionId: string, update: (decision: Decision) => Decision) => void saveDecisions(updateDecision(decisions, decisionId, update));

  const submitNew = async () => {
    const created = createDecision(newTitle, newNotes, () => uniqueId("decision"));
    if (!created) return Alert.alert("Missing info", "Enter the question you're deciding.");
    await saveDecisions([...decisions, created]);
    setNewTitle(""); setNewNotes(""); setExpandedId(created.id);
  };

  const confirmDelete = (decision: Decision) => {
    Alert.alert("Delete decision?", decision.title, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => void saveDecisions(decisions.filter((item) => item.id !== decision.id)) }]);
  };

  const addItem = (decision: Decision, listKey: DecisionListKey) => {
    const draftKey = `${decision.id}:${listKey}`;
    const text = (itemDrafts[draftKey] || "").trim();
    if (!text) return;
    change(decision.id, (current) => addDecisionItem(current, listKey, text, author, () => uniqueId("item")));
    setItemDrafts((prev) => ({ ...prev, [draftKey]: "" }));
  };

  const decide = (decision: Decision) => {
    change(decision.id, (current) => markDecided(current, outcomeDrafts[decision.id] || ""));
    setOutcomeDrafts((prev) => ({ ...prev, [decision.id]: "" }));
  };

  const renderList = (decision: Decision, listKey: DecisionListKey) => {
    const items = decision[listKey];
    const kind = listKey === "pros" ? "pro" : "con";
    return <View style={styles.decisionColumn}>
      <Text style={[styles.label, { color: listKey === "pros" ? colors.green : colors.coral }]}>{listKey === "pros" ? "Pros" : "Cons"}</Text>
      {items.length ? items.map((item, index) => <View key={item.id} style={styles.checkRow}>
        <View style={styles.rowCopy}>
          <TextInput key={item.text} style={styles.input} defaultValue={item.text} onEndEditing={(event) => change(decision.id, (current) => editDecisionItem(current, listKey, item.id, event.nativeEvent.text))} accessibilityLabel={`Edit this ${kind}`} />
          <Text style={styles.rowDetail}>{item.authorName}</Text>
        </View>
        <Pressable disabled={index === 0} onPress={() => change(decision.id, (current) => moveDecisionItem(current, listKey, item.id, "up"))}><Ionicons name="arrow-up" size={18} color={index === 0 ? colors.border : colors.text} /></Pressable>
        <Pressable disabled={index === items.length - 1} onPress={() => change(decision.id, (current) => moveDecisionItem(current, listKey, item.id, "down"))}><Ionicons name="arrow-down" size={18} color={index === items.length - 1 ? colors.border : colors.text} /></Pressable>
        <Pressable onPress={() => change(decision.id, (current) => removeDecisionItem(current, listKey, item.id))}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
      </View>) : <Text style={styles.muted}>None yet</Text>}
      <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={itemDrafts[`${decision.id}:${listKey}`] || ""} onChangeText={(value) => setItemDrafts((prev) => ({ ...prev, [`${decision.id}:${listKey}`]: value }))} placeholder={`Add a ${kind}`} onSubmitEditing={() => addItem(decision, listKey)} />
        <Pressable style={styles.secondarySmall} onPress={() => addItem(decision, listKey)}><Text style={styles.secondaryButtonText}>Add</Text></Pressable>
      </View>
    </View>;
  };

  return <Page>
    <SubScreenHeader title="Decisions" eyebrow="FAMILY" onBack={onBack} />
    <Text style={styles.muted}>Weigh a family decision together — add pros and cons, then mark it decided once you've chosen. Shared across all your households.</Text>
    <Card>
      <Text style={styles.cardTitle}>New decision</Text>
      <TextInput style={styles.input} value={newTitle} onChangeText={setNewTitle} placeholder="Should we move to a bigger apartment?" />
      <TextInput style={[styles.input, styles.multilineInput]} value={newNotes} onChangeText={setNewNotes} placeholder="Notes (optional)" multiline />
      <Pressable style={styles.primaryButton} onPress={() => void submitNew()}><Text style={styles.primaryButtonText}>Add decision</Text></Pressable>
    </Card>
    {sortDecisions(decisions).map((decision) => {
      const isDecided = decision.status === "decided";
      const isExpanded = expandedId === decision.id;
      return <Card key={decision.id}>
        <View style={styles.iouPersonHead}>
          <Pressable style={styles.rowCopy} onPress={() => setExpandedId(isExpanded ? null : decision.id)}>
            <Text style={styles.cardTitle}>{decision.title}</Text>
            <Text style={styles.rowDetail}>{isDecided ? "Decided" : "Open"} · {decision.pros.length} pro{decision.pros.length === 1 ? "" : "s"} · {decision.cons.length} con{decision.cons.length === 1 ? "" : "s"}{decision.notes ? " · has notes" : ""}</Text>
          </Pressable>
          <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />
          <Pressable onPress={() => confirmDelete(decision)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
        </View>
        {isDecided ? <View style={{ marginTop: 8 }}>
          <Text style={styles.rowTitle}>Outcome: {decision.outcome || "No outcome noted"}{decision.decidedAt ? ` · ${decision.decidedAt.slice(0, 10)}` : ""}</Text>
          <Pressable style={[styles.secondarySmall, { marginTop: 8 }]} onPress={() => change(decision.id, reopenDecision)}><Text style={styles.secondaryButtonText}>Reopen</Text></Pressable>
        </View> : null}
        {isExpanded ? <View style={{ marginTop: 8 }}>
          <TextInput key={decision.notes} style={[styles.input, styles.multilineInput]} defaultValue={decision.notes} placeholder="Any context worth remembering (optional)" multiline onEndEditing={(event) => change(decision.id, (current) => ({ ...current, notes: event.nativeEvent.text.trim() }))} />
          {renderList(decision, "pros")}
          {renderList(decision, "cons")}
          {!isDecided ? <View style={styles.actionRow}>
            <TextInput style={[styles.input, { flex: 1 }]} value={outcomeDrafts[decision.id] || ""} onChangeText={(value) => setOutcomeDrafts((prev) => ({ ...prev, [decision.id]: value }))} placeholder="What did you decide? (optional)" />
            <Pressable style={styles.secondarySmall} onPress={() => decide(decision)}><Text style={styles.secondaryButtonText}>Mark decided</Text></Pressable>
          </View> : null}
        </View> : null}
      </Card>;
    })}
    {decisions.length ? null : <Text style={styles.muted}>No decisions yet — add one above to start weighing it together.</Text>}
  </Page>;
}

// The inbox of unreviewed bank/credit-card rows: import a statement (CSV or PDF), review each row (category, account,
// duplicate/refund/transfer hints), then accept it into the ledger, move it to Transfers, or dismiss it. Every change goes
// through the pure functions in src/bankStreamLogic.ts and is saved as a whole-state save. Not here yet (web-only): the
// split editor, tags on rows, bulk "set account for all"/"apply history" actions, sorting, and "split with a friend".
function BankStream({ state, onSave, onBack }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void>; onBack: () => void }) {
  const currency = state.household.currency;
  const accounts = state.accounts || [];
  const lines = allBudgetLines(state);
  const reviews = reviewDrafts(state).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const counts = pendingDraftCountsByAccount(reviews);
  const [feedback, setFeedback] = useState("");
  const [importing, setImporting] = useState(false);
  const [clearAccountId, setClearAccountId] = useState("");
  const [visibleCount, setVisibleCount] = useState(25);
  const [transferDraftId, setTransferDraftId] = useState<string | null>(null);
  const [transferAccountId, setTransferAccountId] = useState("");
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);

  const apply = async (result: { ok: true; state: HouseholdState } | { ok: false; error: string }) => {
    if (!result.ok) { Alert.alert("Can't do that", result.error); return false; }
    await onSave(result.state);
    return true;
  };

  const importFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    const asset = picked.canceled ? null : picked.assets?.[0];
    if (!asset) return;
    const isPdf = asset.mimeType === "application/pdf" || asset.name.toLowerCase().endsWith(".pdf");
    if (asset.size && asset.size > (isPdf ? 10_000_000 : 5_000_000)) return Alert.alert("File too large", isPdf ? "PDF statements over 10MB can't be read." : "CSV files over 5MB can't be imported.");
    setImporting(true);
    try {
      let rows: ParsedBankRow[];
      let accountHint = "";
      if (isPdf) {
        setFeedback(`Reading ${asset.name}…`);
        const parsed = await api.parseBankStatementPdf(await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }));
        rows = parsed.rows;
        accountHint = parsed.accountHint || "";
        if (!rows.length) { setFeedback(`No transactions found in ${asset.name} — this may be a scanned/image PDF that can't be read as text.`); return; }
      } else {
        rows = parseBankCsvTransactions(await FileSystem.readAsStringAsync(asset.uri));
        if (!rows.length) { setFeedback(`No transactions found in ${asset.name} — check that it has Date, Description, and Amount (or Debit) columns.`); return; }
      }
      const result = buildBankStreamDrafts({
        rows: rows.slice(0, 2000), fileName: asset.name, accountHint, idPrefix: isPdf ? "pdf-import" : "csv-import", transactions: state.transactions,
        existingDrafts: state.transactionInboxDrafts || [], accounts, rules: state.transactionCategorizationRules, createId: uniqueId
      });
      await onSave({ ...state, transactionInboxDrafts: result.drafts });
      setFeedback(rows.length > 2000 ? `${result.message} Only the first 2000 rows were imported.` : result.message);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : `Could not read ${asset.name}.`);
    } finally {
      setImporting(false);
    }
  };

  const confirmClear = () => {
    const account = accounts.find((item) => item.id === clearAccountId);
    const count = counts[clearAccountId] || 0;
    if (!account) return Alert.alert("Choose an account", "Pick the account whose unreviewed rows you want to clear.");
    if (!count) return Alert.alert("Nothing to clear", `${account.name} has no unreviewed rows.`);
    Alert.alert(`Remove ${count} unreviewed row${count === 1 ? "" : "s"}?`, `This deletes them from Bank stream for ${account.name} - it doesn't touch anything already accepted into the ledger, and no other account's rows are affected.`, [{ text: "Cancel" }, {
      text: "Remove", style: "destructive", onPress: () => { void onSave(clearDraftsForAccount(state, clearAccountId).state); setClearAccountId(""); }
    }]);
  };

  const suggestLine = async (draftId: string, payee: string) => {
    setAiBusyId(draftId);
    try {
      const { lineId } = await api.suggestTransactionSubcategory(payee, lines.map((line) => ({ id: line.id, label: `${line.category} - ${line.name}` })));
      if (!lineId) Alert.alert("No confident match", "The AI couldn't confidently pick a subcategory for this payee - choose one below.");
      else await apply(updateDraft(state, draftId, { lineId }));
    } catch (cause) { Alert.alert("Couldn't get a suggestion", cause instanceof Error ? cause.message : "Unknown error"); }
    finally { setAiBusyId(null); }
  };
  const suggestAccount = async (draftId: string, payee: string) => {
    setAiBusyId(draftId);
    try {
      const { accountId } = await api.suggestTransactionAccount(payee, accounts.filter((account) => !account.closedAt).map((account) => ({ id: account.id, label: `${account.name} (${account.type})` })));
      if (!accountId) Alert.alert("No confident match", "The AI couldn't confidently pick an account for this payee - choose one below.");
      else await apply(updateDraft(state, draftId, { accountId }));
    } catch (cause) { Alert.alert("Couldn't get a suggestion", cause instanceof Error ? cause.message : "Unknown error"); }
    finally { setAiBusyId(null); }
  };

  const openTransfer = (draft: DraftReview) => {
    if (!draft.accountId) return Alert.alert("Set an account first", `Set an account on "${draft.payee}" before moving it to Transfers - a transfer needs to know which account the money left or landed in.`);
    setTransferDraftId(draft.id || null);
    setTransferAccountId(draft.transferMatch?.accountId || "");
  };
  const confirmTransfer = async (draft: DraftReview) => {
    if (await apply(moveDraftToTransfer(state, draft.id || "", transferAccountId, draft.payee || "", () => uniqueId("transfer")))) setTransferDraftId(null);
  };

  const pills = (draft: DraftReview): Array<{ label: string; tone: "info" | "warn" | "plain" }> => {
    const result: Array<{ label: string; tone: "info" | "warn" | "plain" }> = [];
    if (draft.recurringId) result.push({ label: "Recurring", tone: "plain" });
    if (draft.isDeposit) result.push({ label: "Deposit", tone: "plain" });
    if (draft.isPayment) result.push({ label: "Card payment - probably a transfer", tone: "info" });
    if (draft.isPending) result.push({ label: "Pending - correct the date once it posts", tone: "warn" });
    if (draft.historyMatch) result.push({ label: "Category from history", tone: "info" });
    if (draft.categorizationRuleLineId) result.push({ label: "🔒 Rule", tone: "info" });
    if (draft.categorizationConfidence) result.push({ label: `${draft.categorizationConfidence.confidence}% match (${draft.categorizationConfidence.sampleSize} past)`, tone: draft.categorizationConfidence.confidence >= 80 ? "info" : "warn" });
    if (draft.accountHistoryMatch) result.push({ label: "Account from history", tone: "info" });
    if (draft.possibleDuplicate) result.push({ label: "Possible duplicate", tone: "warn" });
    if (draft.refundMatch) result.push({ label: `Refund match (${money(Number(draft.refundMatch.amount), currency)} on ${draft.refundMatch.date})`, tone: "info" });
    if (draft.transferMatch) result.push({ label: `Possible transfer (${accounts.find((account) => account.id === draft.transferMatch?.accountId)?.name || "other account"}, ${money(Math.abs(Number(draft.transferMatch.amount)), currency)})`, tone: "info" });
    return result;
  };

  return <Page>
    <SubScreenHeader title="Bank stream" eyebrow="MONEY" onBack={onBack} />
    <Text style={styles.muted}>Import a bank or credit-card statement (CSV or PDF), review each row, then accept it into your ledger.</Text>
    <Card>
      <Pressable style={styles.primaryButton} disabled={importing} onPress={() => void importFile()}>{importing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Import a statement</Text>}</Pressable>
      {feedback ? <Text style={styles.muted}>{feedback}</Text> : null}
    </Card>
    {Object.keys(counts).length && accounts.length ? <Card>
      <Text style={styles.cardTitle}>Clear an account's backlog</Text>
      <Text style={styles.muted}>Remove every unreviewed row for one account instead of reviewing each one.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{accounts.map((account) => <Pressable key={account.id} style={[styles.choice, clearAccountId === account.id && styles.choiceActive]} onPress={() => setClearAccountId(clearAccountId === account.id ? "" : account.id)}>
        <Text style={[styles.choiceText, clearAccountId === account.id && styles.choiceTextActive]}>{account.name}{counts[account.id] ? ` (${counts[account.id]})` : ""}</Text>
      </Pressable>)}</ScrollView>
      {clearAccountId ? <Pressable style={styles.secondarySmall} onPress={confirmClear}><Text style={[styles.secondaryButtonText, { color: colors.coral }]}>Clear</Text></Pressable> : null}
    </Card> : null}
    <Text style={styles.cardTitle}>{reviews.length ? `${reviews.length} waiting for review` : "Nothing waiting for review"}</Text>
    {reviews.slice(0, visibleCount).map((draft) => {
      const account = accounts.find((item) => item.id === draft.accountId);
      const id = draft.id || "";
      const isTransfer = transferDraftId === id;
      return <Card key={id}>
        {pills(draft).length ? <View style={styles.choiceRow}>{pills(draft).map((pill) => <Text key={pill.label} style={[styles.badge, pill.tone === "warn" && { color: colors.gold }, pill.tone === "info" && { color: colors.blue }]}>{pill.label}</Text>)}</View> : null}
        <TextInput key={`${id}-payee-${draft.payee}`} style={styles.input} defaultValue={draft.payee || ""} placeholder="Payee" onEndEditing={(event) => { const value = event.nativeEvent.text.trim(); if (value && value !== draft.payee) void apply(updateDraft(state, id, { payee: value })); }} />
        <View style={styles.actionRow}>
          <TextInput key={`${id}-date-${draft.date}`} style={[styles.input, { flex: 1 }]} defaultValue={draft.date || ""} placeholder="YYYY-MM-DD" onEndEditing={(event) => { const value = event.nativeEvent.text.trim(); if (value !== draft.date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) Alert.alert("Invalid date", "Use the format YYYY-MM-DD."); else void apply(updateDraft(state, id, { date: value })); } }} />
          <TextInput key={`${id}-amount-${draft.amount}-${draft.accountId}`} style={[styles.input, { flex: 1 }]} defaultValue={String(displayDraftAmount(Number(draft.amount), account))} keyboardType="numbers-and-punctuation" placeholder="Amount" onEndEditing={(event) => { const value = Number(event.nativeEvent.text.replace(/[,$]/g, "")); if (Number.isFinite(value) && value !== displayDraftAmount(Number(draft.amount), account)) void apply(updateDraft(state, id, { amount: storedDraftAmount(value, account) })); }} />
        </View>
        <Text style={styles.rowDetail}>{account && account.type !== "credit_card" ? "Amount as on your bank statement (deposit +, expense -)" : "Amount (purchase +, refund/payment -)"}</Text>
        <Text style={styles.label}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
          <Pressable style={[styles.choice, !draft.lineId && styles.choiceActive]} onPress={() => void apply(updateDraft(state, id, { lineId: "" }))}><Text style={[styles.choiceText, !draft.lineId && styles.choiceTextActive]}>Unassigned</Text></Pressable>
          {lines.map((line) => <Pressable key={line.id} style={[styles.choice, draft.lineId === line.id && styles.choiceActive]} onPress={() => void apply(updateDraft(state, id, { lineId: line.id }))}><Text style={[styles.choiceText, draft.lineId === line.id && styles.choiceTextActive]}>{line.category} · {line.name}</Text></Pressable>)}
        </ScrollView>
        <View style={styles.actionRow}>
          {!draft.lineId && lines.length ? <Pressable style={styles.secondarySmall} disabled={aiBusyId === id} onPress={() => void suggestLine(id, draft.payee || "")}>{aiBusyId === id ? <ActivityIndicator size="small" color={colors.green} /> : <Text style={styles.secondaryButtonText}>✨ Suggest category</Text>}</Pressable> : null}
          {draft.lineId ? <Pressable style={styles.secondarySmall} onPress={() => void onSave({ ...state, transactionCategorizationRules: setCategorizationRule(state.transactionCategorizationRules, draft.payee || "", draft.categorizationRuleLineId === draft.lineId ? "" : draft.lineId) })}><Text style={styles.secondaryButtonText}>{draft.categorizationRuleLineId === draft.lineId ? "🔒 Always this category - remove" : "🔒 Always categorize this payee this way"}</Text></Pressable> : null}
        </View>
        {accounts.length ? <>
          <Text style={styles.label}>Account</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
            <Pressable style={[styles.choice, !draft.accountId && styles.choiceActive]} onPress={() => void apply(updateDraft(state, id, { accountId: "" }))}><Text style={[styles.choiceText, !draft.accountId && styles.choiceTextActive]}>Not linked</Text></Pressable>
            {accounts.map((item) => <Pressable key={item.id} style={[styles.choice, draft.accountId === item.id && styles.choiceActive]} onPress={() => void apply(updateDraft(state, id, { accountId: item.id }))}><Text style={[styles.choiceText, draft.accountId === item.id && styles.choiceTextActive]}>{item.name}{item.closedAt ? " (closed)" : ""}</Text></Pressable>)}
          </ScrollView>
          {!draft.accountId ? <Pressable style={styles.secondarySmall} disabled={aiBusyId === id} onPress={() => void suggestAccount(id, draft.payee || "")}><Text style={styles.secondaryButtonText}>✨ Suggest account</Text></Pressable> : null}
        </> : null}
        {isTransfer ? <View style={styles.planTaskBlock}>
          <Text style={styles.label}>{Number(draft.amount) > 0 ? "Money went to" : "Money came from"}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{accounts.filter((item) => item.id !== draft.accountId).map((item) => <Pressable key={item.id} style={[styles.choice, transferAccountId === item.id && styles.choiceActive]} onPress={() => setTransferAccountId(item.id)}><Text style={[styles.choiceText, transferAccountId === item.id && styles.choiceTextActive]}>{item.name}</Text></Pressable>)}</ScrollView>
          <View style={styles.actionRow}>
            <Pressable style={styles.primaryButton} onPress={() => void confirmTransfer(draft)}><Text style={styles.primaryButtonText}>Move to Transfers</Text></Pressable>
            <Pressable style={styles.secondarySmall} onPress={() => setTransferDraftId(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
          </View>
        </View> : null}
        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={() => void apply(acceptDraft(state, id))}><Text style={styles.primaryButtonText}>✓ Accept</Text></Pressable>
          <Pressable style={styles.secondarySmall} onPress={() => openTransfer(draft)}><Text style={styles.secondaryButtonText}>⇄ Transfer</Text></Pressable>
          <Pressable style={styles.secondarySmall} onPress={() => void onSave(dismissDraft(state, id))}><Text style={[styles.secondaryButtonText, { color: colors.coral }]}>Dismiss</Text></Pressable>
        </View>
      </Card>;
    })}
    {reviews.length > visibleCount ? <Pressable style={styles.secondarySmall} onPress={() => setVisibleCount((count) => count + 25)}><Text style={styles.secondaryButtonText}>Show more ({reviews.length - visibleCount} left)</Text></Pressable> : null}
  </Page>;
}

function SubScreenHeader({ title, onBack, eyebrow = "MONEY" }: { title: string; onBack: () => void; eyebrow?: string }) {
  return <View style={styles.subScreenHeader}>
    <Pressable style={styles.subScreenBack} onPress={onBack}><Ionicons name="arrow-back" size={22} color={colors.text} /></Pressable>
    <Title eyebrow={eyebrow}>{title}</Title>
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
  const [flowSelectedKey, setFlowSelectedKey] = useState<string | null>(null);
  const [showAllFlowTransactions, setShowAllFlowTransactions] = useState(false);

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
  const cashFlow = cashFlowByMonth(state.transactions, monthKeys, (monthKey) => paycheckIncomeForMonth(state, monthKey));
  const maxCashFlow = Math.max(...cashFlow.map((month) => Math.max(month.income, month.expenses)), 1);
  const totalIncome = cashFlow.reduce((sum, month) => sum + month.income, 0);
  const totalExpenses = cashFlow.reduce((sum, month) => sum + month.expenses, 0);
  const flow = flowSegments(categories, totalIncome, totalExpenses, FLOW_PALETTE);
  const flowTotal = Math.max(totalIncome, totalExpenses, 1);
  const flowSelection = flowSelectedKey ? resolveFlowSelection(flow, flowSelectedKey) : null;
  const flowTransactions = flowSelection ? transactionsForLines(state.transactions, flowSelection.lineIds, monthKeys) : [];
  const flowPercent = (value: number) => `${Math.round((value / flowTotal) * 100)}%`;

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

    <Card>
      <Text style={styles.cardTitle}>Where your income went</Text>
      <Text style={styles.muted}>{money(totalIncome, currency)} income · {money(totalExpenses, currency)} spent this period</Text>
      {flow.length ? <>
        <View style={styles.flowBar}>{flow.map((segment) => <View key={segment.label} style={{ flex: segment.value, minWidth: 2, backgroundColor: segment.color }} />)}</View>
        {flow.map((segment) => {
          const key = segment.lineIds.join(",");
          const isOpen = Boolean(key) && Boolean(flowSelection) && (flowSelectedKey === key || segment.children.some((child) => child.lineId === flowSelectedKey));
          return <View key={segment.label}>
            <Pressable style={styles.row} disabled={!key} onPress={() => { setFlowSelectedKey(flowSelectedKey === key ? null : key); setShowAllFlowTransactions(false); }}>
              <View style={[styles.flowDot, { backgroundColor: segment.color }]} />
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{segment.label}</Text>
                <Text style={styles.rowDetail}>{flowPercent(segment.value)} of {totalIncome > 0 ? "income" : "spending"}{key ? "" : " · what's left after spending"}</Text>
              </View>
              <Text style={styles.rowValue}>{money(segment.value, currency)}</Text>
              {key ? <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} /> : null}
            </Pressable>
            {isOpen ? segment.children.map((child) => <Pressable key={child.lineId} style={[styles.row, styles.flowChildRow, flowSelectedKey === child.lineId && styles.flowChildActive]} onPress={() => { setFlowSelectedKey(flowSelectedKey === child.lineId ? key : child.lineId); setShowAllFlowTransactions(false); }}>
              <View style={styles.rowCopy}><Text style={styles.rowTitle}>{child.label}</Text><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(2, Math.round((child.value / segment.value) * 100))}%`, backgroundColor: segment.color }]} /></View></View>
              <Text style={styles.rowValue}>{money(child.value, currency)}</Text>
            </Pressable>) : null}
          </View>;
        })}
        {flowSelection ? <View style={{ marginTop: 10 }}>
          <Text style={styles.cardTitle}>{flowSelection.label} · {money(flowSelection.value, currency)}</Text>
          {flowTransactions.length ? (showAllFlowTransactions ? flowTransactions : flowTransactions.slice(0, 20)).map((transaction, index) => <Row key={`${index}-${transaction.date}-${transaction.payee}`} title={transaction.payee} detail={transaction.date} value={money(transactionAmountForLines(transaction, flowSelection.lineIds), currency)} />) : <Text style={styles.muted}>No transactions found for this category.</Text>}
          {flowTransactions.length > 20 ? <Pressable style={styles.secondarySmall} onPress={() => setShowAllFlowTransactions((prev) => !prev)}><Text style={styles.secondaryButtonText}>{showAllFlowTransactions ? "Show fewer" : `Show all (${flowTransactions.length})`}</Text></Pressable> : null}
        </View> : <Text style={styles.muted}>Tap a category for its subcategories and transactions.</Text>}
      </> : <Text style={styles.muted}>No income or spending in this period</Text>}
    </Card>
  </Page>;
}

// Same colors as web's default ("fresh") report theme, so a category reads the same on both apps.
const FLOW_PALETTE = ["#13936d", "#3569d4", "#c9891e", "#e05252", "#7c5cff"];

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { checking: "Checking", savings: "Savings", cash: "Cash", credit_card: "Credit card", other: "Other" };
const ACCOUNT_TYPE_ORDER: AccountType[] = ["checking", "savings", "cash", "other", "credit_card"];

// Edits one stock/retirement holdings account (a "group"): its name, class, and every holding in it. Every
// change is saved immediately through the whole-state save (no staged draft), like web's Manage holdings
// dialog. Number fields commit when they lose focus, so typing doesn't save on every keystroke.
function HoldingsEditor({ state, groupId, currency, quoteFeedback, refreshingIds, onSave, onRefreshHolding, onRefreshGroup, onClose }: {
  state: HouseholdState; groupId: string; currency: string; quoteFeedback: Record<string, { message: string; isError: boolean }>; refreshingIds: string[];
  onSave: (next: HouseholdState) => Promise<void>; onRefreshHolding: (assetId: string) => void; onRefreshGroup: (groupId: string) => void; onClose: () => void;
}) {
  const [costModes, setCostModes] = useState<Record<string, CostEntryMode>>({});
  const netWorth = state.goals?.netWorth || { assets: [], liabilities: [] };
  const items = holdingsInGroup(netWorth.assets, groupId);
  const accountName = items[0]?.groupName || items[0]?.name || "";
  const groupClass = items[0]?.assetClass || "stock";
  const groupBusy = items.some((item) => refreshingIds.includes(item.id || ""));

  const saveAssets = (assets: WealthAsset[]) => onSave({ ...state, goals: { ...state.goals, netWorth: { ...netWorth, assets } } });
  const commit = (assetId: string | undefined, field: HoldingField, raw: string | number) => {
    if (!assetId) return;
    void saveAssets(netWorth.assets.map((asset) => asset.id === assetId ? updateHolding(asset, field, raw, costModes[assetId] || "share") : asset));
  };
  const toggleCostMode = (assetId: string) => setCostModes((prev) => ({ ...prev, [assetId]: prev[assetId] === "total" ? "share" : "total" }));

  const rename = (name: string) => { if (name.trim() && name.trim() !== accountName) void saveAssets(renameHoldingGroup(netWorth.assets, groupId, name.trim())); };
  const changeClass = (assetClass: NonNullable<WealthAsset["assetClass"]>) => {
    if (assetClass === groupClass) return;
    void saveAssets(changeHoldingGroupClass(netWorth.assets, groupId, assetClass));
    if (!isHoldingAssetClass(assetClass)) onClose();
  };
  const addRow = () => void saveAssets([...netWorth.assets, newHoldingRow(groupId, accountName, groupClass === "retirement" ? "retirement" : "stock", () => uniqueId(`${groupId}-holding`))]);
  const removeRow = (assetId: string | undefined) => void saveAssets(netWorth.assets.filter((asset) => asset.id !== assetId));
  const done = () => { void saveAssets(purgeBlankHoldings(netWorth.assets, groupId)); onClose(); };
  const deleteAccount = () => Alert.alert(`Delete ${accountName || "this account"}?`, "Every holding in it will be removed. This cannot be undone.", [{ text: "Cancel" }, {
    text: "Delete", style: "destructive", onPress: () => { void saveAssets(removeHoldingGroup(netWorth.assets, groupId)); onClose(); }
  }]);

  const total = items.reduce((sum, item) => sum + assetValue(item), 0);
  const numberInput = (item: WealthAsset, field: HoldingField, value: number, placeholder: string, extraKey = "") => (
    <TextInput key={`${item.id}-${field}-${extraKey}-${value}`} style={[styles.input, { flex: 1 }]} defaultValue={value ? String(Math.round(value * 10000) / 10000) : ""} placeholder={placeholder}
      keyboardType="decimal-pad" onEndEditing={(event) => commit(item.id, field, event.nativeEvent.text)} accessibilityLabel={placeholder} />
  );

  return <Card>
    <View style={styles.iouPersonHead}>
      <Text style={styles.cardTitle}>Manage holdings</Text>
      <Text style={styles.rowValue}>{money(total, currency)}</Text>
    </View>
    <Text style={styles.label}>Account name</Text>
    <TextInput key={accountName} style={styles.input} defaultValue={accountName} placeholder="Fidelity brokerage" onEndEditing={(event) => rename(event.nativeEvent.text)} />
    <Text style={styles.label}>Account type</Text>
    <View style={styles.choiceRow}>
      {([["stock", "Stock"], ["retirement", "Retirement"], ["cash", "Cash"], ["property", "Property"], ["other", "Other"]] as Array<[NonNullable<WealthAsset["assetClass"]>, string]>).map(([value, label]) => <Pressable key={value} style={[styles.choice, groupClass === value && styles.choiceActive]} onPress={() => changeClass(value)}>
        <Text style={[styles.choiceText, groupClass === value && styles.choiceTextActive]}>{label}</Text>
      </Pressable>)}
    </View>
    <Text style={styles.muted}>Choosing Cash, Property or Other turns this account back into a normal asset.</Text>

    {items.map((item) => {
      const mode = costModes[item.id || ""] || "share";
      const gain = holdingGainLoss(item);
      const feedback = item.id ? quoteFeedback[item.id] : undefined;
      const refreshing = refreshingIds.includes(item.id || "");
      return <View key={item.id} style={styles.planTaskBlock}>
        <View style={styles.actionRow}>
          <TextInput key={`${item.id}-symbol-${item.symbol}`} style={[styles.input, { flex: 1 }]} defaultValue={item.symbol || ""} placeholder="Symbol, e.g. AAPL" autoCapitalize="characters" autoCorrect={false} onEndEditing={(event) => commit(item.id, "symbol", event.nativeEvent.text)} />
          <Pressable style={styles.planStepperButton} onPress={() => removeRow(item.id)} accessibilityLabel={`Remove ${item.symbol || "this holding"}`}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
        </View>
        <View style={styles.choiceRow}>
          {(["stock", "fund"] as const).map((type) => <Pressable key={type} style={[styles.choice, (item.holdingType || "stock") === type && styles.choiceActive]} onPress={() => commit(item.id, "holdingType", type)}>
            <Text style={[styles.choiceText, (item.holdingType || "stock") === type && styles.choiceTextActive]}>{type === "stock" ? "Stock" : "Mutual fund"}</Text>
          </Pressable>)}
        </View>
        <View style={styles.actionRow}>
          {numberInput(item, "shares", Number(item.shares || 0), "Shares")}
          {numberInput(item, "costBasis", costDisplayValue(item, mode), mode === "total" ? "Total paid" : "Avg. cost / share", mode)}
          <Pressable style={styles.planStepperButton} onPress={() => item.id && toggleCostMode(item.id)} accessibilityLabel="Switch between per-share cost and total paid"><Text style={styles.secondaryButtonText}>{mode === "total" ? "Total" : "/sh"}</Text></Pressable>
        </View>
        <View style={styles.actionRow}>
          {numberInput(item, "price", Number(item.price || 0), "Price / share")}
          <Pressable style={styles.planStepperButton} disabled={refreshing} onPress={() => item.id && onRefreshHolding(item.id)} accessibilityLabel={`Refresh live price for ${item.symbol || "this holding"}`}>{refreshing ? <ActivityIndicator size="small" color={colors.green} /> : <Ionicons name="refresh" size={18} color={colors.text} />}</Pressable>
          {numberInput(item, "marketValue", assetValue(item), "Market value")}
        </View>
        <Text style={[styles.rowDetail, feedback?.isError && { color: colors.coral }]}>{feedback ? feedback.message : "Price not refreshed yet"}{gain.hasCostBasis ? ` · ${gain.amount >= 0 ? "+" : ""}${money(gain.amount, currency)} (${gain.percent >= 0 ? "+" : ""}${gain.percent.toFixed(1)}%)` : ""}</Text>
      </View>;
    })}
    <Text style={styles.muted}>No ticker (a 401(k) fund, say)? Type the market value directly.</Text>
    <View style={styles.actionRow}>
      <Pressable style={styles.secondarySmall} onPress={addRow}><Text style={styles.secondaryButtonText}>+ Add holding</Text></Pressable>
      <Pressable style={styles.secondarySmall} disabled={groupBusy} onPress={() => onRefreshGroup(groupId)}><Text style={styles.secondaryButtonText}>{groupBusy ? "Refreshing…" : "Refresh all prices"}</Text></Pressable>
    </View>
    <View style={styles.actionRow}>
      <Pressable style={styles.primaryButton} onPress={done}><Text style={styles.primaryButtonText}>Done</Text></Pressable>
      <Pressable style={styles.secondarySmall} onPress={deleteAccount}><Text style={[styles.secondaryButtonText, { color: colors.coral }]}>Delete account</Text></Pressable>
    </View>
  </Card>;
}

// Stock/fund holdings: grouped by account with gain/loss, editable (HoldingsEditor) with live price refresh on
// demand. Out of scope (see the mobile catch-up plan): web's 5-minute background price polling (a phone
// shouldn't poll silently), multi-currency display, and debt-to-budget-line auto-EMI linking.
function Wealth({ state, onSave, onBack }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void>; onBack: () => void }) {
  const currency = state.household.currency;
  const today = () => new Date().toISOString().slice(0, 10);
  const accounts = state.accounts || [];
  const debts = state.goals?.debts || [];
  const netWorthAssets = state.goals?.netWorth?.assets || [];
  const netWorthLiabilities = state.goals?.netWorth?.liabilities || [];
  const plainAssets = netWorthAssets.filter((asset) => !isHoldingAssetClass(asset.assetClass));
  const holdingGroups = groupStockHoldings(netWorthAssets);

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
            ...state.goals.netWorth,
            assets: state.goals.netWorth.assets.filter((asset) => !accounts.find((account) => account.id === accountId && account.netWorthAssetId === asset.id)),
            liabilities: state.goals.netWorth.liabilities.filter((liability) => !accounts.find((account) => account.id === accountId && account.netWorthLiabilityId === liability.id))
          } : state.goals.netWorth
        } : state.goals
      })
    }]);
  };

  // ---- Stock / fund holdings: edit a group, refresh live prices --------------------------------------------
  // After an await the closed-over `state` can be stale (the user may have edited meanwhile), so the quote
  // results are applied onto the latest state through this ref instead.
  const stateRef = useRef(state);
  stateRef.current = state;
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [quoteFeedback, setQuoteFeedback] = useState<Record<string, { message: string; isError: boolean }>>({});
  const [refreshingIds, setRefreshingIds] = useState<string[]>([]);
  const [newHoldingName, setNewHoldingName] = useState("");
  const [newHoldingClass, setNewHoldingClass] = useState<"stock" | "retirement">("stock");

  // One bad symbol or a rate limit only drops that holding's update, never the batch. `report` shows a
  // per-holding message (the editor); the group-level button stays quiet about holdings with no symbol.
  const refreshQuotes = async (assetIds: string[], options: { stampGroupId?: string; report: boolean }) => {
    const targets = (stateRef.current.goals?.netWorth?.assets || []).filter((asset) => asset.id && assetIds.includes(asset.id));
    const withSymbol = targets.filter((asset) => (asset.symbol || "").trim());
    const feedback: Record<string, { message: string; isError: boolean }> = {};
    if (options.report) targets.filter((asset) => !(asset.symbol || "").trim()).forEach((asset) => { feedback[asset.id as string] = { message: "Enter a symbol first.", isError: true }; });
    if (!withSymbol.length) { setQuoteFeedback((prev) => ({ ...prev, ...feedback })); return; }
    setRefreshingIds((prev) => [...prev, ...withSymbol.map((asset) => asset.id as string)]);
    const results = await Promise.all(withSymbol.map(async (asset) => {
      try { return { id: asset.id as string, price: (await api.stockQuote((asset.symbol || "").trim().toUpperCase())).price, error: "" }; }
      catch (cause) { return { id: asset.id as string, price: null as number | null, error: cause instanceof Error ? cause.message : "Couldn't fetch a price" }; }
    }));
    results.forEach((result) => { feedback[result.id] = result.price !== null ? { message: `Updated to ${money(result.price, currency)}`, isError: false } : { message: result.error, isError: true }; });
    const latest = stateRef.current;
    const latestNetWorth = latest.goals?.netWorth;
    if (latestNetWorth && results.some((result) => result.price !== null)) {
      const assets = latestNetWorth.assets.map((asset) => {
        const hit = results.find((result) => result.id === asset.id && result.price !== null);
        return hit && hit.price !== null ? applyQuote(asset, hit.price) : asset;
      });
      const priceLastUpdated = options.stampGroupId ? { ...(latestNetWorth.priceLastUpdated || {}), [options.stampGroupId]: new Date().toISOString() } : latestNetWorth.priceLastUpdated;
      await onSave({ ...latest, goals: { ...latest.goals, netWorth: { ...latestNetWorth, assets, ...(priceLastUpdated ? { priceLastUpdated } : {}) } } });
    }
    setQuoteFeedback((prev) => ({ ...prev, ...feedback }));
    setRefreshingIds((prev) => prev.filter((id) => !withSymbol.some((asset) => asset.id === id)));
  };
  const groupAssetIds = (groupId: string) => holdingsInGroup(stateRef.current.goals?.netWorth?.assets || [], groupId).map((asset) => asset.id as string).filter(Boolean);

  const openHoldingsEditor = async (groupId: string) => {
    const assets = state.goals?.netWorth?.assets || [];
    const adopted = adoptHoldingGroup(assets, groupId);
    if (state.goals?.netWorth && adopted.some((asset, index) => asset !== assets[index])) {
      await onSave({ ...state, goals: { ...state.goals, netWorth: { ...state.goals.netWorth, assets: adopted } } });
    }
    setEditingGroupId(groupId);
  };
  const submitNewHoldingGroup = async () => {
    if (!newHoldingName.trim()) return Alert.alert("Missing info", "Enter an account name, like Fidelity brokerage.");
    if (!state.goals) return;
    const netWorth = state.goals.netWorth || { assets: [], liabilities: [] };
    const first = newHoldingGroup(newHoldingName.trim(), newHoldingClass, () => uniqueId("holdings"));
    await onSave({ ...state, goals: { ...state.goals, netWorth: { ...netWorth, assets: [...netWorth.assets, first] } } });
    setNewHoldingName("");
    setEditingGroupId(first.groupId || first.id || null);
  };

  const transfers = state.transfers || [];
  const [transferFrom, setTransferFrom] = useState(""); const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState(""); const [transferDate, setTransferDate] = useState(today()); const [transferMemo, setTransferMemo] = useState("");
  const [showTransferHistory, setShowTransferHistory] = useState(false);
  const accountLabel = (id: string) => accounts.find((account) => account.id === id)?.name || "Deleted account";

  const submitTransfer = async () => {
    const transfer = buildTransfer({ fromAccountId: transferFrom, toAccountId: transferTo, amount: Number(transferAmount), date: transferDate, memo: transferMemo }, () => uniqueId("transfer"));
    if (!transfer) return Alert.alert("Can't record transfer", "Pick two different accounts and enter an amount above zero.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) return Alert.alert("Invalid date", "Use the format YYYY-MM-DD.");
    const closed = [transferFrom, transferTo].map((id) => accounts.find((account) => account.id === id)).find((account) => !accountAllowsDate(account, transferDate));
    if (closed) return Alert.alert("Account is closed", `${closed.name} is closed — pick a date on or before its close date, or choose a different account.`);
    await onSave({ ...state, transfers: [transfer, ...transfers] });
    setTransferAmount(""); setTransferMemo("");
  };

  const deleteTransfer = (index: number) => {
    const transfer = transfers[index];
    if (!transfer) return;
    Alert.alert("Delete transfer?", `${accountLabel(transfer.fromAccountId)} → ${accountLabel(transfer.toAccountId)} · ${money(transfer.amount, currency)}`, [{ text: "Cancel" }, {
      text: "Delete", style: "destructive", onPress: () => void onSave({ ...state, transfers: transfers.filter((_, itemIndex) => itemIndex !== index) })
    }]);
  };

  // Keeps auto-contributing goals current when this screen opens (same convention as web, which runs
  // it on every render) - percent-of-paycheck goals need paycheck occurrences materialized first. Only
  // saves when something actually changed, so it settles after one pass instead of looping.
  useEffect(() => {
    const funds = state.goals?.sinkingFunds || [];
    if (!funds.some((fund) => autoContributeChoice(fund) !== "off")) return;
    let base = state;
    let materialized = false;
    if (funds.some((fund) => autoContributeChoice(fund) === "percent")) {
      const result = ensurePaycheckOccurrencesGenerated(state.paychecks || [], state.paycheckOccurrences || [], () => uniqueId("paycheck-occurrence"));
      materialized = JSON.stringify(result.paychecks) !== JSON.stringify(state.paychecks || []) || JSON.stringify(result.paycheckOccurrences) !== JSON.stringify(state.paycheckOccurrences || []);
      if (materialized) base = { ...state, paychecks: result.paychecks, paycheckOccurrences: result.paycheckOccurrences };
    }
    const credited = withGoalAutoContributions(base, localDateKey());
    if (materialized || credited !== base) void onSave(credited);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.transactions, state.paycheckOccurrences, state.goals?.sinkingFunds]);

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

  const changeAutoMode = (index: number, choice: AutoContributeChoice) => {
    void onSave({ ...state, goals: { ...state.goals, sinkingFunds: sinkingFunds.map((fund, itemIndex) => itemIndex === index ? setAutoContributeMode(fund, choice) : fund) } });
  };
  const changeAutoPercent = (index: number, value: string) => {
    void onSave({ ...state, goals: { ...state.goals, sinkingFunds: sinkingFunds.map((fund, itemIndex) => itemIndex === index ? setAutoContributePercent(fund, Number(value)) : fund) } });
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
            ...state.goals!.netWorth!,
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
      <Text style={styles.cardTitle}>Transfers</Text>
      {accounts.length >= 2 ? <>
        <Text style={styles.label}>From</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{accounts.map((account) => <Pressable key={account.id} style={[styles.choice, transferFrom === account.id && styles.choiceActive]} onPress={() => setTransferFrom(account.id)}><Text style={[styles.choiceText, transferFrom === account.id && styles.choiceTextActive]}>{account.name}{account.closedAt ? " (closed)" : ""}</Text></Pressable>)}</ScrollView>
        <Text style={styles.label}>To</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{accounts.map((account) => <Pressable key={account.id} style={[styles.choice, transferTo === account.id && styles.choiceActive]} onPress={() => setTransferTo(account.id)}><Text style={[styles.choiceText, transferTo === account.id && styles.choiceTextActive]}>{account.name}{account.closedAt ? " (closed)" : ""}</Text></Pressable>)}</ScrollView>
        <View style={styles.actionRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={transferAmount} onChangeText={setTransferAmount} placeholder="Amount" keyboardType="decimal-pad" />
          <TextInput style={[styles.input, { flex: 1 }]} value={transferDate} onChangeText={setTransferDate} placeholder="YYYY-MM-DD" />
        </View>
        <TextInput style={styles.input} value={transferMemo} onChangeText={setTransferMemo} placeholder="Memo (e.g. Credit card payment)" />
        <Pressable style={styles.secondarySmall} onPress={() => void submitTransfer()}><Text style={styles.secondaryButtonText}>Record transfer</Text></Pressable>
      </> : <Text style={styles.muted}>Add at least two accounts to record a transfer, like paying a credit card from checking.</Text>}
      {transfers.length ? <>
        <Pressable style={[styles.secondarySmall, { marginTop: 10 }]} onPress={() => setShowTransferHistory((prev) => !prev)}><Text style={styles.secondaryButtonText}>{showTransferHistory ? "Hide" : "Show"} transfer history ({transfers.length})</Text></Pressable>
        {showTransferHistory ? transfersNewestFirst(transfers).map(({ transfer, index }) => <View key={transfer.id || index} style={styles.row}>
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle}>{accountLabel(transfer.fromAccountId)} → {accountLabel(transfer.toAccountId)}</Text>
            <Text style={styles.rowDetail}>{[transfer.date, transfer.memo].filter(Boolean).join(" · ")}</Text>
          </View>
          <Text style={styles.rowValue}>{money(transfer.amount, currency)}</Text>
          <Pressable onPress={() => deleteTransfer(index)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
        </View>) : null}
      </> : null}
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
          <Text style={styles.label}>Auto-contribute</Text>
          <View style={styles.choiceRow}>
            {([["off", "Off"], ["roundup", "Round-up purchases"], ["percent", "% of each paycheck"]] as Array<[AutoContributeChoice, string]>).map(([choice, label]) => <Pressable key={choice} style={[styles.choice, autoContributeChoice(fund) === choice && styles.choiceActive]} onPress={() => changeAutoMode(index, choice)}>
              <Text style={[styles.choiceText, autoContributeChoice(fund) === choice && styles.choiceTextActive]}>{label}</Text>
            </Pressable>)}
          </View>
          {autoContributeChoice(fund) === "percent" ? <View style={styles.actionRow}>
            <TextInput key={fund.autoContribute?.percent} style={[styles.input, { flex: 1 }]} defaultValue={String(fund.autoContribute?.percent ?? 5)} keyboardType="decimal-pad" placeholder="Percent (0-100)" onEndEditing={(event) => changeAutoPercent(index, event.nativeEvent.text)} />
          </View> : null}
          {autoContributeChoice(fund) !== "off" ? <Text style={styles.muted}>{autoContributeChoice(fund) === "roundup" ? "Rounds every purchase up to the next dollar" : `Sets aside ${Number(fund.autoContribute?.percent || 0)}% of every paycheck`} automatically, counting what's already recorded.</Text> : null}
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

    {editingGroupId ? <HoldingsEditor state={state} groupId={editingGroupId} currency={currency} quoteFeedback={quoteFeedback} refreshingIds={refreshingIds}
      onSave={onSave} onRefreshHolding={(assetId) => void refreshQuotes([assetId], { report: true })}
      onRefreshGroup={(groupId) => void refreshQuotes(groupAssetIds(groupId), { stampGroupId: groupId, report: true })} onClose={() => setEditingGroupId(null)} /> : <Card>
      <Text style={styles.cardTitle}>Stock &amp; fund holdings</Text>
      {holdingGroups.length ? holdingGroups.map((group) => {
        const groupTotal = group.items.reduce((sum, item) => sum + assetValue(item), 0);
        const gainLoss = groupGainLoss(group.items);
        const lastUpdated = formatRelativeTime(state.goals?.netWorth?.priceLastUpdated?.[group.groupId]);
        const hasSymbols = group.items.some((item) => (item.symbol || "").trim());
        const groupRefreshing = group.items.some((item) => refreshingIds.includes(item.id || ""));
        return <View key={group.groupId} style={[styles.row, { flexDirection: "column", alignItems: "stretch" }]}>
          <View style={styles.iouPersonHead}>
            <Text style={styles.rowTitle}>{group.groupName}</Text>
            <Text style={styles.rowValue}>{money(groupTotal, currency)}</Text>
          </View>
          <Text style={styles.rowDetail}>{assetClassLabelForHoldings(group.items)} · {group.items.length} holding{group.items.length === 1 ? "" : "s"}{gainLoss.hasCostBasis ? ` · ${gainLoss.amount >= 0 ? "+" : ""}${money(gainLoss.amount, currency)} (${gainLoss.percent >= 0 ? "+" : ""}${gainLoss.percent.toFixed(1)}%)` : ""}</Text>
          {group.items.map((item) => {
            const itemGainLoss = holdingGainLoss(item);
            const detail = [item.symbol ? `${item.symbol}${item.shares ? ` · ${item.shares} sh` : ""}` : null, itemGainLoss.hasCostBasis ? `${itemGainLoss.percent >= 0 ? "+" : ""}${itemGainLoss.percent.toFixed(1)}%` : null].filter(Boolean).join(" · ");
            return <Row key={item.id || item.name} title={item.name} detail={detail} value={money(assetValue(item), currency)} />;
          })}
          <View style={[styles.actionRow, { marginTop: 8 }]}>
            <Pressable style={styles.secondarySmall} onPress={() => void openHoldingsEditor(group.groupId)}><Text style={styles.secondaryButtonText}>Edit holdings</Text></Pressable>
            {hasSymbols ? <Pressable style={styles.secondarySmall} disabled={groupRefreshing} onPress={() => void refreshQuotes(group.items.map((item) => item.id as string).filter(Boolean), { stampGroupId: group.groupId, report: false })}><Text style={styles.secondaryButtonText}>{groupRefreshing ? "Refreshing…" : "↻ Live price"}</Text></Pressable> : null}
          </View>
          {lastUpdated ? <Text style={styles.muted}>Prices updated {lastUpdated}</Text> : null}
        </View>;
      }) : <Text style={styles.muted}>No stock or fund holdings yet</Text>}
      <Text style={[styles.label, { marginTop: 14 }]}>Add a stock or retirement account</Text>
      <TextInput style={styles.input} value={newHoldingName} onChangeText={setNewHoldingName} placeholder="Fidelity brokerage" />
      <View style={styles.choiceRow}>
        {(["stock", "retirement"] as const).map((value) => <Pressable key={value} style={[styles.choice, newHoldingClass === value && styles.choiceActive]} onPress={() => setNewHoldingClass(value)}>
          <Text style={[styles.choiceText, newHoldingClass === value && styles.choiceTextActive]}>{value === "stock" ? "Stock / brokerage" : "Retirement"}</Text>
        </Pressable>)}
      </View>
      <Pressable style={styles.secondarySmall} onPress={() => void submitNewHoldingGroup()}><Text style={styles.secondaryButtonText}>Add account</Text></Pressable>
    </Card>}

    <Card>
      <Text style={styles.cardTitle}>Other assets &amp; liabilities</Text>
      {plainAssets.length ? <Text style={[styles.label, { marginTop: 10 }]}>Assets</Text> : null}
      {plainAssets.map((asset, index) => <Pressable key={asset.id || index} onLongPress={() => asset.id && deleteNetWorthItem("asset", asset.id)}>
        <Row title={asset.name} detail={asset.assetClass || "other"} value={money(assetValue(asset), currency)} />
      </Pressable>)}
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

function More({ state, user, households, onSelect, onSignOut, onOpenSharedExpenses, onOpenReports, onOpenWealth, onOpenBills, onOpenPaychecks, onOpenDecisions, onOpenBankStream }: { state: HouseholdState; user: User; households: Household[]; onSelect: (id: string) => Promise<void>; onSignOut: () => Promise<void>; onOpenSharedExpenses: () => void; onOpenReports: () => void; onOpenWealth: () => void; onOpenBills: () => void; onOpenPaychecks: () => void; onOpenDecisions: () => void; onOpenBankStream: () => void }) {
  const assets = state.goals?.netWorth?.assets.reduce((sum, item) => sum + mobileAssetValue(item), 0) || 0;
  const liabilities = state.goals?.netWorth?.liabilities.reduce((sum, item) => sum + Number(item.value || 0), 0) || 0;
  return <Page><Title eyebrow="ACCOUNT">More</Title><Card><Text style={styles.cardTitle}>{user.name}</Text><Text style={styles.muted}>{user.email}</Text></Card><Pressable style={styles.card} onPress={onOpenWealth}><View style={styles.iouPersonHead}><Text style={styles.cardTitle}>Household wealth</Text><Ionicons name="chevron-forward" size={20} color={colors.muted} /></View><Text style={styles.heroValue}>{money(assets - liabilities, state.household.currency)}</Text><Text style={styles.muted}>Assets {money(assets, state.household.currency)} · Liabilities {money(liabilities, state.household.currency)}</Text><Text style={styles.muted}>{(state.accounts || []).length} accounts · {state.goals?.debts?.length || 0} debt accounts with EMI plans</Text></Pressable><Card><Text style={styles.cardTitle}>Households</Text>{households.map((item) => <Pressable key={item.id} style={styles.householdRow} onPress={() => void onSelect(item.id)}><View><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.rowDetail}>{item.country} · {item.currency} · {item.role}</Text></View>{item.selected ? <Ionicons name="checkmark-circle" size={24} color={colors.green} /> : <Ionicons name="chevron-forward" size={20} color={colors.muted} />}</Pressable>)}</Card><Card><Text style={styles.cardTitle}>Money</Text><Pressable style={styles.householdRow} onPress={onOpenPaychecks}><View><Text style={styles.rowTitle}>Paycheck/Income</Text><Text style={styles.rowDetail}>Recurring income and pay dates</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={styles.householdRow} onPress={onOpenBankStream}><View><Text style={styles.rowTitle}>Bank stream</Text><Text style={styles.rowDetail}>{(state.transactionInboxDrafts || []).filter((item) => !(state.transactionInboxDone || []).includes(item.id || "")).length} waiting · import statements, review, accept</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={styles.householdRow} onPress={onOpenBills}><View><Text style={styles.rowTitle}>Bills</Text><Text style={styles.rowDetail}>Upcoming and overdue, by category</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={styles.householdRow} onPress={onOpenSharedExpenses}><View><Text style={styles.rowTitle}>Shared Expenses</Text><Text style={styles.rowDetail}>Split bills, track IOUs, manage friends</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={[styles.householdRow, { borderBottomWidth: 0 }]} onPress={onOpenReports}><View><Text style={styles.rowTitle}>Reports</Text><Text style={styles.rowDetail}>Category, budget vs actual, tags</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable></Card><Card><Text style={styles.cardTitle}>Family</Text><Pressable style={[styles.householdRow, { borderBottomWidth: 0 }]} onPress={onOpenDecisions}><View><Text style={styles.rowTitle}>Decisions</Text><Text style={styles.rowDetail}>{(state.decisions || []).filter((item) => item.status !== "decided").length} open · weigh pros and cons together</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable></Card><Card><Text style={styles.cardTitle}>Meals and recipes</Text><Text style={styles.muted}>{state.meals.plannedWeek.length} planned meals · {state.meals.recipes.length} saved recipes</Text></Card><Pressable style={styles.dangerButton} onPress={() => Alert.alert("Sign out?", "You will need to sign in again.", [{ text: "Cancel" }, { text: "Sign out", style: "destructive", onPress: () => void onSignOut() }])}><Text style={styles.dangerText}>Sign out</Text></Pressable></Page>;
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
  note: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 16 }, noteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }, noteTitle: { color: colors.text, fontWeight: "800", fontSize: 20 }, noteBody: { color: colors.text, marginVertical: 10, lineHeight: 21 }, checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }, checkRowChild: { marginLeft: 24 }, checkText: { flex: 1, color: colors.text, fontSize: 15 }, done: { textDecorationLine: "line-through", color: colors.muted },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border }, colorSwatchActive: { borderWidth: 3, borderColor: colors.green },
  reminderPhotoPreview: { width: "100%", height: 180, borderRadius: 8, marginVertical: 8, backgroundColor: colors.panel },
  journalPhotoRow: { marginTop: 10 }, journalPhoto: { width: 72, height: 72, borderRadius: 8, marginRight: 8 },
  multilineInput: { height: 90, textAlignVertical: "top", paddingTop: 12 },
  householdRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }, dangerButton: { alignItems: "center", padding: 15, borderRadius: 8, backgroundColor: "#fff0f0", borderWidth: 1, borderColor: "#ffd6d6" }, dangerText: { color: colors.coral, fontWeight: "800" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 8 }, choice: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, choiceActive: { backgroundColor: colors.green, borderColor: colors.green }, choiceText: { color: colors.text, fontWeight: "700" }, choiceTextActive: { color: "white" }, recipeChoice: { padding: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 7, marginTop: 7 }, actionRow: { flexDirection: "row", gap: 8, marginBottom: 8 }, secondarySmall: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 7 }, successText: { color: colors.green, fontWeight: "700", marginVertical: 7 },
  dayNavRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 8 }, dayNavLabel: { flex: 1, alignItems: "center" }, planStepperButton: { minHeight: 44, minWidth: 52, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 7 }, planTaskBlock: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }, subtaskList: { marginLeft: 8, marginBottom: 8 },
  documentsBreadcrumbRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", paddingVertical: 6 }, documentsBreadcrumbItem: { flexDirection: "row", alignItems: "center" }, documentsBreadcrumbText: { color: colors.muted, fontWeight: "700" }, documentsBreadcrumbActive: { color: colors.text },
  tabBar: { minHeight: 64, paddingTop: 7, flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }, tab: { flex: 1, alignItems: "center", gap: 3 }, tabText: { color: colors.muted, fontSize: 10, fontWeight: "700" }, tabTextActive: { color: colors.green },
  authPage: { flex: 1, backgroundColor: colors.navy }, authInner: { flex: 1, paddingHorizontal: 24, justifyContent: "center" }, logo: { width: 52, height: 52, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#43d6a5" }, logoText: { color: colors.navy, fontSize: 28, fontWeight: "900" }, authTitle: { color: "white", fontSize: 34, lineHeight: 40, fontWeight: "800", marginTop: 22, maxWidth: 340 }, authCopy: { color: "#c2cce0", lineHeight: 22, marginTop: 10, marginBottom: 25 }, authCard: { backgroundColor: "white", borderRadius: 8, padding: 18, gap: 9 }, label: { color: colors.text, fontWeight: "700", marginTop: 3 }, input: { height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 13, fontSize: 16, color: colors.text, backgroundColor: "#f8fafc" }, formError: { color: colors.coral, marginVertical: 3 }, primaryButton: { height: 52, alignItems: "center", justifyContent: "center", backgroundColor: colors.green, borderRadius: 7, marginTop: 6 }, primaryButtonText: { color: "white", fontSize: 16, fontWeight: "800" }, secondaryButton: { height: 48, alignItems: "center", justifyContent: "center", borderRadius: 7, borderWidth: 1, borderColor: colors.border }, secondaryButtonText: { color: colors.text, fontWeight: "800" },
  subScreenHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 }, subScreenBack: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  flowBar: { flexDirection: "row", height: 22, borderRadius: 11, overflow: "hidden", marginVertical: 12, backgroundColor: colors.panel }, flowDot: { width: 12, height: 12, borderRadius: 6 }, flowChildRow: { marginLeft: 22, minHeight: 52 }, flowChildActive: { backgroundColor: colors.panel },
  iouPersonHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, decisionColumn: { marginTop: 10 },
  reportSubcategoryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  cashFlowChart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", height: 120, marginTop: 10 }, cashFlowColumn: { alignItems: "center", gap: 6 }, cashFlowBars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 100 }, cashFlowBar: { width: 12, borderRadius: 3 }, cashFlowLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" }, cashFlowLegendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden", marginTop: 8 }, progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.green }
});
