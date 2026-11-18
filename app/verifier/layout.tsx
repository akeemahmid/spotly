import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { authenticatedClient } from "@/lib/supabase/server";
import { Brand } from "@/components/layout/brand";
async function Protected({ children }: { children: React.ReactNode }) {
  let access;
  try {
    access = await authenticatedClient();
  } catch {
    redirect("/login?next=verifier");
  }
  const { client, userId } = access;
  const { data, error } = await client
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("role", "verifier")
    .limit(1);
  if (error || !data?.length)
    return (
      <main className="workflow-page">
        <Brand />
        <section className="card form-card">
          <h1>Verifier access required</h1>
          <p>
            An administrator must approve verifier membership before you can
            receive assignments. Signing up does not grant this role.
          </p>
          <Link className="auth-link" href="/dispatcher">
            Dispatcher workspace →
          </Link>
          <form action="/auth/signout" method="post">
            <button className="button secondary">Sign out</button>
          </form>
        </section>
      </main>
    );
  return (
    <>
      <header className="workflow-header">
        <Brand />
        <nav aria-label="Verifier navigation">
          <Link className="auth-link" href="/verifier/tasks">
            Your assignments
          </Link>
        </nav>
        <form action="/auth/signout" method="post">
          <button className="button secondary">Sign out</button>
        </form>
      </header>
      <main className="workflow-page">{children}</main>
    </>
  );
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p role="status">Checking verifier access…</p>}>
      <Protected>{children}</Protected>
    </Suspense>
  );
}
