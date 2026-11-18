import { Check, MapPin } from "lucide-react";
import type { VerificationInput } from "@/types/verification";
import { categoryLabels, evidenceLabels } from "@/lib/validation/verification";
import { formatTimestamp } from "@/lib/verification-selectors";

export function RequestSummary({ request }: { request: VerificationInput }) {
  return (
    <div className="request-summary">
      <span className="eyebrow">REQUEST SUMMARY</span>
      <h2>{request.title}</h2>
      <p className="summary-question">{request.question}</p>
      <dl>
        <div>
          <dt>Category</dt>
          <dd>{categoryLabels[request.category]}</dd>
        </div>
        <div>
          <dt>Location description</dt>
          <dd>{request.locationDescription}</dd>
        </div>
        <div>
          <dt>Selected coordinates</dt>
          <dd className="coordinate-value">
            <MapPin size={14} />
            {request.coordinates.latitude.toFixed(6)},{" "}
            {request.coordinates.longitude.toFixed(6)}
          </dd>
        </div>
        <div>
          <dt>Required evidence</dt>
          <dd>
            <ul>
              {request.evidenceRequirements.map((evidence) => (
                <li key={evidence}>
                  <Check size={13} />
                  {evidenceLabels[evidence]}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>
            {formatTimestamp(request.expiresAt)}
            <small>Your device’s local time</small>
          </dd>
        </div>
        <div className="summary-budget">
          <dt>Approved maximum budget</dt>
          <dd>
            ${request.budget.toFixed(2)} <span>USD</span>
          </dd>
        </div>
      </dl>
      <p className="summary-disclaimer">
        This sets a maximum budget ceiling. No funds are charged or reserved, and
        no verifier is assigned.
      </p>
    </div>
  );
}
