# Spotly

**Know what's happening, anywhere.** Spotly lets a logistics dispatcher request fresh information about a physical location, review a genuine SERV observation plan, assign an approved verifier, and review a photograph and observation before completing the assignment. A plan is an instruction, not evidence or a road-safety certification.

This is the existing Next.js product, continued after SERV Hackathon 02. The Phase 3B workflow is implemented, but **the full live workflow is not verified and execution must remain gated**. Payments are future work.

## Current status · November 18, 2026

| Capability | Evidence and limit |
| --- | --- |
| Authentication, requests, signed plans, assignments, photo processing, review and completion | Implemented; local mocked tests cover success and denial paths. |
| Existing genuine SERV plan | Owner reports generation and acceptance. Reuse it; no new paid call or regeneration is authorized. |
| Disposable SQL authorization suites | Previously reported passing by the owner; not rerun during this release. SQL role tests do not establish Storage service behavior. |
| Disposable C upload | Owner reports a successful real PNG upload and matching Storage catalog entry. |
| Private C download | Blocked: HTTP 400, wire `NoSuchKey` / `not_found`, although independently replayed SQL permits reading. Root cause unconfirmed. |
| Cleanup | Owner reports zero catalog objects, closed test gates and removed temporary scope/key. Synthetic application rows remain. Guarded recovery is pending. |
| Genuine photo → review → completion, browser/account/cross-device and mobile QA | Not verified end to end. Keep both server and database gates closed. |

See [recovery and release checkpoint](docs/product-release-status.md) and [the decisive Storage diagnostic/support report](docs/storage-download-support.md). Older dated checkpoints in other guides are historical and do not override this status.

## Installation and configuration

Use Node.js 20.9 or newer and npm:

```sh
npm ci
cp .env.example .env.local
npm run dev -- --webpack --hostname 127.0.0.1
```

Edit `.env.local` privately before starting development:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Intended project's public HTTPS URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public publishable key; never a secret/service-role credential. |
| `SERV_API_KEY` | Server-only genuine SERV credentials, needed only for authorized local planning. |
| `SERV_MODEL` | Planning model; default `gpt-5.4-mini`. |
| `SERV_PLAN_SIGNING_KEY` | Server-only 32-byte hex HMAC key matching the private database key. Never commit it. |
| `PHASE3B_ENABLED` | Server execution gate; leave `false` until all required live checks pass. |

The private database gate also requires `enabled`, `live_checks_verified`, a signing key and the restricted request/plan/dispatcher/verifier scope. Browser controls cannot authorize execution. The application uses public project credentials and verified cookie sessions, with no service-role client.

Review and apply the five versioned files in `supabase/migrations/` **manually, in filename order, only to the intended reviewed project**. They provide requests, signed-plan provenance, private assignments/evidence, dispatcher-workspace selection and restricted pilot authorization. Installation/build never applies migrations. Do not blindly apply them to an existing project; inspect deployment first. Production project `onfdusisfidlfdmluwxl` is excluded from the present recovery and tests; disposable project `ogqmifuylakjhwveqrmd` is the only security-test target.

Enable email authentication and confirmation. For local development configure the Auth Site URL as `http://127.0.0.1:3000` and allow `http://127.0.0.1:3000/auth/callback`. Use the confirmation URL template supporting the PKCE callback. SMTP/rate limits, additional workspace roles and verifier approval require administrator configuration. Never self-grant roles or copy credentials into chat. See [signing setup](docs/serv-signing-provisioning.md) and [workflow prerequisites](docs/phase3b-workflow.md).

## Architecture

The existing App Router, root `app/`, TypeScript, Tailwind, npm lockfile and `@/*` alias are preserved. `/` is public; `/dispatcher` and `/dispatcher/verifications/{new,[id]}` are the dispatcher workspace; `/verifier/tasks` and `/verifier/tasks/[id]` hold private field assignments. Cookie-dependent rendering and runtime route parameters use Suspense. User data is never publicly cached.

`lib/use-verifications.ts` is the single external store. Supabase activity stays separate from immutable illustrative samples and legacy browser drafts. Explicit import preserves original browser storage and IDs, reports errors/duplicates and marks imported plans `legacy_untrusted`. Failed writes retain forms and do not navigate as if successful.

Server operations verify claims independently and call narrow database RPCs. RLS and minimal grants enforce membership, creator ownership and assigned-verifier visibility. Original requests and approved maximum USD budgets remain immutable drafts; field progress and completion live in separate assignments, evidence and event tables. A draft does not count as active/completed work or spending. USD values reject fractional cents.

