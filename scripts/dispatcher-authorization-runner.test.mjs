import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity, rootCertificates } from "node:tls";
import { spawnSync } from "node:child_process";
import {
  authorizationConfig, compileSuite, promptPassword, runAuthorization, TEST_PROJECT,
} from "./run-dispatcher-authorization.mjs";

// All connections are mocked; tests never access a network or real credentials.
const sql = readFileSync(new URL("../supabase/tests/dispatcher-workspace-authorization.sql", import.meta.url), "utf8");
const compiled = compileSuite(sql);
const host = "aws-0-eu-west-1.pooler.supabase.com";
const password = "synthetic-password-must-stay-private";
const command = (value, extra = {}) => ({ command: value, rows: [], ...extra });
function fixture(mode) {
  const logs = [], clients = [], queries = [];
  const readFile = (path) => typeof path === "string" && path.endsWith("spotly-security-test-ca.pem")
    ? rootCertificates[0] : sql;
  class Client {
    constructor(config) {
      this.config = config;
      this.id = clients.length;
      this.connectionParameters = { options: "ambient-unsafe-options", replication: "database", binary: true };
      clients.push(this);
    }
    on() {}
    async connect() {
      if (mode === "tls" || mode === "cleanup-offline" && this.id === 2) {
        throw Object.assign(new Error(`${password} secret-key postgres://private`), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
      }
    }
    async query(text) {
      queries.push({ client: this.id, text });
      if (text === "begin read only isolation level repeatable read") return command("BEGIN");
      if (text.includes("Synthetic fixture rows exist")) {
        if (mode === "collision" && this.id === 0 || mode === "leaked-fixture" && this.id === 2) throw new Error(password);
        return command("DO");
      }
      if (text.includes("as workspaces")) return command("SELECT", { rows: [{
        workspaces: (mode === "dirty" && this.id === 2 ? "b" : "a").repeat(32), members: "a".repeat(32),
      }] });
      if (text === compiled.setup) {
        if (mode === "setup") throw new Error(password);
        return ["BEGIN", "SET", "INSERT", "INSERT", "INSERT", "SET", "SELECT", "SELECT"]
          .map((c, i) => command(c, { rowCount: [null, null, 4, 3, 7, null, 1, 1][i] }));
      }
      const scenario = compiled.scenarios.findIndex(s => s.text === text);
      if (scenario >= 0) {
        if (mode === "assertion" && scenario === 2) throw Object.assign(new Error(password), { code: "P0001" });
        // Simulate the old incomplete-result problem: a successful await is insufficient.
        if (mode === "truncated" && scenario === 3) return command("SELECT");
        return compiled.scenarios[scenario].commands.map(c => command(c));
      }
      if (text === "savepoint spotly_scenario") return command("SAVEPOINT");
      if (text === "rollback to savepoint spotly_scenario") return command("ROLLBACK");
      if (text === "release savepoint spotly_scenario") return command("RELEASE");
      if (text === "rollback") {
        if (mode === "rollback" && this.id === 1) throw new Error(password);
        return command("ROLLBACK");
      }
      assert.fail("Unexpected SQL in mocked client");
    }
    async end() { this.ended = true; }
  }
  return { logs, clients, queries, options: { host, password, readFile, home: "/synthetic-home", Client, report: line => logs.push(line) } };
}

test("Node authorization runner uses the installed pg client with fixed target and verified test CA", () => {
  let requested;
  const config = authorizationConfig({ host, password, home: "/synthetic-home", readFile: path => {
    requested = path;
    return rootCertificates[0];
  } });
  assert.equal(config.user, `postgres.${TEST_PROJECT}`);
  assert.equal(config.database, "postgres");
  assert.equal(config.port, 5432);
  assert.equal(config.host, host);
  assert.equal(config.password, password);
  assert.equal(config.connectionString, undefined);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.servername, host);
  assert.equal(config.ssl.checkServerIdentity, checkServerIdentity);
  assert.deepEqual(config.ssl.ca, [new X509Certificate(rootCertificates[0]).toString()]);
  assert.equal(config.sslnegotiation, "postgres");
  assert.equal(requested, "/synthetic-home/.config/spotly/spotly-security-test-ca.pem");
  for (const badHost of ["onfdusisfidlfdmluwxl.supabase.co", "db.onfdusisfidlfdmluwxl.supabase.co", "localhost", "postgres://secret@host"]) {
    assert.throws(() => authorizationConfig({ host: badHost, password }));
  }
  assert.throws(() => authorizationConfig({ host, password: "" }));
  assert.throws(() => authorizationConfig({ host, password, readFile: () => "invalid CA" }));
});

test("suite extraction keeps all six original DO blocks and nested semicolons intact, rejects transaction changes", () => {
  const original = [...sql.matchAll(/^do \$\$[\s\S]*?^end \$\$;/gm)];
  assert.equal(compiled.scenarios.length, 6);
  for (let i = 0; i < 6; i++) assert.ok(compiled.scenarios[i].text.endsWith(original[i][0]));
  assert.match(compiled.scenarios[4].text, /exception when raise_exception/);
  for (const changed of [sql.replace("rollback;", "commit;"), sql.replace("set local statement_timeout", "commit; set local statement_timeout"),
    sql.replace("rollback;", ""), sql.replace(original[0][0], ""), sql + "\\echo unsafe\n"]) {
    assert.throws(() => compileSuite(changed));
  }
});

