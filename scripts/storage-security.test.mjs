import test from "node:test";
import assert from "node:assert/strict";
import { closeStorageGate, preflightBrowserDemo, runStorageSecurity, STORAGE_ACTIVATION_ACK } from "./run-storage-security.mjs";
import { source, statements, TEST_PROJECT } from "./security-test-db.mjs";
import { runIsolatedStorageCheck, safeStorageStage } from "./isolated-storage-check.mjs";
import { demoEnvironment } from "./run-security-demo.mjs";
import { evidenceOperations } from "./evidence-operation-report.mjs";
import { fixtureTables, objectChecks } from "./storage-fixture-attribution.mjs";
import { inspectStorageSetup } from "./storage-setup-diagnostics.mjs";

function state() {
  return Object.fromEntries([
    ...["gate_closed", "scope_empty", "key_empty", "objects_empty", "helpers_absent", "bucket_ok", "app_empty"].map(k => [k, true]),
    ...["auth_ids", "bucket", "workspaces", "workspace_members", "verification_requests", "verification_plans", "task_events", "task_assignments", "task_evidence", "assignment_events"].map(k => [k, "a".repeat(32)]),
  ]);
}
const path = "69000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000001";
const fixtureVerifier = "18000000-0000-4000-8000-000000000003";
function lifecycle(mode) {
  const queries = [], logs = [];
  let value, objects = false, empty = true, closed = true, marker = false, inventoryReads = 0;
  const journal = { exists: () => Boolean(value), read: () => value, write: v => { assert.equal(value, undefined); value = { ...v, events: v.version === 2 ? [...(v.events ?? [])] : undefined }; }, append: event => { value.events.push(event); }, clear: () => { value = undefined; } };
  const open = async () => ({
    async query(text) {
      queries.push(text);
      if (text.includes("as storage_bucket_diagnostic")) return { command: "SELECT", rows: [{ storage_bucket_diagnostic: {
        public: false, file_size_limit: mode === "wrong-bucket" ? 10485760 : 8388608,
        allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
      } }] };
      if (text.includes("as snapshot")) return { command: "SELECT", rows: [{ snapshot: { ...state(), app_empty: empty, gate_closed: closed, objects_empty: !objects } }] };
      if (text.startsWith("select count(*)")) return { command: "SELECT", rows: [{ closed, gate_rows: 1, enabled: !closed, live_checks_verified: !closed }] };
      if (text.includes("as browser_complete")) return { command: "SELECT", rows: [{ browser_complete: mode !== "incomplete-browser" }] };
      if (text.includes("as table_name")) { inventoryReads++; return { command: "SELECT", rows: fixtureTables.map(table_name => ({
        table_name, total: table_name === "workspaces" && !empty ? 1 : 0,
        known: table_name === "workspaces" && !empty && mode !== "unknown-fixture" &&
          !(mode === "fixture-changed-before-delete" && inventoryReads >= 2) ? 1 : 0, ids: [],
      })) }; }
      if (text.includes("from storage.objects o")) return { command: "SELECT", rows: objects ? [{ name: path,
        assignment_id: path.split("/")[0], evidence_id: path.split("/")[1], catalog_owner: fixtureVerifier,
        catalog_size: "95", catalog_mime: "image/png", catalog_id: path.split("/")[1],
        catalog_created_at: new Date().toISOString(),
        ...Object.fromEntries(objectChecks.map(key => [key, mode !== "unknown-object" || key !== "reservation_path"])),
        ...(marker ? { name: path.split("/")[0] + "/.emptyFolderPlaceholder", expected_path: path, catalog_owner: null,
          catalog_size: "0", catalog_mime: "application/octet-stream", uuid_path: false, reservation_path: false, evidence_suffix: false } : {}),
      }] : [] };
      if (text.includes("Disposable fixtures prepared")) { empty = false; closed = false; }
      if (text.startsWith("update spotly_private.workflow_gate")) closed = true;
      if (text.includes("Closed gates, empty scope/key")) {
        assert.equal(closed, true);
        if (objects) throw new Error("objects still exist");
      }
      if (text.trim().startsWith("delete from public.workspaces")) empty = true;
      return { command: statements(text.trim().endsWith(";") ? text : text + ";")[0].command, rows: [] };
    }, async end() {},
  });
  const options = { open, journal, report: line => logs.push(line),
    confirmActivation: async prompt => {
      assert.ok(prompt.includes(STORAGE_ACTIVATION_ACK));
      assert.equal(queries.length, 0); // Consent precedes even database reads.
      assert.equal(journal.exists(), false);
      return STORAGE_ACTIVATION_ACK;
    },
    runHTTP: async (_config, _report, { onContext, onAssignment, onReservation, verifyObject }) => {
      const expected = { path, assignment: path.split("/")[0], evidence: path.split("/")[1], verifier: fixtureVerifier,
        requestId: "SP-36000000-0000-4000-8000-000000000001", planId: "47000000-0000-4000-8000-000000000001", mime: "image/png", size: 95 };
      await onAssignment({ assignment: expected.assignment, verifier: expected.verifier, requestId: expected.requestId, planId: expected.planId });
      await onReservation(expected);
      objects = true;
      await verifyObject(expected);
      onContext({ verifyDeleted: async () => { assert.equal(objects, false); } });
      if (mode === "http-failure") throw Object.assign(new Error("private-password"), { storageStage: "receipt-finalization-and-review" });
    }, confirmDeletion: async () => {
      assert.equal(closed, true); // Gate closure must precede human object cleanup.
      assert.ok(queries.some(q => q.startsWith("select count(*)"))); // New owner read verifies closure.
      if (mode === "dashboard-marker" && !marker) marker = true;
      else if (mode !== "not-deleted") objects = false;
      return "CLEANED";
    },
  };
  return { queries, logs, options, journal };
}
test("HTTP lifecycle closes/verifies gate BEFORE Dashboard cleanup, then verifies fixture baseline and retains original journal", async () => {
  const f = lifecycle("pass");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, f.options), 0);
  assert.equal(f.logs.at(-1), "OVERALL PASS");
  assert.equal(f.journal.exists(), true);
  assert.ok(f.queries.some(q => q.includes("Unexpected scope/key")));
  assert.ok(f.queries.some(q => q.includes("Closed gates, empty scope/key")));
  assert.equal(/delete\s+from\s+storage\.objects/i.test(source("isolated-storage-cleanup.sql")), false);
});
test("HTTP failure still closes the gate and cleans fixtures but never claims overall pass", async () => {
  const f = lifecycle("http-failure");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, f.options), 1);
  assert.equal(f.logs.at(-1), "OVERALL FAIL");
  assert.equal(f.journal.exists(), true);
  assert.ok(f.logs.some(x => x.startsWith("PASS test gate closure")));
  assert.ok(f.logs.some(x => x.includes("[receipt-finalization-and-review]")));
  assert.equal(f.logs.join("\n").includes("private-password"), false);
});
test("focused reproduction uses the existing journal/guarded cleanup and never reports a full-suite or browser PASS", async () => {
  const f = lifecycle("http-failure");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, { ...f.options, focusedDownload: true }), 1);
  assert.equal(f.journal.exists(), true);
  assert.ok(f.logs.some(line => line.startsWith("PASS test gate closure")));
  assert.ok(f.logs.at(-1).startsWith("C DOWNLOAD REPRODUCTION FAIL; cleanup=VERIFIED"));
  assert.ok(!f.logs.some(line => line.startsWith("OVERALL PASS") || line.startsWith("DISPOSABLE BROWSER REHEARSAL")));
});
test("Dashboard marker replacement requires a second explicit manual deletion and independent cleanup before PASS", async () => {
  const f = lifecycle("dashboard-marker");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, f.options), 0);
  assert.ok(f.logs.some(line => line.includes("Dashboard left verified synthetic folder placeholders")));
  assert.equal(f.logs.at(-1), "OVERALL PASS");
  assert.equal(f.journal.exists(), true);
  assert.ok(!f.queries.some(sql => /delete\s+from\s+storage\.objects/i.test(sql)));
});
test("bucket mismatch stops in read-only diagnostics before fixtures, journal, gate activation or HTTP", async () => {
  const f = lifecycle("wrong-bucket");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, {
    ...f.options, runHTTP: () => assert.fail("HTTP started with wrong bucket settings"),
  }), 1);
  assert.equal(f.journal.exists(), false);
  assert.ok(!f.queries.some(q => /^(?:update|insert|delete|commit)/i.test(q.trim())));
  assert.ok(f.logs.some(line => line.startsWith("FAIL read-only bucket configuration")));
});
for (const [point, code, expectedStage] of [
  ["connect", "28P01", "bucket.connect"],
  ["begin", "42501", "bucket.begin-read-only"],
  ["bucket-query", "42P01", "bucket.select-configuration"],
  ["baseline-query", "42703", "baseline.select-snapshot"],
  ["fixture-query", "23514", "fixture.statement-1-do"],
  ["commit", "ECONNRESET", "fixture.commit"],
]) {
  test(`setup ${point} identifies exact operation, safe category, journal and commit outcome`, async () => {
    const f = lifecycle("pass");
    let failed = false;
    const error = Object.assign(new Error("private-password postgres://private-url signing-secret"), {
      code, status: "503", detail: "private-detail", hint: "private-hint", where: "private-sql", stack: "private-stack",
    });
    const open = async () => {
      if (point === "connect" && !failed) { failed = true; throw error; }
      const client = await f.options.open();
      return { end: client.end, query: async text => {
        const match = point === "begin" && text === "begin read only" ||
          point === "bucket-query" && text.includes("as storage_bucket_diagnostic") ||
          point === "baseline-query" && text.includes("as snapshot") ||
          point === "fixture-query" && text.includes("Disposable fixtures prepared") ||
          point === "commit" && text === "commit";
        if (match && !failed) { failed = true; throw error; }
        return client.query(text);
      } };
    };
    assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, {
      ...f.options, open, runHTTP: () => assert.fail("HTTP began after setup failed"),
    }), 1);
    const output = f.logs.join("\n");
    assert.ok(output.includes(`FAIL Storage test/setup [${expectedStage}]`));
    assert.ok(output.includes(`sqlstate=${code === "ECONNRESET" ? "UNAVAILABLE" : code}; actual_http=503`));
    const beforeCleanup = f.logs.find(line => line.startsWith("INFO setup safety:"));
    const recorded = ["fixture-query", "commit"].includes(point);
    assert.ok(beforeCleanup.includes(`journal_created_this_run=${recorded ? "YES" : "NO"}`));
    assert.ok(beforeCleanup.includes(`database_writes=${point === "commit" ? "UNVERIFIED" : "NONE_BY_THIS_RUN"}`));
    assert.ok(beforeCleanup.includes(`commit_outcome_uncertain=${point === "commit" ? "YES" : "NO"}`));
    assert.ok(output.includes("enabled=CLOSED; live_checks_verified=CLOSED; fresh read-only connection"));
    assert.ok(!/private-|signing-secret/.test(output));
    assert.equal(f.journal.exists(), recorded);
  });
}
test("journal write failure reports presence separately from successful creation and performs no database writes", async () => {
  const f = lifecycle("pass");
  const journal = { ...f.journal, write: () => { throw Object.assign(new Error("private-path"), { code: "EACCES" }); } };
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, { ...f.options, journal }), 1);
  assert.ok(f.logs.some(line => /\[journal.create\].*category=FILE_PERMISSION_DENIED/.test(line)));
  assert.ok(f.logs.some(line => /journal_created_this_run=NO; journal_present=NO; database_writes=NONE_BY_THIS_RUN/.test(line)));
  assert.ok(!f.queries.some(q => /^(?:update|insert|delete|commit|do)\b/i.test(q.trim())));
});
test("failed journal flush preserves the file and reports creation as unverified without fixture writes", async () => {
  const f = lifecycle("pass");
  const journal = { ...f.journal, write: value => {
    f.journal.write(value);
    throw Object.assign(new Error("private-fsync-error"), { code: "EIO" });
  } };
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, { ...f.options, journal }), 1);
  assert.ok(f.logs.some(line => /journal_created_this_run=UNVERIFIED; journal_present=YES; database_writes=NONE_BY_THIS_RUN/.test(line)));
  assert.equal(journal.exists(), true);
  assert.ok(!f.queries.some(q => /^(?:update|insert|delete|commit|do)\b/i.test(q.trim())));
  assert.ok(!f.logs.join("\n").includes("private-fsync-error"));
});
test("baseline safety failures identify the failed predicate instead of guessing a connection problem", async () => {
  const f = lifecycle("pass");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, {
    ...f.options, open: async () => {
      const client = await f.options.open();
      return { end: client.end, query: async text => {
        const result = await client.query(text);
        if (text.includes("as snapshot")) result.rows[0].snapshot.scope_empty = false;
        return result;
      } };
    },
  }), 1);
  assert.ok(f.logs.some(line => line.includes("[baseline.assert-scope_empty]")));
  assert.equal(f.journal.exists(), false);
});
test("journal-free setup inspection succeeds using only reads and a separate gate connection", async () => {
  const f = lifecycle("pass");
  let connections = 0;
  const journal = { exists: () => false, read: () => assert.fail("read journal"), write: () => assert.fail("write journal") };
  assert.equal(await inspectStorageSetup(async () => { connections++; return f.options.open(); }, journal, line => f.logs.push(line)), 0);
  assert.equal(connections, 3); // Bucket, baseline, independent flags.
  assert.ok(f.queries.every(q => /^(?:begin read only|select|rollback)/.test(q)));
  assert.ok(f.logs.at(-1).startsWith("SETUP INSPECTION PASS"));
});
test("unverified final gates cannot yield overall PASS after otherwise successful cleanup", async () => {
  const f = lifecycle("pass");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, {
    ...f.options, open: async () => {
      const client = await f.options.open();
      return { end: client.end, query: async text => {
        if (text.includes("as gate_rows")) throw Object.assign(new Error("private-gate-error"), { code: "ECONNRESET" });
        return client.query(text);
      } };
    },
  }), 1);
  assert.ok(f.logs.some(line => line.includes("enabled=UNVERIFIED; live_checks_verified=UNVERIFIED")));
  assert.equal(f.logs.at(-1), "OVERALL FAIL");
  assert.ok(!f.logs.join("\n").includes("private-gate-error"));
});
for (const answer of ["", "yes", "ENABLE STORAGE TEST onfdusisfidlfdmluwxl"]) {
  test(`Storage activation refuses nonmatching authorization (${answer || "empty"}) before connections, fixtures or journal`, async () => {
    const f = lifecycle("pass");
    let opened = false, tested = false;
    assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, {
      ...f.options, confirmActivation: async () => answer,
      open: async () => { opened = true; assert.fail("Database connected without authorization"); },
      runHTTP: async () => { tested = true; },
    }), 1);
    assert.equal(opened, false); assert.equal(tested, false);
    assert.equal(f.journal.exists(), false);
    assert.equal(f.logs.at(-1), "OVERALL FAIL");
  });
}
test("cancelled activation and unknown HTTP diagnostics never echo private content or create a recovery record", async () => {
  const f = lifecycle("pass");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, {
    ...f.options, confirmActivation: async () => { throw new Error("private-password"); },
  }), 1);
  assert.equal(f.queries.length, 0); assert.equal(f.journal.exists(), false);
  assert.equal(f.logs.join("\n").includes("private-password"), false);
  assert.equal(safeStorageStage({ storageStage: "private-token", message: "private-password" }), "setup-or-connection");
  assert.equal(safeStorageStage({ storageStage: "unauthorized-upload", message: "private-password" }), "unauthorized-upload");
});
test("typing CLEANED cannot replace independent object checks; failed cleanup retains journal and returns nonzero", async () => {
  const f = lifecycle("not-deleted");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, f.options), 1);
  assert.equal(f.journal.exists(), true);
  assert.equal(f.logs.at(-1), "OVERALL FAIL");
  assert.ok(f.logs.some(x => x.includes("FAIL/UNVERIFIED cleanup")));
});
test("recovery never reopens the gate or runs HTTP tests", async () => {
  const f = lifecycle("not-deleted");
  await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, f.options);
  const initial = f.queries.length;
  f.options.confirmDeletion = async () => "CLEANED";
  // A separate recovery session's state starts with no remaining objects; preserve journal.
  const recovered = lifecycle("pass");
  recovered.journal.write(f.journal.read());
  assert.equal(await runStorageSecurity({}, undefined, { ...recovered.options, recover: true,
    confirmActivation: () => assert.fail("recovery requested gate activation"),
    runHTTP: () => assert.fail("recovery ran tests"),
  }), 0);
  assert.ok(!recovered.queries.some(q => q.includes("Disposable fixtures prepared")));
  assert.ok(recovered.logs.some(x => x.includes("HTTP tests NOT RUN")));
  assert.ok(initial > 0);
});
for (const mode of ["unknown-object", "unknown-fixture"]) {
  test(`${mode} blocks Dashboard deletion instructions and database deletion; journal retained`, async () => {
    const f = lifecycle(mode);
    assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, {
      ...f.options, confirmDeletion: () => assert.fail("unsafe object deletion requested"),
    }), 1);
    assert.equal(f.journal.exists(), true);
    assert.ok(!f.queries.some(sql => /^delete from public\./.test(sql.trim())));
    assert.ok(f.logs.some(line => line.includes("[storage-object-attribution]")));
    assert.ok(!f.logs.some(line => line.includes("delete these synthetic objects")));
  });
}
test("fixture attribution is repeated inside deletion transaction; a changed fixture cannot be deleted", async () => {
  const f = lifecycle("fixture-changed-before-delete");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, f.options), 1);
  assert.equal(f.journal.exists(), true);
  assert.ok(f.logs.some(line => line.includes("[guarded-database-fixture-removal]")));
  assert.ok(!f.queries.some(sql => /^delete from public\./.test(sql.trim())));
  assert.ok(f.queries.some(sql => sql === "rollback"));
});

