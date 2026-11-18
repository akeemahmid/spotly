import test from "node:test";
import assert from "node:assert/strict";
import { reproduceCDownload, safeStorageResponse } from "./reproduce-c-download.mjs";
import { createClient } from "@supabase/supabase-js";

const origin = "https://ogqmifuylakjhwveqrmd.supabase.co";
const config = { url: origin, key: "sb_publishable_focused_synthetic_only", passwords: ["synthetic-a", "synthetic-b", "synthetic-c"] };
const assignment = "69000000-0000-4000-8000-000000000001";
const ids = Object.fromEntries(["a","b","c"].map((label, i) => [label, `18000000-0000-4000-8000-00000000000${i+1}`]));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "sb-request-id": "19000000-0000-4000-8000-000000000001" } });
function fixture(failC = false) {
  const tokens = new Map(), calls = [], logs = [], events = [];
  let bytes, path, context;
  const fetcher = async (input, init) => {
    const url = new URL(input), headers = new Headers(init.headers);
    assert.equal(url.origin, origin);
    if (url.pathname === "/auth/v1/token") {
      const label = JSON.parse(init.body).email.slice(6,7);
      const user = { id: ids[label], email: `pilot-${label}@example.test`, role: "authenticated", aud: "authenticated" };
      const claims = { sub: user.id, role: "authenticated", iss: `${origin}/auth/v1`, exp: Math.floor(Date.now()/1000)+3600 };
      const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic-signature`;
      tokens.set(`Bearer ${token}`, { label, user });
      return json({ user, access_token: token, refresh_token: `synthetic-refresh-${label}`, token_type: "bearer", expires_in: 3600 });
    }
    const identity = tokens.get(headers.get("Authorization")), role = identity?.label ?? "anonymous";
    calls.push(`${role}:${init.method}:${url.pathname}`);
    if (url.pathname === "/auth/v1/user") return json(identity.user);
    const rpc = url.pathname.split("/rpc/")[1];
    if (rpc) {
      const args = JSON.parse(init.body);
      if (rpc === "assign_verification") { assert.equal(role, "a"); return json(assignment); }
      if (rpc === "transition_assignment") { assert.equal(role, "c"); assert.equal(args.operation, "accept"); return json(null); }
      if (rpc === "reserve_task_evidence") { assert.equal(role, "c"); path = `${assignment}/${args.evidence}`; return json(path); }
      assert.fail("Unexpected RPC in focused reproduction");
    }
    assert.equal(url.pathname, `/storage/v1/object/verification-evidence/${path}`);
    if (init.method === "POST") {
      assert.equal(role, "c"); assert.equal(headers.get("x-upsert"), "false");
      bytes = Buffer.from(await new Response(init.body).arrayBuffer());
      return json({ Key: `verification-evidence/${path}` });
    }
    if (bytes && ["a","c"].includes(role) && !(failC && role === "c")) return new Response(bytes, { status: 200 });
    return json({ statusCode: "404", code: "NoSuchKey", error: "not_found", message: "Object not found", details: "private-backend-secret" }, 400);
  };
  const options = { fetcher, onAssignment: async () => events.push("assignment-journal"),
    onReservation: async () => events.push("reservation-journal"), onContext: value => { context = value; },
    verifyObject: async expected => { events.push("catalog"); assert.equal(expected.path, path); assert.equal(expected.size, bytes.length); },
    verifyDownloadAccess: async (expected, claims) => {
      events.push("independent-sql");
      assert.equal(expected.path, path); assert.equal(claims.sub, ids.c); assert.equal(claims.role, "authenticated");
      assert.ok(calls.some(call => call === `c:GET:/storage/v1/object/verification-evidence/${path}`));
      return { verified: true, effective: true, visible: true, relationships: true };
    } };
  return { options, logs, calls, events, report: line => logs.push(line), get context() { return context; }, erase: () => { bytes = undefined; } };
}
test("focused reproduction captures real SDK C GET wire code/caller, independently checks authorization even after HTTP 400, and never finalizes", async () => {
  const f = fixture(true);
  await assert.rejects(reproduceCDownload(config, f.report, f.options), /FOCUSED_DOWNLOAD_FAILED/);
  const output = f.logs.join("\n");
  assert.ok(output.includes("same_verified_c_token=true; public_key_matches=true"));
  assert.ok(output.includes("auth_verified_c=true; jwt_subject_matches=true; jwt_role_authenticated=true; jwt_issuer_matches=true; jwt_unexpired=true"));
  assert.ok(output.includes("actual_http=400; service_code=NoSuchKey; service_error=not_found; service_http=404"));
  assert.ok(output.includes("HTTP_SQL_DISAGREEMENT") || output.includes("download failure remains unresolved"));
  assert.deepEqual(f.events, ["assignment-journal", "reservation-journal", "catalog", "independent-sql"]);
  assert.equal(f.calls.filter(call => /c:GET:.*storage\/v1/.test(call)).length, 1);
  assert.ok(f.calls.some(call => /b:GET:.*storage\/v1/.test(call)));
  assert.ok(f.calls.some(call => /anonymous:GET:.*storage\/v1/.test(call)));
  assert.ok(!f.calls.some(call => /submit_task_evidence|\/object\/(?:sign|list|copy|move)/.test(call)));
  assert.ok(!/synthetic-signature|synthetic-password|synthetic-refresh|private-backend-secret|sb_publishable_/.test(output));
});
test("focused success reads exact C/A bytes and unauthorized denials, then leaves cleanup to existing wrapper", async () => {
  const f = fixture();
  await reproduceCDownload(config, f.report, f.options);
  assert.ok(f.logs.some(line => line.includes("finalization/review/browser workflow NOT RUN")));
  f.erase(); await f.context.verifyDeleted();
});
test("failed independent authorization cannot be hidden by a successful C download", async () => {
  const f = fixture();
  await assert.rejects(reproduceCDownload(config, f.report, { ...f.options, verifyDownloadAccess: async () => ({ verified: false }) }), /FOCUSED_DOWNLOAD_FAILED/);
});
test("a different bearer token on the actual C GET is detected before that request can leave the process", async () => {
  const f = fixture(); let created = 0;
  const create = (url, key, options) => {
    const index = created++;
    return createClient(url, key, { ...options, global: { fetch: (input, init) => {
      if (index === 2 && init.method === "GET" && new URL(input).pathname.startsWith("/storage/v1/object/")) {
        const headers = new Headers(init.headers); headers.set("Authorization", "Bearer private-wrong-token");
        return options.global.fetch(input, { ...init, headers });
      }
      return options.global.fetch(input, init);
    } } });
  };
  await assert.rejects(reproduceCDownload(config, f.report, { ...f.options, create, verifyDownloadAccess: async () => ({ verified: false }) }), /FOCUSED_DOWNLOAD_FAILED/);
  assert.ok(f.logs.some(line => line.includes("same_verified_c_token=false")));
  assert.equal(f.calls.filter(call => /c:GET:.*storage\/v1/.test(call)).length, 0);
  assert.ok(!f.logs.join("\n").includes("private-wrong-token"));
});
test("bounded wire capture preserves the original response and emits only allowlisted fields", async () => {
  const response = json({ code: "InvalidRequest", error: "private-secret", statusCode: "400\nprivate-token", message: "private-key", details: { password: "private-password" } }, 400);
  response.headers.set("sb-request-id", "private-secret");
  const result = await safeStorageResponse(response);
  assert.equal(result.service_code, "InvalidRequest"); assert.equal(result.service_error, "UNKNOWN");
  assert.equal(result.service_http, "UNAVAILABLE"); assert.equal(result.request_id, "UNAVAILABLE");
  assert.ok(!JSON.stringify(result).includes("private-"));
  assert.equal((await response.json()).code, "InvalidRequest");
  assert.equal((await safeStorageResponse(new Response("x".repeat(20000), { status: 400 }))).body, "TOO_LARGE");
});
