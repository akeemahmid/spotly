import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { TEST_PROJECT } from "./run-dispatcher-authorization.mjs";
import { assertStorageLimit, httpStatus } from "./storage-limit-diagnostics.mjs";
import { probeStorageSize, reportTransport } from "./storage-transport.mjs";
import { operationReport, safeEvidenceDiagnostic } from "./evidence-operation-report.mjs";

const realProject = "onfdusisfidlfdmluwxl.supabase.co";
const requestId = "SP-36000000-0000-4000-8000-000000000001";
const planId = "47000000-0000-4000-8000-000000000001";
const bucketName = "verification-evidence";
const fixtureKey = "cd".repeat(32); // Known disposable fixture key; NEVER production.
const httpStages = new Set([
  "login", "fixture-and-unassigned-reads", "assignment-and-acceptance",
  "unauthorized-upload", "bucket-mime-and-size-limits", "fresh-path-signed-url-denials",
  "real-upload-and-known-object-privacy", "immutable-and-alternate-operation-denials",
  "receipt-finalization-and-review", "focused-c-download",
]);
// Never interpolate an arbitrary thrown message, URL, token or stage into logs.
export function safeStorageStage(error) {
  return httpStages.has(error?.storageStage) ? error.storageStage : "setup-or-connection";
}

export function isolatedStorageConfig(env) {
  const fail = () => { throw new Error("ISOLATED_CONFIGURATION_REQUIRED"); };
  if (env.SPOTLY_ISOLATED_TEST !== "yes") fail();
  let url;
  try { url = new URL(env.SPOTLY_TEST_URL); } catch { fail(); }
  if (url.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)
      || url.hostname === realProject || url.hostname !== `${TEST_PROJECT}.supabase.co` || url.origin !== env.SPOTLY_TEST_CONFIRMED_ORIGIN
      || url.username || url.password || url.search || url.hash || url.pathname !== "/") fail();
  const key = env.SPOTLY_TEST_PUBLISHABLE_KEY;
  if (typeof key !== "string") fail();
  // Accept only a publishable key or legacy JWT explicitly identifying the anon role.
  let publicKey = key.startsWith("sb_publishable_") && key.length > 20;
  if (!publicKey) {
    try { publicKey = JSON.parse(Buffer.from(key.split(".")[1], "base64url")).role === "anon"; } catch { /* fail closed */ }
  }
  if (!publicKey) fail();
  const passwords = ["A", "B", "C"].map(label => env[`SPOTLY_TEST_${label}_PASSWORD`]);
  if (passwords.some(p => typeof p !== "string" || !p)) fail();
  return { url: url.origin, key, passwords };
}

