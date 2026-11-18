import { Suspense } from "react";
import { VerifierTasks } from "@/components/verifications/assignment-workflow";
async function Task({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VerifierTasks id={id} />;
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p role="status">Loading assignment…</p>}>
      <Task params={params} />
    </Suspense>
  );
}
