import { z } from "zod";
const text = z.string().trim().min(1).max(600);
const items = z.array(text).min(1).max(8);
export const planSchema = z.object({
  summary: text, objective: text,
  observationChecklist: items, evidenceInstructions: items,
  safetyInstructions: items, uncertaintyConditions: items,
  questionsForDispatcher: z.array(text).max(8), limitations: items,
}).strict();
export const generatedPlanSchema = z.object({
  version: z.literal(1), plan: planSchema,
  generatedAt: z.iso.datetime({ offset: true }),
  model: z.string().min(1).max(200),
  providerRequestId: z.string().min(1).max(300).optional(),
  fingerprint: z.string().min(1).max(16000),
  durationMs: z.number().int().nonnegative(),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative() }).strict().optional(),
}).strict();
export const acceptedPlanSchema = generatedPlanSchema.extend({ acceptedAt: z.iso.datetime({ offset: true }) }).strict();
export type GeneratedPlan = z.infer<typeof generatedPlanSchema>;
export type AcceptedPlan = z.infer<typeof acceptedPlanSchema>;

export const persistedGeneratedPlanSchema = generatedPlanSchema.extend({ planId: z.uuid() }).strict();
export type PersistedGeneratedPlan = z.infer<typeof persistedGeneratedPlanSchema>;
