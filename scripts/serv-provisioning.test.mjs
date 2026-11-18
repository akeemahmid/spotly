import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity, rootCertificates } from "node:tls";
import {
  provisionServSigning,
  safeProvisioningFailure,
} from "./provision-serv-signing.mjs";

// Offline only: synthetic values, synthetic metadata, and a mocked client.
const ref = "a".repeat(20);
const key = "b7".repeat(32);
const password = "synthetic:password@with/symbols";
function fixture({
  rowCount = 1,
  existing = false,
  insertAllowed = true,
  connectFailure,
  failureAt,
  failure,
  ignoreSettings = false,
  endpoint,
  caData,
  caReadFailure,
} = {}) {
  const calls = [];
  let config,
    ended = false,
    connections = 0;
  const settings = {
    log_parameter_max_length: "-1",
    log_parameter_max_length_on_error: "-1",
    "pgaudit.log_parameter": "on",
    "auto_explain.log_parameter_max_length": "-1",
  };
  class Client {
    constructor(value) {
      config = value;
    }
    on() {}
    async connect() {
      connections++;
      if (connectFailure) throw connectFailure;
    }
    async query(text, values) {
      calls.push({ text, values });
      if (failureAt && text.startsWith(failureAt)) throw failure;
      if (text.startsWith("select exists"))
        return { rows: [{ present: existing }] };
      if (text.startsWith("select has_table_privilege"))
        return { rows: [{ allowed: insertAllowed }] };
      if (text.includes("current_setting"))
        return {
          rows: [
            { value: settings[text.match(/current_setting\('([^']+)'/)[1]] },
          ],
        };
      if (text.startsWith("set local")) {
        const [, name, value] = text.match(/^set local ([\w.]+) = (\w+)$/);
        if (!ignoreSettings) settings[name] = value;
      }
      if (text.startsWith("insert")) return { rowCount };
      return { rows: [] };
    }
    async end() {
      ended = true;
    }
  }
  const env = {
    SERV_PLAN_SIGNING_KEY: key,
    SUPABASE_DB_PASSWORD: password,
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  };
  const readFile = (path) => {
    if (path === "synthetic-ca.crt") {
      if (caReadFailure) throw caReadFailure;
      return caData;
    }
    return String(path).endsWith("project-ref")
      ? ref
      : (endpoint ??
          `postgresql://postgres.${ref}@aws-1-test.pooler.supabase.com:5432/postgres?sslmode=disable`);
  };
  return {
    env,
    readFile,
    Client,
    calls,
    settings,
    get config() {
      return config;
    },
    get ended() {
      return ended;
    },
    get connections() {
      return connections;
    },
  };
}
async function expectCategory(f, category, stage, options = {}, reason) {
  await assert.rejects(provisionServSigning({ ...f, ...options }), (error) => {
    assert.equal(
      safeProvisioningFailure(error),
      `${category} stage=${stage}${reason ? ` reason=${reason}` : ""}`,
    );
    for (const secret of [key, password, "secret-bearing-raw-detail"]) {
      assert.equal(
        (JSON.stringify(error) + error.stack).includes(secret),
        false,
      );
    }
    assert.equal(error.cause, undefined);
    return true;
  });
}

test("parameterized provisioning verifies TLS/project and preserves the linked password without URI encoding", async () => {
  const f = fixture();
  assert.equal(await provisionServSigning(f), "INSERTED");
  const insert = f.calls.find((c) => c.text.startsWith("insert"));
  assert.deepEqual(insert.values, [key]);
  assert.equal(insert.text.includes(key), false);
  assert.match(insert.text, /values \(true, \$1\)/i);
  assert.match(insert.text, /on conflict \(singleton\) do nothing/i);
  assert.equal(f.config.ssl.rejectUnauthorized, true);
  assert.equal(f.config.ssl.servername, f.config.host);
  assert.equal(f.config.ssl.checkServerIdentity, checkServerIdentity);
  assert.equal(f.config.ssl.ca, undefined);
  assert.equal(f.config.connectionString, undefined);
  assert.equal(f.config.sslnegotiation, "postgres");
  assert.equal(f.config.user, `postgres.${ref}`);
  assert.equal(f.config.password, password);
  assert.equal(f.config.port, 5432);
  assert.equal(f.calls.at(-1).text, "commit");
  assert.equal(f.ended, true);
  assert.equal(f.calls.filter((c) => c.values?.length).length, 1);
});
test("existing-key detection reports EXISTING_KEY without binding a key or requiring logging changes", async () => {
  const f = fixture({
    existing: true,
    failureAt: "set local",
    failure: new Error("must never set"),
  });
  assert.equal(await provisionServSigning(f), "EXISTING_KEY");
  assert.equal(
    f.calls.some(
      (c) =>
        c.text.startsWith("insert") ||
        c.text.startsWith("set local") ||
        c.values?.length,
    ),
    false,
  );
  assert.equal(
    f.calls.some((c) => /select key_hex|\bupdate\b/i.test(c.text)),
    false,
  );
  assert.equal(f.ended, true);
});
test("concurrent insertion still uses DO NOTHING and reports EXISTING_KEY", async () => {
  const f = fixture({ rowCount: 0 });
  assert.equal(await provisionServSigning(f), "EXISTING_KEY");
  assert.equal(f.calls.filter((c) => c.text.startsWith("insert")).length, 1);
});
test("--check begins read-only, verifies logging protections, rolls back and never transmits the signing key", async () => {
  const f = fixture();
  assert.equal(
    await provisionServSigning({ ...f, checkOnly: true }),
    "CHECK_OK",
  );
  assert.equal(f.calls[0].text, "begin read only");
  assert.equal(f.calls.at(-1).text, "rollback");
  assert.equal(
    f.calls.some(
      (c) =>
        c.text.startsWith("insert") || c.text === "commit" || c.values?.length,
    ),
    false,
  );
  assert.equal(f.ended, true);
});
test("--check detects an existing key without reading its value", async () => {
  const f = fixture({ existing: true });
  assert.equal(
    await provisionServSigning({ ...f, checkOnly: true }),
    "EXISTING_KEY",
  );
  assert.equal(f.calls.at(-1).text, "rollback");
  assert.equal(
    f.calls.some((c) => c.values?.length),
    false,
  );
});
test("exact uppercase and lowercase hex keys are valid; whitespace, prefixes and literal quotes are invalid", async () => {
  for (const value of [key, key.toUpperCase()]) {
    const f = fixture();
    f.env.SERV_PLAN_SIGNING_KEY = value;
    assert.equal(
      await provisionServSigning({ ...f, checkOnly: true }),
      "CHECK_OK",
    );
  }
  for (const value of [
    undefined,
    "",
    "ab".repeat(31),
    "ab".repeat(33),
    "x".repeat(64),
    " " + key,
    key + "\n",
    "0x" + key,
    '"' + key + '"',
  ]) {
    const f = fixture();
    f.env.SERV_PLAN_SIGNING_KEY = value;
    await expectCategory(f, "KEY_FORMAT_INVALID", "CONFIG");
    assert.equal(f.connections, 0);
  }
});
test("missing passwords and invalid linked session-pooler metadata fail before connecting", async () => {
  const f = fixture();
  delete f.env.SUPABASE_DB_PASSWORD;
  await expectCategory(f, "DB_PASSWORD_MISSING", "CONFIG");
  assert.equal(f.connections, 0);
  for (const endpoint of [
    `postgresql://postgres.${ref}@aws-1-test.pooler.supabase.com:6543/postgres`,
    `postgresql://cli_login_postgres.${ref}@aws-1-test.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${ref}@attacker.invalid:5432/postgres`,
  ]) {
    const bad = fixture({ endpoint });
    await expectCategory(bad, "LINK_METADATA_INVALID", "CONFIG");
    assert.equal(bad.connections, 0);
  }
  const wrong = fixture();
  wrong.env.NEXT_PUBLIC_SUPABASE_URL = "https://other.supabase.co";
  await expectCategory(wrong, "LINK_METADATA_INVALID", "CONFIG");
  assert.equal(wrong.connections, 0);
});
test("authentication, TLS, DNS and timeout failures are safely separated and close the connection", async () => {
  const cases = [
    [
      Object.assign(new Error(`secret-bearing-raw-detail ${password}`), {
        code: "28P01",
      }),
      "AUTH_FAILURE",
    ],
    [
      new Error(
        "SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing",
      ),
      "AUTH_FAILURE",
    ],
    [
      Object.assign(new Error(`secret-bearing-raw-detail ${password}`), {
        code: "SELF_SIGNED_CERT_IN_CHAIN",
      }),
      "TLS_FAILURE",
      "CA_UNTRUSTED",
    ],
    [
      new Error("The server does not support SSL connections"),
      "TLS_FAILURE",
      "HANDSHAKE_FAILED",
    ],
    [
      Object.assign(new Error("secret-bearing-raw-detail"), {
        code: "ENOTFOUND",
      }),
      "NETWORK_FAILURE",
    ],
    [
      Object.assign(new Error("secret-bearing-raw-detail"), {
        code: "ETIMEDOUT",
      }),
      "NETWORK_TIMEOUT",
    ],
    [new Error("timeout expired"), "NETWORK_TIMEOUT"],
    [new Error("secret-bearing-raw-detail"), "CONNECTION_FAILURE"],
    [
      new AggregateError([
        Object.assign(new Error("secret-bearing-raw-detail"), {
          code: "ETIMEDOUT",
        }),
      ]),
      "NETWORK_TIMEOUT",
    ],
  ];
  for (const [connectFailure, category, reason] of cases) {
    const f = fixture({ connectFailure });
    await expectCategory(f, category, "CONNECT", {}, reason);
    assert.equal(f.calls.length, 0);
    assert.equal(f.ended, true);
  }
});

test("configured PEM, DER and bundled CA certificates retain chain and hostname verification", async () => {
  const certificate = new X509Certificate(rootCertificates[0]);
  for (const caData of [
    certificate.toString(),
    certificate.raw,
    certificate.toString() + certificate.toString(),
  ]) {
    const f = fixture({ caData });
    f.env.SUPABASE_DB_CA_FILE = "synthetic-ca.crt";
    assert.equal(
      await provisionServSigning({ ...f, checkOnly: true }),
      "CHECK_OK",
    );
    assert.deepEqual(
      f.config.ssl.ca,
      Array(
        typeof caData === "string" &&
          caData.includes(certificate.toString() + certificate.toString())
          ? 2
          : 1,
      ).fill(certificate.toString()),
    );
    assert.equal(f.config.ssl.rejectUnauthorized, true);
    assert.equal(f.config.ssl.servername, f.config.host);
    assert.equal(f.config.ssl.checkServerIdentity, checkServerIdentity);
    assert.equal(
      f.config.ssl.checkServerIdentity(f.config.host, {
        subjectaltname: "DNS:unrelated.invalid",
      }).code,
      "ERR_TLS_CERT_ALTNAME_INVALID",
    );
    assert.equal(
      f.calls.some(
        (call) => call.values?.length || call.text.startsWith("insert"),
      ),
      false,
    );
  }
});
test("missing, malformed and contaminated CA files fail locally without raw errors or connection attempts", async () => {
  for (const options of [
    { caReadFailure: new Error(`secret-bearing-raw-detail ${password}`) },
    { caData: "not a certificate" },
    {
      caData:
        rootCertificates[0] +
        "\n-----BEGIN PRIVATE KEY-----\nsecret-bearing-raw-detail",
    },
  ]) {
    const f = fixture(options);
    f.env.SUPABASE_DB_CA_FILE = "synthetic-ca.crt";
    await expectCategory(f, "TLS_CA_FILE_INVALID", "CONFIG", {
      checkOnly: true,
    });
    assert.equal(f.connections, 0);
    assert.equal(f.config, undefined);
  }
});
test("TLS reasons distinguish incompatible CA, hostname and certificate dates without falling back", async () => {
  for (const [code, reason] of [
    ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CA_UNTRUSTED"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "HOSTNAME_MISMATCH"],
    ["CERT_HAS_EXPIRED", "CERT_EXPIRED"],
    ["CERT_NOT_YET_VALID", "CERT_NOT_YET_VALID"],
    ["ERR_SSL_WRONG_VERSION_NUMBER", "HANDSHAKE_FAILED"],
  ]) {
    const f = fixture({
      caData: rootCertificates[0],
      connectFailure: Object.assign(
        new Error(`secret-bearing-raw-detail ${password} ${key}`),
        { code },
      ),
    });
    f.env.SUPABASE_DB_CA_FILE = "synthetic-ca.crt";
    await expectCategory(
      f,
      "TLS_FAILURE",
      "CONNECT",
      { checkOnly: true },
      reason,
    );
    assert.equal(f.connections, 1);
    assert.equal(f.ended, true);
    assert.equal(f.calls.length, 0);
    assert.equal(f.config.ssl.rejectUnauthorized, true);
  }
});
test("session logging rejection is identified without inserting or transmitting the key", async () => {
  for (const checkOnly of [true, false]) {
    const failure = Object.assign(
      new Error(`secret-bearing-raw-detail ${key}`),
      { code: "42501" },
    );
    const f = fixture({ failureAt: "set local", failure });
    await expectCategory(f, "SESSION_LOGGING_REJECTED", "SESSION_LOGGING", {
      checkOnly,
    });
    assert.equal(
      f.calls.some(
        (c) =>
          c.values?.length ||
          c.text.startsWith("insert") ||
          c.text === "commit",
      ),
      false,
    );
    assert.equal(f.ended, true);
    assert.equal(f.calls.at(-1).text, "rollback");
  }
});
test("logging settings are read back; silently unapplied protection still fails closed", async () => {
  const f = fixture({ ignoreSettings: true });
  await expectCategory(f, "SESSION_LOGGING_REJECTED", "SESSION_LOGGING");
  assert.equal(
    f.calls.some((c) => c.values?.length),
    false,
  );
});
test("already-safe settings require no permission to SET protected parameters", async () => {
  const f = fixture({
    failureAt: "set local",
    failure: new Error("must never set"),
  });
  Object.assign(f.settings, {
    log_parameter_max_length: "0",
    log_parameter_max_length_on_error: "0",
    "pgaudit.log_parameter": "off",
    "auto_explain.log_parameter_max_length": "0",
  });
  assert.equal(
    await provisionServSigning({ ...f, checkOnly: true }),
    "CHECK_OK",
  );
});
test("SQL permission and missing-schema errors identify the exact safe stage without leaking driver details", async () => {
  for (const [failureAt, code, category, stage] of [
    ["select exists", "42501", "SQL_PERMISSION_DENIED", "EXISTING_KEY_CHECK"],
    ["select exists", "42P01", "SCHEMA_NOT_READY", "EXISTING_KEY_CHECK"],
    ["insert", "42501", "SQL_PERMISSION_DENIED", "INSERT"],
    ["insert", "23514", "SQL_FAILURE", "INSERT"],
    ["commit", "ECONNRESET", "NETWORK_FAILURE", "COMMIT"],
  ]) {
    const f = fixture({
      failureAt,
      failure: Object.assign(
        new Error(`secret-bearing-raw-detail ${key} ${password}`),
        { code },
      ),
    });
    await expectCategory(f, category, stage);
    assert.equal(f.ended, true);
  }
});
test("unexpected raw errors are never formatted into terminal output", () => {
  assert.equal(
    safeProvisioningFailure(new Error(`${key} ${password}`)),
    "RESULT_UNCONFIRMED stage=CONFIG",
  );
});

test("--check diagnoses missing INSERT privilege without attempting a write or binding the key", async () => {
  const f = fixture({ insertAllowed: false });
  await expectCategory(f, "SQL_PERMISSION_DENIED", "INSERT_PERMISSION_CHECK", {
    checkOnly: true,
  });
  assert.equal(
    f.calls.some((c) => c.text.startsWith("insert") || c.values?.length),
    false,
  );
  assert.equal(f.calls.at(-1).text, "rollback");
  assert.equal(f.ended, true);
});
test("unexpected insertion result never falsely reports an existing key and is rolled back", async () => {
  const f = fixture({ rowCount: null });
  await expectCategory(f, "RESULT_UNCONFIRMED", "INSERT");
  assert.equal(
    f.calls.some((c) => c.text === "commit"),
    false,
  );
  assert.equal(f.calls.at(-1).text, "rollback");
});
