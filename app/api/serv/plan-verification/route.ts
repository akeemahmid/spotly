import { signingKey, signServPlan } from "../../../../lib/serv/provenance";
import { persistedGeneratedPlanSchema } from "../../../../lib/validation/plan";
import { authenticatedClient } from "../../../../lib/supabase/server";
import { databaseDraft } from "../../../../lib/supabase/records";
import { planRequest, requestFingerprint } from "../../../../lib/plan-request";
import { generatePlan, ServError } from "../../../../lib/serv/server";
import { planRequestSchema } from "../../../../lib/plan-request";
let busy = false;
let nextAllowed = 0;
const userCooldown = new Map<string, number>();
export async function POST(request: Request) {
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const allowedHosts = ["localhost", "127.0.0.1", "[::1]"].map((name) => `${name}${url.port ? `:${url.port}` : ""}`);
  // Deny production, non-loopback hosts, forwarded requests, and cross-origin requests.
  if (process.env.NODE_ENV !== "development" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !host || !allowedHosts.includes(host) || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.headers.get("x-forwarded-for") ?? "") || request.headers.has("forwarded") || request.headers.get("origin") !== `${url.protocol}//${host}` || request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "SERV planning is available only in local development." }, 403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply({ error: "Send an application/json request." }, 415);
  if (busy || Date.now() < nextAllowed) return reply({ error: "Please wait a few seconds before retrying SERV." }, 429);
  let input;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "A draft payload is required." }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 16000) { await reader.cancel(); return reply({ error: "Request is too large." }, 413); }
      chunks.push(value);
    }
    input = planRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { return reply({ error: "Invalid draft details. Check all required fields and limits." }, 400); }
  let access;
  try { access = await authenticatedClient(); } catch { return reply({ error: "Sign in before requesting a plan." }, 401); }
  const { client, userId } = access;
  const { data: record, error: readError } = await client.from("verification_requests").select("*, verification_plans(*)").eq("id", input.id).eq("created_by", userId).single();
  if (readError || !record) return reply({ error: "Request not found or not owned by you." }, 403);
  const { data: member } = await client.from("workspace_members").select("role").eq("workspace_id", record.workspace_id).eq("user_id", userId).single();
  if (member?.role !== "dispatcher") return reply({ error: "Dispatcher access required." }, 403);
  let draft;
  try { draft = databaseDraft(record, userId); }
  catch { return reply({ error: "The saved request could not be validated. Reload and check the stored request before planning." }, 409); }
  if (Date.parse(draft.expiresAt) <= Date.now() || requestFingerprint(input) !== requestFingerprint(planRequest(draft))) return reply({ error: "Request changed or expired. Reload before planning." }, 409);
  for (const [id, until] of userCooldown) if (until <= Date.now()) userCooldown.delete(id);
  if (busy || Date.now() < nextAllowed || userCooldown.has(userId) || userCooldown.size >= 1000) return reply({ error: "Wait before generating another plan." }, 429);
  try { signingKey(); } catch { return reply({ error: "Configure SERV plan signing on the server and database before generation." }, 503); }
  userCooldown.set(userId, Date.now() + 60000);
  busy = true; nextAllowed = Date.now() + 5000;
  try {
    const generated = await generatePlan(planRequest(draft));
    const receipt = signServPlan(planRequest(draft), userId, generated);
    const { data: planId, error } = await client.rpc("save_verified_serv_plan", receipt);
    if (error) return reply({ error: "The generated plan could not be saved. Reload before retrying; provider credits may have been consumed." }, 503);
    return reply(persistedGeneratedPlanSchema.parse({ ...generated, planId }), 200);
  }
  catch (error) { return reply({ error: error instanceof ServError ? error.message : "Planning failed. Please retry." }, error instanceof ServError ? error.status : 500); }
  finally { busy = false; }
}