function httpFixture(mode) {
  const logs = [], calls = [];
  let number = 0, status = "offered", bytes, context;
  const assignment = path.split("/")[0], users = ["a", "b", "c"].map(n => `user-${n}`);
  const request = { created_by: users[0], title: "Synthetic Storage fixture", workspace_id: "25000000-0000-4000-8000-000000000001", request_fingerprint: "same", status: "draft", approved_max_budget: 0 };
  const plan = { request_fingerprint: "same", provenance: "serv_server_v1", accepted_at: "synthetic" };
  const allow = data => ({ data, error: null });
  const deny = (status = 403, message = "denied", code) => ({ error: { status, message, code } });
  const create = (_url, _key, options) => {
    const role = number++;
    const client = {
      auth: {
        signInWithPassword: async () => allow({}),
        getUser: async () => allow({ user: { id: users[role], email: `pilot-${["a", "b", "c"][role]}@example.test` } }),
        getSession: async () => allow({ session: { access_token: "private-test-token" } }),
      },
      from: table => {
        const builder = { select() { return this; }, eq() { return this; },
          update() { this.denied = true; return this; }, insert() { this.denied = true; return this; },
          single: async () => allow(table === "verification_requests" ? { ...request } : table === "verification_plans" ? { ...plan } : { status }),
          then(resolve) { return Promise.resolve(this.denied ? deny() : allow([])).then(resolve); },
        }; return builder;
      },
      rpc: async (name, args) => {
        calls.push(name);
        if (name === "phase3b_ready") return allow(role === 0);
        if (name === "assign_verification") return role === 0 && args.request_id.endsWith("1") ? allow(assignment) : deny();
        if (name === "reserve_task_evidence") return allow(`${assignment}/${args.evidence}`);
        if (name === "submit_task_evidence") {
          if (role !== 2 || args.signature === "00".repeat(32)) return deny();
          if (mode === "finalization-failure") return deny(400, "Evidence binding mismatch", "P0001");
          status = "submitted"; return allow(null);
        }
        if (name === "transition_assignment") {
          if (args.operation === "accept" && role === 2) { status = "accepted"; return allow(null); }
          if (role !== 0) return deny();
          if (args.operation === "approve" && status === "submitted") { status = "approved"; return allow(null); }
          if (args.operation === "complete" && ["approved", "completed"].includes(status)) { status = "completed"; return allow(null); }
          return deny();
        }
        assert.fail(`Unknown fake RPC ${name}`);
      },
      storage: { from: () => ({
        upload: async (_path, body, args) => {
          calls.push(`upload:${role}:${args.contentType}:${body.length}:${args.upsert}`);
          if (mode === "overwrite-network-failure" && role === 2 && args.upsert) return { error: new TypeError("private-network-details", { cause: { code: "ETIMEDOUT" } }) };
          if (role !== 2 || args.upsert) return deny();
          if (args.contentType === "text/plain") return mode === "wrong-mime-denial" ? deny() : deny(400, "mime type text/plain is not supported", "InvalidMimeType");
          if (body.length > 8388608) return mode === "wrong-size-denial" ? deny() : deny(413, "maximum allowed size", "EntityTooLarge");
          bytes = Buffer.from(body); return allow({ path: _path });
        },
        download: async () => {
          if (mode === "c-download-failure" && role === 2) return deny(400, "Object not found", "NoSuchKey");
          if (mode === "a-download-corrupt" && role === 0) return allow(new Blob(["wrong-bytes"]));
          return role === 1 || role === 3 ? deny() : bytes ? allow(new Blob([bytes])) : deny(404, "Object not found", "NoSuchKey");
        },
        createSignedUploadUrl: async () => deny(), createSignedUrl: async () => deny(),
        update: async () => deny(), copy: async () => deny(), move: async () => deny(),
        list: async () => allow([]), remove: async () => { calls.push(`remove:${role}`); return allow([]); },
        getPublicUrl: () => ({ data: { publicUrl: `https://${TEST_PROJECT}.supabase.co/storage/v1/object/public/verification-evidence/x` } }),
      }) },
    };
    // The SDK's injected transport itself must reject attempts to leave this origin.
    assert.throws(() => options.global.fetch("https://onfdusisfidlfdmluwxl.supabase.co/storage/v1/object/x"));
    return client;
  };
  const sizeProbe = async ({ key, token, path: reserved }) => {
    assert.equal(key, "sb_publishable_testfixture"); assert.equal(token, "private-test-token");
    assert.ok(reserved.startsWith(assignment + "/"));
    calls.push("size-probe:8388609");
    if (mode === "transport-size-failure") return { error: Object.assign(new Error("private-transport-details"), { code: "ECONNRESET" }),
      transport: { transport: "native_https", phase: "HTTP_TRANSMISSION", deadlineMs: 90000 } };
    const result = mode === "wrong-size-denial" ? deny() : deny(413, "maximum allowed size", "EntityTooLarge");
    return { ...result, transport: { transport: "native_https", phase: "COMPLETE", deadlineMs: 90000, httpStatus: result.error.status } };
  };
  return { create, sizeProbe, logs, calls, verifyObject: async expected => {
    calls.push("catalog-confirmation"); assert.ok(expected.path.startsWith(assignment + "/"));
    if (mode === "catalog-mismatch") throw new Error("OBJECT_BINDING_MISMATCH");
  }, onContext: c => { context = c; }, get context() { return context; }, deleteBytes: () => { bytes = undefined; } };
}
const httpConfig = { url: `https://${TEST_PROJECT}.supabase.co`, key: "sb_publishable_testfixture", passwords: ["private-a", "private-b", "private-c"] };
test("HTTP core exercises mocked SDK method paths for unauthorized uploads, byte readbacks, limits, overwrite denial and review", async () => {
  const f = httpFixture("pass");
  await runIsolatedStorageCheck(httpConfig, x => f.logs.push(x), {
    create: f.create, sizeProbe: f.sizeProbe, verifyObject: f.verifyObject, fetcher: async () => new Response("denied", { status: 403 }), onContext: f.onContext,
  });
  assert.ok(f.calls.some(x => x.startsWith("upload:1:")));
  assert.ok(f.calls.some(x => x.startsWith("upload:3:")));
  assert.ok(f.calls.includes("upload:2:text/plain:25:false"));
  assert.ok(f.calls.includes("size-probe:8388609"));
  assert.ok(f.logs.some(x => x.includes("MIME and 8 MiB")));
  for (const role of [1, 3, 2]) assert.ok(f.calls.includes(`remove:${role}`));
  f.deleteBytes(); await f.context.verifyDeleted();
  assert.ok(!f.logs.join("\n").includes("private-c"));
  assert.equal(f.logs.filter(line => /^PASS evidence summary \d+:/.test(line)).length, 10);
});
for (const [mode, failed, category] of [["catalog-mismatch", 2, "OBJECT_BINDING_MISMATCH"],
  ["c-download-failure", 3, "OBJECT_NOT_FOUND_OR_HIDDEN"], ["a-download-corrupt", 4, "BYTE_INTEGRITY_MISMATCH"],
  ["finalization-failure", 9, "EVIDENCE_BINDING_MISMATCH"]]) {
  test(`workflow ${mode} reports precise failing operation and never claims dependent steps passed`, async () => {
    const f = httpFixture(mode);
    await assert.rejects(runIsolatedStorageCheck(httpConfig, line => f.logs.push(line), {
      create: f.create, sizeProbe: f.sizeProbe, verifyObject: f.verifyObject, onContext: f.onContext,
      fetcher: async () => new Response("denied", { status: 403 }),
    }));
    assert.ok(f.logs.some(line => line.startsWith(`FAIL evidence ${failed}:`) && line.includes(`category=${category}`)));
    assert.ok(f.logs.includes(`NOT RUN evidence summary ${failed + 1}: ${evidenceOperations[failed]}`));
    if (mode === "c-download-failure") assert.ok(f.logs.some(line => /^FAIL evidence 3:.*actual_http=400/.test(line)));
    if (mode === "finalization-failure") assert.ok(f.logs.some(line => /^FAIL evidence 9:.*sqlstate=P0001/.test(line)));
    assert.ok(!f.logs.join("\n").includes("private-test-token"));
  });
}
test("a transport failure after a prior denial never reuses stale HTTP status or passes an overwrite assertion", async () => {
  const f = httpFixture("overwrite-network-failure");
  await assert.rejects(runIsolatedStorageCheck(httpConfig, line => f.logs.push(line), {
    create: f.create, sizeProbe: f.sizeProbe, verifyObject: f.verifyObject, fetcher: async () => new Response("denied", { status: 403 }),
  }));
  assert.ok(f.logs.some(line => /^FAIL evidence 7:.*operation=storage.upload-upsert.*actual_http=UNAVAILABLE.*known_code=ETIMEDOUT.*timeout=UNSPECIFIED_TIMEOUT/.test(line)));
  assert.ok(!f.logs.some(line => line.startsWith("PASS evidence 7:")));
  assert.ok(!f.logs.join("\n").includes("private-network-details"));
});
test("a generic authorization error is NOT evidence of a MIME-limit pass", async () => {
  const f = httpFixture("wrong-mime-denial");
  await assert.rejects(runIsolatedStorageCheck(httpConfig, x => f.logs.push(x), { create: f.create, sizeProbe: f.sizeProbe, verifyObject: f.verifyObject, onContext: f.onContext }), /bucket-mime-and-size-limits/);
  assert.ok(!f.logs.some(x => x.includes("PASS HTTP MIME")));
  assert.ok(f.logs.some(x => /FAIL HTTP mime-restriction:.*actual_http=403.*AUTHORIZATION_DENIED/.test(x)));
});
test("size probe fails separately after MIME passes, and a generic authorization denial cannot satisfy the size limit", async () => {
  const f = httpFixture("wrong-size-denial");
  await assert.rejects(runIsolatedStorageCheck(httpConfig, x => f.logs.push(x), { create: f.create, sizeProbe: f.sizeProbe, verifyObject: f.verifyObject, onContext: f.onContext }), /bucket-mime-and-size-limits/);
  assert.ok(f.logs.some(x => x.startsWith("PASS HTTP mime-restriction:")));
  assert.ok(f.logs.some(x => /FAIL HTTP size-restriction:.*actual_http=403.*AUTHORIZATION_DENIED/.test(x)));
  assert.ok(!f.logs.some(x => x.includes("PASS HTTP MIME and 8 MiB")));
  assert.ok(!f.logs.some(x => x.includes("PASS HTTP authorized upload")));
});
test("missing size response still fails overall while independently exercising the small-image workflow", async () => {
  const f = httpFixture("transport-size-failure");
  await assert.rejects(runIsolatedStorageCheck(httpConfig, x => f.logs.push(x), {
    create: f.create, sizeProbe: f.sizeProbe, verifyObject: f.verifyObject, onContext: f.onContext,
    fetcher: async () => new Response("denied", { status: 403 }),
  }), /bucket-mime-and-size-limits/);
  assert.ok(f.logs.some(x => x.startsWith("FAIL HTTP size-restriction:")));
  assert.ok(f.logs.some(x => x.startsWith("PASS HTTP authorized upload")));
  assert.ok(f.logs.some(x => x.includes("PASS: real dedicated-account RPC and small-image")));
  assert.ok(!f.logs.some(x => x.includes("PASS HTTP MIME and 8 MiB")));
  assert.ok(!f.logs.join("\n").includes("private-test-token"));
  assert.ok(!f.logs.join("\n").includes("private-transport-details"));
});
test("browser launcher overrides inherited production settings, disables SERV, rejects production URL/key", () => {
  const file = { NEXT_PUBLIC_SUPABASE_URL: httpConfig.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: httpConfig.key, SERV_PLAN_SIGNING_KEY: "cd".repeat(32) };
  const env = demoEnvironment(file, { NEXT_PUBLIC_SUPABASE_URL: "https://onfdusisfidlfdmluwxl.supabase.co", SERV_API_KEY: "private-real-key", SERV_PLAN_SIGNING_KEY: "private-real-key", PHASE3B_ENABLED: "false" });
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, httpConfig.url);
  assert.equal(env.SERV_API_KEY, "");
  assert.equal(env.SERV_PLAN_SIGNING_KEY, "cd".repeat(32));
  assert.throws(() => demoEnvironment({ ...file, NEXT_PUBLIC_SUPABASE_URL: "https://onfdusisfidlfdmluwxl.supabase.co" }));
  assert.throws(() => demoEnvironment({ ...file, SERV_PLAN_SIGNING_KEY: "private-real-key" }));
  assert.throws(() => demoEnvironment(file, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }));
});
test("browser local configuration preflight fails safely before live setup when missing or invalid", () => {
  const valid = `NEXT_PUBLIC_SUPABASE_URL=https://${TEST_PROJECT}.supabase.co\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_testfixture\nSERV_PLAN_SIGNING_KEY=${"cd".repeat(32)}\n`;
  assert.doesNotThrow(() => preflightBrowserDemo(() => valid));
  assert.throws(() => preflightBrowserDemo(() => { throw new Error("private-password"); }), /^Error: BROWSER_CONFIG_REQUIRED$/);
  assert.throws(() => preflightBrowserDemo(() => valid.replace(TEST_PROJECT, "onfdusisfidlfdmluwxl")), /^Error: BROWSER_CONFIG_REQUIRED$/);
});
test("typing DONE without persisted browser submission/review/completion fails while still closing gates and cleaning fixtures", async () => {
  const f = lifecycle("incomplete-browser");
  assert.equal(await runStorageSecurity({}, { url: `https://${TEST_PROJECT}.supabase.co` }, { ...f.options, demo: true, completeDemo: async () => "DONE" }), 1);
  assert.ok(f.logs.some(line => line.startsWith("FAIL rehearsal persisted workflow")));
  assert.ok(f.logs.some(line => line.startsWith("PASS test gate closure")));
  assert.equal(f.logs.at(-1), "OVERALL FAIL");
  assert.equal(f.journal.exists(), true);
});
test("optional demo repins only the untouched synthetic request and always closes/cleans afterward", async () => {
  const f = lifecycle("pass");
  assert.equal(await runStorageSecurity({}, httpConfig, { ...f.options, demo: true, completeDemo: async () => "DONE" }), 0);
  assert.ok(f.queries.some(q => q.includes("Synthetic rehearsal plan missing")));
  assert.equal(f.journal.exists(), true);
});


