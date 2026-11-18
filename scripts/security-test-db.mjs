// Shared manual security-test utilities. Target/CA/password policy comes from
// the owner-confirmed Node connection; no .env or CLI link is ever read.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import pg from "pg";
import { authorizationConfig, promptPassword, TEST_PROJECT } from "./run-dispatcher-authorization.mjs";
export { TEST_PROJECT, authorizationConfig, promptPassword };
export const check = condition => { if (!condition) throw new Error("SECURITY_CHECK_FAILED"); };
export async function question(label) {
  check(process.stdin.isTTY && process.stdout.isTTY);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  terminal.once("SIGINT", cancel); terminal.once("close", cancel);
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try { return (await terminal.question(label, { signal: controller.signal })).trim(); }
  finally {
    process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel);
    terminal.removeListener("SIGINT", cancel); terminal.removeListener("close", cancel);
    terminal.close();
  }
}
export async function credentials() {
  const host = await question(`Session pooler hostname for ${TEST_PROJECT}: `);
  authorizationConfig({ host, password: "validate-before-secret" });
  return { host, password: await promptPassword() };
}
export function database(config, Client = pg.Client) {
  // Revalidate independently of callers; no supplied config/user/URL can redirect.
  const safe = authorizationConfig(config);
  return async () => {
    const client = new Client(safe);
    if (client.connectionParameters) {
      client.connectionParameters.options = "";
      client.connectionParameters.replication = undefined;
      client.connectionParameters.binary = false;
    }
    client.on("error", () => {}); // Raw driver messages may contain secrets.
    try { await client.connect(); return client; }
    catch (error) { await client.end().catch(() => {}); throw error; }
  };
}

