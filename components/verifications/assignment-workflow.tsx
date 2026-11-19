"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated no-store evidence proxy; never use public image optimization. */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LocationMap } from "@/components/maps/location-map";
import { assignmentSchema, type Assignment } from "@/lib/verifier/models";
import {
  assignmentLabels,
  assignmentActionSchema,
  evidenceInputSchema,
  MAX_EVIDENCE_BYTES,
  imageTypeSchema,
} from "@/lib/verifier/validation";
import { evidenceLabels } from "@/lib/validation/verification";
import type { EvidenceRequirement } from "@/types/verification";
import { StatusBadge } from "@/components/ui/status-badge";

type Result = {
  assignments: Assignment[];
  enabled: boolean;
  blockedReason: "signing_configuration" | "local_gate" | "database_readiness" | null;
  verifiers: { user_id: string }[];
  plans: { id: string }[];
};
class AssignmentLoadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function loadAssignments(
  requestId?: string,
  signal?: AbortSignal,
): Promise<Result> {
  const response = await fetch(
    `/api/assignments${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ""}`,
    { cache: "no-store", signal },
  );
  const value = await response.json();
  if (!response.ok) throw new AssignmentLoadError(value.error ?? "Assignments unavailable.", response.status);
  return {
    ...value,
    assignments: assignmentSchema.array().parse(value.assignments),
  };
}
async function sendAction(value: unknown) {
  const response = await fetch("/api/assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Action failed.");
}
function useAssignments(requestId?: string) {
  const [data, setData] = useState<Result | null>(null);
  const [issue, setIssue] = useState("");
  const sequence = useRef(0);
  const cancelPending = useCallback(() => { sequence.current++; }, []);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const current = ++sequence.current;
      try {
        const result = await loadAssignments(requestId, signal);
        if (!signal?.aborted && current === sequence.current) {
          setData(result);
          setIssue("");
          return true;
        }
      } catch (error) {
        if (!signal?.aborted && current === sequence.current) {
          // Keep unsaved work on service failures, but discard another account's
          // cached record once the server says the session/access is no longer valid.
          if (error instanceof AssignmentLoadError && [401, 403].includes(error.status)) setData(null);
          setIssue(
            error instanceof Error ? error.message : "Assignments unavailable.",
          );
        }
      }
      return false;
    },
    [requestId],
  );
  useEffect(() => {
    const controller = new AbortController();
    const focus = () => {
      void refresh(controller.signal);
    };
    focus();
    window.addEventListener("focus", focus);
    return () => {
      cancelPending();
      controller.abort();
      window.removeEventListener("focus", focus);
    };
  }, [refresh, cancelPending]);
  return { data, issue, refresh };
}
function RefreshIssue({ issue, retry }: { issue: string; retry: () => void }) {
  return issue ? (
    <div role="alert">
      <p>{issue}</p>
      <p>Your form is retained. Refresh to see the latest status before continuing.</p>
      <button type="button" className="button secondary" onClick={retry}>Retry refresh</button>
    </div>
  ) : null;
}
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
function Gate({ enabled, reason }: { enabled: boolean; reason: Result["blockedReason"] }) {
  return enabled ? null : (
    <p className="workflow-gate" role="status">
      {reason === "signing_configuration"
        ? "Field work is unavailable because secure signing is not configured. Contact your administrator."
        : reason === "local_gate"
          ? "Field work is not enabled. An administrator must complete access checks before enabling it."
          : "Field work is unavailable until an administrator confirms the required security checks."}
    </p>
  );
}
function History({ assignment }: { assignment: Assignment }) {
  return (
    <section>
      <h3>Recorded history</h3>
      <ol className="workflow-history">
        {[...assignment.assignment_events]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((event) => (
            <li key={event.id}>
              <strong>
                {event.action === "complete"
                  ? "Reviewed task completed"
                  : event.action}
              </strong>
              <time dateTime={event.created_at}>
                {new Date(event.created_at).toLocaleString()}
              </time>
              <span className="field-hint">Account {event.actor_id}</span>
              {event.note && <p>{event.note}</p>}
            </li>
          ))}
      </ol>
    </section>
  );
}
export function EvidenceSubmissions({ assignment, onPhotoState }: { assignment: Assignment; onPhotoState?: (id: string, loaded: boolean) => void }) {
  const evidence = [...assignment.task_evidence]
    .filter((e) => e.submitted_at)
    .sort((a, b) => b.submission_round - a.submission_round);
  return (
    <section>
      <h3>Submitted evidence</h3>
      {!evidence.length ? (
        <p>No evidence submitted yet.</p>
      ) : (
        evidence.map((e) => {
          const location = evidenceInputSchema.shape.location.safeParse(e.location);
          const sharedLocation = location.success ? location.data : undefined;
          const review = assignment.assignment_events
            .filter((event) => event.evidence_id === e.id && ["approve", "revise", "complete"].includes(event.action))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
          return (
          <article className="workflow-evidence" key={e.id}>
            <h4>Submission {e.submission_round}</h4>
            <p><strong>Original question:</strong> {assignment.verification_requests.question}</p>
            <p><strong>Requested location:</strong> {assignment.verification_requests.location_description}</p>
            <EvidencePhoto
              id={e.id}
              title={assignment.verification_requests.title}
              round={e.submission_round}
              onPhotoState={onPhotoState}
            />
            <p><strong>Verifier observation</strong></p>
            <p className="workflow-observation">{e.observation}</p>
            <p>
              Submitted{" "}
              <time dateTime={e.submitted_at!}>
                {new Date(e.submitted_at!).toLocaleString()}
              </time>
            </p>
            <p className="field-hint">
              {sharedLocation
                ? `Verifier-provided coordinates: ${sharedLocation.latitude.toFixed(6)}, ${sharedLocation.longitude.toFixed(6)}. Shared with consent; not independently verified.`
                : "No optional location shared."}
            </p>
            <p className="field-hint">Observation and photo capture times are not recorded. Submission time does not establish photograph freshness or location authenticity.</p>
            <p><strong>Review outcome:</strong> {review?.action === "complete" ? "Completed after approval" : review?.action === "approve" ? "Approved" : review?.action === "revise" ? "Revision requested" : "Awaiting review"}</p>
            {review && <p>Reviewed <time dateTime={review.created_at}>{new Date(review.created_at).toLocaleString()}</time>{review.note && <> · {review.note}</>}</p>}
          </article>
          );
        })
      )}
    </section>
  );
}
function EvidencePhoto({
  id,
  title,
  round,
  onPhotoState,
}: {
  id: string;
  title: string;
  round: number;
  onPhotoState?: (id: string, loaded: boolean) => void;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div>
      <p role="alert">
        The private photograph could not be displayed. Your observation and
        submission history are still available. Refresh your session or retry
        the photograph before approving this evidence.
      </p>
      <button className="button secondary" onClick={() => setFailed(false)}>
        Retry photograph
      </button>
    </div>
  ) : (
    <img
      src={`/api/evidence/${id}`}
      alt={`Submitted photograph for ${title}, revision ${round}`}
      loading="lazy"
      onLoad={() => onPhotoState?.(id, true)}
      onError={() => { setFailed(true); onPhotoState?.(id, false); }}
    />
  );
}
function EvidenceForm({
  assignment,
  onSaved,
  disabled,
}: {
  assignment: Assignment;
  onSaved: () => Promise<boolean>;
  disabled: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submissionId = useRef<string | null>(null);
  // Reuse a pending reservation after a reload rather than creating duplicate objects.
  const pending = assignment.task_evidence.find(
    (e) =>
      e.submission_round === assignment.submission_round && !e.submitted_at,
  );
  const location = evidenceInputSchema.shape.location.safeParse(pending?.location);
  const retryLocation = location.success ? location.data : undefined;
  const [consent, setConsent] = useState(Boolean(retryLocation));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    setMessage("");
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const photo = form.get("photo");
      if (
        !(photo instanceof File) ||
        !imageTypeSchema.safeParse(photo.type).success ||
        photo.size < 1 ||
        photo.size > MAX_EVIDENCE_BYTES
      )
        throw new Error("Choose a JPEG, PNG, or WebP photograph up to 8 MB.");
      submissionId.current ??= pending?.id ?? crypto.randomUUID();
      const parsed = evidenceInputSchema.safeParse({
        id: submissionId.current,
        assignmentId: assignment.id,
        observation: String(form.get("observation")),
        ...(consent
          ? {
              location: {
                consent: true,
                latitude: Number(form.get("latitude")),
                longitude: Number(form.get("longitude")),
              },
            }
          : {}),
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues[0]?.message ??
            "Check your observation and consent coordinates.",
        );
      const metadata = parsed.data;
      const body = new FormData();
      body.set("metadata", JSON.stringify(metadata));
      body.set("photo", photo);
      const response = await fetch("/api/evidence", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Submission failed.");
      if (result.ok !== true || result.id !== submissionId.current)
        throw new Error("Submission status could not be confirmed. Refresh the task before retrying the same submission.");
      const refreshed = await onSaved();
      setMessage(refreshed ? "Evidence submitted for human review." : "The server confirmed submission, but the latest task status could not load. Refresh before taking another action.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Submission failed. Keep this form and retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="workflow-form"
      onSubmit={submit}
      aria-describedby="evidence-help evidence-result"
    >
      <h3>
        {assignment.status === "revision_requested"
          ? "Submit a revision"
          : "Submit evidence"}
      </h3>
      <p id="evidence-help">
        One photograph and a written observation per submission. JPEG, PNG, or
        WebP, maximum 8 MB. Embedded image metadata is removed.
      </p>
      {pending && (
        <p className="workflow-gate">
          This upload is unfinished. Retry with the same photo, observation,
          and consent fields. Contact your administrator if it still fails.
        </p>
      )}
      <label htmlFor="evidence-photo">Photograph</label>
      <input
        id="evidence-photo"
        name="photo"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        disabled={busy || disabled}
      />
      <label htmlFor="evidence-observation">Written observation</label>
      <textarea
        id="evidence-observation"
        name="observation"
        required
        minLength={1}
        maxLength={4000}
        rows={5}
        defaultValue={pending?.observation}
        disabled={busy || disabled}
      />
      <label className="workflow-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={busy || disabled}
        />
        I consent to sharing optional location coordinates with this workspace.
      </label>
      {consent && (
        <div className="workflow-coordinates">
          <label>
            Latitude
            <input
              name="latitude"
              type="number"
              min={-90}
              max={90}
              step="any"
              required
              defaultValue={retryLocation?.latitude}
              disabled={busy || disabled}
            />
          </label>
          <label>
            Longitude
            <input
              name="longitude"
              type="number"
              min={-180}
              max={180}
              step="any"
              required
              defaultValue={retryLocation?.longitude}
              disabled={busy || disabled}
            />
          </label>
        </div>
      )}
      <p className="field-hint">
        Coordinates are optional, user supplied, and do not prove that a
        photograph is authentic. Only observe from a safe, lawful location;
        follow the accepted safety instructions.
      </p>
      <button className="button primary" disabled={busy || disabled}>
        {busy ? "Submitting…" : "Submit for review"}
      </button>
      <p id="evidence-result" role="status">
        {message}
      </p>
    </form>
  );
}
export function VerifierTasks({ id }: { id?: string }) {
  const now = useNow();
  const { data, issue, refresh } = useAssignments();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const assignment = data?.assignments.find((a) => a.id === id);
  async function respond(action: "accept" | "decline") {
    if (!assignment || busy || issue || !data?.enabled || Date.parse(assignment.verification_requests.expiration) <= now) return;
    setBusy(true);
    setMessage("");
    try {
      await sendAction({ id: assignment.id, action });
      if (!await refresh()) setMessage("The server saved your response, but the latest task status could not load. Refresh before responding again.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }
  if (issue && !data)
    return (
      <section className="card form-card">
        <h1>Assignments unavailable</h1>
        <p role="alert">{issue}</p>
        <button className="button secondary" onClick={() => void refresh()}>
          Retry
        </button>
      </section>
    );
  if (!data) return <p role="status">Loading authorized assignments…</p>;
  if (!id)
    return (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">VERIFIER WORKSPACE</span>
            <h1>Your assignments</h1>
            <p>
              Tasks assigned to you.
            </p>
          </div>
          <button className="button secondary" onClick={() => void refresh()}>
            Refresh assignments
          </button>
        </div>
        <Gate enabled={data.enabled} reason={data.blockedReason} />
        <RefreshIssue issue={issue} retry={() => void refresh()} />
        {data.assignments.length ? (
          <div className="workflow-list">
            {data.assignments.map((a) => (
              <Link
                href={`/verifier/tasks/${a.id}`}
                className="card workflow-task"
                key={a.id}
              >
                <div>
                  <h2>{a.verification_requests.title}</h2>
                  <p>{a.verification_requests.location_description}</p>
                  <p>
                    Expires{" "}
                    {new Date(
                      a.verification_requests.expiration,
                    ).toLocaleString()}
                  </p>
                </div>
                <StatusBadge status={a.status} />
                <span className="auth-link">Open task →</span>
              </Link>
            ))}
          </div>
        ) : (
          <section className="card form-card">
            <h2>No assignments yet</h2>
            <p>
              Your assigned tasks will appear here. A dispatcher must assign
              work to your approved account.
            </p>
          </section>
        )}
      </>
    );
  if (!assignment)
    return (
      <section className="card form-card">
        <h1>Task unavailable</h1>
        <p>This task is not assigned to your account.</p>
        <Link className="auth-link" href="/verifier/tasks">
          Back to assignments →
        </Link>
      </section>
    );
  const request = assignment.verification_requests;
  const plan = assignment.verification_plans.structured_plan;
  const expired = Date.parse(request.expiration) <= now;
  return (
    <>
      <Link className="auth-link" href="/verifier/tasks">
        ← Your assignments
      </Link>
      <div className="page-heading">
        <div>
          <h1>{request.title}</h1>
          <p>{request.question}</p>
        </div>
        <StatusBadge status={assignment.status} />
      </div>
      <Gate enabled={data.enabled} reason={data.blockedReason} />
      <RefreshIssue issue={issue} retry={() => void refresh()} />
      {expired && (
        <p className="workflow-gate">
          This task has expired. New responses and submissions are closed.
        </p>
      )}
      <div className="workflow-grid">
        <div className="workflow-stack">
          <section className="card form-card">
            <h2>Accepted SERV instructions</h2>
            <p>{plan.summary}</p>
            <p>{plan.objective}</p>
            {(
              [
                ["Observation checklist", plan.observationChecklist],
                ["Evidence instructions", plan.evidenceInstructions],
                ["Safety instructions", plan.safetyInstructions],
                ["Uncertainty conditions", plan.uncertaintyConditions],
                ["Questions for dispatcher", plan.questionsForDispatcher],
                ["Limitations", plan.limitations],
              ] as [string, string[]][]
            ).map(
              ([title, items]) =>
                items.length > 0 && (
                  <div key={title}>
                    <h3>{title}</h3>
                    <ul>
                      {items.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ),
            )}
            <h3>Dispatcher evidence requirements</h3>
            <ul>
              {request.evidence_requirements.map((r) => (
                <li key={r}>{evidenceLabels[r as EvidenceRequirement] ?? r}</li>
              ))}
            </ul>
            <p className="field-hint">
              Instructions are not evidence or a road-safety certification.
              Contact your dispatcher if you need clarification.
            </p>
          </section>
          <section className="card form-card">
            <h2>Assignment response</h2>
            {assignment.status === "offered" ? (
              <div className="workflow-actions">
                <button
                  className="button primary"
                  disabled={busy || !data.enabled || expired || Boolean(issue)}
                  onClick={() => void respond("accept")}
                >
                  Accept assignment
                </button>
                <button
                  className="button secondary"
                  disabled={busy || !data.enabled || expired || Boolean(issue)}
                  onClick={() => void respond("decline")}
                >
                  Decline assignment
                </button>
              </div>
            ) : (
              <p>{assignmentLabels[assignment.status]}</p>
            )}
            <p role="status">{message}</p>
            {["accepted", "revision_requested"].includes(assignment.status) && (
              <EvidenceForm
                key={`${assignment.id}-${assignment.submission_round}`}
                assignment={assignment}
                onSaved={() => refresh()}
                disabled={!data.enabled || expired || Boolean(issue)}
              />
            )}
          </section>
          <section className="card form-card">
            <EvidenceSubmissions assignment={assignment} />
            <History assignment={assignment} />
          </section>
        </div>
        <aside className="card form-card workflow-location">
          <h2>Verification location</h2>
          <p>{request.location_description}</p>
          <LocationMap
            value={{ latitude: request.latitude, longitude: request.longitude }}
          />
          <p>
            {request.latitude.toFixed(6)}, {request.longitude.toFixed(6)}
          </p>
          <p>Expires {new Date(request.expiration).toLocaleString()}</p>
        </aside>
      </div>
    </>
  );
}
export function DispatcherAssignment({ requestId }: { requestId: string }) {
  const { data, issue, refresh } = useAssignments(requestId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadedPhoto, setLoadedPhoto] = useState<string | null>(null);
  const now = useNow();
  const assignment = data?.assignments[0];
  const expired = Boolean(assignment && Date.parse(assignment.verification_requests.expiration) <= now);
  const currentEvidence = assignment?.task_evidence.find((item) => item.submission_round === assignment.submission_round && item.submitted_at);
  const photoReady = Boolean(currentEvidence && loadedPhoto === currentEvidence.id);
  const blocked = busy || !data?.enabled || Boolean(issue) || expired;
  async function action(value: unknown) {
    if (blocked) return;
    setBusy(true);
    setMessage("");
    try {
      await sendAction(value);
      const refreshed = await refresh();
      setMessage(refreshed ? "Saved." : "The server saved the action, but the latest assignment status could not load. Refresh before taking another action.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card form-card">
      <h2>Verifier assignment & review</h2>
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => void refresh()}
      >
        Refresh assignment
      </button>
      {issue && !data ? (
        <>
          <p role="alert">{issue}</p>
          <button className="button secondary" onClick={() => void refresh()}>
            Retry
          </button>
        </>
      ) : !data ? (
        <p role="status">Loading assignment…</p>
      ) : (
        <>
          <Gate enabled={data.enabled} reason={data.blockedReason} />
          <RefreshIssue issue={issue} retry={() => void refresh()} />
          {expired && <p className="workflow-gate">This task has expired. New reviews and completion are closed.</p>}
          {!assignment ? (
            <form
              className="workflow-form"
              aria-describedby="assignment-result"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void action({
                  action: "assign",
                  requestId,
                  planId: String(form.get("planId")),
                  verifierId: String(form.get("verifierId")),
                });
              }}
            >
              <p>
                Choose an accepted plan and an approved verifier.
                Video evidence is not supported.
              </p>
              <label htmlFor="assignment-plan">Accepted SERV plan</label>
              <select
                id="assignment-plan"
                name="planId"
                required
                disabled={blocked}
              >
                <option value="">Select accepted plan</option>
                {data.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
              <label htmlFor="assignment-verifier">Approved verifier</label>
              <select
                id="assignment-verifier"
                name="verifierId"
                required
                disabled={blocked}
              >
                <option value="">Select approved verifier</option>
                {data.verifiers.map((v) => (
                  <option key={v.user_id} value={v.user_id}>
                    {v.user_id}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                Verifiers are listed by account ID. Your administrator manages access.
              </p>
              <button
                className="button primary"
                disabled={
                  blocked ||
                  !data.plans.length ||
                  !data.verifiers.length
                }
              >
                Assign task
              </button>
            </form>
          ) : (
            <>
              <div className="workflow-assignee">
                <span>Assigned verifier: {assignment.verifier_id}</span>
                <StatusBadge status={assignment.status} />
              </div>
              <EvidenceSubmissions assignment={assignment} onPhotoState={(id, loaded) => {
                if (id === currentEvidence?.id) setLoadedPhoto(loaded ? id : null);
              }} />
              {["submitted", "approved"].includes(assignment.status) && (
                <form
                  className="workflow-form"
                  aria-describedby="assignment-result"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    const submitter = (e.nativeEvent as SubmitEvent).submitter;
                    const selectedAction =
                      submitter instanceof HTMLButtonElement
                        ? submitter.value
                        : "";
                    if (blocked) return;
                    if (["approve", "complete"].includes(selectedAction) && !photoReady) {
                      setMessage("Load and review the current photograph before approving or completing this task.");
                      return;
                    }
                    const evidence = assignment.task_evidence.find(
                      (item) =>
                        item.submission_round === assignment.submission_round &&
                        item.submitted_at,
                    );
                    const selection = assignmentActionSchema.safeParse({
                      id: assignment.id,
                      action: selectedAction,
                      evidenceId: evidence?.id,
                      note: String(form.get("note")),
                    });
                    if (!selection.success) {
                      setMessage(
                        selection.error.issues[0]?.message ??
                          "Check the selected submission and review note.",
                      );
                      return;
                    }
                    void action(selection.data);
                  }}
                >
                  <label htmlFor="review-note">
                    Review note (required for revision)
                  </label>
                  <textarea
                    id="review-note"
                    name="note"
                    aria-describedby="assignment-result"
                    maxLength={2000}
                    rows={3}
                    disabled={blocked}
                  />
                  {!photoReady && <p role="status">Load and review the current photograph and observation before approving or completing this task.</p>}
                  <div className="workflow-actions">
                    {assignment.status === "submitted" ? (
                      <>
                        <button
                          name="action"
                          value="approve"
                          className="button primary"
                          disabled={blocked || !photoReady}
                        >
                          Approve evidence
                        </button>
                        <button
                          name="action"
                          value="revise"
                          className="button secondary"
                          disabled={blocked}
                        >
                          Request revision
                        </button>
                      </>
                    ) : (
                      <button
                        className="button primary"
                        name="action"
                        value="complete"
                        disabled={blocked || !photoReady}
                      >
                        Mark reviewed task complete
                      </button>
                    )}
                  </div>
                </form>
              )}
              <History assignment={assignment} />
            </>
          )}
          <p className="field-hint">
            Approval records your review, not a guarantee of road safety.
            Payments are unavailable.
          </p>
        </>
      )}
      <p id="assignment-result" role="status">
        {message}
      </p>
    </section>
  );
}
