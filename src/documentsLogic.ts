import type { Document, DocumentFolder } from "./types";

export function formatFileSize(sizeBytes: number | null | undefined): string {
  const size = Number(sizeBytes) || 0;
  if (size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function folderPath(folders: DocumentFolder[], folderId: string | null): DocumentFolder[] {
  const path: DocumentFolder[] = [];
  let cursor = folders.find((folder) => folder.id === folderId) || null;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentId ? folders.find((folder) => folder.id === cursor!.parentId) || null : null;
  }
  return path;
}

export function childFolders(folders: DocumentFolder[], parentId: string | null): DocumentFolder[] {
  return folders.filter((folder) => (folder.parentId || null) === (parentId || null));
}

export function documentsInFolder(documents: Document[], folderId: string | null): Document[] {
  return documents.filter((document) => (document.folderId || null) === (folderId || null));
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type DocumentExpiryBadge = { label: string; tone: "danger" | "warning" | "neutral" };

// Color-coded the same way web's documentExpiryBadge is: the closer the expiration, the more
// urgent the tone, so a household scanning Documents can spot an about-to-lapse insurance
// policy or lease without opening each file.
export function documentExpiryBadge(expiryDate: string | null | undefined, today: Date = new Date()): DocumentExpiryBadge | null {
  if (!expiryDate) return null;
  const days = Math.ceil((new Date(`${expiryDate}T00:00:00`).getTime() - new Date(`${dateKey(today)}T00:00:00`).getTime()) / 86400000);
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, tone: "danger" };
  if (days <= 30) return { label: `Expires in ${days}d`, tone: "danger" };
  if (days <= 90) return { label: `Expires in ${days}d`, tone: "warning" };
  return { label: `Expires ${expiryDate}`, tone: "neutral" };
}

export function documentOpenedLabel(lastOpenedAt: string | null | undefined, lastOpenedByName: string | null | undefined, viewerName: string | undefined): string {
  if (!lastOpenedAt) return "Not opened yet";
  const isYou = Boolean(lastOpenedByName) && lastOpenedByName === viewerName;
  const who = isYou ? "You" : lastOpenedByName || "Someone";
  return `${who} opened · ${new Date(lastOpenedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function wouldCreateFolderCycle(folders: DocumentFolder[], folderId: string, newParentId: string | null): boolean {
  if (!newParentId) return false;
  if (folderId === newParentId) return true;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let cursor = byId.get(newParentId) || null;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor.id === folderId) return true;
    if (seen.has(cursor.id)) return false;
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) || null : null;
  }
  return false;
}
