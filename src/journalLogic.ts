export function validateJournalPayload(body: { entries?: unknown } | null | undefined, maxPhotosPerEntry = 8): string | null {
  if (!body || !Array.isArray(body.entries)) return "Invalid journal payload";
  for (const entry of body.entries as Array<{ photos?: unknown[] }>) {
    if (Array.isArray(entry.photos) && entry.photos.length > maxPhotosPerEntry) {
      return "Each journal entry supports at most 8 photos";
    }
  }
  return null;
}
