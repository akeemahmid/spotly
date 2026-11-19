import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Render real components offline with the existing compiler/React renderer.
// Effects do not run: these tests make no Auth, Storage, or provider requests.
const load = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
for (const extension of [".ts", ".tsx"]) {
  load.extensions[extension] = (module, filename) => module._compile(
    ts.transpileModule(readFileSync(filename, "utf8")
      .replace('import "server-only";', "")
      .replace(/(["'])@\/([^"']+)\1/g, (_match, _quote, path) => JSON.stringify(resolve(root, path))), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, filename,
  );
}
load.extensions[".css"] = module => { module.exports = {}; };
const React = load("react");
const { renderToStaticMarkup } = load("react-dom/server");
const { AppRouterContext } = load("next/dist/shared/lib/app-router-context.shared-runtime");
const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
const render = element => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, element));

test("importer renders a compact action and a closed, labelled confirmation dialog with safeguards and feedback", () => {
  const { ImportLocalDrafts } = load("../components/verifications/import-local-drafts.tsx");
  const html = render(React.createElement(ImportLocalDrafts));
  const [visible] = html.split("<dialog");
  assert.match(visible, /aria-haspopup="dialog"[^>]*>Import drafts<\/button>/);
  assert.doesNotMatch(visible, /Existing browser drafts|Share drafts|Matching IDs/);
  const dialog = html.match(/<dialog([^>]*)>([\s\S]*)<\/dialog>/);
  assert.ok(dialog);
  assert.doesNotMatch(dialog[1], /\sopen(?:=|\s|$)/);
  assert.match(dialog[1], /aria-labelledby="import-drafts-title"/);
  assert.match(dialog[1], /aria-describedby="import-drafts-description"/);
  assert.match(dialog[2], /Matching IDs are skipped without overwriting/);
  assert.match(dialog[2], /browser originals stay intact/);
  assert.match(dialog[2], /Imported plans remain untrusted/);
  assert.match(dialog[2], /type="checkbox"[^>]*required=""/);
  assert.match(dialog[2], /I want to share these drafts with this workspace/);
  assert.match(dialog[2], /role="status"/);
  assert.match(dialog[2], /type="submit"[^>]*disabled=""[^>]*>Import drafts/);
});

test("dashboard puts creation/import actions and metrics before the illustration, retaining navigation and disabled features", () => {
  const { DispatcherDashboard } = load("../components/dashboard/dispatcher-dashboard.tsx");
  const html = render(React.createElement(DispatcherDashboard));
  assert.match(html, /href="\/dispatcher\/verifications\/new"[^>]*>[\s\S]*?New verification/);
  assert.match(html, /aria-haspopup="dialog"[^>]*>Import drafts/);
  assert.ok(html.indexOf('aria-label="Verification overview"') < html.indexOf('aria-labelledby="map-title"'));
  assert.doesNotMatch(html, /class="demo-banner"|Existing browser drafts|Phase\s*3[AB]?/i);
  for (const label of ["Overview", "Verifications", "Map", "Payments", "Settings"]) assert.ok(html.includes(label));
  assert.match(html, /disabled=""[^>]*title="Not available yet"/);
  assert.match(html, /Illustrative map/);
  assert.match(html, /Payments are unavailable/);
});

test("landing retains CTA destinations, visible content and illustration/payment limits without implementation-stage badges", () => {
  const Home = load("../app/page.tsx").default;
  const html = render(React.createElement(Home));
  assert.match(html, /href="\/dispatcher"/);
  for (const target of ["product", "how-it-works", "use-cases"]) assert.match(html, new RegExp(`href="#${target}"`));
  assert.match(html, /Know what/);
  assert.match(html, /Illustrative workspace/);
  assert.match(html, /Payments are unavailable/);
  assert.match(html, /approved accounts when enabled/);
  assert.doesNotMatch(html, /Phase\s*3[AB]?|Hackathon|opacity:\s*0/i);
});

test("evidence report ties each review to the question, consented coordinates and honest submission-time limits", () => {
  const { EvidenceSubmissions } = load("../components/verifications/assignment-workflow.tsx");
  const currentId = "11111111-1111-4111-8111-111111111111";
  const priorId = "22222222-2222-4222-8222-222222222222";
  const submitted = "2026-11-18T12:00:00.000Z";
  const html = render(React.createElement(EvidenceSubmissions, { assignment: {
    verification_requests: { title: "Road check", question: "Is the east lane open?", location_description: "East entrance" },
    task_evidence: [
      { id: priorId, submission_round: 1, submitted_at: submitted, observation: "Earlier observation", location: null },
      { id: currentId, submission_round: 2, submitted_at: submitted, observation: "<script>Observed one closed lane</script>", location: { latitude: 6.5, longitude: 3.4, consent: true } },
      { id: "pending", submission_round: 3, submitted_at: null, observation: "Never finalized" },
    ],
    assignment_events: [
      { evidence_id: priorId, action: "revise", created_at: submitted, note: "Show the entrance" },
      { evidence_id: currentId, action: "approve", created_at: submitted, note: "Reviewed" },
      { evidence_id: currentId, action: "complete", created_at: "2026-11-18T12:01:00.000Z", note: "<b>Resolved</b>" },
    ],
  } }));
  assert.match(html, /Original question:<\/strong> Is the east lane open\?/);
  assert.match(html, /Requested location:<\/strong> East entrance/);
  assert.match(html, /Verifier observation/);
  assert.match(html, /&lt;script&gt;Observed one closed lane&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<b>Resolved|Never finalized/);
  assert.match(html, /Submitted <time dateTime="2026-11-18T12:00:00.000Z"/);
  assert.match(html, /6\.500000, 3\.400000\. Shared with consent; not independently verified/);
  assert.match(html, /No optional location shared/);
  assert.match(html, /Observation and photo capture times are not recorded/);
  assert.match(html, /Submission time does not establish photograph freshness or location authenticity/);
  assert.match(html, new RegExp(`src="/api/evidence/${currentId}"`));
  const articles = html.match(/<article[\s\S]*?<\/article>/g);
  assert.equal(articles.length, 2);
  assert.match(articles[0], /Submission 2[\s\S]*Completed after approval[\s\S]*&lt;b&gt;Resolved&lt;\/b&gt;/);
  assert.match(articles[1], /Submission 1[\s\S]*Revision requested[\s\S]*Show the entrance/);
});
