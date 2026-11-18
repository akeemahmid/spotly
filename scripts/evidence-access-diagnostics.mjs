import { readFileSync } from "node:fs";
import { check, completion, TEST_PROJECT } from "./security-test-db.mjs";
import { inspectStorageGates, storageSetupDiagnostic } from "./storage-setup-diagnostics.mjs";

// Historical disposable object only. Cleanup may already have removed it.
export const failedEvidencePath = "03d75eed-0a91-4020-afda-d728d3ed62bc/2210461a-a7f4-4ae1-b9af-7aaa662ed77b";
const names = ["is_workspace_member", "is_assigned_verifier", "can_read_assignment", "can_read_task_evidence"];
const compact = text => text.replace(/\s+/g, "").trim();
export function expectedReadFunctions() {
  const sql = ["202611050001_phase3a.sql", "202611110001_phase3b.sql"]
    .map(name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")).join("\n");
  return Object.fromEntries(names.map(name => {
    const body = new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\bas \\$\\$([\\s\\S]*?)\\$\\$;`).exec(sql)?.[1];
    check(typeof body === "string");
    return [name, compact(body)];
  }));
}
// Deparser formatting comparison only, never an authorization proof. Unexpected
// expressions/names are not printed: they could contain unrelated private data.
const shape = text => compact((text ?? "").replace(/\b(?:AND|OR)\b/g, word => word.toLowerCase())).replace(/::text\b/g, "").replace(/[()]/g, "").replaceAll("public.can_read_task_evidence", "can_read_task_evidence");
const expectedPolicies = {
  evidence_object_select: { kind: "PERMISSIVE", expression: "bucket_id='verification-evidence' and storage.allow_only_operation('object.get_authenticated') and public.can_read_task_evidence(name)" },
  evidence_object_select_guard: { kind: "RESTRICTIVE", expression: "bucket_id<>'verification-evidence' or (storage.allow_only_operation('object.get_authenticated') and public.can_read_task_evidence(name))" },
};
export function reportEvidencePolicies(rows, report) {
  let matches = true;
  for (const [name, expected] of Object.entries(expectedPolicies)) {
    const found = rows.filter(row => row.policyname === name);
    const row = found[0];
    const match = found.length === 1 && row.cmd === "SELECT" && row.permissive === expected.kind &&
      Array.isArray(row.roles) && row.roles.length === 1 && row.roles[0] === "authenticated" && shape(row.qual) === shape(expected.expression);
    matches &&= match;
    report(`CATALOG ${name}: ${!found.length ? "MISSING" : match ? "SOURCE_SHAPE_MATCH" : "SOURCE_MISMATCH"}`);
  }
  rows.filter(row => !Object.hasOwn(expectedPolicies, row.policyname)).forEach((row, index) => {
    // Every other SELECT/ALL policy is counted, including PUBLIC/anon policies.
    report(`CATALOG additional SELECT/ALL policy ${index + 1}: kind=${["PERMISSIVE", "RESTRICTIVE"].includes(row.permissive) ? row.permissive : "UNKNOWN"}; requires private definition review`);
    matches = false;
  });
  return matches;
}

// Owner-only manual catalog inspection. Uses the caller's fixed disposable
// connection, one read-only transaction, local role/claim/operation settings and
// rollback. No API Auth/Storage calls, fixtures, gate updates or journal changes.
export async function inspectEvidenceAccess(open, report = console.log) {
  let client, operation = "access.local-source", matches = true;
  report(`READ-ONLY evidence access inspection: ${TEST_PROJECT}; no HTTP test, fixture, gate or cleanup writes`);
  try {
    const expected = expectedReadFunctions();
    operation = "access.connect";
    client = await open();
    const query = async (text, values, command = "SELECT") => {
      const result = await client.query(text, values); completion(result, command); return result.rows;
    };
    operation = "access.begin-read-only";
    await query("begin read only isolation level repeatable read", undefined, "BEGIN");
    await query("select set_config('search_path','',true)");
    operation = "access.select-all-object-read-policies";
    matches = reportEvidencePolicies(await query(`select policyname,permissive,roles::text[] as roles,cmd,qual from pg_catalog.pg_policies
      where schemaname='storage' and tablename='objects' and cmd in ('SELECT','ALL') order by policyname`), report);
    operation = "access.select-read-function-definitions";
    const functions = await query(`select p.proname,p.prosrc,p.prosecdef,
      pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
      pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=any($1::text[])`, [names]);
    for (const name of names) {
      const found = functions.filter(row => row.proname === name);
      const row = found[0];
      const match = found.length === 1 && compact(row.prosrc) === expected[name] && row.prosecdef === true && row.authenticated_execute === true && row.anon_execute === false;
      report(`CATALOG public.${name}: ${!found.length ? "MISSING" : match ? "SOURCE_AND_EXECUTE_MATCH" : "SOURCE_OR_EXECUTE_MISMATCH"}`);
      matches &&= match;
    }
    operation = "access.select-historical-object-and-reservation";
    const [record] = await query(`select
      exists(select 1 from storage.objects where bucket_id='verification-evidence' and name=$1) as object_exists,
      (select jsonb_build_object('submitted',e.submitted_at is not null,'status',a.status,
        'owner_matches',exists(select 1 from storage.objects o where o.bucket_id='verification-evidence' and o.name=e.file_path and o.owner_id=e.verifier_id::text),
        'assigned_c',e.verifier_id=(select id from auth.users where email='pilot-c@example.test') and a.verifier_id=e.verifier_id,
        'c_membership',exists(select 1 from public.workspace_members m where m.workspace_id=r.workspace_id and m.user_id=e.verifier_id and m.role='verifier'))
       from public.task_evidence e join public.task_assignments a on a.id=e.assignment_id
       join public.verification_requests r on r.id=a.verification_request_id where e.file_path=$1) as reservation`, [failedEvidencePath]);
    check(typeof record?.object_exists === "boolean");
    report(`HISTORICAL object_present=${record.object_exists ? "YES" : "NO"}; reservation_present=${record.reservation ? "YES" : "NO"}`);
    if (record.reservation) {
      const r = record.reservation;
      const status = ["offered", "accepted", "declined", "submitted", "revision_requested", "approved", "completed"].includes(r.status) ? r.status : "UNKNOWN";
      report(`HISTORICAL submitted=${r.submitted === true ? "YES" : "NO"}; assignment_status=${status}; owner_matches=${r.owner_matches === true}; assigned_c=${r.assigned_c === true}; c_membership=${r.c_membership === true}`);
    }
    if (record.object_exists && record.reservation) {
      for (const label of ["a", "c", "b"]) {
        operation = `access.simulated-${label}-read`;
        const identities = await query("select id from auth.users where email=$1", [`pilot-${label}@example.test`]);
        check(identities.length === 1);
        await query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',jsonb_build_object('sub',$1::text,'role','authenticated')::text,true),set_config('storage.operation','storage.object.get_authenticated',true)", [identities[0].id]);
        await query("set local role authenticated", undefined, "SET");
        const [row] = await query(`select public.can_read_task_evidence($1) as predicate,
          exists(select 1 from storage.objects where bucket_id='verification-evidence' and name=$1) as visible`, [failedEvidencePath]);
        await query("reset role", undefined, "RESET");
        check(typeof row?.predicate === "boolean" && typeof row.visible === "boolean");
        report(`SIMULATED SQL ${label.toUpperCase()}: read_predicate=${row.predicate}; object_visible=${row.visible}; supplied download operation (not captured live JWT/HTTP)`);
        matches &&= row.predicate === (label !== "b") && row.visible === (label !== "b");
      }
      operation = "access.simulated-anonymous-read";
      await query("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{\"role\":\"anon\"}',true)");
      await query("set local role anon", undefined, "SET");
      const [row] = await query("select exists(select 1 from storage.objects where bucket_id='verification-evidence' and name=$1) as visible", [failedEvidencePath]);
      await query("reset role", undefined, "RESET");
      check(typeof row?.visible === "boolean");
      report(`SIMULATED SQL anonymous: object_visible=${row.visible}; not an HTTP test`);
      matches &&= row.visible === false;
    } else report("NOT RUN historical role visibility: object/reservation removed or absent; no fixture recreated");
    operation = "access.rollback";
    await query("rollback", undefined, "ROLLBACK");
  } catch (error) {
    matches = false;
    report(`FAIL evidence access inspection [${operation}]; ${storageSetupDiagnostic(error, operation)}; private definitions/errors withheld`);
  } finally {
    if (client) { await client.query("rollback").catch(() => {}); await client.end().catch(() => {}); }
  }
  const gates = await inspectStorageGates(open, report);
  report("INSPECTION COMPLETE — read-only catalog/SQL diagnostic; live download cause still requires matching deployed definitions and request context; cleanup is separate");
  return matches && gates === 0 ? 0 : 1;
}

// Fresh reproduction only: replay the Auth-verified caller's actual JWT claims,
// not a guessed historical identity. Evaluate the COMPLETE deployed expressions
// on a typed copy of the owner-confirmed row, under authenticated, so a false
// USING does not hide the very row needed to diagnose that false condition.
// This owner diagnostic never serves bytes or bypasses RLS in the product.
export async function verifyFreshDownloadAccess(open, expected, claims, report = console.log) {
  let client, operation = "download-authorization.validate-caller";
  try {
    check(claims?.sub === expected.verifier && claims.role === "authenticated");
    operation = "download-authorization.connect";
    client = await open();
    completion(await client.query("begin read only isolation level repeatable read"), "BEGIN");
    completion(await client.query("select set_config('search_path','',true)"), "SELECT");
    operation = "download-authorization.owner-object-and-policy-snapshot";
    const object = await client.query("select to_jsonb(o) as object_record from storage.objects o where bucket_id='verification-evidence' and name=$1", [expected.path]);
    completion(object, "SELECT");
    check(object.rows?.length === 1);
    const record = object.rows[0].object_record;
    check(record?.name === expected.path && record.bucket_id === "verification-evidence" && record.owner_id === expected.verifier &&
      Number(record.metadata?.size) === expected.size && record.metadata?.mimetype === expected.mime);
    const policies = await client.query(`select p.polname as name,p.polpermissive as permissive,
      pg_catalog.pg_get_expr(p.polqual,p.polrelid) as expression,
      (0=any(p.polroles) or exists(select 1 from pg_catalog.pg_roles r
        where r.oid=any(p.polroles) and pg_catalog.pg_has_role('authenticated',r.oid,'USAGE'))) as applies
      from pg_catalog.pg_policy p where p.polrelid='storage.objects'::regclass and p.polcmd in ('r','*') order by p.polname`);
    completion(policies, "SELECT");
    operation = "download-authorization.replay-verified-claims";
    completion(await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('storage.operation','storage.object.get_authenticated',true)", [claims.sub, JSON.stringify(claims)]), "SELECT");
    completion(await client.query("set local role authenticated"), "SET");
    operation = "download-authorization.relationship-predicates";
    const relationship = await client.query(`select auth.uid()=$2::uuid as uid_matches,
      current_user='authenticated' as role_matches,
      exists(select 1 from public.task_evidence e where e.file_path=$1 and e.id=$3::uuid and e.assignment_id=$4::uuid and e.verifier_id=auth.uid()) as reservation_matches,
      exists(select 1 from public.task_evidence e where e.file_path=$1 and e.submitted_at is null) as pending,
      exists(select 1 from public.task_assignments a where a.id=$4::uuid and a.verifier_id=auth.uid() and a.status in ('accepted','revision_requested')) as assignment_matches,
      exists(select 1 from public.task_assignments a join public.verification_requests r on r.id=a.verification_request_id
        join public.workspace_members m on m.workspace_id=r.workspace_id and m.user_id=auth.uid() and m.role='verifier' where a.id=$4::uuid) as verifier_membership,
      coalesce((select public.is_assigned_verifier(a.verification_request_id,a.plan_id) from public.task_assignments a where a.id=$4::uuid),false) as assigned_verifier,
      public.can_read_assignment($4::uuid) as assignment_read,
      public.can_read_task_evidence($1) as evidence_read,
      exists(select 1 from storage.objects where bucket_id='verification-evidence' and name=$1) as rls_row_visible`,
    [expected.path, expected.verifier, expected.evidence, expected.assignment]);
    completion(relationship, "SELECT");
    check(relationship.rows?.length === 1);
    const values = relationship.rows[0];
    const keys = ["uid_matches", "role_matches", "reservation_matches", "pending", "assignment_matches", "verifier_membership", "assigned_verifier", "assignment_read", "evidence_read", "rls_row_visible"];
    check(keys.every(key => typeof values[key] === "boolean"));
    report(`SQL fresh C relationships (verified JWT claims replay; supplied download operation): ${keys.map(key => `${key}=${values[key]}`).join("; ")}`);
    let permissive = false, restrictive = true;
    const evaluated = new Set();
    for (const [index, policy] of policies.rows.entries()) {
      check(typeof policy.applies === "boolean" && typeof policy.permissive === "boolean");
      if (!policy.applies) continue;
      operation = "download-authorization.evaluate-complete-using";
      // Expression comes only from pg_get_expr in the trusted system catalog;
      // object data and claims remain parameters. No expression text is logged.
      const result = await client.query(`select coalesce((${policy.expression ?? "true"}),false) as allowed
        from jsonb_populate_record(null::storage.objects,$1::jsonb) as objects`, [JSON.stringify(record)]);
      completion(result, "SELECT");
      check(result.rows?.length === 1 && typeof result.rows[0].allowed === "boolean");
      const allowed = result.rows[0].allowed;
      const label = Object.hasOwn(expectedPolicies, policy.name) ? policy.name : `additional-policy-${index + 1}`;
      evaluated.add(policy.name);
      report(`SQL complete USING ${label}: kind=${policy.permissive ? "PERMISSIVE" : "RESTRICTIVE"}; allowed=${allowed}`);
      if (policy.permissive) permissive ||= allowed;
      else restrictive &&= allowed;
    }
    check(Object.keys(expectedPolicies).every(name => evaluated.has(name)));
    const effective = permissive && restrictive;
    report(`SQL fresh C effective_select=${effective}; rls_row_visible=${values.rls_row_visible}; independent SQL snapshot, not the Storage service's internal transaction`);
    operation = "download-authorization.rollback";
    completion(await client.query("rollback"), "ROLLBACK");
    return { verified: true, effective, visible: values.rls_row_visible, relationships: keys.filter(key => key !== "rls_row_visible").every(key => values[key]) };
  } catch (error) {
    report(`FAIL/UNVERIFIED fresh download authorization [${operation}]; ${storageSetupDiagnostic(error, operation)}; no database writes`);
    return { verified: false };
  } finally {
    if (client) { await client.query("rollback").catch(() => {}); await client.end().catch(() => {}); }
  }
}
