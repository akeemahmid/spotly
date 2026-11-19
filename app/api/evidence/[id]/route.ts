import { authenticatedClient } from "../../../../lib/supabase/server";
import { EVIDENCE_BUCKET } from "../../../../lib/verifier/validation";
import { reply } from "../../../../lib/verifier/http";
import { photoHash } from "../../../../lib/verifier/server";
import { z } from "zod";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let access;
  try {
    access = await authenticatedClient();
  } catch {
    return reply({ error: "Sign in to view evidence." }, 401);
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return reply({ error: "Invalid evidence ID." }, 400);
  try {
    const { client } = access;
    const { data: e, error } = await client
      .from("task_evidence")
      .select("file_path,mime_type,submitted_at,sha256,byte_size")
      .eq("id", id)
      .maybeSingle();
    if (error || !e?.submitted_at)
      return reply({ error: "Evidence unavailable." }, 404);
    const { data: file, error: downloadError } = await client.storage
      .from(EVIDENCE_BUCKET)
      .download(e.file_path);
    if (downloadError || !file)
      return reply({ error: "Private evidence could not be loaded." }, 503);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== e.byte_size || photoHash(bytes) !== e.sha256)
      return reply(
        {
          error:
            "Evidence integrity check failed. Contact the workspace administrator.",
        },
        409,
      );
    // Authenticated proxy, no bearer share URL. Authorization is repeated on every view.
    return new Response(bytes, {
      headers: {
        "Content-Type": e.mime_type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'inline; filename="evidence"',
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return reply({ error: "Private evidence could not be loaded. Retry after checking your session or contact the workspace administrator." }, 503);
  }
}
