import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, X509Certificate } from "node:crypto";
import { checkServerIdentity, rootCertificates } from "node:tls";
import { spawnSync } from "node:child_process";
import {
  checkServSigning, safeSigningFailure,
  PGCRYPTO_CHECK_SQL, RPC_CHECK_SQL, PRIVATE_TABLE_CHECK_SQL,
} from "./check-serv-signing.mjs";
import { provisionServSigning } from "./provision-serv-signing.mjs";

// Offline fixtures only. Never load .env.local or connect to a real project.
const key = "a9".repeat(32);
const password = "synthetic-database-password";
const ref = "c".repeat(20);
const challenge = "spotly.phase3a.signing-configuration-check.v1";
const hmac = createHmac("sha256", Buffer.from(key, "hex")).update(challenge).digest("hex");
function fixture({ readyAt, keyCount = 1, matches = true, badResult, failureAt, failure, connectFailure } = {}) {
  const calls = [];
  let config, ended = false, connections = 0;
  class Client {
    constructor(value) { config = value; }
    on() {}
    async connect() { connections++; if (connectFailure) throw connectFailure; }
    async query(text, values) {
      calls.push({ text, values });
      if (failureAt && text.startsWith(failureAt)) throw failure;
      if (text.startsWith("select exists(select 1 from spotly_private.serv_plan_key"))
        return { rows: [{ present: true }] }; // provisioning --check fixture
      if ([PGCRYPTO_CHECK_SQL, RPC_CHECK_SQL, PRIVATE_TABLE_CHECK_SQL].includes(text))
        return { rows: badResult ? [] : [{ ready: text !== readyAt }] };
      if (text.startsWith("select count(*)")) {
        assert.deepEqual(values, [hmac]);
        return { rows: [{ key_count: keyCount, matches }] };
      }
      return { rows: [] };
    }
    async end() { ended = true; }
  }
  const env = {
    SERV_PLAN_SIGNING_KEY: key, SUPABASE_DB_PASSWORD: password,
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    SUPABASE_DB_CA_FILE: "test-ca.pem",
    PGHOST: "untrusted.invalid", PGUSER: "untrusted", PGSSLMODE: "disable",
    PGSSLNEGOTIATION: "direct",
  };
  const readFile = (path) => path === "test-ca.pem" ? rootCertificates[0]
    : String(path).endsWith("project-ref") ? ref
      : `postgresql://postgres.${ref}@aws-1-test.pooler.supabase.com:5432/postgres?sslmode=disable`;
  return { env, readFile, Client, calls,
    get config() { return config; }, get ended() { return ended; }, get connections() { return connections; },
  };
}
async function expectFailure(f, expected) {
  await assert.rejects(checkServSigning(f), error => {
    assert.equal(safeSigningFailure(error), expected);
    const serialized = JSON.stringify(error) + error.stack;
    for (const secret of [key, password, hmac, "raw-private-detail"]) assert.equal(serialized.includes(secret), false);
    assert.equal(error.cause, undefined);
    return true;
  });
}

test("diagnostic uses exactly provisioning's Session pooler login, CA and strict TLS settings", async () => {
  const diagnostic = fixture(), provisioning = fixture();
  assert.match(await checkServSigning(diagnostic), /^Signing check passed:/);
  assert.equal(await provisionServSigning({ ...provisioning, checkOnly: true }), "EXISTING_KEY");
  const { application_name: checkName, ...checkConfig } = diagnostic.config;
  const { application_name: provisionName, ...provisionConfig } = provisioning.config;
  assert.equal(checkName, "spotly-signing-check");
  assert.equal(provisionName, "spotly-signing-provision");
  assert.deepEqual(checkConfig, provisionConfig);
  assert.equal(checkConfig.ssl.rejectUnauthorized, true);
  assert.equal(checkConfig.ssl.checkServerIdentity, checkServerIdentity);
  assert.equal(checkConfig.ssl.servername, checkConfig.host);
  assert.deepEqual(checkConfig.ssl.ca, [new X509Certificate(rootCertificates[0]).toString()]);
  assert.equal(checkConfig.port, 5432);
  assert.equal(checkConfig.database, "postgres");
  assert.equal(checkConfig.user, `postgres.${ref}`);
  assert.equal(checkConfig.password, password);
  assert.equal(checkConfig.sslnegotiation, "postgres");
  assert.equal(checkConfig.connectionString, undefined);
});

test("read-only check transmits no signing key, returns no verification material, rolls back and disconnects", async () => {
  const f = fixture();
  const output = await checkServSigning(f);
  assert.equal(f.calls[0].text, "begin read only");
  assert.equal(f.calls.at(-1).text, "rollback");
  assert.equal(f.calls.filter(c => c.values?.length).length, 1);
  for (const call of f.calls) {
    assert.match(call.text, /^(select|begin read only|rollback)/);
    // Privilege names inside SQL literals are catalog inputs, not mutations.
    const withoutLiterals = call.text.replace(/'(?:''|[^'])*'/g, "''");
    assert.doesNotMatch(withoutLiterals, /\b(insert|update|delete|grant|revoke|create|alter|commit|set local)\b/i);
    assert.equal(JSON.stringify(call).includes(key), false);
    assert.equal(JSON.stringify(call).includes(password), false);
  }
  for (const secret of [key, password, hmac]) assert.equal(output.includes(secret), false);
  assert.equal(f.ended, true);
});

