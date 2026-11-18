import { request as httpsRequest } from "node:https";
import { checkServerIdentity } from "node:tls";
import { TEST_PROJECT } from "./run-dispatcher-authorization.mjs";
import { httpStatus, STORAGE_BYTE_LIMIT } from "./storage-limit-diagnostics.mjs";

const names = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "StorageUnknownError", "StorageApiError", "StorageHTTPError", "FetchError"]);
const codes = new Set([
  "ECONNRESET", "EPIPE", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPROTO", "ABORT_ERR",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "ERR_STREAM_PREMATURE_CLOSE", "ERR_HTTP_CONTENT_LENGTH_MISMATCH", "ERR_INVALID_ARG_TYPE", "ERR_OUT_OF_RANGE",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "InvalidMimeType", "EntityTooLarge", "RESPONSE_TOO_LARGE",
]);
const phases = new Set(["VALIDATION", "BODY_CONSTRUCTION", "REQUEST_CONSTRUCTION", "CONNECT_TLS", "AWAITING_CONTINUE",
  "HTTP_TRANSMISSION", "WAITING_RESPONSE", "RESPONSE_BODY", "RESPONSE_PARSE", "RESPONSE_BODY_OR_PARSE", "SDK_CALL", "FETCH_CONNECT_OR_TRANSMIT", "COMPLETE"]);
export function transportDetails(error, trace = {}) {
  const pending = [error], seen = new Set(), chain = [];
  while (pending.length && chain.length < 8) {
    const next = pending.shift();
    if (!next || typeof next !== "object" || seen.has(next)) continue;
    seen.add(next); chain.push(next);
    pending.push(next.originalError, next.cause); // SDK wrapper and native fetch causes.
  }
  const code = chain.map(e => e.code).find(value => codes.has(value));
  const timeout = trace.deadlineExceeded ? "REQUEST_DEADLINE" : trace.cancelled ? "USER_ABORT" :
    code === "UND_ERR_CONNECT_TIMEOUT" ? "CONNECT_TIMEOUT" : code === "UND_ERR_HEADERS_TIMEOUT" ? "HEADERS_TIMEOUT" :
    code === "UND_ERR_BODY_TIMEOUT" ? "BODY_TIMEOUT" : code === "ETIMEDOUT" ? "UNSPECIFIED_TIMEOUT" :
    chain.some(e => e.name === "TimeoutError") ? "REQUEST_TIMEOUT" : chain.some(e => e.name === "AbortError") ? "ABORTED" : "NOT_IDENTIFIED";
  return {
    transport: ["native_https", "sdk_fetch"].includes(trace.transport) ? trace.transport : "UNKNOWN",
    phase: phases.has(trace.phase) ? trace.phase : "UNKNOWN",
    error_name: names.has(error?.name) ? error.name : error ? "UNKNOWN" : "NONE",
    cause_name: chain.slice(1).map(e => e.name).filter(name => names.has(name)).at(-1) ?? "NONE",
    known_code: code ?? "UNKNOWN", timeout,
    request_code: codes.has(trace.requestCode) ? trace.requestCode : "NONE",
    actual_http: httpStatus(trace.httpStatus) ?? "UNAVAILABLE",
    elapsed_ms: Number.isSafeInteger(trace.elapsedMs) && trace.elapsedMs >= 0 ? trace.elapsedMs : "UNAVAILABLE",
    deadline_ms: [15000, 90000].includes(trace.deadlineMs) ? trace.deadlineMs : "TEST_OR_UNKNOWN",
    body_queued: typeof trace.bodyQueued === "boolean" ? trace.bodyQueued : "UNOBSERVED",
  };
}
export function reportTransport(test, error, trace, report = console.log) {
  const label = ["mime-probe", "size-probe", "small-upload"].includes(test) ? test : "UNKNOWN";
  const details = transportDetails(error, trace);
  report(`INFO transport ${label}: ${Object.entries(details).map(([key, value]) => `${key}=${value}`).join("; ")}`);
}

