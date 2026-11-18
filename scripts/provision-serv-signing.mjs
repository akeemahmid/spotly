import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  SigningDatabaseError as ProvisioningError,
  safeSigningFailure,
  signingDatabaseConfig,
  classifyFailure,
  tlsReason,
} from "./serv-signing-db.mjs";

export { safeSigningFailure as safeProvisioningFailure } from "./serv-signing-db.mjs";

// Manual only. --check never sends the signing key or changes database records.
const INSERT_KEY = `insert into spotly_private.serv_plan_key (singleton, key_hex)
values (true, $1)
on conflict (singleton) do nothing
returning true as inserted`;
export async function provisionServSigning({
  env = process.env,
  readFile = readFileSync,
  Client = pg.Client,
  checkOnly = false,
} = {}) {
  let stage = "CONFIG";
  let client;
  let transactionOpen = false;
  try {
    const key = env.SERV_PLAN_SIGNING_KEY;
    // Exact ASCII hex, uppercase allowed. Never trim or strip a prefix/quotes silently.
    if (
      typeof key !== "string" ||
      key.length !== 64 ||
      !/^[0-9a-f]{64}$/i.test(key)
    )
      throw new ProvisioningError("KEY_FORMAT_INVALID", stage);
    client = new Client(
      signingDatabaseConfig({
        env, readFile, applicationName: "spotly-signing-provision",
      }),
    );
    client.on("error", () => {});
    stage = "CONNECT";
    await client.connect();
    stage = "BEGIN";
    await client.query(checkOnly ? "begin read only" : "begin");
    transactionOpen = true;
    stage = "EXISTING_KEY_CHECK";
    // Presence only: never read the existing key, even when logging protection fails.
    const existing = await client.query(
      "select exists(select 1 from spotly_private.serv_plan_key where singleton) as present",
    );
    if (typeof existing.rows[0]?.present !== "boolean")
      throw new ProvisioningError("RESULT_UNCONFIRMED", stage);
    if (existing.rows[0].present) {
      stage = "COMMIT";
      await client.query(checkOnly ? "rollback" : "commit");
      transactionOpen = false;
      return "EXISTING_KEY";
    }

    stage = "INSERT_PERMISSION_CHECK";
    const permission = await client.query(
      "select has_table_privilege(current_user, 'spotly_private.serv_plan_key', 'INSERT') as allowed",
    );
    if (typeof permission.rows[0]?.allowed !== "boolean")
      throw new ProvisioningError("RESULT_UNCONFIRMED", stage);
    if (!permission.rows[0].allowed)
      throw new ProvisioningError("SQL_PERMISSION_DENIED", stage);

    stage = "SESSION_LOGGING";
    const settings = [
      ["log_parameter_max_length", "0", false],
      ["log_parameter_max_length_on_error", "0", false],
      ["pgaudit.log_parameter", "off", true],
      ["auto_explain.log_parameter_max_length", "0", true],
    ];
    for (const [name, expected, optional] of settings) {
      const query = `select current_setting('${name}'${optional ? ", true" : ""}) as value`;
      let current = await client.query(query);
      if (optional && current.rows[0]?.value == null) continue;
      if (current.rows[0]?.value !== expected) {
        // Local transaction setting only; no ALTER ROLE/DATABASE or privilege grant.
        await client.query(`set local ${name} = ${expected}`);
        current = await client.query(query);
        if (current.rows[0]?.value !== expected)
          throw new ProvisioningError("SESSION_LOGGING_REJECTED", stage);
      }
    }
    if (checkOnly) {
      stage = "COMMIT";
      await client.query("rollback");
      transactionOpen = false;
      return "CHECK_OK";
    }
    stage = "INSERT";
    const result = await client.query(INSERT_KEY, [key]);
    if (result.rowCount !== 0 && result.rowCount !== 1)
      throw new ProvisioningError("RESULT_UNCONFIRMED", stage);
    stage = "COMMIT";
    await client.query("commit");
    transactionOpen = false;
    return result.rowCount === 1 ? "INSERTED" : "EXISTING_KEY";
  } catch (error) {
    const category =
      stage === "CONFIG" ? "CONFIG_INVALID" : classifyFailure(error, stage);
    throw error instanceof ProvisioningError
      ? error
      : new ProvisioningError(
          category,
          stage,
          category === "TLS_FAILURE" ? tlsReason(error) : undefined,
        );
  } finally {
    // Explicit rollback resets local settings before returning a pooled connection.
    if (client && transactionOpen)
      await client.query("rollback").catch(() => {});
    if (client) await client.end().catch(() => {});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--check") || args.length > 1)
      throw new ProvisioningError("CONFIG_INVALID", "CONFIG");
    console.log(
      await provisionServSigning({ checkOnly: args.includes("--check") }),
    );
  } catch (error) {
    console.error(safeSigningFailure(error));
    process.exitCode = 1;
  }
}
