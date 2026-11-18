export type SampleStatus =
  "In progress" | "Awaiting review" | "Completed" | "Planning";
export type Status = SampleStatus | "draft";
export type VerificationCategory =
  "road_conditions" | "route_access" | "site_access" | "other";
export type EvidenceRequirement = "photos" | "video" | "written_observation";
export interface Coordinates {
  latitude: number;
  longitude: number;
}

interface VerificationBase {
  id: string;
  title: string;
  question: string;
  locationDescription: string;
  /** Dispatcher-approved maximum USD budget; never a payment execution. */
  budget: number;
}
export interface SampleVerification extends VerificationBase {
  source: "sample";
  status: SampleStatus;
  requested: string;
}
export interface VerificationInput {
  title: string;
  question: string;
  category: VerificationCategory;
  locationDescription: string;
  coordinates: Coordinates;
  evidenceRequirements: EvidenceRequirement[];
  expiresAt: string;
  budget: number;
}
export interface DraftVerification extends VerificationBase, VerificationInput {
  source: "local" | "supabase";
  status: "draft";
  createdAt: string;
  /** Historical/imported plan exists but has no server-verified provenance. */
  hasUntrustedPlan?: boolean;
  acceptedPlan?: import("../lib/validation/plan").AcceptedPlan;
  /** Server-loaded trusted candidate; never stored in or imported from browser drafts. */
  pendingPlan?: import("../lib/validation/plan").PersistedGeneratedPlan;
}
export type Verification = SampleVerification | DraftVerification;
