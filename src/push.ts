import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

const TOKEN_STORAGE_KEY = "familyloop:push-token";
const PERMISSION_DENIED_KEY = "familyloop:push-permission-denied";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

function resolveProjectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

export async function registerPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const projectId = resolveProjectId();
    if (!projectId) {
      console.warn("FamilyLoop push: no EAS projectId configured in app.json, skipping registration");
      return;
    }

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== "granted") {
      if (await AsyncStorage.getItem(PERMISSION_DENIED_KEY)) return;
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
      if (status !== "granted") {
        await AsyncStorage.setItem(PERMISSION_DENIED_KEY, "true");
        return;
      }
    }
    await AsyncStorage.removeItem(PERMISSION_DENIED_KEY);

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    const lastRegisteredToken = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    if (lastRegisteredToken === token.data) return;

    await api.registerPushDevice(token.data, Platform.OS);
    await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token.data);
  } catch (error) {
    console.warn("FamilyLoop push registration failed:", error instanceof Error ? error.message : error);
  }
}