### Genuine SERV integration

`lib/serv/client.ts` calls `https://inference-api.openserv.ai/v1/chat/completions` with server credentials, strict bounded output validation and no simulated fallback. The server signs only the actual validated provider output, including request fingerprint, creator, version and provider metadata. The database verifies the HMAC before persistence. Acceptance selects the stored trusted plan and rechecks ownership, membership, fingerprint and expiration under a request lock. An accepted plan never changes a budget or authorizes payment.

Paid planning is disabled in production and limited to same-origin loopback development with verified identity, ownership, payload limits, concurrency and per-user cooldown. Missing signing configuration fails before generation. Persistence failure after provider success may consume credits without saving a plan; the form reports failure. Durable quotas and multi-instance controls are required before public planning. **Do not regenerate the existing plan during this task.**

### Request → assignment → evidence → review

1. Dispatcher A creates a location-specific request, evidence requirements, future expiration and explicit maximum USD budget.
2. A reviews and accepts a genuine signed SERV plan. For the existing request, reload its accepted plan without another provider call.
3. After required live checks and separate gate authorization, A assigns administrator-approved Verifier C.
4. C accepts the task. Only assigned request/plan data becomes visible to C.
5. C provides a genuine single JPEG/PNG/WebP photo (up to 8 MiB) and observation. The server decodes/re-encodes the image with Sharp, removes metadata, uploads without overwrite, reads back and hashes the actual stored bytes, then signs finalization with a separate evidence purpose.
6. A reviews submitted evidence, requests a revision or approves the current submission, then completes the assignment. Expiration blocks new transitions, including reviews; declined assignments are terminal.

The evidence bucket stays private and immutable to application users. Only finalized evidence is displayed through the authenticated, no-store proxy with another integrity check. Reservations/uploads alone are not submissions. Readback failure blocks finalization; it must not be bypassed. Video and reassignment are outside this phase.

## Testing and recovery

```sh
npm test
npm run lint
npx tsc --noEmit
npx next build --webpack
```

Node tests use the existing TypeScript compiler, Node test runner, mocked database/HTTP/provider transports, the installed SDK and local Sharp. They do not call paid SERV, create real field evidence or prove live RLS/Storage/browser behavior. Typecheck and build run separately because Next generates types. Webpack is the established fallback for this environment's Turbopack CSS-worker port restriction. Cold builds require Google Fonts access for the self-hosted Montserrat assets.

Run rollback SQL suites and real dedicated-account Storage tests only on a disposable migrated database. [The security guide](docs/restricted-pilot-demo.md) documents hidden password prompts, verified TLS/CA, target checks and manual acknowledgements. Synthetic security fixtures are explicitly labeled; they never establish a genuine SERV/photo workflow.

Exact guarded recovery command (remote writes, **owner-run only**, not executed by the agent):

```sh
node scripts/run-storage-security.mjs --cleanup
```

It preserves the original journal/baseline, closes gates, refuses unexpected scope/key or unattributed rows, requires an empty Storage catalog before fixture deletion, then independently compares the original baseline. It never deletes `storage.objects` with SQL. Follow with the read-only command:

```sh
node scripts/run-storage-security.mjs --inspect-cleanup
```

Successful cleanup now retains `.spotly-security-storage.json`; archive it privately outside the repository after independent verification before starting another fixture run. Never delete or overwrite it to bypass a failed preflight. Never commit recovery journals, private `.env` files, credentials or Supabase link metadata.

## Known limits and roadmap

The private download defect blocks live completion. Diagnose it with existing hosted request IDs before creating more fixtures. No application workaround, RLS weakening, public bucket, production pilot activation or paid retry is justified. Login/email delivery, real account workflows and browser/mobile gestures require separate observation. Password recovery, workspace-selection/role-management UI, durable upload/planning quotas, production map capacity and public execution readiness remain pending.

The dashboard map and landing animation are labeled illustrations. Leaflet loads only in a browser effect, supports coordinate entry/keyboard selection, cleans up instances and preserves coordinates on tile failure. Direct OpenStreetMap tiles are a low-volume prototype with visible attribution and default caching; no reverse geocoding, bulk downloads, prefetch or retry loops. Choose an appropriate provider before production.

Longer term, Spotly may add explicit dispatcher-approved settlement, payment-provider integration, Kite Agent Passport and Reppo after the verification workflow and security checks are reliable. None is implemented here. Payments and Settings remain unavailable; there are no payouts or spending claims.
