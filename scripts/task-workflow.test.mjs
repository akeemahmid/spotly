import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ts from "typescript";

// Exercise the actual TypeScript data layer using the already-installed compiler.
const load = createRequire(import.meta.url);
load.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(readFileSync(filename, "utf8").replace('import "server-only";', ""), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
const { validateNewVerification } = load("../lib/validation/verification.ts");
const { readStoredTasks, createStoredTask, TASK_STORAGE_KEY } = load(
  "../lib/task-storage.ts",
);
const { filterVerifications, verificationStats } = load(
  "../lib/verification-selectors.ts",
);
const { demoVerifications } = load("../lib/demo-data.ts");
const { verificationStore } = load("../lib/use-verifications.ts");
const now = Date.parse("2030-01-01T10:00:00.000Z");
const valid = () => ({
  title: "Road access at Berger",
  question: "Can trucks enter the northbound carriageway?",
  category: "road_conditions",
  locationDescription: "Berger junction, northbound access",
  coordinates: { latitude: 6.6471, longitude: 3.3742 },
  evidenceRequirements: ["photos", "written_observation"],
  expiresAt: "2030-01-02T10:00:00.000Z",
  budget: 25.5,
});
class MemoryStorage {
  values = new Map();
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, value);
  }
}

test("valid request creates a fully specified unassigned draft with explicit budget", () => {
  const storage = new MemoryStorage();
  const result = validateNewVerification(valid(), now);
  assert.equal(result.success, true);
  const task = createStoredTask(storage, valid(), now, randomUUID);
  assert.equal(task.status, "draft");
  assert.equal(task.source, "local");
  assert.equal(task.budget, 25.5);
  assert.equal(task.createdAt, new Date(now).toISOString());
  assert.equal(task.question, valid().question);
  assert.deepEqual(task.coordinates, valid().coordinates);
  assert.deepEqual(task.evidenceRequirements, valid().evidenceRequirements);
  assert.equal("verifierId" in task, false);
  assert.equal("paymentId" in task, false);
});

test("all required fields reject empty or omitted values, including an unset budget", () => {
  for (const field of Object.keys(valid())) {
    const input = valid();
    delete input[field];
    assert.equal(validateNewVerification(input, now).success, false, field);
  }
  for (const field of ["title", "question", "locationDescription"])
    assert.equal(
      validateNewVerification({ ...valid(), [field]: "   " }, now).success,
      false,
      field,
    );
  assert.equal(
    validateNewVerification({ ...valid(), evidenceRequirements: [] }, now)
      .success,
    false,
  );
});

test("invalid coordinates, non-finite values, and invalid categories are rejected", () => {
  for (const coordinates of [
    { latitude: 91, longitude: 3 },
    { latitude: -91, longitude: 3 },
    { latitude: 6, longitude: 181 },
    { latitude: 6, longitude: -181 },
    { latitude: NaN, longitude: 3 },
    { latitude: 6, longitude: Infinity },
  ])
    assert.equal(
      validateNewVerification({ ...valid(), coordinates }, now).success,
      false,
    );
  assert.equal(
    validateNewVerification({ ...valid(), category: "invented" }, now).success,
    false,
  );
  assert.equal(
    validateNewVerification(
      { ...valid(), coordinates: { latitude: 0, longitude: 0 } },
      now,
    ).success,
    true,
  );
});

test("expired, exact-current, and malformed expirations cannot be created", () => {
  for (const expiresAt of [
    "2029-12-31T10:00:00Z",
    new Date(now).toISOString(),
    "not-a-date",
    "2030-02-31T10:00:00Z",
  ])
    assert.equal(
      validateNewVerification({ ...valid(), expiresAt }, now).success,
      false,
    );
});

test("negative, imprecise, and non-finite budgets are rejected; explicit zero is accepted", () => {
  for (const budget of [-1, 2.555, NaN, Infinity])
    assert.equal(
      validateNewVerification({ ...valid(), budget }, now).success,
      false,
    );
  assert.equal(
    validateNewVerification({ ...valid(), budget: 0 }, now).success,
    true,
  );
});

test("validation repeats at save time if the request expires during review", () => {
  const storage = new MemoryStorage();
  assert.throws(
    () =>
      createStoredTask(
        storage,
        valid(),
        Date.parse(valid().expiresAt),
        randomUUID,
      ),
    /future/,
  );
  assert.equal(storage.getItem(TASK_STORAGE_KEY), null);
});

test("saved drafts survive a fresh storage read and remain readable after expiration", () => {
  const storage = new MemoryStorage();
  const task = createStoredTask(storage, valid(), now, randomUUID);
  const reloaded = new MemoryStorage();
  reloaded.setItem(TASK_STORAGE_KEY, storage.getItem(TASK_STORAGE_KEY));
  assert.deepEqual(readStoredTasks(reloaded), { tasks: [task], issue: null });
});

test("UUID collisions retry and cannot introduce duplicate IDs", () => {
  const storage = new MemoryStorage();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const first = createStoredTask(storage, valid(), now, () => firstId);
  let tries = 0;
  const second = createStoredTask(storage, valid(), now, () =>
    tries++ === 0 ? firstId : secondId,
  );
  assert.notEqual(first.id, second.id);
  assert.equal(readStoredTasks(storage).tasks.length, 2);
  assert.throws(
    () => createStoredTask(storage, valid(), now, () => firstId),
    /unique task ID/,
  );
  assert.equal(readStoredTasks(storage).tasks.length, 2);
});

test("corrupted and unsupported storage never crashes or gets silently overwritten", () => {
  for (const raw of [
    "{broken",
    "null",
    '{"version":2,"tasks":[]}',
    '{"version":1,"tasks":[{}]}',
  ]) {
    const storage = new MemoryStorage();
    storage.setItem(TASK_STORAGE_KEY, raw);
    assert.ok(readStoredTasks(storage).issue);
    assert.throws(() => createStoredTask(storage, valid(), now, randomUUID));
    assert.equal(storage.getItem(TASK_STORAGE_KEY), raw);
  }
});

