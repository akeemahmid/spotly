import { readFileSync, writeFileSync, existsSync, openSync, closeSync, writeSync, fsyncSync, constants } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { check, completion, credentials, database, question, promptPassword, snapshot, snapshotSQL, source, statements, TEST_PROJECT } from "./security-test-db.mjs";
import { isolatedStorageConfig, runIsolatedStorageCheck, safeStorageStage } from "./isolated-storage-check.mjs";
import { inspectStorageBucket } from "./storage-limit-diagnostics.mjs";
import { cleanupBaseline, inspectStorageCleanup } from "./storage-cleanup-diagnostics.mjs";
import { browserCompletionSQL, cleanupErrorCategory, readFixtureCounts, requireOnlyKnownFixtures, storageFixtureQuery, storageObjectsSQL, verifiedSyntheticObject } from "./storage-fixture-attribution.mjs";
import { appendStorageEvent, browserStorageScope, manifestObjectKnown, newStorageRecord, parseStorageRecord, verifiedFolderPlaceholder } from "./storage-recovery-record.mjs";
import { demoEnvironment } from "./run-security-demo.mjs";
import { inspectStorageGates, inspectStorageSetup, storageSetupDiagnostic } from "./storage-setup-diagnostics.mjs";
import { inspectEvidenceAccess, verifyFreshDownloadAccess } from "./evidence-access-diagnostics.mjs";
import { reproduceCDownload } from "./reproduce-c-download.mjs";

