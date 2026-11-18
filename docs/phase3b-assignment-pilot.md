# First assignment preparation — November 12, 2026

> November 18 release status supersedes historical checkpoints and deployment/activation commands below. See [current status](product-release-status.md). Production writes and gate activation are not authorized.

**Superseded by the [November 13 restricted pilot guide](restricted-pilot-demo.md):** the owner has resolved the identities and approved C in the intended request workspace. A database restriction is now implemented locally, undeployed, with exact manual deployment/activation steps and isolated tests. Reuse the existing plan; keep gates closed until those checks pass. The blocker and project-wide-gate recommendation below describe the earlier checkpoint.

This checkpoint supersedes the account-approval and plan-generation preparation in the earlier Phase 3B guides. The owner confirms C can enter `/verifier/tasks`, and confirms the request below is A's intended request. **Reuse the existing accepted plan. Do not generate another SERV plan.** No migration, membership, permission or gate was changed remotely, and no provider or real Storage upload was called by this work.

## Existing plan and current blocker

The owner-only read-only query [phase3b-assignment-readiness.sql](../supabase/tests/phase3b-assignment-readiness.sql) returned:

- Project: `onfdusisfidlfdmluwxl` (`spotly`, marked production by the CLI).
- Request: `REPLACE_WITH_REVIEWED_REQUEST_ID`.
- Request workspace: `REPLACE_WITH_REVIEWED_WORKSPACE_UUID`.
- Accepted plan: `REPLACE_WITH_REVIEWED_PLAN_UUID`, accepted November 12 at 13:29:53 UTC.
- Provenance `serv_server_v1`; receipt recorded; creator binding, dispatcher membership, version 1 and current request fingerprint checks passed.
- Expires November 29, 2026 at 13:28 UTC; evidence requirements contain no unsupported video.
- Maximum budget is **USD 10.00**, matching the request snapshot bound into the signed plan. Original request remains `draft`. This checks the signed snapshot, not a separate historical accounting ledger.
- No assignment or evidence exists. The plan is stored in the database, independent of the generating browser session. An authenticated browser reload still needs manual confirmation.
- Both database gate flags are false. Local Next development configuration has `PHASE3B_ENABLED` unset (disabled), with valid-format signing configuration. The owner previously verified the key match; no key was selected or printed here. A separately running server's inherited environment was not inspected.

**Blocker:** the accepted request workspace has **zero verifier memberships**, although the project has one verifier membership in one other workspace. Portal entry only requires a verifier membership somewhere; assignment requires it in the exact request workspace. Do not open gates to work around this.

Privately inspect the identities in Supabase SQL Editor as owner:

```sql
select u.id as user_id, u.email, m.workspace_id, m.role
from public.workspace_members m
join auth.users u on u.id = m.user_id
where m.workspace_id = 'REPLACE_WITH_REVIEWED_WORKSPACE_UUID'
   or m.role = 'verifier'
order by m.workspace_id, m.role, u.id;
```

Match real emails to A and dedicated C privately; do not assume the second account is C or repurpose unrelated B. The owner must reconcile the verifier approval against the **request's actual workspace**, using the previously reviewed guarded administrator approval mechanism only after checking the identities. Do not move the plan/request, change ownership, overwrite a role or alter existing memberships. A user cannot have both roles in the same workspace; if the proposed C already dispatches this request workspace or is its creator, stop and resolve the account identities. No membership correction was performed here.

## Membership correction migration

New migration: [202611120001_dispatcher_workspace_role.sql](../supabase/migrations/202611120001_dispatcher_workspace_role.sql). Previously `ensure_dispatcher_workspace()` selected the oldest membership of any role. It now selects the oldest **dispatcher** membership, retaining deterministic timestamp/UUID ordering, verified `auth.uid()`, the transaction advisory lock, fixed empty search path, definer mode and existing execution ACL.

