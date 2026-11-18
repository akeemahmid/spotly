# Phase 3B migration preflight · November 12, 2026

> November 18 release status supersedes historical checkpoints and deployment/activation commands below. See [current status](product-release-status.md). Production writes and gate activation are not authorized.

**Historical pre-deployment report.** The owner has since applied migration 003, and fresh read-only checks now confirm all three migrations and the deployed Phase 3B schema/security configuration. Do not repeat deployment. Both database gate flags remain false; effective local development flag is unset/disabled. Continue with [first real workflow preparation](phase3b-first-live-workflow.md), including the project-wide gate limitation. Findings/commands below record the earlier preflight.

Scope: review and remote dry-run only. No migration, membership, key, request, budget, bucket, policy or workflow gate was changed. No paid SERV or real Storage call was made. The owner reports that the owner-login signing diagnostic has passed; it was not rerun by this preflight.

## Target and remote results

Confirmed target: **spotly**, project ref **onfdusisfidlfdmluwxl**, identified by the CLI as **production**. The linked ref, application's public project URL and cached Session pooler metadata agree with the reviewed target: `aws-1-eu-west-3.pooler.supabase.com:5432`, database `postgres`, project-qualified owner login. No credential value was printed.

Live read-only catalog inspection found:

- Applied migration history: `202611050001`, `202611050002`; `202611110001` is absent.
- Required `storage.allow_only_operation(text)` and `storage.operation()` functions exist; `storage.objects` and `storage.buckets` have RLS. There are no application-applicable bucket mutation policies that could change the planned bucket's privacy.
- pgcrypto is installed in `extensions`; both signed plan RPC signatures exist.
- All five deployed Phase 3A public RPC bodies match local migrations after whitespace normalization. Security-definer mode, fixed empty search paths, authenticated execution and denied anonymous/PUBLIC execution match; there are no unexpected public-schema functions.
- All five existing application tables have RLS, no anonymous SELECT, authenticated SELECT and no application mutation/column-write privileges. Their five existing read policies match the Phase 3A baseline, with no extra permissive policies. Membership cannot be changed directly by application roles.
- All four policies intentionally replaced by migration 003 exist.
- No conflicting Phase 3B table, function, Storage policy or bucket exists.

The first CLI dry-run timed out. A bounded retry using `PGSSLMODE=verify-full`, the existing private CA file and disabled seeds completed successfully. The result was:

```json
{
  "upToDate": false,
  "dryRun": true,
  "migrations": ["202611110001_phase3b.sql"],
  "seeds": [],
  "roles": [],
  "target": {
    "kind": "linked",
    "project_ref": "onfdusisfidlfdmluwxl",
    "project_name": "spotly",
    "environment": "production"
  }
}
```

Successful dry-run invocation (run by the agent with no confirmation flag):

```zsh
(
  export PGSSLMODE=verify-full
  export PGSSLROOTCERT="$HOME/.config/spotly/supabase-ca.pem"
  export SUPABASE_DB_SEED_ENABLED=false
  unset SUPABASE_YES
  npx --no-install supabase db push --dry-run --skip-vault \
    --remote=onfdusisfidlfdmluwxl
)
```

