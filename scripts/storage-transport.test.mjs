import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { checkServerIdentity } from "node:tls";
import { probeStorageSize, transportDetails, reportTransport } from "./storage-transport.mjs";
import { assertStorageLimit, STORAGE_BYTE_LIMIT } from "./storage-limit-diagnostics.mjs";
import { TEST_PROJECT } from "./security-test-db.mjs";

const config = { path: "69000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000001",
  key: "sb_publishable_testfixture", token: "private-token" };
function transport(mode, status = 413, value = { code: "EntityTooLarge", message: "private-response-body" }) {
  let body, options, destroyed = false;
  const request = input => {
    options = input;
    const req = new EventEmitter();
    req.end = data => { body = data; req.emit("finish"); };
    req.destroy = () => { destroyed = true; };
    req.flushHeaders = () => queueMicrotask(() => {
      if (mode === "timeout" || mode === "abort") return;
      if (mode === "reset" || mode === "tls") {
        req.emit("error", Object.assign(new Error("private-host-and-credentials"), { code: mode === "reset" ? "ECONNRESET" : "ERR_TLS_CERT_ALTNAME_INVALID" })); return;
      }
      if (mode === "continue") req.emit("continue");
      const res = new EventEmitter(); res.statusCode = status; res.destroy = () => {};
      req.emit("response", res);
      if (mode === "early-pipe-error") req.emit("error", Object.assign(new Error("private-token"), { code: "EPIPE" }));
      if (mode === "incomplete") { res.emit("aborted"); return; }
      res.emit("data", Buffer.from(mode === "bad-json" ? "private-not-json" : JSON.stringify(value)));
      res.emit("end");
    });
    return req;
  };
  return { request, get body() { return body; }, get options() { return options; }, get destroyed() { return destroyed; } };
}
for (const mode of ["early-rejection", "continue", "early-pipe-error"]) {
  test(`native HTTPS ${mode} requires a complete specific rejection, uses fixed origin and verified TLS`, async () => {
    const f = transport(mode);
    const result = await probeStorageSize(config, { request: f.request });
    assertStorageLimit("size", result, result.transport.httpStatus, () => {});
    assert.equal(result.transport.phase, "COMPLETE");
    assert.equal(f.options.hostname, `${TEST_PROJECT}.supabase.co`);
    assert.equal(f.options.servername, f.options.hostname);
    assert.equal(f.options.checkServerIdentity, checkServerIdentity);
    assert.equal(f.options.rejectUnauthorized, true);
    assert.equal(f.options.method, "POST"); assert.equal(f.options.agent, false);
    assert.equal(f.options.path, `/storage/v1/object/verification-evidence/${config.path}`);
    assert.equal(f.options.headers["x-upsert"], "false");
    assert.equal(f.options.headers["Content-Length"], "8388609");
    assert.equal(f.options.headers["Content-Type"], "image/png");
    assert.equal(f.options.headers.Expect, "100-continue");
    assert.equal(f.body?.length, mode === "continue" ? STORAGE_BYTE_LIMIT + 1 : undefined);
    assert.equal(f.destroyed, true);
    const logs = []; reportTransport("size-probe", result.error, result.transport, x => logs.push(x));
    assert.ok(!logs.join("\n").includes("private-"));
  });
}
for (const mode of ["reset", "tls", "timeout", "bad-json", "incomplete"]) {
  test(`native HTTPS ${mode} reports a safe phase/code and never satisfies size enforcement`, async () => {
    const f = transport(mode);
    const result = await probeStorageSize(config, { request: f.request, ...(mode === "timeout" ? { deadlineMs: 2 } : {}) });
    const logs = []; reportTransport("size-probe", result.error, result.transport, x => logs.push(x));
    assert.throws(() => assertStorageLimit("size", result, result.transport.httpStatus, x => logs.push(x)));
    if (mode === "reset") assert.match(logs[0], /phase=CONNECT_TLS.*known_code=ECONNRESET/);
    if (mode === "tls") assert.match(logs[0], /known_code=ERR_TLS_CERT_ALTNAME_INVALID/);
    if (mode === "timeout") assert.match(logs[0], /timeout=REQUEST_DEADLINE/);
    if (mode === "bad-json") assert.match(logs[0], /phase=RESPONSE_PARSE; error_name=SyntaxError/);
    if (mode === "incomplete") assert.match(logs[0], /phase=RESPONSE_BODY.*ERR_STREAM_PREMATURE_CLOSE/);
    assert.ok(!logs.join("\n").includes("private-")); assert.equal(f.destroyed, true);
  });
}
test("200 success, generic 413 and 417 cannot masquerade as a size-limit pass", async () => {
  for (const [status, payload] of [[200, {}], [413, { message: "private-unrecognized" }], [417, { message: "Expectation failed" }]]) {
    const f = transport("early-rejection", status, payload);
    const result = await probeStorageSize(config, { request: f.request });
    assert.throws(() => assertStorageLimit("size", result, result.transport.httpStatus, () => {}));
  }
});
test("body construction and exact plus-one boundary are checked before HTTP construction", async () => {
  for (const makeBody of [() => Buffer.alloc(STORAGE_BYTE_LIMIT - 1), () => Buffer.alloc(STORAGE_BYTE_LIMIT), () => { throw new RangeError("private-allocation-error"); }]) {
    const result = await probeStorageSize(config, { request: () => assert.fail("Invalid body sent"), makeBody });
    assert.equal(result.transport.phase, "BODY_CONSTRUCTION");
    assert.throws(() => assertStorageLimit("size", result, result.transport.httpStatus, () => {}));
  }
  const result = await probeStorageSize({ ...config, path: "https://onfdusisfidlfdmluwxl.supabase.co/object" }, { request: () => assert.fail("Remote URL accepted") });
  assert.equal(result.transport.phase, "VALIDATION");
});
test("SDK wrappers preserve only known nested fetch codes and timeout classification", () => {
  const error = Object.assign(new Error("private-url"), { name: "StorageUnknownError", originalError:
    Object.assign(new TypeError("private-token"), { cause: Object.assign(new Error("private-details"), { code: "UND_ERR_CONNECT_TIMEOUT" }) }) });
  const details = transportDetails(error, { transport: "sdk_fetch", phase: "FETCH_CONNECT_OR_TRANSMIT", deadlineMs: 15000 });
  assert.equal(details.error_name, "StorageUnknownError"); assert.equal(details.cause_name, "Error");
  assert.equal(details.known_code, "UND_ERR_CONNECT_TIMEOUT"); assert.equal(details.timeout, "CONNECT_TIMEOUT");
  assert.ok(!JSON.stringify(details).includes("private-"));
  const unknown = transportDetails({ name: "private-name", code: "private-code", cause: { name: "private-name", code: "private-code" } }, { phase: "private-phase", transport: "private-host" });
  assert.ok(!JSON.stringify(unknown).includes("private-"));
});
test("user abort destroys the request and is never reported as a timeout or security pass", async () => {
  const controller = new AbortController(), f = transport("abort");
  const promise = probeStorageSize({ ...config, signal: controller.signal }, { request: f.request });
  controller.abort();
  const result = await promise;
  assert.equal(transportDetails(result.error, result.transport).timeout, "USER_ABORT");
  assert.equal(f.destroyed, true);
  assert.throws(() => assertStorageLimit("size", result, result.transport.httpStatus, () => {}));
});
