import { authenticatedClient } from "../../../lib/supabase/server";
import { hasSameOrigin } from "../../../lib/request-origin";
import {
  EVIDENCE_BUCKET,
  MAX_EVIDENCE_BYTES,
  evidenceInputSchema,
  imageTypeSchema,
} from "../../../lib/verifier/validation";
import { boundedBody, reply } from "../../../lib/verifier/http";
import {
  evidenceReceipt,
  normalizePhoto,
  photoHash,
  requireWorkflow,
} from "../../../lib/verifier/server";
// A per-process bound supplements the 8 MB streaming limit. Production quotas
// and deployment request-size limits must be configured before public operation.
let inFlight = 0;
export async function POST(request: Request) {
  if (!hasSameOrigin(request))
    return reply({ error: "Same-origin request required." }, 403);
  let access;
  try {
    access = await authenticatedClient();
  } catch {
    return reply({ error: "Sign in before submitting evidence." }, 401);
  }
  try {
    requireWorkflow();
  } catch {
    return reply(
      {
        error:
          "Evidence submission is disabled pending signing and live checks.",
      },
      503,
    );
  }
  if (inFlight >= 2)
    return reply(
      { error: "Uploads are busy. Retry manually in a moment." },
      429,
    );
  inFlight++;
  let stage = "validation";
  try {
    const raw = await boundedBody(request, MAX_EVIDENCE_BYTES + 24000);
    const form = await new Response(raw, {
      headers: { "Content-Type": request.headers.get("Content-Type") ?? "" },
    }).formData();
    const input = evidenceInputSchema.parse(
      JSON.parse(String(form.get("metadata"))),
    );
    const file = form.get("photo");
    if (!(file instanceof File))
      return reply({ error: "Choose a photograph." }, 400);
    const mime = imageTypeSchema.parse(file.type);
    const { client, userId } = access;
    stage = "assignment";
    // Authorize before decoding attacker-controlled images or contacting Storage.
    const { data: a, error: assignmentError } = await client
      .from("task_assignments")
      .select("id,verifier_id,status")
      .eq("id", input.assignmentId)
      .eq("verifier_id", userId)
      .maybeSingle();
    if (assignmentError || !a)
      return reply({ error: "Assignment unavailable." }, 403);
    stage = "validation";
    const photo = await normalizePhoto(
      new Uint8Array(await file.arrayBuffer()),
      mime,
    );
    stage = "reservation";
    const { data: path, error: reservationError } = await client.rpc(
      "reserve_task_evidence",
      {
        evidence: input.id,
        assignment: input.assignmentId,
        observation_text: input.observation,
        mime,
        size_bytes: photo.length,
        consent_location: input.location ?? null,
      },
    );
    if (reservationError || typeof path !== "string")
      return reply(
        {
          error:
            "Submission denied. Check acceptance, expiration, current revision, and duplicate submission. Keep this form for retry.",
        },
        409,
      );
    const bucket = client.storage.from(EVIDENCE_BUCKET);
    stage = "storage";
    // No upsert: even a racing direct client cannot replace a submitted image.
    const { error: uploadError } = await bucket.upload(path, photo, {
      contentType: mime,
      upsert: false,
      cacheControl: "3600",
    });
    const { data: stored, error: readError } = await bucket.download(path);
    if (readError || !stored)
      return reply(
        {
          error:
            "Private photo upload could not be verified because Storage readback failed. This attempt did not finalize evidence for review. Keep this form and retry with the same photo, observation, and consent fields.",
        },
        503,
      );
    const bytes = new Uint8Array(await stored.arrayBuffer());
    if (bytes.length !== photo.length || photoHash(bytes) !== photoHash(photo))
      return reply(
        {
          error:
            "An immutable upload with different content already exists. Contact the workspace administrator; nothing was submitted.",
        },
        409,
      );
    if (uploadError && !["409", "400"].includes(String(uploadError.statusCode)))
      return reply({ error: "Private photo upload failed. This attempt did not finalize evidence for review. Keep this form and retry with the same submission." }, 503);
    const receipt = evidenceReceipt({
      ...input,
      userId,
      path,
      mime,
      size: bytes.length,
      sha256: photoHash(bytes),
    });
    stage = "finalization";
    const { error: submissionError } = await client.rpc(
      "submit_task_evidence",
      receipt,
    );
    return submissionError
      ? reply(
          {
            error:
              "The photo was verified privately but submission could not be confirmed. Refresh the task before retrying the same submission; do not create another submission.",
          },
          409,
        )
      : reply({ ok: true, id: input.id });
  } catch {
    if (stage !== "validation")
      return reply({ error: stage === "finalization"
        ? "Submission status could not be confirmed. Refresh the task before retrying the same submission."
        : "The evidence service could not complete the upload checks. This attempt did not finalize evidence for review. Keep this form and retry with the same photo, observation, and consent fields." }, 503);
    return reply(
      {
        error:
          "Submission failed. Use one valid JPEG, PNG, or WebP up to 8 MB and an observation up to 4,000 characters. Your form is retained.",
      },
      400,
    );
  } finally {
    inFlight--;
  }
}
