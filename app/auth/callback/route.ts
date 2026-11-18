import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { requestOrigin } from "../../../lib/request-origin";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  if (!origin) return new Response("Invalid request host", { status: 400 });
  const code = url.searchParams.get("code");
  if (code) {
    try {
      const client = await createClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL("/dispatcher", origin));
    } catch { /* Return to sign in without leaking provider details. */ }
  }
  return NextResponse.redirect(new URL("/login?error=confirmation", origin));
}
