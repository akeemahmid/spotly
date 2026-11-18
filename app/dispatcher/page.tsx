import type { Metadata } from "next";
import { Suspense } from "react";
import { DispatcherDashboard } from "@/components/dashboard/dispatcher-dashboard";

export const metadata: Metadata = {
  title: "Dispatcher workspace — Spotly",
  description:
    "Manage saved requests for real-world road-condition verification.",
};

type WorkspaceProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function Workspace({ searchParams }: WorkspaceProps) {
  const { view } = await searchParams;
  return (
    <DispatcherDashboard
      view={view === "Verifications" || view === "Map" ? view : "Overview"}
    />
  );
}

export default function DispatcherPage({ searchParams }: WorkspaceProps) {
  return (
    <Suspense
      fallback={
        <p className="request-loading" role="status">
          Loading workspace…
        </p>
      }
    >
      <Workspace searchParams={searchParams} />
    </Suspense>
  );
}
