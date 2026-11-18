import type { SupabaseClient } from "@supabase/supabase-js";
type AuthClient = Pick<SupabaseClient, "auth">;
export async function verifiedUserId(client: AuthClient) {
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) throw new Error("Sign in to continue.");
  return data.claims.sub;
}
export async function emailAuthentication(client: AuthClient, credentials: { email: string; password: string }, signup: boolean, callback: string) {
  const result = signup
    ? await client.auth.signUp({ ...credentials, options: { emailRedirectTo: callback } })
    : await client.auth.signInWithPassword(credentials);
  if (result.error) throw result.error;
  return result.data;
}