Existing dual-role users retain their legitimate dispatcher workspace even when a verifier row is older. A user without a dispatcher membership gets a new personal dispatcher workspace; the helper never promotes their verifier membership in an existing workspace. It does not relocate existing requests or plans. Deployed migrations 001–003 are untouched.

The new rollback regression suite covers older verifier memberships, multiple dispatcher workspaces, timestamp ties, idempotent setup, verifier-only/new accounts, missing identity, execution grants and definer/search-path hardening. The Phase 3B role suite now gives C a separate personal dispatcher membership and checks its scope, approval predicate, unassigned-request denial and budget denial.

Run only on a disposable, fully migrated Supabase database, with its credentials configured privately in `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and password prompt/secure password file. Require verified TLS for hosted connections. Do not point these commands at production:

```sh
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/dispatcher-workspace-authorization.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/authorization.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/phase3b-authorization.sql
```

All three must end in `ROLLBACK`. The latter two use synthetic signing fixtures and must never run on the production project, even though they roll back. SQL role/Storage catalog fixtures do not test browser authentication or actual Storage service behavior.

## Authorization evidence and outstanding tests

| Check | Evidence in this preparation |
| --- | --- |
| Unapproved portal denied / approved portal allowed | Source authorization inspected; owner reports C denied before approval and allowed afterward. Not re-run by the agent with real user sessions. Disposable SQL now covers the membership predicate, not browser entry. |
| Unassigned C cannot read A's request | Enforced by reviewed assigned-verifier RLS; disposable case prepared. Real authenticated account test not run. |
| B cannot read A's workspace data | Workspace-scoped dispatcher/assignment RLS inspected; disposable case prepared. Real authenticated account test not run. |
| C cannot assign itself or approve its evidence | RPC checks require dispatcher membership in the request workspace; personal dispatcher membership is insufficient. Disposable dual-role cases prepared, not executed. |
| C cannot change budgets | No authenticated table/column UPDATE privilege in the established schema; role-suite denial prepared. The current owner query confirms the budget UPDATE denial boolean. No production update attempted. |
| Forged accepted plan rejected | Signed save/accept RPCs and trusted plan constraints inspected. Existing disposable receipt-forgery/legacy-plan cases prepared; provider/Supabase tests are mocked. No forged production insert attempted. |
| Anonymous private table/RPC access denied | **Real hosted Data API:** HEAD reads of requests, plans, memberships, assignments and evidence, plus `phase3b_ready`, each returned **401**, using only the public key and no user session. |
| Unauthorized private Storage bytes denied | Policy/source inspection only. No known real evidence object exists yet; a nonexistent-path 404 would not establish privacy. Actual A/C/B/anonymous object tests remain unrun. |

The Docker daemon is unavailable and no separate disposable connection was configured. Therefore **no PostgreSQL rollback authorization/regression suite was executed**. Do not substitute this production project or use production account credentials for disposable tests. Local automated tests use mocked Supabase/provider/Storage APIs; Sharp/crypto/validation execute locally.

Fresh accepted-plan/gate and full catalog inspection succeeded using the existing trusted CA with strict TLS. The catalog shows exactly the three deployed migrations; ten application/private tables with RLS and no application mutation grants; all fourteen public application function bodies and the private assertion matching migrations 001–003; fixed empty function search paths and expected execution restrictions; eight application read policies and seven private-object policies; no application access to the private schema; a private 8 MiB JPEG/PNG/WebP bucket; and both Storage operation helpers. Some earlier CLI attempts timed out. These successful catalog checks still do not establish real user or Storage API behavior. The old workspace lookup remains deployed until migration 004 is applied manually.

## Restricted pilot recommendation

`phase3b_ready()` is project-wide. Opening it enables otherwise authorized direct RPC and Storage clients independently of `PHASE3B_ENABLED`. It does not bypass RLS, but every approved workspace/verifier and eligible dispatcher can use their permitted workflow. It also enables eligible future requests; it is not an allowlist for this one plan. Closed gates do not remove existing authorized historical reads.

Currently the sole approved verifier is in a different workspace from the accepted plan. Activating now would expose that other workspace's eligible operations while still leaving the intended request unassignable. Do not activate.

Safest sequence:

1. Use an isolated disposable Supabase stack/project with separate synthetic accounts and signing fixtures for the SQL, browser authentication and real Storage tests. Do not copy this production key or transplant its trusted plan. Synthetic fixtures are never evidence of a genuine SERV call.
2. Keep the existing genuine plan on its current project; complete the account/workspace reconciliation without role overwrites.
3. Before using that plan on the shared project, prepare and review a separate database-enforced pilot scope for the exact request/workspace and A/C identities. Scope assignment, transitions, reservations, finalization and direct Storage upload authorization; retain all existing gates, role checks and RLS. Include negative tests for unrelated approved users/workspaces. No scoping migration is implemented or authorized by this fix.
4. After those tests pass, obtain explicit activation approval for the reviewed target. Only then may the owner mark live checks verified and enable the scoped database gate, enable the local server flag and restart loopback development. Neither gate is changed by this preparation. Closing the database gate is required to stop direct-client mutations; turning off only the local server flag is insufficient.

An isolated environment is sufficient for rehearsal. It cannot use this project-bound accepted plan. A local-only flag or the current small roster is not a durable database restriction for an A/C-only pilot. Do not regenerate a plan to evade this limitation.

## Manual deployment of the membership fix only

First pass the disposable SQL regression suite. From the project root, in your own zsh terminal, preview the production migration plan:

```zsh
(
  cd /Users/macbookpro/Desktop/spotly || exit 1
  export PGSSLMODE=verify-full
  export PGSSLROOTCERT="$HOME/.config/spotly/supabase-ca.pem"
  export SUPABASE_DB_SEED_ENABLED=false
  unset SUPABASE_YES
  npx --no-install supabase db push --skip-vault --dry-run \
    --remote=onfdusisfidlfdmluwxl
)
```

Require the correct project and **only `202611120001_dispatcher_workspace_role.sql`**. If anything else is pending, stop for review. After inspecting that output, deploy manually with the same command minus `--dry-run`:

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

Use the existing private CLI login; never add a password to command arguments. CLI flags were checked against the installed version. The agent's bounded remote dry-run **timed out**, so no successful migration preview is claimed; no apply command was run. Complete the preview yourself before deployment. If CLI access continues timing out, resolve that connection problem before applying; do not weaken TLS, permissions or blindly retry deployment after a lost response. Keep gates closed. Re-run the read-only readiness SQL afterward; expect four migration versions in the catalog query and unchanged closed gate flags.

Reviewed migration SHA-256: `ed0b3ed86292a4844d846ce9f802c75babaca888c809ebebb1d0a0289201c1f9`.

## First browser assignment — only after the blockers and activation approval

Use separate A/C/B browser profiles on the reviewed target, with local development bound to `http://127.0.0.1:3000` and no tunnel. Restart to load reviewed local code/environment. Do not use tabs sharing an account cookie jar.

