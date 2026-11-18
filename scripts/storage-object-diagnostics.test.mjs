import test from "node:test";
import assert from "node:assert/strict";
import { storageObjectDetails, reportStorageObjectDetails } from "./storage-object-diagnostics.mjs";
import { objectChecks, verifiedSyntheticObject } from "./storage-fixture-attribution.mjs";

const assignment = "69000000-0000-4000-8000-000000000001", evidence = "59000000-0000-4000-8000-000000000001";
const expected = `${assignment}/${evidence}`;
const row = () => ({ name: `${assignment}/.emptyFolderPlaceholder`, catalog_id: evidence, catalog_owner: null,
  catalog_size: "0", catalog_mime: "application/octet-stream", catalog_created_at: "2026-11-14T14:30:00.123456Z",
  catalog_updated_at: "2026-11-14T14:30:00.123456Z", synthetic_chain: true, assignment_id: assignment,
  evidence_id: evidence, expected_path: expected, reserved_size: 95, reserved_mime: "image/png",
  reservation_created_at: "2026-11-14T14:00:00.123456Z", request_expires_at: "2026-11-14T14:15:00.123456Z" });

test("catalog details show the exact folder-marker path, zero size, null owner and actual later timestamp without approving deletion", () => {
  const input = row(), details = storageObjectDetails(input);
  assert.equal(details.kind, "FOLDER_PLACEHOLDER_CANDIDATE");
  assert.equal(details.actual_name, input.name);
  assert.equal(details.metadata_size, 0);
  assert.equal(details.owner_id, "NULL");
  assert.equal(details.created_at, input.catalog_created_at);
  assert.equal(details.expected_reservation_path, expected);
  assert.equal(details.reserved_size, 95);
  assert.equal(verifiedSyntheticObject({ ...input, ...Object.fromEntries(objectChecks.map(key => [key, true])) }), false);
});
test("oversized byte count is a hypothesis only; missing metadata remains unknown", () => {
  assert.equal(storageObjectDetails({ ...row(), name: expected, catalog_size: "8388609" }).kind, "OVERSIZED_UPLOAD_ARTIFACT_CANDIDATE");
  assert.equal(storageObjectDetails({ ...row(), name: expected, catalog_size: null, catalog_mime: null }).metadata_size, "NULL");
  assert.equal(storageObjectDetails({ ...row(), name: expected, catalog_size: null, reservation_path: true }).kind, "RESERVED_EVIDENCE_PATH");
  assert.equal(storageObjectDetails({ name: "other" }).kind, "OTHER_OR_UNRESOLVED");
});
test("arbitrary names, URLs, owner tokens, MIME payloads, metadata and timestamps are never echoed", () => {
  const logs = [];
  const secret = "private-password-and-token";
  reportStorageObjectDetails({ ...row(), name: `https://user:${secret}@example.test/path`, catalog_owner: secret,
    catalog_legacy_owner: secret, catalog_content_length: secret, catalog_content_type: secret,
    catalog_mime: secret, catalog_size: secret, catalog_created_at: secret, catalog_updated_at: secret,
    metadata: { authorization: secret }, catalog_id: secret }, 0, line => logs.push(line));
  assert.ok(!logs.join("\n").includes(secret));
  assert.ok(!logs.join("\n").includes("https://"));
  assert.ok(logs[0].includes("NOT deletion approval"));
});
test("uncertain fixture chains do not expose candidate evidence identifiers and paths as verified", () => {
  const details = storageObjectDetails({ ...row(), synthetic_chain: false });
  for (const key of ["assignment_id", "evidence_id", "expected_reservation_path", "reserved_size", "reserved_mime", "reservation_created_at", "request_expires_at"]) {
    assert.equal(details[key], "UNVERIFIED");
  }
});
