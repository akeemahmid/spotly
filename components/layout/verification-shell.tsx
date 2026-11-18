"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Sidebar } from "./sidebar";
import { useVerifications } from "@/lib/use-verifications";
import type { ReactNode } from "react";

export function VerificationShell({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const router = useRouter();
  const { tasks } = useVerifications();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar
        view="Verifications"
        count={tasks.length}
        onView={(view) =>
          router.push(
            view === "Verifications"
              ? "/dispatcher?view=Verifications"
              : view === "Map"
                ? "/dispatcher?view=Map"
                : "/dispatcher",
          )
        }
      />
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Link href="/dispatcher">Workspace</Link>
            <span>/</span>
            <strong>{label}</strong>
          </div>
          <span className="demo-pill">
            <ShieldCheck size={13} />
            Saved workspace
          </span>
        </header>
        <main id="main" className="verification-main">
          <Link href="/dispatcher" className="back-link">
            <ArrowLeft size={15} />
            Back to workspace
          </Link>
          {children}
        </main>
      </div>
    </div>
  );
}
