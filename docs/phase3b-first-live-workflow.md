# First real Spotly workflow — preparation · November 12, 2026

> November 18 release status supersedes historical checkpoints and deployment/activation commands below. See [current status](product-release-status.md). Production writes and gate activation are not authorized.

**Superseded preparation checkpoint:** the owner has since generated and accepted one genuine plan and approved C's portal access. Follow [first assignment preparation](phase3b-assignment-pilot.md) for the new migration, current gate/plan inspection and the discovered verifier/workspace mismatch. Do not repeat the generation or approval instructions below without checking that current report. Gates remain closed.

This is a preparation handoff for the November 15 submission target. No membership, permission, gate, request, plan or evidence was changed by this work, and no SERV provider call was made. A deadline does not replace authorization or Storage testing. The owner reports a passed real owner-login signing comparison; this pass does not repeat it or retrieve signing material.

## Verified deployment and current configuration

Read-only inspection of **onfdusisfidlfdmluwxl** confirmed all three migrations: `202611050001`, `202611050002`, `202611110001`.

- All eight public application tables and both private tables exist with RLS. Application roles have authenticated SELECT only on public tables, no anonymous SELECT, no direct/column mutation privileges and no PUBLIC table grants. The private key and gate tables have no application SELECT or mutation grants; application roles cannot use/create in the private schema.
- All 14 public application functions and private `assert_current_request` match their migration bodies after whitespace normalization. Signatures, security mode, fixed empty search paths and execution grants match the reviewed design. Anonymous/PUBLIC execution is denied; the private assertion is also denied to authenticated users.
- The eight application read policies and seven evidence-object policies match the intended role/task boundaries. There are no private-table policies or bucket mutation policies. Workspace dispatchers can read their workspace; approved verifiers can read only their assigned requests and selected plans. A verifier cannot review as dispatcher in that workspace.
- `verification-evidence` is private, limited to 8,388,608 bytes and JPEG/PNG/WebP. Storage objects/buckets have RLS. Operation-context helpers exist. Restrictive guards exclude anonymous access, overwrite/delete and signing/listing paths for this bucket.
- Aggregate live roster check: **0 approved verifier memberships, 0 verifier accounts, 0 verifier-enabled workspaces**. C has not been approved/associated yet. No identities were selected or printed.
- `workflow_gate.enabled=false`; `workflow_gate.live_checks_verified=false`.
- Effective local **development configuration**, loaded using Next's environment loader: `PHASE3B_ENABLED` is **unset**, which means disabled. SERV/public project credentials and a valid-format local signing variable are present; their values were not printed. A separately running server's inherited environment has not been inspected.

Recheck using [phase3b-live-preflight.sql](../supabase/tests/phase3b-live-preflight.sql), through the existing read-only CLI query path. It returns configuration/metadata, gate flags and function hashes, not keys, signatures, task rows or user identities. Catalog observations are not live A/B/C authorization or Storage API tests.

## Pilot gate scope — resolve before enabling field work

`public.phase3b_ready()` uses one project-wide gate. There is no account, workspace, request, localhost or pilot allowlist in it. `PHASE3B_ENABLED` controls the application server only. If the database gate is opened, every otherwise eligible authenticated client can call the protected RPCs/Storage API directly, subject to the existing RLS and role/plan checks, even when a production web server's feature flag is off. This does **not** bypass RLS or let unrelated dispatcher B self-approve as verifier, but it also does not keep other already eligible workspaces disabled.

A local flag alone therefore cannot certify an A/C-only pilot. Before activation, the owner must review the complete role roster: C must be the deliberately approved verifier in A's intended workspace, A's dispatcher roster must be reviewed, B must remain separate, and no unrelated eligible workspace/user may be unintentionally activated. The identities and intended scope have not yet been approved in this preparation. Do not delete or change other memberships to force a passing result.