test("gate verification preserves original query failure when connection release also fails", async () => {
  const original = Object.assign(new Error("private-original"), { code: "42501" });
  const release = Object.assign(new Error("private-release"), { code: "ECONNRESET" });
  const logs = [], stages = []; let connections = 0;
  await assert.rejects(closeStorageGate(async () => {
    const verification = ++connections === 2;
    return { query: async sql => {
      if (verification) throw original;
      return { command: statements(sql + (sql.endsWith(";") ? "" : ";"))[0].command };
    }, end: async () => { if (verification) throw release; } };
  }, line => logs.push(line), label => ({ label, onStage: value => stages.push(value) })), error => error === original);
  assert.equal(stages.at(-1), "cleanup-verify-gates.select-flags");
  assert.ok(logs.some(line => line.includes("WARN cleanup connection release") && line.includes("NETWORK_FAILURE")));
  assert.ok(!logs.join("\n").includes("private-"));
});

test("release failure after acknowledged gate verification does not block guarded scope cleanup", async () => {
  const f = lifecycle("pass"); let connections = 0;
  await closeStorageGate(async () => {
    const client = await f.options.open(), verification = ++connections === 2;
    return { query: client.query, end: async () => {
      if (verification) throw Object.assign(new Error("private-release"), { code: "ECONNRESET" });
    } };
  }, line => f.logs.push(line));
  assert.equal(connections, 3);
  assert.ok(f.queries.some(sql => sql.includes("Unexpected scope/key")));
  assert.ok(f.logs.some(line => line.startsWith("WARN cleanup connection release")));
});

