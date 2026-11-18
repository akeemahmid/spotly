import type { Metadata } from "next";
import { Suspense } from "react";
import { VerificationDetails } from "@/components/verifications/verification-details";
export const metadata: Metadata = { title: "Verification details — Spotly" };
async function Request({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VerificationDetails id={id} />;
}
export default function VerificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <p className="request-loading" role="status">
          Loading request…
        </p>
      }
    >
      <Request params={params} />
    </Suspense>
  );
}