If other eligible production users/workspaces must remain disabled, use an isolated reviewed test/pilot target with controlled accounts/data, or obtain separate authorization for reviewed database-enforced pilot scoping across RPCs and Storage. The existing gates have no per-pilot switch. An isolated target needs its own migrations, owner-provisioned matching signing configuration and account setup; production UUIDs/sessions do not transfer. Do not copy production data or overwrite/rotate the current production key. No new gate implementation or target is created here.

SERV planning/acceptance is a Phase 3A operation and can be tested on the current target with Phase 3B gates closed, after account checks and separate paid-call approval. Plan IDs/provenance are project-bound: a plan generated in production cannot be manually transplanted into another database. Confirm the eventual field-test target before spending credits if one paid plan must serve the entire end-to-end test.

## Prepare Accounts A, B and C — no gate change

Use three separate browser profiles (not tabs sharing cookies), the same target and the exact origin `http://127.0.0.1:3000`. Start local development yourself:

```zsh
npm run dev -- --webpack --hostname 127.0.0.1
```

Keep the local Phase 3B flag disabled. Do not use a tunnel or public development bind. Do not click **Generate plan with SERV** during account preparation.

1. **A:** Sign in using the existing dispatcher account. Confirm its existing workspace/requests reload in a second independent A session. In the project's Dashboard, the owner privately identifies A's Auth user UUID and its dispatcher membership. If A has multiple workspaces, use the workspace of the actual saved labeled request; the creation API currently selects A's earliest membership and has no workspace picker.
2. **B:** Sign in as the unrelated dispatcher. Confirm a different workspace. Leave B's memberships unchanged. B must not see A's known request IDs, plans or activity in lists or direct URL/API reads. Record the actual results; earlier reported isolation is not a substitute for this run.
3. **C:** In the third profile, create a dedicated account at `/signup` if it does not already exist, confirm its email as required by the target's Auth settings, then sign in. Reuse an existing dedicated C account rather than creating duplicates. Visit `/verifier`. Before approval, expect **Verifier access required**, not A's tasks. Signup metadata or a personal dispatcher workspace does not approve C as A's verifier.
4. In the correct project's **Authentication → Users**, the owner privately verifies C's confirmed account and copies its actual UUID. C must be distinct from both A and B. In **Table Editor → public.workspace_members**, verify A's dispatcher membership/workspace and check whether a C/A-workspace row already exists. An existing `verifier` row needs no new insert; any conflicting role requires owner review. Do not convert B or overwrite an existing role.
5. The legitimate approval mechanism already documented in `phase3b-workflow.md` is an **owner/administrator SQL Editor insert**, after the owner explicitly approves the two real UUIDs. There is no self-service approval page or approval RPC. Run this manually only after replacing both placeholders privately:

   ```sql
   insert into public.workspace_members (workspace_id, user_id, role)
   values ('<approved A workspace UUID>', '<approved C auth user UUID>', 'verifier');
   ```

   This is the existing schema/mechanism, not a bypass. Never use the application publishable-key session to perform it, add a browser administrator client or grant C database administration. Do not add `ON CONFLICT DO UPDATE` or change existing membership roles. This preparation does not execute the insert.
6. The owner verifies exactly the intended C/A-workspace verifier row. C refreshes `/verifier/tasks`: the approved portal should load with **no assignments** and the disabled-workflow notice. A's existing request page should list C as an approved verifier while assignment remains disabled. C's separate personal dispatcher membership, if signup created one, stays separate. An empty list alone does not prove cross-workspace denial; known-ID checks are still required.

Do not share account passwords, session cookies, access tokens, signing keys or unredacted Network exports. Keep actual UUIDs/request IDs in the private test record; report safe outcomes rather than credentials.

## Prerequisites for opening an isolated local field pilot — later approval only

All of these are required; none is a permission to enable production now:

