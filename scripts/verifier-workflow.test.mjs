import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import ts from "typescript";
const load = createRequire(import.meta.url);
load.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(
      readFileSync(filename, "utf8").replace('import "server-only";', ""),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
      },
    ).outputText,
    filename,
  );
const validation = load("../lib/verifier/validation.ts");
const server = load("../lib/verifier/server.ts");
const auth = load("../lib/supabase/server.ts");
const sharp = load("sharp");
const userId = randomUUID(),
  assignmentId = randomUUID(),
  evidenceId = randomUUID();
const key = "cd".repeat(32);
const request = (path, body, origin = "http://localhost") =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function configure() {
  const oldKey = process.env.SERV_PLAN_SIGNING_KEY,
    oldGate = process.env.PHASE3B_ENABLED;
  process.env.SERV_PLAN_SIGNING_KEY = key;
  process.env.PHASE3B_ENABLED = "true";
  return () => {
    for (const [name, value] of [
      ["SERV_PLAN_SIGNING_KEY", oldKey],
      ["PHASE3B_ENABLED", oldGate],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
const photo = () =>
  sharp({
    create: {
      width: 4,
      height: 4,
      channels: 3,
      background: { r: 20, g: 100, b: 50 },
    },
  })
    .png()
    .withMetadata()
    .toBuffer();
test("workflow readiness distinguishes missing signing configuration from closed local/database gates", () => {
  const restore = configure();
  try {
    assert.equal(server.workflowBlockReason(true), null);
    assert.equal(server.workflowBlockReason(false), "database_readiness");
    delete process.env.PHASE3B_ENABLED;
    assert.equal(server.workflowBlockReason(false), "local_gate");
    assert.equal(server.workflowEnabled(), false);
    delete process.env.SERV_PLAN_SIGNING_KEY;
    assert.equal(server.workflowBlockReason(false), "signing_configuration");
    process.env.SERV_PLAN_SIGNING_KEY = "invalid";
    assert.equal(server.workflowBlockReason(true), "signing_configuration");
  } finally { restore(); }
});
test("assignment reads return safe gate reasons without requesting signing material", async () => {
  const restore = configure();
  const oldAuth = auth.authenticatedClient;
  try {
    let databaseReady = false;
    const client = {
      from(table) {
        assert.equal(table, "task_assignments");
        return {
          select() { return this; },
          order() { return this; },
          eq(column, value) {
            assert.equal(column, "verifier_id");
            assert.equal(value, userId);
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
      async rpc(name) {
        assert.equal(name, "phase3b_ready");
        return { data: databaseReady, error: null };
      },
    };
    auth.authenticatedClient = async () => ({ client, userId });
    const route = load("../app/api/assignments/route.ts");
    const read = async () => {
      const response = await route.GET(new Request("http://localhost/api/assignments"));
      assert.equal(response.status, 200);
      assert.match(response.headers.get("Cache-Control"), /no-store/);
      return response.json();
    };
    assert.deepEqual(await read(), { assignments: [], enabled: false, blockedReason: "database_readiness", verifiers: [], plans: [] });
    delete process.env.PHASE3B_ENABLED;
    assert.equal((await read()).blockedReason, "local_gate");
    delete process.env.SERV_PLAN_SIGNING_KEY;
    assert.equal((await read()).blockedReason, "signing_configuration");
    process.env.SERV_PLAN_SIGNING_KEY = key;
    process.env.PHASE3B_ENABLED = "true";
    databaseReady = true;
    assert.deepEqual(await read(), { assignments: [], enabled: true, blockedReason: null, verifiers: [], plans: [] });
  } finally { auth.authenticatedClient = oldAuth; restore(); }
});
test("image validation accepts only bounded matching JPEG/PNG/WebP headers", () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  validation.validateImageHeader(png, "image/png");
  assert.throws(
    () => validation.validateImageHeader(png, "image/jpeg"),
    /match/,
  );
  for (const mime of ["image/svg+xml", "text/html", "image/gif"])
    assert.throws(() => validation.validateImageHeader(png, mime));
  assert.throws(
    () => validation.validateImageHeader(new Uint8Array(), "image/png"),
    /8 MB/,
  );
  assert.throws(
    () =>
      validation.validateImageHeader(
        new Uint8Array(validation.MAX_EVIDENCE_BYTES + 1),
        "image/png",
      ),
    /8 MB/,
  );
});
test("photo processing decodes actual images, strips metadata and rejects malformed images", async () => {
  const original = await photo();
  assert.ok((await sharp(original).metadata()).exif);
  const normalized = await server.normalizePhoto(original, "image/png");
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 4);
  await assert.rejects(server.normalizePhoto(original, "image/jpeg"));
  await assert.rejects(
    server.normalizePhoto(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    ),
  );
  // JPEG and WebP also pass the real decoder, rather than relying on MIME labels.
  for (const format of ["jpeg", "webp"]) {
    const bytes = await sharp(original).toFormat(format).toBuffer();
    assert.ok((await server.normalizePhoto(bytes, `image/${format}`)).length);
  }
});
test("strict evidence metadata requires observation and explicit location consent", () => {
  const valid = {
    id: evidenceId,
    assignmentId,
    observation: "Water visible near the access lane.",
  };
  assert.equal(validation.evidenceInputSchema.safeParse(valid).success, true);
  for (const patch of [
    { observation: " " },
    { verifierId: userId },
    { status: "completed" },
    { location: { latitude: 6, longitude: 3 } },
    { location: { consent: false, latitude: 6, longitude: 3 } },
    { location: { consent: true, latitude: 91, longitude: 3 } },
  ])
    assert.equal(
      validation.evidenceInputSchema.safeParse({ ...valid, ...patch }).success,
      false,
    );
  assert.equal(
    validation.evidenceInputSchema.safeParse({
      ...valid,
      location: { consent: true, latitude: 6, longitude: 3 },
    }).success,
    true,
  );
});
test("review inputs bind the current evidence and require a revision note, never budget/status authority", () => {
  for (const action of ["approve", "revise", "complete"])
    assert.equal(
      validation.assignmentActionSchema.safeParse({ id: assignmentId, action })
        .success,
      false,
    );
  assert.equal(
    validation.assignmentActionSchema.safeParse({
      id: assignmentId,
      action: "revise",
      evidenceId,
      note: "Show the access lane from a safe location.",
    }).success,
    true,
  );
  assert.equal(
    validation.assignmentActionSchema.safeParse({
      id: assignmentId,
      action: "revise",
      evidenceId,
      note: " ",
    }).success,
    false,
  );
  assert.equal(
    validation.assignmentActionSchema.safeParse({
      id: assignmentId,
      action: "complete",
      evidenceId,
      budget: 0,
    }).success,
    false,
  );
});
test("evidence receipts use a separate purpose and bind immutable image digest, identity, observation and consent", () => {
  const value = {
    id: evidenceId,
    assignmentId,
    userId,
    path: `${assignmentId}/${evidenceId}`,
    mime: "image/png",
    size: 20,
    sha256: "ab".repeat(32),
    observation: "Fixture",
  };
  const receipt = server.evidenceReceipt(value, key);
  const decoded = JSON.parse(receipt.payload);
  assert.equal(decoded.purpose, "spotly.evidence.v1");
  assert.equal(decoded.userId, userId);
  assert.equal(decoded.sha256, value.sha256);
  const mac = (payload) =>
    createHmac("sha256", Buffer.from(key, "hex")).update(payload).digest("hex");
  assert.equal(receipt.signature, mac(receipt.payload));
  assert.notEqual(
    receipt.signature,
    mac(JSON.stringify({ ...decoded, observation: "Forged" })),
  );
  assert.notEqual(
    receipt.signature,
    mac(JSON.stringify({ ...decoded, purpose: "spotly.serv.plan.v1" })),
  );
});
test("assignment API denies origin/session/closed-gate requests and forwards only strictly validated RPC arguments", async () => {
  const route = load("../app/api/assignments/route.ts");
  const oldAuth = auth.authenticatedClient;
  const restore = configure();
  let calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: assignmentId, error: null };
    },
  };
  try {
    auth.authenticatedClient = async () => ({ client, userId });
    const body = {
      action: "assign",
      requestId: `SP-${randomUUID()}`,
      planId: randomUUID(),
      verifierId: randomUUID(),
    };
    assert.equal(
      (
        await route.POST(
          request("/api/assignments", body, "https://other.example"),
        )
      ).status,
      403,
    );
    assert.equal(calls.length, 0);
    auth.authenticatedClient = async () => {
      throw new Error("No claims");
    };
    assert.equal(
      (await route.POST(request("/api/assignments", body))).status,
      401,
    );
    auth.authenticatedClient = async () => ({ client, userId });
    delete process.env.PHASE3B_ENABLED;
    assert.equal(
      (await route.POST(request("/api/assignments", body))).status,
      503,
    );
    assert.equal(calls.length, 0);
    process.env.PHASE3B_ENABLED = "true";
    delete process.env.SERV_PLAN_SIGNING_KEY;
    assert.equal(
      (await route.POST(request("/api/assignments", body))).status,
      503,
    );
    process.env.SERV_PLAN_SIGNING_KEY = key;
    assert.equal(
      (
        await route.POST(
          request("/api/assignments", { ...body, role: "dispatcher" }),
        )
      ).status,
      400,
    );
    assert.equal(
      (await route.POST(request("/api/assignments", body))).status,
      200,
    );
    assert.deepEqual(calls[0], {
      name: "assign_verification",
      args: {
        request_id: body.requestId,
        selected_plan: body.planId,
        verifier: body.verifierId,
      },
    });
    client.rpc = async () => ({ error: { code: "P0001" } });
    assert.equal(
      (
        await route.POST(
          request("/api/assignments", { id: assignmentId, action: "accept" }),
        )
      ).status,
      409,
    );
    client.rpc = async () => { throw new Error("private-transition-details"); };
    const uncertain = await route.POST(request("/api/assignments", { id: assignmentId, action: "accept" }));
    assert.equal(uncertain.status, 503);
    const message = (await uncertain.json()).error;
    assert.match(message, /status could not be confirmed.*Refresh/);
    assert.ok(!message.includes("private-transition-details"));
    client.rpc = async () => ({ error: { code: "P0001" } });
    assert.equal(
      (
        await route.POST(
          request("/api/assignments", {
            id: assignmentId,
            action: "decline",
            evidenceId,
          }),
        )
      ).status,
      409,
    );
  } finally {
    auth.authenticatedClient = oldAuth;
    restore();
  }
});
test("approval/completion API verifies dispatcher access and current stored bytes before transition, including missing/corrupt photo failures", async () => {
  const route = load("../app/api/assignments/route.ts");
  const oldAuth = auth.authenticatedClient;
  const restore = configure();
  const workspaceId = randomUUID();
  let transitions = 0, downloads = 0, role = "dispatcher", visible = true, pending = false, stale = false, missing = true, corrupt = false, throwRead = false;
  const bytes = new Uint8Array([1, 2, 3]);
  const operations = [];
  const client = {
    from(table) {
      const rows = {
        task_assignments: visible ? { submission_round: 1, verification_requests: { workspace_id: workspaceId } } : null,
        workspace_members: { role },
        task_evidence: { id: evidenceId, assignment_id: assignmentId, submission_round: 1,
          file_path: `${assignmentId}/${evidenceId}`, mime_type: "image/png", byte_size: 3,
          sha256: server.photoHash(bytes), submitted_at: pending ? null : new Date().toISOString(),
          ...(stale ? { submission_round: 0 } : {}) },
      };
      const query = { select: () => query, eq: (column, value) => {
        if (table === "task_evidence" && column === "assignment_id") assert.equal(value, assignmentId);
        if (table === "workspace_members" && column === "user_id") assert.equal(value, userId);
        return query;
      }, not: () => query,
        maybeSingle: async () => ({ data: rows[table], error: null }) };
      return query;
    },
    storage: { from: bucket => {
      assert.equal(bucket, validation.EVIDENCE_BUCKET);
      return { download: async path => {
        assert.equal(path, `${assignmentId}/${evidenceId}`);
        downloads++;
        if (throwRead) throw new Error("private-review-storage-details");
        return missing ? { data: null, error: { code: "NoSuchKey", status: 400 } } : { data: new Blob([corrupt ? new Uint8Array([3, 2, 1]) : bytes]), error: null };
      } };
    } },
    rpc: async (name, args) => { assert.equal(name, "transition_assignment"); transitions++; operations.push(args); return { error: null }; },
  };
  try {
    auth.authenticatedClient = async () => ({ client, userId });
    const send = (action = "approve") => route.POST(request("/api/assignments", { id: assignmentId, action, evidenceId }));
    for (const action of ["approve", "complete"]) assert.equal((await send(action)).status, 503);
    assert.equal(transitions, 0);
    missing = false; corrupt = true;
    assert.equal((await send()).status, 409);
    assert.equal(transitions, 0);
    corrupt = false;
    const readCount = downloads;
    role = "verifier";
    assert.equal((await send()).status, 403); // Assigned C may see the row but may not review.
    role = "dispatcher"; visible = false;
    assert.equal((await send()).status, 404); // Unrelated B sees no assignment.
    visible = true; pending = true;
    assert.equal((await send()).status, 409);
    pending = false; stale = true;
    assert.equal((await send()).status, 409);
    stale = false;
    auth.authenticatedClient = async () => { throw new Error("no claims"); };
    assert.equal((await send()).status, 401);
    assert.equal(downloads, readCount); // All denials precede byte retrieval.
    assert.equal(transitions, 0);
    auth.authenticatedClient = async () => ({ client, userId });
    throwRead = true;
    const unavailable = await send();
    assert.equal(unavailable.status, 503);
    assert.ok(!JSON.stringify(await unavailable.json()).includes("private-review-storage-details"));
    assert.equal(transitions, 0);
    throwRead = false;
    for (const action of ["approve", "complete"]) {
      assert.equal((await send(action)).status, 200);
      assert.deepEqual(operations.at(-1), { assignment: assignmentId, operation: action, selected_evidence: evidenceId, review_note: "" });
    }
  } finally { auth.authenticatedClient = oldAuth; restore(); }
});
test("evidence upload verifies assignment, stores without overwrite, reads back exact bytes, then signs finalization", async () => {
  const route = load("../app/api/evidence/route.ts");
  const oldAuth = auth.authenticatedClient;
  const restore = configure();
  const bytes = await photo();
  let stored,
    receipt,
    authorized = true,
    denyReservation = false,
    denyReadback = false,
    corrupt = false,
    throwReadback = false,
    throwFinalization = false,
    uploads = 0,
    finalizations = 0;
  const events = [];
  const client = {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: authorized
            ? { id: assignmentId, verifier_id: userId, status: "accepted" }
            : null,
        }),
      };
      return query;
    },
    rpc: async (name, args) => {
      events.push(name);
      if (name === "reserve_task_evidence")
        return denyReservation
          ? { error: {} }
          : { data: `${assignmentId}/${evidenceId}` };
      assert.equal(name, "submit_task_evidence");
      if (throwFinalization) throw new Error("private-provider-details");
      receipt = args;
      finalizations++;
      return { error: null };
    },
    storage: {
      from: (bucket) => {
        assert.equal(bucket, validation.EVIDENCE_BUCKET);
        return {
          upload: async (_path, data, options) => {
            events.push("upload");
            assert.equal(options.upsert, false);
            assert.equal(options.contentType, "image/png");
            stored = data;
            uploads++;
            return { error: null };
          },
          download: async (path) => {
            if (throwReadback) throw new Error("private-storage-details");
            events.push("download");
            assert.equal(path, `${assignmentId}/${evidenceId}`);
            return denyReadback ? { error: { status: 400, message: "Object not found" } } : {
              data: new Blob([corrupt ? new Uint8Array([1]) : stored]),
            };
          },
        };
      },
    },
  };
  const req = async (metadata = {}) => {
    const form = new FormData();
    form.set(
      "metadata",
      JSON.stringify({
        id: evidenceId,
        assignmentId,
        observation: "Test observation",
        ...metadata,
      }),
    );
    form.set("photo", new File([bytes], "test.png", { type: "image/png" }));
    return new Request("http://localhost/api/evidence", {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: form,
    });
  };
  try {
    auth.authenticatedClient = async () => ({ client, userId });
    authorized = false;
    assert.equal((await route.POST(await req())).status, 403);
    assert.equal(uploads, 0);
    authorized = true;
    denyReservation = true;
    assert.equal((await route.POST(await req())).status, 409);
    assert.equal(uploads, 0);
    denyReservation = false;
    assert.equal((await route.POST(await req())).status, 200);
    assert.deepEqual(events.slice(-4), [
      "reserve_task_evidence",
      "upload",
      "download",
      "submit_task_evidence",
    ]);
    const envelope = JSON.parse(receipt.payload);
    assert.equal(envelope.userId, userId);
    assert.equal(envelope.sha256, server.photoHash(stored));
    assert.equal(envelope.observation, "Test observation");
    assert.equal((await sharp(stored).metadata()).exif, undefined);
    assert.equal(
      receipt.signature,
      createHmac("sha256", Buffer.from(key, "hex"))
        .update(receipt.payload)
        .digest("hex"),
    );
    // Reproduce the live upload-200/download-400 boundary: never sign or submit
    // unverified bytes, and preserve the existing retry response.
    denyReadback = true;
    const failedReadback = await route.POST(await req());
    assert.equal(failedReadback.status, 503);
    assert.match((await failedReadback.json()).error, /Storage readback failed.*did not finalize/);
    assert.equal(finalizations, 1);
    assert.deepEqual(events.slice(-3), ["reserve_task_evidence", "upload", "download"]);
    denyReadback = false;
    throwReadback = true;
    const transportFailure = await route.POST(await req());
    assert.equal(transportFailure.status, 503);
    assert.match((await transportFailure.json()).error, /did not finalize/);
    assert.equal(finalizations, 1);
    throwReadback = false;
    throwFinalization = true;
    const uncertain = await route.POST(await req());
    assert.equal(uncertain.status, 503);
    const uncertainMessage = (await uncertain.json()).error;
    assert.match(uncertainMessage, /status could not be confirmed.*Refresh/);
    assert.ok(!uncertainMessage.includes("private-provider-details"));
    throwFinalization = false;
    corrupt = true;
    assert.equal((await route.POST(await req())).status, 409);
    assert.equal(finalizations, 1);
    assert.equal(
      (await route.POST(await req({ verifierId: randomUUID() }))).status,
      400,
    );
  } finally {
    auth.authenticatedClient = oldAuth;
    restore();
  }
});
test("private evidence proxy repeats claims and RLS, rejects hidden/pending rows and emits no public cache/share URL", async () => {
  const route = load("../app/api/evidence/[id]/route.ts");
  const oldAuth = auth.authenticatedClient;
  let visible = false,
    submitted = false,
    corrupt = false,
    throwDownload = false,
    downloads = 0;
  const client = {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: visible
            ? {
                file_path: "private/path",
                mime_type: "image/png",
                byte_size: 3,
                sha256: server.photoHash(new Uint8Array([1, 2, 3])),
                submitted_at: submitted ? new Date().toISOString() : null,
              }
            : null,
        }),
      };
      return query;
    },
    storage: {
      from: () => ({
        download: async () => {
          if (throwDownload) throw new Error("private-download-details");
          downloads++;
          return {
            data: new Blob([new Uint8Array(corrupt ? [3, 2, 1] : [1, 2, 3])]),
          };
        },
      }),
    },
  };
  try {
    const context = { params: Promise.resolve({ id: evidenceId }) };
    auth.authenticatedClient = async () => {
      throw new Error("no claims");
    };
    assert.equal(
      (await route.GET(new Request("http://localhost"), context)).status,
      401,
    );
    auth.authenticatedClient = async () => ({ client, userId });
    assert.equal(
      (await route.GET(new Request("http://localhost"), context)).status,
      404,
    );
    assert.equal(downloads, 0);
    visible = true;
    assert.equal(
      (await route.GET(new Request("http://localhost"), context)).status,
      404,
    );
    submitted = true;
    const response = await route.GET(new Request("http://localhost"), context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Location"), null);
    corrupt = true;
    assert.equal(
      (await route.GET(new Request("http://localhost"), context)).status,
      409,
    );
    throwDownload = true;
    const unavailable = await route.GET(new Request("http://localhost"), context);
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.headers.get("Cache-Control"), /no-store/);
    assert.ok(!JSON.stringify(await unavailable.json()).includes("private-download-details"));
  } finally {
    auth.authenticatedClient = oldAuth;
  }
});
test("bounded request reader stops streaming beyond the configured maximum", async () => {
  const { boundedBody } = load("../lib/verifier/http.ts");
  const req = new Request("http://localhost", {
    method: "POST",
    body: "123456",
  });
  await assert.rejects(boundedBody(req, 5), /large/);
});
