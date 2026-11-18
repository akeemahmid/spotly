// Manual-only disposable SQL regression runner. No psql, CLI link or .env loading.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkServerIdentity } from "node:tls";
import { createInterface } from "node:readline/promises";
import { StringDecoder } from "node:string_decoder";
import pg from "pg";
import { loadTrustedCA, classifyFailure, tlsReason } from "./serv-signing-db.mjs";

export const TEST_PROJECT = "ogqmifuylakjhwveqrmd";
export const SCENARIOS = [
  "Existing dispatcher selection, retry, membership count, no verifier promotion",
  "Equal-timestamp dispatcher UUID tie-break",
  "Verifier-only user: personal dispatcher workspace, retry, verifier role preserved",
  "New user: dispatcher workspace and retry without duplicate membership",
  "Missing identity rejected with Authentication required",
  "Anonymous EXECUTE denied, authenticated EXECUTE allowed, definer/search_path hardened",
];
const suiteURL = new URL("../supabase/tests/dispatcher-workspace-authorization.sql", import.meta.url);
const fail = () => { throw new Error("CHECK_FAILED"); };

export function authorizationConfig({ host, password, readFile = readFileSync, home = homedir() }) {
  // The qualified username routes a shared Session pooler ONLY to the test project.
  // No project override, credentials URL, production link or ambient password is accepted.
  if (!/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host ?? "")) fail();
  if (typeof password !== "string" || !password) fail();
  const ca = loadTrustedCA(join(home, ".config/spotly/spotly-security-test-ca.pem"), readFile);
  return {
    host, port: 5432, database: "postgres", user: `postgres.${TEST_PROJECT}`, password,
    ssl: { rejectUnauthorized: true, servername: host, checkServerIdentity, ca },
    sslnegotiation: "postgres", client_encoding: "UTF8",
    connectionTimeoutMillis: 10000, query_timeout: 20000, statement_timeout: 15000,
    lock_timeout: 5000, idle_in_transaction_session_timeout: 30000,
    application_name: "spotly-disposable-dispatcher-authorization",
  };
}

export function compileSuite(sql) {
  // Constrained extraction for this reviewed file, NOT a semicolon SQL splitter.
  // Internal PL/pgSQL semicolons and exception handling stay intact.
  const blocks = [...sql.matchAll(/^do \$\$[\s\S]*?^end \$\$;/gm)];
  const outside = sql.replace(/^do \$\$[\s\S]*?^end \$\$;/gm, "");
  const controls = outside.replace(/^--.*$/gm, "").match(/\b(begin|rollback|commit|end|start\s+transaction|prepare\s+transaction)\b/gi);
  if (blocks.length !== 6 || (sql.match(/\$\$/g) ?? []).length !== 12 ||
      (sql.match(/^begin;/gm) ?? []).length !== 1 ||
      (sql.match(/^rollback;/gm) ?? []).length !== 1 ||
      JSON.stringify(controls) !== '["begin","rollback"]' || /^\s*\\/m.test(outside)) fail();
  const setup = sql.slice(0, blocks[0].index);
  const begin = setup.indexOf("begin;");
  if (begin < 0 || setup.slice(0, begin).split("\n").some(line => line && !line.startsWith("--"))) fail();
  const subjects = ["", "12000000-0000-4000-8000-000000000004", "12000000-0000-4000-8000-000000000002",
    "12000000-0000-4000-8000-000000000003", ""];
  const scenarios = blocks.map((block, i) => {
    const previousEnd = i ? blocks[i - 1].index + blocks[i - 1][0].length : block.index;
    const prefix = sql.slice(previousEnd, block.index).trim();
    const expected = i === 0 ? "" : i === 5 ? "reset role;" :
      `select set_config('request.jwt.claim.sub','${subjects[i]}',true);`;
    if (prefix !== expected) fail();
    return { text: `${prefix}\n${block[0]}`, commands: i === 0 ? ["DO"] : [i === 5 ? "RESET" : "SELECT", "DO"] };
  });
  if (sql.slice(blocks[5].index + blocks[5][0].length).trim() !== "rollback;") fail();
  return { setup, scenarios };
}

