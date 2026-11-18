# Verified dispatcher workspace authorization run

> November 18 release status supersedes historical checkpoints and deployment/activation commands below. See [current status](product-release-status.md). Production writes and gate activation are not authorized.

Prepared November 14, 2026. **No remote test was run while preparing this procedure.**

Latest owner-confirmed live result: disposable project `ogqmifuylakjhwveqrmd`
returned PASS 1–6, PASS fixture cleanup, PASS rollback and OVERALL PASS with
verified TLS. The agent has not repeated that remote run. Continue with the
[remaining security suites](restricted-pilot-demo.md).

Only disposable project `ogqmifuylakjhwveqrmd` is allowed. Production
`onfdusisfidlfdmluwxl` must never be used. This procedure does not read the CLI
link, deploy migrations, provision signing, enable gates, or call SERV/Storage.

## Why `set_config` is inconclusive

The installed Supabase CLI package is 3.0.0. Inspection of its packaged query
implementation shows that `--file` reads the complete file and sends it as the
`query` field of one Management API request, without splitting/truncating it.
The CLI prints returned rows, rather than a transcript of statement completion.
Supabase's [postgres-meta query implementation](https://github.com/supabase/postgres-meta/blob/master/src/lib/db.ts)
submits the whole SQL string and selects the **last result with nonempty rows**.
In this suite that is `set_config('request.jwt.claim.sub','',true)`, immediately
before the final two assertion blocks and rollback. Their `DO`/`ROLLBACK` results
have no rows. Thus the reported output is consistent with full execution; it
does **not** show that execution stopped at `set_config`. The precise hosted
backend revision and earlier statement completion remain unverified. Do not
mark the authorization suite passed from that output or exit code alone.

The complete suite has six assertion blocks: mixed-role selection and stability;
UUID tie-break; verifier-only setup; new-user setup; missing-identity rejection;
and execution privileges/definer/search-path protection. This suite does not test
assignment, evidence, Storage API, real account authentication, or every RLS policy.

## Rollback and assertion review

All four synthetic users, three fixed workspaces, seven initial memberships and
two RPC-created workspaces/memberships live inside one explicit transaction.
There is no `COMMIT`, autonomous connection, external call, key or gate mutation.
The inspected RPC only inserts workspace/membership rows in that transaction.
The Node runner uses the already installed `pg` package. All six original
`DO $$ … $$` assertion blocks execute intact, on one client/transaction. It
does not split SQL at internal semicolons or send psql backslash commands.
Each scenario has a savepoint: an assertion failure is recorded, its changes
are rolled back to the savepoint, and the remaining scenarios still execute.
Connection/setup failures can leave scenarios `NOT RUN`; they fail the overall run.
The outer transaction always ends with `ROLLBACK` in `finally`, then disconnects.
An interrupted connection cannot commit it; locks may remain until the server
detects disconnection. The runner subsequently checks through a fresh connection.

The assertions now reject NULL workspace returns explicitly: ordinary `<>`
comparisons can evaluate to NULL and silently skip an `IF` failure branch.
Expected authentication errors are checked by exact message; unrelated errors
are rethrown. A missing-identity success raises its own uncaught failure.

## One command — run manually when ready

No installation, Homebrew, `psql`, environment-file loading or shell password
variable is required. The existing test CA is read only from
`~/.config/spotly/spotly-security-test-ca.pem` (PEM bundle or DER certificate).
The CA parser is reused from `scripts/serv-signing-db.mjs`; its provisioning and
production-link configuration are never invoked by this runner.

Open **only** the [test project's dashboard](https://supabase.com/dashboard/project/ogqmifuylakjhwveqrmd).
From **Connect → Session pooler**, copy the **hostname only**, such as
`aws-<number>-<region>.pooler.supabase.com`. Confirm the project reference is
`ogqmifuylakjhwveqrmd`. Do not copy a URL containing a password.

Paste this single command into Terminal (it works from any directory):

```zsh
node /Users/macbookpro/Desktop/spotly/scripts/run-dispatcher-authorization.mjs
```

At the first prompt paste the test Session pooler hostname. At the next prompt
type the **test database password**, then press Enter. Password input is hidden;
no characters or stars appear. It is held only in memory and reused for the
three connections. Ctrl+C cancels the password prompt and restores terminal mode.
No password, key, connection string, raw driver error, or SQL result data is printed.

The username is hardcoded to `postgres.ogqmifuylakjhwveqrmd`, so the shared
pooler on port 5432 routes only to the test project. No project override or
automatic endpoint fallback exists. Explicit `pg` fields require TLS with the
test CA, `rejectUnauthorized: true`, pooler SNI and Node's hostname check.
Inherited connection URLs, endpoint/password/SSL settings and startup options
cannot replace these fields. Password command arguments and piped input are refused.
See [node-postgres TLS configuration](https://node-postgres.com/features/ssl)
and [transaction requirements](https://node-postgres.com/features/transactions).
If TLS fails, stop and resolve the endpoint/CA; do not weaken verification.

The read-only precheck refuses existing fixture IDs rather than deleting them.
It captures hashes of all workspace and membership rows to detect changes,
including randomly generated orphan workspaces. Run while this disposable
project is otherwise idle. After the suite exits, even on an assertion failure,
a fresh read-only connection checks fixture absence and matching hashes.
No cleanup deletes are performed. Connection failure or mismatched hashes makes
rollback verification fail/unverified and the overall command nonzero.

Expected output: six numbered `PASS` lines, `PASS fixture cleanup`, `PASS rollback`,
`OVERALL PASS`, and exit status `0`. Every query is awaited and its PostgreSQL
command results checked; setup also verifies fixture insert counts. An assertion
failure produces `FAIL` for its scenario, continues the remaining scenarios if
the connection can recover, and returns a nonzero exit. Earlier `PASS` lines only cover their
assertions; they cannot override an overall failure. A setup failure can leave
all scenarios `NOT RUN`. If the precheck fails, the suite never starts.

Local runner tests use a mocked Node PostgreSQL client to verify all six original
blocks, transaction/savepoint handling, failure exit codes, TLS/target/CA settings,
secret suppression, and independent cleanup-check execution. Password tests check
hidden input, Unicode input, cancellation and terminal restoration; a local PTY
smoke check also confirmed the prompt hides a synthetic password after the hostname
prompt. These checks make no network calls and do not establish live SQL
authorization or fixture rollback. The subsequent owner-confirmed live pass is
recorded at the top; remaining suites and HTTP/browser checks are tracked separately.
