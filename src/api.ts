import type { Document, DocumentFolder, DocumentsData, Household, HouseholdAccess, HouseholdState, PrivateData, User, WealthItemType } from "./types";

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
  }),
  registerPushDevice: (token: string, platform: string) => request<{ ok: boolean }>("/api/push-devices", {
    method: "POST", body: JSON.stringify({ token, platform })
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
  updateDocument: (documentId: string, patch: { name?: string; description?: string; folderId?: string | null; noteId?: string | null; wealthItemType?: WealthItemType | null; wealthItemId?: string | null }) =>
    request<Document>(`/api/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteDocument: (documentId: string) => request<{ ok: boolean }>(`/api/documents/${documentId}`, { method: "DELETE" })
};
