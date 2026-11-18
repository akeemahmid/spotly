import { z } from "zod";
import { assignmentStatusSchema } from "./validation";
import { planSchema } from "../validation/plan";
export const evidenceSchema = z.object({
  id: z.uuid(),
  assignment_id: z.uuid(),
  verifier_id: z.uuid(),
  submission_round: z.number().int(),
  file_path: z.string(),
  mime_type: z.string(),
  byte_size: z.number(),
  observation: z.string(),
  submitted_at: z.string().nullable(),
  created_at: z.string(),
  location: z.unknown().nullable(),
});
export const assignmentSchema = z.object({
  id: z.uuid(),
  verification_request_id: z.string(),
  verifier_id: z.uuid(),
  assigned_by: z.uuid(),
  plan_id: z.uuid(),
  status: assignmentStatusSchema,
  submission_round: z.number().int(),
  created_at: z.string(),
  verification_requests: z.object({
    title: z.string(),
    question: z.string(),
    location_description: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    expiration: z.string(),
    evidence_requirements: z.array(z.string()),
  }),
  verification_plans: z.object({ structured_plan: planSchema }),
  task_evidence: z.array(evidenceSchema),
  assignment_events: z.array(
    z.object({
      id: z.uuid(),
      action: z.string(),
      actor_id: z.uuid(),
      note: z.string(),
      created_at: z.string(),
      evidence_id: z.uuid().nullable(),
    }),
  ),
});
export type Assignment = z.infer<typeof assignmentSchema>;
