import test from "node:test";
import assert from "node:assert/strict";
import { inspectStorageCleanup } from "./storage-cleanup-diagnostics.mjs";
import { TEST_PROJECT } from "./security-test-db.mjs";
import { cleanupErrorCategory, fixtureTables, objectChecks, verifiedSyntheticObject, validateFixtureCounts, requireOnlyKnownFixtures } from "./storage-fixture-attribution.mjs";

const flags = ["gate_closed", "objects_empty", "app_empty", "scope_empty", "key_empty", "helpers_absent", "bucket_ok"];
const hashes = ["auth_ids", "bucket", "workspaces", "workspace_members", "verification_requests", "verification_plans", "task_events", "task_assignments", "task_evidence", "assignment_events"];
const original = () => Object.fromEntries([...flags.map(k => [k, true]), ...hashes.map(k => [k, "a".repeat(32)])]);
const path = "69000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000001";
const object = changes => ({ name: path, ...Object.fromEntries(objectChecks.map(key => [key, true])), ...changes });
function fixture(value = original(), objects = []) {
  const queries = [], logs = [];
  const record = { project: TEST_PROJECT, version: 1, baseline: JSON.stringify(original()) };
  const journal = { exists: () => true, read: () => record,
    write: () => assert.fail("diagnostic wrote journal"), clear: () => assert.fail("diagnostic cleared journal") };
  const open = async () => ({
    query: async sql => {
      queries.push(sql);
      assert.match(sql, /^(begin read only isolation level repeatable read|select |with fixture_ids|rollback)/);
      if (sql.includes("as snapshot")) return { command: "SELECT", rows: [{ snapshot: value }] };
      if (sql.includes("as table_name")) return { command: "SELECT", rows: f.counts };
      if (sql.includes("from storage.objects o")) return { command: "SELECT", rows: objects };
      return { command: sql.startsWith("begin") ? "BEGIN" : "ROLLBACK", rows: [] };
    }, end: async () => {},
  });
  const f = { open, journal, record, queries, logs, report: line => logs.push(line),
    counts: fixtureTables.map(table_name => ({ table_name,
      total: table_name === "workspaces" && !value.app_empty ? 1 : 0,
      known: table_name === "workspaces" && !value.app_empty ? 1 : 0, ids: [] })) };
  return f;
}
test("cleanup inspection verifies every baseline component read-only and retains recovery record even on PASS", async () => {
  const f = fixture();
  const prior = JSON.stringify(f.record);
  assert.equal(await inspectStorageCleanup(f.open, f.journal, f.report), 0);
  assert.equal(JSON.stringify(f.record), prior);
  assert.equal(f.logs.filter(line => line.startsWith("PASS cleanup:")).length, flags.length);
  assert.equal(f.logs.filter(line => line.startsWith("PASS cleanup baseline:")).length, hashes.length);
  assert.match(f.logs.at(-1), /^CLEANUP VERIFICATION PASS.*record retained.*HTTP tests NOT RUN/);
  assert.ok(f.queries[0].startsWith("begin read only"));
  assert.ok(!f.queries.some(q => /\b(insert|update|delete|commit)\b/i.test(q)));
});
for (const key of flags) {
  test(`cleanup inspection separately fails ${key} without masking other conditions`, async () => {
    const f = fixture({ ...original(), [key]: false }, key === "objects_empty" ? [object()] : []);
    assert.equal(await inspectStorageCleanup(f.open, f.journal, f.report), 1);
    assert.equal(f.logs.filter(line => line.startsWith("FAIL cleanup:")).length, 1);
    assert.equal(f.logs.filter(line => line.startsWith("PASS cleanup:")).length, flags.length - 1);
  });
}
test("object diagnostic prints only attributable UUID paths and exposes no unknown object names", async () => {
  const f = fixture({ ...original(), objects_empty: false }, [
    object(), object({ synthetic_chain: false, name: "private-token-in-name" }),
    object({ name: "https://private-password@example.test/object" }),
  ]);
  assert.equal(await inspectStorageCleanup(f.open, f.journal, f.report), 1);
  assert.ok(f.logs.includes(`SYNTHETIC OBJECT: ${path}`));
  assert.ok(f.logs.includes("Storage catalog objects remaining: 3"));
  assert.ok(f.logs.some(line => line.includes("2 object(s) not safely attributable")));
  assert.ok(!/private-token|private-password/.test(f.logs.join("\n")));
});
test("opt-in object detail mode remains read-only, reports a placeholder candidate and retains the journal with cleanup FAIL", async () => {
  const marker = path.split("/")[0] + "/.emptyFolderPlaceholder";
  const f = fixture({ ...original(), objects_empty: false }, [object({ name: marker, uuid_path: false,
    reservation_path: false, catalog_size: "0", catalog_owner: null, catalog_mime: "application/octet-stream" })]);
  const prior = JSON.stringify(f.record);
  assert.equal(await inspectStorageCleanup(f.open, f.journal, f.report, { objectDetails: true }), 1);
  assert.equal(JSON.stringify(f.record), prior);
  assert.ok(f.logs.some(line => line.includes(`"actual_name":"${marker}"`)));
  assert.ok(f.logs.some(line => line.includes("FOLDER_PLACEHOLDER_CANDIDATE")));
  assert.ok(!f.logs.some(line => line.startsWith("SYNTHETIC OBJECT:")));
  assert.match(f.logs.at(-1), /^CLEANUP VERIFICATION FAIL/);
});
test("known fixture counts explain empty-baseline differences, but unknown rows stop recovery and IDs are not claimed journal-bound", async () => {
  const f = fixture({ ...original(), app_empty: false, workspaces: "b".repeat(32) });
  f.counts[0] = { table_name: "workspaces", total: 1, known: 1, ids: ["25000000-0000-4000-8000-000000000001"] };
  assert.equal(await inspectStorageCleanup(f.open, f.journal, f.report), 1);
  assert.ok(f.logs.some(line => /BASELINE DIFFERENCE workspaces: entirely known synthetic/.test(line)));
  assert.ok(f.logs.some(line => line.includes("versioned fixture match; not recorded in journal")));
  assert.ok(f.logs.some(line => line.includes("no fixture IDs, object paths or run timestamp")));
  f.logs.length = 0;
  f.counts[0].total = 2;
  assert.equal(await inspectStorageCleanup(f.open, f.journal, f.report), 1);
  assert.ok(f.logs.includes("FAIL attribution workspaces: remaining=2; known_synthetic=1; unattributed=1"));
  assert.ok(f.logs.some(line => /BASELINE DIFFERENCE workspaces: NOT fully explained/.test(line)));
});
for (const key of objectChecks) {
  test(`a missing ${key} check cannot authorize synthetic-object deletion`, () => {
    assert.equal(verifiedSyntheticObject(object()), true);
    assert.equal(verifiedSyntheticObject(object({ [key]: false })), false);
    assert.equal(verifiedSyntheticObject(object({ [key]: undefined })), false);
  });
}
test("fixture-count guard refuses unattributed rows, unsafe IDs and incomplete inventories", () => {
  const f = fixture();
  const result = { command: "SELECT", rows: f.counts };
  assert.doesNotThrow(() => requireOnlyKnownFixtures(validateFixtureCounts(result)));
  f.counts[0].total = 1;
  assert.throws(() => requireOnlyKnownFixtures(validateFixtureCounts(result)));
  f.counts[0].ids = ["private-token\nunsafe"];
  assert.throws(() => validateFixtureCounts(result));
  assert.throws(() => validateFixtureCounts({ ...result, rows: [] }));
});
test("cleanup errors disclose only known SQLSTATE categories, suppressing messages and unknown codes", () => {
  assert.equal(cleanupErrorCategory({ code: "23503", message: "private-password" }), "sqlstate=23503; category=FOREIGN_KEY_CONSTRAINT");
  assert.equal(cleanupErrorCategory({ code: "private-token", message: "private-password" }), "sqlstate=UNAVAILABLE; category=CHECK_OR_CONNECTION_ERROR");
});
for (const key of hashes) {
  test(`baseline mismatch names only the changed component ${key}`, async () => {
    const f = fixture({ ...original(), [key]: "b".repeat(32) });
    assert.equal(await inspectStorageCleanup(f.open, f.journal, f.report), 1);
    assert.ok(f.logs.includes(`FAIL cleanup baseline: ${key}`));
    assert.ok(!f.logs.join("\n").includes("b".repeat(32)));
  });
}
test("invalid or production recovery record refuses any connection without changing record", async () => {
  for (const change of [r => { r.project = "onfdusisfidlfdmluwxl"; }, r => { r.baseline = "{}"; }, r => { r.version = 2; }]) {
    const f = fixture(); change(f.record);
    assert.equal(await inspectStorageCleanup(() => assert.fail("invalid record connected"), f.journal, f.report), 1);
    assert.ok(f.logs.some(line => line.includes("[recovery-record]")));
    assert.ok(!f.logs.join("\n").includes("onfdusisfidlfdmluwxl"));
  }
});
test("failed diagnostic connection suppresses raw errors, never claims cleanup and retains journal", async () => {
  const f = fixture();
  assert.equal(await inspectStorageCleanup(async () => { throw new Error("private-password postgresql://private-connection"); }, f.journal, f.report), 1);
  assert.ok(f.logs.some(line => line.includes("[read-only-database-check]")));
  assert.ok(!/private-password|private-connection/.test(f.logs.join("\n")));
  assert.match(f.logs.at(-1), /^CLEANUP VERIFICATION FAIL/);
});