const fixtureCheck = `do $$ begin
 if exists(select 1 from auth.users where id in (
  '12000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002',
  '12000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000004'))
 or exists(select 1 from public.workspaces where id in (
  '23000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000002',
  '23000000-0000-4000-8000-000000000003'))
 or exists(select 1 from public.workspace_members where user_id in (
  '12000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002',
  '12000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000004'))
 then raise exception 'Synthetic fixture rows exist'; end if;
end $$;`;
const snapshotSQL = `select
 (select md5(coalesce(jsonb_agg(to_jsonb(w) order by id)::text,'[]')) from public.workspaces w) as workspaces,
 (select md5(coalesce(jsonb_agg(to_jsonb(m) order by workspace_id,user_id)::text,'[]')) from public.workspace_members m) as members`;
function completed(result, commands) {
  const results = Array.isArray(result) ? result : [result];
  if (results.length !== commands.length || results.some((r, i) => r?.command !== commands[i])) fail();
  return results;
}
function safeFailure(error) {
  // Never print driver messages, SQL, credentials, error causes, details or configs.
  const category = classifyFailure(error, "CONNECT");
  return category === "TLS_FAILURE" ? `${category}/${tlsReason(error)}` :
    ["AUTH_FAILURE", "NETWORK_TIMEOUT", "NETWORK_FAILURE"].includes(category) ? category : "CHECK_FAILED";
}

export async function runAuthorization({ host, password, readFile = readFileSync, home = homedir(),
  Client = pg.Client, report = console.log } = {}) {
  const results = SCENARIOS.map(() => "NOT RUN");
  let baseline, suite, config, rollbackAcknowledged = false, cleanupVerified = false, closed = true;
  let stage = "configuration", runError = false;
  const open = async () => {
    const client = new Client(config);
    // Never use ambient PGOPTIONS/replication/binary mode. The endpoint,
    // credentials and TLS policy above are all explicit and have no URL overrides.
    if (client.connectionParameters) {
      client.connectionParameters.options = "";
      client.connectionParameters.replication = undefined;
      client.connectionParameters.binary = false;
    }
    client.on("error", () => { /* query/end errors are handled; never log raw errors */ });
    try { await client.connect(); return client; }
    catch (error) { await client.end().catch(() => {}); throw error; }
  };
  const snapshot = async () => {
    const client = await open(); // A new client/socket, never a pool checkout.
    try {
      completed(await client.query("begin read only isolation level repeatable read"), ["BEGIN"]);
      completed(await client.query(fixtureCheck), ["DO"]);
      const row = completed(await client.query(snapshotSQL), ["SELECT"])[0].rows;
      if (row?.length !== 1 || !/^[a-f0-9]{32}$/.test(row[0].workspaces) || !/^[a-f0-9]{32}$/.test(row[0].members)) fail();
      completed(await client.query("rollback"), ["ROLLBACK"]);
      return `${row[0].workspaces}:${row[0].members}`;
    } finally {
      await client.query("rollback").catch(() => {});
      await client.end();
    }
  };
  try {
    suite = compileSuite(readFile(suiteURL, "utf8"));
    config = authorizationConfig({ host, password, readFile, home });
    report(`Target locked: ${TEST_PROJECT}; certificate and hostname verification required.`);
    stage = "read-only precheck";
    baseline = await snapshot();
    stage = "fixture setup";
    const client = await open();
    closed = false;
    try {
      const setup = completed(await client.query(suite.setup), ["BEGIN", "SET", "INSERT", "INSERT", "INSERT", "SET", "SELECT", "SELECT"]);
      if (setup[2].rowCount !== 4 || setup[3].rowCount !== 3 || setup[4].rowCount !== 7) fail();
      for (const [i, scenario] of suite.scenarios.entries()) {
        stage = `scenario ${i + 1}`;
        completed(await client.query("savepoint spotly_scenario"), ["SAVEPOINT"]);
        try {
          completed(await client.query(scenario.text), scenario.commands);
          results[i] = "PASS";
        } catch (error) {
          results[i] = "FAIL";
          report(`Scenario ${i + 1} error: ${safeFailure(error)}`);
          // Recover the transaction so ALL six assertions can run.
          completed(await client.query("rollback to savepoint spotly_scenario"), ["ROLLBACK"]);
        }
        completed(await client.query("release savepoint spotly_scenario"), ["RELEASE"]);
      }
    } finally {
      try {
        completed(await client.query("rollback"), ["ROLLBACK"]);
        rollbackAcknowledged = true;
      } catch (error) {
        stage = "transaction rollback";
        throw error;
      } finally {
        await client.end();
        closed = true;
      }
    }
  } catch (error) {
    runError = true;
    report(`FAIL ${stage}: ${safeFailure(error)} (private details suppressed)`);
  } finally {
    if (baseline) {
      try { cleanupVerified = await snapshot() === baseline; }
      catch (error) { report(`Cleanup check error: ${safeFailure(error)}`); }
    }
    results.forEach((status, i) => report(`${status} ${i + 1}: ${SCENARIOS[i]}`));
    report(`${cleanupVerified ? "PASS" : "FAIL/UNVERIFIED"} fixture cleanup: fresh read-only connection, fixture IDs absent and baseline unchanged`);
    const rollback = rollbackAcknowledged && closed && cleanupVerified;
    report(`${rollback ? "PASS" : "FAIL/UNVERIFIED"} rollback: transaction rollback and independent fixture/baseline check`);
    report(!runError && results.every(value => value === "PASS") && rollback ? "OVERALL PASS" : "OVERALL FAIL");
  }
  return !runError && results.every(value => value === "PASS") && rollbackAcknowledged && closed && cleanupVerified ? 0 : 1;
}