// Test-only ordinary POST, with EXACT same user/RLS/operation/bucket/path as
// SDK upload. Never uses signed URLs, TUS, a service key or a different origin.
// Expect/Content-Length let an early rejection arrive before the body is sent;
// after 1s without a final response/100 Continue the actual full body is queued.
export async function probeStorageSize({ path, key, token, signal }, {
  request = httpsRequest, makeBody = () => Buffer.alloc(STORAGE_BYTE_LIMIT + 1),
  deadlineMs = 90000, continueMs = 1000,
} = {}) {
  const started = Date.now();
  const trace = { transport: "native_https", phase: "VALIDATION", deadlineMs, bodyQueued: false };
  const failure = error => ({ error, transport: { ...trace, elapsedMs: Date.now() - started } });
  let body;
  try {
    if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(path ?? "") || !key?.startsWith("sb_publishable_") ||
      typeof token !== "string" || !token || !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 90000 ||
      !Number.isInteger(continueMs) || continueMs < 1 || continueMs > 1000 || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("PROBE_CONFIGURATION_INVALID");
    trace.phase = "BODY_CONSTRUCTION";
    body = makeBody();
    if (!Buffer.isBuffer(body) || body.length !== STORAGE_BYTE_LIMIT + 1) throw new Error("PROBE_BODY_INVALID");
  } catch (error) { return failure(error); }
  return new Promise(resolve => {
    let req, response, deadline, continueTimer, finished = false, responseStarted = false;
    const finish = result => {
      if (finished) return;
      finished = true; clearTimeout(deadline); clearTimeout(continueTimer);
      signal?.removeEventListener("abort", cancel);
      resolve({ ...result, transport: { ...trace, elapsedMs: Date.now() - started } });
      response?.destroy(); req?.destroy();
    };
    const fail = error => finish({ error });
    const cancel = () => { trace.cancelled = true; fail(Object.assign(new Error("PROBE_ABORTED"), { name: "AbortError", code: "ABORT_ERR" })); };
    const sendBody = () => {
      if (finished || responseStarted || trace.bodyQueued) return;
      clearTimeout(continueTimer); trace.phase = "HTTP_TRANSMISSION"; trace.bodyQueued = true;
      try { req.end(body); } catch (error) { fail(error); }
    };
    try {
      if (signal?.aborted) { cancel(); return; }
      signal?.addEventListener("abort", cancel, { once: true });
      trace.phase = "REQUEST_CONSTRUCTION";
      req = request({ protocol: "https:", hostname: `${TEST_PROJECT}.supabase.co`, port: 443,
        method: "POST", path: `/storage/v1/object/verification-evidence/${path}`, agent: false,
        rejectUnauthorized: true, servername: `${TEST_PROJECT}.supabase.co`, checkServerIdentity,
        headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "image/png",
          "Content-Length": String(body.length), "x-upsert": "false", Expect: "100-continue" },
      });
      trace.phase = "CONNECT_TLS";
      req.on("socket", socket => socket.once("secureConnect", () => {
        if (!finished && !responseStarted && !trace.bodyQueued) trace.phase = "AWAITING_CONTINUE";
      }));
      req.on("continue", sendBody);
      req.on("finish", () => { if (!finished && !responseStarted) trace.phase = "WAITING_RESPONSE"; });
      req.on("error", error => {
        // A complete, specific HTTP rejection is authoritative even if the
        // server closes the upload side early. An incomplete response still fails.
        trace.requestCode = codes.has(error.code) ? error.code : "UNKNOWN";
        if (!responseStarted) fail(error);
      });
      req.on("response", res => {
        response = res; responseStarted = true; clearTimeout(continueTimer);
        trace.httpStatus = httpStatus(res.statusCode); trace.phase = "RESPONSE_BODY";
        const chunks = []; let length = 0;
        res.on("error", fail);
        res.on("aborted", () => fail(Object.assign(new Error("INCOMPLETE_RESPONSE"), { code: "ERR_STREAM_PREMATURE_CLOSE" })));
        res.on("close", () => { if (!finished && !res.complete) fail(Object.assign(new Error("INCOMPLETE_RESPONSE"), { code: "ERR_STREAM_PREMATURE_CLOSE" })); });
        res.on("data", chunk => {
          length += chunk.length;
          if (length > 16384) fail(Object.assign(new Error("BOUNDED_RESPONSE_REQUIRED"), { code: "RESPONSE_TOO_LARGE" }));
          else chunks.push(chunk);
        });
        res.on("end", () => {
          if (finished) return;
          trace.phase = "RESPONSE_PARSE";
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            trace.phase = "COMPLETE";
            if (trace.httpStatus >= 200 && trace.httpStatus < 300) finish({ data: {}, error: null });
            else finish({ error: { name: "StorageHTTPError", status: trace.httpStatus,
              statusCode: httpStatus(value?.statusCode),
              code: typeof value?.code === "string" ? value.code : undefined,
              message: typeof value?.message === "string" ? value.message : typeof value?.error === "string" ? value.error : "UNRECOGNIZED_RESPONSE",
            } });
          } catch (error) { fail(error); }
        });
      });
      deadline = setTimeout(() => { trace.deadlineExceeded = true; fail(Object.assign(new Error("PROBE_DEADLINE"), { name: "TimeoutError" })); }, deadlineMs);
      continueTimer = setTimeout(sendBody, continueMs);
      req.flushHeaders();
    } catch (error) { fail(error); }
  });
}
