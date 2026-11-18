import { randomUUID } from "node:crypto";
import { check, TEST_PROJECT } from "./security-test-db.mjs";
import { fixtureTables } from "./storage-fixture-attribution.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fixture = n => ({ workspace: `25000000-0000-4000-8000-00000000000${n}`,
  request: `SP-36000000-0000-4000-8000-00000000000${n}`, plan: `47000000-0000-4000-8000-00000000000${n}` });
export const storageFixtureIds = Object.freeze([1, 2, 3].map(n => Object.freeze(fixture(n))));
const time = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
export function newStorageRecord(baseline) {
  return { project: TEST_PROJECT, version: 2, baseline, runId: randomUUID(), startedAt: new Date().toISOString(), fixtures: storageFixtureIds };
}
export function parseStorageRecord(text) {
  const lines = text.trim().split("\n");
  const header = JSON.parse(lines[0]);
  if (header.version === 1) { check(lines.length === 1); return header; }
  check(header.version === 2 && !Object.hasOwn(header, "events"));
  const record = { ...header, events: lines.slice(1).map(line => JSON.parse(line)) };
  validateStorageManifest(record);
  return record;
}
export function validateStorageManifest(record) {
  check(record.project === TEST_PROJECT && [1, 2].includes(record.version));
  if (record.version === 1) return;
  check(uuid.test(record.runId) && time(record.startedAt) && JSON.stringify(record.fixtures) === JSON.stringify(storageFixtureIds));
  check(Array.isArray(record.events));
  const assignments = new Map(), reservations = new Map(), catalogs = new Map();
  let browser = false;
  for (const event of record.events) {
    check(event && typeof event === "object");
    const fields = {
      assignment: ["kind", "assignment", "requestId", "planId", "verifier"],
      reservation: ["kind", "assignment", "requestId", "planId", "verifier", "evidence", "path", "mime", "size"],
      catalog: ["kind", "path", "catalogId", "createdAt"], browserScope: ["kind", "requestId", "planId"],
      inventory: ["kind", "tables"],
    };
    const allowed = fields[event.kind === "browser-scope" ? "browserScope" : event.kind];
    check(allowed && Object.keys(event).every(key => allowed.includes(key)));
    if (event.kind === "assignment" || event.kind === "reservation") {
      check(uuid.test(event.assignment) && uuid.test(event.verifier));
      check(storageFixtureIds.some(f => f.request === event.requestId && f.plan === event.planId));
      check(event.requestId === storageFixtureIds[0].request || browser && event.requestId === storageFixtureIds[2].request);
      if (event.kind === "assignment") {
        const prior = assignments.get(event.assignment);
        check(!prior || prior.requestId === event.requestId && prior.planId === event.planId && prior.verifier === event.verifier);
        assignments.set(event.assignment, event);
      }
      else {
        const parent = assignments.get(event.assignment);
        check(parent && parent.requestId === event.requestId && parent.planId === event.planId && parent.verifier === event.verifier &&
          uuid.test(event.evidence) && event.path === `${event.assignment}/${event.evidence}`);
        check(["image/png", "image/jpeg", "image/webp"].includes(event.mime) && Number.isSafeInteger(event.size) && event.size > 0 && event.size <= 8388608);
        reservations.set(event.path, event);
      }
    } else if (event.kind === "catalog") {
      check(reservations.has(event.path) && uuid.test(event.catalogId) && time(event.createdAt));
      check(!catalogs.has(event.path) || catalogs.get(event.path) === event.catalogId);
      catalogs.set(event.path, event.catalogId);
    } else if (event.kind === "browser-scope") {
      check(event.requestId === storageFixtureIds[2].request && event.planId === storageFixtureIds[2].plan);
      browser = true;
    } else if (event.kind === "inventory") {
      check(Array.isArray(event.tables) && event.tables.every(t => fixtureTables.includes(t.table) && Object.keys(t).every(k => ["table", "ids"].includes(k)) && Array.isArray(t.ids) &&
        t.ids.every(id => typeof id === "string" && /^(?:SP-)?[a-f0-9-]{36}(?::(?:dispatcher|verifier):pilot-[abc])?$/.test(id))));
    } else check(false);
  }
}
export function appendStorageEvent(journal, event) {
  const record = journal.read();
  check(record.version === 2 && typeof journal.append === "function");
  validateStorageManifest({ ...record, events: [...record.events, event] });
  journal.append(event); // Append only. The header/baseline is never rewritten.
}
export function browserStorageScope(record) {
  validateStorageManifest(record);
  return record.version === 2 && record.events.some(e => e.kind === "browser-scope");
}
export function manifestObjectKnown(row, record) {
  validateStorageManifest(record);
  return record.version === 1 || record.events.some(e => e.kind === "reservation" && e.path === row.name &&
    e.assignment === row.assignment_id && e.evidence === row.evidence_id && e.verifier === row.catalog_owner &&
    e.mime === row.catalog_mime && e.size === Number(row.catalog_size) &&
    record.events.filter(c => c.kind === "catalog" && c.path === row.name).every(c => c.catalogId === row.catalog_id));
}
export function verifiedFolderPlaceholder(row, record, rows) {
  validateStorageManifest(record);
  if (record.version !== 2 || row.synthetic_chain !== true || row.assignment_prefix !== true ||
    Number(row.catalog_size) !== 0 || row.catalog_size == null || ![null, ""].includes(row.catalog_owner) ||
    !["text/plain", "application/octet-stream", "application/x-empty"].includes(row.catalog_mime) || !time(row.catalog_created_at)) return false;
  return record.events.some(reservation => reservation.kind === "reservation" &&
    row.name === `${reservation.assignment}/.emptyFolderPlaceholder` && row.expected_path === reservation.path &&
    !rows.some(object => object.name === reservation.path) && record.events.some(catalog => catalog.kind === "catalog" &&
      catalog.path === reservation.path && Date.parse(row.catalog_created_at) >= Date.parse(catalog.createdAt) &&
      Date.parse(catalog.createdAt) >= Date.parse(record.startedAt)));
}
