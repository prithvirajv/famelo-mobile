import type { Household, HouseholdAccess, HouseholdState, User } from "./types";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://famelo.net").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...options.headers }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.error || "Request failed", response.status);
  return body as T;
}

export const api = {
  session: () => request<{ authenticated: boolean; user: User | null }>("/api/session"),
  signIn: (email: string, password: string) => request<{ user: User }>("/api/auth/signin", {
    method: "POST", body: JSON.stringify({ email, password })
  }),
  demo: () => request<{ user: User }>("/api/auth/demo", { method: "POST" }),
  signOut: () => request<{ ok: boolean }>("/api/auth/signout", { method: "POST" }),
  households: () => request<Household[]>("/api/households"),
  householdAccess: () => request<HouseholdAccess>("/api/households/access"),
  selectHousehold: (householdId: string) => request<{ ok: boolean }>("/api/households/select", {
    method: "POST", body: JSON.stringify({ householdId })
  }),
  state: () => request<HouseholdState>("/api/state"),
  saveState: (state: HouseholdState) => request<{ ok: boolean }>("/api/state", {
    method: "PUT", body: JSON.stringify(state)
  })
};
