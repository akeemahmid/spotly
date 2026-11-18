import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { assertStorageLimit, httpStatus, inspectStorageBucket, STORAGE_BYTE_LIMIT } from "./storage-limit-diagnostics.mjs";
import { TEST_PROJECT } from "./security-test-db.mjs";

// Exercise the INSTALLED SDK's actual error normalization and Buffer upload
// serialization, with an in-memory fetch. No DNS, Supabase or remote writes.
for (const fixture of [
  { kind: "mime", status: 415, body: { code: "InvalidMimeType", message: "private-response-body" } },
  { kind: "mime", status: 400, body: { statusCode: "415", error: "invalid_mime_type" } },
  { kind: "mime", status: 400, body: { error: "invalid_mime_type", message: "mime type text/plain is not supported" } },
  { kind: "size", status: 413, body: { code: "EntityTooLarge", message: "private-response-body" } },
  { kind: "size", status: 400, body: { statusCode: "413", error: "Payload too large" } },
  { kind: "size", status: 400, body: { error: "Payload too large", message: "The object exceeded the maximum allowed size" } },
]) {
  test(`installed SDK accepts specific ${fixture.kind} rejection: HTTP ${fixture.status}, ${fixture.body.code ?? fixture.body.error}`, async () => {
    let observed, requests = 0;
    const bytes = fixture.kind === "mime" ? Buffer.from("Synthetic type-limit test") : Buffer.alloc(STORAGE_BYTE_LIMIT + 1);
    const mime = fixture.kind === "mime" ? "text/plain" : "image/png";
    const client = createClient(`https://${TEST_PROJECT}.supabase.co`, "sb_publishable_testfixture", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (url, options) => {
        assert.equal(new URL(url).origin, `https://${TEST_PROJECT}.supabase.co`);
        assert.equal(options.method, "POST");
        assert.equal(new Headers(options.headers).get("content-type"), mime);
        assert.equal(new Headers(options.headers).get("x-upsert"), "false");
        assert.equal(options.body.byteLength, fixture.kind === "mime" ? 25 : 8388609);
        requests++; observed = fixture.status;
        return new Response(JSON.stringify(fixture.body), { status: fixture.status, headers: { "content-type": "application/json" } });
      } },
    });
    const result = await client.storage.from("verification-evidence").upload("synthetic/test", bytes, { contentType: mime, upsert: false });
    const logs = [];
    assertStorageLimit(fixture.kind, result, observed, line => logs.push(line));
    assert.equal(requests, 1);
    assert.match(logs[0], new RegExp(`PASS HTTP ${fixture.kind}-restriction:.*actual_http=${fixture.status}`));
    assert.equal(logs.join("\n").includes("private-response-body"), false);
    if (fixture.status === 400 && fixture.body.statusCode) assert.match(logs[0], new RegExp(`actual_http=400; service_status=${fixture.body.statusCode}`));
  });
}
test("limit diagnostics reject success, auth errors, generic size errors, conflicts, 5xx, network failures and wrong categories", () => {
  for (const [kind, result, status] of [
    ["mime", { data: {}, error: null }, 200],
    ["size", { data: {}, error: null }, 200],
    ["mime", { error: { code: "AccessDenied", message: "private-password" } }, 400],
    ["size", { error: { code: "EntityTooLarge" } }, 403],
    ["size", { error: { code: "EntityTooLarge" } }, 500],
    ["size", { error: { message: "private-password" } }, 413],
    ["mime", { error: { code: "InvalidMimeType" } }, 409],
    ["mime", { error: { code: "InvalidMimeType" } }, 429],
    ["mime", { error: { code: "EntityTooLarge" } }, 400],
    ["size", { error: { code: "InvalidMimeType" } }, 400],
    ["size", { error: { statusCode: "413", code: "EntityTooLarge" } }, undefined],
    ["mime", { error: new Error("private-password") }, undefined],
  ]) {
    const logs = [];
    assert.throws(() => assertStorageLimit(kind, result, status, line => logs.push(line)));
    assert.match(logs[0], new RegExp(`FAIL HTTP ${kind}-restriction: expected=`));
    assert.equal(logs.join("\n").includes("private-password"), false);
  }
});
test("numeric HTTP output is bounded and diagnostics suppress all raw error fields", () => {
  for (const value of ["private-token", "400\nprivate-token", true, {}, 0, 600, 400.5]) assert.equal(httpStatus(value), undefined);
  assert.equal(httpStatus("415"), 415);
  const logs = [];
  assert.throws(() => assertStorageLimit("mime", { error: {
    code: "private-token", statusCode: "private-token", error: "private-token", message: "private-token",
    headers: "private-token", originalError: "private-token", stack: "private-token",
  } }, 400, line => logs.push(line)));
  assert.equal(logs[0].includes("private-token"), false);
  assert.match(logs[0], /actual_http=400; service_status=UNAVAILABLE; category=UNKNOWN_STORAGE_ERROR/);
});
test("read-only bucket inspection reports known configuration only and always rolls back/closes", async () => {
  for (const config of [
    { public: false, file_size_limit: 8388608, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] },
    { public: true, file_size_limit: 8388608, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] },
    { public: false, file_size_limit: 10000000, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] },
    { public: false, file_size_limit: 8388608, allowed_mime_types: ["private-token", "image/*"] },
    { public: false, file_size_limit: 8388608, allowed_mime_types: null },
  ]) {
    const queries = [], logs = []; let ended = false;
    const open = async () => ({ query: async sql => {
      queries.push(sql);
      return { command: sql.startsWith("begin") ? "BEGIN" : sql === "rollback" ? "ROLLBACK" : "SELECT", rows: [{ storage_bucket_diagnostic: config }] };
    }, end: async () => { ended = true; } });
    if (config.public === false && config.file_size_limit === 8388608 && config.allowed_mime_types?.length === 3) await inspectStorageBucket(open, line => logs.push(line));
    else await assert.rejects(inspectStorageBucket(open, line => logs.push(line)));
    assert.equal(queries[0], "begin read only");
    assert.equal(queries.at(-1), "rollback"); assert.equal(ended, true);
    assert.equal(queries.some(q => /^(?:update|insert|delete|commit)/i.test(q)), false);
    assert.equal(logs.join("\n").includes("private-token"), false);
  }
});