test("valid records are retained when other stored records are malformed or duplicated", () => {
  const storage = new MemoryStorage();
  const task = createStoredTask(storage, valid(), now, randomUUID);
  storage.setItem(
    TASK_STORAGE_KEY,
    JSON.stringify({ version: 1, tasks: [task, {}, task] }),
  );
  const recovered = readStoredTasks(storage);
  assert.deepEqual(recovered.tasks, [task]);
  assert.ok(recovered.issue);
});

test("blocked reads and failed writes return errors without pretending creation succeeded", () => {
  assert.ok(
    readStoredTasks({
      getItem() {
        throw Error("blocked");
      },
    }).issue,
  );
  const storage = new MemoryStorage();
  storage.setItem = () => {
    throw Error("quota");
  };
  assert.throws(
    () => createStoredTask(storage, valid(), now, randomUUID),
    /not saved/,
  );
  assert.equal(storage.getItem(TASK_STORAGE_KEY), null);
});

test("drafts are searchable/filterable and never count as field activity or spending", () => {
  const draft = createStoredTask(new MemoryStorage(), valid(), now, randomUUID);
  const tasks = [draft, ...demoVerifications];
  const original = verificationStats(demoVerifications);
  const updated = verificationStats(tasks);
  assert.deepEqual({ ...updated, drafts: 0 }, original);
  assert.equal(updated.drafts, 1);
  assert.deepEqual(filterVerifications(tasks, "draft", ""), [draft]);
  assert.deepEqual(
    filterVerifications(tasks, "All requests", "  BERGER JUNCTION  "),
    [draft],
  );
  assert.deepEqual(filterVerifications(tasks, "All requests", draft.id), [
    draft,
  ]);
  assert.equal(filterVerifications(tasks, "Completed", "").length, 1);
});

