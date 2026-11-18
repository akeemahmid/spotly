import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  SigningDatabaseError,
  safeSigningFailure,
  signingDatabaseConfig,
  classifyFailure,
  tlsReason,
} from "./serv-signing-db.mjs";

export { safeSigningFailure } from "./serv-signing-db.mjs";

// These catalog queries return booleans only. No function bodies or key material.
export const PGCRYPTO_CHECK_SQL = `select
  exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    where e.extname='pgcrypto' and n.nspname='extensions')
  and to_regprocedure('extensions.hmac(bytea,bytea,text)') is not null
  and to_regprocedure('extensions.digest(bytea,text)') is not null
  and to_regprocedure('extensions.gen_random_bytes(integer)') is not null as ready`;

export const RPC_CHECK_SQL = `select
  (select count(*)=2 and bool_and(p.prosecdef
    and p.proconfig @> array['search_path=""']::text[]
    and has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE'))
   from pg_proc p where
    (p.oid=to_regprocedure('public.save_verified_serv_plan(text,text)') and p.prorettype='uuid'::regtype)
    or (p.oid=to_regprocedure('public.accept_verified_serv_plan(text,uuid)') and p.prorettype='void'::regtype))
  and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('save_verification_plan','accept_verification_plan')) as ready`;

export const PRIVATE_TABLE_CHECK_SQL = `select exists(
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='spotly_private' and c.relname='serv_plan_key' and c.relkind='r'
    and c.relrowsecurity
    and not exists(select 1 from pg_policy where polrelid=c.oid)
    and not exists(select 1 from (values ('anon'),('authenticated')) r(name)
      where has_schema_privilege(r.name,n.oid,'USAGE,CREATE')
        or has_table_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    and not exists(select 1 from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where a.grantee=0)
    and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee=0)
) as ready`;

const CHALLENGE = "spotly.phase3a.signing-configuration-check.v1";
const KEY_COMPARE_SQL = `select count(*)::integer as key_count,
  coalesce(bool_and(extensions.hmac(convert_to('${CHALLENGE}','UTF8'),decode(key_hex,'hex'),'sha256')
    = decode($1,'hex')),false) as matches
  from spotly_private.serv_plan_key where singleton`;

export async function checkServSigning({
  env = process.env,
  readFile = readFileSync,
  Client = pg.Client,
} = {}) {
  let stage = "CONFIG";
  let client;
  let transactionOpen = false;
  try {
    const key = env.SERV_PLAN_SIGNING_KEY;
    if (typeof key !== "string" || key.length !== 64 || !/^[0-9a-f]{64}$/i.test(key))
      throw new SigningDatabaseError("KEY_FORMAT_INVALID", stage);
    client = new Client(signingDatabaseConfig({ env, readFile }));
    // Never print driver events/errors, which can contain connection information.
    client.on("error", () => {});
    stage = "CONNECT";
    await client.connect();
    stage = "BEGIN";
    await client.query("begin read only");
    transactionOpen = true;

    for (const [nextStage, sql, category] of [
      ["PGCRYPTO_CHECK", PGCRYPTO_CHECK_SQL, "PGCRYPTO_NOT_READY"],
      ["RPC_CHECK", RPC_CHECK_SQL, "RPC_NOT_READY"],
      ["PRIVATE_TABLE_CHECK", PRIVATE_TABLE_CHECK_SQL, "PRIVATE_TABLE_NOT_READY"],
    ]) {
      stage = nextStage;
      const result = await client.query(sql);
      if (result.rows.length !== 1 || typeof result.rows[0]?.ready !== "boolean")
        throw new SigningDatabaseError("RESULT_UNCONFIRMED", stage);
      if (!result.rows[0].ready) throw new SigningDatabaseError(category, stage);
    }

    stage = "KEY_COMPARE";
    // Only a fixed-purpose diagnostic HMAC is bound, never the local signing key.
    // The database compares internally and returns only a count and a boolean.
    // This challenge cannot authorize a plan or evidence receipt.
    const expected = createHmac("sha256", Buffer.from(key, "hex"))
      .update(CHALLENGE, "utf8").digest("hex");
    const result = await client.query(KEY_COMPARE_SQL, [expected]);
    const row = result.rows[0];
    if (result.rows.length !== 1 || ![0, 1].includes(row?.key_count) || typeof row?.matches !== "boolean")
      throw new SigningDatabaseError("RESULT_UNCONFIRMED", stage);
    if (row.key_count === 0) throw new SigningDatabaseError("KEY_MISSING", stage);
    if (!row.matches) throw new SigningDatabaseError("KEY_MISMATCH", stage);

    stage = "ROLLBACK";
    await client.query("rollback");
    transactionOpen = false;
    return "Signing check passed: local key matches the database key; pgcrypto, signed RPCs and private-table protections passed inspection. No secrets disclosed, database writes or provider calls.";
  } catch (error) {
    const category = stage === "CONFIG" ? "CONFIG_INVALID" : classifyFailure(error, stage);
    throw error instanceof SigningDatabaseError ? error : new SigningDatabaseError(
      category, stage, category === "TLS_FAILURE" ? tlsReason(error) : undefined,
    );
  } finally {
    if (client && transactionOpen) await client.query("rollback").catch(() => {});
    if (client) await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new SigningDatabaseError("CONFIG_INVALID", "CONFIG");
    console.log(await checkServSigning());
  } catch (error) {
    console.error(`Signing check failed: ${safeSigningFailure(error)}. No provider call made.`);
    process.exitCode = 1;
  }
}
