import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("mobile app exposes Journal and Plan tabs", () => {
  const source = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(source, /label: "Journal"/);
  assert.match(source, /label: "Plan"/);
  assert.match(source, /"journal" \| "plan"/);
});

test("mobile API exposes private-data journal and plan endpoints", () => {
  const source = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(source, /privateData/);
  assert.match(source, /saveJournal/);
  assert.match(source, /savePlans/);
  assert.match(source, /\/api\/private-data/);
  assert.match(source, /\/api\/private-data\/journal/);
  assert.match(source, /\/api\/private-data\/plans/);
});

test("Journal screen uses expo-image-picker and never shared messaging", () => {
  const source = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(source, /expo-image-picker/);
  assert.match(source, /requestMediaLibraryPermissionsAsync/);
  assert.match(source, /launchImageLibraryAsync/);
  assert.match(source, /never shared with other household members/);
});

test("package.json declares the image picker dependency", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageJson.dependencies["expo-image-picker"], "expected expo-image-picker in dependencies");
});

test("Plan screen wires up Daily timeline navigation, recurrence, duration, and subtasks", () => {
  const source = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(source, /dailyTaskOccursOnDate/);
  assert.match(source, /isDailyTaskDoneOnDate/);
  assert.match(source, /toggleDailyTaskDoneOnDate/);
  assert.match(source, /shiftDay/);
  assert.match(source, /planRecurrenceLabels/);
  assert.match(source, /adjustDuration/);
  assert.match(source, /addSubtask/);
  assert.match(source, /toggleSubtask/);
  assert.match(source, /deleteSubtask/);
});

test("app.json configures the expo-image-picker permission plugin", () => {
  const appJson = JSON.parse(fs.readFileSync(new URL("../app.json", import.meta.url), "utf8"));
  const plugins = appJson.expo.plugins || [];
  const hasImagePickerPlugin = plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === "expo-image-picker");
  assert.ok(hasImagePickerPlugin, "expected expo-image-picker plugin configuration in app.json");
});