test("database store refreshes after successful writes and preserves failures", async () => {
 const oldFetch=globalThis.fetch; const oldWindow=globalThis.window;
 const win=new EventTarget(); globalThis.window=win;
 let tasks=[]; let fail=false; let writes=0;
 globalThis.fetch=async(_url,options)=>{
  if(fail)return Response.json({error:"Database unavailable"},{status:503});
  if(options.method==="POST"){
   const body=JSON.parse(options.body); writes++;
   const task={...body.input,id:`SP-${randomUUID()}`,source:"supabase",status:"draft",createdAt:new Date().toISOString()};
   tasks.push(task); return Response.json({id:task.id});
  }
  return Response.json({tasks});
 };
 const unsubscribe=verificationStore.subscribe(()=>{});
 try{
  await verificationStore.refresh();
  assert.equal(verificationStore.getSnapshot().tasks.length,0);
  const created=await verificationStore.create(valid());
  assert.equal(verificationStore.getSnapshot().tasks[0].id,created.id);
  assert.equal(verificationStore.getSnapshot().tasks[0].source,"supabase");
  fail=true;
  await assert.rejects(()=>verificationStore.create(valid()),/Database unavailable/);
  assert.equal(writes,1);
  await verificationStore.refresh();
  assert.match(verificationStore.getSnapshot().issue,/Database unavailable/);
  assert.equal(verificationStore.getSnapshot().tasks.length,0);
 }finally{unsubscribe();globalThis.fetch=oldFetch;globalThis.window=oldWindow;}
});
test("a late response from an unmounted account cannot replace the next subscription's records", async () => {
 const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
 globalThis.window = new EventTarget();
 let releaseOld; let count = 0; let firstSignal;
 globalThis.fetch = async (_url, options) => {
  if (++count === 1) {
   firstSignal = options.signal;
   return new Promise(resolve => { releaseOld = () => resolve(Response.json({ tasks: [{ id: "old-account" }] })); });
  }
  return Response.json({ tasks: [{ id: "current-account" }] });
 };
 let unsubscribe;
 try {
  unsubscribe = verificationStore.subscribe(() => {});
  const old = verificationStore.refresh();
  unsubscribe();
  assert.equal(firstSignal.aborted, true);
  unsubscribe = verificationStore.subscribe(() => {});
  await verificationStore.refresh();
  releaseOld(); await old; // Even a transport that ignores abort cannot publish.
  assert.equal(verificationStore.getSnapshot().tasks[0].id, "current-account");
 } finally { unsubscribe?.(); globalThis.fetch = oldFetch; globalThis.window = oldWindow; }
});
test("post-mutation refresh does not reuse a pre-mutation in-flight read", async () => {
 const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
 globalThis.window = new EventTarget();
 let releaseOld; let reads = 0;
 globalThis.fetch = async (_url, options) => {
  if (options.method === "POST") return Response.json({ id: "created-request" });
  if (++reads === 1) return new Promise(resolve => { releaseOld = () => resolve(Response.json({ tasks: [] })); });
  return Response.json({ tasks: [{ id: "created-request" }] });
 };
 let unsubscribe;
 try {
  unsubscribe = verificationStore.subscribe(() => {});
  const old = verificationStore.refresh();
  await verificationStore.create(valid());
  assert.equal(reads, 2);
  assert.equal(verificationStore.getSnapshot().tasks[0].id, "created-request");
  releaseOld(); await old;
  assert.equal(verificationStore.getSnapshot().tasks[0].id, "created-request");
 } finally { unsubscribe?.(); globalThis.fetch = oldFetch; globalThis.window = oldWindow; }
});
test("dispatcher activity counts persisted assignments separately from immutable drafts and fails unavailable rather than zero", async () => {
 const route = load("../app/api/verifications/route.ts");
 const { countAssignments } = load("../lib/verifier/models.ts");
 const previous = authModule.authenticatedClient;
 const actor = randomUUID(); let unavailable = false;
 const statuses = ["offered", "accepted", "submitted", "revision_requested", "approved", "completed", "declined"];
 const client = {
  rpc: async name => { assert.equal(name, "ensure_dispatcher_workspace"); return { error: null }; },
  from(table) {
   if (table === "verification_requests") return { select: () => ({ order: async () => ({ data: [], error: null }) }) };
   assert.equal(table, "task_assignments");
   return { select: columns => {
    assert.equal(columns, "status");
    return { eq: async (column, value) => {
     assert.equal(column, "assigned_by"); assert.equal(value, actor);
     return unavailable ? { error: {} } : { data: statuses.map(status => ({ status })), error: null };
    } };
   } };
  },
 };
 try {
  authModule.authenticatedClient = async () => ({ client, userId: actor });
  const result = await route.GET();
  assert.match(result.headers.get("Cache-Control"), /private, no-store/);
  assert.deepEqual(await result.json(), { tasks: [], activity: { active: 5, awaitingReview: 1, completed: 1 } });
  unavailable = true;
  assert.deepEqual(await (await route.GET()).json(), { tasks: [], activity: null });
  assert.throws(() => countAssignments([{ status: "draft" }]));
 } finally { authModule.authenticatedClient = previous; }
});
const { planSchema, generatedPlanSchema } = load("../lib/validation/plan.ts");
const { planRequest, planRequestSchema, requestFingerprint, isPlanStale } = load("../lib/plan-request.ts");
const { acceptStoredPlan } = load("../lib/task-storage.ts");
const { generatePlan } = load("../lib/serv/client.ts");
const fieldPlan = () => ({
  summary: "Observe access from a safe public position.", objective: "Document visible access without determining safety.",
  observationChecklist: ["Record visible obstructions without entering traffic."],
  evidenceInstructions: ["Photograph from a safe public position."], safetyInstructions: ["Stop if observation would require entering traffic or floodwater."],
  uncertaintyConditions: ["Report obscured views as unknown."], questionsForDispatcher: [], limitations: ["No conditions independently observed; no passability conclusion."],
});
const makeDraft = (storage = new MemoryStorage()) => createStoredTask(storage, valid(), now, randomUUID);
const makePlan = (task) => ({ version: 1, plan: fieldPlan(), generatedAt: new Date(now).toISOString(), model: "gpt-5.4-mini", durationMs: 10, fingerprint: requestFingerprint(planRequest(task)) });
test("plan schema requires complete bounded output and rejects application actions", () => {
  assert.equal(planSchema.safeParse(fieldPlan()).success, true);
  assert.equal(planSchema.safeParse({ ...fieldPlan(), safetyInstructions: [] }).success, false);
  assert.equal(planSchema.safeParse({ ...fieldPlan(), budget: 0 }).success, false);
  assert.equal(planSchema.safeParse({ ...fieldPlan(), observationChecklist: Array(9).fill("x") }).success, false);
});
test("server input rejects invalid coordinates, budget, unknown fields, IDs and excessive text", () => {
  const input = planRequest(makeDraft());
  for (const patch of [{ budget: -1 }, { coordinates: { latitude: 91, longitude: 0 } }, { title: "x".repeat(101) }, { id: "sample" }, { status: "Completed" }, { budget: 1.111 }]) assert.equal(planRequestSchema.safeParse({ ...input, ...patch }).success, false);
});
test("SERV fails closed without a key", async () => {
  await assert.rejects(generatePlan(planRequest(makeDraft()), { apiKey: "", fetcher: () => { throw new Error("must not fetch"); } }), /not configured/);
});
test("SERV HTTP, credit exhaustion, malformed envelopes, invalid JSON and incomplete output fail", async () => {
  const input = planRequest(makeDraft());
  for (const status of [401, 402, 429, 500]) await assert.rejects(generatePlan(input, { apiKey: "test", fetcher: async () => new Response("private error", { status }) }), /SERV/);
  for (const body of ["not json", JSON.stringify({}), JSON.stringify({ model: "test", choices: [{ finish_reason: "stop", message: { content: "invalid" } }] }), JSON.stringify({ model: "test", choices: [{ finish_reason: "length", message: { content: JSON.stringify(fieldPlan()) } }] })]) await assert.rejects(generatePlan(input, { apiKey: "test", fetcher: async () => new Response(body) }), /invalid plan/);
});
test("successful mocked SERV call preserves original request and records available metadata", async () => {
  const input = planRequest(makeDraft());
  const result = await generatePlan(input, { apiKey: "test", fetcher: async (url, init) => {
    assert.equal(url, "https://inference-api.openserv.ai/v1/chat/completions");
    assert.equal(init.headers.Authorization, "Bearer test");
    const body = JSON.parse(init.body);
    assert.deepEqual(JSON.parse(body.messages[1].content), input);
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    return Response.json({ id: "provider-test", model: "gpt-5.4-mini", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(fieldPlan()) } }], usage: { prompt_tokens: 100, completion_tokens: 90, total_tokens: 190, completion_tokens_details: { reasoning_tokens: 0 } } });
  }});
  assert.equal(generatedPlanSchema.safeParse(result).success, true);
  assert.equal(result.providerRequestId, "provider-test");
  assert.equal(result.usage.total_tokens, 190);
  assert.equal(result.fingerprint, requestFingerprint(input));
});
test("timeout and expired requests fail without fabricated output", async () => {
  await assert.rejects(generatePlan(planRequest(makeDraft()), { apiKey: "test", fetcher: async () => { throw new DOMException("timeout", "TimeoutError"); } }), /timed out/);
  await assert.rejects(generatePlan({ ...planRequest(makeDraft()), expiresAt: "2000-01-01T00:00:00Z" }, { apiKey: "test" }), /expired/);
});
test("accepted plan persists on original draft without budget or state transitions", () => {
  const storage = new MemoryStorage(); const task = makeDraft(storage);
  const plan = makePlan(task);
  const updated = acceptStoredPlan(storage, task.id, plan, now + 1000);
  assert.equal(updated.budget, task.budget); assert.equal(updated.status, "draft"); assert.equal(updated.source, "local");
  assert.deepEqual(readStoredTasks(storage).tasks[0], updated);
  assert.equal(isPlanStale(updated), false);
  assert.equal(isPlanStale({ ...updated, budget: 50 }), true);
  assert.equal(isPlanStale({ ...updated, question: "Changed question" }), true);
  assert.throws(() => acceptStoredPlan(storage, task.id, { ...plan, status: "Completed" }, now), /Unrecognized/);
});
test("stale responses, removed drafts, expiry, corrupt storage and failed writes cannot be accepted", () => {
  const storage = new MemoryStorage(); const task = makeDraft(storage); const plan = makePlan(task);
  storage.setItem(TASK_STORAGE_KEY, JSON.stringify({ version: 1, tasks: [{ ...task, budget: 100 }] }));
  assert.throws(() => acceptStoredPlan(storage, task.id, plan, now), /changed/);
  storage.setItem(TASK_STORAGE_KEY, JSON.stringify({ version: 1, tasks: [task] }));
  assert.throws(() => acceptStoredPlan(storage, task.id, plan, Date.parse(task.expiresAt)), /expired/);
  storage.setItem = () => { throw new Error("quota"); };
  assert.throws(() => acceptStoredPlan(storage, task.id, plan, now), /not saved/);
  assert.equal(readStoredTasks(storage).tasks[0].acceptedPlan, undefined);
  assert.throws(() => acceptStoredPlan(new MemoryStorage(), task.id, plan, now), /no longer/);
});

