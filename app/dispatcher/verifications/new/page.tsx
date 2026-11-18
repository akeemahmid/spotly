import type { Metadata } from "next";
import { CreateVerification } from "@/components/verifications/create-verification";
export const metadata: Metadata = { title: "New verification — Spotly" };
export default function NewVerificationPage() {
  return <CreateVerification />;
}
