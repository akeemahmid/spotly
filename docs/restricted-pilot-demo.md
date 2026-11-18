# Disposable security checks and restricted browser rehearsal

> November 18 release status supersedes historical checkpoints and deployment/activation commands below. See [current status](product-release-status.md). Production writes and gate activation are not authorized.

Updated November 14, 2026. All commands in this guide target ONLY
`ogqmifuylakjhwveqrmd`. Production `onfdusisfidlfdmluwxl` is excluded: no
production connections, deployment, signing-key/plan copying, gate activation,
SERV calls or payments are part of this procedure. Existing production gates
must stay disabled. No migration or RLS policy is changed by these runners.

## Next action: ten-step evidence workflow and browser rehearsal

### Focused C download reproduction — current next command

The owner confirms that BOTH deployed authenticated SELECT policies name
`object.get_authenticated`. Keep that operation and every policy unchanged.
The historical failed object has been cleaned up; its current authorization
cannot be reconstructed by querying the now-absent row.

For `verification-evidence`, the source permissive expression is
`bucket_id='verification-evidence' AND allow_only_operation(...) AND can_read_task_evidence(name)`;
the restrictive expression is
`bucket_id<>'verification-evidence' OR (allow_only_operation(...) AND can_read_task_evidence(name))`.
Both are TO authenticated. `can_read_task_evidence` requires an exact reservation
path and `can_read_assignment`; the latter requires a real assignment/request
and either dispatcher membership in that request's workspace or assigned-verifier
membership there. There is no `submitted_at`, gate or finalization predicate on
these source read helpers. A missing reservation, different JWT identity, lost
membership/assignment or another applicable restrictive policy can deny a read.
The source upload predicate is stricter than the read predicate: with unchanged
relationships/helpers and the SAME C identity, upload eligibility already implies
the assigned-verifier read condition. There is no justified finalize-first fix.

Prepare ONE manual reproduction, rather than rerunning the full security suite:

```zsh
node /Users/macbookpro/Desktop/spotly/scripts/run-storage-security.mjs --reproduce-c-download
```

This command has **not** been run by the agent. It uses the existing fixed-test
connection/CA and hidden prompts, empty-state preflight, explicit
`ENABLE STORAGE TEST ogqmifuylakjhwveqrmd` acknowledgement, version-2 journal,
temporary synthetic fixture/gates and guarded cleanup. No production target,
policy change, migration, paid call or service-role client is introduced.
It creates fresh fixture state and exactly one small reserved PNG upload. It
does not run MIME/size/overwrite probes, finalize evidence, review/complete,
open browser scope or claim a full-workflow PASS.

After A assigns and C accepts/reserves/uploads, it confirms the catalog and then
validates C's **exact current token** with Auth `getUser(token)`. It checks the
decoded subject, authenticated role, test issuer and expiration, and compares the
actual outgoing GET's bearer token, public API key and full path with that verified
session/reservation. Only boolean matches are printed, never token/claim values.
It makes ONE C GET, with no retries, alternate routes or cache bypass.

For the GET failure it reads a bounded 16 KiB clone of the error response without
consuming the SDK response. It prints only the actual HTTP status, allowlisted
wire `code`/`error`, bounded service `statusCode`, body-format category and a UUID
`sb-request-id` if available. Unknown strings, messages, metadata and raw bodies
are withheld. This preserves distinctions such as `InvalidRequest`, `InvalidKey`,
`InvalidJWT`, `NoSuchKey`, `S3Error`, `DatabaseError` and `InternalError` that the
old generic category could not expose. The SDK may retain numeric 404 while the
actual HTTP response is 400; both are reported separately.

Immediately after the GET, even on failure, a fresh READ ONLY SQL transaction
replays the Auth-verified JWT claims under `authenticated`. It checks C's UID,
reservation/evidence/assignment binding, pending status, verifier membership and
each read helper. It evaluates the **complete deployed USING expression**, with
parentheses preserved, of every applicable SELECT/ALL policy on a typed copy of
the exact owner-confirmed catalog row. Thus a false restrictive predicate is not
hidden merely because RLS filters out the row. It also tests actual RLS row
visibility and reports the effective permissive-OR / restrictive-AND result.
This is an owner diagnostic only: it serves no bytes, commits no data and is not
the Storage service's internal transaction. Arbitrary policy expressions/names
and JWT claims are never printed. B/anonymous HTTP no-byte controls run separately;
A byte readback runs only if C succeeds.

Interpretation: a path/token mismatch is reported directly; a false SQL predicate
identifies a reproducible authorization failure; `InvalidRequest`/`InvalidKey`
supports request validation failure. If C's caller/path match and SQL permits
the row while HTTP returns `NoSuchKey`/`not_found`, the cause is still **not proved**
to be missing backing bytes: use the captured UUID privately in hosted Storage
logs to distinguish the internal RLS context from backend object/version failure.
The shared not-found response alone cannot make that distinction. No privileged
Storage download or service-role workaround is used.

Regardless of the diagnostic result, the wrapper closes and independently checks
both gates before Dashboard object deletion, rechecks attribution and the original
baseline, and preserves the journal on unverified cleanup. Follow its exact
Dashboard instructions and `CLEANED` prompts. Require `cleanup=VERIFIED` in the
focused result; `C DOWNLOAD REPRODUCTION FAIL; cleanup=VERIFIED` is a captured
failure with successful cleanup, not permission to ignore the failure. The genuine
A → C → A browser workflow remains pending until the cause is established/fixed.

**Latest evidence checkpoint:** the owner reports upload HTTP 200 and exact
catalog path/owner/size/MIME confirmation, then evidence 3 fails on C's
`storage.download` with HTTP 400 / object-not-found-or-hidden. Both gate flags
closed afterward. Later assertions were NOT RUN. The historical test object may
already have been removed by guarded recovery; its continued existence must not
be assumed. Cleanup remains independent and unchanged.

Local source inspection rules out an intended **finalize-first** requirement:
`can_read_task_evidence` checks assignment access, not `submitted_at`, and neither
SELECT policy adds a submission-state predicate. The upload API must download
and verify exact stored bytes before signing finalization. Only the image-display
proxy/UI requires `submitted_at`, then repeats authentication/RLS, digest checking
and private/no-store delivery. Upload, catalog confirmation and download use the
same `verification-evidence` bucket and reserved path, and the same C client.
Moving finalization ahead of readback would skip required verification.