| Dependency | Required evidence |
| --- | --- |
| Pilot scope | Owner-reviewed eligible dispatcher/verifier roster limited to the intended pilot, with unrelated users/workspaces staying ineligible; otherwise an isolated target or separately reviewed database-enforced pilot scoping is needed. The local flag alone is insufficient. |
| Signing/schema | Correct target, all migrations, live key match and expected grants/RLS/function/Storage configuration on that same target. |
| Accounts | A session persistence, unrelated B isolation, C owner-approved membership, unassigned-C denial and direct authenticated RPC/Data API denials. |
| Disposable authorization | Both existing rollback SQL suites pass only on a disposable migrated database. Fixtures overwrite a synthetic key inside rollback and must never be run on production. |
| Actual Storage API | Dedicated-account tests of normal allowed upload/download and denied signed URLs, overwrite/upsert, listing, copy/move, resumable/S3 alternatives; a real known object's A/C/B/anonymous reads must be tested. Merely marking a bucket private or requesting a nonexistent file is insufficient. |
| Controlled execution | Owner reviews scope and outcomes and separately authorizes activation on the chosen reviewed target; local server is bound to loopback with no tunnel. |

The existing activation mechanism requires an owner, after those prerequisites and explicit scope approval, to set that target's private `workflow_gate.live_checks_verified` and `workflow_gate.enabled` to true, then set `PHASE3B_ENABLED=true` only in the local pilot server and restart it. Keep both signing configurations matching. Do not mark live checks verified before they have actually passed. No activation is authorized or performed by this preparation. Storage positive tests require a gate-open controlled disposable target; they are prerequisites to opening any real/shared demonstration target, not a reason to open production early.

Closing only the server flag does not stop direct RPC/Storage mutations while the database gate remains open. The owner must close the database gate as well if any prerequisite fails. Historical authorized reads are not disabled by the workflow mutation gate.

## Exactly one genuine SERV planning test — after separate paid approval

First confirm a target and reviewed scope that can safely support the later field test. If an isolated target is needed, do not pay for a production plan expecting to move it there.

1. In A's profile, use `/dispatcher/verifications/new` to save one request titled **`[E2E 2026-11-12] Road-condition observation A`**. A supplies the real chosen location/coordinates, a lawful safe observation question, photo and written-observation requirements (no video), a future expiration long enough for review, and explicitly approves the unchanged maximum budget. An intentional zero-budget demo is supported; request budget does not include or authorize SERV provider credits.
2. Record its returned request ID, A's identity/workspace, expiration and approved maximum budget privately. Reload and confirm persistence. Reuse this exact labeled request; do not create duplicates after a lost response without checking A's saved list. There must be no pre-existing valid pending/accepted plan for this request before approving a new call.
3. A second A session must see the same request; B and unassigned C must not see A's request/plan. Check authenticated direct access as well as UI visibility using their own user sessions. Server-role/catalog checks are not account tests.
4. Request separate approval for **one** genuine generation for this exact request/target with the configured model. Until approval, stop here. No provider call is made by this preparation; credential presence does not prove current provider credits/model availability.
5. After approval only, A clicks **Generate plan with SERV** once. Keep the tab open, do not double-click, refresh while it is in flight, or click retry from another session. Record one Network POST to `/api/serv/plan-verification` and its outcome without exporting credentials or receipt material.
6. On success, the displayed saved plan ID must correspond to `serv_server_v1`, generated for A, version 1, the saved request fingerprint and a genuine provider response. Reload before acceptance and verify the same pending plan returns with **no new generation POST**. Use the persisted candidate; do not regenerate for a recording.
7. A reviews the instructions/questions, clicks **Accept reviewed plan**, reloads, then verifies the same acceptance in the second A session. The owner may inspect only the selected plan's ordinary provenance/identity/version/fingerprint/accepted timestamp fields privately. Do not display `receipt_signature` or keys. The original request remains `draft` and its approved budget is identical before/after.
8. Failed/unsigned/legacy/stale/wrong-user plan persistence or acceptance must deny. Exercise the existing forged-receipt/stale-plan SQL cases on the disposable target; test B's access/acceptance using its own authenticated client, never an owner/service-role client. Do not insert a fake trusted plan into production to satisfy this requirement.

