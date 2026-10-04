import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, BackHandler, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl,
  ScrollView, Share, StyleSheet, Text, TextInput, View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
// "expo-file-system/legacy", not the package root: since SDK 54 the root still exports uploadAsync/writeAsStringAsync
// but every one of those throws at runtime ("imported from expo-file-system is deprecated").
import * as FileSystem from "expo-file-system/legacy";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, ApiError } from "./src/api";
import { globalSearchResults, shouldShowOnboarding, dismissOnboarding, ONBOARDING_STEPS } from "./src/searchLogic";
import type { SearchResult } from "./src/searchLogic";
import { colors } from "./src/theme";
import { registerPushToken } from "./src/push";
import { applyChecklistToggle, formatShortDate, formatMonthLabel, shiftMonthKey, switchBudgetMonth, copyBudgetFromMonth, availablePreviousBudgets, toggleRollover, ensureRecurringBudgetBills, enableRecurringBill, disableRecurringBill, updateRecurringBill, groceryEstimateAmount, recurringBudgetSetAside, mealWeeksForMonth, currentMealWeekNumber, weekDayDatesForWeek } from "./src/planningLogic";
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
  flowSegments, resolveFlowSelection, transactionAmountForLines, transactionsForLines, priorYearMonthKeys, yoyDelta, yoyLabel, REPORT_THEMES
} from "./src/reportsLogic";
import type { ReportScope } from "./src/reportsLogic";
import type { Account, AccountType, ActualLog, Recipe, BudgetLine, CalendarEvent, CalendarImportDraft, ChoreRecurrence, Debt, Decision, NoteUserShare, SharedNote, Document, DocumentsData, Friend, Household, HouseholdAccess, HouseholdState, Iou, IouDirection, JournalEntry, Note, Paycheck, PaycheckRecurrence, PlanBucket, PlanRecurrence, PlanTask, PlannedMeal, PrivateData, ReminderPhotoDraft, ReminderRecurrence, SinkingFund, User, WealthAsset, WealthItemType, WealthLiability } from "./src/types";
import type { HomeActionItem } from "./src/calendarLogic";
import { ANNUAL_EVENT_LABELS, ANNUAL_EVENT_TYPES, REMIND_BEFORE_OPTIONS, annualEventDisplayTitle, annualWishedKeys, buildAnnualEvent, nextPendingAnnualOccurrence, toggleAnnualWished, updateAnnualEvent, advanceRecurringReminder, buildCalendarCsv, buildCalendarIcs, buildPhotoReminderEvent, calendarDraftToItem, icsEventsToCalendarDrafts, parseCalendarCsv, parseIcsText, resolveImportAssignees, sanitizeCalendarDrafts, directionsUrl, matchesOwnerFilter, homeActionItems, homeWeekStrip, toggleReminderCompletion, choreCadenceLabels, choreCompletedKeys, completionKeyFor, currentChoreOccurrenceDate, effectiveAssignees, isChoreOccurrenceComplete, isReminderComplete, isValidClockTime, normalizeReminderPhotoDraft, reminderTiming, repairChoreCompletion, toggleChoreCompletion } from "./src/calendarLogic";
import {
  isHoldingAssetClass, assetValue, computeTrailingMonthKeys, computeNetWorthAtDate, computeNetWorthTrend,
  accountsWithBalances, debtPayoffProgressPercent, applyDebtPayment, accountAllowsDate, buildTransfer, transfersNewestFirst, convertCurrency, displayCurrencyOptions, assetAllocationBreakdown, updateHolding, costDisplayValue, applyQuote, adoptHoldingGroup, newHoldingRow, newHoldingGroup, renameHoldingGroup, changeHoldingGroupClass, purgeBlankHoldings, removeHoldingGroup, formatRelativeTime, holdingsInGroup, groupStockHoldings, assetClassLabelForHoldings, holdingGainLoss, groupGainLoss
} from "./src/wealthLogic";
import type { CostEntryMode, HoldingField } from "./src/wealthLogic";
import { ensurePaycheckOccurrencesGenerated, budgetIncomeFromPaychecks, paycheckIncomeForMonth, validatePaycheckPatch, updatePaycheck, setOccurrenceDate, assignBillToPaycheck, removeAssignedLine, paycheckAssignedAmount, paycheckMonthlyIncome, paycheckActiveInMonth } from "./src/paychecksLogic";
import { HELP_GUIDES } from "./src/helpContent";
import { ACCESS_ROLES, ALL_SCOPES, toggleScope, setShareEverything, allScopesShared, sharedScopesOf, recordInvitation, recordRevoked, recordAccessLevel, emailOutcomeMessage, validateNewPassword, isDemoAccount } from "./src/sharingLogic";
import { JOURNAL_MOODS, JOURNAL_MOOD_EMOJI, JOURNAL_MOOD_COLOR, JOURNAL_MAX_PHOTOS, validateEntryInput, createEntry, updateEntry, removePhoto, sortedEntries, writingStreak, entriesInYear, allTags, filterEntries, moodTrend, todaysJournalContext } from "./src/journalLogic";
import { homeNoteReminders, homeRecentActivity, billAndGoalReminders, dismissBudgetReminder } from "./src/homeLogic";
import { saveRecipe, deleteRecipe, validateRecipe, recipesFilteredSorted, plannedRecipeIds, planMealSlot, clearMealSlot, mealInSlot, mealNutritionTotals, groceryListByAisle } from "./src/mealsLogic";
import type { RecipeFilter, RecipeSort } from "./src/mealsLogic";
import { sortDecisions, createDecision, updateDecision, addDecisionItem, editDecisionItem, removeDecisionItem, moveDecisionItem, markDecided, reopenDecision, canAttachToDecision, addDecisionAttachment, removeDecisionAttachment, attachmentDocumentIds } from "./src/decisionsLogic";
import type { DecisionListKey } from "./src/decisionsLogic";
import { autoContributeChoice, setAutoContributeMode, setAutoContributePercent, withGoalAutoContributions, validateGoalFields, editGoalFields } from "./src/goalsLogic";
import type { AutoContributeChoice } from "./src/goalsLogic";
import { visibleNotes, allLabels, toggleLabel, setNoteReminder, setNoteBill, trashNote, restoreNote, purgeExpiredTrash, duplicateNote, editChecklistText, deleteChecklistItem, toggleIndent, moveChecklistItem as moveNoteItem, bucketChecklistItems } from "./src/notesLogic";
import type { NotesView } from "./src/notesLogic";
import { noteLinkedImages, imageContentType, photoFileName } from "./src/notePhotosLogic";
import { parseBankCsvTransactions, buildBankStreamDrafts, draftsNeedingAi, applyAiSuggestions, autoAcceptSafeDrafts, importSummary, AI_IMPORT_CHUNK_SIZE, reviewDrafts, pendingDraftCountsByAccount, acceptDraft, dismissDraft, updateDraft, clearDraftsForAccount, moveDraftToTransfer, splitRecordWithFriends, exceedsStateLimit, setCategorizationRule, displayDraftAmount, storedDraftAmount, setAccountForUnlinkedDrafts, clearHistorySuggestions, sortDrafts } from "./src/bankStreamLogic";
import type { DraftReview, DraftSortField, FriendShare, IouSource, ParsedBankRow, SplitWithFriendsOptions } from "./src/bankStreamLogic";
import type { LedgerSortField, RecurringRepeat } from "./src/budgetLogic";
import { addCategory, addLine, updateLine, budgetDeletionImpact, deleteBudgetLines, allBudgetLines, lineSnapshot, makeTransaction, transactionAssignmentLabel, addTagsDeduped, removeTag, tagSuggestions, setTransactionTags, splitEditorInitialRows, splitRemaining, canSaveSplit, applySplit, removeSplit, applyLineToTransactions, sortLedgerEntries, filterCategoriesByOwner, ensureRecurringExpensesPosted, addRecurringExpense, updateRecurringExpense, deleteRecurringExpense, RECURRING_REPEAT_LABELS } from "./src/budgetLogic";

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


function parseLocalDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

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
  const [subScreen, setSubScreen] = useState<"sharedExpenses" | "reports" | "wealth" | "bills" | "paychecks" | "decisions" | "bankStream" | "recipes" | "profile" | "sharing" | "help" | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingHidden, setOnboardingHidden] = useState(false);
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

  // Android's Back button/gesture would otherwise exit the app from anywhere. Close a sub-screen first, then fall back
  // to Home, and only let Back leave the app once the user is already there. (iOS has no hardware Back; harmless there.)
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (subScreen) { setSubScreen(null); return true; }
      if (tab !== "home") { setTab("home"); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [subScreen, tab]);

  const save = useCallback(async (nextState: HouseholdState) => {
    // Web recomputes the month's budget income from paychecks on every render, so keep it in sync here too.
    const withIncome = nextState.paychecks ? { ...nextState, budget: { ...nextState.budget, income: budgetIncomeFromPaychecks(nextState) } } : nextState;
    // Savings goals with auto-contribute on keep accumulating as purchases/paychecks are recorded (web does this every render).
    const withBills = ensureRecurringExpensesPosted(withIncome, localDateKey(), uniqueId);
    const next = withGoalAutoContributions(repairChoreCompletion(ensureRecurringBudgetBills(withBills, localDateKey().slice(0, 7))), localDateKey());
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
    : subScreen === "help" ? <HelpScreen onBack={() => setSubScreen(null)} />
    : subScreen === "profile" ? <ProfileScreen user={user} onUserChange={setUser} onBack={() => setSubScreen(null)} />
    : subScreen === "sharing" ? <SharingScreen state={state} access={access} onSave={save} onRefreshAccess={async () => { try { setAccess(await api.householdAccess()); } catch { /* keep the last list */ } }} onBack={() => setSubScreen(null)} />
    : subScreen === "recipes" ? <Recipes state={state} onSave={save} onBack={() => setSubScreen(null)} />
    : subScreen === "decisions" ? <Decisions state={state} user={user} onSave={save} onBack={() => setSubScreen(null)} />
    : tab === "home" ? <Home state={state} user={user} privateData={activePrivateData} onSave={save} onSavePlans={savePlans} onGoTab={(next) => { setSubScreen(null); setTab(next); }} onOpenPaychecks={() => setSubScreen("paychecks")} />
    : tab === "budget" ? <Budget state={state} members={(access?.members || []).filter((member) => member.status === "active").map((member) => ({ name: member.name, email: member.email }))} onSave={save} onOpenPaychecks={() => setSubScreen("paychecks")} />
    : tab === "calendar" ? <Calendar state={state} access={access} user={user} onSave={save} />
    : tab === "notes" ? <Notes state={state} onSave={save} />
    : tab === "journal" ? <Journal privateData={activePrivateData} state={state} viewerEmail={user.email} onSave={saveJournal} />
    : tab === "plan" ? <Plan privateData={activePrivateData} onSave={savePlans} sinkingFundNames={(state.goals?.sinkingFunds || []).map((fund) => fund.name)} />
    : tab === "documents" ? <DocumentsScreen notes={state.notes.entries} wealthAssets={state.goals?.netWorth?.assets || []} wealthLiabilities={state.goals?.netWorth?.liabilities || []} viewerName={user.name} />
    : tab === "meals" ? <Meals state={state} onSave={save} onOpenRecipes={() => setSubScreen("recipes")} />
    : <More state={state} user={user} households={households} onSelect={async (id) => {
        await api.selectHousehold(id); setLoading(true); await loadWorkspace();
      }} onSignOut={async () => { await api.signOut(); setUser(null); setState(null); }}
      onOpenSharedExpenses={() => setSubScreen("sharedExpenses")} onOpenReports={() => setSubScreen("reports")}
      onOpenWealth={() => setSubScreen("wealth")} onOpenBills={() => setSubScreen("bills")} onOpenPaychecks={() => setSubScreen("paychecks")} onOpenDecisions={() => setSubScreen("decisions")} onOpenBankStream={() => setSubScreen("bankStream")} onOpenRecipes={() => setSubScreen("recipes")} onOpenProfile={() => setSubScreen("profile")} onOpenSharing={() => setSubScreen("sharing")} onOpenHelp={() => setSubScreen("help")} />;

  return <SafeAreaView style={styles.app} edges={["top", "left", "right"]}>
    <StatusBar style="dark" />
    <View style={styles.header}>
      <View><Text style={styles.brand}>FamilyLoop</Text><Text style={styles.household}>{selected?.name || state.household.name}</Text></View>
      <View style={styles.headerActions}>
        {saving ? <ActivityIndicator color={colors.green} /> : <View style={styles.saved}><Ionicons name="cloud-done-outline" size={18} color={colors.green} /><Text style={styles.savedText}>Saved</Text></View>}
        <Pressable accessibilityRole="button" accessibilityLabel="Search" hitSlop={10} style={styles.headerIcon} onPress={() => setSearchOpen(true)}><Ionicons name="search" size={22} color={colors.text} /></Pressable>
      </View>
    </View>
    {error ? <Pressable style={styles.error} onPress={() => setError("")}><Text style={styles.errorText}>{error}</Text></Pressable> : null}
    <View style={styles.page}>{page}</View>
    <GlobalSearchModal visible={searchOpen} state={state} onClose={() => setSearchOpen(false)} onPick={(target) => {
      setSearchOpen(false);
      if (target === "decisions") { setSubScreen("decisions"); return; }
      setSubScreen(null); setTab(target);
    }} />
    <OnboardingModal visible={!onboardingHidden && !searchOpen && shouldShowOnboarding(state)} step={onboardingStep}
      onDismiss={() => { setOnboardingStep(0); void save(dismissOnboarding(state)); }}
      onBack={() => setOnboardingStep((value) => Math.max(0, value - 1))}
      onSkipStep={() => setOnboardingStep((value) => Math.min(ONBOARDING_STEPS.length - 1, value + 1))}
      onOpen={(target) => {
        // Close the walkthrough so the screen is usable; it returns next launch until the household has some data or it is skipped.
        setOnboardingHidden(true);
        if (target === "home") { void save(dismissOnboarding(state)); setSubScreen(null); setTab("home"); }
        else if (target === "wealth" || target === "sharing") setSubScreen(target);
        else { setSubScreen(null); setTab(target); }
      }} />
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map((item) => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }} style={styles.tab} onPress={() => setTab(item.id)}>
        <Ionicons name={item.icon} size={23} color={tab === item.id ? colors.green : colors.muted} />
        <Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{item.label}</Text>
      </Pressable>)}
    </View>
  </SafeAreaView>;
}

// The recipe library: add/edit/delete, search by name or ingredient, filter by "planned this week", and sort. Rules live in
// src/mealsLogic.ts (names unique case-insensitively; editing renames planned meals; deleting unlinks them).
function Recipes({ state, onSave, onBack }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void>; onBack: () => void }) {
  const recipes = state.meals.recipes;
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", ingredients: "", calories: "400", protein: "20" });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RecipeFilter>("all");
  const [sortBy, setSortBy] = useState<RecipeSort>("name");
  const week = state.meals.selectedWeekByMonth?.[state.budget.month] ?? currentMealWeekNumber(state.budget.month);
  const weekMeals = state.meals.plannedWeek.filter((meal) => (!meal.month || meal.month === state.budget.month) && Number(meal.week || 1) === week);
  const planned = plannedRecipeIds(weekMeals);
  const visible = recipesFilteredSorted(recipes, planned, query, filter, sortBy);

  const openForm = (recipe?: Recipe) => {
    setEditingId(recipe?.id || null);
    setForm(recipe ? { name: recipe.name, ingredients: recipe.ingredients.join(", "), calories: String(recipe.calories), protein: String(recipe.protein) } : { name: "", ingredients: "", calories: "400", protein: "20" });
    setFormOpen(true);
  };
  const closeForm = () => { setFormOpen(false); setEditingId(null); };
  const submit = async () => {
    const problem = validateRecipe(recipes, form, editingId);
    if (problem) return Alert.alert("Check the recipe", problem);
    const next = saveRecipe(recipes, state.meals.plannedWeek, form, editingId, () => uniqueId(form.name));
    await onSave({ ...state, meals: { ...state.meals, recipes: next.recipes, plannedWeek: next.plannedWeek } });
    closeForm();
  };
  const confirmDelete = (recipe: Recipe) => {
    Alert.alert(`Delete "${recipe.name}"?`, "This removes the recipe from your library. Meals already planned with it keep their name but lose the link.", [
      { text: "Cancel" },
      { text: "Delete", style: "destructive", onPress: () => {
        const next = deleteRecipe(recipes, state.meals.plannedWeek, recipe.id);
        if (editingId === recipe.id) closeForm();
        void onSave({ ...state, meals: { ...state.meals, recipes: next.recipes, plannedWeek: next.plannedWeek } });
      } }
    ]);
  };
  const chip = (label: string, active: boolean, onPress: () => void) => <Pressable key={label} style={[styles.choice, active && styles.choiceActive]} onPress={onPress}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;

  return <Page>
    <SubScreenHeader title="Recipes" eyebrow="MEALS" onBack={onBack} />
    {formOpen ? <Card>
      <Text style={styles.cardTitle}>{editingId ? "Edit recipe" : "Add recipe"}</Text>
      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="Vegetable curry" />
      <Text style={styles.label}>Ingredients (comma separated)</Text>
      <TextInput style={styles.input} value={form.ingredients} onChangeText={(ingredients) => setForm({ ...form, ingredients })} placeholder="onion, tomato, lentils" autoCapitalize="none" />
      <View style={styles.actionRow}>
        <View style={{ flex: 1 }}><Text style={styles.label}>Calories</Text><TextInput style={styles.input} value={form.calories} onChangeText={(calories) => setForm({ ...form, calories })} keyboardType="number-pad" /></View>
        <View style={{ flex: 1 }}><Text style={styles.label}>Protein (g)</Text><TextInput style={styles.input} value={form.protein} onChangeText={(protein) => setForm({ ...form, protein })} keyboardType="number-pad" /></View>
      </View>
      <View style={styles.actionRow}>
        <Pressable style={[styles.secondarySmall, { flex: 1 }]} onPress={closeForm}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
        <Pressable style={[styles.primaryButton, { flex: 1, marginTop: 0 }]} onPress={() => void submit()}><Text style={styles.primaryButtonText}>{editingId ? "Update recipe" : "Add recipe"}</Text></Pressable>
      </View>
    </Card> : <Pressable style={styles.primaryButton} onPress={() => openForm()}><Text style={styles.primaryButtonText}>Add recipe</Text></Pressable>}
    {recipes.length ? <Card>
      <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Search recipes or ingredients" autoCapitalize="none" autoCorrect={false} />
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
        {chip("All", filter === "all", () => setFilter("all"))}{chip("In this week", filter === "planned", () => setFilter("planned"))}{chip("Not planned", filter === "unplanned", () => setFilter("unplanned"))}
      </ScrollView>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
        {chip("Sort: name", sortBy === "name", () => setSortBy("name"))}{chip("Highest protein", sortBy === "protein", () => setSortBy("protein"))}{chip("Highest calories", sortBy === "calories", () => setSortBy("calories"))}
      </ScrollView>
    </Card> : null}
    {recipes.length === 0 ? <Text style={styles.muted}>No recipes yet - add your first one above.</Text>
      : visible.length === 0 ? <Text style={styles.muted}>No recipes match.</Text>
      : visible.map((recipe) => <Card key={recipe.id}>
        <View style={styles.iouPersonHead}>
          <View style={styles.rowCopy}>
            <Text style={styles.cardTitle}>{recipe.name}{planned.has(recipe.id) ? "  (planned this week)" : ""}</Text>
            <Text style={styles.rowDetail}>{recipe.calories} cal · {recipe.protein}g protein</Text>
            <Text style={styles.muted}>{recipe.ingredients.slice(0, 6).join(", ")}{recipe.ingredients.length > 6 ? ` +${recipe.ingredients.length - 6}` : ""}</Text>
          </View>
          <Pressable accessibilityLabel={`Edit ${recipe.name}`} hitSlop={8} onPress={() => openForm(recipe)}><Ionicons name="create-outline" size={20} color={colors.text} /></Pressable>
          <Pressable accessibilityLabel={`Delete ${recipe.name}`} hitSlop={8} onPress={() => confirmDelete(recipe)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
        </View>
      </Card>)}
  </Page>;
}

// Name, email-verification status and password change (web's Profile page). The shared demo account cannot be edited.
function ProfileScreen({ user, onUserChange, onBack }: { user: User; onUserChange: (next: User) => void; onBack: () => void }) {
  const demo = isDemoAccount(user.email);
  const [name, setName] = useState(user.name);
  const [nameMessage, setNameMessage] = useState("");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordMessage, setPasswordMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const saveName = async () => {
    if (!name.trim()) return setNameMessage("Name cannot be blank.");
    setBusy(true);
    try { const updated = await api.updateProfile({ name: name.trim() }); onUserChange({ ...user, ...updated }); setNameMessage("Saved."); }
    catch (cause) { setNameMessage(cause instanceof Error ? cause.message : "Could not save"); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    try { const result = await api.resendVerification(); setVerifyMessage(result.message || "Verification email sent."); }
    catch (cause) { setVerifyMessage(cause instanceof Error ? cause.message : "Could not send"); }
  };
  const changePassword = async () => {
    const problem = validateNewPassword(passwords.current, passwords.next, passwords.confirm);
    if (problem) return setPasswordMessage(problem);
    setBusy(true);
    try { await api.updateProfile({ currentPassword: passwords.current, newPassword: passwords.next }); setPasswords({ current: "", next: "", confirm: "" }); setPasswordMessage("Password updated."); }
    catch (cause) { setPasswordMessage(cause instanceof Error ? cause.message : "Could not update password"); }
    finally { setBusy(false); }
  };

  return <Page>
    <SubScreenHeader title="Profile" eyebrow="ACCOUNT" onBack={onBack} />
    {demo ? <Card><Text style={styles.muted}>The demo account is shared by every visitor, so its name and password can't be changed.</Text></Card> : <>
      <Card>
        <Text style={styles.cardTitle}>Your profile</Text>
        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} />
        <Text style={styles.label}>Email</Text>
        <Text style={styles.rowDetail}>{user.email}</Text>
        <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void saveName()}><Text style={styles.primaryButtonText}>Save name</Text></Pressable>
        {nameMessage ? <Text style={styles.muted}>{nameMessage}</Text> : null}
        {user.emailVerified ? <Text style={styles.successText}>Email verified</Text> : <>
          <Text style={styles.muted}>Email not verified yet.</Text>
          <Pressable style={styles.secondarySmall} onPress={() => void resend()}><Text style={styles.secondaryButtonText}>Resend verification email</Text></Pressable>
        </>}
        {verifyMessage ? <Text style={styles.muted}>{verifyMessage}</Text> : null}
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Change password</Text>
        <TextInput style={styles.input} value={passwords.current} onChangeText={(current) => setPasswords({ ...passwords, current })} placeholder="Current password" secureTextEntry autoComplete="current-password" autoCapitalize="none" />
        <TextInput style={styles.input} value={passwords.next} onChangeText={(next) => setPasswords({ ...passwords, next })} placeholder="New password (8+ characters)" secureTextEntry autoComplete="new-password" autoCapitalize="none" />
        <TextInput style={styles.input} value={passwords.confirm} onChangeText={(confirm) => setPasswords({ ...passwords, confirm })} placeholder="Confirm new password" secureTextEntry autoComplete="new-password" autoCapitalize="none" />
        <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void changePassword()}><Text style={styles.primaryButtonText}>Update password</Text></Pressable>
        {passwordMessage ? <Text style={styles.muted}>{passwordMessage}</Text> : null}
      </Card>
    </>}
  </Page>;
}