test("paid route denies production, cross-origin, remote and forwarded requests before provider access", async () => {
  const { POST } = load("../app/api/serv/plan-verification/route.ts");
  const prior = process.env.NODE_ENV;
  const req = (headers = {}) => new Request("http://localhost:3100/api/serv/plan-verification", { method: "POST", headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100", "x-forwarded-for": "127.0.0.1", "content-type": "application/json", ...headers }, body: "{}" });
  try {
    process.env.NODE_ENV = "production";
    assert.equal((await POST(req())).status, 403);
    process.env.NODE_ENV = "development";
    assert.equal((await POST(req({ origin: "https://other.example" }))).status, 403);
    assert.equal((await POST(req({ "x-forwarded-for": "203.0.113.1" }))).status, 403);
    assert.equal((await POST(req({ host: "public.example", origin: "http://public.example" }))).status, 403);
    assert.equal((await POST(req())).status, 400);
    assert.equal((await POST(req({ "content-type": "text/plain" }))).status, 415);
  } finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
});

const authModule = load("../lib/supabase/server.ts");
const records = load("../lib/supabase/records.ts");
function dbRow(draft) {
 return {id:draft.id,title:draft.title,question:draft.question,category:draft.category,location_description:draft.locationDescription,latitude:draft.coordinates.latitude,longitude:draft.coordinates.longitude,evidence_requirements:draft.evidenceRequirements,expiration:draft.expiresAt,approved_max_budget:String(draft.budget),status:"draft",created_at:draft.createdAt,request_fingerprint:requestFingerprint(planRequest(draft)),verification_plans:[]};
}
test("database mapper preserves exact cents, expiration fingerprint, accepted plans, and rejects corrupt records",()=>{
 const draft=createStoredTask(new MemoryStorage(),valid(),now);
 const row=dbRow(draft);
 const mapped=records.databaseDraft(row);
 assert.equal(mapped.source,"supabase"); assert.equal(mapped.budget,25.5);
 assert.equal(requestFingerprint(planRequest(mapped)),row.request_fingerprint);
 assert.throws(()=>records.databaseDraft({...row,approved_max_budget:"1.111"}));
 assert.throws(()=>records.databaseDraft({...row,status:"Completed"}));
 const plan=makePlan(draft);
 const withPlan=records.databaseDraft({...row,verification_plans:[{structured_plan:plan.plan,provider_model:plan.model,provider_request_id:null,request_fingerprint:plan.fingerprint,generated_at:plan.generatedAt,accepted_at:new Date(now+1000).toISOString(),version:1,duration_ms:plan.durationMs,usage:null}]});
 assert.equal(withPlan.acceptedPlan,undefined);
 assert.equal(withPlan.hasUntrustedPlan,true);
 const trustedRow={...row,created_by:"10000000-0000-4000-8000-000000000001",verification_plans:[{id:randomUUID(),receipt_signature:"ab".repeat(32),structured_plan:plan.plan,provider_model:plan.model,provider_request_id:null,request_fingerprint:plan.fingerprint,generated_at:plan.generatedAt,accepted_at:new Date(now+1000).toISOString(),version:1,duration_ms:plan.durationMs,usage:null,provenance:"serv_server_v1",generated_by:"10000000-0000-4000-8000-000000000001"}]};
 assert.equal(records.databaseDraft(trustedRow,undefined,now+1000).acceptedPlan.fingerprint,plan.fingerprint);
});
test("authenticated API validates creation, membership failures, duplicate import, and acceptance failures",async()=>{
 const original=authModule.authenticatedClient;
 const route=load("../app/api/verifications/route.ts");
 let denied=false; let insertError=null; let calls=[];
 const client={rpc:async(name,args)=>{calls.push({name,args});if(name==="ensure_dispatcher_workspace")return denied?{error:{}}:{data:"workspace-a"};return {data:args?.p?.id,error:insertError};},from:()=>({select:()=>({order:async()=>({data:[],error:null})})})};
 authModule.authenticatedClient=async()=>({client,userId:"user-a"});
 const req=body=>new Request("http://localhost/api/verifications",{method:"POST",headers:{origin:"http://localhost","content-type":"application/json"},body:JSON.stringify(body)});
 try{
  assert.equal((await route.GET()).status,200);
  const input={...valid(),expiresAt:new Date(Date.now()+86400000).toISOString()};
  assert.equal((await route.POST(req({action:"create",input}))).status,201);
  const insert=calls.find(c=>c.name==="create_verification");
  assert.equal(insert.args.p.status,"draft");assert.equal(insert.args.p.budget,25.5);
  assert.equal(insert.args.p.created_by,undefined);
  assert.equal((await route.POST(req({action:"create",input:{...input,status:"Completed"}}))).status,400);
  denied=true;
  assert.equal((await route.POST(req({action:"create",input}))).status,403);
  denied=false;insertError={code:"23505"};
  const draft=createStoredTask(new MemoryStorage(),valid(),now);
  assert.equal((await route.POST(req({action:"import",draft}))).status,409);
  insertError=null;
  assert.equal((await route.POST(req({action:"import",draft}))).status,201);
  insertError={code:"42501"};
  assert.equal((await route.POST(req({action:"accept",id:draft.id,planId:randomUUID()}))).status,409);
  authModule.authenticatedClient=async()=>{throw new Error("Unauthenticated");};
  assert.equal((await route.GET()).status,401);
  assert.notEqual((await route.POST(req({action:"create",input}))).status,201);
 }finally{authModule.authenticatedClient=original;}
});

test("SERV authenticates owners, denies verifier/mismatched requests, persists generated plans, and rate limits users",async()=>{
 const route=load("../app/api/serv/plan-verification/route.ts");
 const provider=load("../lib/serv/client.ts");
 const oldAuth=authModule.authenticatedClient, oldGenerate=provider.generatePlan;
 const previous=process.env.NODE_ENV; const oldKey=process.env.SERV_PLAN_SIGNING_KEY;
 process.env.SERV_PLAN_SIGNING_KEY="ab".repeat(32);
 const draft=makeDraft();let owner=true,role="dispatcher",stored=0,paid=0,corrupt=false;
 const client={from:(table)=>{const chain={select:()=>chain,eq:()=>chain,single:async()=>table==="workspace_members"?{data:{role}}:{data:owner?{...dbRow(draft),...(corrupt?{approved_max_budget:500}:{}),workspace_id:"w"}:null,error:owner?null:{}}};return chain;},rpc:async(name)=>{assert.equal(name,"save_verified_serv_plan");stored++;return{data:randomUUID(),error:null};}};
 const req=(patch={})=>new Request("http://127.0.0.1:3100/api/serv/plan-verification",{method:"POST",headers:{host:"127.0.0.1:3100",origin:"http://127.0.0.1:3100","x-forwarded-for":"127.0.0.1","content-type":"application/json"},body:JSON.stringify({...planRequest(draft),...patch})});
 try{
  process.env.NODE_ENV="development";
  authModule.authenticatedClient=async()=>{throw new Error("No claims");};
  assert.equal((await route.POST(req())).status,401);
  authModule.authenticatedClient=async()=>({client,userId:"10000000-0000-4000-8000-000000000001"});
  owner=false;assert.equal((await route.POST(req())).status,403);owner=true;
  role="verifier";assert.equal((await route.POST(req())).status,403);role="dispatcher";
  assert.equal((await route.POST(req({budget:500}))).status,409);
  corrupt=true;assert.equal((await route.POST(req())).status,409);assert.equal(paid,0);corrupt=false;
  delete process.env.SERV_PLAN_SIGNING_KEY;
  assert.equal((await route.POST(req())).status,503);assert.equal(paid,0);assert.equal(stored,0);
  process.env.SERV_PLAN_SIGNING_KEY="ab".repeat(32);
  provider.generatePlan=async()=>{paid++;return {...makePlan(draft),generatedAt:new Date().toISOString()};};
  assert.equal((await route.POST(req())).status,200);
  assert.equal(stored,1);assert.equal(paid,1);
  assert.equal((await route.POST(req())).status,429);
 }finally{authModule.authenticatedClient=oldAuth;provider.generatePlan=oldGenerate;if(oldKey===undefined)delete process.env.SERV_PLAN_SIGNING_KEY;else process.env.SERV_PLAN_SIGNING_KEY=oldKey;if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test("email auth handles confirmation, password sessions, and errors; server identity requires verified claims",async()=>{
 const {emailAuthentication,verifiedUserId}=load("../lib/supabase/auth.ts");
 const calls=[];
 const client={auth:{signUp:async args=>{calls.push(args);return{data:{session:null},error:null};},signInWithPassword:async args=>{calls.push(args);return{data:{session:{access_token:"test-only"}},error:null};},getClaims:async()=>({data:{claims:{sub:"verified-user"}},error:null}),getSession:()=>{throw new Error("Must never authorize using session alone");}}};
 const credentials={email:"test@example.invalid",password:"test-password"};
 assert.equal((await emailAuthentication(client,credentials,true,"http://localhost/auth/callback")).session,null);
 assert.equal(calls[0].options.emailRedirectTo,"http://localhost/auth/callback");
 assert.ok((await emailAuthentication(client,credentials,false,"unused")).session);
 assert.deepEqual(calls[1],credentials);
 assert.equal(await verifiedUserId(client),"verified-user");
 client.auth.getClaims=async()=>({data:null,error:new Error("Unverified")});
 await assert.rejects(()=>verifiedUserId(client),/Sign in/);
 client.auth.signInWithPassword=async()=>({data:null,error:new Error("Invalid login")});
 await assert.rejects(()=>emailAuthentication(client,credentials,false,"unused"),/Invalid login/);
});
test("callback rejects invalid codes and sign out requires same origin and reports provider errors",async()=>{
 const original=authModule.createClient;
 const callback=load("../app/auth/callback/route.ts"),signout=load("../app/auth/signout/route.ts");
 let error=null,signouts=0;
 authModule.createClient=async()=>({auth:{exchangeCodeForSession:async code=>({error:code==="valid"?null:{}}),signOut:async()=>{signouts++;return{error};}}});
 try{
  assert.match((await callback.GET(new Request("http://localhost/auth/callback?code=valid"))).headers.get("location"),/dispatcher$/);
  assert.match((await callback.GET(new Request("http://localhost/auth/callback?code=invalid"))).headers.get("location"),/login\?error=confirmation$/);
  const req=origin=>new Request("http://localhost/auth/signout",{method:"POST",headers:{origin}});
  assert.equal((await signout.POST(req("https://other.example"))).status,403);assert.equal(signouts,0);
  assert.equal((await signout.POST(req("http://localhost"))).status,303);assert.equal(signouts,1);
  error={};assert.equal((await signout.POST(req("http://localhost"))).status,503);
 }finally{authModule.createClient=original;}
});

test("hero motion pauses out of view/hidden tabs, respects reduced motion and user pause, and cleans up",()=>{
 const {manageSceneMotion}=load("../components/marketing/motion-lifecycle.ts");
 const oldWindow=globalThis.window, oldDocument=globalThis.document, oldObserver=globalThis.IntersectionObserver;
 const preference=new EventTarget();preference.matches=false;
 const doc=new EventTarget();doc.hidden=false;
 let callback, disconnected=false, starts=0;const handles=[];
 globalThis.window={matchMedia:()=>preference};globalThis.document=doc;
 globalThis.IntersectionObserver=class {constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}};
 const element={dataset:{}};
 const start=()=>{starts++;const handle={state:"playing",play(){this.state="playing";},pause(){this.state="paused";},cancel(){this.state="cancelled";}};handles.push(handle);return[handle];};
 let manager;
 try{
  manager=manageSceneMotion(element,start);
  assert.equal(starts,0);assert.equal(element.dataset.motion,"paused");
  callback([{isIntersecting:true}]);assert.equal(starts,1);assert.equal(handles[0].state,"playing");
  doc.hidden=true;doc.dispatchEvent(new Event("visibilitychange"));assert.equal(handles[0].state,"paused");
  doc.hidden=false;doc.dispatchEvent(new Event("visibilitychange"));assert.equal(handles[0].state,"playing");assert.equal(starts,1);
  manager.setPaused(true);assert.equal(handles[0].state,"paused");
  callback([{isIntersecting:false}]);manager.setPaused(false);assert.equal(handles[0].state,"paused");
  callback([{isIntersecting:true}]);assert.equal(handles[0].state,"playing");
  preference.matches=true;preference.dispatchEvent(new Event("change"));assert.equal(handles[0].state,"cancelled");assert.equal(element.dataset.motion,"static");
  callback([{isIntersecting:true}]);assert.equal(starts,1);
  preference.matches=false;preference.dispatchEvent(new Event("change"));assert.equal(starts,2);
  manager.destroy();manager=null;assert.equal(disconnected,true);assert.equal(handles[1].state,"cancelled");
  doc.dispatchEvent(new Event("visibilitychange"));preference.dispatchEvent(new Event("change"));assert.equal(starts,2);
 }finally{manager?.destroy();globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.IntersectionObserver=oldObserver;}
});

test("reduced-motion first load and unsupported observers never start a hero loop",()=>{
 const {manageSceneMotion}=load("../components/marketing/motion-lifecycle.ts");
 const oldWindow=globalThis.window,oldDocument=globalThis.document,oldObserver=globalThis.IntersectionObserver;
 const preference=new EventTarget();preference.matches=true;
 globalThis.window={matchMedia:()=>preference};globalThis.document=new EventTarget();
 let callback;globalThis.IntersectionObserver=class {constructor(fn){callback=fn;}observe(){}disconnect(){}};
 let starts=0;
 try{
  const element={dataset:{}};const manager=manageSceneMotion(element,()=>{starts++;return[];});
  callback([{isIntersecting:true}]);assert.equal(starts,0);assert.equal(element.dataset.motion,"static");manager.destroy();
  preference.matches=false;globalThis.IntersectionObserver=undefined;
  const fallback=manageSceneMotion(element,()=>{starts++;return[];});assert.equal(starts,0);assert.equal(element.dataset.motion,"static");fallback.destroy();
 }finally{globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.IntersectionObserver=oldObserver;}
});

test("server receipt binds every provider field, requester, request ID, fingerprint and version",()=>{
 const {createHmac,timingSafeEqual}=load("node:crypto");
 const {signServPlan}=load("../lib/serv/provenance.ts");
 const task=makeDraft(),input=planRequest(task),userId="10000000-0000-4000-8000-000000000001",key="cd".repeat(32);
 const plan=makePlan(task);const receipt=signServPlan(input,userId,plan,key,now);
 const expected=payload=>createHmac("sha256",Buffer.from(key,"hex")).update(payload,"utf8").digest();
 assert.ok(timingSafeEqual(expected(receipt.payload),Buffer.from(receipt.signature,"hex")));
 const envelope=JSON.parse(receipt.payload);
 assert.equal(envelope.requestId,task.id);assert.equal(envelope.userId,userId);assert.equal(envelope.plan.version,1);
 for(const mutate of [e=>e.plan.model="forged",e=>e.plan.providerRequestId="forged",e=>e.plan.plan.summary="Fabricated",e=>e.userId=randomUUID(),e=>e.requestId=`SP-${randomUUID()}`,e=>e.plan.version=2,e=>e.plan.fingerprint="forged"]){
  const changed=structuredClone(envelope);mutate(changed);
  assert.equal(timingSafeEqual(expected(JSON.stringify(changed)),Buffer.from(receipt.signature,"hex")),false);
 }
 assert.throws(()=>signServPlan(input,userId,{...plan,version:2},key,now));
 assert.throws(()=>signServPlan(input,userId,{...plan,fingerprint:"stale"},key,now),/stale/);
 assert.throws(()=>signServPlan(input,userId,{...plan,generatedAt:new Date(now-300001).toISOString()},key,now),/stale/);
 assert.throws(()=>signServPlan(input,userId,plan,"",now),/configuration/);
});

test("acceptance rejects caller-supplied metadata and uses only stored plan identity",async()=>{
 const original=authModule.authenticatedClient;const route=load("../app/api/verifications/route.ts");let calls=0;
 const id=`SP-${randomUUID()}`,planId=randomUUID();
 authModule.authenticatedClient=async()=>({client:{rpc:async(name,args)=>{calls++;assert.equal(name,"accept_verified_serv_plan");assert.deepEqual(args,{task_id:id,plan_id:planId});return{error:null};}},userId:"test"});
 const req=body=>new Request("http://localhost/api/verifications",{method:"POST",headers:{origin:"http://localhost"},body:JSON.stringify(body)});
 try{
  assert.equal((await route.POST(req({action:"accept",id,plan:makePlan(makeDraft())}))).status,400);
  assert.equal((await route.POST(req({action:"accept",id,planId,model:"forged"}))).status,400);
  assert.equal(calls,0);
  assert.equal((await route.POST(req({action:"accept",id,planId}))).status,200);assert.equal(calls,1);
 }finally{authModule.authenticatedClient=original;}
});

const ownerId = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
test("Origin validation accounts for Next loopback normalization without allowing aliases, forwarding or Host spoofing", () => {
 const { hasSameOrigin, requestOrigin } = load("../lib/request-origin.ts");
 const req = (host, origin, url = "http://localhost:3187/api/verifications", extra = {}) => new Request(url, { headers: { host, ...(origin ? { origin } : {}), ...extra } });
 assert.equal(hasSameOrigin(req("127.0.0.1:3187", "http://127.0.0.1:3187")), true);
 assert.equal(hasSameOrigin(req("[::1]:3187", "http://[::1]:3187")), true);
 assert.equal(hasSameOrigin(req("localhost:3187", "http://localhost:3187")), true);
 assert.equal(requestOrigin(req("127.0.0.1:3187", null)), "http://127.0.0.1:3187");
 for (const [host, origin] of [
  ["127.0.0.1:3187", "http://localhost:3187"], ["localhost:3187", "http://127.0.0.1:3187"],
  ["127.0.0.1:3187", "https://127.0.0.1:3187"], ["127.0.0.1:3188", "http://127.0.0.1:3188"],
  ["evil.example:3187", "http://evil.example:3187"], ["127.0.0.1:3187@evil.example", "http://evil.example"],
  ["127.0.0.1:3187/path", "http://127.0.0.1:3187"], ["127.0.0.1:3187", null],
 ]) assert.equal(hasSameOrigin(req(host, origin)), false, `${host} ${origin}`);
 assert.equal(hasSameOrigin(req("127.0.0.1:3187", "https://evil.example", undefined, { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" })), false);
 assert.equal(hasSameOrigin(req("app.example", "https://app.example", "https://app.example/api/verifications")), true);
 assert.equal(hasSameOrigin(req("evil.example", "https://evil.example", "https://app.example/api/verifications")), false);
});
test("normalized loopback callbacks and sign-out keep the original browser host", async () => {
 const original = authModule.createClient;
 const callback = load("../app/auth/callback/route.ts"), signout = load("../app/auth/signout/route.ts");
 authModule.createClient = async () => ({ auth: { exchangeCodeForSession: async () => ({ error: null }), signOut: async () => ({ error: null }) } });
 try {
  const confirmation = await callback.GET(new Request("http://localhost:3187/auth/callback?code=synthetic", { headers: { host: "127.0.0.1:3187" } }));
  assert.equal(confirmation.headers.get("location"), "http://127.0.0.1:3187/dispatcher");
  const logout = await signout.POST(new Request("http://localhost:3187/auth/signout", { method: "POST", headers: { host: "127.0.0.1:3187", origin: "http://127.0.0.1:3187" } }));
  assert.equal(logout.status, 303); assert.equal(logout.headers.get("location"), "http://127.0.0.1:3187/login");
  const rejected = await signout.POST(new Request("http://localhost:3187/auth/signout", { method: "POST", headers: { host: "127.0.0.1:3187", origin: "http://localhost:3187" } }));
  assert.equal(rejected.status, 403);
 } finally { authModule.createClient = original; }
});
test("normalized numeric-loopback API POST reaches authentication and cross-origin POST is denied first", async () => {
 const original = authModule.authenticatedClient;
 const route = load("../app/api/verifications/route.ts"); let checks = 0;
 authModule.authenticatedClient = async () => { checks++; throw new Error("No session"); };
 const req = (origin) => new Request("http://localhost:3187/api/verifications", { method: "POST", headers: { host: "127.0.0.1:3187", origin }, body: "{}" });
 try {
  assert.equal((await route.POST(req("http://127.0.0.1:3187"))).status, 401);
  assert.equal(checks, 1);
  assert.equal((await route.POST(req("http://localhost:3187"))).status, 403);
  assert.equal(checks, 1);
 } finally { authModule.authenticatedClient = original; }
});
function trustedPlanRow(draft, overrides = {}) {
 const plan = makePlan(draft);
 return {
  id: randomUUID(), verification_request_id: draft.id, provenance: "serv_server_v1",
  generated_by: ownerId, receipt_signature: "ab".repeat(32),
  structured_plan: plan.plan, provider_model: plan.model, provider_request_id: "synthetic-recovery-fixture",
  request_fingerprint: plan.fingerprint, generated_at: plan.generatedAt,
  accepted_at: null, version: 1, duration_ms: 10, usage: null, ...overrides,
 };
}
function recoveryRow(draft, plans) {
 return { ...dbRow(draft), created_by: ownerId, verification_plans: plans };
}
test("trusted pending plan survives a fresh load with its original ID and no receipt disclosure", () => {
 const draft = makeDraft(), saved = trustedPlanRow(draft);
 const row = recoveryRow(draft, [saved]);
 const first = records.databaseDraft(row, ownerId, now + 1000);
 const reloaded = records.databaseDraft(JSON.parse(JSON.stringify(row)), ownerId, now + 600000);
 assert.deepEqual(first.pendingPlan, reloaded.pendingPlan);
 assert.equal(reloaded.pendingPlan.planId, saved.id);
 assert.equal(reloaded.pendingPlan.providerRequestId, saved.provider_request_id);
 assert.equal(reloaded.acceptedPlan, undefined);
 assert.equal(reloaded.budget, draft.budget); assert.equal(reloaded.status, "draft");
 assert.equal(JSON.stringify(reloaded).includes(saved.receipt_signature), false);
 assert.equal(records.databaseDraft(row, otherId, now).pendingPlan, undefined);
 assert.equal(records.databaseDraft(row, undefined, now).pendingPlan, undefined);
 const { storedDraftSchema } = load("../lib/validation/verification.ts");
 assert.equal(storedDraftSchema.safeParse({ ...draft, pendingPlan: first.pendingPlan }).success, false);
});
test("recovery excludes legacy, wrong-owner, stale, unsupported, malformed and unbound plan rows", () => {
 const draft = makeDraft(), saved = trustedPlanRow(draft);
 const invalid = [
  { provenance: "legacy_untrusted" }, { provenance: undefined }, { provenance: "forged" },
  { generated_by: otherId }, { generated_by: null }, { version: 2 },
  { receipt_signature: null }, { receipt_signature: "forged" }, { id: undefined }, { id: "forged" },
  { request_fingerprint: "stale" }, { verification_request_id: `SP-${randomUUID()}` },
  { structured_plan: { ...fieldPlan(), budget: 500 } }, { structured_plan: {} },
  { generated_at: "invalid" }, { generated_at: new Date(now + 30001).toISOString() },
 ];
 for (const patch of invalid) {
  const result = records.databaseDraft(recoveryRow(draft, [{ ...saved, ...patch }]), ownerId, now);
  assert.equal(result.pendingPlan, undefined, JSON.stringify(patch));
  assert.equal(result.acceptedPlan, undefined);
 }
 assert.equal(records.databaseDraft(recoveryRow(draft, [saved]), ownerId, Date.parse(draft.expiresAt)).pendingPlan, undefined);
 assert.throws(() => records.databaseDraft({ ...recoveryRow(draft, [saved]), approved_max_budget: 50 }, ownerId, now), /fingerprint/);
});
test("newest valid pending plan is deterministic and older candidates do not return after acceptance", () => {
 const draft = makeDraft(), older = trustedPlanRow(draft);
 const newer = trustedPlanRow(draft, { generated_at: new Date(now + 1000).toISOString() });
 for (const plans of [[older, newer], [newer, older]]) {
  assert.equal(records.databaseDraft(recoveryRow(draft, plans), ownerId, now + 2000).pendingPlan.planId, newer.id);
 }
 const acceptedRow = recoveryRow(draft, [older, { ...newer, accepted_at: new Date(now + 3000).toISOString() }]);
 const accepted = records.databaseDraft(acceptedRow, ownerId, now + 4000);
 assert.equal(accepted.pendingPlan, undefined);
 assert.equal(accepted.acceptedPlan.generatedAt, newer.generated_at);
 const historical = records.databaseDraft(acceptedRow, ownerId, Date.parse(draft.expiresAt) + 1);
 assert.deepEqual(historical.acceptedPlan, accepted.acceptedPlan);
 assert.equal(historical.status, "draft"); assert.equal(historical.budget, draft.budget);
});
test("review selection restores saved output, follows refreshes, and rejects expired or stale candidates", () => {
 const { pendingPlanForReview } = load("../lib/plan-request.ts");
 const draft = makeDraft(), saved = trustedPlanRow(draft);
 const task = records.databaseDraft(recoveryRow(draft, [saved]), ownerId, now);
 const pending = task.pendingPlan;
 assert.equal(pendingPlanForReview(task, null, now).planId, saved.id);
 const newer = { ...pending, planId: randomUUID(), generatedAt: new Date(now + 1000).toISOString() };
 assert.equal(pendingPlanForReview(task, newer, now + 2000).planId, newer.planId);
 assert.equal(pendingPlanForReview({ ...task, pendingPlan: newer }, pending, now + 2000).planId, newer.planId);
 assert.equal(pendingPlanForReview(task, pending, Date.parse(task.expiresAt)), null);
 assert.equal(pendingPlanForReview({ ...task, budget: 100 }, pending, now), null);
 assert.equal(pendingPlanForReview({ ...task, source: "local" }, pending, now), null);
 assert.equal(pendingPlanForReview({ ...task, pendingPlan: { ...pending, version: 2 } }, null, now), null);
 const { planId, ...generated } = pending;
 void planId;
 assert.equal(pendingPlanForReview({ ...task, acceptedPlan: { ...generated, acceptedAt: new Date(now + 2000).toISOString() } }, pending, now + 3000), null);
});
test("mocked authenticated reload and store accept the saved ID without provider calls or state changes", async () => {
 const route = load("../app/api/verifications/route.ts");
 const { acceptVerificationPlan } = load("../lib/use-verifications.ts");
 const { pendingPlanForReview } = load("../lib/plan-request.ts");
 const time = Date.now();
 const draft = createStoredTask(new MemoryStorage(), { ...valid(), expiresAt: new Date(time + 86400000).toISOString() }, time);
 const saved = trustedPlanRow(draft, { generated_at: new Date(time).toISOString() });
 const row = recoveryRow(draft, [saved]);
 const oldAuth = authModule.authenticatedClient, oldFetch = globalThis.fetch, oldWindow = globalThis.window;
 const provider = load("../lib/serv/client.ts"), oldGenerate = provider.generatePlan;
 let actor = ownerId, events = 0, providerCalls = 0; const selections = [];
 const client = {
  from: () => ({ select: () => ({ order: async () => ({ data: actor === ownerId ? [structuredClone(row)] : [], error: null }) }) }),
  rpc: async (name, args) => {
   if (name === "ensure_dispatcher_workspace") return { data: "synthetic-workspace", error: null };
   assert.equal(name, "accept_verified_serv_plan");
   selections.push(args);
   if (actor !== ownerId) return { error: { code: "42501" } };
   if (!saved.accepted_at) { saved.accepted_at = new Date().toISOString(); events++; }
   return { error: null };
  },
 };
 authModule.authenticatedClient = async () => ({ client, userId: actor });
 provider.generatePlan = async () => { providerCalls++; throw new Error("Reload must not generate"); };
 globalThis.window = new EventTarget();
 globalThis.fetch = async (_url, options = {}) => options.method === "POST"
  ? route.POST(new Request("http://localhost/api/verifications", { method: "POST", headers: { origin: "http://localhost" }, body: options.body }))
  : route.GET();
 let unsubscribe;
 try {
  const first = (await (await route.GET()).json()).tasks[0];
  const reload = (await (await route.GET()).json()).tasks[0];
  assert.deepEqual(first.pendingPlan, reload.pendingPlan);
  const reviewed = pendingPlanForReview(reload, null, time);
  assert.equal(reviewed.planId, saved.id);
  unsubscribe = verificationStore.subscribe(() => {});
  await verificationStore.refresh();
  assert.equal(verificationStore.getSnapshot().tasks[0].pendingPlan.planId, saved.id);
  await acceptVerificationPlan(draft.id, reviewed);
  await acceptVerificationPlan(draft.id, reviewed);
  assert.deepEqual(selections[0], { task_id: draft.id, plan_id: saved.id });
  assert.equal(events, 1);
  const accepted = verificationStore.getSnapshot().tasks[0];
  assert.equal(accepted.pendingPlan, undefined); assert.ok(accepted.acceptedPlan);
  assert.equal(accepted.budget, draft.budget); assert.equal(accepted.status, "draft");
  actor = otherId;
  assert.deepEqual((await (await route.GET()).json()).tasks, []);
  await assert.rejects(acceptVerificationPlan(draft.id, reviewed), /acceptance failed/);
  assert.equal(providerCalls, 0);
 } finally {
  unsubscribe?.(); authModule.authenticatedClient = oldAuth;
  globalThis.fetch = oldFetch; globalThis.window = oldWindow; provider.generatePlan = oldGenerate;
 }
});
