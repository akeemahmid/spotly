# Local SERV provisioning and safe connection diagnostics

> November 18 release status supersedes historical checkpoints and deployment/activation commands below. See [current status](product-release-status.md). Production writes and gate activation are not authorized.

## Current status · November 12, 2026

The owner now confirms both `INSERTED` and a **passed owner-login signing diagnostic**: signing setup is complete. **Do not regenerate, reinsert or overwrite the existing key.** Later investigation results below describe earlier checkpoints. Continue with the [Phase 3B migration preflight](phase3b-migration-preflight.md). Use the read-only matching check in section D below. Earlier TLS investigation and initial provisioning instructions are retained below for context.

The old matching check launched `supabase db query --remote` in a child process. It did not configure the provisioning script's `pg` connection or read `SUPABASE_DB_CA_FILE`. CLI target selection, authentication, transport/TLS and result parsing were therefore separate failure points, all hidden by one catch message. That message does not establish a missing key, a pgcrypto failure, or a permissions failure. For the linked `db query --remote --read-only` command, the CLI uses the Management API's read-only mode, authenticated with CLI account credentials. The read-only API uses `supabase_read_only_user`, rather than the provisioning script's `postgres` login. The pooler database password and `SUPABASE_DB_CA_FILE` do not configure that HTTPS API path. See [CLI query behavior](https://supabase.com/docs/reference/cli/supabase-feedback#supabase-db-query) and [read-only API role](https://supabase.com/docs/reference/api/v1-read-only-query). Other database CLI commands can use temporary roles; that is not the connection path of this old diagnostic.

A safe equivalent of the old protected HMAC query (returning only a boolean, never the HMAC) **timed out** in the CLI subprocess with `ETIMEDOUT`, even with a 45-second limit. The original diagnostic used a 30-second subprocess limit and converted that error into its generic message. This reproduces a concrete CLI-path failure compatible with the reported result; it cannot prove the exact exception from the earlier run. No SQL permission denial or missing-function error was established by this timeout. Successful provisioning does not validate the separate Management API path.

Both local scripts now share `scripts/serv-signing-db.mjs`: linked Session pooler on port 5432, project-qualified `postgres` login, privately supplied database password, and the same CA parser, verified chain, SNI and hostname check. Explicit fields ignore URI/PG environment TLS overrides. Only their application names differ. No database permission or migration change is needed to make their connection configurations match.

## Earlier provisioning investigation (historical)

The provisioning script uses the existing CLI link's **session pooler** on port 5432, the project-qualified `postgres` username, and **your project database password**. It does not reuse the CLI's access token or temporary login-role credentials. CLI connection success therefore does not prove this connection's password or TLS trust works. See [Supabase CLI credential resolution](https://supabase.com/docs/guides/local-development/local-and-hosted-projects) and [connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

Local inspection confirmed that all four cached connection fields match the Dashboard: host `aws-1-eu-west-3.pooler.supabase.com`, port `5432`, database `postgres`, username `postgres.onfdusisfidlfdmluwxl`. A local-only check found a valid signing-key format and matching configured project without printing secrets.

For the reported `TLS_FAILURE stage=CONNECT`, neither `SUPABASE_DB_CA_FILE` nor `NODE_EXTRA_CA_CERTS` was configured in the locally loaded environment. Downloading a certificate alone does not configure Node's trust. The downloaded `~/Downloads/prod-ca-2021.crt` parses as a currently valid CA certificate. At that earlier checkpoint, compatibility with the pooler's presented chain was unverified and the agent had not run a remote diagnostic. The November 12 TLS probe below supersedes that uncertainty.

## A. Store the downloaded certificate outside Git

Run in Terminal:

```zsh
mkdir -p "$HOME/.config/spotly"
cp "$HOME/Downloads/prod-ca-2021.crt" "$HOME/.config/spotly/supabase-ca.pem"
chmod 600 "$HOME/.config/spotly/supabase-ca.pem"
```

This stores the certificate at `/Users/macbookpro/.config/spotly/supabase-ca.pem`, outside the repository. Do not put it in source files or commit it. The script accepts PEM certificates/bundles or a single DER certificate, normalizes them in memory and rejects unreadable, malformed or non-CA files without printing their contents. Renaming the file is safe for either supported format.

## B. Run only the non-writing check

From the Spotly project root, use this in your **zsh terminal**:

