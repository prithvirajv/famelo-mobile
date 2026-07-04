import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

// These are static source checks, not runtime verification — real push registration and
// delivery behavior can only be confirmed on a physical device via a development build
// (Expo Go does not support remote push notifications on SDK 53+).

test("mobile API exposes push device registration", () => {
  const source = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(source, /registerPushDevice/);
  assert.match(source, /\/api\/push-devices/);
});

test("push registration guards on physical device and requests permission", () => {
  const source = fs.readFileSync(new URL("../src/push.ts", import.meta.url), "utf8");
  assert.match(source, /Device\.isDevice/);
  assert.match(source, /getPermissionsAsync/);
  assert.match(source, /requestPermissionsAsync/);
  assert.match(source, /getExpoPushTokenAsync/);
  assert.match(source, /registerPushDevice/);
});

test("App wires push registration to the authenticated session", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /registerPushToken/);
  assert.match(app, /AppState/);
});

test("package.json declares the push notification dependencies", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const dependency of ["expo-notifications", "expo-device", "expo-constants", "@react-native-async-storage/async-storage"]) {
    assert.ok(packageJson.dependencies[dependency], `expected ${dependency} in dependencies`);
  }
});

test("mobile note checklist type and rendering support parentId nesting", () => {
  const types = fs.readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.match(types, /parentId\?:\s*string/);
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /checkRowChild/);
});
