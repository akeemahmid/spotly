import { check, completion, snapshotSQL, TEST_PROJECT } from "./security-test-db.mjs";
import { cleanupErrorCategory, objectChecks, readFixtureCounts, storageFixtureQuery, storageObjectsSQL, verifiedSyntheticObject } from "./storage-fixture-attribution.mjs";
import { reportStorageObjectDetails } from "./storage-object-diagnostics.mjs";
import { browserStorageScope, manifestObjectKnown, validateStorageManifest, verifiedFolderPlaceholder } from "./storage-recovery-record.mjs";

const conditions = {
  gate_closed: "both test gates closed",
  objects_empty: "Storage catalog empty (verification-evidence)",
  app_empty: "database fixtures absent (all application tables empty)",
  scope_empty: "pilot scope removed",
  key_empty: "signing-key fixture removed (key table empty)",
  helpers_absent: "SQL test helpers absent",
  bucket_ok: "private bucket / 8 MiB / JPEG PNG WebP unchanged",
};
const fingerprints = ["auth_ids", "bucket", "workspaces", "workspace_members", "verification_requests", "verification_plans", "task_events", "task_assignments", "task_evidence", "assignment_events"];
export function cleanupBaseline(journal) {
  check(journal.exists());
  const record = journal.read();
  check(record.project === TEST_PROJECT && [1, 2].includes(record.version) && typeof record.baseline === "string");
  validateStorageManifest(record);
  const baseline = JSON.parse(record.baseline);
  check(Object.keys(conditions).every(key => baseline[key] === true));
  check(fingerprints.every(key => /^[a-f0-9]{32}$/.test(baseline[key])));
  return baseline;
}

// No write statements, HTTP/Auth calls, gate changes or journal mutations.
// Read from a fresh owner connection; never rely on the human CLEANED answer.
export async function inspectStorageCleanup(open, journal, report = console.log, { objectDetails = false } = {}) {
  let client, stage = "recovery-record", verified = false;
  try {
    const baseline = cleanupBaseline(journal);
    const record = journal.read();
    report(`PASS recovery record valid for disposable project ${TEST_PROJECT}; retained`);
    report(record.version === 1 ? "INFO version-1 journal contains baseline hashes only: no fixture IDs, object paths or run timestamp. Exact current-versus-earlier-run binding is unavailable; no record was backfilled."
      : "PASS version-2 append-only fixture/path manifest present; original baseline retained");
    stage = "read-only-database-check";
    client = await open();
    completion(await client.query("begin read only isolation level repeatable read"), "BEGIN");
    const result = await client.query(snapshotSQL);
    completion(result, "SELECT");
    check(result.rows?.length === 1);
    const value = result.rows[0].snapshot;
    check(value && Object.keys(conditions).every(key => typeof value[key] === "boolean"));
    check(fingerprints.every(key => /^[a-f0-9]{32}$/.test(value[key])));
    const options = { browser: browserStorageScope(record) };
    const fixtures = await readFixtureCounts(client, options);
    check(value.app_empty === fixtures.every(row => row.total === 0));
    const objects = await client.query(storageFixtureQuery(storageObjectsSQL, options));
    completion(objects, "SELECT");
    check(Array.isArray(objects.rows) && value.objects_empty === (objects.rows.length === 0));
    completion(await client.query("rollback"), "ROLLBACK");
    verified = Object.keys(conditions).every(key => value[key] === true);
    for (const [key, label] of Object.entries(conditions)) report(`${value[key] ? "PASS" : "FAIL"} cleanup: ${label}`);
    for (const row of fixtures) {
      report(`${row.unknown ? "FAIL" : "PASS"} attribution ${row.table_name}: remaining=${row.total}; known_synthetic=${row.known}; unattributed=${row.unknown}`);
      if (row.ids.length) report(`FIXTURE IDS ${row.table_name} (versioned fixture match; not recorded in journal): ${row.ids.join(", ")}`);
      verified = verified && row.unknown === 0;
    }
    report(`Storage catalog objects remaining: ${objects.rows.length}`);
    let unknown = 0;
    for (const [index, row] of objects.rows.entries()) {
      report(`OBJECT ${index + 1} attribution: ${objectChecks.map(key => `${key}=${row[key] === true ? "PASS" : "FAIL"}`).join("; ")}`);
      if (objectDetails) reportStorageObjectDetails(row, index, report);
      if (verifiedSyntheticObject(row) && manifestObjectKnown(row, record)) report(`SYNTHETIC OBJECT: ${row.name}`);
      else if (verifiedFolderPlaceholder(row, record, objects.rows)) report(`VERIFIED SYNTHETIC FOLDER PLACEHOLDER (manual Dashboard deletion only): ${row.name}`);
      else unknown++;
    }
    if (unknown) report(`FAIL cleanup: ${unknown} object(s) not safely attributable to this fixture; ${objectDetails ? "catalog details are diagnostic only" : "names suppressed"}; do not delete blindly`);
    for (const key of fingerprints) {
      const equal = value[key] === baseline[key];
      report(`${equal ? "PASS" : "FAIL"} cleanup baseline: ${key}`);
      const fixture = fixtures.find(row => row.table_name === key);
      if (!equal && fixture) report(`BASELINE DIFFERENCE ${key}: ${fixture.total > 0 && fixture.unknown === 0 ? "entirely known synthetic rows against recorded empty baseline" : "NOT fully explained by known synthetic rows; stop recovery"}`);
      verified = verified && equal;
    }
    if (!value.app_empty) report("Database fixture deletion is blocked while ANY Storage object remains. Counts identify known fixture rows; never assume unattributed rows are disposable or replace the baseline.");
    report(value.objects_empty
      ? "PASS Dashboard deletion catalog check: no evidence object remains; backing bytes are not independently inspected by SQL."
      : "FAIL Dashboard deletion catalog check: objects still exist; typing CLEANED is not deletion.");
  } catch (error) {
    verified = false;
    report(`FAIL/UNVERIFIED cleanup diagnostic [${stage}]; ${cleanupErrorCategory(error)}; remaining conditions unverified; private error details suppressed`);
  } finally {
    if (client) { await client.query("rollback").catch(() => {}); await client.end().catch(() => {}); }
  }
  report(verified ? "CLEANUP VERIFICATION PASS — read-only; recovery record retained; HTTP tests NOT RUN"
    : "CLEANUP VERIFICATION FAIL — recovery record retained; HTTP tests NOT RUN");
  return verified ? 0 : 1;
}
