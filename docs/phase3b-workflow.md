# Phase 3B implementation and manual deployment · November 11, 2026

> November 18 release status supersedes historical checkpoints and deployment/activation commands below. See [current status](product-release-status.md). Production writes and gate activation are not authorized.

**Latest checkpoint (November 14):** the owner confirms all five migrations and preflight on disposable project `ogqmifuylakjhwveqrmd`, plus all three live SQL suites, every rollback/independent cleanup check and OVERALL PASS. The dispatcher suite also passed. Real Storage HTTP and browser checks remain pending; use the [current test-account setup, explicit test-only gate authorization and cleanup guide](restricted-pilot-demo.md). No Docker/psql is needed. Production remains excluded and must stay gated. The deployment/activation examples and older checkpoints below are historical where superseded; do not run them as part of this Storage handoff.

Phase 3B schema deployment is complete; real end-to-end operation is **not verified**. Assignment execution stays disabled. The owner applied migration 003; the agent has made only read-only deployment checks and preparation/documentation changes. No membership, key or gate was changed, no real evidence was uploaded, and no paid SERV call was made by this preparation.

## What changed

- Auth links now use Spotly green, underlines, hover states and visible keyboard focus, retaining the existing layout and Montserrat.
- `/verifier`, `/verifier/tasks`, and `/verifier/tasks/[id]` provide approved-account access, authorized assignments, selected accepted SERV instructions, location/coordinates, accept/decline, photographic submission plus observation, submission/revision status and history.
- Request details include an approved verifier selector, accepted-plan selector, assignment status, photographs, observations, timestamps, review notes/history, approval, revision request and explicit completion after approval.
- Immutable requests and approved maximum budgets remain unchanged. Field activity lives in separate assignment records. Existing request/dashboard draft counts are not repurposed as field-work counters; use assignment status in request details. No payment execution.
- A private Storage bucket accepts single JPEG/PNG/WebP images, maximum 8 MiB (8,388,608 bytes) before and after processing. The server validates headers, decodes with a 40-million-pixel bound, rejects animated/malformed images and removes embedded metadata through re-encoding. Optional coordinates are manually supplied only after explicit consent. Coordinates/GPS never prove authenticity.
- Submission uses one reservation per assignment/revision, a stable evidence UUID, immutable upload, exact stored-byte readback, and an HMAC receipt bound to evidence/assignment/user/path/observation/consent/type/size/SHA-256. The existing private signing key is reused with a separate `spotly.evidence.v1` purpose. No plan signing endpoint was added; evidence receipts cannot create SERV provenance.
- Storage policies restrict both permissive and pre-existing broad policies. Only `object.upload` and `object.get_authenticated` operations are allowed for this bucket. Signed upload/download URLs, bucket listing, copy/move, resumable/S3 access, updates and deletes are denied. The app serves only finalized evidence through an authenticated, no-store endpoint and rechecks its digest before display. See the [official Storage operation helpers](https://supabase.com/docs/guides/storage/schema/helper-functions) and [access control documentation](https://supabase.com/docs/guides/storage/security/access-control). These documented mechanisms still require live API verification on the intended stack.

## Current checkpoint · November 12, 2026

The owner confirms that protected signing setup is complete and the **owner-login signing diagnostic passed**. This supersedes the earlier missing-key/matching blockers; no key was regenerated or inspected by this preflight.

Fresh read-only inspection confirms all three migrations, 14 public application functions plus the private assertion matching migration bodies, expected table grants/RLS/read policies, the seven Storage policies and private image bucket configuration. Both database flags are **false**. Effective local development `PHASE3B_ENABLED` is **unset (disabled)**; a separately running server's environment was not inspected. Signing configuration was already verified by the owner.

Use the [first real workflow preparation and exact Account C approval/test steps](phase3b-first-live-workflow.md). The [migration preflight](phase3b-migration-preflight.md) is a historical pre-deployment report; do not reapply migration 003. Accounts A, unrelated B and dedicated verifier C still need a recorded live run. Aggregate live checks found zero verifier memberships/accounts/workspaces, so C still needs the owner-approved association.

**Pilot scope prerequisite:** the database gate is project-wide, not a workspace/account/localhost allowlist. RLS and approved memberships still enforce access, but a local flag does not keep other already eligible workspaces disabled. Keep the gate closed until the owner reviews the complete eligible roster and live-check results. If unrelated eligible production users must stay disabled, use an isolated target or a separately authorized database-scoping change; no such change is implemented here. Confirm the field-test target before paying for a plan, since plan IDs/provenance cannot be transferred between projects.

Earlier signing investigation details remain in the [signing guide](serv-signing-provisioning.md) as historical context.

Read-only catalog checks on November 11 confirmed migrations `202611050001` and `202611050002`, all three provenance columns, both signed RPCs, removal of unsigned RPCs, RLS, authenticated SELECT-only public table grants, fixed empty definer search paths, no anonymous/PUBLIC RPC execution, and no application access to the private key schema/table. Both signed RPC bodies match migration 002 after whitespace normalization. Both Storage operation helper signatures are present. The CLI identifies the currently linked project as production: that target was inspected only and is **not** a disposable test target.

November 12 diagnostic validation additionally confirmed the pgcrypto function signatures, signed RPC configuration and private-table protections through live read-only catalog booleans. The existing CA passed a live Session pooler TLS-only probe, with no login or SQL sent. At that earlier diagnostic checkpoint the agent session lacked a database password; the owner has since confirmed a successful private owner-login signing check. All 75 Node tests, ESLint, TypeScript and the production webpack build passed.

These are catalog/configuration observations, not live account or Storage authorization tests. Account A creation and Account B isolation were reported by the owner; this agent did not re-run them. Cross-session Account A persistence is still unverified.

## Existing signing setup — completed

The owner has already passed the check. If later configuration changes require a new comparison, use [section D of the signing guide](serv-signing-provisioning.md#d-rerun-the-read-only-signing-diagnostic). Its hidden terminal prompt supplies the database password privately, configures the existing CA file, and runs `scripts/check-serv-signing.mjs` with the existing `.env.local` key. No secret should be copied into chat, source, screenshots or command arguments. No new key or public RPC is needed.

Require a matching-key pass plus schema/grant inspection before paid planning. This task authorizes **no** paid generation. Keep `PHASE3B_ENABLED=false`; do not deploy migration 003 to fix diagnostics. A successful signing diagnostic does not establish dedicated-account, Storage API or browser authorization behavior.

## Safe migration and account setup

1. Review `supabase/migrations/202611110001_phase3b.sql`. It is additive after 001/002, changes verifier read policies to assigned-only visibility, creates three RLS tables, narrow RPCs, the private workflow gate, and private Storage policies/bucket. Existing migrations were not rewritten. After manual deployment, run the read-only `supabase/tests/phase3b-schema-inspection.sql` as owner and review RLS/grants, the closed gate, private bucket restrictions, and operation-aware policies before enabling anything.
2. Use a separate disposable Supabase project or a running local Supabase stack first. Configure its public URL/publishable key and private matching signing key separately from production. Confirm `storage.allow_only_operation(text)` exists and the Storage API sets operation context. Migration fails closed if the helper is absent. Do not replace it with an always-true helper or loosen policies.
3. Apply migrations in order manually as owner using SQL Editor or your reviewed CLI workflow. For a brand-new disposable project apply all three. For a project with 001/002 already applied, apply only 003. Do not automatically push to the currently linked production target. The evidence bucket name must be unused; an existing conflict requires review, not `ON CONFLICT` adoption of an unknown bucket.
4. On the disposable migrated database run both rollback suites using your private connection configuration, without disclosing credentials:

   ```sh
   psql "$DISPOSABLE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/authorization.sql
   psql "$DISPOSABLE_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/phase3b-authorization.sql
   ```

   The second suite uses synthetic Storage catalog rows and HMAC fixtures. It tests SQL roles/policies/transitions, not the real Storage service or provider. Both must finish at `ROLLBACK`. Never run these synthetic-key suites on production.
5. Use dedicated dispatcher A, unrelated dispatcher B, and a **separately approved verifier V**. Preserve B's existing isolated workspace. Do not repurpose B as V. The owner must explicitly approve V's account UUID and A's workspace UUID; this implementation does not make that approval or write memberships. After approval, the administrator runs, privately with real approved IDs substituted:

   ```sql
   insert into public.workspace_members (workspace_id, user_id, role)
   values ('<approved A workspace UUID>', '<approved V auth user UUID>', 'verifier');
   ```

   Do not update an existing membership's role, trust signup metadata, or add self-service role RPCs. V may already have a separate personal workspace from earlier use; only this administrator-managed membership authorizes A's assignments. Visit `/verifier`; unauthenticated users go to `/login?next=verifier`, which returns to verifier tasks after sign-in.
6. Complete the Phase 3A free checks in `docs/phase3a-browser-checklist.md`: A request save/reload, a second A session confirming persistence, A/B mutual isolation, direct API denials, and matching signing configuration. Do not infer these from the Node tests or catalog inspection.
7. On the **disposable test target only**, an administrator can temporarily open its gate to run Phase 3B authorization/Storage tests with synthetic trusted fixtures. This is a test configuration, never proof of live provider provenance. SQL suites do this within rollback; browser/API tests must use clearly labeled disposable records. Keep the real demonstration target closed until the checks are reviewed.

## Gate opening and real demonstration

The gate is global. Do not use the activation SQL below as if it were an A/C-only allowlist: review all eligible memberships/workspaces first. If unrelated eligible production users must remain disabled, use an isolated target or separately reviewed database scoping. See the [pilot scope prerequisites](phase3b-first-live-workflow.md#pilot-gate-scope--resolve-before-enabling-field-work). No gate change is authorized in this preparation.

After successful disposable SQL/API checks and the Phase 3A live account checks, and separate scope/activation approval for the reviewed pilot target, an administrator records that the prerequisites were verified on **that reviewed target**:

```sql
update spotly_private.workflow_gate
set live_checks_verified = true, enabled = true
where singleton;
```

Set `PHASE3B_ENABLED=true` in that target's server environment and restart. Application mutations require both gates plus a configured key. The database gate authorizes direct RPC/Storage clients independently of the server flag: setting only `PHASE3B_ENABLED=false` does not revoke direct database access while its gate is open. Close the private database gate to stop mutations through all clients. Never enable the currently linked production project as part of this implementation. For real task assignment, use an accepted `serv_server_v1` plan generated for the original request creator, version 1, exact current fingerprint, and a future expiration. Every mutation repeats the database checks under request/assignment locks. Opening a gate cannot make an imported plan eligible.

A controlled real demonstration still requires all of these, with timestamps and actual outcomes recorded without tokens or passwords:

1. A signs into a second independent session and sees the same request, accepted plan, assignment and subsequent review history. B cannot read A's request, plan, assignment, evidence metadata, events or image, including guessed IDs and direct API/Storage requests. An unassigned verifier in A's workspace cannot read the task either.
2. A assigns to approved V, then retries the same assignment: one assignment/event. Invalid plan, unaccepted/legacy plan, mismatched creator/fingerprint/version, expired request, cross-workspace verifier and video requirements all deny. Client budgets/status/role claims cannot grant permission.
3. V signs in through `/verifier`, sees only assigned tasks and the selected plan. A cannot accept as V. V accepts; retry adds no event. Declining another labeled task is terminal and cannot be changed to acceptance. No reassignment UI is included.
4. V submits a non-sensitive test photo and written observation. Test actual JPEG/PNG/WebP, malformed content/MIME mismatch, oversized files, too many pixels, and consent off/on. Refresh during a pending upload and retry with the original file/observation/consent fields. One finalized submission exists per round; arbitrary direct reservations/uploads are not finalized evidence. Embedded EXIF is absent in stored images.
5. Before and after finalization, attempt `createSignedUploadUrl` with both upsert values, `createSignedUrl`, listing, upsert, update, delete, copy/move, resumable and S3 alternatives as V/B. They must deny for this bucket; ordinary authenticated upload/download must succeed only for the allowed account/path/state. Anonymous public download must deny. Membership revocation removes new reads. These Storage service behaviors have **not** been tested here; do not open real assignments before they pass on the intended stack.
6. A reads the actual submitted photo/observation/requirements/time and requests revision with a note. V sees the note and submits the new round. A cannot approve stale evidence. A approves current evidence then explicitly completes the reviewed task; duplicate operations create no second history event. V/B cannot review or complete. The budget and request status stay unchanged. Photos and consent coordinates do not prove authenticity or certify road safety.
7. Expiry blocks assignment, response, reservation, submission and review/completion, including retries after expiry; historical authorized reads remain available. Revoke V's workspace membership and verify private metadata/image denial.
8. Perform actual mobile, keyboard focus, map gesture, overflow, font rendering and reduced-motion QA. No browser was connected during implementation.

Close the gate with `enabled=false` and `PHASE3B_ENABLED=false` if any prerequisite fails. A production rollout needs durable per-user/upload/egress quotas, deployment body limits/timeouts, reviewed retention and owner-only orphan-upload cleanup. Current upload concurrency control is per process, not a distributed quota. Historical photos have no user deletion UI in this phase. A stuck immutable pending object requires administrator recovery; the app never deletes or overwrites it automatically.

## Validation and limitations

- Passed: 48 Node tests, including all 39 existing tests. New tests execute real Sharp image processing and actual validation/receipt code; Supabase, Storage and provider responses in API tests are mocked. They do **not** prove deployed RLS.
- Passed: ESLint, standalone TypeScript, production `npx next build --webpack`.
- Verified live: read-only Phase 3A catalog/grants/function signatures and signed RPC body matches, missing private key row and missing local signing variable; diagnostic fails closed. No live authenticated mutation was performed.
- Passed loopback HTTP smoke checks against the production build: login/signup return 200 with the auth link classes; the protected verifier response includes the sign-in redirect marker (streamed HTTP 200); unauthenticated assignment/evidence endpoints return 401, cross-origin assignment POST returns 403, and API responses are private/no-store. The temporary server was stopped. These are HTTP/source checks, not browser tests.
- Not run: disposable SQL authorization suites, real account sign-in/persistence/isolation, Storage API uploads/denials, assignment/review browser workflow, genuine paid plan generation, mobile/visual QA. Local Docker daemon was unavailable; no disposable database or browser surface was connected.
- Still gated: real assignments/submissions/reviews, administrator approval of verifier C, cross-session A persistence, live authorization/Storage tests and pilot isolation. Migration deployment is now verified remotely, and the owner reports matching signing configuration passed. Video, reassignment, payments, Kite, Reppo and later phases remain excluded.

## Files in this implementation

Modified: `.env.example`, `AGENTS.md`, `README.md`, `app/globals.css`, `app/login/page.tsx`, `components/layout/auth-form.tsx`, `components/ui/status-badge.tsx`, `components/verifications/verification-details.tsx`, `proxy.ts`, `package.json`, `package-lock.json`, and `supabase/tests/authorization.sql`.

Added: `app/verifier/layout.tsx`, `app/verifier/page.tsx`, `app/verifier/tasks/page.tsx`, `app/verifier/tasks/[id]/page.tsx`, `app/api/assignments/route.ts`, `app/api/evidence/route.ts`, `app/api/evidence/[id]/route.ts`, `components/verifications/assignment-workflow.tsx`, `lib/verifier/{validation,models,http,server}.ts`, `scripts/verifier-workflow.test.mjs`, `supabase/migrations/202611110001_phase3b.sql`, `supabase/tests/phase3b-authorization.sql`, `supabase/tests/phase3b-schema-inspection.sql`, and this document. Existing unrelated working-tree changes were retained.
