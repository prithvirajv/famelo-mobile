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
