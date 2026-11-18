<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product purpose

Spotly helps businesses request fresh information about physical-world conditions. The initial use case is road-condition verification for logistics dispatchers. Tagline: “Know what's happening, anywhere.”

## Architecture

Preserve the existing Next.js App Router project, root `app/` directory, TypeScript, Tailwind CSS, ESLint, npm lockfile, and `@/*` alias. `/` is the public landing page; `/dispatcher` is the workspace. Creation lives at `/dispatcher/verifications/new`, and details at `/dispatcher/verifications/[id]`. Runtime route parameters are read inside Suspense, as required by the installed Next.js Cache Components guides.

Components live in `components/layout`, `components/dashboard`, `components/ui`, `components/maps`, `components/verifications`, and `components/marketing`. Share Brand, StatusBadge, LocationMap, and the map illustration. The dashboard map stays explicitly illustrative; the creation/detail LocationMap imports Leaflet only inside a browser effect. It supports click/drag selection and a keyboard-friendly map-center action with coordinate inputs as an alternative. Clean up map instances and observers on unmount.

`types/verification.ts` defines one Verification model: immutable bundled `source: sample` examples, legacy browser `source: local` drafts for explicit import, and authenticated `source: supabase`, `status: draft` records. Reuse existing Zod schemas, selectors, labels and maximum USD budget semantics. Creation-time future-expiration validation stays separate from historical record loading.

`lib/use-verifications.ts` owns the single module-level external store consumed with useSyncExternalStore. It loads authenticated Supabase requests, refreshes after mutations and focus, and never merges samples/local drafts into real activity. `lib/task-storage.ts` remains the validated v1 browser repository solely for legacy compatibility/import. Never silently erase or overwrite unreadable browser storage. Import is explicit, preserves IDs/compatible accepted plans, reports duplicates/errors, and leaves originals untouched. Failed server writes preserve the form and never navigate as if successful.

## Current MVP scope and phase

Phase 3B implementation is authorized by the November 11 request: add private verifier assignments, photographic evidence, and dispatcher review on top of Phase 3A. Stop after Phase 3B implementation. Assignment execution remains disabled until signing and dedicated-account authorization checks pass. Do not implement payments, Kite, Reppo, or later phases. Original requests retain draft status; field activity is tracked separately in assignments. Draft records do not count as active work, completed work, or spending. Payments and Settings remain unavailable. Public marketing remains public.

`lib/supabase/browser.ts` and `server.ts` use only the public project URL/publishable key plus cookie-based user sessions; never introduce a service-role key into browser code. `proxy.ts` refreshes cookies using verified `auth.getClaims()`. Every server data operation repeats verified authentication. Auth checks that read cookies render inside Suspense. Never cache user data publicly or trust client UI/session objects as authorization.

Versioned migrations live in `supabase/migrations`; apply manually to the intended project. All tables have RLS and minimal grants. Narrow fixed-search-path definer RPCs derive creator identity from `auth.uid()`, enforce dispatcher membership and plan ownership, and lock requests for acceptance. No direct application table mutations, self-granted memberships, budget changes, payment transitions, or recursive membership policies. Phase 3B completion applies only to separately reviewed task_assignments; original requests remain immutable drafts. USD storage is `numeric(12,2)`; reject fractional cents before insertion. Membership/role management is administrator-only in this phase. Samples are isolated illustrations.

## Design principles

Use #126B53 primary, #BBF7D0 light green, #F7F8F6 background, #14201D text, and #F3B352 warning. Use Montserrat as the primary typeface through next/font/google (variable normal style, Latin preload, swap, sensible sans-serif fallback); preserve premium white cards, restrained borders, readable secondary text, compact landing-page rhythm, and responsive spacing. Use semantic markup, labels, keyboard focus, linked validation errors, and reduced-motion support. Keep DOM and visual order aligned on mobile. No fabricated addresses, live coverage, evidence, or verifier activity.

## Security and map rules

SERV Reasoning is server-only and restricted to loopback development with same-origin requests. Kite Agent Passport and Reppo remain future work. Never expose SERV_API_KEY to the browser. No payment execution. Only the dispatcher sets and explicitly approves a budget; AI must not authorize spending. Local storage is browser-only, unencrypted, and user-editable; do not treat it as a security or payment authorization boundary. Render user input as text, validate stored data, and do not collect secrets.

