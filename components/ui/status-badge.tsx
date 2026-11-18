import { assignmentLabels, type AssignmentStatus } from "@/lib/verifier/validation";
import type { Status } from "@/types/verification";
export function StatusBadge({ status }: { status: Status | AssignmentStatus }) {
  return (
    <span
      className={`status status-${status.toLowerCase().replaceAll(" ", "-")}`}
    >
      <span />
      {status === "draft" ? "Draft" : status in assignmentLabels ? assignmentLabels[status as AssignmentStatus] : status}
    </span>
  );
}
