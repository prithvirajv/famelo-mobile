import assert from "node:assert/strict";
import test from "node:test";
import { formatFileSize, folderPath, childFolders, documentsInFolder, wouldCreateFolderCycle, documentExpiryBadge, documentOpenedLabel } from "../src/documentsLogic.ts";

test("formatFileSize renders human-readable units", () => {
  assert.equal(formatFileSize(0), "");
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatFileSize(2 * 1024 * 1024 * 1024), "2.0 GB");
});

test("folderPath walks from root down to the given folder", () => {
  const folders = [
    { id: "a", householdId: "h1", parentId: null, name: "Root", createdAt: "" },
    { id: "b", householdId: "h1", parentId: "a", name: "Child", createdAt: "" },
    { id: "c", householdId: "h1", parentId: "b", name: "Grandchild", createdAt: "" }
  ];
  assert.deepEqual(folderPath(folders, "c").map((f) => f.id), ["a", "b", "c"]);
  assert.deepEqual(folderPath(folders, null), []);
});

test("childFolders and documentsInFolder filter by parent/folder id, treating undefined and null as root", () => {
  const folders = [
    { id: "a", householdId: "h1", parentId: null, name: "Root", createdAt: "" },
    { id: "b", householdId: "h1", parentId: "a", name: "Child", createdAt: "" }
  ];
  assert.deepEqual(childFolders(folders, null).map((f) => f.id), ["a"]);
  assert.deepEqual(childFolders(folders, "a").map((f) => f.id), ["b"]);

  const documents = [
    { id: "doc1", householdId: "h1", uploadedBy: "u1", folderId: null, noteId: null, name: "a.pdf", description: "", contentType: "application/pdf", sizeBytes: 10, status: "ready", createdAt: "", updatedAt: "" },
    { id: "doc2", householdId: "h1", uploadedBy: "u1", folderId: "a", noteId: null, name: "b.pdf", description: "", contentType: "application/pdf", sizeBytes: 10, status: "ready", createdAt: "", updatedAt: "" }
  ];
  assert.deepEqual(documentsInFolder(documents, null).map((d) => d.id), ["doc1"]);
  assert.deepEqual(documentsInFolder(documents, "a").map((d) => d.id), ["doc2"]);
});

test("wouldCreateFolderCycle rejects self-move and moving into a descendant, allows sibling moves", () => {
  const folders = [
    { id: "a", householdId: "h1", parentId: null, name: "Root", createdAt: "" },
    { id: "b", householdId: "h1", parentId: "a", name: "Child", createdAt: "" },
    { id: "sibling", householdId: "h1", parentId: "a", name: "Sibling", createdAt: "" }
  ];
  assert.equal(wouldCreateFolderCycle(folders, "a", "a"), true);
  assert.equal(wouldCreateFolderCycle(folders, "a", "b"), true);
  assert.equal(wouldCreateFolderCycle(folders, "b", "sibling"), false);
  assert.equal(wouldCreateFolderCycle(folders, "b", null), false);
});

test("documentExpiryBadge returns null when no expiry is set", () => {
  assert.equal(documentExpiryBadge(null), null);
  assert.equal(documentExpiryBadge(undefined), null);
});

test("documentExpiryBadge marks a past expiry danger with days-ago phrasing", () => {
  const badge = documentExpiryBadge("2026-07-01", new Date(2026, 6, 15));
  assert.deepEqual(badge, { label: "Expired 14d ago", tone: "danger" });
});

test("documentExpiryBadge marks an expiry within 30 days danger, within 90 days warning, further out neutral", () => {
  assert.deepEqual(documentExpiryBadge("2026-07-20", new Date(2026, 6, 1)), { label: "Expires in 19d", tone: "danger" });
  assert.deepEqual(documentExpiryBadge("2026-09-15", new Date(2026, 6, 1)), { label: "Expires in 76d", tone: "warning" });
  assert.deepEqual(documentExpiryBadge("2027-06-01", new Date(2026, 6, 1)), { label: "Expires 2027-06-01", tone: "neutral" });
});

test("documentOpenedLabel reports who opened a document and when, crediting the viewer as You", () => {
  assert.equal(documentOpenedLabel(null, null, "Alex"), "Not opened yet");
  assert.equal(documentOpenedLabel("2026-07-15T10:00:00.000Z", "Alex", "Alex"), `You opened · ${new Date("2026-07-15T10:00:00.000Z").toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
  assert.equal(documentOpenedLabel("2026-07-15T10:00:00.000Z", "Jordan", "Alex"), `Jordan opened · ${new Date("2026-07-15T10:00:00.000Z").toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
});