// Lexer for complete SQL statements, including tagged dollar quotes and nested
// block comments. Unlike split(';'), PL/pgSQL/string semicolons stay intact.
export function statements(sql) {
  const output = [];
  let text = "", quote = null, dollar = null, line = false, depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (line) { text += c; if (c === "\n") line = false; continue; }
    if (depth) {
      text += c;
      if (c === "/" && n === "*") { text += n; depth++; i++; }
      else if (c === "*" && n === "/") { text += n; depth--; i++; }
      continue;
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) { text += dollar; i += dollar.length - 1; dollar = null; }
      else text += c;
      continue;
    }
    if (quote) {
      text += c;
      if (c === "\\" && quote === "E'") { check(n !== undefined); text += n; i++; }
      else if (c === quote.at(-1)) {
        if (n === c) { text += n; i++; } else quote = null;
      }
      continue;
    }
    if (c === "-" && n === "-") { text += c + n; line = true; i++; continue; }
    if (c === "/" && n === "*") { text += c + n; depth++; i++; continue; }
    if (c === "'" || c === '"') { quote = c === "'" && /(?:^|\W)E$/i.test(text) ? "E'" : c; text += c; continue; }
    if (c === "$") {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) { dollar = tag; text += tag; i += tag.length - 1; continue; }
    }
    text += c;
    if (c === ";") { output.push(text); text = ""; }
  }
  check(!quote && !dollar && !depth);
  const sqlOffset = value => {
    let p = 0;
    while (p < value.length) {
      if (/\s/.test(value[p])) { p++; continue; }
      if (value.startsWith("--", p)) { const end = value.indexOf("\n", p); p = end < 0 ? value.length : end + 1; continue; }
      if (value.startsWith("/*", p)) {
        let nesting = 1; p += 2;
        while (p < value.length && nesting) {
          if (value.startsWith("/*", p)) { nesting++; p += 2; }
          else if (value.startsWith("*/", p)) { nesting--; p += 2; }
          else p++;
        }
        check(nesting === 0); continue;
      }
      break;
    }
    return p;
  };
  const withoutComments = value => value.slice(sqlOffset(value)).trim();
  check(!withoutComments(text)); // Never silently discard trailing SQL.
  let offset = 0;
  return output.flatMap(value => {
    const start = offset; offset += value.length;
    const clean = withoutComments(value);
    if (!clean) return [];
    const command = clean.match(/^[A-Za-z]+/)?.[0].toUpperCase();
    check(command && !/^\\/m.test(clean));
    const label = [...value.matchAll(/^-- spotly:case (.+)$/gm)].at(-1)?.[1];
    const step = [...value.matchAll(/^-- spotly:step ([a-z][a-z0-9_]{0,79})$/gm)].at(-1)?.[1];
    const line = sql.slice(0, start + sqlOffset(value)).split("\n").length;
    return [{ text: value, command, label, step, line }];
  });
}
export function rollbackSuite(sql) {
  const list = statements(sql);
  check(list.length > 2 && list[0].command === "BEGIN" && list.at(-1).command === "ROLLBACK");
  check(list[0].text.replace(/--[^\n]*/g, "").trim() === "begin;" && list.at(-1).text.trim() === "rollback;");
  const allowed = new Set(["SET", "RESET", "SELECT", "DO", "INSERT", "UPDATE", "DELETE", "CREATE", "REVOKE", "GRANT"]);
  check(list.slice(1, -1).every(s => allowed.has(s.command)));
  return list;
}
export function completion(result, command, text = "") {
  check(!Array.isArray(result));
  check(result?.command === command || command === "CREATE" && /create temporary table \w+ as\s+select/i.test(text) && result?.command === "SELECT");
}
const publicTables = ["workspaces", "workspace_members", "verification_requests", "verification_plans", "task_events", "task_assignments", "task_evidence", "assignment_events"];
export const snapshotSQL = `select jsonb_build_object(
 'gate_closed',(select count(*)=1 and bool_and(not enabled and not live_checks_verified) from spotly_private.workflow_gate),
 'scope_empty',not exists(select 1 from spotly_private.workflow_pilot),
 'key_empty',not exists(select 1 from spotly_private.serv_plan_key),
 'objects_empty',not exists(select 1 from storage.objects where bucket_id='verification-evidence'),
 'helpers_absent',to_regprocedure('public.phase3b_test_expect_denied(text)') is null and to_regprocedure('public.pilot_test_denied(text)') is null,
 'bucket_ok',exists(select 1 from storage.buckets where id='verification-evidence' and not public and file_size_limit=8388608 and allowed_mime_types @> array['image/png','image/jpeg','image/webp']::text[] and allowed_mime_types <@ array['image/png','image/jpeg','image/webp']::text[]),
 'auth_ids',(select md5(coalesce(jsonb_agg(id order by id)::text,'[]')) from auth.users),
 ${publicTables.map(name => `'${name}',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.${name} t)`).join(",\n ")},
 'bucket',(select md5(to_jsonb(b)::text) from storage.buckets b where id='verification-evidence'),
 'app_empty',${publicTables.map(name => `not exists(select 1 from public.${name})`).join(" and ")}
) as snapshot`;
export async function snapshot(open, onStage = () => {}) {
  onStage("baseline.connect");
  const client = await open();
  try {
    onStage("baseline.begin-read-only");
    completion(await client.query("begin read only isolation level repeatable read"), "BEGIN");
    onStage("baseline.select-snapshot");
    const result = await client.query(snapshotSQL);
    onStage("baseline.validate-result");
    completion(result, "SELECT");
    check(result.rows?.length === 1);
    const value = result.rows[0].snapshot;
    for (const condition of ["gate_closed", "scope_empty", "key_empty", "objects_empty", "helpers_absent", "bucket_ok", "app_empty"]) {
      onStage(`baseline.assert-${condition}`);
      check(value?.[condition] === true);
    }
    onStage("baseline.validate-fingerprints");
    check([...publicTables, "bucket", "auth_ids"].every(name => /^[a-f0-9]{32}$/.test(value[name])));
    onStage("baseline.rollback");
    completion(await client.query("rollback"), "ROLLBACK");
    return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  } finally { await client.query("rollback").catch(() => {}); await client.end().catch(() => {}); }
}
export function source(name) { return readFileSync(new URL(`../supabase/tests/${name}`, import.meta.url), "utf8"); }
