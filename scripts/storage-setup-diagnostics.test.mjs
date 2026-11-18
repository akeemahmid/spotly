import test from "node:test";
import assert from "node:assert/strict";
import { inspectStorageGates, inspectStorageSetup, storageSetupDiagnostic } from "./storage-setup-diagnostics.mjs";

test("setup diagnostics allowlist SQL/TLS/auth/network/filesystem categories and suppress arbitrary fields", () => {
  for (const [error, operation, category, state] of [
    [{ code: "28P01" }, "bucket.connect", "AUTH_FAILURE", "28P01"],
    [{ code: "P0002" }, "fixture.statement-1-do", "REQUIRED_ROW_MISSING", "P0002"],
    [{ code: "23505" }, "fixture.statement-1-do", "UNIQUE_CONSTRAINT", "23505"],
    [{ code: "42P01" }, "bucket.select-configuration", "TABLE_UNAVAILABLE", "42P01"],
    [{ code: "ERR_TLS_CERT_ALTNAME_INVALID" }, "bucket.connect", "TLS_FAILURE", "UNAVAILABLE"],
    [{ cause: { code: "ETIMEDOUT" } }, "bucket.connect", "NETWORK_TIMEOUT", "UNAVAILABLE"],
    [{ code: "ENOSPC" }, "journal.create", "DISK_FULL", "UNAVAILABLE"],
    [{ code: "private-secret" }, "bucket.select-configuration", "DATABASE_OR_LOCAL_CHECK_FAILURE", "UNAVAILABLE"],
  ]) {
    const output = storageSetupDiagnostic({ message: "private-password", detail: "private-detail", hint: "private-hint",
      where: "private-sql", config: "private-url", stack: "private-stack", ...error, status: "403\nprivate-key" }, operation);
    assert.ok(output.includes(`category=${category}; sqlstate=${state}; actual_http=UNAVAILABLE`));
    assert.ok(!output.includes("private-"));
  }
});
test("gate verification is read-only, distinguishes each flag and fails closed without a valid singleton", async () => {
  for (const row of [
    { gate_rows: 1, enabled: false, live_checks_verified: false },
    { gate_rows: 1, enabled: true, live_checks_verified: false },
    { gate_rows: 1, enabled: false, live_checks_verified: true },
    { gate_rows: 0, enabled: null, live_checks_verified: null },
    { gate_rows: 2, enabled: false, live_checks_verified: false },
  ]) {
    const queries = [], logs = []; let ended = false;
    const open = async () => ({ query: async text => {
      queries.push(text);
      return { command: text.startsWith("begin") ? "BEGIN" : text === "rollback" ? "ROLLBACK" : "SELECT", rows: [row] };
    }, end: async () => { ended = true; } });
    const expected = row.gate_rows === 1 && !row.enabled && !row.live_checks_verified ? 0 : 1;
    assert.equal(await inspectStorageGates(open, line => logs.push(line)), expected);
    assert.ok(queries.every(q => /^(?:begin read only|select|rollback)/.test(q)));
    assert.equal(ended, true);
    if (row.gate_rows !== 1) assert.ok(logs[0].includes("enabled=UNVERIFIED; live_checks_verified=UNVERIFIED"));
    else assert.ok(logs[0].includes(`enabled=${row.enabled ? "OPEN" : "CLOSED"}; live_checks_verified=${row.live_checks_verified ? "OPEN" : "CLOSED"}`));
  }
});
test("journal-free setup inspection reports failed bucket connect and independently retries read-only gate verification", async () => {
  const logs = []; let connections = 0;
  const open = async () => { connections++; throw Object.assign(new Error("private-password"), { code: "28P01" }); };
  const journal = { exists: () => false, read: () => assert.fail("journal read"), write: () => assert.fail("journal write") };
  assert.equal(await inspectStorageSetup(open, journal, line => logs.push(line)), 1);
  assert.equal(connections, 2);
  assert.ok(logs.some(line => line.includes("[bucket.connect]; category=AUTH_FAILURE; sqlstate=28P01")));
  assert.ok(logs.some(line => line.includes("[gates.connect]")));
  assert.ok(logs.some(line => line.includes("journal_present=NO; database_writes=NONE_BY_THIS_COMMAND")));
  assert.ok(!logs.join("\n").includes("private-password"));
});
test("failed query is not replaced by a disconnect error", async () => {
  const logs = [];
  const open = async () => ({
    query: async () => { throw Object.assign(new Error("private-query"), { code: "42501" }); },
    end: async () => { throw new Error("private-disconnect"); },
  });
  assert.equal(await inspectStorageSetup(open, { exists: () => false }, line => logs.push(line)), 1);
  assert.ok(logs.some(line => line.includes("[bucket.begin-read-only]; category=AUTHORIZATION_DENIED; sqlstate=42501")));
  assert.ok(!logs.join("\n").includes("private-"));
});
test("only the numeric line from a known PL/pgSQL context is emitted", () => {
  const error = { code: "23514", where: "PL/pgSQL function inline_code_block line 32 at SQL statement" };
  assert.ok(storageSetupDiagnostic(error, "fixture.statement-1-do").endsWith("; plpgsql_line=32"));
  assert.ok(!storageSetupDiagnostic({ ...error, where: error.where + "\nprivate-key" }, "fixture.statement-1-do").includes("plpgsql_line"));
});
