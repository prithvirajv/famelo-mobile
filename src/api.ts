import type { ParsedBankRow } from "./bankStreamLogic";
import type { ReminderPhotoDraft, Document, DocumentFolder, DocumentsData, Household, HouseholdAccess, HouseholdState, PrivateData, User, WealthItemType } from "./types";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://familyloop.net").replace(/\/$/, "");

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
  if (!response.ok) {
    // The server caps ordinary JSON bodies at 1 MB and replies with a non-JSON error page, which would otherwise surface as a
    // meaningless "Request failed" - and the whole household state is saved in one request, so this is the one that matters.
    if (response.status === 413) throw new ApiError("That is too much data to save - household data is limited to about 1 MB. Remove some old items (for example unreviewed Bank stream rows) and try again.", 413);
    throw new ApiError(body.error || "Request failed", response.status);
  }
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
  }),
  registerPushDevice: (token: string, platform: string) => request<{ ok: boolean }>("/api/push-devices", {
    method: "POST", body: JSON.stringify({ token, platform })
  }),
  inviteFriend: (name: string, email: string, inviterName: string) => request<{ ok: boolean; email: unknown }>("/api/friends/invite", {
    method: "POST", body: JSON.stringify({ name, email, inviterName })
  }),
  privateData: () => request<PrivateData>("/api/private-data"),
  saveJournal: (journal: PrivateData["journal"]) => request<{ ok: boolean }>("/api/private-data/journal", {
    method: "PUT", body: JSON.stringify(journal)
  }),
  savePlans: (plans: PrivateData["plans"]) => request<{ ok: boolean }>("/api/private-data/plans", {
    method: "PUT", body: JSON.stringify(plans)
  }),
  documents: () => request<DocumentsData>("/api/documents"),
  createDocumentFolder: (name: string, parentId: string | null) => request<DocumentFolder>("/api/documents/folders", {
    method: "POST", body: JSON.stringify({ name, parentId })
  }),
  deleteDocumentFolder: (folderId: string) => request<{ ok: boolean }>(`/api/documents/folders/${folderId}`, { method: "DELETE" }),
  updateDocumentFolder: (folderId: string, patch: { name?: string; parentId?: string | null; wealthItemType?: WealthItemType | null; wealthItemId?: string | null }) =>
    request<DocumentFolder>(`/api/documents/folders/${folderId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  requestDocumentUploadUrl: (params: { name: string; contentType: string; sizeBytes: number; folderId: string | null; noteId?: string | null }) =>
    request<{ documentId: string; uploadUrl: string; expiresAt: number }>("/api/documents/upload-url", {
      method: "POST", body: JSON.stringify(params)
    }),
  confirmDocumentUpload: (documentId: string) => request<Document>(`/api/documents/${documentId}/confirm`, { method: "POST" }),
  documentDownloadUrl: (documentId: string) => request<{ url: string; expiresAt: number }>(`/api/documents/${documentId}/download-url`),
  updateDocument: (documentId: string, patch: { name?: string; description?: string; folderId?: string | null; noteId?: string | null; wealthItemType?: WealthItemType | null; wealthItemId?: string | null; expiryDate?: string | null }) =>
    request<Document>(`/api/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteDocument: (documentId: string) => request<{ ok: boolean }>(`/api/documents/${documentId}`, { method: "DELETE" }),
  reminderFromImage: (imageBase64: string, mimeType: string) => request<ReminderPhotoDraft>("/api/calendar/reminder-from-image", {
    method: "POST", body: JSON.stringify({ imageBase64, mimeType })
  }),
  parseBankStatementPdf: (fileBase64: string) => request<{ rows: ParsedBankRow[]; accountHint: string }>("/api/bank-statement/parse-pdf", { method: "POST", body: JSON.stringify({ fileBase64 }) }),
  // AI fallbacks for a bank-stream row with no history match; each returns null when nothing is a confident match.
  suggestTransactionSubcategory: (payee: string, lines: Array<{ id: string; label: string }>) => request<{ lineId: string | null }>("/api/transactions/suggest-subcategory", { method: "POST", body: JSON.stringify({ payee, lines }) }),
  suggestTransactionAccount: (payee: string, accounts: Array<{ id: string; label: string }>) => request<{ accountId: string | null }>("/api/transactions/suggest-account", { method: "POST", body: JSON.stringify({ payee, accounts }) }),
  fxRates: () => request<{ base: string; rates: Record<string, number>; date: string }>("/api/fx-rates"),
  stockQuote: (symbol: string) => request<{ symbol: string; price: number }>(`/api/stock-quote?symbol=${encodeURIComponent(symbol)}`),
  openDocument: (documentId: string) => request<Document>(`/api/documents/${documentId}/open`, { method: "POST" })
};
