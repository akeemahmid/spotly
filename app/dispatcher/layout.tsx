import { Suspense } from "react";
import { redirect } from "next/navigation";
import { authenticatedClient } from "@/lib/supabase/server";
async function Protected({ children }: { children: React.ReactNode }) {
  try { await authenticatedClient(); } catch { redirect("/login"); }
  return <><form action="/auth/signout" method="post" className="account-bar"><span>Authenticated workspace</span><button className="button secondary">Sign out</button></form>{children}</>;
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p role="status">Checking your account…</p>}><Protected>{children}</Protected></Suspense>;
}
