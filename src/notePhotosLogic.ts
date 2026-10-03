// A photo attached to a note is just a Documents row with noteId set to that note (web's
// noteLinkedImages) - it reuses the existing upload pipeline and storage instead of inventing a
// second one. These helpers pick a note's photos out of the household's documents and name picked
// images for upload.
import type { Document } from "./types";

// Only fully uploaded images belong in a note's photo strip: a still-pending upload has no file to
// show yet, and non-image documents linked to the note are listed on the Documents screen instead.
export function noteLinkedImages(documents: Document[], noteId: string): Document[] {
  return documents.filter((item) => item.noteId === noteId && item.status === "ready" && Boolean(item.contentType?.startsWith("image/")));
}

const EXTENSION_BY_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp", "image/gif": "gif" };

export function imageContentType(mimeType: string | null | undefined): string {
  return mimeType && mimeType.startsWith("image/") ? mimeType : "image/jpeg";
}

// A picked photo's own file name is sometimes missing (the picker often returns a bare cache URI),
// and the server requires a non-empty document name - fall back to a timestamped one whose extension
// matches the real type so the file opens correctly from Documents later.
export function photoFileName(fileName: string | null | undefined, mimeType: string | null | undefined, now: Date = new Date()): string {
  const trimmed = (fileName || "").trim();
  if (trimmed) return trimmed;
  const extension = EXTENSION_BY_MIME[imageContentType(mimeType).toLowerCase()] || "jpg";
  return `note-photo-${now.getTime()}.${extension}`;
}