// Household members, invitations, per-member edit/view access, revoking, and which areas are shared (web's Sharing page).
// Only the household owner can manage members (access.canManage); everyone else sees the list read-only.
function SharingScreen({ state, access, onSave, onRefreshAccess, onBack }: { state: HouseholdState; access: HouseholdAccess | null; onSave: (next: HouseholdState) => Promise<void>; onRefreshAccess: () => Promise<void>; onBack: () => void }) {
  const [inviteName, setInviteName] = useState(""); const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState(ACCESS_ROLES[1] || "Member");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = Boolean(access?.canManage);
  const members = access?.members || (state.household.members || []).map((member, index) => ({ ...member, status: member.role.includes("Invited") ? "pending" : "active", isOwner: index === 0 }));
  const scopes = sharedScopesOf(state);

  const sendInvite = async () => {
    const name = inviteName.trim(); const email = inviteEmail.trim();
    if (!name || !email) return setStatus("Enter their name and email.");
    setBusy(true); setStatus("Sending invitation...");
    try {
      const result = await api.inviteMember({ name, email, role: inviteRole, scopes });
      const invitations = result.invitations || (result.invitation ? [result.invitation] : []);
      const current = invitations.find((item) => item.householdName === state.household.name) || invitations[0];
      if (current) await onSave(recordInvitation(state, current));
      setStatus(emailOutcomeMessage(result.email, email, "invite"));
      setInviteName(""); setInviteEmail("");
      await onRefreshAccess();
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Could not send the invitation"); }
    finally { setBusy(false); }
  };
  const changeLevel = async (email: string, level: "edit" | "view") => {
    setBusy(true);
    try { await api.setMemberAccessLevel(email, level); await onSave(recordAccessLevel(state, email, level)); await onRefreshAccess(); }
    catch (cause) { setStatus(cause instanceof Error ? cause.message : "Could not change access"); }
    finally { setBusy(false); }
  };
  const revoke = (email: string) => Alert.alert("Revoke access?", `${email} will lose access to this household.`, [{ text: "Cancel" }, { text: "Revoke", style: "destructive", onPress: () => void (async () => {
    setBusy(true);
    try { const result = await api.revokeMemberAccess(email); await onSave(recordRevoked(state, email)); setStatus(emailOutcomeMessage(result.email, email, "revoke")); await onRefreshAccess(); }
    catch (cause) { setStatus(cause instanceof Error ? cause.message : "Could not revoke access"); }
    finally { setBusy(false); }
  })() }]);

  return <Page>
    <SubScreenHeader title="Sharing" eyebrow="HOUSEHOLD" onBack={onBack} />
    <Card>
      <Text style={styles.cardTitle}>{state.household.name}</Text>
      {members.map((member) => <View key={member.email} style={styles.householdRow}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{member.name}</Text>
          <Text style={styles.rowDetail}>{member.email}</Text>
          <Text style={styles.rowDetail}>{member.role} · {member.status === "pending" ? "Invited" : "Active"}{member.isOwner ? " · Owner" : ""}</Text>
          {canManage && !member.isOwner && member.status === "active" ? <View style={styles.choiceRow}>
            {(["edit", "view"] as const).map((level) => <Pressable key={level} disabled={busy} style={[styles.choice, ((("accessLevel" in member && member.accessLevel) || "edit") === level) && styles.choiceActive]} onPress={() => void changeLevel(member.email, level)}>
              <Text style={[styles.choiceText, ((("accessLevel" in member && member.accessLevel) || "edit") === level) && styles.choiceTextActive]}>{level === "edit" ? "Can edit" : "View only"}</Text>
            </Pressable>)}
          </View> : null}
        </View>
        {canManage && !member.isOwner ? <Pressable accessibilityLabel={`Revoke access for ${member.name}`} hitSlop={8} onPress={() => revoke(member.email)}><Ionicons name="person-remove-outline" size={20} color={colors.coral} /></Pressable> : null}
      </View>)}
    </Card>
    {canManage ? <Card>
      <Text style={styles.cardTitle}>Invite someone</Text>
      <TextInput style={styles.input} value={inviteName} onChangeText={setInviteName} placeholder="Name" />
      <TextInput style={styles.input} value={inviteEmail} onChangeText={setInviteEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
      <Text style={styles.label}>Access</Text>
      <View style={styles.choiceRow}>{ACCESS_ROLES.map((role) => <Pressable key={role} style={[styles.choice, inviteRole === role && styles.choiceActive]} onPress={() => setInviteRole(role)}><Text style={[styles.choiceText, inviteRole === role && styles.choiceTextActive]}>{role}</Text></Pressable>)}</View>
      <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void sendInvite()}><Text style={styles.primaryButtonText}>Send invite</Text></Pressable>
    </Card> : <Text style={styles.muted}>Only the household owner can invite people or change access.</Text>}
    {status ? <Text style={styles.muted}>{status}</Text> : null}
    <Card>
      <Text style={styles.cardTitle}>Shared areas</Text>
      <Text style={styles.muted}>Choose which areas invited members can use.</Text>
      <View style={styles.checkRow}>
        <Text style={[styles.rowTitle, { flex: 1 }]}>Share everything</Text>
        <Pressable disabled={!canManage} onPress={() => void onSave(setShareEverything(state, !allScopesShared(state)))}><Ionicons name={allScopesShared(state) ? "checkbox" : "square-outline"} size={24} color={canManage ? colors.green : colors.border} /></Pressable>
      </View>
      {ALL_SCOPES.map((scope) => <View key={scope} style={styles.checkRow}>
        <Text style={[styles.rowDetail, { flex: 1 }]}>{scope}</Text>
        <Pressable disabled={!canManage} onPress={() => void onSave(toggleScope(state, scope))}><Ionicons name={scopes.includes(scope) ? "checkbox" : "square-outline"} size={22} color={canManage ? colors.green : colors.border} /></Pressable>
      </View>)}
    </Card>
  </Page>;
}

// A short in-app guide (condensed from web's Help page); tap a topic to expand it.
function HelpScreen({ onBack }: { onBack: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return <Page>
    <SubScreenHeader title="Help" eyebrow="GUIDES" onBack={onBack} />
    {HELP_GUIDES.map((guide) => {
      const open = openId === guide.id;
      return <Card key={guide.id}>
        <Pressable style={styles.iouPersonHead} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpenId(open ? null : guide.id)}>
          <Text style={styles.cardTitle}>{guide.title}</Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />
        </Pressable>
        {open ? <View>
          {guide.steps.map((step, index) => <Text key={index} style={styles.noteBody}>{index + 1}. {step}</Text>)}
          {guide.tips.map((tip, index) => <Text key={`tip-${index}`} style={styles.muted}>Tip: {tip}</Text>)}
        </View> : null}
      </Card>;
    })}
  </Page>;
}

// Global search across transactions, notes, documents and decisions (web's search dialog). Documents are not part of the
// household state, so they are fetched once the first time the overlay opens.
function GlobalSearchModal({ visible, state, onClose, onPick }: { visible: boolean; state: HouseholdState; onClose: () => void; onPick: (target: SearchResult["target"]) => void }) {
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState<Array<{ name: string }> | null>(null);
  useEffect(() => {
    if (!visible) return;
    setQuery("");
    if (documents) return;
    let cancelled = false;
    api.documents().then((data) => { if (!cancelled) setDocuments(data.documents || []); }).catch(() => { if (!cancelled) setDocuments([]); });
    return () => { cancelled = true; };
  }, [visible]);
  const results = useMemo(() => globalSearchResults(state, documents || [], query), [state, documents, query]);
  const trimmed = query.trim();
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.app} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={colors.muted} />
        <TextInput style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Search transactions, notes, documents, decisions" autoFocus autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
        <Pressable accessibilityRole="button" accessibilityLabel="Close search" hitSlop={10} onPress={onClose}><Text style={styles.searchClose}>Close</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {trimmed.length < 2 ? <Text style={styles.muted}>Type at least 2 characters to search.</Text>
          : results.length === 0 ? <Text style={styles.muted}>No matches for "{trimmed}".</Text>
          : results.map((result, index) => <Pressable key={`${result.type}-${index}`} style={styles.searchResult} onPress={() => onPick(result.target)}>
            <Text style={styles.searchResultTitle}>{result.title}</Text>
            <Text style={styles.muted}>{result.type} · {result.detail}</Text>
          </Pressable>)}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

// First-run walkthrough for a brand-new household; dismissing (or finishing) is stored in state.onboarding so it never returns.
function OnboardingModal({ visible, step, onDismiss, onBack, onSkipStep, onOpen }: { visible: boolean; step: number; onDismiss: () => void; onBack: () => void; onSkipStep: () => void; onOpen: (target: "wealth" | "budget" | "sharing" | "home") => void }) {
  const current = ONBOARDING_STEPS[Math.min(step, ONBOARDING_STEPS.length - 1)];
  if (!current) return null;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
    <View style={styles.onboardingBackdrop}>
      <View style={styles.onboardingCard}>
        <Text style={styles.eyebrow}>GETTING STARTED · STEP {step + 1} OF {ONBOARDING_STEPS.length}</Text>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.muted}>{current.body}</Text>
        <Pressable style={styles.primaryButton} onPress={() => onOpen(current.target)}><Text style={styles.primaryButtonText}>{current.cta}</Text></Pressable>
        <View style={styles.onboardingActions}>
          {step > 0 ? <Pressable style={[styles.secondaryButton, styles.onboardingAction]} onPress={onBack}><Text style={styles.secondaryButtonText}>Back</Text></Pressable> : null}
          {step < ONBOARDING_STEPS.length - 1 ? <Pressable style={[styles.secondaryButton, styles.onboardingAction]} onPress={onSkipStep}><Text style={styles.secondaryButtonText}>Next</Text></Pressable> : null}
          <Pressable style={[styles.secondaryButton, styles.onboardingAction]} onPress={onDismiss}><Text style={styles.secondaryButtonText}>Don't show again</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
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
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} /> : undefined}>{children}</ScrollView>;
}
function Title({ eyebrow, children }: React.PropsWithChildren<{ eyebrow: string }>) { return <View style={styles.titleBlock}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{children}</Text></View>; }
function Card({ children }: React.PropsWithChildren) { return <View style={styles.card}>{children}</View>; }
function Metric({ label, value, accent = colors.green }: { label: string; value: string; accent?: string }) { return <View style={[styles.metric, { borderTopColor: accent }]}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function Centered({ children }: React.PropsWithChildren) { return <SafeAreaView style={styles.centered}>{children}</SafeAreaView>; }

function Home({ state, user, privateData, onSave, onSavePlans, onGoTab, onOpenPaychecks }: { state: HouseholdState; user: User; privateData: PrivateData; onSave: (next: HouseholdState) => Promise<void>; onSavePlans: (plans: PrivateData["plans"]) => Promise<void>; onGoTab: (tab: Tab) => void; onOpenPaychecks: () => void }) {
  const currency = state.household.currency;
  const planned = state.budget.categories.flatMap((c) => c.lines).reduce((sum, line) => sum + Number(line.planned || 0), 0);
  const spent = state.transactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const today = localDateKey();
  const spentOf = (lineId: string) => spentByLineInMonth(state.transactions, lineId, state.budget.month);
  const dismissed = state.budget.dismissedReminders?.[state.budget.month] || [];
  const bills = state.budget.categories.flatMap((category) => category.lines)
    .filter((line) => line.dueDay)
    .map((line) => ({ name: line.name, dueDay: Number(line.dueDay), paid: spentOf(line.id) >= Number(line.planned || 0) || dismissed.includes(`bill:${line.id}`) }));
  const actionItems = homeActionItems(state.calendar, user.email, today);
  const weekStrip = homeWeekStrip(state.calendar, user.email, bills);
  const planTasks = privateData.plans.tasks
    .filter((task) => task.bucket === "daily" && dailyTaskOccursOnDate(task, today))
    .map((task) => ({ task, done: isDailyTaskDoneOnDate(task, today) }))
    .sort((a, b) => (a.task.startTime ? timeToMinutes(a.task.startTime) ?? Infinity : Infinity) - (b.task.startTime ? timeToMinutes(b.task.startTime) ?? Infinity : Infinity));
  const funding = billAndGoalReminders(state, spentOf);
  const noteReminders = homeNoteReminders(state.notes.entries, today);
  const activity = homeRecentActivity(state);

  const completeItem = async (item: HomeActionItem) => {
    const next = structuredClone(state);
    if (item.kind === "chore") {
      const chore = next.calendar.chores[item.index];
      const key = chore ? completionKeyFor(effectiveAssignees(chore), user.email) : null;
      if (!chore || !key) return;
      next.calendar.chores[item.index] = toggleChoreCompletion(chore, item.occurrence, key);
    } else if (item.kind === "annual") {
      const event = next.calendar.events[item.index];
      if (!event || item.year === undefined) return;
      next.calendar.events[item.index] = toggleAnnualWished(event, item.year, user.email);
    } else {
      const event = next.calendar.events[item.index];
      const updated = event ? toggleReminderCompletion(event, user.email) : null;
      if (!updated) return;
      next.calendar.events[item.index] = updated;
    }
    await onSave(next);
  };
  const canComplete = (item: HomeActionItem): boolean => {
    const holder = item.kind === "chore" ? state.calendar.chores[item.index] : state.calendar.events[item.index];
    return Boolean(holder) && completionKeyFor(effectiveAssignees(holder as { assignees?: Array<{ key: string }> }), user.email) !== null;
  };
  const togglePlanTask = async (taskId: string) => {
    await onSavePlans({ ...privateData.plans, tasks: privateData.plans.tasks.map((task) => task.id === taskId ? toggleDailyTaskDoneOnDate(task, today) : task) });
  };

  return <Page><Title eyebrow="HOUSEHOLD">Today</Title>
    <Card>
      <Text style={styles.cardTitle}>Quick add</Text>
      <View style={styles.choiceRow}>
        <Pressable style={styles.choice} onPress={() => onGoTab("calendar")}><Text style={styles.choiceText}>+ Chore / reminder</Text></Pressable>
        <Pressable style={styles.choice} onPress={() => onGoTab("calendar")}><Text style={styles.choiceText}>+ Birthday</Text></Pressable>
        <Pressable style={styles.choice} onPress={() => onGoTab("budget")}><Text style={styles.choiceText}>+ Transaction</Text></Pressable>
        <Pressable style={styles.choice} onPress={onOpenPaychecks}><Text style={styles.choiceText}>+ Income</Text></Pressable>
      </View>
    </Card>
    <Card>
      <Text style={styles.cardTitle}>This week</Text>
      {weekStrip.map((day) => <View key={day.dateKey} style={styles.row}>
        <Text style={[styles.rowTitle, { width: 64 }, day.dateKey === today && { color: colors.green }]}>{day.label}</Text>
        <View style={styles.rowCopy}>{day.items.length ? day.items.map((item, index) => <Text key={index} style={styles.rowDetail}>{item.icon} {item.title}</Text>) : <Text style={styles.muted}>—</Text>}</View>
      </View>)}
    </Card>
    <Card>
      <Text style={styles.cardTitle}>Action needed</Text>
      {actionItems.length ? actionItems.map((item) => <View key={`${item.kind}-${item.index}-${item.occurrence}`} style={styles.row}>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={[styles.rowDetail, item.overdue && { color: colors.coral }]}>{item.label} · {item.overdue ? "Past due" : "Due today"} · {item.detail}</Text>
        </View>
        {canComplete(item) ? <Pressable style={styles.secondarySmall} onPress={() => void completeItem(item)}><Text style={styles.secondaryButtonText}>Mark done</Text></Pressable> : null}
      </View>) : <Text style={styles.muted}>Nothing past due or due today — you're all caught up.</Text>}
    </Card>
    <Card>
      <View style={styles.iouPersonHead}><Text style={styles.cardTitle}>Today's plan</Text><Pressable onPress={() => onGoTab("plan")}><Text style={[styles.secondaryButtonText, { color: colors.green }]}>Open Plan</Text></Pressable></View>
      <Text style={styles.muted}>Private to you.</Text>
      {planTasks.length ? planTasks.map(({ task, done }) => <Pressable key={task.id} style={styles.checkRow} onPress={() => void togglePlanTask(task.id)} accessibilityRole="checkbox" accessibilityState={{ checked: done }}>
        <Ionicons name={done ? "checkbox" : "square-outline"} size={22} color={done ? colors.green : colors.muted} />
        <View style={styles.rowCopy}><Text style={[styles.rowTitle, done && { textDecorationLine: "line-through", color: colors.muted }]}>{task.title}</Text>{task.startTime ? <Text style={styles.rowDetail}>{task.startTime}</Text> : null}</View>
      </Pressable>) : <Text style={styles.muted}>No plan tasks for today.</Text>}
    </Card>
    {funding.length ? <Card>
      <Text style={styles.cardTitle}>Bills & goals</Text>
      {funding.map((reminder) => <View key={reminder.id} style={styles.row}>
        <View style={styles.rowCopy}><Text style={styles.rowTitle}>{reminder.title}</Text><Text style={styles.rowDetail}>{money(reminder.amount, currency)} {reminder.kind === "bill" ? "left" : "remaining"}{reminder.detail ? ` · ${reminder.detail}` : ""}</Text></View>
        <Pressable style={styles.secondarySmall} onPress={() => void onSave(dismissBudgetReminder(state, reminder.id))}><Text style={styles.secondaryButtonText}>Done</Text></Pressable>
      </View>)}
    </Card> : null}
    {noteReminders.length ? <Card>
      <View style={styles.iouPersonHead}><Text style={styles.cardTitle}>Note reminders due</Text><Pressable onPress={() => onGoTab("notes")}><Text style={[styles.secondaryButtonText, { color: colors.green }]}>Open Notes</Text></Pressable></View>
      {noteReminders.map((note) => <Row key={note.id} title={note.title} detail={`${note.overdue ? "Past due" : "Due today"} · ${note.reminder.replace("T", " ")}`} />)}
    </Card> : null}
    {activity.length ? <Card>
      <Text style={styles.cardTitle}>Recent activity</Text>
      {activity.map((entry, index) => <Row key={`${entry.at}-${index}`} title={`${entry.icon} ${entry.title}`} detail={`${entry.detail} · ${String(entry.at).slice(0, 10)}`} />)}
    </Card> : null}
    <View style={styles.metricGrid}>
      <Metric label="Available" value={money(state.budget.income - planned, currency)} />
      <Metric label="Spent" value={money(spent, currency)} accent={colors.blue} />
      <Metric label="Upcoming" value={String(state.calendar.events.length + state.calendar.chores.length)} accent={colors.gold} />
      <Metric label="Recipes" value={String(state.meals.recipes.length)} accent={colors.coral} />
    </View>
    <Card><Text style={styles.cardTitle}>Recent transactions</Text>{state.transactions.slice(-4).reverse().map((item, index) => <Row key={`${item.date}-${item.payee}-${index}`} title={item.payee} detail={item.date} value={money(item.amount, currency)} />)}</Card></Page>;
}

// A row's tags as removable chips plus a "+ Add tag" box (comma-separated, duplicates ignored case-insensitively) and
// one-tap suggestions from tags already used elsewhere - the phone stand-in for web's autocomplete list. Used on both
// bank-stream rows and ledger rows; the caller decides how a change is saved. A tag is committed when the box loses focus
// or Return is pressed (React Native fires onEndEditing for both).
function TagChips({ tags, suggestions, onChange }: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState("");
  const commit = (value: string) => {
    const next = addTagsDeduped(tags, value);
    setText("");
    if (next.length !== tags.length) onChange(next);
  };
  return <View>
    <View style={styles.choiceRow}>
      {tags.map((tag) => <Pressable key={tag} style={styles.tagChip} onPress={() => onChange(removeTag(tags, tag))} accessibilityLabel={`Remove tag ${tag}`}>
        <Text style={styles.tagChipText}>{tag}  ×</Text>
      </Pressable>)}
      <TextInput style={styles.tagInput} value={text} onChangeText={setText} placeholder="+ Add tag" returnKeyType="done" autoCapitalize="none" onEndEditing={(event) => commit(event.nativeEvent.text)} />
    </View>
    {suggestions.length ? <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
      {suggestions.map((tag) => <Pressable key={tag} style={styles.choice} onPress={() => commit(tag)}><Text style={styles.choiceText}>+ {tag}</Text></Pressable>)}
    </ScrollView> : null}
  </View>;
}

function Budget({ state, members, onSave, onOpenPaychecks }: { state: HouseholdState; members: Array<{ name: string; email: string }>; onSave: (next: HouseholdState) => Promise<void>; onOpenPaychecks: () => void }) {
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
  const [memberFilter, setMemberFilter] = useState("all");
  const [lineOwner, setLineOwner] = useState("");
  const [txRepeat, setTxRepeat] = useState<"none" | RecurringRepeat>("none");
  const [txEndDate, setTxEndDate] = useState("");
  const [editingRecurringId, setEditingRecurringId] = useState<string | null>(null);
  const [recPayee, setRecPayee] = useState(""); const [recAmount, setRecAmount] = useState(""); const [recRepeat, setRecRepeat] = useState<RecurringRepeat>("monthly");
  const [recEnd, setRecEnd] = useState(""); const [recLineId, setRecLineId] = useState(""); const [recAccountId, setRecAccountId] = useState("");
  const [ledgerSort, setLedgerSort] = useState<{ field: LedgerSortField; direction: "asc" | "desc" }>({ field: "date", direction: "desc" });
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTx, setSelectedTx] = useState<number[]>([]);
  const [bulkLineId, setBulkLineId] = useState("");
  const [friendSplitIndex, setFriendSplitIndex] = useState<number | null>(null);
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  const [splitRows, setSplitRows] = useState<Array<{ lineId: string; amount: string }>>([]);

  const editingSplit = editingTxIndex !== null && Boolean(state.transactions[editingTxIndex]?.splits?.length);
  // The picked category can disappear (deleted line) - fall back to the first remaining one.
  useEffect(() => { if (!allLines.some((line) => line.id === txLineId)) setTxLineId(allLines[0]?.id || ""); }, [allLines.map((line) => line.id).join("|")]);

  const beginLineEdit = (line: BudgetLine) => { setEditingLineId(line.id); setLineOwner(line.ownerId || ""); setLineName(line.name); setLinePlanned(String(line.planned ?? 0)); setLineDueDay(line.dueDay ? String(line.dueDay) : ""); };
  const saveLineEdit = async () => {
    if (!editingLineId) return;
    if (!lineName.trim()) return Alert.alert("Missing info", "Enter a name.");
    const dueDay = lineDueDay.trim() ? Math.round(Number(lineDueDay)) : null;
    if (dueDay !== null && !(dueDay >= 1 && dueDay <= 31)) return Alert.alert("Invalid due day", "Enter a day of the month from 1 to 31, or leave it blank.");
    await onSave(updateLine(state, editingLineId, { name: lineName.trim(), planned: Math.max(0, Number(linePlanned) || 0), dueDay, ownerId: lineOwner || null }));
    setEditingLineId(null);
  };

  // Month switching: the month being left is frozen into the budget history, planned amounts carry forward (or come back from
  // that month's own saved plan), and a line with "carry unspent forward" adds last month's leftover the first time a new month opens.
  const spentInMonth = (lineId: string, monthKey: string) => spentByLineInMonth(state.transactions, lineId, monthKey);
  const goToMonth = (monthKey: string) => { void onSave(switchBudgetMonth(state, monthKey, spentInMonth)); setEditingLineId(null); };
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const previousBudgets = availablePreviousBudgets(state);
  const confirmCopy = (month: string) => {
    Alert.alert(`Copy ${formatMonthLabel(month)}'s budget?`, `This replaces ${formatMonthLabel(state.budget.month)}'s planned amounts with ${formatMonthLabel(month)}'s. It can't be undone.`, [{ text: "Cancel" }, {
      text: "Replace", style: "destructive", onPress: () => { void onSave(copyBudgetFromMonth(state, month)); setShowCopyPicker(false); }
    }]);
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

  const resetTxForm = () => { setEditingTxIndex(null); setTxPayee(""); setTxAmount(""); setTxDate(todayKey()); setTxAccountId(""); setTxTags(""); setTxRepeat("none"); setTxEndDate(""); };
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
    const input = { date: txDate, payee: txPayee.trim(), amount, lineId: txLineId, accountId: txAccountId, tags: addTagsDeduped([], txTags) };
    if (editingTxIndex === null && txRepeat !== "none") {
      if (txEndDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(txEndDate.trim())) return Alert.alert("Invalid end date", "Use the format YYYY-MM-DD, or leave it blank.");
      // The bill becomes a rule; each period that has come due appears in Bank stream for review (the shared save posts them).
      await onSave(addRecurringExpense(state, { payee: input.payee, amount, lineId: txLineId, accountId: txAccountId, recurrence: txRepeat, anchorDate: txDate, endDate: txEndDate.trim() }, uniqueId));
      Alert.alert("Recurring bill added", "Each time it comes due it will show up in Bank stream for you to review and accept.");
      resetTxForm();
      return;
    }
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

  const orderedTransactions = sortLedgerEntries(state.transactions.map((item, index) => ({ item, index })), ledgerSort.field, ledgerSort.direction, {
    category: (transaction) => transactionAssignmentLabel(state, transaction),
    account: (transaction) => (state.accounts || []).find((account) => account.id === transaction.accountId)?.name || ""
  });
  const toggleLedgerSort = (field: LedgerSortField) => setLedgerSort((prev) => prev.field === field ? { field, direction: prev.direction === "asc" ? "desc" : "asc" } : { field, direction: field === "date" ? "desc" : "asc" });
  const toggleSelected = (index: number) => setSelectedTx((prev) => prev.includes(index) ? prev.filter((value) => value !== index) : [...prev, index]);
  const endSelect = () => { setSelectMode(false); setSelectedTx([]); setBulkLineId(""); };
  const applyBulkLine = async () => {
    if (!bulkLineId || !selectedTx.length) return;
    const result = applyLineToTransactions(state, selectedTx, bulkLineId);
    if (result.applied) await onSave(result.state);
    endSelect();
    if (result.skippedSplit) Alert.alert("Some rows were skipped", `${result.skippedSplit} split transaction${result.skippedSplit === 1 ? " was" : "s were"} left alone - a split has its own categories (edit it with the scissors button).`);
  };
  const visibleTransactions = showAllTx ? orderedTransactions : orderedTransactions.slice(0, 15);
  const accountName = (id?: string) => (state.accounts || []).find((account) => account.id === id)?.name;

  return <Page><Title eyebrow="BUDGET">{formatMonthLabel(state.budget.month)}</Title>
    <View style={styles.dayNavRow}>
      <Pressable style={styles.planStepperButton} onPress={() => goToMonth(shiftMonthKey(state.budget.month, -1))} accessibilityLabel="Previous month"><Ionicons name="chevron-back" size={18} color={colors.text} /></Pressable>
      <Pressable style={styles.dayNavLabel} onPress={() => goToMonth(localDateKey().slice(0, 7))}><Text style={styles.rowTitle}>{state.budget.month === localDateKey().slice(0, 7) ? "This month" : "Jump to this month"}</Text></Pressable>
      <Pressable style={styles.planStepperButton} onPress={() => goToMonth(shiftMonthKey(state.budget.month, 1))} accessibilityLabel="Next month"><Ionicons name="chevron-forward" size={18} color={colors.text} /></Pressable>
    </View>
    {previousBudgets.length ? <View>
      <Pressable style={styles.secondarySmall} onPress={() => setShowCopyPicker((prev) => !prev)}><Text style={styles.secondaryButtonText}>Copy planned amounts from an earlier month</Text></Pressable>
      {showCopyPicker ? <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{previousBudgets.map((entry) => <Pressable key={entry.month} style={styles.choice} onPress={() => confirmCopy(entry.month)}><Text style={styles.choiceText}>{formatMonthLabel(entry.month)}</Text></Pressable>)}</ScrollView> : null}
    </View> : null}
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
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{allLines.map((line) => <Pressable key={line.id} style={[styles.choice, txLineId === line.id && styles.choiceActive]} onPress={() => setTxLineId(line.id)}><Text style={[styles.choiceText, txLineId === line.id && styles.choiceTextActive]}>{line.category} · {line.name}</Text></Pressable>)}</ScrollView>
        </>}
      {accounts.length ? <>
        <Text style={styles.label}>Account (optional)</Text>
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
          <Pressable style={[styles.choice, !txAccountId && styles.choiceActive]} onPress={() => setTxAccountId("")}><Text style={[styles.choiceText, !txAccountId && styles.choiceTextActive]}>None</Text></Pressable>
          {accounts.map((account) => <Pressable key={account.id} style={[styles.choice, txAccountId === account.id && styles.choiceActive]} onPress={() => setTxAccountId(account.id)}><Text style={[styles.choiceText, txAccountId === account.id && styles.choiceTextActive]}>{account.name}</Text></Pressable>)}
        </ScrollView>
      </> : null}
      <TextInput style={styles.input} value={txTags} onChangeText={setTxTags} placeholder="Tags (comma separated, optional)" />
      {editingTxIndex === null ? <>
        <Text style={styles.label}>Repeats</Text>
        <View style={styles.choiceRow}>{(["none", "weekly", "biweekly", "monthly"] as const).map((value) => <Pressable key={value} style={[styles.choice, txRepeat === value && styles.choiceActive]} onPress={() => setTxRepeat(value)}><Text style={[styles.choiceText, txRepeat === value && styles.choiceTextActive]}>{value === "none" ? "Doesn't repeat" : RECURRING_REPEAT_LABELS[value]}</Text></Pressable>)}</View>
        {txRepeat !== "none" ? <TextInput style={styles.input} value={txEndDate} onChangeText={setTxEndDate} placeholder="Stop repeating after (YYYY-MM-DD, optional)" /> : null}
      </> : null}
      <View style={styles.actionRow}>
        <Pressable style={styles.primaryButton} onPress={() => void submitTransaction()}><Text style={styles.primaryButtonText}>{editingTxIndex !== null ? "Save changes" : "Add transaction"}</Text></Pressable>
        {editingTxIndex !== null ? <Pressable style={styles.secondarySmall} onPress={resetTxForm}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable> : null}
      </View>
    </Card>

    {splitTransaction && splitIndex !== null ? <Card>
      <View style={styles.iouPersonHead}><Text style={styles.cardTitle}>Split {splitTransaction.payee}</Text><Text style={styles.rowValue}>{money(Number(splitTransaction.amount), currency)}</Text></View>
      <Text style={styles.muted}>Divide this transaction across categories. The amounts must add up to the total.</Text>
      {splitRows.map((row, rowIndex) => <View key={rowIndex} style={styles.planTaskBlock}>
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{allLines.map((line) => <Pressable key={line.id} style={[styles.choice, row.lineId === line.id && styles.choiceActive]} onPress={() => setSplitRows((prev) => prev.map((item, itemIndex) => itemIndex === rowIndex ? { ...item, lineId: line.id } : item))}><Text style={[styles.choiceText, row.lineId === line.id && styles.choiceTextActive]}>{line.category} · {line.name}</Text></Pressable>)}</ScrollView>
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
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
        <Pressable style={styles.choice} onPress={() => void confirmPendingDelete("")}><Text style={styles.choiceText}>Leave unassigned</Text></Pressable>
        {allLines.filter((line) => !pendingDelete.lineIds.includes(line.id)).map((line) => <Pressable key={line.id} style={styles.choice} onPress={() => void confirmPendingDelete(line.id)}><Text style={styles.choiceText}>{line.category} · {line.name}</Text></Pressable>)}
      </ScrollView>
      <Pressable style={styles.secondarySmall} onPress={() => setPendingDelete(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
    </Card> : null}

    {members.length ? <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
      <Pressable style={[styles.choice, memberFilter === "all" && styles.choiceActive]} onPress={() => setMemberFilter("all")}><Text style={[styles.choiceText, memberFilter === "all" && styles.choiceTextActive]}>Everyone</Text></Pressable>
      {members.map((member) => <Pressable key={member.email} style={[styles.choice, memberFilter === member.email && styles.choiceActive]} onPress={() => setMemberFilter(member.email)}><Text style={[styles.choiceText, memberFilter === member.email && styles.choiceTextActive]}>{member.name}</Text></Pressable>)}
    </ScrollView> : null}
    {filterCategoriesByOwner(state.budget.categories, memberFilter).map((category) => { const categoryIndex = state.budget.categories.findIndex((item) => item.name === category.name); return <Card key={category.name}>
      <View style={styles.categoryHeader}>
        <View style={[styles.dot, { backgroundColor: category.color }]} /><Text style={[styles.cardTitle, { flex: 1 }]}>{category.name}</Text>
        <Pressable onPress={() => requestDelete(`Remove ${category.name}?`, category.lines.map((line) => line.id), categoryIndex)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>
      {category.lines.map((line) => {
        const spent = spentByLineInMonth(state.transactions, line.id, state.budget.month);
        const recurring = line.recurringBill?.enabled ? recurringBudgetSetAside(line.recurringBill, state.budget.month) : null;
        const baseDetail = recurring
          ? `${recurring.frequency} · due ${recurring.nextDueDate} · set aside ${money(recurring.monthlyAmount, currency)}/mo`
          : line.dueDay ? `Due day ${line.dueDay}` : "No due date";
        const ownerName = line.ownerId ? members.find((member) => member.email === line.ownerId)?.name || line.ownerId : "";
        const detail = [Number(line.rolloverAmount || 0) > 0 ? `${baseDetail} · +${money(Number(line.rolloverAmount), currency)} rolled over` : baseDetail, ownerName].filter(Boolean).join(" · ");
        if (editingLineId === line.id) {
          return <View key={line.id} style={styles.planTaskBlock}>
            <TextInput style={styles.input} value={lineName} onChangeText={setLineName} placeholder="Subcategory name" />
            <View style={styles.actionRow}>
              <TextInput style={[styles.input, { flex: 1 }]} value={linePlanned} onChangeText={setLinePlanned} placeholder="Planned amount" keyboardType="decimal-pad" editable={!recurring} />
              <TextInput style={[styles.input, { flex: 1 }]} value={lineDueDay} onChangeText={setLineDueDay} placeholder="Due day (1-31)" keyboardType="number-pad" editable={!recurring} />
            </View>
            {members.length ? <>
              <Text style={styles.label}>Owner</Text>
              <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
                <Pressable style={[styles.choice, !lineOwner && styles.choiceActive]} onPress={() => setLineOwner("")}><Text style={[styles.choiceText, !lineOwner && styles.choiceTextActive]}>Household</Text></Pressable>
                {members.map((member) => <Pressable key={member.email} style={[styles.choice, lineOwner === member.email && styles.choiceActive]} onPress={() => setLineOwner(member.email)}><Text style={[styles.choiceText, lineOwner === member.email && styles.choiceTextActive]}>{member.name}</Text></Pressable>)}
              </ScrollView>
            </> : null}
            <Pressable style={[styles.choice, line.rolloverEnabled && styles.choiceActive]} onPress={() => void onSave(toggleRollover(state, line.id))} accessibilityLabel="Carry unspent balance into next month">
              <Text style={[styles.choiceText, line.rolloverEnabled && styles.choiceTextActive]}>{line.rolloverEnabled ? "✓ Carries unspent money into next month" : "Carry unspent money into next month"}</Text>
            </Pressable>
            {line.recurringBill?.enabled && recurring ? <View style={styles.planTaskBlock}>
              <Text style={styles.label}>Recurring bill - amount due</Text>
              <TextInput key={`${line.id}-bill-${line.recurringBill.amount}`} style={styles.input} defaultValue={String(line.recurringBill.amount)} keyboardType="decimal-pad" placeholder="Amount due" onEndEditing={(event) => { const value = Number(event.nativeEvent.text.replace(/[,$]/g, "")); if (Number.isFinite(value) && value >= 0 && value !== line.recurringBill?.amount) void onSave(updateRecurringBill(state, line.id, { amount: value })); }} />
              <View style={styles.choiceRow}>{(["monthly", "quarterly", "yearly"] as const).map((frequency) => <Pressable key={frequency} style={[styles.choice, line.recurringBill?.frequency === frequency && styles.choiceActive]} onPress={() => void onSave(updateRecurringBill(state, line.id, { frequency }))}><Text style={[styles.choiceText, line.recurringBill?.frequency === frequency && styles.choiceTextActive]}>{frequency.charAt(0).toUpperCase() + frequency.slice(1)}</Text></Pressable>)}</View>
              <Text style={styles.label}>Next due date</Text>
              <TextInput key={`${line.id}-due-${line.recurringBill.dueDate}`} style={styles.input} defaultValue={line.recurringBill.dueDate} placeholder="YYYY-MM-DD" onEndEditing={(event) => { const value = event.nativeEvent.text.trim(); if (value === line.recurringBill?.dueDate) return; if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) Alert.alert("Invalid date", "Use the format YYYY-MM-DD."); else void onSave(updateRecurringBill(state, line.id, { dueDate: value })); }} />
              <Text style={styles.muted}>{money(recurring.monthlyAmount, currency)}/mo - {recurring.frequency} bill due {recurring.nextDueDate}, {recurring.monthsRemaining} month{recurring.monthsRemaining === 1 ? "" : "s"} to save</Text>
              <Pressable style={styles.secondarySmall} onPress={() => void onSave(disableRecurringBill(state, line.id))}><Text style={styles.secondaryButtonText}>Remove recurring</Text></Pressable>
            </View> : <Pressable style={styles.secondarySmall} onPress={() => void onSave(enableRecurringBill(state, line.id))}><Text style={styles.secondaryButtonText}>↻ Make this a recurring bill (set money aside monthly)</Text></Pressable>}
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
    </Card>; })}

    <Card>
      <Text style={styles.cardTitle}>Add category</Text>
      <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={newCategoryName} onChangeText={setNewCategoryName} placeholder="Category name" />
        <Pressable style={styles.secondarySmall} onPress={() => void submitAddCategory()}><Text style={styles.secondaryButtonText}>Add</Text></Pressable>
      </View>
    </Card>

    {(state.recurringExpenses || []).length ? <Card>
      <Text style={styles.cardTitle}>Recurring bills</Text>
      <Text style={styles.muted}>Each one that comes due is added to Bank stream for you to review.</Text>
      {(state.recurringExpenses || []).map((recurring) => editingRecurringId === recurring.id ? <View key={recurring.id} style={styles.planTaskBlock}>
        <TextInput style={styles.input} value={recPayee} onChangeText={setRecPayee} placeholder="Payee" />
        <TextInput style={styles.input} value={recAmount} onChangeText={setRecAmount} placeholder="Amount" keyboardType="decimal-pad" />
        <View style={styles.choiceRow}>{(["weekly", "biweekly", "monthly"] as const).map((value) => <Pressable key={value} style={[styles.choice, recRepeat === value && styles.choiceActive]} onPress={() => setRecRepeat(value)}><Text style={[styles.choiceText, recRepeat === value && styles.choiceTextActive]}>{RECURRING_REPEAT_LABELS[value]}</Text></Pressable>)}</View>
        <TextInput style={styles.input} value={recEnd} onChangeText={setRecEnd} placeholder="Stop repeating after (YYYY-MM-DD, optional)" />
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{allLines.map((line) => <Pressable key={line.id} style={[styles.choice, recLineId === line.id && styles.choiceActive]} onPress={() => setRecLineId(line.id)}><Text style={[styles.choiceText, recLineId === line.id && styles.choiceTextActive]}>{line.category} · {line.name}</Text></Pressable>)}</ScrollView>
        {accounts.length ? <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
          <Pressable style={[styles.choice, !recAccountId && styles.choiceActive]} onPress={() => setRecAccountId("")}><Text style={[styles.choiceText, !recAccountId && styles.choiceTextActive]}>Not linked</Text></Pressable>
          {accounts.map((account) => <Pressable key={account.id} style={[styles.choice, recAccountId === account.id && styles.choiceActive]} onPress={() => setRecAccountId(account.id)}><Text style={[styles.choiceText, recAccountId === account.id && styles.choiceTextActive]}>{account.name}</Text></Pressable>)}
        </ScrollView> : null}
        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={() => {
            const amount = Number(recAmount.replace(/[,$]/g, ""));
            if (!recPayee.trim() || !Number.isFinite(amount)) return Alert.alert("Missing info", "Enter a payee and an amount.");
            if (recEnd.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(recEnd.trim())) return Alert.alert("Invalid end date", "Use the format YYYY-MM-DD, or leave it blank.");
            void onSave(updateRecurringExpense(state, recurring.id, { payee: recPayee.trim(), amount, recurrence: recRepeat, endDate: recEnd.trim(), lineId: recLineId, accountId: recAccountId }));
            setEditingRecurringId(null);
          }}><Text style={styles.primaryButtonText}>Save</Text></Pressable>
          <Pressable style={styles.secondarySmall} onPress={() => setEditingRecurringId(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
          <Pressable style={styles.planStepperButton} onPress={() => Alert.alert(`Stop ${recurring.payee}?`, "No more will be added to Bank stream. Ones already waiting there stay.", [{ text: "Cancel" }, { text: "Stop it", style: "destructive", onPress: () => { void onSave(deleteRecurringExpense(state, recurring.id)); setEditingRecurringId(null); } }])}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
        </View>
      </View> : <Pressable key={recurring.id} onPress={() => { setEditingRecurringId(recurring.id); setRecPayee(recurring.payee); setRecAmount(String(recurring.amount)); setRecRepeat(recurring.recurrence); setRecEnd(recurring.endDate || ""); setRecLineId(recurring.lineId); setRecAccountId(recurring.accountId || ""); }}>
        <Row title={recurring.payee} detail={[RECURRING_REPEAT_LABELS[recurring.recurrence], `since ${recurring.anchorDate}`, recurring.endDate ? `until ${recurring.endDate}` : "", transactionAssignmentLabel(state, { lineId: recurring.lineId, date: "", payee: "", amount: 0 }), accountName(recurring.accountId)].filter(Boolean).join(" · ")} value={money(Number(recurring.amount), currency)} />
      </Pressable>)}
    </Card> : null}

    <Card>
      <View style={styles.iouPersonHead}>
        <Text style={styles.cardTitle}>Transactions</Text>
        {orderedTransactions.length ? <Pressable onPress={() => (selectMode ? endSelect() : setSelectMode(true))}><Text style={[styles.secondaryButtonText, { color: colors.green }]}>{selectMode ? "Done" : "Select"}</Text></Pressable> : null}
      </View>
      {orderedTransactions.length > 1 ? <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
        {(["date", "amount", "payee", "category", "account"] as LedgerSortField[]).map((field) => <Pressable key={field} style={[styles.choice, ledgerSort.field === field && styles.choiceActive]} onPress={() => toggleLedgerSort(field)}>
          <Text style={[styles.choiceText, ledgerSort.field === field && styles.choiceTextActive]}>{field.charAt(0).toUpperCase() + field.slice(1)}{ledgerSort.field === field ? (ledgerSort.direction === "asc" ? " ▲" : " ▼") : ""}</Text>
        </Pressable>)}
      </ScrollView> : null}
      {selectMode ? <View style={styles.planTaskBlock}>
        <Text style={styles.rowTitle}>{selectedTx.length} selected</Text>
        <View style={styles.actionRow}>
          <Pressable style={styles.secondarySmall} onPress={() => setSelectedTx(visibleTransactions.map(({ index }) => index))}><Text style={styles.secondaryButtonText}>Select all shown</Text></Pressable>
          <Pressable style={styles.secondarySmall} onPress={() => setSelectedTx([])}><Text style={styles.secondaryButtonText}>Clear</Text></Pressable>
        </View>
        {selectedTx.length ? <>
          <Text style={styles.label}>Apply this category to the selected</Text>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{allLines.map((line) => <Pressable key={line.id} style={[styles.choice, bulkLineId === line.id && styles.choiceActive]} onPress={() => setBulkLineId(line.id)}><Text style={[styles.choiceText, bulkLineId === line.id && styles.choiceTextActive]}>{line.category} · {line.name}</Text></Pressable>)}</ScrollView>
          <Pressable style={[styles.primaryButton, !bulkLineId && { opacity: 0.5 }]} disabled={!bulkLineId} onPress={() => void applyBulkLine()}><Text style={styles.primaryButtonText}>Apply to {selectedTx.length}</Text></Pressable>
        </> : null}
      </View> : null}
      {orderedTransactions.length ? visibleTransactions.map(({ item, index }) => <View key={`${index}-${item.date}-${item.payee}`}><View style={styles.row}>
        {selectMode ? <Pressable onPress={() => toggleSelected(index)} accessibilityLabel={`Select ${item.payee}`}><Ionicons name={selectedTx.includes(index) ? "checkbox" : "square-outline"} size={24} color={selectedTx.includes(index) ? colors.green : colors.muted} /></Pressable> : null}
        <Pressable style={styles.rowCopy} onPress={() => (selectMode ? toggleSelected(index) : beginTxEdit(index))}>
          <Text style={styles.rowTitle}>{item.payee}</Text>
          <Text style={styles.rowDetail}>{[item.date, transactionAssignmentLabel(state, item), accountName(item.accountId)].filter(Boolean).join(" · ")}</Text>
        </Pressable>
        <Text style={styles.rowValue}>{money(Number(item.amount), currency)}</Text>
        <Pressable onPress={() => setFriendSplitIndex(friendSplitIndex === index ? null : index)} accessibilityLabel={`Split ${item.payee} with a friend`}><Ionicons name="people-outline" size={18} color={colors.muted} /></Pressable>
        <Pressable onPress={() => openSplit(index)} accessibilityLabel={`Split ${item.payee} across categories`}><Ionicons name="cut-outline" size={18} color={item.splits?.length ? colors.green : colors.muted} /></Pressable>
        <Pressable onPress={() => deleteTransaction(index)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>
      {friendSplitIndex === index ? <SplitWithFriends state={state} payee={item.payee} total={Math.abs(Number(item.amount))} defaultDate={item.date} defaultDirection={Number(item.amount) < 0 ? "i_owe" : "owed_to_me"}
        onSubmit={async (shares, options) => { const done = await applySplitWithFriends(state, onSave, { type: "ledger", index }, shares, options); if (done) setFriendSplitIndex(null); return done; }} onCancel={() => setFriendSplitIndex(null)} /> : null}
      <TagChips tags={item.tags || []} suggestions={tagSuggestions(state.transactions, item.tags)} onChange={(tags) => void onSave(setTransactionTags(state, index, tags))} />
      </View>) : <Text style={styles.muted}>No transactions yet</Text>}
      {orderedTransactions.length > 15 ? <Pressable style={styles.secondarySmall} onPress={() => setShowAllTx((prev) => !prev)}><Text style={styles.secondaryButtonText}>{showAllTx ? "Show fewer" : `Show all (${orderedTransactions.length})`}</Text></Pressable> : null}
    </Card>
  </Page>;
}

const reminderRecurrenceLabels: Record<ReminderRecurrence, string> = { once: "Once", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };

function Calendar({ state, access, user, onSave }: { state: HouseholdState; access: HouseholdAccess | null; user: User; onSave: (next: HouseholdState) => Promise<void> }) {
  const members = access?.members.filter((member) => member.status === "active") || [];
  const [editing, setEditing] = useState<{ kind: "event" | "chore"; index: number } | null>(null);
  const [addKind, setAddKind] = useState<"event" | "chore" | "birthday" | "anniversary">("event");
  const [remindDays, setRemindDays] = useState(1);
  const [title, setTitle] = useState(""); const [date, setDate] = useState(`${state.budget.month}-01`); const [owner, setOwner] = useState(members[0]?.email || "");
  const [recurrence, setRecurrence] = useState<ReminderRecurrence>("once");
  const [time, setTime] = useState("09:00");
  const [location, setLocation] = useState("");
  const [filterOwner, setFilterOwner] = useState("");
  const [choreRecurrence, setChoreRecurrence] = useState<ChoreRecurrence>("once");
  const kind = editing?.kind || (addKind === "chore" ? "chore" : "event");
  // Birthdays/anniversaries share the event form but repeat yearly on a fixed month-day, remind N days before, and are
  // "wished" per year instead of marked done.
  const editingEvent = editing?.kind === "event" ? state.calendar.events[editing.index] : undefined;
  const annualType = editingEvent ? (ANNUAL_EVENT_TYPES.includes(editingEvent.type) ? editingEvent.type : "") : (addKind === "birthday" || addKind === "anniversary" ? addKind : "");
  const begin = (targetKind: "event" | "chore", index: number) => {
    const item = targetKind === "event" ? state.calendar.events[index] : state.calendar.chores[index];
    if (!item) return;
    setEditing({ kind: targetKind, index }); setTitle(item.title); setDate(targetKind === "event" ? (item as typeof state.calendar.events[number]).date : (item as typeof state.calendar.chores[number]).startDate || (item as typeof state.calendar.chores[number]).nextDue); setOwner(targetKind === "event" ? (item as typeof state.calendar.events[number]).owner || members[0]?.email || "" : (item as typeof state.calendar.chores[number]).assignee || members[0]?.email || "");
    setRecurrence(targetKind === "event" ? (item as typeof state.calendar.events[number]).recurrence || "once" : "once");
    setTime(targetKind === "event" ? ((item as typeof state.calendar.events[number]).dateTime || "").slice(11, 16) || "09:00" : "09:00");
    setRemindDays(targetKind === "event" ? Number((item as typeof state.calendar.events[number]).reminderDays ?? 1) : 1);
    setChoreRecurrence(targetKind === "chore" ? (item as typeof state.calendar.chores[number]).recurrence || "once" : "once");
    setLocation((item as { location?: string }).location || "");
  };
  // "From photo": the picture is sent inline to the server's vision model (never stored) and comes back
  // as a DRAFT the user reviews and edits before anything is added - same as web's dialog.
  const [photoDraft, setPhotoDraft] = useState<(ReminderPhotoDraft & { previewUri: string }) | null>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const pickPhotoReminder = async () => {
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
    if (exceedsStateLimit(next)) return Alert.alert("Too much to import", "Adding these would push your household data past the 1 MB the server can save, after which nothing could be saved. Import fewer items, or remove some old ones first.");
    await onSave(next);
    setImportDrafts(null);
    Alert.alert("Import complete", `Imported ${imported} calendar item${imported === 1 ? "" : "s"}.`);
  };
  const resetForm = () => { setEditing(null); setTitle(""); setDate(`${state.budget.month}-01`); setRecurrence("once"); setTime("09:00"); setRemindDays(1); setChoreRecurrence("once"); setLocation(""); };
  const saveItem = async () => {
    if (!title.trim() || !date) return;
    const member = members.find((item) => item.email === owner);
    const ownerName = member?.name || owner;
    const ownerAssignee = owner ? [{ key: owner, name: ownerName, email: owner }] : [];
    const next = structuredClone(state);
    if (annualType) {
      if (time.trim() && !isValidClockTime(time)) return Alert.alert("Invalid time", "Use 24-hour HH:MM, for example 09:00.");
      const input = { type: annualType, title, date, time, reminderDays: remindDays };
      if (editingEvent && editing) {
        const updated = updateAnnualEvent(editingEvent, input);
        if (!updated) return Alert.alert("Invalid date", "Use the format YYYY-MM-DD.");
        next.calendar.events = next.calendar.events.map((item, index) => index === editing.index ? { ...updated, owner, ownerName, assignees: editingEvent.owner === owner && editingEvent.assignees?.length ? editingEvent.assignees : ownerAssignee } : item);
      } else {
        const created = buildAnnualEvent(input, { email: owner || user.email, name: ownerName || user.name }, () => `event-${Date.now()}`);
        if (!created) return Alert.alert("Invalid date", "Use the format YYYY-MM-DD.");
        next.calendar.events.push(created);
      }
      await onSave(next); resetForm();
      return;
    }
    if (editing?.kind === "chore") {
      next.calendar.chores = next.calendar.chores.map((item, index) => index === editing.index ? {
        ...item, title: title.trim(), startDate: date, nextDue: date, assignee: owner, assigneeName: ownerName,
        // keep a multi-assignee list set on web unless the single owner picked here actually changed
        assignees: item.assignee === owner && item.assignees?.length ? item.assignees : ownerAssignee,
        recurrence: choreRecurrence, cadence: choreCadenceLabels[choreRecurrence], location: location.trim()
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
        ...(item.type === "reminder" ? { recurrence, location: location.trim(), ...timing } : {})
      } : item);
    } else if (kind === "chore") {
      next.calendar.chores.push({ id: `chore-${Date.now()}`, title: title.trim(), assignee: owner, assigneeName: ownerName, assignees: ownerAssignee, cadence: choreCadenceLabels[choreRecurrence], nextDue: date, startDate: date, recurrence: choreRecurrence, location: location.trim(), completedBy: {} });
    } else {
      if (time.trim() && !isValidClockTime(time)) return Alert.alert("Invalid time", "Use 24-hour HH:MM, for example 14:30.");
      const timing = reminderTiming(date, time);
      if (!timing) return Alert.alert("Invalid date", "Use the format YYYY-MM-DD.");
      next.calendar.events.push({ id: `event-${Date.now()}`, title: title.trim(), date, ...timing, type: "reminder", annual: false, owner, ownerName, assignees: ownerAssignee, recurrence, location: location.trim(), completedBy: [] });
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
  const toggleWished = async (index: number, year: number) => {
    const event = state.calendar.events[index];
    if (!event) return;
    await onSave({ ...state, calendar: { ...state.calendar, events: state.calendar.events.map((item, itemIndex) => itemIndex === index ? toggleAnnualWished(item, year, user.email) : item) } });
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
      <Pressable style={[styles.choice, addKind === "birthday" && styles.choiceActive]} onPress={() => setAddKind("birthday")}><Text style={[styles.choiceText, addKind === "birthday" && styles.choiceTextActive]}>Birthday</Text></Pressable>
      <Pressable style={[styles.choice, addKind === "anniversary" && styles.choiceActive]} onPress={() => setAddKind("anniversary")}><Text style={[styles.choiceText, addKind === "anniversary" && styles.choiceTextActive]}>Anniversary</Text></Pressable>
    </View>}
    <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Title" /><TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
    {annualType ? <Text style={styles.muted}>Repeats every year on this date - the year you enter doesn't matter (a birth year is fine).</Text> : null}
    {kind === "event" ? <TextInput style={styles.input} value={time} onChangeText={setTime} placeholder="Time (HH:MM, 24-hour) - when you'll be reminded" keyboardType="numbers-and-punctuation" maxLength={5} /> : null}
    {!annualType ? <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="Location (optional) - adds a Directions link" /> : null}
    <Text style={styles.label}>Assign to</Text><ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{members.map((member) => <Pressable key={member.email} style={[styles.choice, owner === member.email && styles.choiceActive]} onPress={() => setOwner(member.email)}><Text style={[styles.choiceText, owner === member.email && styles.choiceTextActive]}>{member.name}</Text></Pressable>)}</ScrollView>
    {annualType ? <>
      <Text style={styles.label}>Remind me</Text>
      <View style={styles.choiceRow}>{REMIND_BEFORE_OPTIONS.map((option) => <Pressable key={option.days} style={[styles.choice, remindDays === option.days && styles.choiceActive]} onPress={() => setRemindDays(option.days)}><Text style={[styles.choiceText, remindDays === option.days && styles.choiceTextActive]}>{option.label}</Text></Pressable>)}</View>
    </> : null}
    {kind === "event" && !annualType && <>
      <Text style={styles.label}>Repeat</Text>
      <View style={styles.choiceRow}>{(["once", "weekly", "monthly", "yearly"] as ReminderRecurrence[]).map((item) => <Pressable key={item} style={[styles.choice, recurrence === item && styles.choiceActive]} onPress={() => setRecurrence(item)}><Text style={[styles.choiceText, recurrence === item && styles.choiceTextActive]}>{reminderRecurrenceLabels[item]}</Text></Pressable>)}</View>
    </>}
    {kind === "chore" && <>
      <Text style={styles.label}>Repeat</Text>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{(Object.keys(choreCadenceLabels) as ChoreRecurrence[]).map((item) => <Pressable key={item} style={[styles.choice, choreRecurrence === item && styles.choiceActive]} onPress={() => setChoreRecurrence(item)}><Text style={[styles.choiceText, choreRecurrence === item && styles.choiceTextActive]}>{choreCadenceLabels[item]}</Text></Pressable>)}</ScrollView>
    </>}
    <View style={styles.actionRow}>
      <Pressable style={styles.primaryButton} onPress={() => void saveItem()}><Text style={styles.primaryButtonText}>{editing ? "Save changes" : kind === "chore" ? "Add chore" : annualType ? `Add ${ANNUAL_EVENT_LABELS[annualType]?.toLowerCase() || "event"}` : "Add reminder"}</Text></Pressable>
      {editing && <Pressable style={styles.secondarySmall} onPress={resetForm}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>}
    </View>
  </Card><Card><Text style={styles.cardTitle}>Events and reminders</Text>
    {members.length > 1 ? <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
      {[{ email: "", name: "All people" }, ...members].map((member) => <Pressable key={member.email || "all"} style={[styles.choice, filterOwner === member.email && styles.choiceActive]} onPress={() => setFilterOwner(filterOwner === member.email ? "" : member.email)}><Text style={[styles.choiceText, filterOwner === member.email && styles.choiceTextActive]}>{member.name}</Text></Pressable>)}
    </ScrollView> : null}
    {state.calendar.events.map((item, index) => {
    if (!matchesOwnerFilter(item, filterOwner)) return null;
    const assignees = effectiveAssignees(item);
    const key = completionKeyFor(assignees, user.email);
    const completed = item.completedBy || [];
    const done = key ? completed.includes(key) : false;
    const recurrenceLabel = item.recurrence && item.recurrence !== "once" ? reminderRecurrenceLabels[item.recurrence] : null;
    const timeLabel = item.type === "reminder" && item.dateTime ? item.dateTime.slice(11, 16) : null;
    if (ANNUAL_EVENT_TYPES.includes(item.type)) {
      const pending = nextPendingAnnualOccurrence(item, user.email);
      const wishedKeys = pending ? annualWishedKeys(item, pending.year) : [];
      const total = Math.max(assignees.length, wishedKeys.length);
      const remindLabel = Number(item.reminderDays ?? 1) < 0 ? "no reminder" : Number(item.reminderDays ?? 1) === 0 ? "reminds same day" : `reminds ${item.reminderDays ?? 1} day${Number(item.reminderDays ?? 1) === 1 ? "" : "s"} before`;
      const overdue = pending ? pending.date < localDateKey() : false;
      return <View key={item.id || `${item.date}-${item.title}`} style={styles.row}>
        <Pressable style={styles.rowCopy} onPress={() => begin("event", index)}><Row title={annualEventDisplayTitle(item)} detail={[pending ? formatShortDate(parseLocalDate(pending.date)) : "", overdue ? "Not wished yet" : "", ANNUAL_EVENT_LABELS[item.type], remindLabel, item.ownerName || item.owner].filter(Boolean).join(" · ")} badge={item.type} /></Pressable>
        {pending ? <Pressable style={styles.planStepperButton} onPress={() => void toggleWished(index, pending.year)}><Text style={styles.secondaryButtonText}>{wishedKeys.includes(user.email) ? "✓ Wished" : "Mark wished"}{total > 1 ? ` (${wishedKeys.length}/${total})` : ""}</Text></Pressable> : null}
        <Pressable onPress={() => deleteEvent(index)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>;
    }
    return <View key={item.id || `${item.date}-${item.title}`} style={styles.row}>
      <Pressable style={styles.rowCopy} onPress={() => begin("event", index)}><Row title={item.title} detail={[item.date, timeLabel, item.ownerName || item.owner || "Unassigned", recurrenceLabel].filter(Boolean).join(" · ")} badge={item.type} /></Pressable>
      {item.location ? <Pressable accessibilityLabel={`Directions to ${item.location}`} hitSlop={8} onPress={() => void Linking.openURL(directionsUrl(item.location as string))}><Ionicons name="navigate-outline" size={20} color={colors.blue} /></Pressable> : null}
      {item.type === "reminder" ? (key
        ? <Pressable style={styles.planStepperButton} onPress={() => void toggleReminderDone(index)}><Text style={styles.secondaryButtonText}>{done ? "✓ Done" : "Mark done"}</Text></Pressable>
        : <Text style={styles.rowDetail}>{completed.length}/{assignees.length} done</Text>) : null}
      <Pressable onPress={() => deleteEvent(index)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
    </View>;
  })}</Card><Card><Text style={styles.cardTitle}>Chore rotation</Text>{state.calendar.chores.map((item, index) => {
    if (!matchesOwnerFilter(item, filterOwner)) return null;
    const occurrence = currentChoreOccurrenceDate(item);
    const assignees = effectiveAssignees(item);
    const key = completionKeyFor(assignees, user.email);
    const done = occurrence ? isChoreOccurrenceComplete(item, occurrence) : false;
    const mine = key && occurrence ? choreCompletedKeys(item, occurrence).includes(key) : false;
    return <View key={item.id || item.title} style={styles.row}>
      <Pressable style={styles.rowCopy} onPress={() => begin("chore", index)}><Row title={item.title} detail={`${item.assigneeName || item.assignee} · ${item.cadence}`} badge={occurrence || item.nextDue} /></Pressable>
      {item.location ? <Pressable accessibilityLabel={`Directions to ${item.location}`} hitSlop={8} onPress={() => void Linking.openURL(directionsUrl(item.location as string))}><Ionicons name="navigate-outline" size={20} color={colors.blue} /></Pressable> : null}
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

function Meals({ state, onSave, onOpenRecipes }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void>; onOpenRecipes: () => void }) {
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
    const next = structuredClone(state);
    // One meal per day+slot, like web: planning an occupied slot replaces what was there.
    next.meals.plannedWeek = planMealSlot(next.meals.plannedWeek, { month: state.budget.month, week, day, slot, mealName, recipeId: recipe?.id || "", servings: Number(servings) });
    next.meals.feedback = `${mealName} planned for ${day} ${slot}.`;
    await onSave(next);
  };
  const clearSlot = async (mealDay: string, mealSlot: string) => {
    await onSave({ ...state, meals: { ...state.meals, plannedWeek: clearMealSlot(state.meals.plannedWeek, state.budget.month, week, mealDay, mealSlot) } });
  };
  // Loads a planned meal back into the form so tapping it edits it (same as web's click-to-edit slot).
  const editSlot = (item: PlannedMeal, mealDay: string, mealSlot: string) => {
    setDay(mealDay); setSlot(mealSlot); setServings(String(item.servings || 3));
    if (item.recipeId && state.meals.recipes.some((entry) => entry.id === item.recipeId)) { setRecipeId(item.recipeId); setCustomMeal(""); }
    else { setRecipeId(""); setCustomMeal(item.meal); }
  };
  const nutrition = mealNutritionTotals(current, state.meals.recipes);
  const groceryGroups = groceryListByAisle(current, state.meals.recipes);
  const goals = state.meals.nutritionGoals;
  const saveWeek = async () => { const next = structuredClone(state); const label = `${state.budget.month} · Week ${week}`; next.meals.savedWeeks ||= []; if (!next.meals.savedWeeks.includes(label)) next.meals.savedWeeks.push(label); next.meals.feedback = `${label} saved.`; if (next.household.activity) next.household.activity.unshift(`Saved meal week: ${label}`); await onSave(next); };
  const postGroceries = async () => {
    const next = structuredClone(state);
    const line = next.budget.categories.flatMap((category) => category.lines).find((item) => item.name.toLowerCase().includes("grocer"));
    if (!line) return Alert.alert("Budget setup needed", "Add a Groceries subcategory before posting.");
    const estimate = groceryEstimateAmount(current, state.meals.recipes);
    if (estimate <= 0) return Alert.alert("Nothing planned yet", "Plan at least one meal this week before posting a grocery estimate.");
    const amount = Math.max(0, Number(next.meals.groceryEstimate || estimate));
    next.transactions.unshift({ date: localDateKey(), payee: "Meal plan groceries", lineId: line.id, amount, memo: `Posted from Week ${week} grocery list` });
    next.meals.feedback = `${money(amount, state.household.currency)} posted to ${line.name}.`;
    if (next.household.activity) next.household.activity.unshift(next.meals.feedback);
    await onSave(next);
  };
  return <Page><Title eyebrow="MEALS">Weekly meal plan</Title><Card>
    <Pressable style={styles.secondarySmall} onPress={onOpenRecipes}><Text style={styles.secondaryButtonText}>Manage recipes ({state.meals.recipes.length})</Text></Pressable>
    <Text style={styles.label}>Week</Text>
    <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{weeks.map((item) => <Pressable key={item.number} style={[styles.choice, week === item.number && styles.choiceActive]} onPress={() => void selectWeek(item.number)}><Text style={[styles.choiceText, week === item.number && styles.choiceTextActive]}>{item.label}</Text></Pressable>)}</ScrollView>
    <View style={styles.actionRow}><Pressable style={styles.secondarySmall} onPress={() => void saveWeek()}><Text style={styles.secondaryButtonText}>Save week</Text></Pressable><Pressable style={styles.secondarySmall} onPress={() => void postGroceries()}><Text style={styles.secondaryButtonText}>Post groceries</Text></Pressable></View>{state.meals.feedback ? <Text style={styles.successText}>{state.meals.feedback}</Text> : null}
    <Text style={styles.label}>Day</Text><ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{days.map((item) => <Pressable key={item} style={[styles.choice, day === item && styles.choiceActive]} onPress={() => setDay(item)}><Text style={[styles.choiceText, day === item && styles.choiceTextActive]}>{item.slice(0, 3)}</Text></Pressable>)}</ScrollView>
    <Text style={styles.label}>Meal</Text><View style={styles.choiceRow}>{slots.map((item) => <Pressable key={item} style={[styles.choice, slot === item && styles.choiceActive]} onPress={() => setSlot(item)}><Text style={[styles.choiceText, slot === item && styles.choiceTextActive]}>{item}</Text></Pressable>)}</View>
    <Text style={styles.label}>Recipe</Text>{state.meals.recipes.map((recipe) => <Pressable key={recipe.id} style={[styles.recipeChoice, recipeId === recipe.id && styles.choiceActive]} onPress={() => { setRecipeId(recipe.id); setCustomMeal(""); }}><Text style={[styles.choiceText, recipeId === recipe.id && styles.choiceTextActive]}>{recipe.name}</Text></Pressable>)}<TextInput style={styles.input} value={customMeal} onChangeText={(text) => { setCustomMeal(text); setRecipeId(""); }} placeholder="Or type any meal (no recipe)" /><TextInput style={styles.input} value={servings} onChangeText={setServings} keyboardType="number-pad" placeholder="Servings" /><Pressable style={styles.primaryButton} onPress={() => void plan()}><Text style={styles.primaryButtonText}>Plan meal</Text></Pressable>
  </Card>
  <Card>
    <Text style={styles.cardTitle}>Nutrition</Text>
    {current.length ? <>
      <Text style={styles.rowDetail}>Daily calories: {nutrition.calories}{goals ? ` of ${goals.calories}` : ""} kcal</Text>
      <Text style={styles.rowDetail}>Daily protein: {nutrition.protein}{goals ? ` of ${goals.protein}` : ""} g</Text>
    </> : <Text style={styles.muted}>Nothing planned to measure yet.</Text>}
  </Card>
  <Card>
    <Text style={styles.cardTitle}>Grocery list</Text>
    {groceryGroups.length ? groceryGroups.map((group) => <View key={group.aisle}>
      <Text style={styles.label}>{group.aisle}</Text>
      {group.items.map((item) => <Row key={item.ingredient} title={item.ingredient} detail={item.count > 1 ? `×${item.count} · from meal plan` : "from meal plan"} />)}
    </View>) : <Text style={styles.muted}>Plan a meal to build your grocery list.</Text>}
  </Card>
  {weekDayDates.map(({ day: mealDay, date }) => <Card key={mealDay}><Text style={styles.cardTitle}>{mealDay}</Text><Text style={styles.muted}>{formatShortDate(date)}</Text>{slots.map((mealSlot) => {
    const item = mealInSlot(current, mealDay, mealSlot);
    return item
      ? <View key={mealSlot} style={styles.checkRow}>
        <Pressable style={styles.rowCopy} onPress={() => editSlot(item, mealDay, mealSlot)}><Text style={styles.rowTitle}>{item.meal}</Text><Text style={styles.rowDetail}>{mealSlot} · {item.servings} serving{item.servings === 1 ? "" : "s"} · tap to edit</Text></Pressable>
        <Pressable accessibilityLabel={`Clear ${mealSlot} on ${mealDay}`} hitSlop={8} onPress={() => void clearSlot(mealDay, mealSlot)}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
      </View>
      : <Pressable key={mealSlot} onPress={() => { setDay(mealDay); setSlot(mealSlot); }}><Row title="Open" detail={mealSlot} /></Pressable>;
  })}</Card>)}</Page>;
}

const noteColorOptions = [
  { value: "#ffffff", label: "White" },
  { value: "#fff7d6", label: "Yellow" },
  { value: "#eef7ff", label: "Blue" },
  { value: "#eaf8ef", label: "Green" },
  { value: "#fff0ee", label: "Coral" }
];

// Share one note three ways, each matching a web option: an email to anyone (a snapshot plus a live link), a public no-login link
// that anyone can open to view and tick items, or access for a specific FamilyLoop account. Network-backed (not part of the household
// state), so each action reports its own result.
function NoteSharePanel({ note }: { note: Note }) {
  const [email, setEmail] = useState(""); const [message, setMessage] = useState("");
  const [linkUrl, setLinkUrl] = useState(""); const [shares, setShares] = useState<NoteUserShare[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api.noteUserShares(note.id).then((result) => setShares(result.shares)).catch(() => undefined); }, [note.id]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setStatus("");
    try { await action(); } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Something went wrong"); } finally { setBusy(false); }
  };
  const sendEmail = () => run(async () => {
    const result = await api.shareNoteByEmail({ to: email.trim(), title: note.title, body: note.body, message: message.trim(), noteId: note.id, checklist: note.checklist.map((item) => ({ text: item.text, done: item.done })) });
    setLinkUrl(result.url || linkUrl); setEmail(""); setMessage(""); setStatus(`Sent to ${email.trim()}.`);
  });
  const makeLink = () => run(async () => { setLinkUrl((await api.createNoteShareLink(note.id)).url); });
  const stopLink = () => run(async () => { await api.removeNoteShareLink(note.id); setLinkUrl(""); setStatus("The public link no longer works."); });
  const shareWithUser = () => run(async () => { const result = await api.shareNoteWithUser(note.id, userEmail.trim()); setShares(result.shares); setUserEmail(""); setStatus("Shared."); });
  const removeShare = (share: NoteUserShare) => run(async () => { setShares((await api.removeNoteUserShare(note.id, share.userId)).shares); });
  return <View style={styles.planTaskBlock}>
    <Text style={styles.label}>Email a copy to anyone</Text>
    <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Their email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
    <TextInput style={styles.input} value={message} onChangeText={setMessage} placeholder="Message (optional)" />
    <Pressable style={[styles.secondarySmall, (busy || !email.trim()) && { opacity: 0.5 }]} disabled={busy || !email.trim()} onPress={() => void sendEmail()}><Text style={styles.secondaryButtonText}>Send email</Text></Pressable>
    <Text style={styles.label}>Public link (no login needed)</Text>
    {linkUrl ? <>
      <Text style={styles.rowDetail} selectable>{linkUrl}</Text>
      <View style={styles.actionRow}>
        <Pressable style={styles.secondarySmall} onPress={() => void Share.share({ message: linkUrl })}><Text style={styles.secondaryButtonText}>Share link</Text></Pressable>
        <Pressable style={styles.secondarySmall} disabled={busy} onPress={() => void stopLink()}><Text style={[styles.secondaryButtonText, { color: colors.coral }]}>Stop sharing</Text></Pressable>
      </View>
    </> : <Pressable style={styles.secondarySmall} disabled={busy} onPress={() => void makeLink()}><Text style={styles.secondaryButtonText}>Create link</Text></Pressable>}
    <Text style={styles.label}>Share with a FamilyLoop account</Text>
    {shares.map((share) => <View key={share.id} style={styles.row}>
      <View style={styles.rowCopy}><Text style={styles.rowTitle}>{share.name || share.email}</Text><Text style={styles.rowDetail}>{share.email}</Text></View>
      <Pressable onPress={() => void removeShare(share)} accessibilityLabel={`Stop sharing with ${share.email}`}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
    </View>)}
    <View style={styles.actionRow}>
      <TextInput style={[styles.input, { flex: 1 }]} value={userEmail} onChangeText={setUserEmail} placeholder="Their account email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
      <Pressable style={[styles.secondarySmall, (busy || !userEmail.trim()) && { opacity: 0.5 }]} disabled={busy || !userEmail.trim()} onPress={() => void shareWithUser()}><Text style={styles.secondaryButtonText}>Share</Text></Pressable>
    </View>
    {status ? <Text style={styles.muted}>{status}</Text> : null}
  </View>;
}

// Notes other people shared with this login, from any household - live, so a change either side is seen by both. You can tick items,
// add one, or remove one.
function SharedWithMe() {
  const [notes, setNotes] = useState<SharedNote[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setNotes((await api.sharedWithMe()).notes); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't load shared notes"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (action: () => Promise<unknown>) => { try { await action(); await load(); } catch (cause) { Alert.alert("Couldn't update the note", cause instanceof Error ? cause.message : "Unknown error"); } };
  if (!notes?.length && !error) return null;
  return <Card>
    <Text style={styles.cardTitle}>Shared with you</Text>
    {error ? <Text style={styles.formError}>{error}</Text> : null}
    {(notes || []).map((shared) => <View key={shared.shareId} style={styles.planTaskBlock}>
      <Text style={styles.rowTitle}>{shared.title || "Untitled note"}</Text>
      <Text style={styles.rowDetail}>From {shared.sharedFromHousehold}</Text>
      {shared.body ? <Text style={styles.noteBody}>{shared.body}</Text> : null}
      {shared.checklist.map((item) => <View key={item.id} style={[styles.checkRow, item.parentId && styles.checkRowChild]}>
        <Pressable style={styles.checkRow} onPress={() => void act(() => api.toggleSharedNoteItem(shared.shareId, item.id, !item.done))}>
          <Ionicons name={item.done ? "checkbox" : "square-outline"} size={24} color={item.done ? colors.green : colors.muted} />
          <Text style={[styles.checkText, item.done && styles.done]}>{item.text}</Text>
        </Pressable>
        <Pressable onPress={() => void act(() => api.deleteSharedNoteItem(shared.shareId, item.id))} accessibilityLabel={`Remove ${item.text}`}><Ionicons name="close" size={16} color={colors.muted} /></Pressable>
      </View>)}
      <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={drafts[shared.shareId] || ""} onChangeText={(value) => setDrafts((prev) => ({ ...prev, [shared.shareId]: value }))} placeholder="Add an item" />
        <Pressable style={styles.secondarySmall} onPress={() => { const text = (drafts[shared.shareId] || "").trim(); if (!text) return; setDrafts((prev) => ({ ...prev, [shared.shareId]: "" })); void act(() => api.addSharedNoteItem(shared.shareId, text)); }}><Text style={styles.secondaryButtonText}>Add</Text></Pressable>
      </View>
    </View>)}
  </Card>;
}

function Notes({ state, onSave }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void> }) {
  const [addTitle, setAddTitle] = useState(""); const [addBody, setAddBody] = useState(""); const [addColor, setAddColor] = useState("#ffffff");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState(""); const [editBody, setEditBody] = useState(""); const [editColor, setEditColor] = useState("#ffffff");
  const [checklistDrafts, setChecklistDrafts] = useState<Record<string, string>>({});
  const [view, setView] = useState<NotesView>("notes");
  const [activeLabel, setActiveLabel] = useState("");
  const [query, setQuery] = useState("");
  const [moreNoteId, setMoreNoteId] = useState<string | null>(null);
  const [editListId, setEditListId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [reminderDate, setReminderDate] = useState(""); const [reminderTime, setReminderTime] = useState("09:00");
  const [completedOpen, setCompletedOpen] = useState<Record<string, boolean>>({});
  const [shareNoteId, setShareNoteId] = useState<string | null>(null);

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

  const shownNotes = visibleNotes(state.notes.entries, view, query, activeLabel);
  const labels = allLabels(state.notes.entries);
  const bills = billsRows(state);

  const saveNotes = (entries: Note[]) => onSave({ ...state, notes: { ...state.notes, entries } });
  const updateNote = (noteId: string, update: (note: Note) => Note | null) => {
    const target = state.notes.entries.find((entry) => entry.id === noteId);
    const next = target ? update(target) : null;
    if (next) void saveNotes(state.notes.entries.map((entry) => entry.id === noteId ? next : entry));
  };
  // Trash empties itself after a week (web does this on every render).
  useEffect(() => {
    const kept = purgeExpiredTrash(state.notes.entries);
    if (kept.length !== state.notes.entries.length) void saveNotes(kept);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.notes.entries.length]);

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
    Alert.alert("Move to trash?", `${note.title || "Untitled note"} - you can restore it from Trash for 7 days.`, [{ text: "Cancel" }, { text: "Move to trash", style: "destructive", onPress: () => updateNote(note.id, (item) => trashNote(item)) }]);
  };
  const deleteForever = (note: Note) => {
    Alert.alert("Delete permanently?", `${note.title || "Untitled note"} can't be recovered.`, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => void saveNotes(state.notes.entries.filter((entry) => entry.id !== note.id)) }]);
  };
  const copyNote = (note: Note) => { void saveNotes([duplicateNote(note, uniqueId), ...state.notes.entries]); setMoreNoteId(null); };
  const openMore = (note: Note) => {
    setMoreNoteId(moreNoteId === note.id ? null : note.id);
    setReminderDate((note.reminder || "").slice(0, 10)); setReminderTime((note.reminder || "").slice(11, 16) || "09:00"); setLabelDraft("");
  };
  const saveReminder = (note: Note, clear = false) => {
    const next = setNoteReminder(note, clear ? "" : reminderDate, clear ? "" : reminderTime);
    if (!next) return Alert.alert("Invalid reminder", "Enter a real date (YYYY-MM-DD) and a 24-hour time (HH:MM).");
    updateNote(note.id, () => next);
    if (clear) { setReminderDate(""); setReminderTime("09:00"); }
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
    const inTrash = view === "trash";
    const showBoxes = note.showChecklist !== false;
    const { open: openItems, completed: doneItems } = bucketChecklistItems(note.checklist);
    const editingList = editListId === note.id;
    const linkedBill = note.billLineId ? bills.find((bill) => bill.id === note.billLineId) : null;
    const renderItem = (item: Note["checklist"][number]) => editingList
      ? <View key={item.id} style={[styles.checkRow, item.parentId && styles.checkRowChild]}>
          <TextInput key={`${item.id}-${item.text}`} style={[styles.input, { flex: 1 }]} defaultValue={item.text} onEndEditing={(event) => updateNote(note.id, (current) => ({ ...current, checklist: editChecklistText(current.checklist, item.id, event.nativeEvent.text) }))} />
          <Pressable onPress={() => updateNote(note.id, (current) => ({ ...current, checklist: toggleIndent(current.checklist, item.id) }))} accessibilityLabel={item.parentId ? "Move out of sub-item" : "Make a sub-item"}><Ionicons name={item.parentId ? "arrow-back" : "arrow-forward"} size={18} color={colors.text} /></Pressable>
          <Pressable onPress={() => updateNote(note.id, (current) => ({ ...current, checklist: moveNoteItem(current.checklist, item.id, "up") }))} accessibilityLabel="Move up"><Ionicons name="arrow-up" size={18} color={colors.text} /></Pressable>
          <Pressable onPress={() => updateNote(note.id, (current) => ({ ...current, checklist: moveNoteItem(current.checklist, item.id, "down") }))} accessibilityLabel="Move down"><Ionicons name="arrow-down" size={18} color={colors.text} /></Pressable>
          <Pressable onPress={() => updateNote(note.id, (current) => ({ ...current, checklist: deleteChecklistItem(current.checklist, item.id) }))} accessibilityLabel="Delete item"><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
        </View>
      : <Pressable key={item.id} style={[styles.checkRow, item.parentId && styles.checkRowChild]} onPress={() => toggle(note, item.id)}>
          {showBoxes ? <Ionicons name={item.done ? "checkbox" : "square-outline"} size={24} color={item.done ? colors.green : colors.muted} /> : <Text style={styles.checkText}>•</Text>}
          <Text style={[styles.checkText, item.done && showBoxes && styles.done]}>{item.text}</Text>
        </Pressable>;
    return <View key={note.id} style={[styles.note, { backgroundColor: note.color || colors.surface }]}>
      <View style={styles.noteHeader}>
        <Pressable style={styles.rowCopy} onPress={() => (inTrash ? undefined : startEdit(note))}><Text style={styles.noteTitle}>{note.title || "Untitled note"}</Text></Pressable>
        {inTrash ? null : <>
          <Pressable disabled={uploadingNoteId === note.id} onPress={() => void addPhoto(note)} accessibilityLabel="Add a photo to this note">{uploadingNoteId === note.id ? <ActivityIndicator size="small" color={colors.green} /> : <Ionicons name="camera-outline" size={18} color={colors.muted} />}</Pressable>
          <Pressable onPress={() => togglePin(note)}><Ionicons name={note.pinned ? "pin" : "pin-outline"} size={18} color={note.pinned ? colors.gold : colors.muted} /></Pressable>
          <Pressable onPress={() => toggleArchive(note)}><Ionicons name={note.archived ? "arrow-undo-outline" : "archive-outline"} size={18} color={colors.muted} /></Pressable>
          <Pressable onPress={() => openMore(note)} accessibilityLabel="More actions"><Ionicons name="ellipsis-horizontal" size={18} color={moreNoteId === note.id ? colors.green : colors.muted} /></Pressable>
          <Pressable onPress={() => deleteNote(note)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
        </>}
      </View>
      {(note.labels || []).length || note.reminder || linkedBill ? <View style={styles.choiceRow}>
        {(note.labels || []).map((label) => <Text key={label} style={styles.tagChipText}>#{label}</Text>)}
        {note.reminder ? <Text style={styles.tagChipText}>⏰ {note.reminder.slice(0, 10)} {note.reminder.slice(11, 16)}</Text> : null}
        {linkedBill ? <Text style={styles.tagChipText}>🧾 {linkedBill.name}</Text> : null}
      </View> : null}
      {note.body ? <Text style={styles.noteBody}>{note.body}</Text> : null}
      {noteLinkedImages(documents, note.id).length ? <ScrollView horizontal keyboardShouldPersistTaps="handled" style={styles.journalPhotoRow}>{noteLinkedImages(documents, note.id).map((photo) => <Pressable key={photo.id} onPress={() => removePhoto(photo)} accessibilityLabel={`Remove photo ${photo.name}`}>
        {imageUrls[photo.id] ? <Image source={{ uri: imageUrls[photo.id] }} style={styles.journalPhoto} /> : <View style={[styles.journalPhoto, { backgroundColor: colors.panel }]} />}
      </Pressable>)}</ScrollView> : null}
      {openItems.map(renderItem)}
      {doneItems.length ? <>
        <Pressable onPress={() => setCompletedOpen((prev) => ({ ...prev, [note.id]: !prev[note.id] }))}><Text style={styles.rowDetail}>{completedOpen[note.id] ? "▾" : "▸"} {doneItems.length} completed item{doneItems.length === 1 ? "" : "s"}</Text></Pressable>
        {completedOpen[note.id] ? doneItems.map(renderItem) : null}
      </> : null}
      {inTrash ? <View style={styles.actionRow}>
        <Pressable style={styles.primaryButton} onPress={() => updateNote(note.id, restoreNote)}><Text style={styles.primaryButtonText}>Restore</Text></Pressable>
        <Pressable style={styles.secondarySmall} onPress={() => deleteForever(note)}><Text style={[styles.secondaryButtonText, { color: colors.coral }]}>Delete permanently</Text></Pressable>
      </View> : <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={checklistDrafts[note.id] || ""} onChangeText={(value) => setChecklistDrafts((prev) => ({ ...prev, [note.id]: value }))} placeholder="Add checklist item" onSubmitEditing={() => addChecklistItem(note)} />
        <Pressable style={styles.secondarySmall} onPress={() => addChecklistItem(note)}><Text style={styles.secondaryButtonText}>Add</Text></Pressable>
      </View>}
      {moreNoteId === note.id && !inTrash ? <View style={styles.planTaskBlock}>
        <Text style={styles.label}>Labels</Text>
        <View style={styles.choiceRow}>{labels.map((label) => <Pressable key={label} style={[styles.choice, (note.labels || []).some((item) => item.toLowerCase() === label.toLowerCase()) && styles.choiceActive]} onPress={() => updateNote(note.id, (current) => toggleLabel(current, label))}><Text style={[styles.choiceText, (note.labels || []).some((item) => item.toLowerCase() === label.toLowerCase()) && styles.choiceTextActive]}>{label}</Text></Pressable>)}</View>
        <View style={styles.actionRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={labelDraft} onChangeText={setLabelDraft} placeholder="New label" autoCapitalize="none" onSubmitEditing={() => { updateNote(note.id, (current) => toggleLabel({ ...current, labels: (current.labels || []).filter((item) => item.toLowerCase() !== labelDraft.trim().toLowerCase()) }, labelDraft)); setLabelDraft(""); }} />
          <Pressable style={styles.secondarySmall} onPress={() => { updateNote(note.id, (current) => toggleLabel({ ...current, labels: (current.labels || []).filter((item) => item.toLowerCase() !== labelDraft.trim().toLowerCase()) }, labelDraft)); setLabelDraft(""); }}><Text style={styles.secondaryButtonText}>Add</Text></Pressable>
        </View>
        <Text style={styles.label}>Reminder</Text>
        <View style={styles.actionRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={reminderDate} onChangeText={setReminderDate} placeholder="YYYY-MM-DD" />
          <TextInput style={[styles.input, { flex: 1 }]} value={reminderTime} onChangeText={setReminderTime} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
        <View style={styles.actionRow}>
          <Pressable style={styles.secondarySmall} onPress={() => saveReminder(note)}><Text style={styles.secondaryButtonText}>Set reminder</Text></Pressable>
          {note.reminder ? <Pressable style={styles.secondarySmall} onPress={() => saveReminder(note, true)}><Text style={styles.secondaryButtonText}>Clear</Text></Pressable> : null}
        </View>
        <Text style={styles.label}>Linked bill</Text>
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
          <Pressable style={[styles.choice, !note.billLineId && styles.choiceActive]} onPress={() => updateNote(note.id, (current) => setNoteBill(current, null))}><Text style={[styles.choiceText, !note.billLineId && styles.choiceTextActive]}>None</Text></Pressable>
          {bills.map((bill) => <Pressable key={bill.id} style={[styles.choice, note.billLineId === bill.id && styles.choiceActive]} onPress={() => updateNote(note.id, (current) => setNoteBill(current, bill.id))}><Text style={[styles.choiceText, note.billLineId === bill.id && styles.choiceTextActive]}>{bill.name}</Text></Pressable>)}
        </ScrollView>
        <View style={styles.choiceRow}>
          <Pressable style={[styles.choice, showBoxes && styles.choiceActive]} onPress={() => updateNote(note.id, (current) => ({ ...current, showChecklist: current.showChecklist === false }))}><Text style={[styles.choiceText, showBoxes && styles.choiceTextActive]}>{showBoxes ? "✓ Show checkboxes" : "Show checkboxes"}</Text></Pressable>
          <Pressable style={[styles.choice, editingList && styles.choiceActive]} onPress={() => setEditListId(editingList ? null : note.id)}><Text style={[styles.choiceText, editingList && styles.choiceTextActive]}>{editingList ? "✓ Editing list" : "Edit list"}</Text></Pressable>
          <Pressable style={styles.choice} onPress={() => copyNote(note)}><Text style={styles.choiceText}>Make a copy</Text></Pressable>
          <Pressable style={[styles.choice, shareNoteId === note.id && styles.choiceActive]} onPress={() => setShareNoteId(shareNoteId === note.id ? null : note.id)}><Text style={[styles.choiceText, shareNoteId === note.id && styles.choiceTextActive]}>Share</Text></Pressable>
        </View>
        {shareNoteId === note.id ? <NoteSharePanel note={note} /> : null}
      </View> : null}
    </View>;
  };

  return <Page><Title eyebrow="NOTES">Household notes</Title>
    <Card>
      <TextInput style={styles.input} value={addTitle} onChangeText={setAddTitle} placeholder="Title" />
      <TextInput style={[styles.input, styles.multilineInput]} value={addBody} onChangeText={setAddBody} placeholder="Note" multiline />
      {renderColorChips(addColor, setAddColor)}
      <Pressable style={styles.primaryButton} onPress={() => void addNote()}><Text style={styles.primaryButtonText}>Add note</Text></Pressable>
    </Card>
    <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Search notes" autoCapitalize="none" clearButtonMode="while-editing" />
    <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
      {([["notes", "Notes"], ["reminders", "Reminders"], ["archive", "Archive"], ["trash", "Trash"]] as Array<[NotesView, string]>).map(([value, label]) => <Pressable key={value} style={[styles.choice, view === value && styles.choiceActive]} onPress={() => { setView(value); setActiveLabel(""); }}><Text style={[styles.choiceText, view === value && styles.choiceTextActive]}>{label}</Text></Pressable>)}
      {labels.map((label) => <Pressable key={label} style={[styles.choice, view === "label" && activeLabel === label && styles.choiceActive]} onPress={() => { setView("label"); setActiveLabel(label); }}><Text style={[styles.choiceText, view === "label" && activeLabel === label && styles.choiceTextActive]}>#{label}</Text></Pressable>)}
    </ScrollView>
    {view === "trash" ? <Text style={styles.muted}>Notes in the trash are deleted for good after 7 days.</Text> : null}
    {shownNotes.map(renderNote)}
    {view === "notes" && !query.trim() ? <SharedWithMe /> : null}
    {shownNotes.length ? null : <Text style={styles.muted}>{query.trim() ? "No notes match your search." : view === "trash" ? "Trash is empty." : view === "archive" ? "Nothing archived." : view === "reminders" ? "No notes with a reminder." : "No notes here yet."}</Text>}
  </Page>;
}

function Journal({ privateData, state, viewerEmail, onSave }: { privateData: PrivateData; state: HouseholdState; viewerEmail: string; onSave: (journal: PrivateData["journal"]) => Promise<void> }) {
  const blankDraft = () => ({ entryDate: localDateKey(), title: "", body: "", mood: "", gratitude: "", tags: "" });
  const [draft, setDraft] = useState(blankDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(blankDraft);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [reflection, setReflection] = useState<{ text: string; isError: boolean } | null>(null);
  const [reflecting, setReflecting] = useState(false);
  const allEntries = sortedEntries(privateData.journal.entries);
  const visibleEntries = filterEntries(allEntries, query, tagFilter);
  const tags = allTags(allEntries);
  const today = localDateKey();
  const groups = visibleEntries.reduce<Array<{ monthKey: string; items: JournalEntry[] }>>((acc, entry) => {
    const monthKey = entry.entryDate.slice(0, 7) || "undated";
    const group = acc.find((item) => item.monthKey === monthKey);
    if (group) group.items.push(entry); else acc.push({ monthKey, items: [entry] });
    return acc;
  }, []);

  const addEntry = async () => {
    const problem = validateEntryInput(draft);
    if (problem) return Alert.alert("Check the entry", problem);
    await onSave({ entries: [...privateData.journal.entries, createEntry(draft, () => uniqueId("journal"))] });
    setDraft(blankDraft()); setReflection(null);
  };
  const startEdit = (entry: JournalEntry) => {
    setEditDraft({ entryDate: entry.entryDate, title: entry.title, body: entry.body, mood: entry.mood, gratitude: entry.gratitude || "", tags: (entry.tags || []).join(", ") });
    setEditingId(entry.id);
  };
  const saveEdit = async () => {
    if (!editingId) return;
    const problem = validateEntryInput(editDraft);
    if (problem) return Alert.alert("Check the entry", problem);
    await onSave({ entries: updateEntry(privateData.journal.entries, editingId, editDraft) });
    setEditingId(null);
  };
  const confirmDelete = (entry: JournalEntry) => Alert.alert("Delete this entry?", "This cannot be undone.", [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => { if (editingId === entry.id) setEditingId(null); void onSave({ entries: privateData.journal.entries.filter((item) => item.id !== entry.id) }); } }]);

  const addPhoto = async (entryId: string) => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.5 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset?.base64) return;
    const dataUrl = `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`;
    const now = new Date().toISOString();
    const nextEntries = privateData.journal.entries.map((entry) => entry.id === entryId
      ? { ...entry, photos: [...entry.photos, { id: uniqueId("photo"), dataUrl, createdAt: now }].slice(0, JOURNAL_MAX_PHOTOS) }
      : entry);
    await onSave({ entries: nextEntries });
  };
  const confirmRemovePhoto = (entryId: string, photoId: string) => Alert.alert("Remove this photo?", "", [{ text: "Cancel" }, { text: "Remove", style: "destructive", onPress: () => void onSave({ entries: removePhoto(privateData.journal.entries, entryId, photoId) }) }]);

  const getReflection = async () => {
    const context = todaysJournalContext(state, viewerEmail, today);
    if (!context) return setReflection({ text: "Nothing logged yet today to reflect on - complete a chore, wish someone happy birthday, or jot a note first.", isError: true });
    setReflecting(true);
    try { const result = await api.journalReflection(context); setReflection({ text: result.message, isError: false }); }
    catch (cause) { setReflection({ text: cause instanceof Error ? cause.message : "Could not get a reflection", isError: true }); }
    finally { setReflecting(false); }
  };

  const moodChips = (selected: string, onPick: (mood: string) => void) => <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
    {JOURNAL_MOODS.map((item) => <Pressable key={item} style={[styles.choice, selected === item && styles.choiceActive]} onPress={() => onPick(selected === item ? "" : item)}>
      <Text style={[styles.choiceText, selected === item && styles.choiceTextActive]}>{JOURNAL_MOOD_EMOJI[item]} {item}</Text>
    </Pressable>)}
  </ScrollView>;
  const fields = (value: typeof draft, set: (next: typeof draft) => void) => <>
    <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
    <TextInput style={styles.input} value={value.entryDate} onChangeText={(entryDate) => set({ ...value, entryDate })} autoCapitalize="none" />
    <TextInput style={styles.input} value={value.title} onChangeText={(title) => set({ ...value, title })} placeholder="Give today a title" />
    <Text style={styles.label}>Mood</Text>
    {moodChips(value.mood, (mood) => set({ ...value, mood }))}
    <TextInput style={[styles.input, styles.multilineInput]} value={value.body} onChangeText={(body) => set({ ...value, body })} placeholder="What happened today? How are you feeling?" multiline />
    <Text style={styles.label}>🙏 Grateful for</Text>
    <TextInput style={styles.input} value={value.gratitude} onChangeText={(gratitude) => set({ ...value, gratitude })} placeholder="One thing you're grateful for today" />
    <Text style={styles.label}>Tags</Text>
    <TextInput style={styles.input} value={value.tags} onChangeText={(next) => set({ ...value, tags: next })} placeholder="travel, family, work" autoCapitalize="none" />
  </>;

  return <Page><Title eyebrow="JOURNAL">Your private journal</Title>
    <Text style={styles.muted}>Private to you — never shared with other household members.</Text>
    <Card>
      <Text style={styles.cardTitle}>New entry</Text>
      {fields(draft, setDraft)}
      <Pressable style={styles.secondarySmall} disabled={reflecting} onPress={() => void getReflection()}><Text style={styles.secondaryButtonText}>{reflecting ? "Thinking..." : "✨ Get a gentle reflection"}</Text></Pressable>
      {reflection ? <View style={{ marginTop: 8 }}>
        <Text style={reflection.isError ? styles.formError : styles.noteBody}>{reflection.text}</Text>
        <View style={styles.actionRow}>
          {!reflection.isError ? <Pressable style={styles.secondarySmall} onPress={() => { setDraft({ ...draft, body: draft.body ? `${draft.body}\n\n${reflection.text}` : reflection.text }); setReflection(null); }}><Text style={styles.secondaryButtonText}>Use this</Text></Pressable> : null}
          <Pressable style={styles.secondarySmall} onPress={() => setReflection(null)}><Text style={styles.secondaryButtonText}>Dismiss</Text></Pressable>
        </View>
      </View> : null}
      <Pressable style={styles.primaryButton} onPress={() => void addEntry()}><Text style={styles.primaryButtonText}>Save entry</Text></Pressable>
    </Card>
    {allEntries.length ? <>
      <View style={styles.metricGrid}>
        <Metric label="Day streak" value={String(writingStreak(allEntries))} />
        <Metric label="Entries this year" value={String(entriesInYear(allEntries, Number(today.slice(0, 4))))} accent={colors.blue} />
      </View>
      <Card>
        <Text style={styles.cardTitle}>How you've felt lately</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", height: 60, gap: 4 }}>
          {moodTrend(allEntries).map((bar) => <View key={bar.id} style={{ flex: 1, height: `${bar.heightPercent}%`, borderRadius: 3, backgroundColor: bar.mood ? JOURNAL_MOOD_COLOR[bar.mood] || colors.border : colors.border }} />)}
        </View>
      </Card>
      <Card>
        <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Search title, body, tags..." autoCapitalize="none" autoCorrect={false} />
        {tags.length ? <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
          {["", ...tags].map((tag) => <Pressable key={tag || "all"} style={[styles.choice, tagFilter === tag && styles.choiceActive]} onPress={() => setTagFilter(tag)}><Text style={[styles.choiceText, tagFilter === tag && styles.choiceTextActive]}>{tag ? `#${tag}` : "All"}</Text></Pressable>)}
        </ScrollView> : null}
      </Card>
    </> : <Text style={styles.muted}>No journal entries yet — write your first one above.</Text>}
    {allEntries.length && !visibleEntries.length ? <Text style={styles.muted}>No entries match your search.</Text> : null}
    {groups.map((group) => <View key={group.monthKey} style={{ gap: 10 }}>
      <Text style={styles.label}>{group.monthKey === "undated" ? "Undated" : formatMonthLabel(group.monthKey)} · {group.items.length}</Text>
      {group.items.map((entry) => editingId === entry.id ? <Card key={entry.id}>
        {fields(editDraft, setEditDraft)}
        <View style={styles.actionRow}>
          <Pressable style={[styles.secondarySmall, { flex: 1 }]} onPress={() => setEditingId(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
          <Pressable style={[styles.primaryButton, { flex: 1, marginTop: 0 }]} onPress={() => void saveEdit()}><Text style={styles.primaryButtonText}>Done</Text></Pressable>
        </View>
        <Pressable accessibilityLabel="Delete entry" onPress={() => confirmDelete(entry)}><Text style={[styles.secondaryButtonText, { color: colors.coral, marginTop: 8 }]}>Delete entry</Text></Pressable>
        {entry.photos.length ? <ScrollView horizontal keyboardShouldPersistTaps="handled" style={styles.journalPhotoRow}>{entry.photos.map((photo) => <Pressable key={photo.id} accessibilityLabel="Remove photo" onPress={() => confirmRemovePhoto(entry.id, photo.id)}><Image source={{ uri: photo.dataUrl }} style={styles.journalPhoto} /></Pressable>)}</ScrollView> : null}
        {entry.photos.length < JOURNAL_MAX_PHOTOS ? <Pressable style={styles.secondarySmall} onPress={() => void addPhoto(entry.id)}><Text style={styles.secondaryButtonText}>+ Add photo ({entry.photos.length}/{JOURNAL_MAX_PHOTOS})</Text></Pressable> : null}
      </Card> : <Card key={entry.id}>
        <View style={styles.noteHeader}>
          <Text style={styles.noteTitle}>{entry.title || "Untitled entry"}</Text>
          <Pressable accessibilityLabel="Edit entry" hitSlop={8} onPress={() => startEdit(entry)}><Ionicons name="create-outline" size={18} color={colors.text} /></Pressable>
          <Pressable accessibilityLabel="Delete entry" hitSlop={8} onPress={() => confirmDelete(entry)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
        </View>
        <Text style={styles.muted}>{entry.entryDate === today ? "Today" : entry.entryDate}{entry.mood ? ` · ${JOURNAL_MOOD_EMOJI[entry.mood] || ""} ${entry.mood}` : ""}</Text>
        {entry.gratitude ? <Text style={styles.noteBody}>🙏 {entry.gratitude}</Text> : null}
        {entry.body ? <Text style={styles.noteBody}>{entry.body}</Text> : null}
        {entry.tags?.length ? <Text style={styles.muted}>{entry.tags.map((tag) => `#${tag}`).join("  ")}</Text> : null}
        {entry.photos.length ? <ScrollView horizontal keyboardShouldPersistTaps="handled" style={styles.journalPhotoRow}>{entry.photos.map((photo) => <Image key={photo.id} source={{ uri: photo.dataUrl }} style={styles.journalPhoto} />)}</ScrollView> : null}
      </Card>)}
    </View>)}
  </Page>;
}

const planRecurrenceLabels: Record<PlanRecurrence, string> = {
  none: "Does not repeat", daily: "Every day", weekdays: "Every weekday", weekly: "Every week", monthly: "Every month"
};

function formatPlanDayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  const today = localDateKey();
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
  const [selectedDate, setSelectedDate] = useState(() => localDateKey());
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
    setSelectedDate(localDateKey(next));
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
      <Pressable style={styles.dayNavLabel} onPress={() => setSelectedDate(localDateKey())}><Text style={styles.rowTitle}>{formatPlanDayLabel(selectedDate)}</Text></Pressable>
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

// An inline list of choices, used instead of Alert.alert for long pickers: Android's Alert shows at most three
// buttons, so a list of folders or wealth items passed to it would silently lose everything past the third.
type PickerOption = { label: string; onPress: () => void };
function OptionList({ title, options, onClose }: { title: string; options: PickerOption[]; onClose: () => void }) {
  return <View style={styles.subtaskList}>
    <Text style={styles.label}>{title}</Text>
    {options.length ? options.map((option) => <Pressable key={option.label} style={styles.checkRow} onPress={() => { option.onPress(); onClose(); }}><Text style={styles.checkText}>{option.label}</Text></Pressable>) : <Text style={styles.muted}>Nothing to choose from yet</Text>}
    <Pressable style={styles.secondarySmall} onPress={onClose}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
  </View>;
}

function DocumentRow({ document, notes, folders, wealthAssets, wealthLiabilities, viewerName, onDownload, onDelete, onLinkNote, onMove, onLinkWealth, onChangeExpiry, onRename, onCopy }: {
  document: Document; notes: Note[]; folders: DocumentsData["folders"]; wealthAssets: WealthAsset[]; wealthLiabilities: WealthLiability[]; viewerName: string;
  onDownload: () => void; onDelete: () => void; onLinkNote: (noteId: string | null) => void; onMove: (folderId: string | null) => void;
  onLinkWealth: (wealthItemType: WealthItemType | null, wealthItemId: string | null) => void; onChangeExpiry: (expiryDate: string | null) => void; onRename: (name: string) => void; onCopy: () => void
}) {
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(document.name);
  const [expiryDraft, setExpiryDraft] = useState(document.expiryDate || "");
  const linkedNote = document.noteId ? notes.find((note) => note.id === document.noteId) : null;
  const linkedWealthItem = document.wealthItemId
    ? (document.wealthItemType === "liability" ? wealthLiabilities : wealthAssets).find((item) => item.id === document.wealthItemId)
    : null;
  const expiryBadge = documentExpiryBadge(document.expiryDate);
  const expiryToneColor = expiryBadge?.tone === "danger" ? colors.coral : expiryBadge?.tone === "warning" ? colors.gold : colors.muted;

  const [picker, setPicker] = useState<"move" | "wealth" | null>(null);
  const moveOptions: PickerOption[] = [
    ...folders.filter((folder) => folder.id !== document.folderId).map((folder) => ({ label: folder.name, onPress: () => onMove(folder.id) })),
    ...(document.folderId ? [{ label: "All documents (root)", onPress: () => onMove(null) }] : [])
  ];
  const wealthOptions: PickerOption[] = [
    ...(document.wealthItemId ? [{ label: "Remove tag", onPress: () => onLinkWealth(null, null) }] : []),
    ...wealthAssets.filter((asset) => asset.id).map((asset) => ({ label: `Asset: ${asset.name}`, onPress: () => onLinkWealth("asset", asset.id as string) })),
    ...wealthLiabilities.filter((liability) => liability.id).map((liability) => ({ label: `Liability: ${liability.name}`, onPress: () => onLinkWealth("liability", liability.id as string) }))
  ];

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
      <Pressable onPress={() => setPicker(picker === "move" ? null : "move")}><Ionicons name="folder-outline" size={20} color={colors.text} /></Pressable>
      <Pressable onPress={onDownload}><Ionicons name="download-outline" size={20} color={colors.text} /></Pressable>
      <Pressable onPress={() => setShowNotePicker((prev) => !prev)}><Ionicons name="link-outline" size={20} color={linkedNote ? colors.green : colors.muted} /></Pressable>
      <Pressable onPress={() => setPicker(picker === "wealth" ? null : "wealth")}><Ionicons name="cash-outline" size={20} color={linkedWealthItem ? colors.green : colors.muted} /></Pressable>
      <Pressable onPress={onDelete}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
    </View>
    <View style={styles.actionRow}>
      <Pressable style={styles.secondarySmall} onPress={() => { setNameDraft(document.name); setRenaming((prev) => !prev); }}><Text style={styles.secondaryButtonText}>Rename</Text></Pressable>
      <Pressable style={styles.secondarySmall} onPress={onCopy}><Text style={styles.secondaryButtonText}>Make a copy</Text></Pressable>
    </View>
    {renaming ? <View style={styles.actionRow}>
      <TextInput style={[styles.input, { flex: 1 }]} value={nameDraft} onChangeText={setNameDraft} autoFocus />
      <Pressable style={styles.secondarySmall} onPress={() => { const name = nameDraft.trim(); setRenaming(false); if (name && name !== document.name) onRename(name); }}><Text style={styles.secondaryButtonText}>Save</Text></Pressable>
    </View> : null}
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
    {picker === "move" ? <OptionList title="Move to folder" options={moveOptions} onClose={() => setPicker(null)} /> : null}
    {picker === "wealth" ? <OptionList title="Tag to a wealth item" options={wealthOptions} onClose={() => setPicker(null)} /> : null}
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

  const [folderPickerId, setFolderPickerId] = useState<string | null>(null);
  const folderWealthOptions = (folder: DocumentsData["folders"][number]): PickerOption[] => [
    ...(folder.wealthItemId ? [{ label: "Remove tag", onPress: () => void linkFolderWealthItem(folder.id, null, null) }] : []),
    ...wealthAssets.filter((asset) => asset.id).map((asset) => ({ label: `Asset: ${asset.name}`, onPress: () => void linkFolderWealthItem(folder.id, "asset", asset.id as string) })),
    ...wealthLiabilities.filter((liability) => liability.id).map((liability) => ({ label: `Liability: ${liability.name}`, onPress: () => void linkFolderWealthItem(folder.id, "liability", liability.id as string) }))
  ];

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

  const renameDocument = async (documentId: string, name: string) => {
    try { await api.updateDocument(documentId, { name }); await load(); }
    catch (cause) { showError("Could not rename document", cause); }
  };

  const copyDocument = async (documentId: string) => {
    try { await api.copyDocument(documentId); await load(); }
    catch (cause) { showError("Could not copy document", cause); }
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
      return <View key={folder.id}><View style={styles.row}>
        <Pressable style={styles.rowCopy} onPress={() => setCurrentFolderId(folder.id)}>
          <Text style={styles.rowTitle}>{folder.name}</Text>
          {linkedWealthItem ? <Text style={styles.rowDetail}>Tagged to {folder.wealthItemType === "liability" ? "Liability" : "Asset"}: {linkedWealthItem.name}</Text> : null}
        </Pressable>
        <Pressable onPress={() => startRenameFolder(folder.id, folder.name)}><Ionicons name="pencil-outline" size={18} color={colors.text} /></Pressable>
        <Pressable onPress={() => setFolderPickerId(folderPickerId === folder.id ? null : folder.id)}><Ionicons name="cash-outline" size={20} color={linkedWealthItem ? colors.green : colors.muted} /></Pressable>
        <Pressable onPress={() => deleteFolder(folder.id)}><Ionicons name="trash-outline" size={18} color={colors.coral} /></Pressable>
      </View>
      {folderPickerId === folder.id ? <OptionList title="Tag folder to a wealth item" options={folderWealthOptions(folder)} onClose={() => setFolderPickerId(null)} /> : null}
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
          onRename={(name) => void renameDocument(document.id, name)}
          onCopy={() => void copyDocument(document.id)}
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
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const author = { key: user.email, name: user.name };

  const saveDecisions = (next: Decision[]) => onSave({ ...state, decisions: next });
  const change = (decisionId: string, update: (decision: Decision) => Decision) => void saveDecisions(updateDecision(decisions, decisionId, update));

  const submitNew = async () => {
    const created = createDecision(newTitle, newNotes, () => uniqueId("decision"));
    if (!created) return Alert.alert("Missing info", "Enter the question you're deciding.");
    await saveDecisions([...decisions, created]);
    setNewTitle(""); setNewNotes(""); setExpandedId(created.id);
  };

  // Attachments are Documents rows (family-wide, like decisions); the stored file goes when its attachment or decision does.
  const deleteStoredFiles = async (documentIds: string[]) => {
    for (const documentId of documentIds) {
      try { await api.deleteDocument(documentId); } catch (cause) { if (!(cause instanceof ApiError && cause.status === 404)) console.warn("Could not delete attachment file", cause); }
    }
  };

  const confirmDelete = (decision: Decision) => {
    Alert.alert("Delete decision?", decision.title, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => {
      void saveDecisions(decisions.filter((item) => item.id !== decision.id));
      void deleteStoredFiles(attachmentDocumentIds(decision.attachments));
    } }]);
  };

  const [attachingId, setAttachingId] = useState<string | null>(null);
  const attachFile = async (decision: Decision) => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const contentType = asset.mimeType || "application/octet-stream";
    const allowed = canAttachToDecision(decision, asset.size || 0);
    if (!allowed.ok) return Alert.alert("Can't attach that file", allowed.reason);
    setAttachingId(decision.id);
    try {
      const { documentId, uploadUrl } = await api.requestDocumentUploadUrl({ name: asset.name, contentType, sizeBytes: asset.size || 0, folderId: null });
      // A placeholder (non-http) URL means a local/demo server with no storage bucket; there is nothing to PUT to.
      if (/^https?:\/\//.test(uploadUrl)) await FileSystem.uploadAsync(uploadUrl, asset.uri, { httpMethod: "PUT", headers: { "Content-Type": contentType } });
      await api.confirmDocumentUpload(documentId);
      try { await api.updateDocument(documentId, { description: `Attachment on the decision "${decision.title}"` }); } catch { /* the label is cosmetic */ }
      change(decision.id, (current) => addDecisionAttachment(current, { name: asset.name, contentType, sizeBytes: asset.size || 0, documentId }, () => uniqueId("attachment")));
    } catch (cause) {
      Alert.alert("Upload failed", cause instanceof Error ? cause.message : "Could not attach that file");
    } finally { setAttachingId(null); }
  };

  const openAttachment = async (documentId: string) => {
    try {
      const { url } = await api.documentDownloadUrl(documentId);
      await Linking.openURL(url);
      await api.openDocument(documentId);
    } catch (cause) { Alert.alert("Could not open file", cause instanceof Error ? cause.message : "Try again"); }
  };

  const confirmRemoveAttachment = (decision: Decision, attachment: NonNullable<Decision["attachments"]>[number]) => {
    Alert.alert("Remove attachment?", attachment.documentId ? `${attachment.name} will also be deleted from Documents.` : attachment.name, [{ text: "Cancel" }, { text: "Remove", style: "destructive", onPress: () => {
      change(decision.id, (current) => removeDecisionAttachment(current, attachment.id));
      void deleteStoredFiles(attachmentDocumentIds([attachment]));
    } }]);
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
          <TextInput style={[styles.input, styles.multilineInput]} value={notesDrafts[decision.id] ?? decision.notes} onChangeText={(value) => setNotesDrafts((prev) => ({ ...prev, [decision.id]: value }))} placeholder="Any context worth remembering (optional)" multiline
            onBlur={() => { const draft = notesDrafts[decision.id]; if (draft !== undefined && draft.trim() !== decision.notes) change(decision.id, (current) => ({ ...current, notes: draft.trim() })); setNotesDrafts((prev) => { const { [decision.id]: _done, ...rest } = prev; return rest; }); }} />
          <View style={styles.decisionColumn}>
            <Text style={styles.label}>Attachments</Text>
            {(decision.attachments || []).map((attachment) => <View key={attachment.id} style={styles.checkRow}>
              <Pressable style={styles.rowCopy} disabled={!attachment.documentId} onPress={() => attachment.documentId && void openAttachment(attachment.documentId)}>
                <Text style={[styles.rowTitle, attachment.documentId ? { color: colors.blue } : null]}>{attachment.name}</Text>
                <Text style={styles.rowDetail}>{attachment.documentId ? formatFileSize(attachment.sizeBytes) : "Saved inline - open it once on the web app to move it to Documents"}</Text>
              </Pressable>
              <Pressable accessibilityLabel={`Remove ${attachment.name}`} hitSlop={8} onPress={() => confirmRemoveAttachment(decision, attachment)}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
            </View>)}
            {(decision.attachments || []).length < 5 ? <Pressable style={[styles.secondarySmall, { marginTop: 6 }]} disabled={attachingId === decision.id} onPress={() => void attachFile(decision)}><Text style={styles.secondaryButtonText}>{attachingId === decision.id ? "Uploading..." : "Attach a file"}</Text></Pressable> : null}
          </View>
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
  const [sort, setSort] = useState<{ field: DraftSortField; direction: "asc" | "desc" }>({ field: "date", direction: "desc" });
  const reviews = sortDrafts(reviewDrafts(state), sort.field, sort.direction);
  const counts = pendingDraftCountsByAccount(reviews);
  const unlinkedCount = reviews.filter((draft) => !draft.accountId).length;
  const historyCount = reviews.filter((draft) => draft.historyMatch).length;
  const [feedback, setFeedback] = useState("");
  const [importing, setImporting] = useState(false);
  const [clearAccountId, setClearAccountId] = useState("");
  const [visibleCount, setVisibleCount] = useState(25);
  const [transferDraftId, setTransferDraftId] = useState<string | null>(null);
  const [transferAccountId, setTransferAccountId] = useState("");
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [friendSplitId, setFriendSplitId] = useState<string | null>(null);
  // AI categorization on import (on by default, remembered on this device). The pass runs after awaits, so it reads the latest
  // state through a ref instead of the render it started in - otherwise it could overwrite edits made in the meantime.
  const stateRef = useRef(state);
  stateRef.current = state;
  const [aiImport, setAiImport] = useState(true);
  useEffect(() => { void AsyncStorage.getItem("familyloop-ai-import").then((value) => { if (value === "off") setAiImport(false); }).catch(() => undefined); }, []);
  const changeAiImport = (enabled: boolean) => { setAiImport(enabled); void AsyncStorage.setItem("familyloop-ai-import", enabled ? "on" : "off").catch(() => undefined); };

  // A recurring bill that came due since the last visit becomes a draft to review (the shared save does this too; this catches
  // time passing while nothing was being saved).
  useEffect(() => {
    const next = ensureRecurringExpensesPosted(state, localDateKey(), uniqueId);
    if (next !== state) void onSave(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.recurringExpenses]);

  const apply = async (result: { ok: true; state: HouseholdState } | { ok: false; error: string }) => {
    if (!result.ok) { Alert.alert("Can't do that", result.error); return false; }
    await onSave(result.state);
    return true;
  };

  // After an import: AI fills the category/account history could not (one call per chunk of rows), then rows that are safe go
  // straight into the ledger; the rest stay here for review. Failures leave every row for review and say why.
  const runAiImportPass = async (draftIds: string[], fileName: string, importedCount: number) => {
    let filled = 0; let aiNote = "";
    try {
      const needAi = draftsNeedingAi(stateRef.current, draftIds);
      const budgetLines = allBudgetLines(stateRef.current);
      if (needAi.length && budgetLines.length) {
        setFeedback(`Imported ${importedCount} from ${fileName}. AI is categorizing ${needAi.length} row${needAi.length === 1 ? "" : "s"}...`);
        const lineOptions = budgetLines.map((line) => ({ id: line.id, label: `${line.category} - ${line.name}` }));
        const accountOptions = (stateRef.current.accounts || []).filter((account) => !account.closedAt).map((account) => ({ id: account.id, label: account.type ? `${account.name} (${account.type})` : account.name }));
        for (let start = 0; start < needAi.length; start += AI_IMPORT_CHUNK_SIZE) {
          const chunk = needAi.slice(start, start + AI_IMPORT_CHUNK_SIZE);
          const { results } = await api.suggestTransactionBatch(chunk.map((draft) => ({ id: draft.id as string, payee: draft.payee || "", amount: Number(draft.amount) || 0, date: draft.date || "" })), lineOptions, accountOptions);
          const applied = applyAiSuggestions(stateRef.current, results);
          if (applied.filled) { filled += applied.filled; await onSave(applied.state); }
        }
      }
    } catch (cause) {
      aiNote = ` AI categorization wasn't available (${cause instanceof Error ? cause.message : "unknown error"}) - rows were left for review.`;
    }
    const posted = autoAcceptSafeDrafts(stateRef.current, draftIds);
    if (posted.added) await onSave(posted.state);
    setFeedback(importSummary(fileName, importedCount, filled, posted.added, draftIds.length - posted.added, posted.reasons, aiNote));
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
      const importedState = { ...state, transactionInboxDrafts: result.drafts };
      if (exceedsStateLimit(importedState)) {
        setFeedback(`Not imported: adding ${rows.length} rows would push your household data past the 1 MB the server can save, and then nothing could be saved until data is removed. Review or clear some of the rows already waiting here (or import a shorter date range), then try again.`);
        return;
      }
      await onSave(importedState);
      setFeedback(rows.length > 2000 ? `${result.message} Only the first 2000 rows were imported.` : result.message);
      if (aiImport) {
        const existingIds = new Set((state.transactionInboxDrafts || []).map((draft) => draft.id));
        const newIds = result.drafts.filter((draft) => draft.id && !existingIds.has(draft.id)).map((draft) => draft.id as string);
        await runAiImportPass(newIds, asset.name, Math.min(rows.length, 2000));
      }
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : `Could not read ${asset.name}.`);
    } finally {
      setImporting(false);
    }
  };

  const applyBulkAccount = async (accountId: string) => {
    const result = setAccountForUnlinkedDrafts(state, accountId);
    if (result.applied) await onSave(result.state);
    const accountLabel = accounts.find((account) => account.id === accountId)?.name || "That account";
    setFeedback(result.skippedClosed
      ? `${accountLabel} was applied to ${result.applied} row${result.applied === 1 ? "" : "s"} - ${result.skippedClosed} skipped because they're dated after that account's close date.`
      : `${accountLabel} was applied to ${result.applied} row${result.applied === 1 ? "" : "s"}.`);
  };
  const confirmClearHistory = () => {
    Alert.alert(`Clear ${historyCount} suggested categor${historyCount === 1 ? "y" : "ies"}?`, "Rows whose category was guessed from your history go back to Unassigned, so you can pick each one by hand or ask the AI. Categories you picked yourself aren't touched.", [{ text: "Cancel" }, {
      text: "Clear", style: "destructive", onPress: () => { const result = clearHistorySuggestions(state); void onSave(result.state); setFeedback(`Cleared the suggested category on ${result.cleared} row${result.cleared === 1 ? "" : "s"}.`); }
    }]);
  };
  const toggleSort = (field: DraftSortField) => setSort((prev) => prev.field === field ? { field, direction: prev.direction === "asc" ? "desc" : "asc" } : { field, direction: field === "date" ? "desc" : "asc" });

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
    if (draft.lineSource === "ai-high") result.push({ label: "AI suggested category", tone: "info" });
    if (draft.lineSource === "ai-low") result.push({ label: "AI guess - check category", tone: "warn" });
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
      <Pressable style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: aiImport }} onPress={() => changeAiImport(!aiImport)}>
        <Ionicons name={aiImport ? "checkbox" : "square-outline"} size={22} color={aiImport ? colors.green : colors.muted} />
        <Text style={[styles.rowDetail, { flex: 1 }]}>Use AI to categorize imports and add confident rows to the ledger</Text>
      </Pressable>
      {feedback ? <Text style={styles.muted}>{feedback}</Text> : null}
    </Card>
    {Object.keys(counts).length && accounts.length ? <Card>
      <Text style={styles.cardTitle}>Clear an account's backlog</Text>
      <Text style={styles.muted}>Remove every unreviewed row for one account instead of reviewing each one.</Text>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{accounts.map((account) => <Pressable key={account.id} style={[styles.choice, clearAccountId === account.id && styles.choiceActive]} onPress={() => setClearAccountId(clearAccountId === account.id ? "" : account.id)}>
        <Text style={[styles.choiceText, clearAccountId === account.id && styles.choiceTextActive]}>{account.name}{counts[account.id] ? ` (${counts[account.id]})` : ""}</Text>
      </Pressable>)}</ScrollView>
      {clearAccountId ? <Pressable style={styles.secondarySmall} onPress={confirmClear}><Text style={[styles.secondaryButtonText, { color: colors.coral }]}>Clear</Text></Pressable> : null}
    </Card> : null}
    {unlinkedCount && accounts.length ? <Card>
      <Text style={styles.cardTitle}>Set account for {unlinkedCount} unlinked row{unlinkedCount === 1 ? "" : "s"}</Text>
      <Text style={styles.muted}>Only rows with no account yet are changed - ones already linked are left alone.</Text>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{accounts.map((account) => <Pressable key={account.id} style={styles.choice} onPress={() => void applyBulkAccount(account.id)}><Text style={styles.choiceText}>{account.name}{account.closedAt ? " (closed)" : ""}</Text></Pressable>)}</ScrollView>
    </Card> : null}
    {historyCount ? <Card>
      <Text style={styles.cardTitle}>{historyCount} categor{historyCount === 1 ? "y was" : "ies were"} guessed from history</Text>
      <Pressable style={styles.secondarySmall} onPress={confirmClearHistory}><Text style={styles.secondaryButtonText}>Clear {historyCount} suggested categor{historyCount === 1 ? "y" : "ies"}</Text></Pressable>
    </Card> : null}
    <Text style={styles.cardTitle}>{reviews.length ? `${reviews.length} waiting for review` : "Nothing waiting for review"}</Text>
    {reviews.length > 1 ? <View style={styles.choiceRow}>
      {(["date", "amount", "payee"] as DraftSortField[]).map((field) => <Pressable key={field} style={[styles.choice, sort.field === field && styles.choiceActive]} onPress={() => toggleSort(field)}>
        <Text style={[styles.choiceText, sort.field === field && styles.choiceTextActive]}>{field === "date" ? "Date" : field === "amount" ? "Amount" : "Payee"}{sort.field === field ? (sort.direction === "asc" ? " ▲" : " ▼") : ""}</Text>
      </Pressable>)}
    </View> : null}
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
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
          <Pressable style={[styles.choice, !draft.lineId && styles.choiceActive]} onPress={() => void apply(updateDraft(state, id, { lineId: "" }))}><Text style={[styles.choiceText, !draft.lineId && styles.choiceTextActive]}>Unassigned</Text></Pressable>
          {lines.map((line) => <Pressable key={line.id} style={[styles.choice, draft.lineId === line.id && styles.choiceActive]} onPress={() => void apply(updateDraft(state, id, { lineId: line.id }))}><Text style={[styles.choiceText, draft.lineId === line.id && styles.choiceTextActive]}>{line.category} · {line.name}</Text></Pressable>)}
        </ScrollView>
        <View style={styles.actionRow}>
          {!draft.lineId && lines.length ? <Pressable style={styles.secondarySmall} disabled={aiBusyId === id} onPress={() => void suggestLine(id, draft.payee || "")}>{aiBusyId === id ? <ActivityIndicator size="small" color={colors.green} /> : <Text style={styles.secondaryButtonText}>✨ Suggest category</Text>}</Pressable> : null}
          {draft.lineId ? <Pressable style={styles.secondarySmall} onPress={() => void onSave({ ...state, transactionCategorizationRules: setCategorizationRule(state.transactionCategorizationRules, draft.payee || "", draft.categorizationRuleLineId === draft.lineId ? "" : draft.lineId) })}><Text style={styles.secondaryButtonText}>{draft.categorizationRuleLineId === draft.lineId ? "🔒 Always this category - remove" : "🔒 Always categorize this payee this way"}</Text></Pressable> : null}
        </View>
        {accounts.length ? <>
          <Text style={styles.label}>Account</Text>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
            <Pressable style={[styles.choice, !draft.accountId && styles.choiceActive]} onPress={() => void apply(updateDraft(state, id, { accountId: "" }))}><Text style={[styles.choiceText, !draft.accountId && styles.choiceTextActive]}>Not linked</Text></Pressable>
            {accounts.map((item) => <Pressable key={item.id} style={[styles.choice, draft.accountId === item.id && styles.choiceActive]} onPress={() => void apply(updateDraft(state, id, { accountId: item.id }))}><Text style={[styles.choiceText, draft.accountId === item.id && styles.choiceTextActive]}>{item.name}{item.closedAt ? " (closed)" : ""}</Text></Pressable>)}
          </ScrollView>
          {!draft.accountId ? <Pressable style={styles.secondarySmall} disabled={aiBusyId === id} onPress={() => void suggestAccount(id, draft.payee || "")}><Text style={styles.secondaryButtonText}>✨ Suggest account</Text></Pressable> : null}
        </> : null}
        <Text style={styles.label}>Tags</Text>
        <TagChips tags={draft.tags || []} suggestions={tagSuggestions(state.transactions, draft.tags)} onChange={(tags) => void apply(updateDraft(state, id, { tags }))} />
        {isTransfer ? <View style={styles.planTaskBlock}>
          <Text style={styles.label}>{Number(draft.amount) > 0 ? "Money went to" : "Money came from"}</Text>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{accounts.filter((item) => item.id !== draft.accountId).map((item) => <Pressable key={item.id} style={[styles.choice, transferAccountId === item.id && styles.choiceActive]} onPress={() => setTransferAccountId(item.id)}><Text style={[styles.choiceText, transferAccountId === item.id && styles.choiceTextActive]}>{item.name}</Text></Pressable>)}</ScrollView>
          <View style={styles.actionRow}>
            <Pressable style={styles.primaryButton} onPress={() => void confirmTransfer(draft)}><Text style={styles.primaryButtonText}>Move to Transfers</Text></Pressable>
            <Pressable style={styles.secondarySmall} onPress={() => setTransferDraftId(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
          </View>
        </View> : null}
        {friendSplitId === id ? <SplitWithFriends state={state} payee={draft.payee || ""} total={Math.abs(Number(draft.amount))} defaultDate={draft.date || localDateKey()} defaultDirection={Number(draft.amount) < 0 ? "i_owe" : "owed_to_me"}
          onSubmit={async (shares, options) => { const done = await applySplitWithFriends(state, onSave, { type: "draft", id }, shares, options); if (done) setFriendSplitId(null); return done; }} onCancel={() => setFriendSplitId(null)} /> : null}
        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={() => void apply(acceptDraft(state, id))}><Text style={styles.primaryButtonText}>✓ Accept</Text></Pressable>
          <Pressable style={styles.secondarySmall} onPress={() => setFriendSplitId(friendSplitId === id ? null : id)}><Text style={styles.secondaryButtonText}>👥 Split</Text></Pressable>
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

// Applies a split-with-friends to a bank-stream row or ledger transaction, then (best effort) invites any friend who was given
// an email and isn't already one. Resolves true when it was applied.
async function applySplitWithFriends(state: HouseholdState, onSave: (next: HouseholdState) => Promise<void>, source: IouSource, shares: FriendShare[], options: SplitWithFriendsOptions): Promise<boolean> {
  const result = splitRecordWithFriends(state, source, shares, options, uniqueId);
  if (!result.ok) { Alert.alert("Can't split this", result.error); return false; }
  let friends = result.state.friends || [];
  for (const share of shares) if (share.email?.trim()) friends = await inviteNewFriend(share.person, share.email, state.household.name, friends);
  await onSave({ ...result.state, friends });
  return true;
}

// Splits one purchase with friends: you keep only your share as your own expense and each friend's share becomes an IOU. The
// maths is the same computeBillSplitAmounts the Shared Expenses screen uses (you are always an implicit extra person, so
// "equal" among one friend is 50/50). The caller applies the result to a bank-stream row or a ledger transaction.
function SplitWithFriends({ state, payee, total, defaultDate, defaultDirection, onSubmit, onCancel }: {
  state: HouseholdState; payee: string; total: number; defaultDate: string; defaultDirection: "i_owe" | "owed_to_me";
  onSubmit: (shares: FriendShare[], options: SplitWithFriendsOptions) => Promise<boolean>; onCancel: () => void;
}) {
  const currency = state.household.currency;
  const friends = state.friends || [];
  const [direction, setDirection] = useState<"i_owe" | "owed_to_me">(defaultDirection);
  const [splitType, setSplitType] = useState<"equal" | "exact" | "percentage">("equal");
  const [rows, setRows] = useState<Array<{ person: string; email: string; amount: string; percent: string }>>([{ person: "", email: "", amount: "", percent: "" }]);
  const [reason, setReason] = useState(payee);
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);

  const setRow = (index: number, patch: Partial<{ person: string; email: string; amount: string; percent: string }>) => setRows((prev) => prev.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  const computed = computeBillSplitAmounts(splitType, total, rows.map((row) => ({ amount: Number(row.amount) || 0, percent: Number(row.percent) || 0 })));
  const named = rows.filter((row) => row.person.trim());
  const usedNames = rows.map((row) => row.person.trim().toLowerCase());
  const submit = async () => {
    if (!computed.ok) return Alert.alert("Check the split", computed.error);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Alert.alert("Invalid date", "Use the format YYYY-MM-DD.");
    const shares: FriendShare[] = rows.map((row, index) => ({ person: row.person, amount: computed.friendAmounts[index] ?? 0, email: row.email }));
    setBusy(true);
    try { await onSubmit(shares, { direction, reason, date }); } finally { setBusy(false); }
  };

  return <View style={styles.planTaskBlock}>
    <Text style={styles.cardTitle}>Split with friends · {money(total, currency)}</Text>
    <View style={styles.choiceRow}>
      {([["owed_to_me", "I paid - they owe me"], ["i_owe", "They paid - I owe them"]] as const).map(([value, label]) => <Pressable key={value} style={[styles.choice, direction === value && styles.choiceActive]} onPress={() => setDirection(value)}><Text style={[styles.choiceText, direction === value && styles.choiceTextActive]}>{label}</Text></Pressable>)}
    </View>
    <View style={styles.choiceRow}>
      {([["equal", "Equal"], ["exact", "Exact amounts"], ["percentage", "Percent"]] as const).map(([value, label]) => <Pressable key={value} style={[styles.choice, splitType === value && styles.choiceActive]} onPress={() => setSplitType(value)}><Text style={[styles.choiceText, splitType === value && styles.choiceTextActive]}>{label}</Text></Pressable>)}
    </View>
    {rows.map((row, index) => <View key={index} style={styles.planTaskBlock}>
      <View style={styles.actionRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={row.person} onChangeText={(value) => setRow(index, { person: value })} placeholder="Friend's name" autoCapitalize="words" />
        {rows.length > 1 ? <Pressable style={styles.planStepperButton} onPress={() => setRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index))} accessibilityLabel="Remove this person"><Ionicons name="close" size={18} color={colors.coral} /></Pressable> : null}
      </View>
      {friends.filter((friend) => !usedNames.includes(friend.name.trim().toLowerCase())).length && !row.person.trim() ? <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{friends.filter((friend) => !usedNames.includes(friend.name.trim().toLowerCase())).map((friend) => <Pressable key={friend.id} style={styles.choice} onPress={() => setRow(index, { person: friend.name, email: friend.email })}><Text style={styles.choiceText}>{friend.name}</Text></Pressable>)}</ScrollView> : null}
      <TextInput style={styles.input} value={row.email} onChangeText={(value) => setRow(index, { email: value })} placeholder="Email (optional, to invite them)" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
      {splitType === "exact" ? <TextInput style={styles.input} value={row.amount} onChangeText={(value) => setRow(index, { amount: value })} placeholder="Their amount" keyboardType="decimal-pad" /> : null}
      {splitType === "percentage" ? <TextInput style={styles.input} value={row.percent} onChangeText={(value) => setRow(index, { percent: value })} placeholder="Their percent" keyboardType="decimal-pad" /> : null}
      {computed.ok ? <Text style={styles.rowDetail}>{row.person.trim() || "They"} {direction === "owed_to_me" ? "owe you" : "are owed"} {money(computed.friendAmounts[index] ?? 0, currency)}</Text> : null}
    </View>)}
    <Pressable style={styles.secondarySmall} onPress={() => setRows((prev) => [...prev, { person: "", email: "", amount: "", percent: "" }])}><Text style={styles.secondaryButtonText}>+ Add person</Text></Pressable>
    {computed.ok ? <Text style={[styles.rowTitle, { marginTop: 8 }]}>{computed.payerAmount > 0.005 ? `You keep ${money(computed.payerAmount, currency)} as your own expense` : "Nothing left for you - the row will be removed"}</Text> : <Text style={[styles.rowDetail, { color: colors.coral }]}>{computed.error}</Text>}
    <TextInput style={styles.input} value={reason} onChangeText={setReason} placeholder="What was it for?" />
    <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
    <View style={styles.actionRow}>
      <Pressable style={[styles.primaryButton, (!computed.ok || !named.length || busy) && { opacity: 0.5 }]} disabled={!computed.ok || !named.length || busy} onPress={() => void submit()}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Split it</Text>}</Pressable>
      <Pressable style={styles.secondarySmall} onPress={onCancel}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
    </View>
  </View>;
}

function SharedExpenses({ state, onSave, onBack }: { state: HouseholdState; onSave: (next: HouseholdState) => Promise<void>; onBack: () => void }) {
  const ious = state.ious || [];
  const friends = state.friends || [];
  const currency = state.household.currency;
  const today = () => localDateKey();

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
  const [compareLastYear, setCompareLastYear] = useState(false);
  const [themeKey, setThemeKey] = useState<keyof typeof REPORT_THEMES>("fresh");
  const [flowSelectedKey, setFlowSelectedKey] = useState<string | null>(null);
  const [showAllFlowTransactions, setShowAllFlowTransactions] = useState(false);

  function today() { return localDateKey(); }

  const scope: ReportScope = scopeType === "month" ? { type: "month", month: scopeMonth }
    : scopeType === "range" ? { type: "range", start: rangeStart, end: rangeEnd }
    : { type: "year", year: Number(scopeYear) || new Date().getFullYear() };
  const monthKeys = monthKeysForScope(scope, currentMonth);

  const categories = reportCategoriesForScope(state.budget.categories, state.transactions, monthKeys);
  const budgetVsActual = budgetVsActualByCategory(state.budget, state.budgetHistory || [], state.transactions, monthKeys);
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
  const theme = REPORT_THEMES[themeKey] || REPORT_THEMES.fresh!;
  const flow = flowSegments(categories, totalIncome, totalExpenses, theme.palette, theme.accent);
  // Same months one year earlier: income and spending from paychecks/transactions, net worth at the period's end.
  const priorKeys = priorYearMonthKeys(monthKeys);
  const priorCashFlow = compareLastYear ? cashFlowByMonth(state.transactions, priorKeys, (monthKey) => paycheckIncomeForMonth(state, monthKey)) : [];
  const priorIncome = priorCashFlow.reduce((sum, month) => sum + month.income, 0);
  const priorExpenses = priorCashFlow.reduce((sum, month) => sum + month.expenses, 0);
  const netWorthNow = compareLastYear && monthKeys.length ? computeNetWorthTrend(state, monthKeys).slice(-1)[0]?.value ?? 0 : 0;
  const netWorthPrior = compareLastYear && priorKeys.length ? computeNetWorthTrend(state, priorKeys).slice(-1)[0]?.value ?? 0 : 0;
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
      <Text style={styles.cardTitle}>Compare &amp; style</Text>
      <View style={styles.choiceRow}>
        <Pressable style={[styles.choice, compareLastYear && styles.choiceActive]} onPress={() => setCompareLastYear((prev) => !prev)}><Text style={[styles.choiceText, compareLastYear && styles.choiceTextActive]}>{compareLastYear ? "✓ Comparing to last year" : "Compare to last year"}</Text></Pressable>
      </View>
      <View style={styles.choiceRow}>{Object.entries(REPORT_THEMES).map(([key, option]) => <Pressable key={key} style={[styles.choice, themeKey === key && styles.choiceActive]} onPress={() => setThemeKey(key as keyof typeof REPORT_THEMES)}><Text style={[styles.choiceText, themeKey === key && styles.choiceTextActive]}>{option.label}</Text></Pressable>)}</View>
      {compareLastYear ? <>
        <Text style={styles.rowDetail}>Income {yoyLabel(yoyDelta(totalIncome, priorIncome)) || "- no figures a year ago"}</Text>
        <Text style={styles.rowDetail}>Spending {yoyLabel(yoyDelta(totalExpenses, priorExpenses)) || "- no figures a year ago"}</Text>
        <Text style={styles.rowDetail}>Net worth {yoyLabel(yoyDelta(netWorthNow, netWorthPrior)) || "- no figures a year ago"}</Text>
      </> : null}
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
  const today = () => localDateKey();
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

  // Display currency for the net-worth summary only (individual accounts and holdings stay in the household's currency). Rates
  // come from the server, cached per session; until they load, or if a rate is missing, the original amount is shown rather
  // than a guess.
  const [displayCurrency, setDisplayCurrency] = useState(currency);
  const [fxRates, setFxRates] = useState<{ rates: Record<string, number>; date: string } | null>(null);
  const [fxError, setFxError] = useState("");
  const chooseDisplayCurrency = async (code: string) => {
    setDisplayCurrency(code);
    if (code === currency || fxRates) return;
    try { const result = await api.fxRates(); setFxRates({ rates: result.rates, date: result.date }); setFxError(""); }
    catch (cause) { setFxError(cause instanceof Error ? cause.message : "Exchange rates are unavailable right now"); }
  };
  const shownCurrency = displayCurrency === currency || convertCurrency(1, currency, displayCurrency, fxRates?.rates) !== null ? displayCurrency : currency;
  const inDisplayCurrency = (amount: number) => convertCurrency(amount, currency, shownCurrency, fxRates?.rates) ?? amount;
  const allocation = assetAllocationBreakdown(netWorthAssets);
  const ALLOCATION_COLORS = { cash: colors.blue, stock: colors.green, property: colors.gold, other: colors.muted } as const;

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
  const [editingFundIndex, setEditingFundIndex] = useState<number | null>(null);
  const [fundDraft, setFundDraft] = useState({ name: "", target: "", saved: "", targetDate: "" });

  const startEditFund = (index: number) => {
    const fund = sinkingFunds[index];
    if (!fund) return;
    setFundDraft({ name: fund.name, target: String(fund.target ?? 0), saved: String(fund.saved ?? 0), targetDate: fund.targetDate || "" });
    setEditingFundIndex(index);
  };
  const saveFundEdit = async () => {
    if (editingFundIndex === null) return;
    const problem = validateGoalFields(fundDraft);
    if (problem) return Alert.alert("Check the goal", problem);
    const index = editingFundIndex;
    await onSave({ ...state, goals: { ...state.goals, sinkingFunds: sinkingFunds.map((fund, itemIndex) => itemIndex === index ? editGoalFields(fund, fundDraft) : fund) } });
    setEditingFundIndex(null);
  };

  const submitAddFund = async () => {
    if (!newFundName.trim()) return Alert.alert("Missing info", "Enter a goal name.");
    const fund: SinkingFund = { name: newFundName.trim(), target: Math.max(0, Number(newFundTarget) || 0), saved: 0, targetDate: newFundDate };
    await onSave({ ...state, goals: { ...state.goals, sinkingFunds: [...sinkingFunds, fund] } });
    setNewFundName(""); setNewFundTarget(""); setNewFundDate("");
  };

  const deleteFund = (index: number) => {
    Alert.alert("Delete this goal?", "This cannot be undone.", [{ text: "Cancel" }, {
      text: "Delete", style: "destructive", onPress: () => { setEditingFundIndex(null); void onSave({ ...state, goals: { ...state.goals, sinkingFunds: sinkingFunds.filter((_, itemIndex) => itemIndex !== index) } }); }
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
      <Text style={styles.heroValue}>{money(inDisplayCurrency(netWorthNow), shownCurrency)}</Text>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{displayCurrencyOptions(currency).map((code) => <Pressable key={code} style={[styles.choice, displayCurrency === code && styles.choiceActive]} onPress={() => void chooseDisplayCurrency(code)}><Text style={[styles.choiceText, displayCurrency === code && styles.choiceTextActive]}>{code}</Text></Pressable>)}</ScrollView>
      {shownCurrency !== currency ? <Text style={styles.muted}>Converted from {currency} using exchange rates{fxRates?.date ? ` from ${fxRates.date}` : ""}. Accounts and holdings below stay in {currency}.</Text> : null}
      {displayCurrency !== currency && shownCurrency === currency ? <Text style={styles.muted}>{fxError || "Loading exchange rates…"}</Text> : null}
      <Text style={styles.muted}>Trailing 6 months</Text>
      <View style={styles.cashFlowChart}>
        {trend.map((point) => <View key={point.month} style={styles.cashFlowColumn}>
          <View style={styles.cashFlowBars}><View style={[styles.cashFlowBar, { height: Math.max(4, (Math.abs(point.value) / maxTrend) * 100), backgroundColor: point.value >= 0 ? colors.green : colors.coral }]} /></View>
          <Text style={styles.cashFlowLabel}>{point.month.slice(5)}</Text>
        </View>)}
      </View>
    </Card>

    {allocation.length ? <Card>
      <Text style={styles.cardTitle}>Asset allocation</Text>
      <View style={styles.flowBar}>{allocation.map((segment) => <View key={segment.key} style={{ flex: segment.value, minWidth: 2, backgroundColor: ALLOCATION_COLORS[segment.key] }} />)}</View>
      {allocation.map((segment) => <View key={segment.key} style={styles.row}>
        <View style={[styles.flowDot, { backgroundColor: ALLOCATION_COLORS[segment.key] }]} />
        <View style={styles.rowCopy}><Text style={styles.rowTitle}>{segment.label}</Text><Text style={styles.rowDetail}>{segment.percent}% of your assets</Text></View>
        <Text style={styles.rowValue}>{money(segment.value, currency)}</Text>
      </View>)}
    </Card> : null}

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
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{accounts.map((account) => <Pressable key={account.id} style={[styles.choice, transferFrom === account.id && styles.choiceActive]} onPress={() => setTransferFrom(account.id)}><Text style={[styles.choiceText, transferFrom === account.id && styles.choiceTextActive]}>{account.name}{account.closedAt ? " (closed)" : ""}</Text></Pressable>)}</ScrollView>
        <Text style={styles.label}>To</Text>
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{accounts.map((account) => <Pressable key={account.id} style={[styles.choice, transferTo === account.id && styles.choiceActive]} onPress={() => setTransferTo(account.id)}><Text style={[styles.choiceText, transferTo === account.id && styles.choiceTextActive]}>{account.name}{account.closedAt ? " (closed)" : ""}</Text></Pressable>)}</ScrollView>
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
            <Pressable accessibilityLabel={`Edit ${fund.name}`} hitSlop={8} onPress={() => startEditFund(index)}><Ionicons name="create-outline" size={18} color={colors.text} /></Pressable>
            <Pressable accessibilityLabel={`Delete ${fund.name}`} hitSlop={8} onPress={() => deleteFund(index)}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
          </View>
          {editingFundIndex === index ? <View>
            <Text style={styles.label}>Goal name</Text>
            <TextInput style={styles.input} value={fundDraft.name} onChangeText={(name) => setFundDraft({ ...fundDraft, name })} />
            <Text style={styles.label}>Target amount</Text>
            <TextInput style={styles.input} value={fundDraft.target} onChangeText={(target) => setFundDraft({ ...fundDraft, target })} keyboardType="decimal-pad" />
            <Text style={styles.label}>Saved so far</Text>
            <TextInput style={styles.input} value={fundDraft.saved} onChangeText={(saved) => setFundDraft({ ...fundDraft, saved })} keyboardType="decimal-pad" />
            <Text style={styles.label}>Target date (YYYY-MM-DD, optional)</Text>
            <TextInput style={styles.input} value={fundDraft.targetDate} onChangeText={(targetDate) => setFundDraft({ ...fundDraft, targetDate })} placeholder="2026-12-31" autoCapitalize="none" />
            <View style={styles.actionRow}>
              <Pressable style={[styles.secondarySmall, { flex: 1 }]} onPress={() => setEditingFundIndex(null)}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable>
              <Pressable style={[styles.primaryButton, { flex: 1, marginTop: 0 }]} onPress={() => void saveFundEdit()}><Text style={styles.primaryButtonText}>Save goal</Text></Pressable>
            </View>
          </View> : null}
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
  const today = () => localDateKey();

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

  // Editing an existing paycheck (web edits every field in place): text fields are saved together, repeat and deposit account apply
  // at once. Changing the date/repeat/end date needs no extra work - this screen's effect above regenerates pay dates when the
  // paycheck no longer matches what they were generated under.
  const [editingPaycheckId, setEditingPaycheckId] = useState<string | null>(null);
  const [paycheckDraft, setPaycheckDraft] = useState({ name: "", amount: "", date: "", endDate: "" });
  const [picker, setPicker] = useState<{ kind: "deposit" | "line"; paycheckId: string } | null>(null);
  const [assignAmount, setAssignAmount] = useState("");
  const lines = state.budget.categories.flatMap((category) => category.lines.map((line) => ({ ...line, category: category.name })));
  const applyPaycheckPatch = async (paycheckId: string, patch: Parameters<typeof updatePaycheck>[2]) => {
    const problem = validatePaycheckPatch(patch);
    if (problem) return Alert.alert("Check the paycheck", problem);
    const result = updatePaycheck({ paychecks, paycheckOccurrences: occurrences }, paycheckId, patch);
    await onSave({ ...state, paychecks: result.paychecks, paycheckOccurrences: result.paycheckOccurrences });
  };
  const startEditPaycheck = (paycheck: Paycheck) => {
    setPaycheckDraft({ name: paycheck.name, amount: String(paycheck.amount), date: paycheck.date, endDate: paycheck.endDate || "" });
    setEditingPaycheckId(paycheck.id); setPicker(null); setAssignAmount("");
  };
  const savePaycheckDraft = async () => {
    if (!editingPaycheckId) return;
    await applyPaycheckPatch(editingPaycheckId, { name: paycheckDraft.name, amount: Number(paycheckDraft.amount), date: paycheckDraft.date, endDate: paycheckDraft.endDate });
    setEditingPaycheckId(null);
  };
  const assignLine = async (paycheckId: string, lineId: string) => {
    const amount = assignAmount.trim() === "" ? null : Number(assignAmount);
    if (amount !== null && !(amount >= 0)) return Alert.alert("Check the amount", "Enter an amount of zero or more, or leave it empty.");
    await onSave(assignBillToPaycheck(state, paycheckId, lineId, amount));
    setAssignAmount("");
  };
  const lineLabel = (lineId: string) => { const line = lines.find((item) => item.id === lineId); return line ? `${line.category} - ${line.name}` : "Removed line"; };

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
                <TextInput key={occurrence.date} style={[styles.input, { height: 38, marginTop: 4 }]} defaultValue={occurrence.date} autoCapitalize="none" accessibilityLabel="Pay date" onEndEditing={(event) => {
                  const date = event.nativeEvent.text.trim();
                  if (date === occurrence.date) return;
                  const problem = validatePaycheckPatch({ date });
                  if (problem) return Alert.alert("Check the date", problem);
                  void onSave({ ...state, paycheckOccurrences: setOccurrenceDate(occurrences, occurrence.id, date) });
                }} />
              </View>
              <TextInput style={[styles.input, { width: 100, height: 42 }]} defaultValue={String(occurrence.amount)} onEndEditing={(event) => updateOccurrenceAmount(occurrence.id, event.nativeEvent.text)} keyboardType="decimal-pad" />
              <Pressable style={styles.planStepperButton} onPress={() => deleteOccurrence(occurrence.id)}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
            </View>;
          })
        : <Text style={styles.muted}>No pay dates this month</Text>}
    </Card>

    <Card>
      <Text style={styles.cardTitle}>All paychecks</Text>
      {paychecks.length ? paychecks.map((paycheck) => {
        const isEditing = editingPaycheckId === paycheck.id;
        const active = paycheckActiveInMonth(paycheck, currentMonth);
        const income = paycheckMonthlyIncome(paycheck, occurrences, currentMonth);
        const assigned = paycheckAssignedAmount(paycheck, lines);
        return <View key={paycheck.id} style={[styles.row, { flexDirection: "column", alignItems: "stretch" }]}>
          <View style={styles.iouPersonHead}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{paycheck.name}</Text>
              <Text style={styles.rowDetail}>{PAYCHECK_RECURRENCE_LABELS[paycheck.recurrence || "once"]} · Since {paycheck.date}{paycheck.endDate ? ` · Ends ${paycheck.endDate}` : ""}{paycheck.depositAccountId ? ` · to ${(state.accounts || []).find((account) => account.id === paycheck.depositAccountId)?.name || "account"}` : ""}</Text>
            </View>
            <Text style={styles.rowValue}>{money(paycheck.amount, currency)}</Text>
            <Pressable accessibilityLabel={`Edit ${paycheck.name}`} hitSlop={8} onPress={() => isEditing ? setEditingPaycheckId(null) : startEditPaycheck(paycheck)}><Ionicons name={isEditing ? "chevron-up" : "create-outline"} size={20} color={colors.text} /></Pressable>
            <Pressable style={styles.planStepperButton} onPress={() => deletePaycheck(paycheck.id)}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
          </View>
          {active ? <Text style={styles.rowDetail}>This month: income {money(income, currency)} · assigned to bills {money(assigned, currency)} · {money(income - assigned, currency)} unassigned</Text> : null}
          {isEditing ? <View>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={paycheckDraft.name} onChangeText={(name) => setPaycheckDraft({ ...paycheckDraft, name })} />
            <Text style={styles.label}>Amount</Text>
            <TextInput style={styles.input} value={paycheckDraft.amount} onChangeText={(amount) => setPaycheckDraft({ ...paycheckDraft, amount })} keyboardType="decimal-pad" />
            <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} value={paycheckDraft.date} onChangeText={(date) => setPaycheckDraft({ ...paycheckDraft, date })} autoCapitalize="none" />
            {paycheck.recurrence !== "once" && paycheck.recurrence !== "bonus" ? <>
              <Text style={styles.label}>End date (optional)</Text>
              <TextInput style={styles.input} value={paycheckDraft.endDate} onChangeText={(endDate) => setPaycheckDraft({ ...paycheckDraft, endDate })} autoCapitalize="none" placeholder="YYYY-MM-DD" />
            </> : null}
            <Pressable style={styles.primaryButton} onPress={() => void savePaycheckDraft()}><Text style={styles.primaryButtonText}>Save changes</Text></Pressable>
            <Text style={styles.label}>Repeats</Text>
            <View style={styles.choiceRow}>
              {(Object.keys(PAYCHECK_RECURRENCE_LABELS) as PaycheckRecurrence[]).map((value) => <Pressable key={value} style={[styles.choice, (paycheck.recurrence || "once") === value && styles.choiceActive]} onPress={() => void applyPaycheckPatch(paycheck.id, { recurrence: value })}>
                <Text style={[styles.choiceText, (paycheck.recurrence || "once") === value && styles.choiceTextActive]}>{PAYCHECK_RECURRENCE_LABELS[value]}</Text>
              </Pressable>)}
            </View>
            {accounts.length ? <>
              <Pressable style={[styles.secondarySmall, { marginTop: 8 }]} onPress={() => setPicker({ kind: "deposit", paycheckId: paycheck.id })}><Text style={styles.secondaryButtonText}>Deposit to: {accounts.find((account) => account.id === paycheck.depositAccountId)?.name || "Not linked"}</Text></Pressable>
              {picker?.kind === "deposit" && picker.paycheckId === paycheck.id ? <OptionList title="Deposit to" onClose={() => setPicker(null)} options={[{ label: "Not linked", onPress: () => void applyPaycheckPatch(paycheck.id, { depositAccountId: "" }) }, ...accounts.filter((account) => account.type !== "credit_card").map((account) => ({ label: account.name, onPress: () => void applyPaycheckPatch(paycheck.id, { depositAccountId: account.id }) }))]} /> : null}
            </> : null}
            <Text style={styles.label}>Bills paid from this income</Text>
            {paycheck.assignedLineIds.length ? paycheck.assignedLineIds.map((lineId) => <View key={lineId} style={styles.checkRow}>
              <Text style={[styles.rowDetail, { flex: 1 }]}>{lineLabel(lineId)}</Text>
              <Pressable accessibilityLabel={`Remove ${lineLabel(lineId)}`} hitSlop={8} onPress={() => void onSave({ ...state, paychecks: removeAssignedLine(paychecks, paycheck.id, lineId) })}><Ionicons name="close" size={18} color={colors.coral} /></Pressable>
            </View>) : <Text style={styles.muted}>None assigned yet</Text>}
            <TextInput style={styles.input} value={assignAmount} onChangeText={setAssignAmount} placeholder="Planned amount for the bill (optional)" keyboardType="decimal-pad" />
            <Pressable style={styles.secondarySmall} onPress={() => setPicker({ kind: "line", paycheckId: paycheck.id })}><Text style={styles.secondaryButtonText}>Assign a bill</Text></Pressable>
            {picker?.kind === "line" && picker.paycheckId === paycheck.id ? <OptionList title="Assign which subcategory?" onClose={() => setPicker(null)} options={lines.map((line) => ({ label: `${line.category} - ${line.name}`, onPress: () => void assignLine(paycheck.id, line.id) }))} /> : null}
          </View> : null}
        </View>;
      }) : <Text style={styles.muted}>No paychecks yet</Text>}
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

function More({ state, user, households, onSelect, onSignOut, onOpenSharedExpenses, onOpenReports, onOpenWealth, onOpenBills, onOpenPaychecks, onOpenDecisions, onOpenBankStream, onOpenRecipes, onOpenProfile, onOpenSharing, onOpenHelp }: { state: HouseholdState; user: User; households: Household[]; onSelect: (id: string) => Promise<void>; onSignOut: () => Promise<void>; onOpenSharedExpenses: () => void; onOpenReports: () => void; onOpenWealth: () => void; onOpenBills: () => void; onOpenPaychecks: () => void; onOpenDecisions: () => void; onOpenBankStream: () => void; onOpenRecipes: () => void; onOpenProfile: () => void; onOpenSharing: () => void; onOpenHelp: () => void }) {
  const assets = state.goals?.netWorth?.assets.reduce((sum, item) => sum + mobileAssetValue(item), 0) || 0;
  const liabilities = state.goals?.netWorth?.liabilities.reduce((sum, item) => sum + Number(item.value || 0), 0) || 0;
  return <Page><Title eyebrow="ACCOUNT">More</Title><Card><Text style={styles.cardTitle}>{user.name}</Text><Text style={styles.muted}>{user.email}</Text><Pressable style={styles.householdRow} onPress={onOpenProfile}><View><Text style={styles.rowTitle}>Profile</Text><Text style={styles.rowDetail}>Name, email verification, password</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={[styles.householdRow, { borderBottomWidth: 0 }]} onPress={onOpenSharing}><View><Text style={styles.rowTitle}>Sharing</Text><Text style={styles.rowDetail}>Members, invites, who can edit, shared areas</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable></Card><Pressable style={styles.card} onPress={onOpenWealth}><View style={styles.iouPersonHead}><Text style={styles.cardTitle}>Household wealth</Text><Ionicons name="chevron-forward" size={20} color={colors.muted} /></View><Text style={styles.heroValue}>{money(assets - liabilities, state.household.currency)}</Text><Text style={styles.muted}>Assets {money(assets, state.household.currency)} · Liabilities {money(liabilities, state.household.currency)}</Text><Text style={styles.muted}>{(state.accounts || []).length} accounts · {state.goals?.debts?.length || 0} debt accounts with EMI plans</Text></Pressable><Card><Text style={styles.cardTitle}>Households</Text>{households.map((item) => <Pressable key={item.id} style={styles.householdRow} onPress={() => void onSelect(item.id)}><View><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.rowDetail}>{item.country} · {item.currency} · {item.role}</Text></View>{item.selected ? <Ionicons name="checkmark-circle" size={24} color={colors.green} /> : <Ionicons name="chevron-forward" size={20} color={colors.muted} />}</Pressable>)}</Card><Card><Text style={styles.cardTitle}>Money</Text><Pressable style={styles.householdRow} onPress={onOpenPaychecks}><View><Text style={styles.rowTitle}>Paycheck/Income</Text><Text style={styles.rowDetail}>Recurring income and pay dates</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={styles.householdRow} onPress={onOpenBankStream}><View><Text style={styles.rowTitle}>Bank stream</Text><Text style={styles.rowDetail}>{(state.transactionInboxDrafts || []).filter((item) => !(state.transactionInboxDone || []).includes(item.id || "")).length} waiting · import statements, review, accept</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={styles.householdRow} onPress={onOpenBills}><View><Text style={styles.rowTitle}>Bills</Text><Text style={styles.rowDetail}>Upcoming and overdue, by category</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={styles.householdRow} onPress={onOpenSharedExpenses}><View><Text style={styles.rowTitle}>Shared Expenses</Text><Text style={styles.rowDetail}>Split bills, track IOUs, manage friends</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable><Pressable style={[styles.householdRow, { borderBottomWidth: 0 }]} onPress={onOpenReports}><View><Text style={styles.rowTitle}>Reports</Text><Text style={styles.rowDetail}>Category, budget vs actual, tags</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable></Card><Card><Text style={styles.cardTitle}>Family</Text><Pressable style={[styles.householdRow, { borderBottomWidth: 0 }]} onPress={onOpenDecisions}><View><Text style={styles.rowTitle}>Decisions</Text><Text style={styles.rowDetail}>{(state.decisions || []).filter((item) => item.status !== "decided").length} open · weigh pros and cons together</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable></Card><Pressable style={styles.card} onPress={onOpenRecipes}><View style={styles.iouPersonHead}><Text style={styles.cardTitle}>Recipes</Text><Ionicons name="chevron-forward" size={20} color={colors.muted} /></View><Text style={styles.muted}>{state.meals.plannedWeek.length} planned meals · {state.meals.recipes.length} saved recipes · add, edit, search</Text></Pressable><Pressable style={styles.card} onPress={onOpenHelp}><View style={styles.iouPersonHead}><Text style={styles.cardTitle}>Help</Text><Ionicons name="chevron-forward" size={20} color={colors.muted} /></View><Text style={styles.muted}>Short guides for every part of the app</Text></Pressable><Pressable style={styles.dangerButton} onPress={() => Alert.alert("Sign out?", "You will need to sign in again.", [{ text: "Cancel" }, { text: "Sign out", style: "destructive", onPress: () => void onSignOut() }])}><Text style={styles.dangerText}>Sign out</Text></Pressable></Page>;
}

function Row({ title, detail, value, badge }: { title: string; detail: string; value?: string; badge?: string }) { return <View style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>{value ? <Text style={styles.rowValue}>{value}</Text> : null}{badge ? <Text style={styles.badge}>{badge}</Text> : null}</View>; }

export default function App() { return <SafeAreaProvider><AppContent /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background }, centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  header: { height: 68, paddingHorizontal: 20, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, brand: { fontSize: 22, fontWeight: "800", color: colors.text }, household: { marginTop: 2, color: colors.muted, fontSize: 13 }, saved: { flexDirection: "row", gap: 5, alignItems: "center" }, savedText: { color: colors.green, fontWeight: "700" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 14 }, headerIcon: { padding: 4 },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }, searchInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 8 }, searchClose: { color: colors.green, fontWeight: "700" },
  searchResult: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 3 }, searchResultTitle: { fontWeight: "700", color: colors.text, fontSize: 15 },
  onboardingBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 24 }, onboardingActions: { flexDirection: "row", gap: 8 }, onboardingAction: { flex: 1 }, onboardingCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, gap: 12 },
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
  tagChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.greenSoft }, tagChipText: { color: colors.green, fontWeight: "700", fontSize: 13 }, tagInput: { minWidth: 96, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 13 },
  iouPersonHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, decisionColumn: { marginTop: 10 },
  reportSubcategoryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  cashFlowChart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", height: 120, marginTop: 10 }, cashFlowColumn: { alignItems: "center", gap: 6 }, cashFlowBars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 100 }, cashFlowBar: { width: 12, borderRadius: 3 }, cashFlowLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" }, cashFlowLegendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden", marginTop: 8 }, progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.green }
});
