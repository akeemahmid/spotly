# Phase 3A browser integration checklist

> November 18 release status supersedes historical checkpoints and deployment/activation commands below. See [current status](product-release-status.md). Production writes and gate activation are not authorized.

**November 12 current checkpoint:** the owner-login signing comparison passed and migrations 001–003 are deployed. The earlier missing-key blockers and initial signing setup below are historical. Do not generate/reprovision keys. No paid generation is approved by the current preparation request. Use the [first real workflow guide](phase3b-first-live-workflow.md) for current A/B/C setup, single-call approval protocol and pilot gate limitations; the browser checks below remain unverified until actually performed.

This checklist uses two separate Chrome profiles and dedicated test accounts. Enter credentials only in the app or Supabase dashboard. Never send passwords, access/refresh tokens, cookies, signing keys, authorization headers, or environment-file contents through chat. Do not export a browser network HAR; it can contain credentials.

## Current gate — configure signing and verify real accounts before SERV

Following the owner's application of migration 002 on November 10, 2026, fresh read-only inspection confirmed:

- Both `202611050001` and `202611050002` are recorded.
- `provenance`, `generated_by`, and `receipt_signature` exist with the expected types/defaults/nullability.
- `save_verified_serv_plan(text,text)` and `accept_verified_serv_plan(text,uuid)` exist; both legacy unsigned RPCs are removed.
- All five public tables and the private key table have RLS. Public tables allow authenticated SELECT only; anonymous table access is denied.
- Signed RPCs are definer functions with fixed empty search paths, authenticated execution, and no anonymous/PUBLIC execution.
- Both deployed signed-function bodies match migration 002 after whitespace normalization.
- Ordinary application roles have no private-schema usage/create or private-key table access, and the private key table has no policies.
- Auth settings are reachable, email signup is enabled, and email confirmation is required. This configuration check is not a successful signup/email-delivery test.
- **Historical configuration blocker (resolved):** the private key table and local variable were previously absent. The owner has since confirmed a passed matching-key diagnostic.

No migration/history/security/key changes were made by the agent. The earlier schema discrepancy is resolved. The owner must deliberately provision/copy the key privately, then the diagnostic and real two-profile tests must pass before the single authorized paid generation. No browser/account success is inferred from catalog inspection or mocked tests.

### Read-only schema check

From the Spotly project terminal, run:

```sh
npx --no-install supabase db query --remote --read-only --file supabase/tests/schema-inspection.sql
```

If the CLI cannot connect, open the intended project's Supabase SQL Editor and run the contents of that file. It returns only schema, permissions, and migration versions; it never selects keys or customer records. Do not run the SQL authorization fixture on production.

Expected: both migration versions; all three provenance columns; both signed RPCs and no unsigned legacy RPCs; RLS on the five public tables and private key table; no direct application table writes; signed RPC execution granted to `authenticated` but not `anon`/PUBLIC; empty fixed function search paths; no `anon`/`authenticated` private-schema or key-table privileges/policies.

If history says both versions exist but these objects do not, stop and report the mismatch. Do not rerun migrations or repair history blindly. The owner must reconcile the deployment separately.

### Signing configuration — owner-only manual setup

1. Confirm the hardening schema exists first. Leave `.env.example` empty of real credentials.
2. Check whether protected material exists without displaying it, in SQL Editor:

   ```sql
   select count(*) = 1 as key_present,
          coalesce(bool_and(key_hex ~ '^[0-9a-fA-F]{64}$'), false) as format_valid
   from spotly_private.serv_plan_key where singleton;
   ```

3. If a key already exists, retrieve/copy it privately as database owner, following README's provisioning instructions. Put that exact value in `.env.local` as `SERV_PLAN_SIGNING_KEY`. It must be 64 hex characters, representing 32 bytes. Do not add a `NEXT_PUBLIC_` prefix. Do not rotate an existing key as a troubleshooting shortcut.
4. If no key exists, stop for a deliberate owner decision to provision one using the existing README instructions. This coding milestone has not generated or deployed any secret.
5. Run the comparison locally. It captures database verification material in memory and prints only pass/fail:

   ```sh
   node --env-file=.env.local scripts/check-serv-signing.mjs
   ```

   Do not proceed to SERV until it passes and catalog inspection confirms the key table is protected. A comparison error is not permission to weaken grants or expose the private schema.
6. Confirm `SERV_MODEL=gpt-5.4-mini` locally and restart the development server after environment changes. Do not share your environment file.

## 1. Start Spotly locally — no paid call

In the project terminal:

```sh
npm run dev -- --webpack --hostname 127.0.0.1
```

Keep this terminal running. Open `http://127.0.0.1:3000`. Use this same address in every profile; do not switch between `localhost` and `127.0.0.1`. No tunnel or public proxy. Use development mode: production deliberately disables SERV generation.

