import { Suspense } from "react";
import { AuthForm } from "@/components/layout/auth-form";
async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
 const params = await searchParams;
 return <AuthForm confirmationFailed={params.error === "confirmation"} verifier={params.next === "verifier"} />;
}
export default function Page({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
 return <Suspense fallback={<p role="status">Loading sign in…</p>}><Login searchParams={searchParams} /></Suspense>;
}