**Failure protocol:** a timeout or lost browser response may still have consumed credits. Stop, reload and check persisted plans/provider outcome; never automatically regenerate. The current API has per-process concurrency/cooldown controls, not a durable per-request exactly-once provider-call mechanism. The one-call test therefore depends on the controlled manual protocol. Do not claim exact-once billing is guaranteed.

## Manual field workflow — only after the pilot prerequisites and activation approval

Use the same target, request and accepted plan throughout. No further generation is part of these steps. If the request expires, stop; do not change historical expiration/budgets or forge a replacement plan.

| Step | Exact manual action | Required result |
| --- | --- | --- |
| Assign | As A, open `/dispatcher/verifications/<requestId>`. In **Verifier assignment & review**, select the already accepted saved plan and approved C, then **Assign task**. Record returned assignment ID privately. | One `offered` assignment and one `assigned` history event. Same request/plan/workspace/C; budget and original draft status unchanged. |
| Assignment retry | Retry the exact assignment selection through the same authenticated action if needed. | Same assignment ID; no second assignment/event. Different verifier/plan cannot reassign the request. |
| C acceptance | In C's profile open `/verifier/tasks`, then that assignment. Review the selected instructions/location and click **Accept assignment**. Refresh. | `accepted`; one acceptance event. A/B cannot accept as C. Do not decline the main demo task: decline is terminal; test that case with disposable fixtures, not a second unapproved paid plan. |
| Photo + observation | C selects one real, non-sensitive JPEG/PNG/WebP up to 8 MiB, writes what was actually observed, leaves optional coordinates off unless intentionally consenting, then **Submit for review**. | A normalized private image is uploaded without overwrite, stored bytes are checked and a receipt finalizes one evidence row. Status `submitted`; one submitted event; no metadata-only reservation counts as evidence. |
| Reload/recovery | Reload C and A independently. If a submission failed before finalization, retain/retry the same photo, observation, consent fields and evidence UUID. | Finalized evidence/observation/history persist. A pending reservation is clearly unfinished and is not shown as a finalized submission. |
| Duplicate rejection | Keep a successful evidence request private in DevTools. A second submission with a new evidence UUID in the same round must deny; retrying the same UUID/content must never create another row, object or submitted event. | One finalized evidence record per round. Exact RPC retries are idempotent; the upload route can reject a replay after finalization, so do not demand HTTP 200 from every replay. Different immutable bytes must not overwrite the existing image. |
| Review/revision | As A, view the actual submitted photo and observation. Optionally request revision with a note; C submits the next round. | Current-round evidence only; revision note visible to C; stale evidence cannot be approved. No new SERV call. |
| Approve/complete | A approves the current submission, then explicitly completes it. Refresh A and C and retry completion once. | Assignment becomes `completed` after `approved`, one completion event. Original request remains `draft`, budget unchanged. C/B cannot review or complete. |

For known-ID denial checks, test B's direct UI URLs and same-origin `GET /api/assignments?requestId=<A request ID>` and `GET /api/evidence/<submitted evidence UUID>` in B's own profile. A list may correctly return HTTP 200 with no A rows; the evidence proxy should return 404 for hidden evidence. A server-gate 503 only proves the gate is closed, not cross-workspace RLS. Test direct authenticated database RPC/Data API access on the controlled target as well, because UI/server guards are not the authorization boundary.

## Prove Storage privacy with a real known object

Run these on the controlled test target, using clients authenticated as the named users with the public project key. Never use database-owner credentials or a service-role key for allow/deny tests. Keep session tokens in memory/private tooling, not in pasted commands or chat.