export function promptPassword({ input = process.stdin, output = process.stdout,
  label = `Test database password for ${TEST_PROJECT} (hidden): ` } = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") return Promise.reject(new Error("TTY_REQUIRED"));
  return new Promise((resolve, reject) => {
    const wasRaw = Boolean(input.isRaw), wasPaused = input.isPaused();
    let value = "";
    const decoder = new StringDecoder("utf8");
    const finish = (error) => {
      input.removeListener("data", onData);
      input.removeListener("error", onError);
      input.removeListener("end", onEnd);
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
      output.write("\n");
      if (error || !value) { value = ""; reject(new Error("PASSWORD_PROMPT_CANCELLED")); }
      else { resolve(value); value = ""; }
    };
    const onError = () => finish(true), onEnd = () => finish(true);
    const onData = (data) => {
      for (const char of decoder.write(data)) {
        if (char === "\u0003" || char === "\u0004") { finish(true); return; }
        if (char === "\r" || char === "\n") { finish(false); return; }
        if (char === "\u007f" || char === "\b") value = [...value].slice(0, -1).join("");
        else if (char >= " ") value += char;
      }
    };
    output.write(label);
    input.setRawMode(true);
    input.on("data", onData);
    input.once("error", onError);
    input.once("end", onEnd);
    input.resume();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    console.log("Run with no arguments in Terminal. Prompts for the test Session pooler hostname and hidden database password. Uses ~/.config/spotly/spotly-security-test-ca.pem.");
  } else {
    try {
      if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) fail();
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      let host;
      try { host = (await terminal.question("Test project's Session pooler hostname (hostname only): ")).trim(); }
      finally { terminal.close(); }
      // Validate target and CA before accepting any password; no connection yet.
      authorizationConfig({ host, password: "local-validation-only" });
      const password = await promptPassword();
      process.exitCode = await runAuthorization({ host, password });
    } catch {
      SCENARIOS.forEach((label, i) => console.log(`NOT RUN ${i + 1}: ${label}`));
      console.error("FAIL/UNVERIFIED rollback: suite not started");
      console.error("OVERALL FAIL: use Terminal, no command arguments, the test Session pooler hostname and the configured test CA. Private details suppressed.");
      process.exitCode = 1;
    }
  }
}