```zsh
(
  export SUPABASE_DB_CA_FILE="$HOME/.config/spotly/supabase-ca.pem"
  read -rs 'SUPABASE_DB_PASSWORD?Supabase database password: ' || exit 1
  printf '\n'
  export SUPABASE_DB_PASSWORD
  env -u SERV_PLAN_SIGNING_KEY -u NEXT_PUBLIC_SUPABASE_URL \
    node --env-file=.env.local scripts/provision-serv-signing.mjs --check
)
```

Enter the project's PostgreSQL password, not your Supabase account password, publishable key or SERV key. Input is hidden and never becomes a shell command. The subshell scopes the password to this invocation. The `env -u` arguments let Node load the signing key and public project URL from `.env.local`, rather than accidentally using stale shell exports. No secret value appears in arguments or history.

`--check` validates the key locally, verifies the target and certificate, connects with the script's actual credentials, starts a **read-only transaction**, checks only whether a key row exists, inspects INSERT privilege without writing, and tests transaction-local logging protections. It never runs an insert or sends the signing key. It rolls back and disconnects. Migration `202611110001` is not required for this procedure and must not be deployed to fix provisioning.

Stop after this check for the current TLS investigation. Do not run the insertion command below.

## C. Interpret the result

Report only the resulting category/stage/reason, never credentials, raw errors, connection strings or `.env.local` contents:

