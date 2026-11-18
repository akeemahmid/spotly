import { verificationInputSchema } from "./validation/verification";
import type { DraftVerification } from "../types/verification";
import { z } from "zod";
import { persistedGeneratedPlanSchema, type PersistedGeneratedPlan } from "./validation/plan";
export const planRequestSchema = verificationInputSchema.extend({
  id: z.string().regex(/^SP-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
}).strict();
export type PlanRequest = z.infer<typeof planRequestSchema>;
export function planRequest(task: DraftVerification): PlanRequest {
  return planRequestSchema.parse({ id: task.id, title: task.title, question: task.question, category: task.category, locationDescription: task.locationDescription, coordinates: task.coordinates, evidenceRequirements: task.evidenceRequirements, expiresAt: task.expiresAt, budget: task.budget });
}
// Canonical exact request snapshot, not a security signature. No hash collisions.
export function requestFingerprint(input: PlanRequest): string {
  const p = planRequestSchema.parse(input);
  return JSON.stringify([p.id, p.title, p.question, p.category, p.locationDescription, p.coordinates.latitude, p.coordinates.longitude, [...p.evidenceRequirements].sort(), p.expiresAt, p.budget]);
}
export function isPlanStale(task: DraftVerification): boolean {
  return !!task.acceptedPlan && task.acceptedPlan.fingerprint !== requestFingerprint(planRequest(task));
}

/** Choose a saved candidate without generating, signing, or authorizing anything. */
export function pendingPlanForReview(task: DraftVerification, candidate: PersistedGeneratedPlan | null, now: number) {
  if (task.source !== "supabase" || Date.parse(task.expiresAt) <= now) return null;
  const fingerprint = requestFingerprint(planRequest(task));
  const acceptedGeneration = task.acceptedPlan?.fingerprint === fingerprint
    ? Date.parse(task.acceptedPlan.generatedAt) : -Infinity;
  return [candidate, task.pendingPlan].flatMap((value) => {
    const result = persistedGeneratedPlanSchema.safeParse(value);
    if (!result.success || result.data.fingerprint !== fingerprint || Date.parse(result.data.generatedAt) <= acceptedGeneration) return [];
    return [result.data];
  }).sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt) || a.planId.localeCompare(b.planId))[0] ?? null;
}
