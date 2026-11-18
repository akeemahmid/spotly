import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { isolatedStorageConfig } from "./isolated-storage-check.mjs";
import { TEST_PROJECT, check } from "./security-test-db.mjs";
import { httpStatus } from "./storage-limit-diagnostics.mjs";
import { safeEvidenceDiagnostic } from "./evidence-operation-report.mjs";

const serviceCodes = new Set(["NoSuchKey", "NoSuchBucket", "not_found", "AccessDenied", "Unauthorized", "InvalidJWT", "InvalidKey", "InvalidRequest", "InvalidArgument", "InvalidParameter", "MissingParameter", "InvalidRange", "S3Error", "InternalError", "DatabaseError", "DatabaseTimeout", "DatabaseSchemaMismatch", "ExpiredToken", "TenantNotFound"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// SDK drops the wire `error` field on older/legacy responses. Keep only known
// codes/statuses and a UUID for private platform-log correlation, never raw JSON.
export async function safeStorageResponse(response) {
  const value = { actual_http: httpStatus(response.status) ?? "UNAVAILABLE", service_code: "UNAVAILABLE", service_error: "UNAVAILABLE", service_http: "UNAVAILABLE", body: "NOT_READ",
    request_id: uuid.test(response.headers.get("sb-request-id") ?? "") ? response.headers.get("sb-request-id") : "UNAVAILABLE" };
  if (response.ok) return value;
  const reader = response.clone().body?.getReader();
  if (!reader) return value;
  try {
    let size = 0; const chunks = [];
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > 16384) { value.body = "TOO_LARGE"; return value; }
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    value.body = "JSON";
    value.service_code = serviceCodes.has(body?.code) ? body.code : "UNKNOWN";
    value.service_error = serviceCodes.has(body?.error) ? body.error : "UNKNOWN";
    value.service_http = httpStatus(body?.statusCode) ?? "UNAVAILABLE";
  } catch { value.body = "UNREADABLE_OR_NON_JSON"; }
  finally { reader.cancel().catch(() => {}); }
  return value;
}
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

// Called ONLY by the existing manual fixture/journal/gate/cleanup wrapper.
// No finalization, review, size probes, alternate routes, retries or browser gate.
export async function reproduceCDownload(config, report, {
  create = createClient, fetcher = fetch, signal, onAssignment, onReservation, onContext,
  verifyObject, verifyDownloadAccess,
} = {}) {
  config = isolatedStorageConfig({ SPOTLY_ISOLATED_TEST: "yes", SPOTLY_TEST_URL: config.url,
    SPOTLY_TEST_CONFIRMED_ORIGIN: `https://${TEST_PROJECT}.supabase.co`, SPOTLY_TEST_PUBLISHABLE_KEY: config.key,
    SPOTLY_TEST_A_PASSWORD: config.passwords?.[0], SPOTLY_TEST_B_PASSWORD: config.passwords?.[1], SPOTLY_TEST_C_PASSWORD: config.passwords?.[2] });
  check(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0");
  let stage = "login", download, wire, caller, expected;
  const transport = async (input, init = {}) => {
    const target = new URL(typeof input === "string" ? input : input.url ?? input.toString());
    check(target.origin === config.url && !target.username && !target.password);
    const isDownload = init.method === "GET" && target.pathname.startsWith("/storage/v1/object/");
    if (isDownload && caller) {
      const headers = new Headers(init.headers ?? input.headers);
      const facts = { exact_path: target.pathname === `/storage/v1/object/verification-evidence/${expected.path}` && !target.search,
        same_verified_c_token: headers.get("Authorization") === `Bearer ${caller.token}`, public_key_matches: headers.get("apikey") === config.key };
      report(`HTTP C download caller: ${Object.entries(facts).map(([k,v]) => `${k}=${v}`).join("; ")}`);
      check(Object.values(facts).every(Boolean));
    }
    const response = await fetcher(input, { ...init, redirect: "error", signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (isDownload) {
      wire = await safeStorageResponse(response);
      report(`HTTP download response: ${Object.entries(wire).map(([k,v]) => `${k}=${v}`).join("; ")}`);
    }
    return response;
  };
  const make = () => create(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport } });
  const a = make(), b = make(), c = make(), anonymous = make();
  const allow = async promise => { const result = await promise; if (result.error) throw result.error; return result.data; };
  const bucket = c.storage.from("verification-evidence");
  try {
    const users = [];
    for (const [i, who] of [a,b,c].entries()) {
      await allow(who.auth.signInWithPassword({ email: `pilot-${["a","b","c"][i]}@example.test`, password: config.passwords[i] }));
      const { user } = await allow(who.auth.getUser());
      check(user?.email === `pilot-${["a","b","c"][i]}@example.test`);
      users.push(user.id);
    }
    check(new Set(users).size === 3);
    stage = "assignment-and-reservation";
    const requestId = "SP-36000000-0000-4000-8000-000000000001", planId = "47000000-0000-4000-8000-000000000001";
    const assignment = await allow(a.rpc("assign_verification", { request_id: requestId, selected_plan: planId, verifier: users[2] }));
    await onAssignment({ assignment, requestId, planId, verifier: users[2] });
    await allow(c.rpc("transition_assignment", { assignment, operation: "accept" }));
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#126b53" } }).png().toBuffer();
    const evidence = randomUUID();
    expected = { path: `${assignment}/${evidence}`, assignment, evidence, requestId, planId, verifier: users[2], mime: "image/png", size: bytes.length };
    await onReservation(expected); // Existing durable manifest, BEFORE remote reservation/upload.
    const path = await allow(c.rpc("reserve_task_evidence", { evidence, assignment,
      observation_text: "Synthetic isolated Storage test; not real field evidence.", mime: "image/png", size_bytes: bytes.length }));
    check(path === expected.path);
    await onContext({ ...expected, verifyDeleted: async () => {
      caller = undefined;
      const result = await bucket.download(path);
      check(Boolean(result.error) && (Number(result.error.statusCode) === 404 || ["NoSuchKey", "not_found"].includes(result.error.code) || result.error.message === "Object not found"));
    } });
    stage = "upload-and-catalog";
    const uploaded = await allow(bucket.upload(path, bytes, { contentType: "image/png", upsert: false }));
    check(uploaded?.path === path);
    report("PASS focused C upload (ordinary SDK, no overwrite)");
    await verifyObject(expected);
    stage = "verify-caller";
    const { session } = await allow(c.auth.getSession());
    check(typeof session?.access_token === "string");
    const { user } = await allow(c.auth.getUser(session.access_token)); // Auth verifies EXACT token used below.
    const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
    const identity = { auth_verified_c: user?.id === users[2] && user.email === "pilot-c@example.test",
      jwt_subject_matches: claims.sub === users[2], jwt_role_authenticated: claims.role === "authenticated",
      jwt_issuer_matches: claims.iss === `${config.url}/auth/v1`, jwt_unexpired: Number.isFinite(claims.exp) && claims.exp > Date.now()/1000 };
    report(`AUTH focused C caller: ${Object.entries(identity).map(([k,v]) => `${k}=${v}`).join("; ")}`);
    check(Object.values(identity).every(Boolean));
    caller = { token: session.access_token };
    stage = "c-download";
    wire = undefined;
    download = await bucket.download(path); // ONE C GET; no retry or URL workaround.
    const cWire = wire;
    report(`${download.error ? "FAIL" : "INFO"} focused C download: ${safeEvidenceDiagnostic(download.error, cWire?.actual_http)}`);
    caller = undefined;
    stage = "independent-c-authorization";
    const authorization = await verifyDownloadAccess(expected, claims);
    // B/anonymous are independent controls even if C's GET failed. A is useful
    // only after C's successful readback; no finalization is attempted here.
    stage = "unauthorized-controls";
    for (const [label, who] of [["B",b],["anonymous",anonymous]]) {
      const denied = await who.storage.from("verification-evidence").download(path);
      check(Boolean(denied.error) && [400,401,403,404].includes(httpStatus(wire?.actual_http) ?? httpStatus(denied.error.status)));
      report(`CONTROL focused ${label} download: no bytes returned; HTTP denial only (not independent RLS proof)`);
    }
    stage = "result";
    if (download.error) {
      report(authorization?.verified && (!authorization.effective || !authorization.visible)
        ? "DIAGNOSIS RLS denial reproduced in independent SQL; inspect the false relationship/complete USING result. This is not proof of the Storage service's internal context."
        : "DIAGNOSIS download failure remains unresolved: if independent SQL permits the read, use the safe response code/request ID to distinguish hosted request context from missing backing bytes/backend failure in private Storage logs.");
      throw download.error;
    }
    check(cWire?.actual_http === 200 && hash(Buffer.from(await download.data.arrayBuffer())) === hash(bytes));
    check(authorization?.verified && authorization.effective && authorization.visible && authorization.relationships);
    const aBytes = await allow(a.storage.from("verification-evidence").download(path));
    check(hash(Buffer.from(await aBytes.arrayBuffer())) === hash(bytes));
    report("PASS focused C/A byte readback and B/anonymous denial; finalization/review/browser workflow NOT RUN; guarded cleanup follows");
  } catch (error) {
    report(`FAIL focused reproduction [${stage}]; ${safeEvidenceDiagnostic(error)}; private details suppressed`);
    throw Object.assign(new Error("FOCUSED_DOWNLOAD_FAILED"), { storageStage: "focused-c-download" });
  }
}