- Use the actual finalized `file_path` associated with the evidence UUID; do not substitute a random missing path. C and workspace dispatcher A should download the same normalized photo through the authenticated path/proxy. B and a signed-out browser must receive no image bytes, including direct Storage public/authenticated download attempts. The proxy response is `private, no-store` and repeats authorization/integrity checks on every view.
- For a **fresh reserved path before upload**, C attempts `createSignedUploadUrl(path)` with upsert false and true: both must deny. Testing only an already occupied path can pass accidentally on uniqueness instead of authorization.
- C attempts `createSignedUrl(path, 60)` before and after finalization: deny, not a reusable bearer URL. Also test B; inability to obtain a URL must not be inferred merely from a failed later fetch.
- C attempts ordinary upload to its current reservation with `upsert:false`: allowed only in the accepted/current/unexpired state. Upload to another assignment/unreserved path denies. Ordinary authenticated download of a pending own upload is needed for the server's byte-readback; pending bytes are not finalized evidence and the application evidence proxy must still return 404.
- After submission, repeat ordinary upsert with different bytes, update and delete: deny and preserve the original object/hash. Try listing, copy/move, resumable and S3 alternatives: no access to this bucket through those operations. Signed-upload token overwrite/creation denial must be tested separately from ordinary upsert denial.
- In the disposable test only, revoke C's relevant membership and repeat metadata/image reads: deny. Restore membership only through the reviewed administrator mechanism if further tests are required. Do not revoke production roles as an unapproved test.

Use real Supabase SDK methods from the installed client and the named user's session. Do not add a general-purpose RPC proxy, public signing endpoint or fake operation helper to make these tests convenient. The [official operation helper documentation](https://supabase.com/docs/guides/storage/schema/helper-functions) describes exact operation matching, and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) explains policy requirements. These documented rules still need real API tests on the chosen stack.

## Verification performed in this preparation

| Category | Actual outcome |
| --- | --- |
| Unit/data/API tests | **75 passed.** Validation, crypto and Sharp processing run locally; database, Supabase/provider and Storage API behavior in these tests is mocked. |
| Local static/build checks | ESLint, standalone TypeScript and production `next build --webpack` passed. This does not deploy the app or prove browser behavior. |
| Live database checks | Read-only migration, table/grant/RLS, policy, function-body hash/signature/security, private bucket, gate and aggregate verifier-roster inspection passed. No authenticated application-user mutation was executed. |
| Disposable SQL role suites | Not run. No usable Docker engine was confirmed by the local read-only probe; no separate disposable migrated target was supplied. Never substitute the production database. |
| Browser authentication | Not run by the agent. A/B/C login, confirmation, persistence and known-ID isolation still need actual browser/user sessions. |
| Real Storage upload/privacy | Not run. No photo, reservation, signed URL, overwrite attempt or A/C/B/anonymous known-object test was executed. Private flags/policy definitions are configuration evidence only. |
| Genuine SERV | Not run; no credits spent or paid approval requested in this preparation. Provider account/model/credit availability has not been proven by a real call. |
| Field workflow | Assignment, acceptance, real submission, review, completion, retry and direct-access denial remain unverified until the controlled run. |

The only local changes are documentation and a reusable read-only catalog query. Application/migration code, gates, permissions, memberships and signing material remain unchanged.

## Evidence record and next action

For each case record target, account label, request/assignment/evidence IDs privately, timestamp, expected result, actual safe status and before/after row/event counts. Mark not-run cases explicitly; do not turn screenshots of configuration or mocked tests into evidence of live functionality.

**Next manual action:** keep all gates off, start loopback development and sign into dedicated C in a separate browser profile, creating/confirming that account only if needed. Verify `/verifier` blocks C before approval. The owner can then privately verify A's workspace and C's distinct UUID and perform the existing approval insert after explicitly approving those identities. Review the pilot roster/target before authorizing the single paid generation if that plan must continue into the full field workflow.
