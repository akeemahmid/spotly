# Security evidence record — reported November 14, 2026

> November 18 release status supersedes historical checkpoints and deployment/activation commands below. See [current status](product-release-status.md). Production writes and gate activation are not authorized.

Target: disposable project `ogqmifuylakjhwveqrmd` only. Production is excluded.
Never put credentials, tokens, signing keys, receipts, raw errors or connection
strings in this record.

| Check | Evidence/status |
| --- | --- |
| Five migrations, schema/RLS/function/private bucket preflight | Owner-confirmed live pass. Both gate flags false; pilot scope and signing table empty at that preflight. |
| Dispatcher workspace SQL authorization | Owner-confirmed live PASS 1–6, PASS fixture cleanup, PASS rollback, OVERALL PASS; verified TLS. Agent did not repeat remotely. |
| Plan provenance SQL authorization (`authorization.sql`) | Owner-confirmed live all PASS, transaction rollback PASS, independent cleanup PASS. |
| Phase 3B SQL authorization (`phase3b-authorization.sql`) | Owner-confirmed live all PASS after fixture correction, transaction rollback PASS, independent cleanup PASS. Supersedes earlier partial failure. |
| Restricted pilot SQL authorization (`restricted-pilot-authorization.sql`) | Owner-confirmed live all PASS, transaction rollback PASS, independent cleanup PASS. |
| Combined live SQL runner | Owner-confirmed OVERALL PASS. Cleanup confirms both flags closed, empty scope/test signing table and no synthetic fixtures. Agent did not repeat remotely. |
| Ordinary Auth/Storage HTTP | Latest owner-run partial result: bucket preflight, unauthorized-upload denial, MIME and 8 MiB rejection PASS; small PNG upload HTTP 200; failure at real-upload-and-known-object-privacy. Remaining assertions unverified; OVERALL FAIL. |
| Failed HTTP run cleanup | Latest owner confirms RECOVERY CLEANUP PASS: both gates closed, scope/temp key and Storage/application fixtures removed, original baseline unchanged. The earlier Dashboard marker blocker is resolved. Agent did not repeat remotely. |
| Browser upload route, proxy, review/completion | Prepared checklist and test-only launcher; actual observations pending. |
| Alternate routes, valid old signed-upload token replay, membership revocation and gate shutdown over HTTP | Manual disposition pending; SQL and mocks do not establish these. |
| Production gates/deployment | Must remain disabled/unchanged. No connection or operation by the agent in this request. |

Local tests use mocked database/SDK/HTTP transports and synthetic image bytes.
They check control flow, refusal conditions, result accounting, secret suppression,
failure rollback, cleanup/gate ordering, and recovery. They are not live RLS,
Storage service, account or browser evidence. No remote tests were executed by
the agent while preparing the next manual run.

For each later manual run, record its date, suite/case PASS/FAIL/NOT RUN lines,
independent cleanup and gate state, and any blocker. Keep the restricted demo
closed unless its prerequisites actually pass. See [the run guide](restricted-pilot-demo.md).

## Files prepared in this change

- New Node utilities/runners: `scripts/security-test-db.mjs`,
  `scripts/run-security-authorization.mjs`, `scripts/run-storage-security.mjs`,
  `scripts/run-security-demo.mjs`.
- Updated existing runners: `scripts/run-dispatcher-authorization.mjs` (optional
  hidden prompt label only), `scripts/isolated-storage-check.mjs`.
- Tests: new `scripts/security-authorization.test.mjs` and
  `scripts/storage-security.test.mjs`; updated `scripts/isolated-storage-check.test.mjs`.
- SQL: labeled `supabase/tests/authorization.sql`, expanded/labeled
  `phase3b-authorization.sql`, labeled `restricted-pilot-authorization.sql`,
  guarded/short-lived `isolated-storage-fixture.sql`, new `isolated-storage-cleanup.sql`.
- Documentation: `README.md`, `docs/dispatcher-authorization-run.md`,
  `docs/restricted-pilot-demo.md`, this results record; `.gitignore` excludes the
  nonsecret Storage recovery journal.

Previous local validation: 117 Node tests, ESLint, standalone TypeScript and the
production webpack build passed after the SQL fixture/diagnostic correction.
These are local results only; the live SQL results above are separately reported
by the owner. Real Storage HTTP and browser results are still pending.

## November 14 Storage handoff

The wrapper now requires the explicit project-specific interactive answer
`ENABLE STORAGE TEST ogqmifuylakjhwveqrmd` before any connection, fixture commit or
gate activation. Recovery only closes gates and cleans up; it never requests
activation or starts HTTP tests. Local regression tests reject wrong-project,
empty/cancelled and generic confirmation answers before any database call.