| Output                                                                 | Meaning / next step                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHECK_OK`                                                             | Connection, access and logging preflight passed. No key was sent or inserted.                                                                                                                                                                                                                                                                                                    |
| `EXISTING_KEY`                                                         | A key row already exists. It was not read, compared or changed. Use the existing matching diagnostic.                                                                                                                                                                                                                                                                            |
| `KEY_FORMAT_INVALID stage=CONFIG`                                      | Runtime key must be exactly 64 ASCII hexadecimal characters. Uppercase is accepted; spaces, newlines, a `0x` prefix and literal quotes are not. Normal `.env.local` quote delimiters are handled by Node.                                                                                                                                                                        |
| `DB_PASSWORD_MISSING stage=CONFIG`                                     | Use the hidden password prompt above.                                                                                                                                                                                                                                                                                                                                            |
| `LINK_METADATA_INVALID stage=CONFIG`                                   | Link metadata/public URL do not match, or the endpoint is not the expected session pooler. Reconcile the intended project, not the signing key.                                                                                                                                                                                                                                  |
| `TLS_CA_FILE_INVALID stage=CONFIG`                                     | The configured file could not be read or parsed as CA certificates. Check the copy destination and use the original Dashboard download. No connection was attempted.                                                                                                                                                                                                             |
| `TLS_FAILURE stage=CONNECT reason=CA_UNTRUSTED`                        | The supplied CA cannot validate the chain presented by this endpoint. The database CA may be incompatible with the pooler, the chain may be incomplete, or a local TLS interceptor may use another issuer. Confirm the correct CA for this exact session-pooler endpoint with Supabase before proceeding. Do not disable verification or silently switch trust stores/endpoints. |
| `TLS_FAILURE stage=CONNECT reason=HOSTNAME_MISMATCH`                   | The server certificate does not cover the configured pooler hostname. Stop and resolve the endpoint/certificate mismatch.                                                                                                                                                                                                                                                        |
| `TLS_FAILURE stage=CONNECT reason=CERT_EXPIRED` / `CERT_NOT_YET_VALID` | Check the Mac's clock and obtain a current certificate/chain from Supabase if needed.                                                                                                                                                                                                                                                                                            |
| `TLS_FAILURE stage=CONNECT reason=HANDSHAKE_FAILED`                    | Another TLS negotiation or certificate error occurred; this safe reason does not establish the cause. Further TLS-only investigation is needed.                                                                                                                                                                                                                                  |
| `AUTH_FAILURE stage=CONNECT`                                           | The script's password-based database login failed. CLI temporary-role access does not validate this password.                                                                                                                                                                                                                                                                    |
| `NETWORK_TIMEOUT` / `NETWORK_FAILURE`                                  | Inspect the local network, DNS, firewall and endpoint reachability. No automatic retry or alternate insecure transport is used.                                                                                                                                                                                                                                                  |
| `CONNECTION_FAILURE stage=CONNECT`                                     | An unrecognized connection failure; its cause is deliberately not guessed from a generic exception.                                                                                                                                                                                                                                                                              |
| `SESSION_LOGGING_REJECTED stage=SESSION_LOGGING`                       | The script could not read, apply or verify parameter-log protection. It stopped before sending the key. The database owner must review the relevant session permissions/configuration; do not bypass the protection.                                                                                                                                                             |
| `SQL_PERMISSION_DENIED`                                                | The connected role lacks access at the reported stage, such as checking the private table, verifying INSERT privilege, or inserting. No role grants or RLS changes are made automatically.                                                                                                                                                                                       |
| `SCHEMA_NOT_READY`                                                     | A required schema/table/column is unavailable to this connection. Reconcile the target and migration 002; do not apply migration 003 as a workaround.                                                                                                                                                                                                                            |
| `CONFIG_INVALID` / `SQL_FAILURE` / `RESULT_UNCONFIRMED`                | A safely redacted configuration/SQL/result failure. A failure at `COMMIT` can leave a write outcome uncertain in provisioning mode; no success is claimed.                                                                                                                                                                                                                       |

## Provision only after the diagnostic result is understood

Once `CHECK_OK` is obtained and you intend to insert the missing key, run the same command **without `--check`**:

```zsh
(
  export SUPABASE_DB_CA_FILE="$HOME/.config/spotly/supabase-ca.pem"
  read -rs 'SUPABASE_DB_PASSWORD?Supabase database password: ' || exit 1
  printf '\n'
  export SUPABASE_DB_PASSWORD
  env -u SERV_PLAN_SIGNING_KEY -u NEXT_PUBLIC_SUPABASE_URL \
    node --env-file=.env.local scripts/provision-serv-signing.mjs
)
```

Success prints only `INSERTED` or `EXISTING_KEY`. The insert remains parameterized (`$1`) with `ON CONFLICT (singleton) DO NOTHING`, including a race after the presence check. Existing key values are never selected or overwritten. An existing row is detected before attempting logging-setting changes, so a completed setup does not needlessly fail those checks. Neither result asserts that the local and existing database keys match.

The script uses certificate-verified TLS with explicit SSL negotiation, the pooler hostname as TLS SNI, and Node's standard hostname checker. An explicit CA file replaces Node's default CA trust for this connection; there is no fallback if that CA cannot verify the pooler. Without a configured CA file, Node's default trust applies. See [Node TLS trust and hostname verification](https://nodejs.org/docs/latest-v22.x/api/tls.html#tlscreatesecurecontextoptions). A valid CA file alone does not prove that it signs this endpoint's chain.

The script does not inherit `PGSSLNEGOTIATION` or connection-string TLS overrides. It re-reads logging settings after changing them and fails closed if protection is unavailable. `SET LOCAL` affects only its transaction, not database/role configuration or unrelated objects. Errors are replaced with allowlisted categories/stages/TLS reasons, without raw messages, detail, causes or connection information. No automatic retry or fallback changes credentials, TLS, permissions or keys.

The script bypasses SQL Editor and keeps the key out of SQL text, shell history and application output. Standard PostgreSQL bind/error logging, pgAudit and auto_explain parameter logging are protected in-session where applicable. Independently configured infrastructure tracing, triggers or machine recording remain outside its control. Parameterization alone does not guarantee omission from all database logs; see [PostgreSQL parameter logging](https://www.postgresql.org/docs/current/runtime-config-logging.html#GUC-LOG-PARAMETER-MAX-LENGTH).

## D. Rerun the read-only signing diagnostic

From the Spotly project root, paste this into **zsh**:

```zsh
(
  export SUPABASE_DB_CA_FILE="$HOME/.config/spotly/supabase-ca.pem"
  read -rs 'SUPABASE_DB_PASSWORD?Supabase database password: ' || exit 1
  printf '\n'
  export SUPABASE_DB_PASSWORD
  env -u SERV_PLAN_SIGNING_KEY -u NEXT_PUBLIC_SUPABASE_URL \
    node --env-file=.env.local scripts/check-serv-signing.mjs
)
```

Enter the project's **database password** at the hidden prompt. Do not paste any password or signing key into chat. The password is held only in the subshell environment and never included in command arguments/history. The trusted CA stays outside Git; the existing signing key and public project URL load from `.env.local`, overriding any stale shell exports for those two variables. Node does not expand `$HOME` inside an env file; the shell expansion above supplies the actual CA path.

The diagnostic begins a read-only transaction and always rolls back. It checks:

- pgcrypto is installed in `extensions`, with `hmac(bytea,bytea,text)`, `digest(bytea,text)` and `gen_random_bytes(integer)` present. It never calls the random generator.
- `save_verified_serv_plan(text,text)` and `accept_verified_serv_plan(text,uuid)` exist with expected return types, definer security, empty fixed search paths, authenticated execution and no anonymous/PUBLIC execution. Old unsigned RPCs must be absent. These are catalog checks, not live account authorization tests or a full function-body audit.
- The private key table has RLS, no policies, and no schema/table/column access for application roles or PUBLIC.
- The existing database key matches the existing local key. The local key never leaves this process: only an HMAC of a fixed diagnostic message is bound to SQL. PostgreSQL compares internally and returns only a count and boolean. No key, HMAC or receipt is printed or returned by the script. This diagnostic message cannot authorize plans or evidence.

Success begins `Signing check passed:`. Failure prints only an allowlisted category, stage, and optional TLS reason. No raw driver/CLI errors, SQL values, key material, connection strings or function bodies are logged. Network/login/TLS failures retain the categories in section C. Additional diagnostic results:

| Result | Meaning |
| --- | --- |
| `DB_PASSWORD_MISSING stage=CONFIG` | Use the hidden password prompt above; the script does not fall back to CLI authentication. |
| `PGCRYPTO_NOT_READY stage=PGCRYPTO_CHECK` | Required extension namespace or function signatures are missing. Review migration 002/extension setup privately; do not install/move extensions automatically. |
| `RPC_NOT_READY stage=RPC_CHECK` | Signed RPC signature, security configuration or grants differ, or an old unsigned RPC remains. Review deployment; do not relax grants. |
| `PRIVATE_TABLE_NOT_READY stage=PRIVATE_TABLE_CHECK` | Private-table RLS, policies or access grants differ from the expected private configuration. Stop for owner review. |
| `KEY_MISSING stage=KEY_COMPARE` | No singleton key row is visible to this owner connection. Reconcile project/access with the reported insert; do not generate another key. |
| `KEY_MISMATCH stage=KEY_COMPARE` | Local and database keys differ. Privately reconcile existing configuration; do not rotate or overwrite either automatically. |
| `SQL_PERMISSION_DENIED stage=…` | The connected role cannot perform the reported check. This does not justify changing RLS or exposing a public diagnostic RPC. |
| `RESULT_UNCONFIRMED stage=…` | The response shape was unexpected. No success is claimed. |
| `… stage=ROLLBACK` | Transaction cleanup was not confirmed. The transaction was read-only; disconnect is still attempted. |

Local inspection found matching pooler metadata, an existing CA file, and a correctly formatted local key, without printing them. No database password was available to the agent session; a real owner-login/matching run therefore requires the private prompt above. Mocked tests verify that the diagnostic and provisioning have identical connection/TLS configurations, preserve privacy and fail safely; they do not establish a live key match.

Keep Phase 3B disabled. No migration deployment, paid SERV call or database mutation is part of this diagnostic.

## Validation · November 12, 2026

- Live, read-only CLI catalog booleans passed: pgcrypto namespace and all three function signatures; both signed RPC signatures, security configuration and expected grants; absence of unsigned RPCs; private-table RLS/no policies and denied application/PUBLIC access.
- Live PostgreSQL SSL negotiation passed with the configured Session pooler and the existing trusted CA, including certificate-chain and hostname verification. No PostgreSQL startup/login message, password or SQL was sent by that probe.
- The CLI path ran as `supabase_read_only_user`, with schema usage, private-table SELECT and HMAC execution privileges. A successful catalog response had the `rows` shape expected by the old parser. These current observations do not establish the exact exception swallowed by the owner's earlier run.
- A boolean-only protected HMAC probe on the CLI/Management API path timed out (`ETIMEDOUT`); it returned no HMAC, key or match result. This is distinct from the successful catalog checks and pooler TLS probe. The owner-login diagnostic avoids this CLI/API path.
- A sandboxed CLI help attempt failed while writing its local telemetry state, before any SQL. The old diagnostic hid such CLI-local failures in the same generic message. The new diagnostic has no CLI subprocess or telemetry-state dependency.
- The new diagnostic ran locally and correctly reported `DB_PASSWORD_MISSING stage=CONFIG`; it did not attempt a database connection. A complete owner-login/matching check remains pending the private prompt in section D.
- All 75 mocked/offline Node tests passed, including 9 new signing-diagnostic tests and the 18 existing provisioning regressions. ESLint, TypeScript and the production webpack build passed. These do not establish live account authorization or a live owner-login key match. No migration, key, grant, RLS policy or Phase 3B gate was changed; no provider call was made.