`--dry-run` previews without applying migrations; `--skip-vault` excludes Vault synchronization. The explicit project ref avoids a stale target override. See the [Supabase CLI push reference](https://supabase.com/docs/reference/cli/supabase-issue-feature#supabase-db-push).

## Source review

Reviewed migrations 001–003; Supabase session helpers and proxy; assignment, upload and evidence proxy routes; verifier validation/models/photo processing/receipts; verifier pages/layout; dispatcher/verifier UI; plan signing/generation/acceptance paths; and mocked Node plus disposable SQL suites.

| Requirement | Finding |
| --- | --- |
| No unintended destructive SQL | No existing table/column/row is deleted or reset by deployment. Four existing SELECT policies are deliberately dropped and recreated inside the migration transaction to narrow verifier visibility. The migration adds three activity tables, a private gate, a new private bucket, functions and policies. New RPC definitions contain authorized activity mutations but are not executed by deployment. Existing requests/budgets/statuses are untouched. |
| Verifier approval | Only an administrator can insert the relevant membership. Signup/UI metadata cannot grant roles. `ensure_dispatcher_workspace()` can only create the caller's own dispatcher workspace; it cannot add verifier membership to another workspace. |
| Workspace boundaries | Assignment requires dispatcher membership in the request's workspace and verifier membership in that same workspace; self-assignment is rejected. RLS restricts verifier reads to assigned requests and their selected plans, rather than all workspace tasks. The API repeats verified claims; RPCs repeat authorization independently. |
| Private evidence | New bucket has `public=false`, an 8 MiB limit and JPEG/PNG/WebP allowlist. Operation-aware permissive and restrictive policies constrain upload/authenticated download, deny anonymous access and exclude update/delete/signing/listing paths. Real Storage API behavior must still be tested. |
| Trusted accepted plan | Every new assignment/mutation requires accepted `serv_server_v1` provenance, generator matching the original request creator, version 1, exact current fingerprint and future expiration. Historical/imported acceptance is insufficient. |
| Authorized state changes | Request/assignment locks serialize transitions. Only assigned approved verifiers accept/decline/submit; workspace dispatchers review. Approval precedes explicit completion; reviews bind current finalized evidence. Decline is terminal, revisions are bounded, exact retries avoid duplicate events, and expiry blocks new transitions. |
| Evidence integrity | Strict bounded input; Sharp decode/re-encode strips metadata; no overwrite; stored-byte size/hash readback before a separate-purpose HMAC receipt; finalization rechecks ownership, request, plan, state, stored object metadata and receipt. Pending uploads alone are not submissions. Images are served through a verified-session, RLS-protected, no-store integrity-checking proxy. |
| Default-off execution | New database gate starts with `enabled=false` and `live_checks_verified=false`; local server flag is also false. A migration push does not enable work. No application role can open the private gate. |

The [Storage helper documentation](https://supabase.com/docs/guides/storage/schema/helper-functions#storageallow_only_operation) confirms exact operation matching and fail-closed behavior when operation context is absent. Helper existence/catalog checks do not establish that the hosted API supplies the expected context in every signed-upload/overwrite path.

## Manual schema deployment

The reviewed migration's SHA-256 is:

```text
94c13be4e4e52a5a529fc6cb1a02c547e0cdd322e053170a3e64e963a6865827
```

Deploy only the reviewed migration, from the Spotly root, in your own interactive **zsh terminal**:

```zsh
(
  cd /Users/macbookpro/Desktop/spotly || exit 1
  export PGSSLMODE=verify-full
  export PGSSLROOTCERT="$HOME/.config/spotly/supabase-ca.pem"
  export SUPABASE_DB_SEED_ENABLED=false
  unset SUPABASE_YES
  npx --no-install supabase db push --skip-vault \
    --remote=onfdusisfidlfdmluwxl
)
```

This uses the existing CLI authentication that passed the dry-run. Do not add secrets to command arguments. At confirmation, require the same `spotly` project and **only `202611110001_phase3b.sql`**, with no roles, seed data or Vault synchronization. Decline if the plan differs. No `--include-all`, `--include-roles`, `--include-seed` or automatic `--yes` is needed.

Afterward, run [the short read-only schema confirmation](../supabase/tests/phase3b-deployment-check.sql) in that project's SQL Editor. All three booleans should be true after deployment. The query was syntax-checked read-only before deployment and correctly returned three false values while migration 003 was still absent. For full configuration inspection use [phase3b-schema-inspection.sql](../supabase/tests/phase3b-schema-inspection.sql), including checking `enabled=false` and `live_checks_verified=false`. Neither query returns a key.

Keep both workflow gates closed. Do not run the disposable SQL suites on this production project. Schema deployment is separate from execution enablement. After the owner confirms deployment, continue the dedicated-account/Storage authorization prerequisites and the controlled workflow with dispatcher A, unrelated dispatcher B and approved verifier C. Any new paid SERV plan generation needs explicit approval; no payment integration belongs in this phase.

## Verification boundary

All 75 Node tests passed, along with ESLint, standalone TypeScript and the production webpack build. API/Supabase/Storage/provider behavior in the Node suites is mocked; Sharp processing and validation/receipt code run locally. No disposable SQL authorization suite, live account workflow, browser interaction, actual Storage upload/denial or paid SERV generation was executed. The remote dry-run plans migrations; it does not compile/execute the pending migration or prove its live authorization behavior.

Local changes in this preflight are documentation plus read-only inspection SQL. The application and migration SQL are unchanged. Execution gates remain closed; this preflight supports manual schema deployment only.
