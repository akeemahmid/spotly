"use client";
import Link from "next/link";
import { DispatcherAssignment } from "./assignment-workflow";
import { ServPlan } from "./serv-plan";
import {
  Check,
  Clock3,
  FileCheck2,
  MapPin,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { VerificationShell } from "@/components/layout/verification-shell";
import { LocationMap } from "@/components/maps/location-map";
import { StatusBadge } from "@/components/ui/status-badge";
import { StorageNotice } from "./storage-notice";
import { useVerifications } from "@/lib/use-verifications";
import { categoryLabels, evidenceLabels } from "@/lib/validation/verification";
import { formatTimestamp } from "@/lib/verification-selectors";

export function VerificationDetails({ id }: { id: string }) {
  const { tasks, ready, issue, retry } = useVerifications();
  const task = tasks.find((item) => item.id === id);
  return (
    <VerificationShell label="Request details">
      <StorageNotice issue={issue} retry={retry} />
      {!ready && !task ? (
        <section className="card request-loading" role="status">
          Loading saved request…
        </section>
      ) : issue && !task ? (
        <section className="card form-card"><h1>Request unavailable</h1><p>Loading failed. Retry before treating this request as missing.</p></section>
      ) : !task ? (
        <section className="card empty-state">
          <MapPin size={28} />
          <h1>Request not found</h1>
          <p>
            This request is not available in your workspace. Check your account or import an existing browser draft from the overview.
          </p>
          <Link href="/dispatcher" className="button primary">
            Return to workspace
          </Link>
        </section>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {task.source !== "sample"
                  ? "YOUR SAVED DRAFT"
                  : "SAMPLE REQUEST"}
              </span>
              <h1>{task.title}</h1>
              <p className="task-id">{task.id}</p>
            </div>
            <Link
              href="/dispatcher/verifications/new"
              className="button primary"
            >
              <Plus size={16} />
              New verification
            </Link>
          </div>
          <div className="draft-status-banner">
            <ShieldCheck size={21} />
            <div>
              <strong>
                {task.source !== "sample"
                  ? "Saved request — field workflow tracked below."
                  : "Sample request — illustrative data only."}
              </strong>
              <p>
                {task.source !== "sample"
                  ? "This request and its approved maximum budget remain immutable. See assignment and review records below for recorded field activity. No payment is executed."
                  : "This is an example of the intended workflow, not a real verification or payment record."}
              </p>
            </div>
            <StatusBadge status={task.status} />
          </div>
          <div className="creation-grid detail-grid">
            <div className="detail-main">
              {task.source !== "sample" && <ServPlan key={task.id} task={task} storageIssue={issue} />}
              {task.source === "supabase" && <DispatcherAssignment requestId={task.id} />}
              <section className="card form-card">
                <div className="form-section-heading">
                  <span className="form-section-icon">
                    <FileCheck2 size={21} />
                  </span>
                  <div>
                    <h2>Request information</h2>
                    <p>
                      {task.source !== "sample"
                        ? "Dispatcher-defined requirements and limits."
                        : "Representative road-condition request."}
                    </p>
                  </div>
                </div>
                <div className="detail-question">
                  <span className="eyebrow">VERIFICATION QUESTION</span>
                  <p>{task.question}</p>
                </div>
                <dl className="detail-information">
                  <div>
                    <dt>Category</dt>
                    <dd>
                      {task.source !== "sample"
                        ? categoryLabels[task.category]
                        : "Not recorded in this sample"}
                    </dd>
                  </div>
                  <div>
                    <dt>Location description</dt>
                    <dd>{task.locationDescription}</dd>
                  </div>
                  <div>
                    <dt>
                      {task.source !== "sample"
                        ? "Created"
                        : "Sample relative time"}
                    </dt>
                    <dd>
                      {task.source !== "sample"
                        ? formatTimestamp(task.createdAt)
                        : `${task.requested} · illustrative`}
                    </dd>
                  </div>
                  <div>
                    <dt>Expiration</dt>
                    <dd>
                      {task.source !== "sample"
                        ? formatTimestamp(task.expiresAt)
                        : "Not recorded in this sample"}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {task.source !== "sample"
                        ? "Approved maximum budget"
                        : "Illustrative budget"}
                    </dt>
                    <dd className="detail-budget">
                      ${task.budget.toFixed(2)} <span>USD</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Storage</dt>
                    <dd>
                      {task.source !== "sample"
                        ? "Supabase workspace"
                        : "Bundled sample data"}
                    </dd>
                  </div>
                </dl>
                <p className="field-hint">
                  Dates use your device’s local timezone. A budget is a ceiling,
                  not a charge, reservation, or payment authorization to an
                  agent.
                </p>
              </section>
              <section className="card form-card">
                <div className="form-section-heading">
                  <span className="form-section-icon">
                    <Check size={21} />
                  </span>
                  <div>
                    <h2>Required evidence</h2>
                    <p>
                      Dispatcher requirements. Submission status is recorded in assignment and review.
                    </p>
                  </div>
                </div>
                {task.source !== "sample" ? (
                  <ul className="detail-evidence">
                    {task.evidenceRequirements.map((requirement) => (
                      <li key={requirement}>
                        <span />
                        <strong>{evidenceLabels[requirement]}</strong>
                        <small>Required</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-hint">
                    Evidence requirements were not recorded for this sample.
                  </p>
                )}
              </section>
              <section className="card form-card">
                <div className="form-section-heading">
                  <span className="form-section-icon">
                    <Clock3 size={21} />
                  </span>
                  <div>
                    <h2>Activity timeline</h2>
                    <p>Only recorded activity appears here.</p>
                  </div>
                </div>
                <ol className="activity-timeline">
                  <li>
                    <span className="timeline-dot" />
                    <div>
                      <strong>
                        {task.source !== "sample"
                          ? "Draft created"
                          : "Bundled sample request"}
                      </strong>
                      <time
                        dateTime={
                          task.source !== "sample" ? task.createdAt : undefined
                        }
                      >
                        {task.source !== "sample"
                          ? formatTimestamp(task.createdAt)
                          : "Illustrative data · no real activity recorded"}
                      </time>
                      <p>
                        {task.source !== "sample"
                          ? "The dispatcher set the requirements and approved the maximum budget. Assignment history is recorded separately."
                          : "No verifier activity, reports, or payment records are connected to this example."}
                      </p>
                    </div>
                  </li>
                  {task.source !== "sample" && task.acceptedPlan && <li><span className="timeline-dot" /><div><strong>Observation plan accepted</strong><time dateTime={task.acceptedPlan.acceptedAt}>{formatTimestamp(task.acceptedPlan.acceptedAt)}</time><p>Planning instructions saved. No assignment or spending was authorized.</p></div></li>}
                </ol>
              </section>
            </div>
            <aside className="creation-aside">
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>Selected location</h2>
                    <p>
                      {task.source !== "sample"
                        ? "Saved coordinates, without address inference."
                        : "Exact coordinates were not provided."}
                    </p>
                  </div>
                  <MapPin size={18} />
                </div>
                {task.source !== "sample" ? (
                  <>
                    <LocationMap value={task.coordinates} />
                    <div className="selected-coordinates">
                      {task.coordinates.latitude.toFixed(6)},{" "}
                      {task.coordinates.longitude.toFixed(6)}
                    </div>
                  </>
                ) : (
                  <div className="sample-location">
                    <MapPin size={27} />
                    <strong>{task.locationDescription}</strong>
                    <p>No exact map pin is shown for this sample.</p>
                  </div>
                )}
              </section>
              <div className="draft-note">
                <ShieldCheck size={20} />
                <div>
                  <h3>What happens next?</h3>
                  <p>
                    Use the assignment and review section to track authorized field work. Assignments stay disabled until signing and live authorization checks pass. Payments remain unavailable.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </>
      )}
    </VerificationShell>
  );
}