The milestone also fixes numeric-loopback Origin checks and callback/sign-out redirects. Restart the server with the updated code before testing; an older running build may reject legitimate saves or redirect to the other hostname.

In Supabase Auth URL Configuration, the owner should verify Site URL `http://127.0.0.1:3000` and allowed redirect `http://127.0.0.1:3000/auth/callback`. Verify email confirmation and delivery settings. These are manual configuration steps, not settings changed by this milestone.

## 2. Create two separate Chrome profiles — no paid call

1. Click Chrome's profile icon near the upper-right corner and choose **Add profile**. Depending on Chrome version, choose **Continue without an account** if offered.
2. Name this profile **Spotly Test A**. Use a distinct profile color.
3. Repeat for **Spotly Test B** using another color. Separate tabs in one profile are not separate sessions.
4. In profile A, visit `/signup` on the local address. Register with dedicated Account A's email and a unique password of at least eight characters. Use a test address you control.
5. In profile B, repeat with a different dedicated Account B email.
6. If confirmation is required, open each confirmation link in the profile that initiated that signup. If your mail app opens the wrong profile, privately copy the link into the correct one. Treat the link as a credential; never share it.
7. The callback should open the workspace, or you can visit `/login` and sign in after confirmation. If confirmation fails, check that it was opened in the original profile and the callback URL is allowed. Stop rather than repeatedly creating accounts.
8. If signup signs you in immediately, report that confirmation was not required. Do not describe it as a successful email-confirmation test.

Expected: both accounts sign in independently. Signing into B must not replace A's session. Do not use existing personal/customer accounts.

## 3. Verify automatic workspaces — no paid call

1. Open `/dispatcher` in each profile and wait for loading to finish.
2. A new account with no memberships should automatically receive its own dispatcher workspace. An empty request list is normal; an error banner is not an empty-workspace success.
3. As project owner, open Supabase SQL Editor and use a read-only query, replacing the placeholder emails privately:

   ```sql
   select u.email, m.workspace_id, m.role
   from public.workspace_members m
   join auth.users u on u.id = m.user_id
   where u.email in ('REPLACE_WITH_ACCOUNT_A_EMAIL', 'REPLACE_WITH_ACCOUNT_B_EMAIL');
   ```

4. Expect one authorized dispatcher membership for each fresh account and different workspace IDs. Do not insert memberships to make this test pass. Existing verifier-only memberships require deliberate administrator handling.

Report only whether A/B each received a dispatcher workspace and whether the workspace IDs differ. Do not share emails or user identifiers unless necessary.

## 4. Create or reuse the labeled request — no paid call

1. In A, look for an existing test request for this milestone. If one exists and is unexpired, use it throughout. Do not create another merely to repeat generation.
2. If no test request exists, click **New verification** and create exactly one labeled **[PHASE3A TEST] saved plan recovery A**.
3. Use a harmless public test location and a non-sensitive question such as “What obstructions are visible from a safe public position?” Enter a location description and coordinates, or choose a pin. The description is yours; no address lookup runs.
4. Select Photos and Written observation. Set expiration at least 24 hours ahead. Explicitly enter a maximum budget of **0.00 USD**.
5. Click **Review request**. Check the fields and tick the budget-approval checkbox. Click **Create verification draft** once.
6. Expect the details page, an `SP-...` request ID, status **Draft**, and budget **$0.00 USD**. No verifier or payment should appear. Note the request ID and copy the details URL for the isolation test.

If saving fails, preserve the form, report the visible error, and stop. If the response is lost, reload the request list before creating again; creation does not yet have a retry idempotency key.

## 5. Verify request persistence — no paid call

1. Refresh A's details page. Expect the same ID and all the same fields.
2. Return to `/dispatcher`; search for the title or ID. Expect the same single request.
3. In profile A, open an Incognito window for a separate session (or a third temporary Chrome profile). Sign in as Account A and paste the same details URL. Expect the same request. Do not sign Account A into profile B; keep B isolated.
4. As owner, check the request in Supabase Table Editor. Expect the saved ID, zero approved maximum budget, and `draft` status. Do not edit it there.

Report refresh persistence and second-session persistence separately.

## 6. Test Account B isolation — no paid call

1. In B's profile, open `/dispatcher`. A's request must not appear in the list or search.
2. Paste A's details URL into B's address bar. Expect **Request not found** with no title, question, location, budget, or plan disclosure. A loading/configuration error alone is not proof of isolation.
3. While signed in as B, open `http://127.0.0.1:3000/api/verifications` in a new tab. A's ID must not appear in the returned tasks. Do not share the full response if it contains private records.
4. Return to A and confirm the original request is still readable and unchanged.

Report whether B could see anything belonging to A. Any disclosure is a stop condition. Do not weaken RLS.

