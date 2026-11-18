import "server-only";
import { createHash, createHmac } from "node:crypto";
import sharp from "sharp";
import { signingKey } from "../serv/provenance";
import { MAX_EVIDENCE_BYTES, validateImageHeader } from "./validation";
export function workflowEnabled() {
  return workflowBlockReason(true) === null;
}
/** Configuration status only; RPC authorization remains the database boundary. */
export function workflowBlockReason(databaseReady: boolean) {
  if (!/^[0-9a-f]{64}$/i.test(process.env.SERV_PLAN_SIGNING_KEY ?? ""))
    return "signing_configuration" as const;
  if (process.env.PHASE3B_ENABLED !== "true") return "local_gate" as const;
  if (!databaseReady) return "database_readiness" as const;
  return null;
}
export function requireWorkflow() {
  if (!workflowEnabled())
    throw new Error(
      "Assignments and submissions are disabled pending signing and live authorization checks.",
    );
  signingKey();
}
/** Decode and re-encode to reject malformed/animated files and remove EXIF, including GPS. */
export async function normalizePhoto(input: Uint8Array, type: string) {
  validateImageHeader(input, type);
  const image = sharp(input, { limitInputPixels: 40000000, failOn: "warning" });
  const metadata = await image.metadata();
  if (
    (metadata.pages ?? 1) !== 1 ||
    !["jpeg", "png", "webp"].includes(metadata.format ?? "")
  )
    throw new Error("Choose a single JPEG, PNG, or WebP photograph.");
  const normalized = await image
    .rotate()
    .toFormat(
      type === "image/jpeg" ? "jpeg" : type === "image/png" ? "png" : "webp",
    )
    .toBuffer();
  if (normalized.length > MAX_EVIDENCE_BYTES)
    throw new Error(
      "The processed image exceeds 8 MB. Choose a smaller photograph.",
    );
  return normalized;
}
export function evidenceReceipt(
  value: {
    id: string;
    assignmentId: string;
    userId: string;
    path: string;
    observation: string;
    location?: unknown;
    mime: string;
    size: number;
    sha256: string;
  },
  key = signingKey(),
) {
  const payload = JSON.stringify({
    purpose: "spotly.evidence.v1",
    ...value,
    issuedAt: new Date().toISOString(),
  });
  return {
    payload,
    signature: createHmac("sha256", Buffer.from(key, "hex"))
      .update(payload)
      .digest("hex"),
  };
}
export const photoHash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