export const STORAGE_ACTIVATION_ACK = `ENABLE STORAGE TEST ${TEST_PROJECT}`;
const journalPath = new URL("../.spotly-security-storage.json", import.meta.url);
export const storageJournal = {
  exists: () => existsSync(journalPath),
  read: () => parseStorageRecord(readFileSync(journalPath, "utf8")),
  write: value => writeFileSync(journalPath, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600, flush: true }),
  append: event => {
    const fd = openSync(journalPath, constants.O_WRONLY | constants.O_APPEND); // Never creates/replaces a missing record.
    try {
      const bytes = Buffer.from(JSON.stringify(event) + "\n");
      check(writeSync(fd, bytes) === bytes.length);
      fsyncSync(fd); // Persist the path before the corresponding remote operation.
    } finally { closeSync(fd); }
  },
};
export function preflightBrowserDemo(read = readFileSync) {
  try { demoEnvironment(parseEnv(read(new URL("../.env.isolated-browser", import.meta.url), "utf8"))); }
  catch { throw new Error("BROWSER_CONFIG_REQUIRED"); }
}
async function transaction(open, list, { before, onStage = () => {}, onCommit = () => {}, label = "transaction" } = {}) {
  onStage(`${label}.connect`);
  const client = await open();
  let commitSent = false;
  try {
    onStage(`${label}.begin`);
    completion(await client.query("begin isolation level serializable"), "BEGIN");
    if (before) { onStage(`${label}.recheck`); await before(client); }
    for (const [index, statement] of list.entries()) {
      onStage(`${label}.statement-${index + 1}-${statement.command.toLowerCase()}`);
      completion(await client.query(statement.text), statement.command, statement.text);
    }
    onStage(`${label}.commit`);
    commitSent = true;
    onCommit("UNKNOWN"); // A lost COMMIT response cannot prove rollback.
    completion(await client.query("commit"), "COMMIT");
    onCommit("COMMITTED");
  } catch (error) {
    if (!commitSent) onCommit("NOT_COMMITTED");
    throw error;
  } finally { await client.query("rollback").catch(() => {}); await client.end().catch(() => {}); }
}
function committedBody(text) {
  const list = statements(text);
  check(list[0].command === "BEGIN" && list.at(-1).command === "COMMIT");
  check(list.slice(1, -1).every(s => ["DO", "DELETE"].includes(s.command)));
  return list.slice(1, -1);
}
export async function closeStorageGate(open, report, optionsForTransaction = () => ({})) {
  // Deactivation is always permitted ONLY on the fixed disposable project.
  await transaction(open, [{ command: "UPDATE", text: "update spotly_private.workflow_gate set enabled=false,live_checks_verified=false where singleton" }], optionsForTransaction("cleanup-close-gates"));
  const { onStage = () => {} } = optionsForTransaction("cleanup-verify-gates");
  onStage("cleanup-verify-gates.connect");
  const client = await open();
  try {
    onStage("cleanup-verify-gates.select-flags");
    const result = await client.query("select count(*)=1 and bool_and(not enabled and not live_checks_verified) as closed from spotly_private.workflow_gate");
    onStage("cleanup-verify-gates.validate-result");
    completion(result, "SELECT");
    check(result.rows?.length === 1 && result.rows[0].closed === true);
    report("PASS test gate closure (independently verified)");
  } finally {
    // A socket-release failure must never replace the query/assertion error.
    // Once SELECT is acknowledged, release does not invalidate its result.
    await client.end().catch(error => report(`WARN cleanup connection release [cleanup-verify-gates.end]; ${storageSetupDiagnostic(error, "cleanup-verify-gates.end")}; original operation result retained`));
  }
  // Never remove an unexpected key or scope, even on the disposable project.
  await transaction(open, [{ command: "DO", text: `do $$ begin
   if exists(select 1 from spotly_private.workflow_pilot where not (
     (request_id='SP-36000000-0000-4000-8000-000000000001' and plan_id='47000000-0000-4000-8000-000000000001') or
     (request_id='SP-36000000-0000-4000-8000-000000000003' and plan_id='47000000-0000-4000-8000-000000000003'))
    or workspace_id<>'25000000-0000-4000-8000-000000000001'
    or dispatcher_id is distinct from (select id from auth.users where email='pilot-a@example.test')
    or verifier_id is distinct from (select id from auth.users where email='pilot-c@example.test'))
   or exists(select 1 from spotly_private.serv_plan_key where key_hex<>repeat('cd',32))
   then raise exception 'Unexpected scope/key; test gate closed but cleanup refused'; end if;
   delete from spotly_private.workflow_pilot;
   delete from spotly_private.serv_plan_key where key_hex=repeat('cd',32);
  end $$;` }], optionsForTransaction("cleanup-remove-scope-key"));
}
export async function runStorageSecurity(config, httpConfig, {
  open = database(config), journal = storageJournal, recover = false, report = console.log,
  runHTTP, confirmDeletion = question, read = source, signal,
  demo = false, focusedDownload = false, completeDemo = question, confirmActivation = question,
} = {}) {
  let baseline, attempted = false, passed = false, clean = false, context, setup, cleanup;
  let operation = "fixture.parse-setup", authorized = false, journalCreated = "NO", httpStarted = false;
  const onStage = value => { operation = value; };
  const commits = [];
  function transactionOptions(label) {
    const index = commits.push("NOT_COMMITTED") - 1;
    return { label, onStage, onCommit: value => { commits[index] = value; } };
  }
  function reportSafety() {
    let present = "UNVERIFIED";
    try { present = journal.exists() ? "YES" : "NO"; } catch { /* Never expose filesystem errors. */ }
    report(`INFO setup safety: journal_created_this_run=${journalCreated === "UNVERIFIED" && present === "NO" ? "NO" : journalCreated}; journal_present=${present}; database_writes=${commits.includes("COMMITTED") ? "COMMITTED" : commits.includes("UNKNOWN") || httpStarted ? "UNVERIFIED" : "NONE_BY_THIS_RUN"}; commit_outcome_uncertain=${commits.includes("UNKNOWN") ? "YES" : "NO"}; http_writes=${httpStarted ? "POSSIBLE" : "NOT_STARTED"}`);
  }
  try {
    // Parse both fixture scripts before touching any database.
    setup = committedBody(read("isolated-storage-fixture.sql"));
    onStage("fixture.parse-cleanup");
    cleanup = committedBody(read("isolated-storage-cleanup.sql"));
    if (recover) {
      onStage("journal.validate-recovery");
      cleanupBaseline(journal); // Validate original baseline before any recovery writes.
      const prior = journal.read();
      check(prior.project === TEST_PROJECT && [1, 2].includes(prior.version) && typeof prior.baseline === "string");
      baseline = prior.baseline; attempted = true;
    } else {
      onStage("journal.require-absent");
      check(!journal.exists());
      onStage("configuration.validate-target-and-tls");
      check(httpConfig?.url === `https://${TEST_PROJECT}.supabase.co`);
      check(!(demo && focusedDownload));
      check(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" && !signal?.aborted);
      report(`Manual authorization required: commit synthetic fixtures and temporarily enable BOTH test database flags ONLY on ${TEST_PROJECT}, pinned to disposable A/C and request 001${demo ? " (then request 003 for rehearsal)" : ""}. Cleanup closes both flags and removes test scope/key; interrupted runs require --cleanup.`);
      if (focusedDownload) report("FOCUSED reproduction only: A assigns, C accepts/reserves/uploads ONE PNG, C session/GET and full deployed SQL authorization, B/anonymous denial, optional A readback, then guarded cleanup. No finalization, review, size probes or browser scope.");
      onStage("authorization.confirm-activation");
      check(await confirmActivation(`To authorize this disposable Storage test, type ${STORAGE_ACTIVATION_ACK}: `) === STORAGE_ACTIVATION_ACK);
      authorized = true;
      onStage("authorization.check-cancellation");
      check(!signal?.aborted);
      await inspectStorageBucket(open, report, onStage); // Read-only; mismatch stops before journal/setup/gates.
      baseline = await snapshot(open, onStage);
      report("PASS read-only cleanup preflight: both test gates false; scope/key, application fixtures and evidence objects empty");
      // Nonsecret crash-recovery record. Never overwrite a previous run's record.
      onStage("journal.create");
      journalCreated = "UNVERIFIED"; // A failed write/flush can leave a partial file.
      journal.write(newStorageRecord(baseline));
      journalCreated = "YES";
      attempted = true;
      await transaction(open, setup, { ...transactionOptions("fixture"), before: async client => {
        onStage("fixture.recheck-select-snapshot");
        const result = await client.query(snapshotSQL);
        onStage("fixture.recheck-empty-and-closed");
        completion(result, "SELECT");
        const value = result.rows?.[0]?.snapshot;
        check(value?.app_empty === true && value.gate_closed === true && value.key_empty === true && value.scope_empty === true && value.objects_empty === true);
      } });
      report("PASS fixture transaction committed (synthetic fixture insertion and both test gate flags)");
      onStage("http.workflow");
      httpStarted = true;
      const executeHTTP = runHTTP ?? (focusedDownload ? reproduceCDownload : runIsolatedStorageCheck);
      await executeHTTP(httpConfig, report, {
        signal, onContext: value => { context = value; },
        verifyDownloadAccess: (expected, claims) => verifyFreshDownloadAccess(open, expected, claims, report),
        onAssignment: value => appendStorageEvent(journal, { kind: "assignment", ...value }),
        onReservation: value => appendStorageEvent(journal, { kind: "reservation", ...value }),
        verifyObject: async expected => {
          const client = await open();
          try {
            completion(await client.query("begin read only"), "BEGIN");
            const result = await client.query(storageObjectsSQL);
            completion(result, "SELECT");
            const rows = result.rows.filter(row => row.name === expected.path);
            const matches = { exact_object: rows.length === 1, fixture_and_path: rows.length === 1 && verifiedSyntheticObject(rows[0]),
              owner: rows[0]?.catalog_owner === expected.verifier, bytes: Number(rows[0]?.catalog_size) === expected.size,
              mime: rows[0]?.catalog_mime === expected.mime };
            report(`INFO evidence catalog confirmation: ${Object.entries(matches).map(([name, match]) => `${name}=${match ? "PASS" : "FAIL"}`).join("; ")}`);
            if (!Object.values(matches).every(Boolean)) throw new Error("OBJECT_BINDING_MISMATCH");
            appendStorageEvent(journal, { kind: "catalog", path: expected.path, catalogId: rows[0].catalog_id, createdAt: rows[0].catalog_created_at });
          } finally { await client.query("rollback").catch(() => {}); await client.end(); }
        },
      });
      passed = true;
      if (demo) {
        onStage("journal.append-browser-scope");
        appendStorageEvent(journal, { kind: "browser-scope", requestId: "SP-36000000-0000-4000-8000-000000000003", planId: "47000000-0000-4000-8000-000000000003" });
        await transaction(open, [{ command: "DO", text: `do $$ begin
          update spotly_private.workflow_gate set enabled=false,live_checks_verified=false where singleton;
          if not exists(select 1 from public.verification_plans where id='47000000-0000-4000-8000-000000000003'
            and provider_model='synthetic-fixture-not-SERV' and accepted_at is not null)
          then raise exception 'Synthetic rehearsal plan missing'; end if;
          update spotly_private.workflow_pilot set request_id='SP-36000000-0000-4000-8000-000000000003',plan_id='47000000-0000-4000-8000-000000000003'
           where request_id='SP-36000000-0000-4000-8000-000000000001' and plan_id='47000000-0000-4000-8000-000000000001'
             and workspace_id='25000000-0000-4000-8000-000000000001';
          if not found then raise exception 'Unexpected rehearsal scope'; end if;
          update spotly_private.workflow_gate set enabled=true,live_checks_verified=true where singleton;
        end $$;` }], transactionOptions("rehearsal-repin"));
        onStage("rehearsal.wait-for-browser");
        report("DISPOSABLE BROWSER REHEARSAL: only synthetic request 003/plan 003 is now pinned. Follow docs/restricted-pilot-demo.md. Never generate a SERV plan.");
        check(await completeDemo("After recording browser results and stopping the test server, type DONE to close the test gate and clean up: ") === "DONE");
        onStage("rehearsal.verify-persisted-workflow");
        const client = await open();
        try {
          completion(await client.query("begin read only"), "BEGIN");
          const result = await client.query(storageFixtureQuery(browserCompletionSQL, { browser: true }));
          completion(result, "SELECT");
          check(result.rows?.length === 1 && result.rows[0].browser_complete === true);
          report("PASS rehearsal persisted assignment, accepted photo submission, dispatcher review and completion (database state; browser visual checks remain manual)");
        } catch (error) {
          report(`FAIL rehearsal persisted workflow; ${cleanupErrorCategory(error)}; cleanup follows`);
          throw error;
        } finally { await client.query("rollback").catch(() => {}); await client.end(); }
      }
    }
  } catch (error) {
    passed = false;
    const stage = operation === "http.workflow" ? safeStorageStage(error) : operation;
    report(`FAIL Storage test/setup [${stage}]; ${storageSetupDiagnostic(error, operation)}; private details suppressed; cleanup follows if a test run was recorded.`);
    reportSafety();
  } finally {
    if (attempted) {
      let cleanupStage = "gate-closure-or-scope-key-removal", cleanupOperation;
      try {
        await closeStorageGate(open, report, label => ({ ...transactionOptions(label),
          onStage: value => { cleanupOperation = value; onStage(value); },
        }));
        cleanupStage = "storage-object-attribution";
        cleanupOperation = undefined;
        const client = await open();
        let paths;
        try {
          const options = { browser: browserStorageScope(journal.read()) };
          const inventory = await readFixtureCounts(client, options);
          requireOnlyKnownFixtures(inventory);
          if (journal.read().version === 2) appendStorageEvent(journal, { kind: "inventory", tables: inventory.map(row => ({ table: row.table_name, ids: row.ids })) });
          const result = await client.query(storageFixtureQuery(storageObjectsSQL, options));
          completion(result, "SELECT");
          check(Array.isArray(result.rows));
          // Browser writes happen through the actual app. Only the previously
          // journaled request-003 scope may acquire a recovery census afterward.
          for (const row of result.rows) if (options.browser && row.request_id === "SP-36000000-0000-4000-8000-000000000003" && verifiedSyntheticObject(row)) {
            if (!manifestObjectKnown(row, journal.read())) {
              const value = { assignment: row.assignment_id, requestId: row.request_id, planId: row.plan_id, verifier: row.verifier_id };
              appendStorageEvent(journal, { kind: "assignment", ...value });
              appendStorageEvent(journal, { kind: "reservation", ...value, evidence: row.evidence_id, path: row.name, mime: row.catalog_mime, size: Number(row.catalog_size) });
            }
            if (!journal.read().events.some(event => event.kind === "catalog" && event.path === row.name)) {
              appendStorageEvent(journal, { kind: "catalog", path: row.name, catalogId: row.catalog_id, createdAt: row.catalog_created_at });
            }
          }
          check(result.rows.every(row => verifiedSyntheticObject(row) && manifestObjectKnown(row, journal.read()) || verifiedFolderPlaceholder(row, journal.read(), result.rows)));
          paths = result.rows.map(row => row.name);
        } finally { await client.end(); }
        if (paths.length) {
          cleanupStage = "dashboard-deletion-confirmation";
          report(`Test gate is CLOSED. In ONLY test project ${TEST_PROJECT}, Storage → verification-evidence, delete these synthetic objects using the Dashboard:`);
          paths.forEach(path => report(path));
          if (paths.some(path => path.endsWith("/.emptyFolderPlaceholder"))) report("Verified empty-folder placeholder: delete ONLY its empty synthetic assignment folder from the bucket root. Never delete catalog rows with SQL.");
          check(await confirmDeletion("After deleting those objects in the TEST Storage dashboard, type CLEANED: ") === "CLEANED");
          // Dashboard may replace the last image with a hidden folder marker.
          // Never ignore it or delete metadata. One bounded, human-only recovery
          // pass is allowed only for markers proven against this run's manifest.
          cleanupStage = "dashboard-marker-verification";
          const remainingClient = await open();
          let remaining;
          try {
            const result = await remainingClient.query(storageFixtureQuery(storageObjectsSQL, { browser: browserStorageScope(journal.read()) }));
            completion(result, "SELECT"); remaining = result.rows;
          } finally { await remainingClient.end(); }
          check(Array.isArray(remaining));
          if (remaining.length) {
            check(remaining.every(row => verifiedFolderPlaceholder(row, journal.read(), remaining)));
            report(`Dashboard left verified synthetic folder placeholders in test project ${TEST_PROJECT}. Delete ONLY these empty assignment folders from verification-evidence's root:`);
            remaining.forEach(row => report(row.name));
            check(await confirmDeletion("After removing ONLY those verified empty test folders, type CLEANED: ") === "CLEANED");
          }
        }
        cleanupStage = "http-deletion-verification";
        if (context) await context.verifyDeleted(); // Known authorized HTTP read must now be not-found.
        cleanupStage = "guarded-database-fixture-removal";
        await transaction(open, cleanup, { ...transactionOptions("cleanup-fixtures"), before: async client => {
          // Recheck attribution in the same serializable deletion transaction.
          // Refuse unknown rows; preserve original baseline and all unrelated data.
          requireOnlyKnownFixtures(await readFixtureCounts(client, { browser: browserStorageScope(journal.read()) }));
        } }); // SQL guard also refuses if ANY bucket object remains.
        cleanupStage = "independent-baseline-verification";
        clean = await snapshot(open) === baseline; // New socket; all rows/gates/key/bucket/auth IDs.
        check(clean);
        report("PASS independent Storage catalog and fixture cleanup; both test gates closed; scope/key removed; baseline unchanged");
        report("INFO recovery record retained with original baseline; archive it privately only after independent cleanup verification before starting a new fixture run");
      } catch (error) {
        clean = false;
        report(`FAIL/UNVERIFIED cleanup [${cleanupStage}]${cleanupOperation ? ` operation=${cleanupOperation}` : ""}; ${cleanupOperation ? storageSetupDiagnostic(error, cleanupOperation) : cleanupErrorCategory(error)}. Keep the recovery record; never delete storage.objects using SQL.`);
        reportSafety(); // Includes UNKNOWN COMMIT outcomes before independent reads.
        await inspectStorageCleanup(open, journal, report);
      }
    }
    // Independent verification is also required after a pre-journal failure.
    // Refused authorization never causes even a read-only remote connection.
    if (authorized || attempted) {
      if (await inspectStorageGates(open, report) !== 0) clean = false;
    }
    reportSafety();
    if (recover && clean) report("RECOVERY CLEANUP PASS — HTTP tests NOT RUN by this recovery command");
    if (!recover) report(focusedDownload
      ? `C DOWNLOAD REPRODUCTION ${passed && clean ? "PASS" : "FAIL"}; cleanup=${clean ? "VERIFIED" : "UNVERIFIED"}; full security suite/browser workflow NOT RUN`
      : passed && clean ? "OVERALL PASS" : "OVERALL FAIL");
  }
  return (recover ? clean : passed && clean) ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  try {
    const objectDetails = process.argv[2] === "--inspect-storage-object";
    const setupInspection = process.argv[2] === "--inspect-setup";
    const accessInspection = process.argv[2] === "--inspect-evidence-access";
    const focusedDownload = process.argv[2] === "--reproduce-c-download";
    const recover = process.argv[2] === "--cleanup", demo = process.argv[2] === "--demo", inspect = process.argv[2] === "--inspect-cleanup" || objectDetails;
    check(process.argv.length === (recover || demo || inspect || setupInspection || accessInspection || focusedDownload ? 3 : 2));
    if (demo) preflightBrowserDemo(); // Local validation before credentials, connections or gates.
    const config = await credentials();
    let httpConfig;
    if (!recover && !inspect && !setupInspection && !accessInspection) {
      const key = await promptPassword({ label: "TEST project's public publishable key (hidden): " });
      const passwords = [];
      for (const label of ["a", "b", "c"]) passwords.push(await promptPassword({ label: `Password for pilot-${label}@example.test (hidden): ` }));
      httpConfig = isolatedStorageConfig({ SPOTLY_ISOLATED_TEST: "yes", SPOTLY_TEST_URL: `https://${TEST_PROJECT}.supabase.co`,
        SPOTLY_TEST_CONFIRMED_ORIGIN: `https://${TEST_PROJECT}.supabase.co`, SPOTLY_TEST_PUBLISHABLE_KEY: key,
        SPOTLY_TEST_A_PASSWORD: passwords[0], SPOTLY_TEST_B_PASSWORD: passwords[1], SPOTLY_TEST_C_PASSWORD: passwords[2] });
    }
    process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
    process.exitCode = accessInspection ? await inspectEvidenceAccess(database(config))
      : setupInspection ? await inspectStorageSetup(database(config), storageJournal)
      : inspect
      ? await inspectStorageCleanup(database(config), storageJournal, console.log, { objectDetails })
      : await runStorageSecurity(config, httpConfig, { recover, demo, focusedDownload, signal: controller.signal });
  } catch (error) {
    console.error(error?.message === "BROWSER_CONFIG_REQUIRED"
      ? "DEMO PREFLIGHT FAIL: prepare the private test-only .env.isolated-browser file using docs/restricted-pilot-demo.md; verify TLS is enabled. No remote operation started; private details suppressed."
      : `OVERALL FAIL before runner completion; ${storageSetupDiagnostic(error, "configuration.validate")}; gate state UNVERIFIED. Use --inspect-setup for read-only verification; private details suppressed.`);
    process.exitCode = 1;
  } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
