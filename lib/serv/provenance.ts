import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { generatedPlanSchema } from "../validation/plan";
import { planRequestSchema, requestFingerprint, type PlanRequest } from "../plan-request";
export function signingKey() {
  const key = process.env.SERV_PLAN_SIGNING_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error("SERV plan signing is not configured. Configure the server and private database key before generating.");
  return key;
}
/** Only call with the validated response from the server's provider adapter. Never sign browser plans. */
export function signServPlan(request: PlanRequest, userId: string, value: unknown, key = signingKey(), now = Date.now()) {
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error("Invalid signing key configuration.");
  const input = planRequestSchema.parse(request);
  const plan = generatedPlanSchema.parse(value);
  z.uuid().parse(userId);
  if (plan.fingerprint !== requestFingerprint(input) || Date.parse(input.expiresAt) <= now || Date.parse(plan.generatedAt) > now + 30000 || Date.parse(plan.generatedAt) < now - 300000) throw new Error("The generated plan is stale or does not match this request.");
  const payload = JSON.stringify({ purpose: "spotly.serv.plan.v1", requestId: input.id, userId, plan });
  const signature = createHmac("sha256", Buffer.from(key, "hex")).update(payload, "utf8").digest("hex");
  return { payload, signature };
}