test("exact uppercase keys match; malformed keys and missing passwords fail before connecting", async () => {
  const uppercase = fixture(); uppercase.env.SERV_PLAN_SIGNING_KEY = key.toUpperCase();
  assert.match(await checkServSigning(uppercase), /^Signing check passed:/);
  for (const value of [undefined, "", key + "\n", " " + key, "0x" + key, '"' + key + '"', "z".repeat(64)]) {
    const f = fixture(); f.env.SERV_PLAN_SIGNING_KEY = value;
    await expectFailure(f, "KEY_FORMAT_INVALID stage=CONFIG");
    assert.equal(f.connections, 0);
  }
  const f = fixture(); delete f.env.SUPABASE_DB_PASSWORD;
  await expectFailure(f, "DB_PASSWORD_MISSING stage=CONFIG");
  assert.equal(f.connections, 0);
});

test("invalid project or CA fails locally with no fallback", async () => {
  const wrong = fixture(); wrong.env.NEXT_PUBLIC_SUPABASE_URL = "https://wrong.supabase.co";
  await expectFailure(wrong, "LINK_METADATA_INVALID stage=CONFIG");
  assert.equal(wrong.connections, 0);
  const invalidCA = fixture(); invalidCA.env.SUPABASE_DB_CA_FILE = "missing.pem";
  await expectFailure(invalidCA, "TLS_CA_FILE_INVALID stage=CONFIG");
  assert.equal(invalidCA.connections, 0);
});

test("catalog failures identify pgcrypto, signed RPC or private-table stage and stop before key comparison", async () => {
  for (const [readyAt, expected] of [
    [PGCRYPTO_CHECK_SQL, "PGCRYPTO_NOT_READY stage=PGCRYPTO_CHECK"],
    [RPC_CHECK_SQL, "RPC_NOT_READY stage=RPC_CHECK"],
    [PRIVATE_TABLE_CHECK_SQL, "PRIVATE_TABLE_NOT_READY stage=PRIVATE_TABLE_CHECK"],
  ]) {
    const f = fixture({ readyAt });
    await expectFailure(f, expected);
    assert.equal(f.calls.some(c => c.values?.length), false);
    assert.equal(f.calls.at(-1).text, "rollback");
    assert.equal(f.ended, true);
  }
});

test("missing key, mismatch and malformed database results are separate safe failures", async () => {
  for (const [options, expected] of [
    [{ keyCount: 0, matches: false }, "KEY_MISSING stage=KEY_COMPARE"],
    [{ matches: false }, "KEY_MISMATCH stage=KEY_COMPARE"],
    [{ keyCount: 2 }, "RESULT_UNCONFIRMED stage=KEY_COMPARE"],
    [{ matches: "true" }, "RESULT_UNCONFIRMED stage=KEY_COMPARE"],
    [{ badResult: true }, "RESULT_UNCONFIRMED stage=PGCRYPTO_CHECK"],
  ]) {
    const f = fixture(options);
    await expectFailure(f, expected);
    assert.equal(f.calls.at(-1).text, "rollback");
    assert.equal(f.ended, true);
  }
});

test("connect failures separate TLS, login, DNS and timeout without exposing raw driver errors", async () => {
  for (const [code, expected] of [
    ["SELF_SIGNED_CERT_IN_CHAIN", "TLS_FAILURE stage=CONNECT reason=CA_UNTRUSTED"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "TLS_FAILURE stage=CONNECT reason=HOSTNAME_MISMATCH"],
    ["CERT_HAS_EXPIRED", "TLS_FAILURE stage=CONNECT reason=CERT_EXPIRED"],
    ["28P01", "AUTH_FAILURE stage=CONNECT"],
    ["ENOTFOUND", "NETWORK_FAILURE stage=CONNECT"],
    ["ETIMEDOUT", "NETWORK_TIMEOUT stage=CONNECT"],
    ["unknown", "CONNECTION_FAILURE stage=CONNECT"],
  ]) {
    const f = fixture({ connectFailure: Object.assign(new Error(`raw-private-detail ${key} ${password}`), { code }) });
    await expectFailure(f, expected);
    assert.equal(f.calls.length, 0);
    assert.equal(f.connections, 1);
    assert.equal(f.ended, true);
  }
});

test("SQL failures keep the correct stage, roll back and do not leak server details or values", async () => {
  for (const [failureAt, code, expected] of [
    ["begin", "42501", "SQL_PERMISSION_DENIED stage=BEGIN"],
    [RPC_CHECK_SQL, "42501", "SQL_PERMISSION_DENIED stage=RPC_CHECK"],
    ["select count(*)", "42501", "SQL_PERMISSION_DENIED stage=KEY_COMPARE"],
    ["select count(*)", "42P01", "SCHEMA_NOT_READY stage=KEY_COMPARE"],
    ["select count(*)", "42883", "SQL_FAILURE stage=KEY_COMPARE"],
    ["rollback", "ECONNRESET", "NETWORK_FAILURE stage=ROLLBACK"],
  ]) {
    const f = fixture({ failureAt, failure: Object.assign(new Error(`raw-private-detail ${key} ${password} ${hmac}`), { code }) });
    await expectFailure(f, expected);
    assert.equal(f.ended, true);
    if (failureAt !== "begin") assert.equal(f.calls.at(-1).text, "rollback");
  }
});

test("CLI fails safely before database access and rejects arguments without printing them", () => {
  const env = { ...process.env, SERV_PLAN_SIGNING_KEY: "invalid-raw-private-detail" };
  const result = spawnSync(process.execPath, ["scripts/check-serv-signing.mjs"], { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Signing check failed: KEY_FORMAT_INVALID stage=CONFIG. No provider call made.\n");
  const args = spawnSync(process.execPath, ["scripts/check-serv-signing.mjs", password], { env, encoding: "utf8" });
  assert.equal(args.status, 1);
  assert.equal(args.stdout, "");
  assert.equal(args.stderr, "Signing check failed: CONFIG_INVALID stage=CONFIG. No provider call made.\n");
  assert.equal(safeSigningFailure(new Error(key)), "RESULT_UNCONFIRMED stage=CONFIG");
});
