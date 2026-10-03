import assert from "node:assert/strict";
import test from "node:test";
import { noteLinkedImages, imageContentType, photoFileName } from "../src/notePhotosLogic.ts";

const doc = (overrides) => ({ id: "d", householdId: "h", uploadedBy: "u", folderId: null, noteId: "n1", wealthItemType: null, wealthItemId: null, name: "a.jpg", description: "", contentType: "image/jpeg", sizeBytes: 1, status: "ready", createdAt: "", updatedAt: "", ...overrides });

test("noteLinkedImages keeps only ready image documents linked to that note", () => {
  const documents = [
    doc({ id: "ok" }),
    doc({ id: "other-note", noteId: "n2" }),
    doc({ id: "pending", status: "pending" }),
    doc({ id: "pdf", contentType: "application/pdf" }),
    doc({ id: "unlinked", noteId: null }),
    doc({ id: "png", contentType: "image/png" })
  ];
  assert.deepEqual(noteLinkedImages(documents, "n1").map((item) => item.id), ["ok", "png"]);
  assert.deepEqual(noteLinkedImages(documents, "missing"), []);
});

test("imageContentType keeps a real image type and falls back to jpeg for missing or non-image types", () => {
  assert.equal(imageContentType("image/png"), "image/png");
  assert.equal(imageContentType(undefined), "image/jpeg");
  assert.equal(imageContentType("application/pdf"), "image/jpeg");
});

test("photoFileName keeps the picker's own name, else builds a timestamped one with the right extension", () => {
  const now = new Date(1700000000000);
  assert.equal(photoFileName("  IMG_1.heic ", "image/heic", now), "IMG_1.heic");
  assert.equal(photoFileName(undefined, "image/png", now), "note-photo-1700000000000.png");
  assert.equal(photoFileName("", "image/heic", now), "note-photo-1700000000000.heic");
  assert.equal(photoFileName(null, null, now), "note-photo-1700000000000.jpg");
  assert.equal(photoFileName(null, "image/x-unknown", now), "note-photo-1700000000000.jpg");
});
