import "server-only";
import { createServerClient } from "@supabase/ssr";
import { verifiedUserId } from "./auth";
import { cookies } from "next/headers";
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured. Set its public URL and publishable key.");
  const jar = await cookies();
  return createServerClient(url, key, { cookies: {
    getAll: () => jar.getAll(),
    setAll(values) { try { values.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* Server Components rely on Proxy for refresh. */ } },
  } });
}
export async function authenticatedClient() {
  const client = await createClient();
  return { client, userId: await verifiedUserId(client) };
}