for (const point of ["verify-query", "scope-query", "scope-commit"]) {
  test(`cleanup ${point} reports exact operation and preserves original baseline without retrying writes`, async () => {
    const f = lifecycle("pass");
    const baseline = JSON.stringify(Object.fromEntries(Object.entries(state()).sort(([a], [b]) => a.localeCompare(b))));
    f.journal.write({ project: TEST_PROJECT, version: 1, baseline });
    const prior = JSON.stringify(f.journal.read());
    let scope = false, failed = false;
    const open = async () => {
      const client = await f.options.open();
      return { end: client.end, query: async sql => {
        if (sql.includes("Unexpected scope/key")) scope = true;
        const match = point === "verify-query" && sql.startsWith("select count(*)") ||
          point === "scope-query" && sql.includes("Unexpected scope/key") ||
          point === "scope-commit" && scope && sql === "commit";
        if (match && !failed) {
          failed = true;
          throw Object.assign(new Error("private-original"), { code: "ECONNRESET" });
        }
        return client.query(sql);
      } };
    };
    assert.equal(await runStorageSecurity({}, undefined, { ...f.options, open, recover: true,
      runHTTP: () => assert.fail("recovery ran HTTP"),
    }), 1);
    const operation = { "verify-query": "cleanup-verify-gates.select-flags", "scope-query": "cleanup-remove-scope-key.statement-1-do", "scope-commit": "cleanup-remove-scope-key.commit" }[point];
    const output = f.logs.join("\n");
    assert.ok(output.includes(`operation=${operation}; category=NETWORK_FAILURE`));
    assert.ok(!output.includes("private-original"));
    assert.equal(JSON.stringify(f.journal.read()), prior);
    assert.ok(!f.queries.some(sql => /^delete from public\./.test(sql.trim())));
    if (point === "scope-commit") assert.ok(output.includes("commit_outcome_uncertain=YES"));
  });
}

test("successful recovery is repeatable and leaves journal and original baseline unchanged", async () => {
  const f = lifecycle("pass");
  const baseline = JSON.stringify(Object.fromEntries(Object.entries(state()).sort(([a], [b]) => a.localeCompare(b))));
  f.journal.write({ project: TEST_PROJECT, version: 1, baseline });
  const prior = JSON.stringify(f.journal.read());
  for (let i = 0; i < 2; i++) {
    assert.equal(await runStorageSecurity({}, undefined, { ...f.options, recover: true,
      runHTTP: () => assert.fail("recovery ran HTTP"),
    }), 0);
    assert.equal(JSON.stringify(f.journal.read()), prior);
  }
});