export async function runIsolatedStorageCheck(config, report = console.log,
  { create = createClient, fetcher = fetch, onContext = () => {}, onAssignment = () => {}, onReservation = () => {},
    verifyObject, signal, sizeProbe = probeStorageSize } = {}) {
  config = isolatedStorageConfig({ SPOTLY_ISOLATED_TEST: "yes", SPOTLY_TEST_URL: config.url,
    SPOTLY_TEST_CONFIRMED_ORIGIN: `https://${TEST_PROJECT}.supabase.co`, SPOTLY_TEST_PUBLISHABLE_KEY: config.key,
    SPOTLY_TEST_A_PASSWORD: config.passwords?.[0], SPOTLY_TEST_B_PASSWORD: config.passwords?.[1], SPOTLY_TEST_C_PASSWORD: config.passwords?.[2] });
  let stage = "login", lastHTTPStatus, lastError, lastOperation, activeTrace, boundaryFailed = false;
  const check = (condition, reason = "CHECK_FAILED") => { if (!condition) throw new Error(reason); };
  const operations = operationReport(report, { reset: () => { lastHTTPStatus = undefined; lastError = undefined; lastOperation = undefined; },
    http: () => lastHTTPStatus, error: () => lastError, operation: () => lastOperation });
  // Revalidate even programmatic callers; ambient test URLs cannot redirect HTTP.
  check(config.url === `https://${TEST_PROJECT}.supabase.co`);
  check(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0");
  const guardedFetch = (url, options = {}) => {
    const target = new URL(typeof url === "string" ? url : url.url ?? url.toString());
    check(target.origin === config.url && !target.username && !target.password);
    lastHTTPStatus = undefined; // Never attribute an earlier request's headers to a transport failure.
    if (activeTrace) activeTrace.phase = "FETCH_CONNECT_OR_TRANSMIT";
    return Promise.resolve(fetcher(url, { ...options, redirect: "error", signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })).then(response => {
        lastHTTPStatus = httpStatus(response.status); // Numeric status only; no headers or body retained.
        if (activeTrace) { activeTrace.httpStatus = lastHTTPStatus; activeTrace.phase = "RESPONSE_BODY_OR_PARSE"; }
        return response;
      });
  };
  const client = () => create(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: guardedFetch },
  });
  const a = client(), b = client(), c = client(), anon = client();
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const observe = async promise => { lastHTTPStatus = undefined; lastError = undefined; return await promise; };
  const allowed = async (promise, operation) => { if (operation) lastOperation = operation; const r = await observe(promise); lastError = r.error; if (r.error) throw r.error; return r.data; };
  const requireDenied = r => {
    lastError = r.error;
    const status = lastHTTPStatus ?? Number(r.status ?? r.error?.status ?? r.error?.statusCode);
    check(Boolean(r.error), "UNEXPECTED_ALLOW");
    if (![400,401,403,404,409].includes(status)) throw r.error;
  };
  const denied = async (promise, operation) => {
    if (operation) lastOperation = operation;
    requireDenied(await observe(promise));
  };
  const hidden = async (who, table, id) => {
    const rows = await allowed(who.from(table).select("id").eq("id", id));
    check(rows.length === 0);
  };
  const rpc = (who, name, args) => {
    lastOperation = name === "transition_assignment" ? `rpc.transition.${args.operation}` : `rpc.${name}`;
    return who.rpc(name, args);
  };
  const readBytes = async who => {
    const blob = await allowed(who.storage.from(bucketName).download(path), "storage.download");
    return Buffer.from(await blob.arrayBuffer());
  };
  let path;
  try {
    const users = [];
    for (const [i, who] of [a, b, c].entries()) {
      await allowed(who.auth.signInWithPassword({
        email: `pilot-${["a", "b", "c"][i]}@example.test`, password: config.passwords[i],
      }));
      const result = await allowed(who.auth.getUser());
      check(result.user?.email === `pilot-${["a", "b", "c"][i]}@example.test`);
      users.push(result.user.id);
    }
    check(new Set(users).size === 3);
    stage = "fixture-and-unassigned-reads";
    const before = await allowed(a.from("verification_requests").select("*").eq("id", requestId).single());
    const planBefore = await allowed(a.from("verification_plans").select("id,accepted_at,provenance,generated_by,request_fingerprint,version").eq("id", planId).single());
    check(before.created_by === users[0] && before.title === "Synthetic Storage fixture"
      && before.workspace_id === "25000000-0000-4000-8000-000000000001"
      && before.request_fingerprint === planBefore.request_fingerprint
      && planBefore.provenance === "serv_server_v1" && Boolean(planBefore.accepted_at));
    await hidden(b, "verification_requests", requestId);
    await hidden(c, "verification_requests", requestId);
    await hidden(c, "verification_plans", planId);
    await denied(c.from("verification_requests").update({ approved_max_budget: 1 }).eq("id", requestId));
    await denied(c.from("workspace_members").insert({ workspace_id: before.workspace_id, user_id: users[2], role: "dispatcher" }));
    check(await allowed(rpc(a, "phase3b_ready")) === true);
    check(await allowed(rpc(b, "phase3b_ready")) === false);
    await denied(rpc(b, "assign_verification", {
      request_id: "SP-36000000-0000-4000-8000-000000000002",
      selected_plan: "47000000-0000-4000-8000-000000000002", verifier: users[2],
    }));
    const args = { request_id: requestId, selected_plan: planId, verifier: users[2] };
    await denied(rpc(c, "assign_verification", args));
    stage = "assignment-and-acceptance";
    const assignment = await allowed(rpc(a, "assign_verification", args));
    await onAssignment({ assignment, requestId, planId, verifier: users[2] });
    check(assignment === await allowed(rpc(a, "assign_verification", args)));
    await denied(rpc(a, "transition_assignment", { assignment, operation: "accept" }));
    await allowed(rpc(c, "transition_assignment", { assignment, operation: "accept" }));
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#126b53" } }).png().toBuffer();
    const evidence = randomUUID();
    const observation = "Synthetic isolated Storage test; not real field evidence.";
    const expected = { path: `${assignment}/${evidence}`, assignment, evidence, requestId, planId,
      verifier: users[2], mime: "image/png", size: bytes.length };
    // Persist intent BEFORE reserve/upload so an interruption cannot lose the path.
    await onReservation(expected);
    path = await allowed(rpc(c, "reserve_task_evidence", {
      evidence, assignment, observation_text: observation, mime: "image/png", size_bytes: bytes.length,
    }));
    check(path === expected.path, "OBJECT_BINDING_MISMATCH");
    const bucket = c.storage.from(bucketName);
    const trackedUpload = async (test, makeBody, contentType) => {
      lastOperation = "storage.upload";
      const started = Date.now();
      const trace = { transport: "sdk_fetch", phase: "BODY_CONSTRUCTION", deadlineMs: 15000 };
      activeTrace = trace; lastHTTPStatus = undefined;
      let result;
      try {
        const body = makeBody(); trace.phase = "SDK_CALL";
        result = await bucket.upload(path, body, { contentType, upsert: false });
      } catch (error) { result = { error }; }
      trace.httpStatus ??= httpStatus(result.error?.status);
      trace.elapsedMs = Date.now() - started;
      if (!result.error) trace.phase = "COMPLETE";
      reportTransport(test, result.error, trace, report);
      activeTrace = undefined;
      return result;
    };
    await onContext({ ...expected, verifyDeleted: async () => {
      const result = await bucket.download(path);
      check(Boolean(result.error) && (Number(result.error.status ?? result.error.statusCode) === 404 ||
        result.error.code === 'NoSuchKey' || /^(?:Object not found|The resource was not found)/i.test(result.error.message ?? '')));
    } });
    stage = "unauthorized-upload";
    await denied(b.storage.from(bucketName).upload(path, bytes, { contentType: "image/png", upsert: false }));
    await denied(anon.storage.from(bucketName).upload(path, bytes, { contentType: "image/png", upsert: false }));
    report("PASS HTTP unauthorized upload denied on fresh reserved path");
    stage = "bucket-mime-and-size-limits";
    const badMime = await trackedUpload("mime-probe", () => Buffer.from("Synthetic type-limit test"), "text/plain");
    assertStorageLimit("mime", badMime, lastHTTPStatus, report);
    const session = await allowed(c.auth.getSession());
    check(typeof session.session?.access_token === "string" && session.session.access_token.length > 0);
    report("INFO size boundary uses native HTTPS on the same ordinary upload endpoint/user/reservation; verified TLS; no SDK large-file or resumable-upload pass is inferred.");
    const oversized = await sizeProbe({ path, key: config.key, token: session.session.access_token, signal });
    reportTransport("size-probe", oversized.error, oversized.transport, report);
    try { assertStorageLimit("size", oversized, oversized.transport?.httpStatus, report); }
    catch (error) {
      // A missing response remains a failed security assertion. Still exercise
      // the ordinary small-image workflow to isolate bulk-transport failure.
      if (httpStatus(oversized.transport?.httpStatus) || httpStatus(oversized.error?.status) || signal?.aborted) throw error;
      boundaryFailed = true;
      report("FAIL size boundary remains unresolved; continuing the small-image SDK control/workflow. Overall security result will remain FAIL.");
    }
    if (!boundaryFailed) report("PASS HTTP MIME and 8 MiB size limits (specific rejection reasons)");
    stage = "fresh-path-signed-url-denials";
    for (const upsert of [false, true]) await denied(bucket.createSignedUploadUrl(path, { upsert }));
    await denied(bucket.createSignedUrl(path, 60));
    stage = "real-upload-and-known-object-privacy";
    const uploaded = await operations.run(1, () => allowed(trackedUpload("small-upload", () => bytes, "image/png")));
    await operations.run(2, async () => {
      lastOperation = "catalog.confirm-exact-object";
      check(uploaded?.path === path, "OBJECT_BINDING_MISMATCH");
      check(typeof verifyObject === "function", "OBJECT_BINDING_MISMATCH");
      await verifyObject(expected); // Fresh read-only catalog check, not an HTTP privacy claim.
    });
    await operations.run(3, async () => check(hash(await readBytes(c)) === hash(bytes), "BYTE_INTEGRITY_MISMATCH"));
    await operations.run(4, async () => check(hash(await readBytes(a)) === hash(bytes), "BYTE_INTEGRITY_MISMATCH"));
    report("PASS HTTP authorized upload and authorized byte-for-byte downloads");
    await operations.run(5, () => denied(b.storage.from(bucketName).download(path), "storage.download"));
    await operations.run(6, () => denied(anon.storage.from(bucketName).download(path), "storage.download"));
    const publicResponse = await guardedFetch(anon.storage.from(bucketName).getPublicUrl(path).data.publicUrl);
    check([400, 401, 403, 404].includes(publicResponse.status));
    await publicResponse.body?.cancel();
    report("PASS HTTP known-object cross-workspace, anonymous and public downloads denied");
    stage = "immutable-and-alternate-operation-denials";
    await operations.run(7, async () => {
      await denied(bucket.upload(path, bytes, { contentType: "image/png", upsert: true }), "storage.upload-upsert");
      await denied(bucket.update(path, bytes, { contentType: "image/png" }), "storage.update");
      check(hash(await readBytes(c)) === hash(bytes), "BYTE_INTEGRITY_MISMATCH");
    });
    await denied(bucket.copy(path, `${assignment}/${randomUUID()}`));
    await denied(bucket.move(path, `${assignment}/${randomUUID()}`));
    const listed = await allowed(bucket.list(assignment));
    check(listed.length === 0);
    // Storage may return success with zero affected rows under restrictive RLS.
    await operations.run(8, async () => { for (const who of [b, anon, c]) {
      lastOperation = "storage.remove";
      const removed = await observe(who.storage.from(bucketName).remove([path]));
      if (removed.error) requireDenied(removed);
      else check(removed.data.length === 0);
    }
    check(hash(await readBytes(c)) === hash(bytes), "BYTE_INTEGRITY_MISMATCH"); });
    report("PASS HTTP overwrites, update, copy, move and application deletion denied; original bytes survive");
    stage = "receipt-finalization-and-review";
    const payload = JSON.stringify({ purpose: "spotly.evidence.v1", id: evidence,
      assignmentId: assignment, userId: users[2], path, observation, location: null,
      mime: "image/png", size: bytes.length, sha256: hash(bytes), issuedAt: new Date().toISOString() });
    const signature = createHmac("sha256", Buffer.from(fixtureKey, "hex")).update(payload).digest("hex");
    await operations.run(9, async () => {
      await denied(rpc(c, "submit_task_evidence", { payload, signature: "00".repeat(32) }));
      await allowed(rpc(c, "submit_task_evidence", { payload, signature }));
      await allowed(rpc(c, "submit_task_evidence", { payload, signature }));
    });
    const review = { assignment, operation: "approve", selected_evidence: evidence };
    await denied(rpc(c, "transition_assignment", review));
    await denied(rpc(b, "transition_assignment", review));
    await denied(rpc(a, "transition_assignment", { ...review, operation: "complete" }));
    for (const who of [a, b, c]) await denied(who.storage.from(bucketName).createSignedUrl(path, 60));
    for (const upsert of [false, true]) await denied(bucket.createSignedUploadUrl(path, { upsert }));
    await denied(bucket.upload(path, bytes, { contentType: "image/png", upsert: true }));
    await operations.run(10, async () => {
      await allowed(rpc(a, "transition_assignment", review));
      await allowed(rpc(a, "transition_assignment", { ...review, operation: "complete" }));
      await allowed(rpc(a, "transition_assignment", { ...review, operation: "complete" }));
      const finished = await allowed(a.from("task_assignments").select("status").eq("id", assignment).single(), "assignment.read-state");
      check(finished.status === "completed");
    });
    await hidden(b, "task_evidence", evidence);
    await denied(b.storage.from(bucketName).download(path));
    await denied(anon.storage.from(bucketName).download(path));
    check(hash(await readBytes(a)) === hash(bytes) && hash(await readBytes(c)) === hash(bytes));
    const after = await allowed(a.from("verification_requests").select("*").eq("id", requestId).single());
    const planAfter = await allowed(a.from("verification_plans").select("id,accepted_at,provenance,generated_by,request_fingerprint,version").eq("id", planId).single());
    check(JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(planBefore) === JSON.stringify(planAfter));
    report("PASS: real dedicated-account RPC and small-image Storage workflow; synthetic disposable fixture only.");
    report("NOT TESTED: browser/server photo route, TUS/S3, previously issued signed-upload token replay, gate shutdown and membership revocation. Complete the manual checklist.");
    if (boundaryFailed) { stage = "bucket-mime-and-size-limits"; throw new Error("SIZE_BOUNDARY_UNVERIFIED"); }
  } catch (error) {
    report(`FAIL HTTP stage ${stage}; ${safeEvidenceDiagnostic(error, lastHTTPStatus)} (private details suppressed)`);
    // Never print SDK errors, URLs, passwords, tokens, receipts or signatures.
    throw Object.assign(new Error(`Isolated check failed at ${stage}. Stop and inspect privately; do not retry blindly.`), { storageStage: stage });
  } finally { operations.summary(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error("Use scripts/run-storage-security.mjs so test gates and fixture cleanup are verified.");
  process.exitCode = 1;
}
