import test from "node:test";
import assert from "node:assert/strict";
import { statements, rollbackSuite, source } from "./security-test-db.mjs";
import { runSecurityAuthorization, safeDiagnostic, SUITES } from "./run-security-authorization.mjs";

export function emptySnapshot() {
  return Object.fromEntries([
    ...["gate_closed", "scope_empty", "key_empty", "objects_empty", "helpers_absent", "bucket_ok", "app_empty"].map(k => [k, true]),
    ...["auth_ids", "bucket", "workspaces", "workspace_members", "verification_requests", "verification_plans", "task_events", "task_assignments", "task_evidence", "assignment_events"].map(k => [k, "a".repeat(32)]),
  ]);
}
test("SQL lexer preserves semicolons in strings, dollar-quoted functions, tagged dynamic SQL and nested comments", () => {
  const sql = `-- heading\nbegin; /* outer /* inner ; */ outer */
create function test() returns void language plpgsql as $body$ begin perform ';'; perform $q$select ';'$q$; end $body$;
select 'it''s; safe', E'escaped\\\';value', "a;b"; rollback; -- trailing\n`;
  const list = statements(sql);
  assert.deepEqual(list.map(s => s.command), ["BEGIN", "CREATE", "SELECT", "ROLLBACK"]);
  assert.deepEqual(list.map(s => s.line), [2, 3, 4, 4]);
  assert.ok(list[1].text.includes("perform $q$select ';'$q$;"));
  for (const bad of ["select 'unterminated;", "do $tag$ never closes;", "select 1; select 2", "/* never closes"]) assert.throws(() => statements(bad));
});
test("all three checked-in SQL suites parse completely and cannot commit through rollback runner", () => {
  for (const name of SUITES) {
    const text = source(name), list = rollbackSuite(text);
    assert.ok(list.length > 20);
    assert.ok(list.some(s => s.label));
    assert.equal(list.at(-1).command, "ROLLBACK");
    assert.throws(() => rollbackSuite(text.replace(/rollback;\s*$/, "commit;")));
    assert.throws(() => rollbackSuite(text.replace("begin;", "begin; commit; begin;")));
  }
  const phase = source("phase3b-authorization.sql");
  assert.match(phase, /for mode in 1\.\.4 loop/);
  assert.match(phase, /Positive-control pilot unavailable/);
  assert.match(phase, /approved request-workspace verifier required/);
});
function fixture(mode, fault) {
  const clients = [], queries = [], logs = [];
  const open = async () => {
    const id = clients.length;
    const client = { id, async query(text) {
      queries.push({ id, text });
      if (text.includes("as snapshot")) {
        const state = emptySnapshot();
        if (mode === "dirty" && id === 2) state.gate_closed = false;
        if (mode === "collision" && id === 0) state.app_empty = false;
        if (mode === "auth-changed" && id === 2) state.auth_ids = "b".repeat(32);
        return { command: "SELECT", rows: [{ snapshot: state }] };
      }
      if (mode === "assertion" && text.includes("spotly:case owner reads")) throw new Error("private password key SQL details");
      const s = statements(text.trim().endsWith(";") ? text : text + ";")[0];
      if (fault && s.step === fault.step) throw Object.assign(new Error(fault.message), {
        code: fault.code, detail: "secret-token", hint: "postgres://private", where: "secret SQL parameters",
        constraint: "private-signing-key", stack: "private-stack", cause: "private-cause",
      });
      if (mode === "truncated" && text.includes("spotly:case owner reads")) return [];
      return { command: s.command, rows: [] };
    }, async end() { this.ended = true; } };
    clients.push(client); return client;
  };
  return { open, clients, queries, logs };
}
test("diagnostics allowlist SQLSTATE/categories and never interpolate private driver properties", () => {
  assert.equal(safeDiagnostic({ code: "42501", message: "secret-token" }), "SQLSTATE 42501; AUTHORIZATION_DENIED");
  assert.equal(safeDiagnostic({ code: "P0001", message: "Evidence binding mismatch" }), "SQLSTATE P0001; EVIDENCE_BINDING_MISMATCH");
  assert.equal(safeDiagnostic({ code: "P0001", message: "Evidence binding mismatch: secret-token" }), "SQLSTATE P0001; RPC_OR_ASSERTION_REJECTED");
  assert.equal(safeDiagnostic({ code: "TOKEN", message: "secret-token" }), "DATABASE_OR_CONNECTION_FAILURE");
  assert.equal(safeDiagnostic(new Error("SECURITY_CHECK_FAILED")), "RUNNER_COMPLETION_OR_SAFETY_CHECK");
});
for (const fault of [
  { step: "evidence_submit_first", code: "P0001", message: "Evidence binding mismatch" },
  { step: "evidence_submit_retry", code: "42501", message: "private password" },
  { step: "evidence_private_read", code: "P0001", message: "private password" },
  { step: "immutable_object_delete", code: "XX000", message: "private password" },
  { step: "immutable_object_preserved", code: "P0001", message: "private password" },
]) {
  test(`Phase 3B failure identifies ${fault.step}, stops dependent work, rolls back and independently checks cleanup`, async () => {
    const f = fixture("pass", fault);
    assert.equal(await runSecurityAuthorization({}, { open: f.open, report: x => f.logs.push(x) }), 1);
    const list = rollbackSuite(source("phase3b-authorization.sql"));
    const index = list.findIndex(s => s.step === fault.step);
    assert.ok(index > 0);
    const log = f.logs.find(x => x.startsWith("FAIL phase3b-authorization.sql:") && x.includes("[statement"));
    assert.ok(log.includes(`statement ${index + 1}/${list.length}; line ${list[index].line}; ${list[index].command}; step ${fault.step}; ${safeDiagnostic(fault)}`));
    assert.ok(f.logs.includes("NOT RUN phase3b-authorization.sql: verifier self-review and cross-workspace evidence denial"));
    assert.ok(f.logs.includes("PASS phase3b-authorization.sql: transaction rollback"));
    assert.ok(f.logs.some(x => x.startsWith("PASS phase3b-authorization.sql: independent cleanup")));
    assert.equal(f.clients.length, 6); // Only suites 1/2: before, transaction, after.
    assert.ok(f.clients.every(c => c.ended));
    const executed = f.queries.filter(q => q.id === 4);
    assert.deepEqual(executed.slice(0, -1).map(q => q.text), list.slice(0, index + 1).map(s => s.text));
    assert.equal(executed.at(-1).text, "rollback");
    for (const secret of ["private password", "secret-token", "postgres://", "secret SQL", "private-signing-key", "private-stack", "private-cause"]) {
      assert.equal(f.logs.join("\n").includes(secret), false);
    }
    assert.match(f.logs.at(-1), /OVERALL FAIL/);
  });
}
test("remaining SQL runner awaits every statement, closes each suite and checks a new connection after each", async () => {
  const f = fixture("pass");
  assert.equal(await runSecurityAuthorization({}, { open: f.open, report: x => f.logs.push(x) }), 0);
  assert.equal(f.clients.length, 9); // precheck / transaction / independent check per suite
  for (let n = 0; n < 3; n++) {
    const executed = f.queries.filter(q => q.id === n * 3 + 1);
    const expected = rollbackSuite(source(SUITES[n])).slice(0, -1).map(s => s.text);
    assert.deepEqual(executed.slice(0, -1).map(q => q.text), expected);
    assert.equal(executed.at(-1).text, "rollback");
  }
  assert.ok(f.clients.every(c => c.ended));
  assert.equal(f.logs.at(-1), "OVERALL PASS");
  assert.equal(f.logs.filter(x => x.includes("independent cleanup") && x.startsWith("PASS")).length, 3);
});
for (const mode of ["assertion", "truncated", "dirty", "auth-changed", "collision"]) {
  test(`remaining SQL runner fails closed on ${mode}, rolls back started transaction, never logs private details`, async () => {
    const f = fixture(mode);
    assert.equal(await runSecurityAuthorization({}, { open: f.open, report: x => f.logs.push(x) }), 1);
    assert.equal(f.clients.length, mode === "collision" ? 1 : 3);
    assert.ok(f.clients.every(c => c.ended));
    assert.match(f.logs.at(-1), /OVERALL FAIL/);
    assert.ok(!f.logs.join("\n").includes("private password"));
    if (mode !== "collision") assert.equal(f.queries.filter(q => q.id === 1).at(-1).text, "rollback");
  });
}
