import { authenticatedClient } from "../../../lib/supabase/server";
import { hasSameOrigin } from "../../../lib/request-origin";
import {
  assignSchema,
  assignmentActionSchema,
  EVIDENCE_BUCKET,
} from "../../../lib/verifier/validation";
import { assignmentSchema } from "../../../lib/verifier/models";
import { reply, boundedBody } from "../../../lib/verifier/http";
import { photoHash, requireWorkflow, workflowBlockReason } from "../../../lib/verifier/server";
import { planRequestSchema } from "../../../lib/plan-request";
import { z } from "zod";
export async function GET(request: Request) {
  let access;
  try {
    access = await authenticatedClient();
  } catch {
    return reply({ error: "Sign in to view assignments." }, 401);
  }
  try {
    const { client, userId } = access;
    const requestId = new URL(request.url).searchParams.get("requestId");
    if (requestId && !planRequestSchema.shape.id.safeParse(requestId).success)
      return reply({ error: "Invalid request." }, 400);
    let query = client
      .from("task_assignments")
      .select(
        "*, verification_requests!verification_request_id(title,question,location_description,latitude,longitude,expiration,evidence_requirements), verification_plans!plan_id(structured_plan), task_evidence(*), assignment_events(*)",
      )
      .order("created_at", { ascending: false });
    if (requestId) query = query.eq("verification_request_id", requestId);
    else query = query.eq("verifier_id", userId);
    const { data, error } = await query;
    if (error)
      return reply(
        {
          error: "Assignments unavailable. Check migration 003 and membership.",
        },
        503,
      );
    const { data: gate, error: gateError } = await client.rpc("phase3b_ready");
    if (gateError)
      return reply({ error: "Workflow configuration unavailable." }, 503);
    let verifiers: { user_id: string }[] = [];
    let plans: { id: string }[] = [];
    if (requestId) {
      const { data: requestRow, error: requestError } = await client
        .from("verification_requests")
        .select("workspace_id")
        .eq("id", requestId)
        .maybeSingle();
      if (requestError) throw requestError;
      if (requestRow) {
        const { data: membership, error: membershipError } = await client
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", requestRow.workspace_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (membershipError) throw membershipError;
        if (membership?.role === "dispatcher") {
          const { data: members, error: membersError } = await client
            .from("workspace_members")
            .select("user_id")
            .eq("workspace_id", requestRow.workspace_id)
            .eq("role", "verifier");
          const { data: candidates, error: plansError } = await client
            .from("verification_plans")
            .select("id")
            .eq("verification_request_id", requestId)
            .eq("provenance", "serv_server_v1")
            .not("accepted_at", "is", null)
            .order("accepted_at", { ascending: false });
          if (membersError || plansError) throw new Error("Roster unavailable");
          verifiers = members ?? [];
          plans = candidates ?? [];
        }
      }
    }
    const blockedReason = workflowBlockReason(gate === true);
    return reply({
      assignments: assignmentSchema.array().parse(data),
      enabled: blockedReason === null,
      blockedReason,
      verifiers,
      plans,
    });
  } catch {
    return reply(
      {
        error:
          "Assignments could not be validated or loaded. Retry after checking configuration.",
      },
      503,
    );
  }
}
export async function POST(request: Request) {
  if (!hasSameOrigin(request))
    return reply({ error: "Same-origin request required." }, 403);
  let access;
  try {
    access = await authenticatedClient();
  } catch {
    return reply({ error: "Sign in to continue." }, 401);
  }
  try {
    requireWorkflow();
  } catch {
    return reply(
      {
        error:
          "Workflow disabled. Complete signing and live authorization checks before enabling assignments.",
      },
      503,
    );
  }
  let executing = false;
  let checkingEvidence = false;
  try {
    const body = JSON.parse(
      (await boundedBody(request, 12000)).toString("utf8"),
    );
    const { client } = access;
    if (body.action === "assign") {
      const input = assignSchema.parse(body);
      executing = true;
      const { data, error } = await client.rpc("assign_verification", {
        request_id: input.requestId,
        selected_plan: input.planId,
        verifier: input.verifierId,
      });
      return error
        ? reply(
            {
              error:
                "Assignment denied. Check dispatcher access, approved verifier, accepted plan, requirements, and expiration.",
            },
            409,
          )
        : reply({ id: data });
    }
    const input = assignmentActionSchema.parse(body);
    if (input.action === "approve" || input.action === "complete") {
      checkingEvidence = true;
      // The browser's loaded-image guard is usability only. Verify dispatcher
      // access BEFORE reading bytes, then recheck the actual finalized object.
      // The RPC still repeats role/plan/expiry/state checks under its row locks.
      const { data: assignment, error: assignmentError } = await client
        .from("task_assignments")
        .select("submission_round,verification_requests!verification_request_id(workspace_id)")
        .eq("id", input.id)
        .maybeSingle();
      if (assignmentError) return reply({ error: "Review is unavailable. Refresh and retry." }, 503);
      if (!assignment) return reply({ error: "Assignment unavailable." }, 404);
      const target = z.object({ submission_round: z.number().int(), verification_requests: z.object({ workspace_id: z.uuid() }) }).safeParse(assignment);
      if (!target.success) return reply({ error: "Assignment could not be validated for review." }, 503);
      const { data: membership, error: membershipError } = await client
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", target.data.verification_requests.workspace_id)
        .eq("user_id", access.userId)
        .maybeSingle();
      if (membershipError) return reply({ error: "Review access could not be checked. Refresh and retry." }, 503);
      if (membership?.role !== "dispatcher") return reply({ error: "Dispatcher review access required." }, 403);
      const { data: evidence, error: evidenceError } = await client
        .from("task_evidence")
        .select("file_path,byte_size,sha256,submitted_at,submission_round")
        .eq("id", input.evidenceId!)
        .eq("assignment_id", input.id)
        .not("submitted_at", "is", null)
        .maybeSingle();
      if (evidenceError) return reply({ error: "Evidence could not be checked. Refresh and retry." }, 503);
      if (!evidence?.submitted_at || evidence.submission_round !== target.data.submission_round)
        return reply({ error: "Select the current submitted evidence before reviewing." }, 409);
      const { data: photo, error: readError } = await client.storage.from(EVIDENCE_BUCKET).download(evidence.file_path);
      if (readError || !photo)
        return reply({ error: "The private photograph could not be read. No review or completion was recorded by this attempt. Reload the photograph before retrying." }, 503);
      const bytes = new Uint8Array(await photo.arrayBuffer());
      if (bytes.length !== evidence.byte_size || photoHash(bytes) !== evidence.sha256)
        return reply({ error: "Evidence integrity check failed. No review or completion was recorded by this attempt. Contact your administrator." }, 409);
    }
    executing = true;
    const { error } = await client.rpc("transition_assignment", {
      assignment: input.id,
      operation: input.action,
      selected_evidence: input.evidenceId ?? null,
      review_note: input.note,
    });
    return error
      ? reply(
          {
            error:
              "Transition denied. Reload to check your role, current submission, assignment status, and expiration.",
          },
          409,
        )
      : reply({ ok: true });
  } catch {
    if (executing)
      return reply({ error: "The action status could not be confirmed. Refresh the assignment before retrying the same action." }, 503);
    if (checkingEvidence)
      return reply({ error: "The photograph could not be verified. No review or completion was recorded by this attempt. Reload the photograph before retrying." }, 503);
    return reply(
      {
        error: "Invalid action or request fields. Your form has been retained.",
      },
      400,
    );
  }
}
