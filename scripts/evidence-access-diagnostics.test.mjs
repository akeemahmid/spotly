import test from "node:test";
import assert from "node:assert/strict";
import { expectedReadFunctions, inspectEvidenceAccess, reportEvidencePolicies, verifyFreshDownloadAccess } from "./evidence-access-diagnostics.mjs";

const policies = [
  { policyname: "evidence_object_select", cmd: "SELECT", permissive: "PERMISSIVE", roles: ["authenticated"], qual: "((bucket_id = 'verification-evidence'::text) AND storage.allow_only_operation('object.get_authenticated'::text) AND public.can_read_task_evidence(name))" },
  { policyname: "evidence_object_select_guard", cmd: "SELECT", permissive: "RESTRICTIVE", roles: ["authenticated"], qual: "((bucket_id <> 'verification-evidence'::text) OR (storage.allow_only_operation('object.get_authenticated'::text) AND public.can_read_task_evidence(name)))" },
];
test("catalog inventory includes every SELECT/ALL policy and withholds unexpected expressions/names", () => {
  const logs = [];
  assert.equal(reportEvidencePolicies(policies, line => logs.push(line)), true);
  assert.equal(reportEvidencePolicies(policies.slice(0, 1), line => logs.push(line)), false);
  assert.equal(reportEvidencePolicies([...policies, { policyname: "private-name", cmd: "ALL", permissive: "RESTRICTIVE", qual: "private-secret" }], line => logs.push(line)), false);
  assert.equal(reportEvidencePolicies([{ ...policies[0], qual: "private-secret" }, policies[1]], line => logs.push(line)), false);
  assert.ok(logs.some(line => line.includes("additional SELECT/ALL policy")));
  assert.ok(!logs.join("\n").includes("private-"));
});
for (const present of [true, false]) {
  test(`read-only catalog inspection handles historical evidence ${present ? "present" : "removed"} without fixtures, HTTP or journal access`, async () => {
    const logs = [], queries = [], expected = expectedReadFunctions();
    let label, connections = 0;
    const open = async () => {
      connections++;
      return { end: async () => {}, query: async (sql, values) => {
        queries.push(sql);
        const command = sql.startsWith("begin") ? "BEGIN" : sql === "rollback" ? "ROLLBACK" : sql === "reset role" ? "RESET" : sql.startsWith("set local role") ? "SET" : "SELECT";
        let rows = [];
        if (sql.includes("from pg_catalog.pg_policies")) rows = policies;
        else if (sql.includes("from pg_catalog.pg_proc")) rows = Object.entries(expected).map(([proname, prosrc]) => ({ proname, prosrc, prosecdef: true, authenticated_execute: true, anon_execute: false }));
        else if (sql.includes("as object_exists")) rows = [{ object_exists: present, reservation: present ? { submitted: false, status: "accepted", owner_matches: true, assigned_c: true, c_membership: true } : null }];
        else if (sql.startsWith("select id from auth.users")) { label = values[0].slice(6, 7); rows = [{ id: `18000000-0000-4000-8000-00000000000${{a:1,b:2,c:3}[label]}` }]; }
        else if (sql.includes("as predicate")) rows = [{ predicate: label !== "b", visible: label !== "b" }];
        else if (sql.includes("as visible")) rows = [{ visible: false }];
        else if (sql.includes("as gate_rows")) rows = [{ gate_rows: 1, enabled: false, live_checks_verified: false }];
        return { command, rows };
      } };
    };
    assert.equal(await inspectEvidenceAccess(open, line => logs.push(line)), 0);
    assert.equal(connections, 2);
    assert.ok(queries.every(sql => /^(?:select|begin read only|rollback|set local role|reset role)/.test(sql)));
    assert.ok(!queries.some(sql => /\b(?:insert into|update spotly|delete from|commit)\b/i.test(sql)));
    if (present) {
      assert.ok(logs.some(line => line.includes("SIMULATED SQL C: read_predicate=true; object_visible=true")));
      assert.ok(logs.some(line => line.includes("SIMULATED SQL B: read_predicate=false; object_visible=false")));
      assert.ok(logs.some(line => line.includes("SIMULATED SQL anonymous: object_visible=false")));
    } else assert.ok(logs.some(line => line.startsWith("NOT RUN historical role visibility")));
    assert.ok(logs.at(-1).includes("live download cause still requires"));
  });
}
test("catalog failure is sanitized and gate verification remains independent", async () => {
  const logs = []; let opened = 0;
  const open = async () => { opened++; throw Object.assign(new Error("private-db-password"), { code: "28P01" }); };
  assert.equal(await inspectEvidenceAccess(open, line => logs.push(line)), 1);
  assert.equal(opened, 2);
  assert.ok(logs.some(line => line.includes("[access.connect]; category=AUTH_FAILURE")));
  assert.ok(logs.some(line => line.includes("enabled=UNVERIFIED; live_checks_verified=UNVERIFIED")));
  assert.ok(!logs.join("\n").includes("private-db-password"));
});
for (const restrictiveAllowed of [true, false]) {
  test(`fresh verified-claim replay evaluates complete restrictive USING as ${restrictiveAllowed} without flattening its predicates`, async () => {
    const logs = [], queries = [], expected = { path: "assignment/evidence", verifier: "test-c", assignment: "assignment", evidence: "evidence", size: 95, mime: "image/png" };
    const claims = { sub: "test-c", role: "authenticated", iss: "private-jwt-issuer", extra: "private-jwt-claim" };
    const expression = "(name IS NOT NULL AND (owner_id IS NOT NULL OR metadata IS NULL))";
    const open = async () => ({ end: async () => {}, query: async (sql, values) => {
      queries.push({ sql, values });
      let rows = [];
      if (sql.includes("as object_record")) rows = [{ object_record: { name: expected.path, bucket_id: "verification-evidence", owner_id: expected.verifier, metadata: { size: 95, mimetype: "image/png" } } }];
      if (sql.includes("from pg_catalog.pg_policy")) rows = [
        { name: "evidence_object_select", permissive: true, applies: true, expression: "true" },
        { name: "evidence_object_select_guard", permissive: false, applies: true, expression },
        { name: "private-policy-name", permissive: false, applies: false, expression: "private-expression" },
      ];
      if (sql.includes("as uid_matches")) rows = [Object.fromEntries(["uid_matches", "role_matches", "reservation_matches", "pending", "assignment_matches", "verifier_membership", "assigned_verifier", "assignment_read", "evidence_read", "rls_row_visible"].map(k => [k, k === "rls_row_visible" ? restrictiveAllowed : true]))];
      if (sql.includes("jsonb_populate_record")) rows = [{ allowed: sql.includes(expression) ? restrictiveAllowed : true }];
      return { command: sql.startsWith("begin") ? "BEGIN" : sql === "rollback" ? "ROLLBACK" : sql.startsWith("set local role") ? "SET" : "SELECT", rows };
    } });
    const result = await verifyFreshDownloadAccess(open, expected, claims, line => logs.push(line));
    assert.equal(result.verified, true); assert.equal(result.effective, restrictiveAllowed); assert.equal(result.visible, restrictiveAllowed);
    assert.ok(queries.some(q => q.sql.includes(`coalesce((${expression}),false)`)));
    assert.ok(queries.some(q => q.values?.[1] === JSON.stringify(claims)));
    assert.ok(queries.every(q => /^(?:select|begin read only|set local role|rollback)/.test(q.sql)));
    assert.ok(logs.some(line => line.includes(`evidence_object_select_guard: kind=RESTRICTIVE; allowed=${restrictiveAllowed}`)));
    assert.ok(!logs.join("\n").includes("private-"));
  });
}
