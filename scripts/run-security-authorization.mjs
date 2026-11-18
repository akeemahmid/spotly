import { pathToFileURL } from "node:url";
import { check, completion, credentials, database, rollbackSuite, snapshot, source, TEST_PROJECT } from "./security-test-db.mjs";

export const SUITES = ["authorization.sql", "phase3b-authorization.sql", "restricted-pilot-authorization.sql"];
// Only static, reviewed categories leave this process. Never log driver message,
// detail, hint, where, SQL, parameters, constraint names, stack or error causes.
const sqlStates = new Map([
  ["42501", "AUTHORIZATION_DENIED"], ["P0001", "RPC_OR_ASSERTION_REJECTED"],
  ["23514", "CHECK_CONSTRAINT"], ["23505", "UNIQUE_CONSTRAINT"],
  ["23503", "FOREIGN_KEY_CONSTRAINT"], ["23502", "NOT_NULL_CONSTRAINT"],
  ["22P02", "INVALID_INPUT"], ["22023", "INVALID_PARAMETER"],
  ["42883", "FUNCTION_UNAVAILABLE"], ["42P01", "TABLE_UNAVAILABLE"],
  ["42703", "COLUMN_UNAVAILABLE"], ["57014", "QUERY_CANCELLED"],
  ["55P03", "LOCK_UNAVAILABLE"], ["25P02", "TRANSACTION_ABORTED"],
  ["40P01", "DEADLOCK"], ["40001", "SERIALIZATION_FAILURE"],
]);
const rejections = new Map([
  ["Invalid evidence receipt", "EVIDENCE_RECEIPT_INVALID"],
  ["Signing unavailable", "SIGNING_UNAVAILABLE"],
  ["Stale evidence receipt", "EVIDENCE_RECEIPT_STALE"],
  ["Assigned verifier required", "ASSIGNED_VERIFIER_REQUIRED"],
  ["Workflow gate closed", "WORKFLOW_GATE_CLOSED"],
  ["Trusted accepted current unexpired plan required", "CURRENT_PLAN_REQUIRED"],
  ["Evidence binding mismatch", "EVIDENCE_BINDING_MISMATCH"],
  ["Evidence conflict", "EVIDENCE_CONFLICT"],
  ["Invalid submission state", "SUBMISSION_STATE_INVALID"],
  ["Private uploaded object required", "STORAGE_OBJECT_REQUIRED"],
]);
export function safeDiagnostic(error) {
  if (sqlStates.has(error?.code)) {
    const reason = error.code === "P0001" ? rejections.get(error.message) : undefined;
    return `SQLSTATE ${error.code}; ${reason ?? sqlStates.get(error.code)}`;
  }
  return error?.message === "SECURITY_CHECK_FAILED" ? "RUNNER_COMPLETION_OR_SAFETY_CHECK" : "DATABASE_OR_CONNECTION_FAILURE";
}
export async function runSecurityAuthorization(config, { open = database(config), report = console.log, read = source } = {}) {
  let passed = true;
  // Parse/review ALL suites before any connection or fixture write.
  const suites = SUITES.map(name => ({ name, list: rollbackSuite(read(name)) }));
  report(`Target locked: ${TEST_PROJECT}; verified TLS; rollback-only SQL; no HTTP/provider calls.`);
  for (const { name, list } of suites) {
    let baseline, client, rolledBack = false, clean = false, failed = false, current = "setup";
    let location = "read-only precheck";
    const statuses = new Map([["setup", "NOT RUN"]]);
    for (const statement of list) if (statement.label) statuses.set(statement.label, "NOT RUN");
    try {
      baseline = await snapshot(open);
      location = "transaction connection";
      client = await open();
      for (const [index, statement] of list.slice(0, -1).entries()) {
        if (statement.label) current = statement.label;
        location = `statement ${index + 1}/${list.length}; line ${statement.line}; ${statement.command}` +
          (statement.step ? `; step ${statement.step}` : "");
        // A case is PASS only after every statement in it completes.
        statuses.set(current, "RUNNING");
        completion(await client.query(statement.text), statement.command, statement.text);
        statuses.set(current, "PASS");
      }
    } catch (error) {
      statuses.set(current, "FAIL"); failed = true;
      report(`FAIL ${name}: ${current} [${location}; ${safeDiagnostic(error)}] (private details suppressed)`);
    } finally {
      if (client) {
        try { completion(await client.query("rollback"), "ROLLBACK"); rolledBack = true; }
        catch (error) { failed = true; report(`FAIL ${name}: rollback [${safeDiagnostic(error)}]`); }
        try { await client.end(); } catch { failed = true; }
      }
      if (baseline) {
        try { clean = await snapshot(open) === baseline; }
        catch (error) { clean = false; report(`FAIL ${name}: independent cleanup [${safeDiagnostic(error)}]`); }
      }
      for (const [label, status] of statuses) report(`${status === "RUNNING" ? "FAIL" : status} ${name}: ${label}`);
      report(`${rolledBack ? "PASS" : "FAIL/UNVERIFIED"} ${name}: transaction rollback`);
      report(`${clean ? "PASS" : "FAIL/UNVERIFIED"} ${name}: independent cleanup, gates closed, scope/key empty, baseline unchanged`);
    }
    if (failed || !rolledBack || !clean) { passed = false; break; }
  }
  report(passed ? "OVERALL PASS" : "OVERALL FAIL (later suites NOT RUN)");
  return passed ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(process.argv.length === 2);
    process.exitCode = await runSecurityAuthorization(await credentials());
  } catch {
    console.error("OVERALL FAIL: preparation/connection failed; private details suppressed. Use Terminal with no arguments and the test CA/host/password.");
    process.exitCode = 1;
  }
}
