import test from "node:test";
import assert from "node:assert/strict";
import { appendStorageEvent, browserStorageScope, manifestObjectKnown, newStorageRecord, parseStorageRecord, storageFixtureIds, validateStorageManifest, verifiedFolderPlaceholder } from "./storage-recovery-record.mjs";
import { storageFixtureQuery, fixtureCountsSQL } from "./storage-fixture-attribution.mjs";
import { safeEvidenceDiagnostic } from "./evidence-operation-report.mjs";

const assignment = "69000000-0000-4000-8000-000000000001", evidence = "59000000-0000-4000-8000-000000000001";
const verifier = "18000000-0000-4000-8000-000000000003", path = `${assignment}/${evidence}`;
const assigned = { kind: "assignment", assignment, verifier, requestId: storageFixtureIds[0].request, planId: storageFixtureIds[0].plan };
const reserved = { ...assigned, kind: "reservation", evidence, path, mime: "image/png", size: 95 };
const record = () => ({ ...newStorageRecord("immutable-original-baseline"), startedAt: "2026-11-14T12:00:00.000Z", events: [assigned, reserved,
  { kind: "catalog", path, catalogId: evidence, createdAt: "2026-11-14T12:01:00.000Z" }] });
const marker = () => ({ name: `${assignment}/.emptyFolderPlaceholder`, expected_path: path, assignment_prefix: true, synthetic_chain: true,
  catalog_owner: null, catalog_size: "0", catalog_mime: "application/octet-stream", catalog_created_at: "2026-11-14T12:20:00.000Z" });

test("version-2 journal appends exact path intent and catalog identity without replacing its baseline header", () => {
  const initial = newStorageRecord("immutable-original-baseline");
  let disk = JSON.stringify(initial) + "\n";
  const header = disk;
  const journal = { read: () => parseStorageRecord(disk), append: event => { disk += JSON.stringify(event) + "\n"; } };
  for (const event of record().events) appendStorageEvent(journal, event);
  assert.ok(disk.startsWith(header));
  assert.equal(journal.read().baseline, initial.baseline);
  assert.equal(journal.read().events[1].path, path);
  assert.equal(journal.read().events[2].catalogId, evidence);
});
test("version-1 recovery remains supported and is never silently upgraded or appended", () => {
  const legacy = { project: "ogqmifuylakjhwveqrmd", version: 1, baseline: "legacy-unchanged" };
  assert.deepEqual(parseStorageRecord(JSON.stringify(legacy)), legacy);
  assert.throws(() => appendStorageEvent({ read: () => legacy, append: () => assert.fail("legacy record appended") }, assigned));
  assert.equal(verifiedFolderPlaceholder(marker(), legacy, [marker()]), false);
});
test("malformed, torn, secret-bearing and wrong-path journal events fail closed", () => {
  const r = record();
  assert.throws(() => validateStorageManifest({ ...r, events: [reserved] }));
  assert.throws(() => validateStorageManifest({ ...r, events: [assigned, { ...reserved, path: `${assignment}/other` }] }));
  assert.throws(() => validateStorageManifest({ ...r, events: [{ ...assigned, password: "private-password" }] }));
  assert.throws(() => parseStorageRecord(JSON.stringify(newStorageRecord("baseline")) + '\n{"kind":'));
  assert.throws(() => validateStorageManifest({ ...r, project: "onfdusisfidlfdmluwxl" }));
});
test("a folder placeholder requires manifest linkage, original object absence, zero size, admin owner and a later creation time", () => {
  const r = record(), m = marker();
  assert.equal(verifiedFolderPlaceholder(m, r, [m]), true);
  for (const changed of [{ name: ".emptyFolderPlaceholder" }, { catalog_size: "1" }, { catalog_size: null }, { catalog_owner: verifier },
    { expected_path: `${assignment}/other` }, { synthetic_chain: false }, { catalog_created_at: "2026-11-14T11:00:00.000Z" },
    { catalog_mime: "image/png" }]) assert.equal(verifiedFolderPlaceholder({ ...m, ...changed }, r, [m]), false);
  assert.equal(verifiedFolderPlaceholder(m, r, [m, { name: path }]), false);
  assert.equal(verifiedFolderPlaceholder(m, { ...r, events: [assigned, reserved] }, [m]), false);
});
test("only the explicitly journaled browser request permits genuine photo/observation recovery", () => {
  const r = record();
  assert.equal(browserStorageScope(r), false);
  r.events.push({ kind: "browser-scope", requestId: storageFixtureIds[2].request, planId: storageFixtureIds[2].plan });
  assert.equal(browserStorageScope(r), true);
  const limited = storageFixtureQuery(fixtureCountsSQL), browser = storageFixtureQuery(fixtureCountsSQL, { browser: true });
  assert.ok(limited.includes("false and a.verification_request_id='SP-36000000-0000-4000-8000-000000000003'"));
  assert.ok(browser.includes("true and a.verification_request_id='SP-36000000-0000-4000-8000-000000000003'"));
  assert.ok(!browser.includes("/*BROWSER_EVIDENCE*/"));
  assert.throws(() => validateStorageManifest({ ...r, events: [{ kind: "browser-scope", requestId: storageFixtureIds[0].request, planId: storageFixtureIds[0].plan }] }));
});
test("objects must match exact journal identity and metadata; an assignment prefix is insufficient", () => {
  const object = { name: path, assignment_id: assignment, evidence_id: evidence, catalog_id: evidence, catalog_owner: verifier, catalog_size: "95", catalog_mime: "image/png" };
  assert.equal(manifestObjectKnown(object, record()), true);
  for (const value of [{ name: `${assignment}/other` }, { catalog_owner: null }, { catalog_size: "8388609" }, { evidence_id: assignment }, { catalog_id: assignment }]) {
    assert.equal(manifestObjectKnown({ ...object, ...value }, record()), false);
  }
});
test("HTTP/SQLSTATE diagnostics never expose error bodies, tokens or unknown SQLSTATE-like fields", () => {
  assert.match(safeEvidenceDiagnostic({ code: "P0001", message: "Evidence binding mismatch", detail: "private-token" }, 400), /actual_http=400; sqlstate=P0001; category=EVIDENCE_BINDING_MISMATCH/);
  for (const error of [{ code: "private-token", message: "private-password" }, { code: "P0001", message: "Evidence binding mismatch private-token" }]) {
    assert.ok(!/private-token|private-password/.test(safeEvidenceDiagnostic(error)));
  }
});