## 7. Generate one SERV plan — PAID, gated

The user authorized **at most one** genuine generation using the existing labeled request and configured `gpt-5.4-mini`, conditional on passing schema/signing/authentication/ownership/connectivity checks. This authorization has not been consumed by the automated tests. **The current schema/signing blockers must be resolved before this section.**

1. Confirm the read-only schema check and signing comparison pass, sections 3–6 pass, and the request remains unexpired and owned by A. If any condition fails, stop before clicking Generate.
2. Open A's request in development mode. In Chrome DevTools, choose **Network**, then the **Fetch/XHR** filter. Leave DevTools open.
3. Click **Generate plan with SERV exactly once**. Wait for completion. Do not refresh during generation, double-click, use Retry generation, or start another generation in the other session.
4. Inspect the response for `/api/serv/plan-verification` in Network → Response. Report only: HTTP status, model, `planId`, `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`, and any safe error message. If usage is absent, report “not supplied.” Do not copy request headers, cookies, keys, or the entire network export.
5. Expect HTTP 200, `gpt-5.4-mini`, a UUID plan ID, structured instructions, and **Plan ready for review**. The saved ID is displayed in the plan panel. If the call fails, stop; provider credits may already have been consumed, even on a save failure. Another paid attempt needs separate authorization.

## 8. Reload, review, and accept — no additional paid call

1. Record the saved plan ID and one short non-sensitive summary phrase.
2. Refresh the details page **before accepting**. Expect the same ID, same plan content, and **Accept reviewed plan**. There must be no new `/api/serv/plan-verification` Network entry. Normal `/api/verifications` GET requests are expected.
3. Check A's other session. Expect that same saved candidate there too, without generation.
4. Review all instructions and any dispatcher questions. If suitable, click **Accept reviewed plan** once.
5. Expect an accepted timestamp and saved plan. Refresh again and verify acceptance persists in both sessions. Budget must remain $0.00 and status Draft; no assignment or payment starts.
6. In Supabase, inspect the plan row read-only. Expect the same plan ID, `serv_server_v1`, correct original creator in `generated_by`, matching request binding/version 1, and `accepted_at` set. Never copy receipt signatures or private key material to chat.

## 9. Acceptance authorization checks — no paid call

Only use DevTools for these requests to your local app. Do not copy authorization headers or tokens between profiles. These checks use the existing test IDs; no new provider generation is needed.

1. In A's Console, send only the stored IDs, replacing placeholders:

   ```js
   fetch('/api/verifications', {
     method: 'POST', headers: {'Content-Type': 'application/json'},
     body: JSON.stringify({action: 'accept', id: 'REQUEST_ID', planId: 'PLAN_UUID'})
   }).then(async r => console.log(r.status, await r.json()))
   ```

   Expect 200 on repeat acceptance, the original accepted timestamp, and only one acceptance event for that plan. This repeats an idempotent operation; it does not call SERV.
2. In A, repeat with an extra `model: 'forged'` or `plan: {}` property inside the JSON object. Expect HTTP 400 and no changes.
3. In B's Console, send the original ID-only acceptance request using B's own session. Expect denial (normally HTTP 409 with the current app), no accepted timestamp changes, and no new event.
4. Check A again. Budget/status and accepted content must be unchanged.

API denials supplement direct database/RLS tests. Run `supabase/tests/authorization.sql` only on a disposable database with both migrations. It creates synthetic fixtures and rolls them back; never run it on production because it temporarily replaces signing material inside its transaction. The suite covers direct table writes, key access, unsigned/forged plans, membership escalation, cross-user replay, and acceptance event duplication. It is not a genuine provider test.

## 10. What to report

Use this template, with no credentials or full network exports:

```text
Schema inspection: pass / discrepancy / connection error
Signing comparison: pass / missing / mismatch / could not inspect
Account A signup + confirmation + login: result
Account B signup + confirmation + login: result
Distinct authorized workspaces: yes / no / unverified
Existing labeled request ID: SP-...
Request save: HTTP status or visible error
Refresh persistence: pass / fail
Second A session persistence: pass / fail
B list/API excludes A: pass / fail
B direct URL excludes A: pass / fail
Paid generation attempts: 0 or 1
Generation HTTP status / model / token usage / plan UUID: results
Pending plan reload + second-session recovery: pass / fail
Any new generation during reload: yes / no
Acceptance + reload persistence: pass / fail
Budget still 0.00 and status draft: yes / no
Repeated acceptance: status / acceptance event count
Extra metadata rejected: status
B acceptance denied: status
Disposable SQL suite: passed / not run / error
Safe visible error messages: ...
```

Stop immediately on configuration/security errors. Phase 3B must wait for confirmed authentication, persistence, and authorization results; green mocked tests alone do not open that gate.