1. **A:** Open `/dispatcher/verifications/REPLACE_WITH_REVIEWED_REQUEST_ID`. Reload, then confirm the existing accepted plan ID `REPLACE_WITH_REVIEWED_PLAN_UUID`, USD 10.00 budget and expiration. Confirm the same in a second A session. Do not click any Generate button.
2. **Before assignment:** B must not see A's request/plan via lists, known-ID page or direct authenticated Data API. Unassigned C must not read that request/plan either. A 503 from a closed application gate is not an authorization-test pass.
3. **A:** Under **Verifier assignment & review**, select the existing accepted plan and verified C UUID, then **Assign task** once. Expect `offered`, one assignment and one history event. A's budget and original draft status stay unchanged. An exact assignment retry returns the same assignment; reassignment is unsupported.
4. **C:** Refresh `/verifier/tasks`, open the new task, review the accepted instructions/location and choose **Accept assignment**. Expect `accepted` after reload. Do not decline the demo task; decline is terminal.
5. **C:** Choose one genuine, non-sensitive JPEG/PNG/WebP up to 8 MiB. Write a truthful observation. Leave coordinates off unless intentionally consenting. Choose **Submit for review**. Expect a finalized private photo and observation, state `submitted`, and one submitted event. Do not fabricate evidence or treat a pending upload as submitted.
6. **A:** Refresh the original request, open the photo and read the observation. Select **Approve evidence**, then **Mark reviewed task complete**. Expect assignment `approved` then `completed`. The verification request remains `draft`; budget stays USD 10.00. Revision is optional, requires a note, and needs a new current-round submission before approval.
7. **Privacy:** Using the real known object path, A/C can retrieve the normalized image; B and anonymous clients receive no bytes. Test both direct Storage access and `/api/evidence/<evidenceId>`; the latter must be private/no-store and return 404 for hidden evidence. Refresh A and C independently to confirm persisted results.
8. **Retries/denials:** A second evidence UUID in the same round denies; an exact retry must not add evidence/object/history. C/B review/complete, C self-assignment, budget writes and forged plan writes must deny on the controlled test target. Test destructive/negative mutations only against disposable records/accounts, not the live demo data.

