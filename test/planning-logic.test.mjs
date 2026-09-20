import assert from "node:assert/strict";
import test from "node:test";
import { applyChecklistToggle, firstWeekDayDates, formatShortDate, groceryListFor, groceryEstimateAmount, recurringBudgetSetAside, nextRecurringBudgetDueDate, mealWeeksForMonth, currentMealWeekNumber, weekDayDatesForWeek } from "../src/planningLogic.ts";

test("checking a child marks the parent done once every sibling is done", () => {
  const checklist = [
    { id: "parent", text: "Kanampalayam land", done: false },
    { id: "child", text: "Check Patta", done: false, parentId: "parent" }
  ];
  const result = applyChecklistToggle(checklist, "child", true);
  assert.equal(result.find((item) => item.id === "child").done, true);
  assert.equal(result.find((item) => item.id === "parent").done, true);
});

test("checking a parent directly cascades done to all its children", () => {
  const checklist = [
    { id: "parent", text: "Kanampalayam land", done: false },
    { id: "child-1", text: "Check Patta", done: false, parentId: "parent" },
    { id: "child-2", text: "Pay property tax", done: false, parentId: "parent" }
  ];
  const result = applyChecklistToggle(checklist, "parent", true);
  assert.equal(result.find((item) => item.id === "child-1").done, true);
  assert.equal(result.find((item) => item.id === "child-2").done, true);
});

test("unchecking one child un-completes an auto-completed parent", () => {
  const checklist = [
    { id: "parent", text: "Kanampalayam land", done: true },
    { id: "child-1", text: "Check Patta", done: true, parentId: "parent" },
    { id: "child-2", text: "Pay property tax", done: true, parentId: "parent" }
  ];
  const result = applyChecklistToggle(checklist, "child-1", false);
  assert.equal(result.find((item) => item.id === "parent").done, false);
  assert.equal(result.find((item) => item.id === "child-2").done, true);
});

test("toggling a standalone item only affects itself", () => {
  const checklist = [{ id: "solo", text: "Water the plants", done: false }];
  const result = applyChecklistToggle(checklist, "solo", true);
  assert.equal(result.find((item) => item.id === "solo").done, true);
});

test("firstWeekDayDates returns seven Monday-anchored days for the given month", () => {
  const days = firstWeekDayDates("2026-07");
  assert.equal(days.length, 7);
  assert.equal(days[0].day, "Monday");
  assert.equal(days[0].date.getDay(), 1);
  assert.equal(formatShortDate(days[0].date), "Jun 29");
  assert.equal(formatShortDate(days[2].date), "Jul 1");
});

test("mealWeeksForMonth splits a month into Monday-anchored weeks with unclamped real-span labels", () => {
  const weeks = mealWeeksForMonth("2026-07");
  assert.equal(weeks[0].number, 1);
  // July 2026 starts on a Wednesday, so week 1's real Monday-Sunday span spills back into June -
  // the label reflects that real span rather than clamping to "Jul 1-Jul 5", which would
  // misrepresent the 7-day week the grid actually renders underneath it.
  assert.equal(weeks[0].label, "Jun 29–Jul 5");
  assert.equal(weeks[0].start.getDay(), 1, "each week should start on a Monday");
});

test("mealWeeksForMonth week start dates advance by exactly 7 days", () => {
  const weeks = mealWeeksForMonth("2026-07");
  for (let index = 1; index < weeks.length; index += 1) {
    const diffDays = (weeks[index].start.getTime() - weeks[index - 1].start.getTime()) / 86400000;
    assert.equal(diffDays, 7);
  }
});

test("currentMealWeekNumber returns the week containing today's date", () => {
  const weeks = mealWeeksForMonth("2026-07");
  // July 14 2026 falls in week 3 (Jul 13-Jul 19).
  assert.equal(currentMealWeekNumber("2026-07", new Date(2026, 6, 14)), 3);
  assert.equal(weeks.find((week) => week.number === 3)?.label, "Jul 13–Jul 19");
});

test("currentMealWeekNumber falls back to week 1 when today isn't in the given month", () => {
  assert.equal(currentMealWeekNumber("2026-07", new Date(2026, 8, 1)), 1);
});

test("weekDayDatesForWeek returns the correct 7-day span for a week past the first", () => {
  const days = weekDayDatesForWeek("2026-07", 3);
  assert.equal(days.length, 7);
  assert.equal(formatShortDate(days[0].date), "Jul 13");
  assert.equal(formatShortDate(days[6].date), "Jul 19");
});

test("groceryListFor deduplicates ingredients across planned meals and ignores unplanned recipes", () => {
  const recipes = [
    { id: "pizza-night", name: "Pizza night", ingredients: ["pizza dough", "mozzarella", "sauce", "salad greens"], calories: 700, protein: 30 },
    { id: "turkey-chili", name: "Turkey chili", ingredients: ["ground turkey", "beans", "tomatoes", "onion"], calories: 520, protein: 38 }
  ];
  const plannedMeals = [
    { day: "Monday", slot: "Breakfast", meal: "Pizza night", recipeId: "pizza-night", servings: 3 },
    { day: "Tuesday", slot: "Breakfast", meal: "Pizza night", recipeId: "pizza-night", servings: 3 }
  ];
  assert.deepEqual(groceryListFor(plannedMeals, recipes), ["pizza dough", "mozzarella", "sauce", "salad greens"]);
});

test("groceryEstimateAmount scales with the actual grocery list instead of a fixed number", () => {
  const recipes = [{ id: "pizza-night", name: "Pizza night", ingredients: ["pizza dough", "mozzarella", "sauce", "salad greens"], calories: 700, protein: 30 }];
  assert.equal(groceryEstimateAmount([], recipes), 0);
  assert.equal(groceryEstimateAmount([{ day: "Monday", slot: "Breakfast", meal: "Pizza night", recipeId: "pizza-night", servings: 3 }], recipes), 28);
});

test("recurringBudgetSetAside divides annual and quarterly bills across remaining months", () => {
  assert.equal(nextRecurringBudgetDueDate({ amount: 1200, frequency: "yearly", dueDate: "2026-12-15" }, "2026-07"), "2026-12-15");
  assert.deepEqual(recurringBudgetSetAside({ amount: 1200, frequency: "yearly", dueDate: "2026-12-15" }, "2026-07"), {
    amountDue: 1200,
    frequency: "yearly",
    nextDueDate: "2026-12-15",
    monthsRemaining: 6,
    monthlyAmount: 200
  });
  assert.equal(recurringBudgetSetAside({ amount: 600, frequency: "quarterly", dueDate: "2026-09-30" }, "2026-07").monthlyAmount, 200);
});
