# Product recovery and release checkpoint · November 18, 2026

Current functional readiness and the exact browser checklist are recorded in [core workflow acceptance](core-workflow-acceptance.md), following [the first complete workflow audit](first-complete-workflow-audit.md). The owner has submitted the Storage support request. Product work continues independently; historical cleanup notes and the remote-ref observation below are not a fresh state inspection. The earlier audit confirmed remote `main` matched local base `3a0c63f` and recorded the application fixes without committing or pushing. No genuine end-to-end workflow is claimed.

This checkpoint supersedes older status, deployment and pilot-activation instructions. No production writes, gate activation, migration, new SERV generation, photographic submission or payment was performed during this request.

## Cleanup

The owner reports the evidence catalog is empty, both disposable gates are closed, temporary scope/key are removed and all remaining application rows match known synthetic fixtures. Database fixture deletion did not finish. The local version-2 recovery journal and its original baseline remain unchanged and excluded from Git.

The prior `gate-closure-or-scope-key-removal` label combined gate transaction, independent verification/connection release and guarded scope/key transaction. `cleanupErrorCategory` also collapsed local assertion and network failures into `CHECK_OR_CONNECTION_ERROR`. That output cannot establish the historic exception. A lost COMMIT response can leave changes applied while the runner correctly marks the commit uncertain; later safe-state inspection does not prove that the earlier runner completed fixture deletion.

A confirmed control-flow defect was reproduced with local mocks: `client.end()` in a `finally` could replace the original gate-verification error. Connection release now reports its own safe warning without replacing the original query/assertion result. Cleanup reports the precise connection/query/validation/commit suboperation and allowlisted network/TLS/SQL category. Commit uncertainty is reported before independent inspection. No automatic write retry or inferred success was introduced. A known-safe later snapshot never hides an earlier failure.

Successful recovery retains the journal instead of unlinking it. The empty-Storage, exact-scope/key and known-fixture guards remain; attribution is repeated in the deletion transaction, and a new connection compares every original baseline component afterwards. Unattributed rows/objects stop recovery. Storage metadata is never deleted through SQL.

**Owner-run recovery, not executed automatically:**

```sh
cd /Users/macbookpro/Desktop/spotly
node scripts/run-storage-security.mjs --cleanup
node scripts/run-storage-security.mjs --inspect-cleanup
```

The runner prompts for the fixed disposable Session pooler and hidden password, uses the existing verified CA and fixed project identity, and never asks for A/B/C credentials in cleanup mode. Require `RECOVERY CLEANUP PASS` and then `CLEANUP VERIFICATION PASS`; retain the original record on any failure. If objects reappear, only the runner's verified paths may be removed manually through the test Storage Dashboard. Never replace the baseline. After independent verification, privately archive the journal outside the repository before another fixture run; it is deliberately not auto-removed.

## Storage and live workflow

Owner-supplied failed GET correlation data is in ignored local `.spotly-security-download-query.sql` (mode 0600); its approximate time comes from UUIDv7 and is not log-verified. Use it only in the disposable project's Logs Explorer. No browser session is connected, the installed CLI exposes no hosted-log command, and the available Supabase integration is not yet installed/connected. Therefore no private hosted log correlation has been completed. Installing/connecting Supabase can unblock that read-only investigation.

The application and installed SDK use the expected authenticated request. Independent SQL permits C, but the service returns HTTP 400 / NoSuchKey / not_found. Root cause remains unconfirmed. [The diagnostic record](storage-download-support.md) documents the existing request and technical questions. The owner confirms the support ticket has been submitted. No workaround, policy relaxation, bucket change, privileged application client or extra fixture upload was added.

The implemented A request → genuine signed SERV plan → acceptance → approved C assignment → C acceptance → normalized photo/observation → A review → assignment completion workflow is **not verified live end to end**. The existing genuine plan must be reused. The security runner's synthetic plan/image is a test fixture, never a genuine provider response or field observation. Both gates must remain closed until required signing, dedicated-account, Storage and browser checks pass. With the current production-write prohibition, the existing production-bound plan cannot be executed by this request.

Next concrete task: correlate the existing failed Storage request and establish the failing service branch, while the owner completes guarded fixture recovery. Fix only a demonstrated defect or obtain Supabase's remediation. Then run narrowly scoped disposable byte-readback/security checks, followed by the genuine account/photo/review workflow only on an explicitly authorized target with prerequisites satisfied. Do not regenerate the accepted plan to evade project or expiration restrictions.

## Local validation and release audit

- `npm test`: **238 tests passed**, zero failures/skips. Six additional cleanup regressions cover preserved primary errors, release-only errors, exact cleanup stages, uncertain commit and repeatable recovery/journal retention.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npx next build --webpack`: passed. The first sandboxed attempt could not resolve Google Fonts; the same command passed with network access, without changing font or build configuration.
- Database/Storage/provider transports in Node tests are mocked. Sharp, crypto, TypeScript and the installed SDK run locally. No disposable/live SQL, real Storage API or browser/account/mobile workflow was rerun. Prior owner-reported SQL results remain separately attributed.
- Release review covers tracked changes and every nonignored untracked file. The secret audit examines release candidates, staged blobs, all reachable local-history blobs and browser build assets. It checks configured private environment literals plus private-key, provider-token, JWT and credential-URL patterns and prohibited file paths. Explicit malformed/synthetic test strings are reviewed separately; no real credential finding remains. This is a scoped source/artifact audit, not a guarantee against every possible secret format or old dangling Git object.
- `.env.local`, recovery journal/query and Supabase `.temp` metadata are ignored and excluded. Only sanitized `.env.example` and `.env.isolated-browser.example` are release candidates. The latter's repeated `cd` value is a public synthetic fixture, never a real signing key.
- Administrator SQL templates and the historical pilot guide no longer contain hard-coded personal account emails or real request/plan/workspace IDs. Replace placeholders only in private reviewed copies; checked-in activation remains disabled. Production activation is not authorized.

Existing repository: `https://github.com/akeemahmid/spotly.git`; current branch `main`. The local branch initially contained only the Create Next App commit while the product work was uncommitted. Remote discovery returned no advertised refs. Publish only `main` with a normal push after staged audit; never push internal checkpoint refs, force-push, recreate the repository or rewrite history. The final chat report records the actual commit and push result.