Real Storage prerequisites must pass on the isolated stack before opening the real pilot: fresh-reservation signed-upload URL creation (with upsert both false and true) denied; normal reserved upload/readback succeeds; signed download URLs, overwrite/upsert/update/delete, listing, copy/move and alternate upload routes denied. Repeat known-object A/C/B/anonymous access after finalization. Operation helpers distinguish exact Storage actions and fail closed when context is absent, per [Supabase's helper documentation](https://supabase.com/docs/guides/storage/schema/helper-functions); their existence alone is not an API test.

The server re-encodes bounded images with Sharp to remove embedded metadata, uploads without overwrite, downloads and hashes the actual bytes, and only then signs finalization. Every mutation rechecks roles, accepted plan, expiry and state under database locks. Expiration also blocks review/completion. Submission errors retain retry instructions; a conflicting immutable upload needs administrator recovery, not overwrite. Production-wide operation would still need durable upload/egress quotas, deployment body/time limits and reviewed retention/orphan recovery.

## Local verification

77 Node tests passed, plus ESLint, standalone TypeScript and `next build --webpack`. Two new Node tests cover safe readiness categorization and the mocked read API contract. Database regression suites are prepared but unrun. Browser gestures/layout, authenticated A/B/C isolation, real photo upload, signed URL/overwrite denials and actual field completion remain unverified by the agent.

## Exact files changed in this preparation

- `supabase/migrations/202611120001_dispatcher_workspace_role.sql` — new, undeployed function correction.
- `supabase/tests/dispatcher-workspace-authorization.sql` — new rollback database regression suite.
- `supabase/tests/phase3b-authorization.sql` — dual-role and unassigned/approval/budget cases added.
- `supabase/tests/phase3b-assignment-readiness.sql` — new owner-only read-only plan/gate/roster query.
- `lib/verifier/server.ts` — safe workflow block categories; existing mutation authorization preserved.
- `app/api/assignments/route.ts` — reports the safe category alongside enabled state.
- `components/verifications/assignment-workflow.tsx` — accurate gate and approved-account empty-state copy.
- `scripts/verifier-workflow.test.mjs` — two readiness/API tests added.
- `docs/phase3b-assignment-pilot.md` — this report, deployment instructions and manual test plan.
- `docs/phase3b-workflow.md` — links this latest checkpoint.
- `docs/phase3b-first-live-workflow.md` — marks earlier generation/approval preparation as superseded.

Other pre-existing working-tree changes were preserved. No changes to `.env.local`, signing material, deployed migration files, membership rows or gates were made.
