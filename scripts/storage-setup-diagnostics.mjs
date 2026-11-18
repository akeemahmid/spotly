import { check, completion, snapshot, TEST_PROJECT } from "./security-test-db.mjs";
import { inspectStorageBucket, httpStatus } from "./storage-limit-diagnostics.mjs";
import { safeDiagnostic } from "./run-security-authorization.mjs";
import { classifyFailure, tlsReason } from "./serv-signing-db.mjs";

// Only fixed categories and known SQLSTATEs leave the process. Never emit driver
// messages/details/hints/where, SQL, URLs, paths, configs, stacks or raw causes.
const extraStates = new Map([
  ["28P01", "AUTH_FAILURE"], ["28000", "AUTH_FAILURE"],
  ["3F000", "SCHEMA_NOT_READY"], ["P0002", "REQUIRED_ROW_MISSING"],
  ["P0003", "REQUIRED_ROW_NOT_UNIQUE"], ["08001", "NETWORK_FAILURE"],
  ["08003", "NETWORK_FAILURE"], ["08006", "NETWORK_FAILURE"],
  ["53300", "CONNECTION_LIMIT"], ["57P03", "DATABASE_UNAVAILABLE"],
  ["42601", "SQL_SYNTAX_ERROR"], ["42804", "DATATYPE_MISMATCH"],
  ["42846", "TYPE_COERCION_FAILED"], ["22001", "VALUE_TOO_LONG"],
  ["22003", "NUMERIC_OUT_OF_RANGE"], ["22007", "INVALID_DATETIME"],
  ["0A000", "FEATURE_NOT_SUPPORTED"], ["3D000", "DATABASE_UNAVAILABLE"],
]);
const fileCodes = new Map([["EACCES", "FILE_PERMISSION_DENIED"], ["EPERM", "FILE_PERMISSION_DENIED"],
  ["EEXIST", "FILE_ALREADY_EXISTS"], ["ENOSPC", "DISK_FULL"], ["ENOENT", "FILE_MISSING"]]);
export function storageSetupDiagnostic(error, operation) {
  const sql = /^SQLSTATE ([A-Z0-9]{5}); (\w+)$/.exec(safeDiagnostic(error));
  const state = sql?.[1] ?? (extraStates.has(error?.code) ? error.code : undefined);
  let category = sql?.[2] ?? extraStates.get(state);
  const classified = classifyFailure(error, operation.endsWith(".connect") ? "CONNECT" : "QUERY");
  if (!category) {
    if (operation.startsWith("journal.")) category = fileCodes.get(error?.code) ?? "JOURNAL_IO_OR_VALIDATION_FAILURE";
    else if (["TLS_FAILURE", "AUTH_FAILURE", "NETWORK_TIMEOUT", "NETWORK_FAILURE", "CONNECTION_FAILURE"].includes(classified)) category = classified;
    else if (error?.message === "SECURITY_CHECK_FAILED") category = "RUNNER_COMPLETION_OR_SAFETY_CHECK";
    else category = "DATABASE_OR_LOCAL_CHECK_FAILURE";
  }
  const line = /^PL\/pgSQL function inline_code_block line ([1-9][0-9]{0,5}) at (?:SQL statement|RAISE|assignment)$/.exec(error?.where ?? "")?.[1];
  return `category=${category}; sqlstate=${state ?? "UNAVAILABLE"}; actual_http=${httpStatus(error?.status) ?? "UNAVAILABLE"}${category === "TLS_FAILURE" ? `; tls_reason=${tlsReason(error)}` : ""}${line ? `; plpgsql_line=${Number(line)}` : ""}`;
}

// Independent socket/transaction; works without a journal. No fixture, gate,
// Auth, HTTP or journal writes. Missing/invalid singleton is never CLOSED.
export async function inspectStorageGates(open, report = console.log) {
  let client, operation = "gates.connect";
  try {
    client = await open();
    operation = "gates.begin-read-only";
    completion(await client.query("begin read only isolation level repeatable read"), "BEGIN");
    operation = "gates.select-flags";
    const result = await client.query(`select count(*)::int as gate_rows,
      bool_and(enabled) as enabled, bool_and(live_checks_verified) as live_checks_verified
      from spotly_private.workflow_gate where singleton`);
    operation = "gates.validate-result";
    completion(result, "SELECT");
    const row = result.rows?.[0];
    check(result.rows?.length === 1 && row?.gate_rows === 1 &&
      typeof row.enabled === "boolean" && typeof row.live_checks_verified === "boolean");
    operation = "gates.rollback";
    completion(await client.query("rollback"), "ROLLBACK");
    const closed = !row.enabled && !row.live_checks_verified;
    report(`${closed ? "PASS" : "FAIL"} independent test gates: enabled=${row.enabled ? "OPEN" : "CLOSED"}; live_checks_verified=${row.live_checks_verified ? "OPEN" : "CLOSED"}; fresh read-only connection`);
    return closed ? 0 : 1;
  } catch (error) {
    report(`FAIL/UNVERIFIED independent test gates [${operation}]; ${storageSetupDiagnostic(error, operation)}; enabled=UNVERIFIED; live_checks_verified=UNVERIFIED`);
    return 1;
  } finally {
    if (client) { await client.query("rollback").catch(() => {}); await client.end().catch(() => {}); }
  }
}

export async function inspectStorageSetup(open, journal, report = console.log) {
  let operation = "journal.presence", passed = false;
  report(`READ-ONLY setup inspection: ${TEST_PROJECT}; no fixtures, gates, HTTP tests or journal changes`);
  try {
    report(`INFO journal_present=${journal.exists() ? "YES" : "NO"}; database_writes=NONE_BY_THIS_COMMAND`);
    const onStage = value => { operation = value; };
    await inspectStorageBucket(open, report, onStage);
    await snapshot(open, onStage);
    report("PASS read-only setup prerequisites (bucket and empty baseline)");
    passed = true;
  } catch (error) {
    report(`FAIL read-only setup [${operation}]; ${storageSetupDiagnostic(error, operation)}; database_writes=NONE_BY_THIS_COMMAND`);
  }
  const gates = await inspectStorageGates(open, report);
  report(passed && gates === 0 ? "SETUP INSPECTION PASS — read-only; HTTP tests NOT RUN" : "SETUP INSPECTION FAIL — read-only; HTTP tests NOT RUN");
  return passed && gates === 0 ? 0 : 1;
}
