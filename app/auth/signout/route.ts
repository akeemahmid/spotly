import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { requestOrigin } from "../../../lib/request-origin";
export async function POST(request: Request) {
  const origin = requestOrigin(request);
  if (!origin || request.headers.get("origin") !== origin) return new Response("Forbidden", { status: 403 });
  const client = await createClient();
  const { error } = await client.auth.signOut();
  if (error) return new Response("Sign out failed. Please retry.", { status: 503 });
  return NextResponse.redirect(new URL("/login", origin), 303);
}
