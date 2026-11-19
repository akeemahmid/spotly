# UI refinement - November 18, 2026

Presentation changes only. Earlier application fixes remain intact. No API, authentication, database, RLS, workflow transition, SERV generation/signing, gate or production-data change was made in this refinement.

## Dashboard and import

- Removed the permanent "Existing browser drafts" card and green "Dispatcher workspace" banner. Workspace identity, membership and navigation remain intact.
- Placed a compact secondary "Import drafts" action beside "New verification". Metrics now follow the heading/actions directly; the draft count sits with the request list.
- The native modal dialog contains sharing confirmation, duplicate/no-overwrite warnings, retention of browser originals, imported-plan limitations and the existing detailed import feedback. Import remains disabled until the user confirms sharing. Closing is disabled while an import is running. Native dialog behavior provides modal focus and Escape dismissal when idle; actual browser interaction still needs verification.
- The importer retains the same validated browser repository, sequential import calls, duplicate/error reporting and refresh. No local data is erased or overwritten.

## Copy and typography

- Removed visible phase/hackathon labels from the landing page, dashboard/footer and sidebar. Internal identifiers, configuration, migrations and tests remain unchanged.
- Replaced implementation-stage language with concise availability/access notices in assignment and review screens. Safety, location consent, failed-operation feedback, payment unavailability and sample-versus-real distinctions remain visible.
- Shortened repetitive landing, request/detail and verifier copy. Technical SERV model/provider/plan metadata remains accessible under "Plan details"; generation and acceptance behavior is unchanged.
- Renamed the illustrative dashboard map "Sample locations" and retained map attribution, report-issue links, markers and interactions.
- Reduced the hero type token by 12.5% (48-76px to 42-66.5px). Dispatcher page headings now use 24-30px; the workflow preview heading uses 20-22px. Body type and 16px input sizes remain unchanged. Existing mobile wrapping is preserved, with wrapping action groups and dialog buttons added. No motion transforms, lifecycle behavior, fonts, brand colors or CTA destinations changed.

## Files changed in this refinement

- `app/page.tsx`
- `app/typography.css`
- `components/dashboard/dispatcher-dashboard.tsx`
- `components/dashboard/map-preview.tsx`
- `components/layout/sidebar.tsx`
- `components/maps/location-map.tsx`
- `components/verifications/assignment-workflow.tsx`
- `components/verifications/create-verification.tsx`
- `components/verifications/import-local-drafts.tsx`
- `components/verifications/serv-plan.tsx`
- `components/verifications/verification-details.tsx`
- `scripts/ui-refinement.test.mjs`
- `docs/ui-refinement.md`

Earlier application changes and their files are described in `first-complete-workflow-audit.md`. The existing focused Storage diagnostic/support changes remain separate. The private support attachment, environment files and recovery records remain excluded from Git.

## Validation limits

Three offline React server-rendering tests check the actual importer dialog/confirmation markup, dashboard action/metric placement and retained navigation, and landing CTAs/content/availability notices. They do not run browser effects or remote requests. Existing storage/import/API tests remain part of the full local suite.

Validation passed: 3 relevant component tests, all 247 local tests (zero failures/skips), ESLint, standalone TypeScript after the build, production webpack build and `git diff --check`. A temporary loopback-only production preview returned HTTP 200 for the public landing page with the updated content and preserved CTA. The preview was stopped after this check. No authenticated route or remote test was called. The earlier API/auth/data-layer/migration diff was compared before/after this refinement and is unchanged.

Before staging, sensitive-pattern review covered 154 release-candidate text files and 44 browser JavaScript assets. One exact malformed-key negative-test fixture was reviewed explicitly; no unresolved finding remained. Private environment files, recovery records, Supabase temporary metadata and the owner-excluded support attachment are not release candidates. This is a scoped source/artifact review, not a certification of all historical Git objects. The UI changes and earlier safe application fixes are prepared for the existing `main` branch; no commit or push is part of this refinement. Separate Storage diagnostic changes are retained outside that staging scope.

The browser tool inventory had no available browser surface, and the referenced localhost server was not running at the initial inspection. Desktop/mobile visual layout, font rendering, dialog focus return, Escape/cancel behavior and pointer/keyboard interactions must be reported as unverified. Responsive CSS/source review and HTTP checks are not end-to-end browser tests.