Real HTTP deletion probes cover B, unauthenticated callers and C; all must leave
the original bytes intact. Failures identify only an allowlisted stage, never
raw SDK messages or secret values. No migration/RLS change is needed. Follow the
[exact account setup, command and cleanup procedure](restricted-pilot-demo.md#next-manual-action-real-auth-and-storage-http-checks).

Previous handoff validation: **121 local Node tests PASS**, ESLint PASS,
standalone TypeScript PASS and production webpack build PASS. Database/Storage
transports in these automated tests are mocked; Sharp image generation and
processing execute locally. No real HTTP pass is inferred and no remote write
was performed by the agent.

Validation for this follow-up: **132 local Node tests PASS**, ESLint PASS,
standalone TypeScript PASS and production webpack build PASS. SDK normalization
tests use the installed client and mocked HTTP responses; all database/HTTP
operations remain local mocks. No live MIME/size or complete HTTP pass is inferred.

## MIME/size diagnosis follow-up

No live cause is asserted from the combined stage label. Migration and the
reported pre/post snapshot contract require a private bucket with 8,388,608-byte
limit and exactly JPEG/PNG/WebP. The runner sends `text/plain`/25 bytes and
`image/png`/8,388,609 bytes. Local SDK replays confirm a legacy-response
expectation gap (`invalid_mime_type`, HTTP 400/service 413 `Payload too large`
without `code`); these are now recognized without accepting generic denials.
Actual historic response remains unknown.

New read-only bucket configuration diagnostics precede setup; a mismatch refuses
fixture/gate writes. Each limit probe prints its expected rejection, actual
HTTP/service status and allowlisted category. HTTP success, authorization errors,
conflicts, network/server errors and bare nonspecific 413s cannot count as passes.
No migration, remote bucket correction, production operation or live HTTP rerun
was performed by the agent.

## Historical oversized transport follow-up

The earlier diagnostic narrowed the then-reported live failure to before fetch delivered any
HTTP response. Buffer construction completed; exact setup/fetch/TLS/reset/timeout
cause remains unknown. The old 15-second fetch deadline is a possible cause,
not a confirmed diagnosis. The SDK's `originalError` and native `cause` chains
are now reduced to fixed safe error names/codes/timeout categories.

The size assertion now makes one target-locked native HTTPS POST with the same
C session, reservation and policies, exact 8 MiB+1 body/Content-Length,
`Expect: 100-continue`, a 90-second deadline and bounded response parsing. It
requires a complete specific size rejection; no transport failure passes.
The subsequent owner run confirmed size rejection on the disposable hosted project. Application
upload code, bucket settings, RLS and deployed migrations are untouched.

A missing size response now permits separately reported small-image SDK/RPC
workflow checks, while retaining a failed security result, nonzero exit and
automatic gate closure/cleanup. Browser/server upload/proxy QA is still separate;
the rehearsal gate does not open from a partial pass. See the updated run guide.

Transport follow-up validation: **145 local Node tests PASS**, ESLint PASS,
standalone TypeScript PASS and production webpack build PASS. Tests cover native
early rejection/100 Continue, complete response plus upload-side EPIPE, reset,
TLS error, deadline, abort, malformed/incomplete responses, strict body length,
and separate small-workflow results that still preserve a failed boundary result.
SDK/native HTTPS/database transports are mocked; no remote test was run.

## Cleanup blocker follow-up

Supersedes the earlier transport failure and successful-cleanup checkpoint. The
new manual read-only inspection reports objects, fixtures, scope/key, both gate
flags closed, bucket protections and per-component baseline equality separately.
It retains the recovery journal even on PASS. Unknown object paths and all hash/
credential values remain suppressed. Existing recovery now names its failing
cleanup stage and attempts independent read-only diagnosis after failure.

The precise remote condition and Dashboard deletion status remain unknown until
the owner runs inspection. Gate-closure PASS alone is insufficient. Full HTTP
tests are paused; no remote writes, gate activation, migration or policy change
were performed by the agent. See [the next manual inspection and safe object
deletion procedure](restricted-pilot-demo.md#current-cleanup-blocker).

Cleanup follow-up validation: **166 local Node tests PASS**, ESLint PASS,
standalone TypeScript PASS and production webpack build PASS. The new tests
independently vary every cleanup condition and baseline component, enforce
read-only queries and journal retention, reject invalid/project-mismatched
records, and verify unknown object names/raw errors are suppressed. Database
and HTTP transports remain mocked; no live cleanup result is inferred.

## Object-attribution recovery follow-up

The owner now confirms one unattributed catalog object and remaining app rows.
The Storage-empty guard prevents fixture deletion until the object is removed;
no permission/FK defect or object identity is proven by this report. The journal
contains no fixture-ID/path/time manifest, so IDs cannot honestly be reported as
run-bound. The runner does not backfill or overwrite that original baseline.

The inspector now reports table totals, known/unknown counts and known fixture
IDs, explains baseline differences only where all remaining rows are known,
and reports separate reservation/path/identity/metadata/time checks per object.
Recovery shares this stricter attribution and rechecks rows inside the
serializable deletion transaction. Any unattributed row/object blocks deletion.
No migration or remote action was performed. Local tests remain mocked database
and HTTP tests; hosted query execution and recovery still require manual action.

Attribution follow-up validation: **182 local Node tests PASS**, ESLint PASS,
standalone TypeScript PASS and production webpack build PASS. Regressions cover
every missing object-attribution check, per-table known/unknown counts, explained
versus unexplained baseline differences, safe SQLSTATE categories, unknown-row/
object refusal before deletion prompts and attribution changes before deletion.
The original local recovery record remains present and valid. No remote cleanup
or Storage test was run; these checks do not prove live object attribution.

## Single-object catalog follow-up

Owner confirms zero unattributed application rows. The remaining object matches
assignment prefix and synthetic chain but fails UUID/reservation/evidence suffix,
uploader, MIME, bytes and creation-window checks. Its identity is still unproved.
A Dashboard folder marker is plausible based on documented Supabase behavior,
not confirmed from those booleans. Both upload probes target the reserved path;
no code intentionally writes a marker. No new deletion allowance was introduced.

New `--inspect-storage-object` mode displays bounded catalog/reservation details
locally: supported actual names, owner UUID/NULL, metadata size/MIME and timestamps.
Arbitrary metadata, tokens, URLs and unsupported names are withheld. Classifications
are hypotheses, never deletion approval. The journal remains unchanged, and
unknown objects still block recovery. See the guide for conditional Dashboard
removal, guarded recovery and the stop condition when identity cannot be proved.

Catalog follow-up validation: **187 local Node tests PASS**, ESLint PASS,
standalone TypeScript PASS and production webpack build PASS. Targeted tests
also passed after the final field additions. Tests cover opt-in read-only
details, exact marker path/zero-size/null-owner/timestamp reporting, unknown
name/token/metadata suppression and continued refusal to authorize marker
deletion. Database/HTTP transports remain mocked; the actual object type is
unconfirmed. The journal content hash is unchanged locally. No remote operation,
gate activation, migration or security-policy change was performed.

## Evidence workflow follow-up after successful recovery

Owner confirms RECOVERY CLEANUP PASS; all earlier cleanup-blocker notes are
historical. All SQL suites remain owner-confirmed live PASS. The original HTTP
privacy failure's precise cause remains unknown; no application/database policy
change is justified from the combined old stage label. No new migration added.

The runner now prints ten per-operation outcomes and safe HTTP/SQLSTATE/category/
suboperation diagnostics, plus NOT RUN for unexecuted dependent work. Exact-object
confirmation is a fresh read-only catalog check; downloads and denials remain
HTTP assertions. Installed-SDK upload/Blob download is replayed with mocked HTTP;
that local check does not establish hosted authorization. App evidence routes
and database policies remain unchanged.

New version-2 manifests append IDs, paths and catalog provenance while preserving
the immutable baseline/header. Version 1 is supported without backfilling. Known
folder markers require manifest/canonical assignment/catalog/zero-size/admin-owner/
MIME/time checks and remain manual Dashboard deletions; unknown objects are never
automatically removed. The exact journaled request-003 browser scope also permits
recovery of genuine photo/observation/review notes through verified synthetic
relationships. It introduces no application permission or automatic promotion.

Next manual path is HTTP then scoped browser rehearsal using the existing app.
The private ignored `.env.isolated-browser` file is absent and must be prepared
before rehearsal. Genuine browser submission/proxy/review/completion observations
are pending. No remote test, gate activation, deployment or paid call was performed.

The combined demo mode also performs a local private-config preflight before
credentials/connections. After DONE it reads completed assignment, finalized
evidence, matching Storage metadata and A/C assignment/accept/submission/review/
completion events through a fresh read-only owner connection. Missing completion
fails the rehearsal while preserving automatic gate closure/cleanup. This is
persisted database-state evidence only; real browser observations remain manual.
The same run offers one bounded manual removal prompt for a proved Dashboard
marker and never automatically deletes Storage objects or metadata.

Validation for this change: **203 local Node tests PASS**, ESLint PASS,
standalone TypeScript PASS and production webpack build PASS. Regressions cover
all ten operation results, catalog mismatch, C download failure, A byte mismatch,
finalization SQLSTATE, stale HTTP status after transport failure, append-only
baseline preservation, exact object/catalog identity, scoped browser recovery,
manual marker removal, missing local demo config and DONE without completion.
Database/HTTP transports are mocked; the installed SDK and Sharp run locally.
No live HTTP/privacy/browser PASS is inferred. Production was not modified.

Exact files changed in the evidence-workflow follow-up:

- `scripts/isolated-storage-check.mjs`
- `scripts/run-storage-security.mjs`
- `scripts/storage-fixture-attribution.mjs`
- `scripts/storage-cleanup-diagnostics.mjs`
- `scripts/evidence-operation-report.mjs` (new)
- `scripts/storage-recovery-record.mjs` (new)
- `scripts/storage-security.test.mjs`
- `scripts/storage-recovery-record.test.mjs` (new)
- `scripts/evidence-sdk.test.mjs` (new)
- `README.md`
- `docs/restricted-pilot-demo.md`
- `docs/security-test-results.md`
