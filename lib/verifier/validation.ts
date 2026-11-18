import { z } from "zod";
import { planRequestSchema } from "../plan-request";
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const EVIDENCE_BUCKET = "verification-evidence";
export const imageTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const assignmentStatusSchema = z.enum([
  "offered",
  "accepted",
  "declined",
  "submitted",
  "revision_requested",
  "approved",
  "completed",
]);
export const assignmentActionSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(["accept", "decline", "approve", "revise", "complete"]),
    evidenceId: z.uuid().optional(),
    note: z.string().trim().max(2000).default(""),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      ["approve", "revise", "complete"].includes(value.action) &&
      !value.evidenceId
    )
      ctx.addIssue({
        code: "custom",
        path: ["evidenceId"],
        message: "Select the current submission.",
      });
    if (value.action === "revise" && !value.note)
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Explain the requested revision.",
      });
  });
export const assignSchema = z
  .object({
    action: z.literal("assign"),
    requestId: planRequestSchema.shape.id,
    planId: z.uuid(),
    verifierId: z.uuid(),
  })
  .strict();
export const evidenceInputSchema = z
  .object({
    id: z.uuid(),
    assignmentId: z.uuid(),
    observation: z.string().trim().min(1).max(4000),
    location: z
      .object({
        consent: z.literal(true),
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
      })
      .strict()
      .optional(),
  })
  .strict();
export function validateImageHeader(bytes: Uint8Array, type: string) {
  imageTypeSchema.parse(type);
  if (!bytes.length || bytes.length > MAX_EVIDENCE_BYTES)
    throw new Error("Choose an image up to 8 MB.");
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  const valid =
    type === "image/jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : type === "image/png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
        : ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (!valid)
    throw new Error("The file content does not match its image type.");
}
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;
export const assignmentLabels: Record<AssignmentStatus, string> = {
  offered: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  submitted: "Awaiting review",
  revision_requested: "Revision requested",
  approved: "Evidence approved",
  completed: "Completed",
};
