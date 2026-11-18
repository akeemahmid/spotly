import { z } from "zod";
import { storedDraftSchema } from "../validation/verification";
import { acceptedPlanSchema, persistedGeneratedPlanSchema } from "../validation/plan";
import { planRequest, requestFingerprint } from "../plan-request";

const planRowSchema = z.object({
  id: z.string().optional(),
  verification_request_id: z.string().optional(),
  provenance: z.string().optional(),
  generated_by: z.string().nullable().optional(),
  receipt_signature: z.string().nullable().optional(),
  structured_plan: z.unknown(),
  provider_model: z.string(),
  provider_request_id: z.string().nullable(),
  request_fingerprint: z.string(),
  generated_at: z.string(),
  accepted_at: z.string().nullable(),
  version: z.number(),
  duration_ms: z.number(),
  usage: z.unknown().nullable(),
});
const rowSchema = z.object({
  created_by: z.string().optional(), request_fingerprint: z.string(),
  id: z.string(), title: z.string(), question: z.string(), category: z.string(),
  location_description: z.string(), latitude: z.number(), longitude: z.number(),
  evidence_requirements: z.array(z.string()), expiration: z.string(),
  approved_max_budget: z.union([z.number(), z.string()]),
  status: z.literal("draft"), created_at: z.string(),
  verification_plans: z.array(planRowSchema).optional(),
});

export function databaseDraft(value: unknown, requesterId?: string, now = Date.now()) {
  const row = rowSchema.parse(value);
  const canonical: unknown = JSON.parse(row.request_fingerprint);
  const expiration = Array.isArray(canonical) ? canonical[8] : null;
  if (typeof expiration !== "string" || Date.parse(expiration) !== Date.parse(row.expiration)) throw new Error("Invalid request fingerprint");
  const draft = storedDraftSchema.parse({
    id: row.id, source: "local", status: row.status, title: row.title,
    question: row.question, category: row.category,
    locationDescription: row.location_description,
    coordinates: { latitude: row.latitude, longitude: row.longitude },
    evidenceRequirements: row.evidence_requirements, expiresAt: expiration,
    budget: Number(row.approved_max_budget), createdAt: new Date(row.created_at).toISOString(),
  });
  if (requestFingerprint(planRequest(draft)) !== row.request_fingerprint) throw new Error("Invalid request fingerprint");

  // Trust comes from RLS-protected rows written by the signed RPC, never client/import metadata.
  // The receipt itself stays on the server and is not sent to the browser.
  const trusted = (row.verification_plans ?? []).flatMap((plan) => {
    if (plan.provenance !== "serv_server_v1" || !row.created_by || plan.generated_by !== row.created_by
      || !/^[0-9a-f]{64}$/.test(plan.receipt_signature ?? "")
      || (plan.verification_request_id !== undefined && plan.verification_request_id !== row.id)
      || plan.request_fingerprint !== row.request_fingerprint
      || !Number.isFinite(Date.parse(plan.generated_at)) || Date.parse(plan.generated_at) > now + 30000) return [];
    const result = persistedGeneratedPlanSchema.safeParse({
      planId: plan.id, version: plan.version, plan: plan.structured_plan,
      model: plan.provider_model,
      ...(plan.provider_request_id ? { providerRequestId: plan.provider_request_id } : {}),
      fingerprint: plan.request_fingerprint, generatedAt: new Date(plan.generated_at).toISOString(),
      durationMs: plan.duration_ms, ...(plan.usage ? { usage: plan.usage } : {}),
    });
    if (!result.success) return [];
    return [{ generated: result.data, acceptedAt: plan.accepted_at }];
  });
  const accepted = trusted.flatMap(({ generated, acceptedAt }) => {
    if (!acceptedAt || !Number.isFinite(Date.parse(acceptedAt))) return [];
    const { planId, ...output } = generated;
    void planId;
    const result = acceptedPlanSchema.safeParse({ ...output, acceptedAt: new Date(acceptedAt).toISOString() });
    return result.success ? [result.data] : [];
  }).sort((a, b) => Date.parse(b.acceptedAt) - Date.parse(a.acceptedAt) || Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
  const pending = requesterId === row.created_by && !!requesterId && Date.parse(draft.expiresAt) > now
    ? trusted.filter((plan) => plan.acceptedAt === null && (!accepted || Date.parse(plan.generated.generatedAt) > Date.parse(accepted.generatedAt)))
      .map((plan) => plan.generated)
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt) || a.planId.localeCompare(b.planId))[0]
    : undefined;
  return {
    ...draft, source: "supabase" as const,
    hasUntrustedPlan: !!row.verification_plans?.some((plan) => plan.provenance !== "serv_server_v1"),
    ...(accepted ? { acceptedPlan: accepted } : {}),
    ...(pending ? { pendingPlan: pending } : {}),
  };
}