Leaflet uses direct HTTPS OpenStreetMap standard tiles for a low-volume development prototype only. Retain visible linked contributor attribution, browser Referer and caching defaults, and the report-map-issue link. No bulk downloads, tile prefetching, cache bypasses, or automatic retry loops. Load only viewed tiles; use a suitable provider or self-hosting before production. Show map/tile failures gracefully without losing coordinates or blocking coordinate entry. Never reverse-geocode or infer a street address without an explicit future feature.

## Verification

`npm test` runs meaningful data-layer tests with the existing TypeScript compiler and Node test runner; no extra test dependency. Run ESLint, TypeScript, and a production build. The environment has blocked Turbopack's CSS worker port; `npx next build --webpack` is the established fallback without changing project configuration. Browser/mobile gesture QA must be reported as unverified if no browser surface is available; do not present HTTP/source checks as end-to-end browser tests. See README.md for the manual workflow checklist.

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Routine debugging is not feedback. Verify changes before retaining them as feedback candidates. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Retain qualifying friction even if it is later fixed or worked around; record the final outcome during the reporting pass.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `npx --no-install next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->

## SERV planning in Phase 3A

`lib/serv/server.ts` and `lib/serv/client.ts` remain server-only. Paid POST `/api/serv/plan-verification` denies production and non-loopback requests, requires matching Origin, verifies claims, checks dispatcher membership and creator ownership against the database, validates exact current fingerprint/expiration, and limits payloads, concurrent calls, and per-user frequency. Run development bound to `127.0.0.1`; no tunnels/proxies. Durable quotas and multi-instance abuse controls are prerequisites for enabling production paid planning.

Use bounded strict Zod plans, plain text rendering, and no simulated fallback. Generated plans persist before review; acceptance selects the stored candidate and repeats authorization, fingerprint, and expiration checks under a database row lock. Metadata includes version, canonical fingerprint, timestamps, model, provider ID, usage/duration where available. Local imported and pre-hardening plans are explicitly legacy_untrusted and never qualify as SERV-generated. New plans require a server HMAC receipt verified by the database; neither provenance nor provider fields can be set through an unsigned client RPC. Never treat plans as evidence, authorize budgets with AI, or execute payments. Original requests remain immutable drafts.

`supabase/tests/authorization.sql` is a rollback-only allow/deny suite for a disposable migrated database. Do not claim live RLS/account/cross-device/browser tests passed unless actually run. README documents manual setup, migration application, known blockers, and workflow QA.

## Landing-page motion

The authorized landing enhancement is confined to `/`, `components/marketing`, its scoped `app/landing-motion.css`, Motion dependency, tests, and documentation. Do not extend it into dispatcher/auth/SERV/database changes. Preserve brand, navbar, and CTA destinations. The wide hero places the original `SpotlyHeroScene` on the left and copy on the right; mobile uses copy then illustration in matching DOM/visual order.

`SpotlyHeroScene` is an original layered SVG/CSS observation atlas, not live map data or real activity. Its ten-second Motion for React mini sequence illustrates Request → Observe → Review → Decide. Keep conceptual labeling and human review; never imply certified road safety or real evidence. `motion-lifecycle.ts` pauses on visibility/intersection/user controls, cancels to static on reduced motion, and cleans up listeners/observers. No WebGL, video, third-party illustration assets, or network calls belong in the scene.

`LandingReveal` progressively enhances only initially off-screen content with once-only 20px/0.55s entrances and optional card staggering. SSR/no-JS content remains visible; reduced motion and keyboard focus restore full content. Do not introduce hidden initial server markup, scroll hijacking, layout animation, or perpetual animation outside the hero. Preserve static fallbacks and reserve scene dimensions. Browser visual/overflow/reduced-motion QA must be reported separately from lifecycle unit tests and HTTP checks.

## Typography system

`app/typography.css` defines shared role tokens: captions 13px; secondary descriptions/labels/navigation 14–15px; buttons 15–16px; body 16–17px; lead paragraphs 17–18px; section headings 32–48px; hero 48–76px. Inputs remain at least 16px, including mobile, with body leading near 1.6 and heading tracking near −0.025em. Reuse role tokens instead of introducing tiny pixel overrides or globally scaling the page. Existing compact product previews are labeled illustrations; decorative thumbnail labels may be smaller.

Use the system-only accent stack `"Comic Sans MS", "Comic Sans", cursive` only on the hero's “anywhere.”, the short “Yet.” marketing accent, and the illustration's “A question worth asking.” annotation. Never bundle proprietary Comic Sans, and never apply the accent to operational UI, navigation, buttons, financial amounts, warnings, or paragraphs. Its exact appearance varies by installed fonts; no extra accent font download is required.

Typography refinements may wrap toolbars/buttons, widen the sidebar slightly, stack dense hero columns below desktop, and place illustration cards into a readable mobile grid. Preserve all messaging, animation lifecycle/reduced-motion behavior, and operational workflows. New CSS must override legacy landing selectors deliberately without changing animation transforms or state. Do not claim browser font rendering or breakpoint visual QA passed without an actual browser surface.

## Phase 3A plan provenance hardening

Apply `202611050002_serv_plan_provenance.sql` after the original migration. `lib/serv/provenance.ts` is server-only: sign only the actual adapter-validated response, bound to exact request ID, authenticated requester, fingerprint, version, and complete provider output/metadata. Never expose a signing endpoint for browser-supplied output. `SERV_PLAN_SIGNING_KEY` is a 32-byte hex server secret matching the private RLS-enabled `spotly_private.serv_plan_key` row, provisioned separately by the database owner. No service-role client is used. No real key belongs in source, migrations, logs, browser bundles, or chat. Missing signing configuration fails closed before paid generation.

Only `save_verified_serv_plan(payload,signature)` can create `serv_server_v1` provenance; it verifies HMAC, ownership/membership, request lock, fingerprint/version, expiration, and receipt freshness. The legacy unsigned save/accept RPCs are dropped. Imports retain the default `legacy_untrusted` provenance and are never promoted automatically, including on ID/timestamp conflict. Acceptance receives only request/plan IDs and loads the stored trusted row, checking requester binding and current fingerprint/version/expiration. It is idempotent and never changes budget/status.

Any future assignment must require accepted `serv_server_v1` provenance, generated_by matching the original request creator, supported version, current fingerprint and unexpired request. Historical/imported acceptance is insufficient. Phase 3B execution remains blocked until live authenticated two-account and authorization checks pass; implementation may proceed with gates closed. Report mocked Node tests, disposable SQL role tests, live anonymous checks, and browser account workflows separately.


## Phase 3B private field workflow

`202611110001_phase3b.sql` follows migrations 001 and 002; apply manually only to an explicitly reviewed project. `task_assignments`, `task_evidence`, and `assignment_events` hold field activity separately from immutable requests/budgets. Verifiers require administrator-approved membership and only read their assigned request and selected plan. Workspace membership alone must not reveal other tasks. A declined assignment is terminal; reassignment and video are outside this implementation. Expiration blocks all new transitions, including reviews.

`PHASE3B_ENABLED` defaults false; the private `workflow_gate` requires both `enabled` and `live_checks_verified`, and a provisioned signing key. Browser UI gates never replace RPC authorization. No administrator/service-role client is used. Evidence receipts use the existing private HMAC key with a separate `spotly.evidence.v1` purpose; never use an evidence receipt as plan provenance. The server decodes/re-encodes a bounded single JPEG/PNG/WebP with Sharp, removes embedded metadata, uploads without overwrite, verifies actual stored bytes, then signs finalization. Storage objects are private and immutable to application users; only submitted evidence is served through the authenticated no-store proxy. Direct uploads or reservations alone never count as submissions.

Run both rollback SQL suites only on a disposable migrated Supabase database. Mocked Node tests and catalog inspections do not establish live role, Storage API, signed-upload, or browser behavior. Before opening the gate, verify signed upload URL/overwrite denial as well as ordinary upsert denial with real dedicated accounts. No paid SERV calls are authorized by this implementation request.