The live HTTP 400 alone does not prove a missing policy, wrong JWT, operation
context mismatch or missing backing bytes. Deployed definitions have **not** been
read by the agent. Current upstream Storage routes use the same authenticated
operation for `/object/:bucket/*` and `/object/authenticated/:bucket/*`; switching
URLs is not a supported fix for this evidence. See
[Storage route source](https://github.com/supabase/storage/blob/master/src/http/routes/object/getObject.ts).

The earlier read-only catalog-only diagnostic remains available:

```zsh
node /Users/macbookpro/Desktop/spotly/scripts/run-storage-security.mjs --inspect-evidence-access
```

It prompts only for the disposable Session pooler hostname and hidden database
password. It inventories every deployed Storage objects SELECT/ALL policy,
compares the expected two policy shapes and four read helpers with checked-in
source/EXECUTE grants, and reports extra or mismatching definitions without
printing arbitrary policy text or secrets. If the exact historical object and
reservation survive, it reports reservation/submission/membership/owner bindings
and simulates A/C/B/anonymous SQL visibility inside a read-only transaction with
transaction-local roles, claims and the supplied download operation. This is
**not** a real JWT or Storage HTTP test and cannot establish the operation/JWT
the hosted service used during the failed request. If cleanup removed the rows,
role checks are NOT RUN; no fixtures are recreated. Both gate flags are read
independently. It does not read/change the journal or clean anything up.

Until that evidence identifies a defect, no application behavior, RLS policy,
test order or deployed migration is changed. Added local regressions cover full
SDK session-header/path propagation with fake HTTP and upload-success/readback-
failure refusing finalization; the rollback SQL suite now checks pending C/A
readback with B/anonymous denial before submission. That SQL regression has not
been executed remotely. If deployed source/SQL checks match while a real C GET
still fails, inspect the failed request's actual hosted Storage operation,
verified JWT subject/role and backend error privately; a catalog row alone does
not prove backing bytes are retrievable. Never post tokens or raw logs.

**Setup diagnostic checkpoint:** the latest demo attempt passed local environment
validation and received manual authorization, then returned the old generic
`setup-or-connection` failure before any individual HTTP assertion. If the
supplied output is complete (no bucket-configuration result), execution stopped
in the first bucket inspection: connect, read-only BEGIN, bucket SELECT or result
validation. The discarded error cannot establish TLS versus database login versus
SQL failure. No setup defect or live root cause has been demonstrated locally.
The recovery journal is currently absent; absence alone does not verify gates.

Before another demo attempt, run this **read-only** command in Terminal:

```zsh
node /Users/macbookpro/Desktop/spotly/scripts/run-storage-security.mjs --inspect-setup
```

It prompts only for the disposable Session pooler hostname and hidden database
password, validates the existing fixed target/CA, checks bucket configuration and
the empty baseline, then independently reads **both** `enabled` and
`live_checks_verified` through a fresh read-only connection. It works without a
journal and never creates one, runs fixture SQL/HTTP tests, or changes a gate.
Require `enabled=CLOSED; live_checks_verified=CLOSED`; a failed connection, missing
singleton or invalid result is UNVERIFIED, never CLOSED. An open/unverified gate
is a stop condition, not permission to rerun the demo or delete/reset anything.

Failures now name the exact operation (for example `bucket.connect`,
`bucket.select-configuration`, `baseline.assert-scope_empty`, `journal.create`,
`fixture.statement-1-do`, or `fixture.commit`), fixed error category, allowlisted
SQLSTATE, bounded numeric HTTP status if available, and safe numeric PL/pgSQL
line if supplied by PostgreSQL. The fixture's single DO statement includes both
insertion and gate activation; a statement failure is not evidence of either
being committed. Commit acknowledgement is tracked separately; a lost COMMIT
response is UNKNOWN and requires recovery. Cleanup/disconnect errors cannot
replace the original bucket/baseline/fixture error. Logs report journal creation
versus current presence, acknowledged database commits, uncertain commit outcomes
and whether HTTP writes were possible. NONE_BY_THIS_RUN is not a claim about
previous runs. No raw driver error, credential, SQL context or secret is printed.

**Owner-confirmed cleanup checkpoint before this setup failure:** `RECOVERY CLEANUP PASS`. Both test gates were
closed, scope/key and Storage/application fixtures removed, original baseline
unchanged. The local recovery record is absent. Earlier blocker sections below
are historical. All three live SQL suites already passed; do not rerun them or
apply a migration for this follow-up.

The exact earlier `real-upload-and-known-object-privacy` cause is still unknown:
its catch discarded the failing suboperation/error. Source inspection and an
installed-SDK/mock-HTTP replay do not establish a live RLS, account or RPC bug.
The app's existing server route already uploads, reads back exact normalized
bytes and signs finalization; the authenticated evidence proxy verifies the
stored digest. Supabase's current standard download routes share the authenticated
operation ([server source](https://github.com/supabase/storage/blob/master/src/http/routes/object/getObject.ts));
no endpoint or policy workaround is justified by the old stage label.

The updated runner reports operations 1–10 separately: reserved C upload; exact
catalog object/owner/MIME/size/path; C byte download; A byte download; B denied;
anonymous denied; immutable overwrite denial; deletion denial and surviving
bytes; signed finalization/retry; A review/completion/retry. Step 2 is a fresh
read-only owner catalog check, **not an HTTP RLS pass**. Steps 3–6 exercise real
HTTP. Failures report safe operation, observed numeric HTTP status, allowlisted
SQLSTATE/category, error name/code and timeout classification. A dependent step
that was not executed is `NOT RUN`, never PASS. Raw bodies, credentials, tokens,
receipts/signatures and connection strings stay suppressed. Upload 200 alone
never yields a workflow or overall PASS. The exact failing live result is still
needed before changing deployed database/application behavior.

Before the manual run, prepare the private ignored `.env.isolated-browser` file
as described under **Restricted end-to-end browser rehearsal** below. It does not
currently exist locally. Demo mode validates it before credentials or remote
connections. Use the exact disposable public URL/key and ONLY the
public synthetic signing value from `isolated-storage-fixture.sql`; never copy
production settings. Keep A and C in separate browser profiles. Have one genuine,
non-sensitive JPEG/PNG/WebP under 8 MiB and a short observation ready. This file
setup and the genuine browser workflow remain manual.

The shortest combined test/rehearsal command is:

```sh
node /Users/macbookpro/Desktop/spotly/scripts/run-storage-security.mjs --demo
```

Enter the test pooler hostname, hidden database password, test publishable key
and dedicated A/B/C account passwords at prompts. Review and type the explicit
test-project activation acknowledgement. This authorizes only disposable
synthetic scope. The runner opens no browser scope until every HTTP/workflow
assertion has passed. It then journals and pins only request 003/plan 003 for
rehearsal. At the printed pause, start the **existing** test-only application
launcher in a second terminal (command in the browser section below).

In A's browser, open request 003 and assign C. In C's browser, accept it, upload
the genuine photo and observation, and submit. Refresh both profiles: A must
see finalized evidence, inspect the photograph, approve it, and complete the
assignment. Verify refresh persistence, B/anonymous isolation and the no-store
image proxy. Original request remains draft and budget remains $0; no SERV or
payment is involved. Finish within the fixture's 15-minute expiration. Stop the
local server and type `DONE` in the runner. It reads persisted assignment/evidence/
review/completion records independently; an incomplete rehearsal fails and still
closes both gates and cleans up. This database-state check does not establish
browser visual correctness or replace the manual observations.

New runs use a mode-0600, append-only version-2 recovery journal. Its first line
holds the immutable original baseline, run ID/start and fixed fixture IDs.
Subsequent lines append assignment IDs, exact evidence path intent **before
reservation/upload**, observed catalog identity and verified fixture inventories.
The header is never rewritten. Version-1 records remain supported and are never
silently upgraded. Torn/invalid records fail closed rather than resetting data.

The optional browser scope is journaled before activation. Recovery can then
attribute genuine photo/observation/review-note rows only through that exact
request 003, trusted synthetic plan, approved identities and canonical evidence
path. Verified browser object IDs/paths are recorded from a read-only census at
cleanup/recovery; they are not claimed to have been recorded before browser writes.
The previous fixed-dummy-observation recovery restriction was a runner limitation,
not a reason to reject genuine evidence in this explicitly scoped rehearsal.
No application RLS, budget, provenance, finalization or immutability rule changes.

A folder marker is recognized for **manual Dashboard deletion only** when its
exact assignment path and vanished original image bind to the new manifest and
catalog observation, the fixture chain matches, it has zero bytes, an empty/admin
owner, an allowed placeholder MIME, and a later creation time. Root markers,
unknown paths/owners, missing provenance or unrelated rows still stop recovery.
If Dashboard replaces a deleted image with a proved marker, the same run offers
one additional manual folder-removal prompt and then verifies the catalog again.
Unknown objects or a further unverified marker stop cleanup. No automatic Storage
deletion or direct SQL metadata deletion is introduced.
Keep the journal until independent complete baseline verification passes.
`--cleanup` only recovers; it never opens a gate or reruns HTTP tests.

Require all ten evidence summaries PASS, the remaining HTTP safeguards PASS,
independent gate/cleanup PASS and `OVERALL PASS`. Browser observations are
separate evidence; this manual run has not been executed by the agent.

## Confirmed versus pending

The owner reports that all five migrations and the live schema preflight passed
on the disposable project, and that the Node dispatcher suite returned PASS 1–6,
PASS fixture cleanup, PASS rollback and OVERALL PASS with verified TLS. This is
**owner-confirmed live evidence**, not a remote test repeated by this agent.

The owner now confirms **all three live suites passed**: `authorization.sql`,
`phase3b-authorization.sql` and `restricted-pilot-authorization.sql`, including
every transaction rollback and independent cleanup check, ending `OVERALL PASS`.
This supersedes the earlier partial Phase 3B failure. Gates are closed and scope/
test signing configuration were removed by verified cleanup. The agent did not
repeat these remote tests.

The latest owner-run real Storage HTTP attempt passed bucket configuration,
unauthorized upload denial, MIME rejection and 8 MiB rejection. The small PNG
upload returned HTTP 200, then `real-upload-and-known-object-privacy` failed.
Gate closure passed, but two cleanup/recovery attempts remain FAIL/UNVERIFIED,
including after typing `CLEANED`. Full HTTP testing and rehearsal are paused.
The earlier transport/cleanup results below are historical and superseded by
this cleanup blocker. The agent has not connected remotely.

### Current cleanup blocker

**Resolved historical checkpoint:** owner now confirms RECOVERY CLEANUP PASS; use the next-action section above.

The latest owner-run read-only report confirms: both gates closed, pilot scope
and synthetic key removed, SQL helpers absent, bucket/Auth/task_events baseline
unchanged. One Storage catalog object remains unattributed, and workspaces,
memberships, requests, plans, assignments, evidence and assignment events differ
from the empty baseline. These differences alone do not establish that the rows
are synthetic or safe to delete.

The immediate blocker is the remaining object: cleanup requires an empty evidence
bucket before deleting database fixtures. Object attribution can stop recovery
even before its deletion prompt. If cleanup reaches SQL with an object present,
the guard raises before any fixture DELETE and the transaction rolls back.
The reviewed dependency order is assignment_events → task_evidence →
task_assignments → task_events → plans → requests → memberships → workspaces.
There is no evidence yet of a permission, foreign-key or transaction defect.
Known SQL failures now report only an allowlisted SQLSTATE/category.

The local version-1 journal contains only project, version and baseline hashes;
it contains no fixture IDs, object paths or run timestamp. It cannot prove which
run created a random assignment/evidence ID. Its recorded baseline had empty
application tables and evidence catalog, so an object already cataloged before
that baseline would contradict it. Later unrelated activity is still possible.
No journal fields are backfilled or reset. The runner reserves its path once;
copy/move probes occur after the failed privacy stage, so those later probes do
not explain a path change in this reported failure. Live path drift is unproven.

Run this from Terminal (session pooler hostname, then hidden database-password
prompt; the existing fixed test CA and TLS hostname checks are reused):

```sh
node /Users/macbookpro/Desktop/spotly/scripts/run-storage-security.mjs --inspect-cleanup
```

This mode uses a new read-only repeatable-read database transaction. It reports
PASS/FAIL separately for both gates closed, Storage catalog empty, application
fixtures absent, pilot scope removed, signing-key fixture removed, SQL helpers,
bucket protections and each baseline table/Auth-ID/bucket fingerprint.

For each application table it reports `remaining`, `known_synthetic`,
`unattributed`, and the exact known fixture IDs. Those IDs match the versioned
fixture definition, **not an ID manifest in the legacy journal**. Checks bind
exact workspace names/IDs, membership roles and dedicated accounts, request
content/budget/status, exact plan IDs and synthetic provenance markers,
assignment relationships, evidence path/observation and event actors. Unknown
rows are counted without exposing their contents. Unexpected task_events are
not classified as synthetic because the direct Storage setup creates none.
Baseline differences are labeled fully explained only when all remaining rows
in that table match these synthetic checks against the recorded empty baseline.

For each object, `OBJECT 1 attribution` separately reports: UUID path format,
unique candidate reservation, exact reservation path, assignment prefix,
evidence suffix, complete synthetic fixture chain, matching uploader, MIME,
byte size and creation within the reservation/request window. Candidate matching
also checks the assignment prefix/evidence suffix to explain a changed path;
it never authorizes deletion of a nonmatching path. No metadata values, hashes,
Auth IDs, raw errors or unknown object names are printed. Only objects passing
**every** check receive a `SYNTHETIC OBJECT` path. Missing/ambiguous evidence,
metadata or timestamps remain a hard stop. Older-run versus current-run binding
cannot be recovered from the journal; the report does not invent it.

No HTTP tests, Auth calls, fixture writes, gate updates or journal mutations
occur in inspection, even on PASS. Exit is nonzero unless all cleanup conditions
and the original baseline match. Local database mocks validate control flow,
not execution of these queries on hosted PostgreSQL.

If `Storage catalog objects remaining` is positive, Dashboard deletion is not
complete at the catalog level. Open ONLY
[the disposable project's Storage Dashboard](https://supabase.com/dashboard/project/ogqmifuylakjhwveqrmd/storage/buckets),
verify the project ID, open **verification-evidence**, and navigate to the first
UUID folder of a printed `SYNTHETIC OBJECT` path. Select only the matching second
UUID object, choose Delete and confirm. Do not delete the bucket, other objects,
or anything whose attribution was refused. Refresh and rerun the same read-only
command to check the catalog again. Dashboard deletion uses the Storage service;
[SQL metadata deletion can orphan backing bytes](https://supabase.com/docs/guides/storage/management/delete-objects).
An empty catalog does not independently prove physical backing-byte removal.

After object deletion, repeat read-only inspection. Proceed with the existing
manual `--cleanup` mode only when the object count is zero, gates are closed,
scope/key are absent, and every table has `unattributed=0`. Keep the dedicated
Auth accounts until recovery passes; deleting them changes the baseline.
Recovery rechecks attribution in the same serializable fixture-deletion
transaction, deletes only the exact synthetic identifiers in dependency order,
and uses a fresh connection to verify the complete original baseline. The
journal is cleared only after that verification. If the process stops after a
commit, rerunning recovery safely checks the already-empty state.

If **any** row or object remains unattributed, stop: do not delete it, guess its
path, adjust the baseline, loosen policies or run another Storage test. No safe
object deletion is authorized by the current live report. If the updated report
still cannot prove attribution, the blocker requires further read-only review;
there is no automatic force-clean option. This historical recovery version refused browser-rehearsal data outside the dummy observation. Version 2 now permits only the explicitly journaled request-003 browser scope described above.

Recovery failures print their cleanup stage and attempt the same read-only
inspection on a fresh connection. No migration or security-policy change is
required. These are diagnostic and guarded-runner changes, not a live recovery
performed by the agent.

### Inspect the remaining object's catalog fields

Latest owner diagnostic: all application rows match the synthetic fixture with
zero unknown rows, but the sole object matches only the assignment prefix and
fixture chain. Its UUID/evidence path, uploader, MIME, size and creation window
checks fail. **No object deletion is authorized by that pattern.**

Supabase's maintainers document a Dashboard-created `.emptyFolderPlaceholder`
file, sometimes hidden from the file browser, after folder/file operations:
[maintainer explanation](https://github.com/supabase/supabase/issues/9155)
and [deletion reproduction](https://github.com/supabase/supabase/issues/26768).
This is a hypothesis here, not confirmed live identity. The test SDK upload and
native size probe use the same exact reserved UUID/UUID path, so a differently
named placeholder is not the path either probe intentionally sends. Copy/move
probes occur after the reported failing privacy stage and were not reached.

Run the new read-only catalog detail mode manually:

```sh
node /Users/macbookpro/Desktop/spotly/scripts/run-storage-security.mjs --inspect-storage-object
```

It uses the same fixed test project, verified CA/hostname and hidden password
prompt. It performs no HTTP calls, mutations, gate changes or journal updates.
The report includes catalog ID, actual name for supported UUID/image/placeholder
path shapes, owner_id and legacy owner UUID or NULL, actual metadata size/MIME
(and contentLength/contentType if present), object creation/update
time, and matched synthetic reservation ID/path/size/MIME/time/expiration. Raw
metadata and unsupported names/values remain withheld. If needed, use Dashboard's
**read-only** storage.objects view filtered by the printed catalog ID to review
an unsupported actual name privately; do not edit or delete that catalog row.
The version-1 journal cannot fill missing run/path/creation history.

- Exact assignment UUID + `/.emptyFolderPlaceholder`, zero bytes, a different or
  NULL owner and creation during manual Dashboard cleanup would fit a Dashboard
  marker. Confirm the timestamp against the owner's actual Dashboard operation
  and verify this is the sole object under the proved synthetic assignment.
  A name, zero size or NULL owner alone is insufficient.
- An exact reserved path with 8,388,609 bytes would fit an oversized artifact,
  but would require investigation of the reported rejection and bucket limit;
  neither a candidate label nor catalog presence proves which HTTP request wrote
  it. Do not weaken guards or mark the size/security test passed.
- Missing reservation linkage, conflicting owner/time, unexpected data or absent
  metadata leaves identity unresolved. Catalog data alone cannot prove whether
  physical backing bytes exist or are orphaned.

Only after attribution is established: open project `ogqmifuylakjhwveqrmd` →
Storage → verification-evidence. For a proved UUID/UUID image, select just that
exact image and Delete. For a proved marker hidden inside the sole synthetic
assignment folder, return to the bucket root, select only that assignment UUID
folder and use its Delete action; first confirm it contains only the proved
marker. Do not select other folders or delete the bucket. Refresh and repeat
read-only diagnosis. If the UI cannot remove it, creates a new marker, or the
catalog still contains any object, stop; do not substitute SQL metadata deletion.

If identity cannot be established, keep this project quarantined with gates
closed and the original journal intact. Continue read-only project-owner or
Supabase support review. Do not start another Storage test, use production,
ignore the object, or reset the baseline to unblock a demo. End-to-end photo
submission/review remains unverified until recovery and the real workflow pass.

Once the catalog is empty, all app rows are known synthetic, and gate/scope/key
checks pass, the existing **manual** guarded recovery command is:

```sh
node /Users/macbookpro/Desktop/spotly/scripts/run-storage-security.mjs --cleanup
```

It removes only verified synthetic application fixtures, preserves dedicated Auth
accounts, independently checks the complete original baseline, and only then
clears the journal. Require `RECOVERY CLEANUP PASS`; this is not an HTTP-workflow
PASS. No migration or policy change is part of this procedure.

### Oversized upload transport diagnosis

The previous size diagnostic proves Buffer construction completed but no HTTP
Response reached the guarded fetch callback. SDK response JSON parsing happens
after that callback, so ordinary response parsing after headers cannot explain
this particular `actual_http=UNAVAILABLE`. The installed SDK wraps fetch failures
as `StorageUnknownError.originalError`; native fetch can put a socket/TLS error
under `cause`. Both chains were previously suppressed. SDK setup before fetch,
transmission/reset, TLS and timeout remain possible; no specific live cause is
confirmed. Every guarded fetch previously had a 15-second deadline. That could
be too short for this upload, but the missing error/elapsed data does not prove
that a timeout occurred.

Supabase recommends [standard uploads for small files and resumable uploads above
6 MB](https://supabase.com/docs/guides/storage/uploads/standard-uploads) for better
reliability. This is guidance, not a 6 MB hard limit or proof of this failure.
Spotly intentionally denies alternate upload operations; do not enable TUS/S3 or
change policies to make this negative test pass.

The size assertion now uses test-only native `node:https`, **the same ordinary
POST endpoint, C session, publishable key, fresh reservation and `x-upsert:false`**.
Its target is hardcoded to the disposable project, TLS chain/hostname verification
remain enabled, and redirects are not followed. It constructs exactly 8,388,609
bytes and declares the matching Content-Length plus `image/png`. `Expect:
100-continue` lets a full size-error response arrive before body transmission;
if the peer requests the body, or sends no final response/continue within one
second, the full constructed body is queued. This is one bounded request, not a
retry loop or a header-only request with a fabricated length. It does not change
the application's SDK upload implementation or claim large SDK uploads passed.

The direct probe has a 90-second total deadline, consumes at most 16 KiB of
response data, and requires a complete HTTP 400/413 with a recognized size reason.
Network/TLS/reset/timeout, incomplete or unparsable responses, HTTP 417, nonspecific
413s and unexpected success remain failures. A complete, specific rejection may
be accepted even if the server closes the upload side early; an upload error
alone is never a rejection pass. The owner now reports that the size rejection passed on the disposable hosted
project; local mocks alone do not establish that result.

Safe `INFO transport` lines identify transport, failure phase, allowlisted error/
cause names, known code, timeout category, observed HTTP status, elapsed/deadline
milliseconds and whether the native body was queued. No raw message, stack,
cause object, URL, headers, token or response body is printed. Phase identifies
construction, connect/TLS, transmission/wait, response read or JSON parse; codes
such as `ECONNRESET`, `EPIPE` or known TLS errors distinguish those cases when
Node exposes them. An ambiguous phase/code remains explicitly unknown.

If the direct size probe has **no HTTP response**, the runner retains its FAIL
and separately attempts the small valid PNG SDK upload, byte readbacks, privacy,
immutability, finalization and review workflow on the same reservation without
overwrite. If an uncertain large request left an object, the small upload fails
rather than replacing it. A small-workflow PASS does not clear the boundary FAIL:
the command still returns nonzero and always closes/cleans the test gate. User
abort stops further test work. A specific wrong HTTP response still stops cases.

This independently tests C's ordinary SDK/RPC flow with a small image. The genuine
Next.js `/api/evidence` route additionally performs Sharp normalization, metadata
removal, stored-byte receipt signing and the private image proxy; that full
browser/server path still needs its own observed rehearsal. Do not mark it passed
from a Node SDK control. The optional browser demo remains gated on complete
HTTP suite success; production is excluded regardless of the small-image result.

### MIME/size failure: known facts and remaining uncertainty

The checked-in bucket migration requires private access, exactly **8,388,608
bytes (8 MiB)**, and only `image/jpeg`, `image/png`, `image/webp`. The successful
precheck/independent cleanup required that same configuration in the live database
catalog. The reported run therefore did not finish with a catalog configuration
mismatch. This does not reveal the HTTP response, any cached Storage settings,
or an upstream/global upload limit.

The MIME probe sends a 25-byte Buffer declared `text/plain`; the native size probe
constructs 8,388,609 synthetic bytes declared `image/png`. This second payload deliberately
tests the declared upload-size limit, not image decoding. A valid small PNG must
subsequently upload on that same fresh reservation, then download byte-for-byte;
generic denials alone can never produce an overall pass.

Expected MIME rejection is HTTP 400/415 with a specific MIME reason. Expected size
rejection is HTTP 400/413 with a specific size reason. Supabase documents both
modern and legacy [Storage error formats](https://supabase.com/docs/guides/storage/debugging/error-codes).
The installed SDK normalizes the actual HTTP status separately from the service
`statusCode`. The previous assertions missed valid legacy forms such as a
normalized message `invalid_mime_type`, or HTTP 400 with service status 413 and
`Payload too large` without `code`. Local replays through the installed SDK now
cover these forms. This is a confirmed expectation compatibility gap; it is
**not proof that either legacy form caused the historical live failure**.

The updated runner logs separate `mime-restriction` and `size-restriction` PASS/
FAIL lines with expected outcome, actual numeric HTTP status (or `UNAVAILABLE`
if no response), numeric service status, a fixed category and known probe MIME/
size. It never logs raw messages, response bodies, headers, arbitrary codes or
tokens. Generic 401/403, 409, 429, 5xx, network failures, and unexpected success
still fail. A bare 413 with no recognized size reason is no longer sufficient.

After explicit authorization and **before any fixture/journal write or gate
activation**, a new read-only query prints the observed nonsecret bucket
configuration. The independent cleanup precheck then requires closed gates,
empty scope/key and no application/evidence objects. A mismatch stops before
setup. If it reports drift, keep gates closed and review only the disposable
bucket in Dashboard: preserve private access, restore exactly 8,388,608 bytes and
the three image MIME types, and leave RLS unchanged. No remote configuration is
automatically corrected, no deployed migration is edited, and no new migration
is justified without evidence of a database implementation defect.

The earlier reported final cleanup PASS came from a fresh connection checking
both flags false, scope/key absent, all application tables empty, no evidence
objects, unchanged bucket settings and baseline hashes. The local recovery
journal was absent then; the current recovery record is present. This was
owner-reported live cleanup plus local code/file review, not an additional
remote inspection by the agent.

### Historical finalization failure diagnosis and correction

The old immutable-object block unconditionally expected direct SQL DELETE to
affect zero rows. That expectation is invalid on Storage versions installing
[`0055-prevent-direct-deletes.sql`](https://github.com/supabase/storage/blob/master/migrations/tenant/0055-prevent-direct-deletes.sql):
`protect_objects_delete` invokes `storage.protect_delete()` **before each DELETE
statement**, raising SQLSTATE `42501` before RLS can filter rows. This is a
confirmed test incompatibility and a plausible explanation for the reported
group failure, not proof that this exact statement failed on the test project.
The subsequent full live pass resolves the blocker; the original hidden error
cannot be reconstructed from its old output alone.

The fixture now accepts only zero affected rows or `insufficient_privilege`
(`42501`) for denied update/delete operations. Any changed row or other error
still fails. An owner-context assertion independently requires the exact object,
owner and original metadata to remain. The Storage guard is never disabled or
bypassed; no RLS, RPC or deployed migration is altered. **No new migration or
manual migration command is needed for this correction.** Do not redeploy any
existing migration before the rerun.

Finalization still calls the real `submit_task_evidence` RPC with a synthetic
signed receipt. New preconditions require exactly one receipt and the matching
reserved/catalog object; postconditions verify submitted state, timestamp/hash,
and a single submission event after retry. Zero fixture rows cannot silently
skip the RPC. These are SQL-only catalog fixtures, not uploaded photograph bytes
or proof of real HTTP Storage finalization.

If the rerun fails, its sanitized diagnostic identifies the source line,
statement number, step (for example `evidence_submit_first`,
`evidence_submit_retry` or `immutable_object_delete`), allowlisted SQLSTATE and
static category. Driver messages, SQL, parameters, constraint names, error
context and secrets are suppressed. Known evidence-RPC rejections have static
categories such as `EVIDENCE_BINDING_MISMATCH` or `STORAGE_OBJECT_REQUIRED`.
Do not change the database implementation speculatively; use that result to
distinguish an RPC/state bug, a fixture problem or another platform mismatch.

## Completed PostgreSQL suites — optional rerun after relevant changes

Use the same test Session pooler hostname and database password as the successful
dispatcher run. No installation, Homebrew, Docker or environment file is needed:

```zsh
node /Users/macbookpro/Desktop/spotly/scripts/run-security-authorization.mjs
```

The hostname prompt accepts only a Supabase Session pooler hostname, not a URL.
The password prompt is hidden. The qualified username is hardcoded to
`postgres.ogqmifuylakjhwveqrmd`; port is 5432. The existing Node connection/CA
loader uses `~/.config/spotly/spotly-security-test-ca.pem` with certificate-chain
and hostname verification. It never reads the production CLI link or `.env.local`.

This command reruns **all three complete SQL suites**, sequentially:

| Suite | What it checks |
| --- | --- |
| `authorization.sql` | Owner reads; budget/status immutability; forged/stale receipts; legacy plan rejection; private-key/direct-plan-write denial; valid synthetic signed persistence/acceptance; cross-user replay; cross-workspace/verifier/anonymous denial. No provider call. |
| `phase3b-authorization.sql` | Authorized assignment; request-workspace verifier approval; verifier self-assignment/review denial; cross-workspace privacy; invalid transitions; evidence reservation/receipt/review/revision/completion; expiry and membership revocation; SQL-only Storage policies. Exact pinned-plan cases independently remove acceptance or change provenance/fingerprint/generator, with positive controls before/after. |
| `restricted-pilot-authorization.sql` | Empty scope fails closed; private scope access denied; wrong request/accepted plan/verifier rejected; other dispatcher in the same workspace excluded; unrelated eligible workspace excluded; historical out-of-scope assignment/reservation/receipt/upload denied; test gate shutdown and anonymous predicate denial. |

The lexer preserves strings, comments, tagged dollar quotes and complete PL/pgSQL
blocks. Every statement is awaited and its command completion is checked. All
suite groups print PASS/FAIL/NOT RUN, followed by rollback and independent cleanup
results. Dependent SQL workflows stop after their first failure; later cases and
suites are not counted as passes. Every failure returns nonzero.

Expected successful output includes PASS for every case (including `evidence
finalization, idempotency and SQL-only immutable objects`), then for **each of the
three suites** `PASS ...: transaction rollback` and `PASS ...: independent cleanup,
gates closed, scope/key empty, baseline unchanged`, ending with `OVERALL PASS`.

Each suite uses one explicit transaction. Synthetic users, requests, plans,
receipts, helpers, signing configuration, test gates/scope and **catalog-only**
Storage objects roll back. A fresh read-only connection then requires: both flags
false; no pilot scope or signing key; no fixture/application rows; no evidence
bucket objects; no test helper functions; unchanged bucket settings and Auth-ID/
application-table hashes. Hashes and private data are never printed. Prechecks
refuse nonempty application state or existing private configuration; they never
erase or overwrite it. Dedicated Auth accounts may already exist and are preserved.

Require OVERALL PASS plus three independent cleanup passes before proceeding.
Do not rerun migrations or weaken RLS to fix an assertion failure. Record the safe
case label and expected/actual result, and investigate before continuing.

## Next manual action: real Auth and Storage HTTP checks

The SQL prerequisite is now owner-confirmed. Use only the existing disposable
project; do not create a paid service or run fixture SQL separately.

1. Open the [test project's Auth users](https://supabase.com/dashboard/project/ogqmifuylakjhwveqrmd/auth/users).
   Verify `ogqmifuylakjhwveqrmd` in the address bar before changing anything.
   Choose **Add user → Create new user** (not invitation or application signup).
   Create each account below with a different strong disposable password and
   **Auto Confirm User** enabled. These `.test` addresses do not receive mail;
   confirm them individually rather than disabling confirmation project-wide.
   If they already exist as dedicated test accounts, reuse them and their known
   passwords. Do not copy production identities or log into the Spotly UI yet.

   | Exact email | Runner role |
   | --- | --- |
   | `pilot-a@example.test` | Dispatcher A; owns the pinned synthetic request. |
   | `pilot-b@example.test` | Unassigned dispatcher B in another workspace; must be denied. |
   | `pilot-c@example.test` | Approved verifier C for A's pinned request. |

2. In this same test project's **Settings → API Keys** or **Connect** dialog,
   have the **publishable** key (`sb_publishable_…`) ready privately. Do not use
   a secret/service-role key. Have the same test Session pooler hostname,
   database password and CA file as the successful SQL run. The runner validates
   the target and TLS; no installation or `.env.local` change is needed. See
   [Supabase's key guide](https://supabase.com/docs/guides/getting-started/api-keys).
3. Leave the test application's tables and `verification-evidence` bucket
   empty, both database gate flags false, and private pilot scope/signing table
   empty. Creating Auth accounts alone is allowed. The runner refuses other
   application state; do not bypass the precheck or delete unexpected data.
4. In Terminal, run:

   ```zsh
   node /Users/macbookpro/Desktop/spotly/scripts/run-storage-security.mjs
   ```

Enter the test pooler hostname, then privately enter the database password,
publishable key, A password, B password and C password, in that order. Hidden
prompts show no characters when you type or paste; press Enter after each value.
No secret values go into command arguments, history, logs or the recovery file.
HTTP uses only the fixed test HTTPS origin with certificate/hostname verification
and actual user sessions; redirects and an insecure Node TLS environment are
refused. No service-role client or RLS alteration is used.

Before any database connection or fixture write, the runner explains its
temporary gate activation and asks you to explicitly authorize it. Only if you
intend to run this disposable test, type exactly:

```text
ENABLE STORAGE TEST ogqmifuylakjhwveqrmd
```

This is an interactive answer, not a shell command. Anything else cancels before
fixtures or gates are changed. Recovery never asks to activate a gate.

HTTP clients cannot see uncommitted SQL fixture rows, so this stage deliberately
commits **only synthetic disposable fixtures**. The existing fixture is labeled
`synthetic-fixture-not-SERV`, uses a publicly known test HMAC value, pins exactly
request 001/plan 001/A/C, and opens only the test database gate. Its request expires
after 15 minutes, limiting effective mutation eligibility if the process is killed.
This test activation is not a declaration that production checks passed.
The runner creates a genuine small PNG in memory with Sharp and uploads its
actual bytes as C through the real Storage HTTP API. You do not need to supply a
personal photo or any production image. No SERV request is made; synthetic task/
plan records are explicitly labeled and never copied to production.

The real Storage API cases include:

- B and anonymous ordinary uploads denied on C's fresh, valid reservation.
- Unsupported MIME and 8 MiB+1 payloads rejected for specific type/size reasons,
  followed by a successful small PNG upload on the same path. Generic 401/403,
  connection errors or 5xx are not type/size passes.
- A/C authorized downloads match uploaded bytes; B/anonymous/public known-object
  downloads fail.
- Signed-upload URL creation with both upsert values, signed downloads, ordinary
  overwrite/update, copy/move/list and application deletion restrictions. Original
  bytes must survive denied mutations. B, anonymous and C each attempt deletion;
  an HTTP error or zero affected objects is acceptable only if bytes survive.
- Actual account RPC isolation, assignment/acceptance, forged evidence-receipt
  denial, valid synthetic finalization/retry, C/B review denial and A review/
  completion. Original request budgets/status and accepted-plan fields stay unchanged.

Expected output includes these lines (the last two appear only after cleanup):

```text
PASS HTTP unauthorized upload denied on fresh reserved path
PASS HTTP MIME and 8 MiB size limits (specific rejection reasons)
PASS HTTP authorized upload and authorized byte-for-byte downloads
PASS HTTP known-object cross-workspace, anonymous and public downloads denied
PASS HTTP overwrites, update, copy, move and application deletion denied; original bytes survive
PASS: real dedicated-account RPC and small-image Storage workflow; synthetic disposable fixture only.
PASS test gate closure (independently verified)
PASS independent Storage catalog and fixture cleanup; both test gates closed; scope/key removed; baseline unchanged
OVERALL PASS
```

The run also prints `PASS read-only bucket configuration`, `PASS read-only cleanup
preflight`, and individual `PASS HTTP mime-restriction: ...` and `PASS HTTP
size-restriction: ...` diagnostic lines. The observed HTTP numbers may be 400
for legacy responses or 415/413 for modern responses; they are not hardcoded to
a presumed live result. If either probe fails, use its safe diagnostic line to
distinguish a specific limit rejection, authorization denial, unexpected success
or an unknown/network/server response before changing configuration.

Signed-upload/signing denials and the finalization/review checks are required
inside the reported groups. A failure prints `FAIL Storage test/setup [stage]`
with an allowlisted stage, then attempts cleanup and returns nonzero. A missing
size response may first produce the independent small-image control results;
its recorded boundary failure still forces the final failure. Network/
server errors cannot count as authorization denials; generic authorization errors
cannot count as MIME/size passes. Partial PASS lines are not `OVERALL PASS`.

### Cleanup is part of the HTTP result

In `finally`, even on an assertion failure, the wrapper closes **both test gate
flags** and verifies closure through a fresh owner connection. It then removes
only the expected synthetic pilot scope and known test key. Unexpected scope/key
contents stop cleanup after gate closure, rather than being overwritten.

Application users intentionally cannot delete immutable evidence objects. The
wrapper therefore prints only the synthetic object paths and pauses. Open the
[test project's Storage dashboard](https://supabase.com/dashboard/project/ogqmifuylakjhwveqrmd/storage/buckets),
open `verification-evidence`, open the printed assignment folder and delete
**only the printed synthetic objects**, confirming Dashboard deletion. Then type
`CLEANED` and press Enter in the waiting Terminal. Do not delete the bucket,
change policies or delete `storage.objects` with SQL. Supabase explicitly warns
that SQL metadata deletion leaves orphaned bytes; use the
[Dashboard/Storage API deletion workflow](https://supabase.com/docs/guides/storage/management/delete-objects).

The wrapper independently checks a previously authorized HTTP download becomes
not-found when a context is available, refuses fixture SQL deletion while ANY
evidence-bucket catalog object remains, deletes only the fixed synthetic rows,
and compares a fresh full baseline. Preexisting Auth accounts are retained.
Typing `CLEANED` alone cannot produce a cleanup pass.
Require both final PASS lines and `OVERALL PASS`. Auth users are intentionally
retained for rehearsal; after verified cleanup you may delete only these three
test users through the test Auth dashboard if you no longer need them. Do not
delete users or change unrelated data while the runner holds its baseline.

The ignored, mode-0600 `.spotly-security-storage.json` now uses the append-only version-2 manifest described above. Version-1 files held only baseline hashes. Neither format contains credentials, keys, tokens or receipts. A pending record prevents another setup.
If interrupted after setup, keep the record and recover manually:

```zsh
node /Users/macbookpro/Desktop/spotly/scripts/run-storage-security.mjs --cleanup
```

Recovery never opens a gate or runs HTTP tests. It closes/verifies the test gate,
finishes Dashboard object deletion and verifies fixture/baseline cleanup. It
reports cleanup separately, not a security-test pass. SIGINT/SIGTERM abort HTTP
work and enter cleanup; SIGKILL/network loss cannot guarantee immediate flag
restoration, so recovery remains mandatory. Expiration does not restore flags.
Failure to verify cleanup returns nonzero and keeps the recovery record.
Keep the recovery file until the runner removes it after verification; do not
delete it to get around a blocked rerun. If recovery cannot connect, both gate
flags may remain open despite request expiry. Restore connectivity and rerun
`--cleanup` before further testing. Never treat expiry as verified gate closure.

## Restricted end-to-end browser rehearsal — test project only

After the SQL and ordinary HTTP checks pass, the optional `--demo` mode reruns
the HTTP checks on fresh synthetic fixtures, closes the test gate while repinning
to untouched request 003/plan 003, reopens only that test scope, and pauses for
the browser checklist. Returning `DONE` closes the gate and performs the same
verified cleanup. It never retains a running pilot after a successful cleanup.

Prepare a private ignored `.env.isolated-browser` file containing only these
three fields: the exact test `NEXT_PUBLIC_SUPABASE_URL`, its
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SERV_PLAN_SIGNING_KEY` containing the
known synthetic value used in `isolated-storage-fixture.sql` (`cd` repeated 32
times). Never copy a production value. The launcher rejects another target or
signing value and explicitly disables SERV in its child environment.

### Create the private file in VS Code

1. In the project-root Explorer, copy `.env.isolated-browser.example`, paste it
   beside the original, and rename the copy **`.env.isolated-browser`** (no `.txt`).
2. Leave the URL and public synthetic `cd` signing value exactly as supplied.
   The URL targets only `ogqmifuylakjhwveqrmd`; the signing value comes from
   `repeat('cd',32)` in `supabase/tests/isolated-storage-fixture.sql`, **not** a
   Dashboard secret. The runner temporarily provisions that fixture itself.
3. In [the disposable project's API Keys settings](https://supabase.com/dashboard/project/ogqmifuylakjhwveqrmd/settings/api-keys),
   copy its **publishable** key (`sb_publishable_…`) and replace only
   `REPLACE_WITH_TEST_PROJECT_PUBLISHABLE_KEY`. Save. Never use a secret or
   service-role key, or copy anything from production `.env.local`.
4. In VS Code's Terminal, run the following local-only checks:

   ```zsh
   cd /Users/macbookpro/Desktop/spotly
   chmod 600 .env.isolated-browser
   git check-ignore -v .env.isolated-browser
   node --input-type=module -e 'import { preflightBrowserDemo } from "./scripts/run-storage-security.mjs"; preflightBrowserDemo(); console.log("Local browser configuration PASS; no remote operation started.")'
   ```

The private copy is ignored by `.env*`; only the placeholder example is excepted.
The launcher requires all three values from the private file before spawning
Next.js. Its explicit child environment takes precedence over Next.js dotenv
files, including `.env.local`; missing/invalid configuration fails closed.
It also forces `SERV_API_KEY` empty. It sets the local application workflow flag
itself; no fourth field is required and database gates remain runner-controlled.

Keep database/account passwords **out of this file**. For the runner prompts,
get the test Session pooler hostname from this same project's **Connect →
Session pooler** dialog; use its existing database password and the existing
dedicated `pilot-a@example.test`, `pilot-b@example.test`, and
`pilot-c@example.test` passwords. Account identities are in **Authentication →
Users**; passwords cannot be read back there. Do not reset or borrow production
credentials. The publishable-key prompt uses the same test key as the file.

Stop other local dev servers first. In one terminal run the HTTP wrapper with
`--demo`. At its rehearsal pause, use a second terminal:

```zsh
node /Users/macbookpro/Desktop/spotly/scripts/run-security-demo.mjs
```

This launches development bound to `127.0.0.1:3001`, with explicit test settings
overriding inherited exports and `.env.local`. Do not use `next start` with an old
build whose public project settings were frozen at build time. No tunnel/proxy.
The 15-minute synthetic expiration applies to the rehearsal too; if it expires,
finish cleanup and prepare a fresh run rather than editing an accepted request.

Use separate A/B/C browser profiles at `http://127.0.0.1:3001`:

| Action | Required result |
| --- | --- |
| A assigns synthetic request 003 | Only pinned C is eligible; no new SERV generation or payment. |
| C accepts and submits a non-sensitive photo/observation | Real server decode/re-encode strips metadata; upload/finalization persists after refresh. |
| B opens known request/plan/assignment/evidence IDs | No private data or image bytes. C cannot read other unassigned requests. |
| Evidence proxy | A/C receive normalized image bytes with private/no-store caching; B/anonymous receive no bytes. Record actual browser/API results. |
| C/B try review; A reviews then approves/completes | C/B deny; A succeeds; retries do not duplicate events; original request stays draft with zero budget. |
| Gate shutdown and verifier membership revocation | Still require explicit disposable-account tests; historical reads and new mutation eligibility must be reported separately. |
| Alternate Storage routes | TUS/S3, any previously issued valid signed-upload token replay and other enabled routes require separate disposition; dummy-token/network failures are not authorization passes. |

Stop the browser server, record results, return `DONE` to the wrapper and finish
Dashboard cleanup. Do not mark browser QA, alternate routes or production checks
passed from Node mocks, SQL results or the ordinary HTTP runner.

## What remains blocked

For the November 15 deadline, the shortest safe demonstration is the existing
disposable project with real Auth/Storage, a labeled synthetic task, and the
loopback browser rehearsal after HTTP PASS/cleanup. This exercises the real photo
route, authenticated evidence proxy and review UI without changing production or
making a SERV call. Browser results must be observed and recorded separately.

Before any later production-restricted activation, obtain separate owner
authorization and review the actual production schema/pilot restriction, roster,
signing diagnostic, existing genuinely accepted current/unexpired plan, pinned
request/plan/workspace/dispatcher/verifier, and closure/recovery procedure. Also
record dedicated-account browser isolation, no-store evidence proxy behavior,
gate-shutdown/membership-revocation behavior and disposition of enabled alternate
Storage routes (including old valid signed-upload token replay where applicable).
Disposable SQL/HTTP passes do not prove the production deployment matches them.
If the genuine request/plan is expired or ineligible, stop; do not extend it,
forge acceptance or generate a replacement plan under this authorization.

Production activation/deployment remains outside this request. Keep both
production database flags and its application workflow gate disabled. No new
migration, production activation command, SERV planning or payment is part of
this handoff. The remaining immediate prerequisites are dedicated test accounts,
the test publishable key and manual Dashboard cleanup; there is no psql/Homebrew/
Docker requirement.
