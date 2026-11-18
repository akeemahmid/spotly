"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { emailAuthentication } from "@/lib/supabase/auth";
import { Brand } from "./brand";
export function AuthForm({ signup = false, confirmationFailed = false, verifier = false }: { signup?: boolean; confirmationFailed?: boolean; verifier?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState(confirmationFailed ? "Email confirmation could not complete. Try signing in if already confirmed, or request a new confirmation by signing up again." : "");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const fields = new FormData(event.currentTarget);
    try {
      const client = createClient();
      const credentials = { email: String(fields.get("email")), password: String(fields.get("password")) };
      const data = await emailAuthentication(client, credentials, signup, `${window.location.origin}/auth/callback`);
      if (data.session) { router.replace(verifier ? "/verifier/tasks" : "/dispatcher"); router.refresh(); }
      else setMessage("Check your email to confirm your account, then sign in.");
    } catch { setMessage("Authentication could not complete. Check your credentials, email confirmation, and Supabase configuration, then retry."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="card form-card"><Brand /><h1>{signup ? "Create your account" : "Sign in to Spotly"}</h1><p>Request fresh information, wherever you need it.</p><form onSubmit={submit} className="auth-fields"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={8} maxLength={128} required /><button className="button primary" disabled={busy}>{busy ? "Please wait…" : signup ? "Sign up" : "Sign in"}</button><p role="status">{message}</p></form><Link className="auth-link" href={signup ? "/login" : "/signup"}>{signup ? "Already registered? Sign in" : "Create an account"}</Link><p><Link className="auth-link" href="/">← Back to Spotly</Link></p></section></main>;
}
