import { authenticatedClient } from "../../../lib/supabase/server";
import { databaseDraft } from "../../../lib/supabase/records";
import { storedDraftSchema, validateNewVerification } from "../../../lib/validation/verification";
import { z } from "zod";
import { planRequest, planRequestSchema, requestFingerprint } from "../../../lib/plan-request";
import { hasSameOrigin } from "../../../lib/request-origin";
import { countAssignments, type AssignmentCounts } from "../../../lib/verifier/models";
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function GET() {
 let access;
 try { access=await authenticatedClient(); } catch { return reply({error:"Sign in and check Supabase configuration, then retry."},401); }
 try {
  const {client,userId}=access;
  const {error:setup}=await client.rpc("ensure_dispatcher_workspace");
  if(setup) return reply({error:"Workspace setup failed. Check database migrations and membership."},503);
  const {data,error}=await client.from("verification_requests").select("*, verification_plans(*)").order("created_at",{ascending:false});
  if(error) return reply({error:"Requests could not be loaded. Check the database configuration and retry."},503);
  let activity: AssignmentCounts | null = null;
  try {
   const { data: assignments, error: activityError } = await client.from("task_assignments").select("status").eq("assigned_by",userId);
   if (!activityError) activity = countAssignments(assignments);
  } catch { /* Drafts remain readable if field-activity configuration is unavailable. */ }
  return reply({tasks:data.map((row)=>databaseDraft(row,userId)),activity});
 } catch { return reply({error:"Stored requests could not be validated or loaded. Check database data and retry."},503); }
}
export async function POST(request:Request) {
 if(!hasSameOrigin(request)) return reply({error:"Same-origin request required."},403);
 let access;
 try { access=await authenticatedClient(); } catch { return reply({error:"Sign in before saving a request."},401); }
 try {
  const {client}=access;
  const reader=request.body?.getReader(); if(!reader) return reply({error:"Missing request."},400);
  const chunks:Uint8Array[]=[]; let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>48000){await reader.cancel();return reply({error:"Payload too large."},413);}chunks.push(value);}
  const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(body.action==="accept") {
   const selection=z.object({action:z.literal("accept"),id:planRequestSchema.shape.id,planId:z.uuid()}).strict().parse(body);
   const {error}=await client.rpc("accept_verified_serv_plan",{task_id:selection.id,plan_id:selection.planId});
   return error?reply({error:"Plan acceptance failed. Reload to check ownership, expiration, and whether this plan was already accepted."},409):reply({ok:true});
  }
  const importing=body.action==="import";
  if(!importing && body.action!=="create")return reply({error:"Unknown action."},400);
  let draft;
  if(importing) draft=storedDraftSchema.parse(body.draft);
  else {
   const parsed=validateNewVerification(body.input);
   if(!parsed.success)return reply({error:parsed.error.issues[0]?.message},400);
   draft=storedDraftSchema.parse({...parsed.data,id:`SP-${crypto.randomUUID()}`,source:"local",status:"draft",createdAt:new Date().toISOString()});
  }
  const fingerprint=requestFingerprint(planRequest(draft));
  if(draft.acceptedPlan && draft.acceptedPlan.fingerprint!==fingerprint)return reply({error:"The imported plan is stale. Original local data has been preserved."},400);
  const {data:w,error:workspaceError}=await client.rpc("ensure_dispatcher_workspace");
  if(workspaceError)return reply({error:"Workspace unavailable. Check migrations and dispatcher membership."},403);
  const {data,error}=await client.rpc("create_verification",{p:draft,w,fingerprint,importing});
  if(error)return reply({error:error.code==="23505"?"This ID already exists. No server record was overwritten.":"Request was not saved. Check dispatcher access, input, and database configuration; your form is retained."},409);
  return reply({id:data},201);
 } catch {return reply({error:"Unable to save. Check your session and request fields, then retry."},400);}
}