test("all six scenarios execute on ONE transaction connection, followed by independent read-only fixture check", async () => {
  const f = fixture("pass");
  assert.equal(await runAuthorization(f.options), 0);
  assert.equal(f.clients.length, 3);
  assert.ok(f.clients.every(c => c.ended));
  assert.ok(f.clients.every(c => c.connectionParameters.options === "" && c.connectionParameters.replication === undefined));
  for (const scenario of compiled.scenarios) {
    assert.equal(f.queries.filter(q => q.text === scenario.text).length, 1);
    assert.equal(f.queries.find(q => q.text === scenario.text).client, 1);
  }
  for (const id of [0, 2]) {
    const reads = f.queries.filter(q => q.client === id);
    assert.equal(reads[0].text, "begin read only isolation level repeatable read");
    assert.ok(reads.some(q => q.text.includes("Synthetic fixture rows exist")));
    assert.ok(reads.some(q => q.text.includes("as workspaces")));
  }
  assert.equal(f.logs.filter(line => /^PASS [1-6]:/.test(line)).length, 6);
  assert.ok(f.logs.some(line => line.startsWith("PASS rollback")));
  assert.equal(f.logs.at(-1), "OVERALL PASS");
});

test("an assertion failure runs the remaining scenarios via savepoint recovery, rolls back and exits nonzero", async () => {
  const f = fixture("assertion");
  assert.equal(await runAuthorization(f.options), 1);
  assert.ok(f.queries.some(q => q.text === "rollback to savepoint spotly_scenario"));
  assert.ok(f.logs.some(line => line.startsWith("FAIL 3:")));
  assert.ok(f.logs.some(line => line.startsWith("PASS 6:")));
  assert.ok(f.logs.some(line => line.startsWith("PASS rollback")));
  assert.equal(f.clients.length, 3);
  assert.equal(f.logs.at(-1), "OVERALL FAIL");
  assert.equal(f.logs.join("\n").includes(password), false);
});

for (const mode of ["truncated", "dirty", "leaked-fixture", "cleanup-offline", "rollback", "setup"]) {
  test(`Node authorization runner fails closed on ${mode} and attempts fresh cleanup verification`, async () => {
    const f = fixture(mode);
    assert.equal(await runAuthorization(f.options), 1);
    assert.equal(f.clients.length, 3);
    assert.ok(f.clients.every(c => c.ended));
    assert.equal(f.logs.at(-1), "OVERALL FAIL");
    assert.equal(f.logs.join("\n").includes(password), false);
    if (mode !== "truncated" && mode !== "setup") assert.ok(f.logs.some(line => line.startsWith("FAIL/UNVERIFIED rollback")));
  });
}
for (const mode of ["collision", "tls"]) {
  test(`precheck ${mode} stops before fixtures, suppresses raw errors and prints all six results`, async () => {
    const f = fixture(mode);
    assert.equal(await runAuthorization(f.options), 1);
    assert.equal(f.clients.length, 1);
    assert.ok(f.clients[0].ended);
    assert.equal(f.logs.filter(line => /^NOT RUN [1-6]:/.test(line)).length, 6);
    assert.equal(f.logs.at(-1), "OVERALL FAIL");
    for (const secret of [password, "secret-key", "postgres://private"]) assert.equal(f.logs.join("\n").includes(secret), false);
  });
}

function terminal() {
  const input = new EventEmitter();
  let paused = true;
  Object.assign(input, { isTTY: true, isRaw: false, isPaused: () => paused,
    setRawMode(value) { this.isRaw = value; }, resume() { paused = false; }, pause() { paused = true; } });
  const output = { isTTY: true, text: "", write(value) { this.text += value; } };
  return { input, output };
}
test("private password prompt never echoes input, handles split Unicode/backspace and restores terminal state", async () => {
  const t = terminal();
  const promise = promptPassword(t);
  assert.equal(t.input.isRaw, true);
  const bytes = Buffer.from("café");
  t.input.emit("data", bytes.subarray(0, 4));
  t.input.emit("data", bytes.subarray(4));
  t.input.emit("data", Buffer.from("x\u007f\r"));
  assert.equal(await promise, "café");
  assert.equal(t.output.text.includes("café"), false);
  assert.equal(t.input.isRaw, false);
  assert.equal(t.input.isPaused(), true);
  assert.equal(t.input.listenerCount("data"), 0);
});
test("password prompt rejects piped input and restores raw mode/listeners on cancellation", async () => {
  await assert.rejects(promptPassword({ input: { isTTY: false }, output: { isTTY: false } }));
  const t = terminal();
  const promise = promptPassword(t);
  t.input.emit("data", Buffer.from("private-value\u0003"));
  await assert.rejects(promise);
  assert.equal(t.input.isRaw, false);
  assert.equal(t.input.listenerCount("data"), 0);
  assert.equal(t.output.text.includes("private-value"), false);
});
test("CLI rejects password arguments/piped input before any connection and never echoes arguments", () => {
  const result = spawnSync(process.execPath, ["scripts/run-dispatcher-authorization.mjs", password], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal((result.stdout + result.stderr).includes(password), false);
  assert.match(result.stderr, /OVERALL FAIL/);
});
