import { authenticatedClient } from "../../../lib/supabase/server";
import { hasSameOrigin } from "../../../lib/request-origin";
import {
  assignSchema,
  assignmentActionSchema,
} from "../../../lib/verifier/validation";
import { assignmentSchema } from "../../../lib/verifier/models";
import { reply, boundedBody } from "../../../lib/verifier/http";
import { requireWorkflow, workflowBlockReason } from "../../../lib/verifier/server";
import { planRequestSchema } from "../../../lib/plan-request";
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
  try {
    const body = JSON.parse(
      (await boundedBody(request, 12000)).toString("utf8"),
    );
    const { client } = access;
    if (body.action === "assign") {
      const input = assignSchema.parse(body);
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
    return reply(
      {
        error: "Invalid action or request fields. Your form has been retained.",
      },
      400,
    );
  }
}
