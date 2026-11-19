"use client";
import { useEffect, useRef, useState } from "react";
import type { DraftVerification } from "@/types/verification";
import { persistedGeneratedPlanSchema, type PersistedGeneratedPlan } from "@/lib/validation/plan";
import { isPlanStale, pendingPlanForReview, planRequest, requestFingerprint } from "@/lib/plan-request";
import { acceptVerificationPlan, verificationStore } from "@/lib/use-verifications";
import { formatTimestamp } from "@/lib/verification-selectors";
const sections = {
  observationChecklist: "Observation checklist", evidenceInstructions: "Evidence instructions",
  safetyInstructions: "Safety instructions", uncertaintyConditions: "Uncertainty conditions",
  questionsForDispatcher: "Questions for dispatcher", limitations: "Limitations",
} as const;
export function ServPlan({ task, storageIssue }: { task: DraftVerification; storageIssue: string | null }) {
  const [candidate, setCandidate] = useState<PersistedGeneratedPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const fingerprint = requestFingerprint(planRequest(task));
  const stale = isPlanStale(task);
  const accepted = !stale ? task.acceptedPlan : undefined;
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const update = () => setClock(Date.now());
    const timer = window.setInterval(update, 1000);
    const initial = window.setTimeout(update, 0);
    return () => { window.clearInterval(timer); window.clearTimeout(initial); };
  }, []);
  const expired = clock > 0 && Date.parse(task.expiresAt) <= clock;
  const currentCandidate = pendingPlanForReview(task, candidate, clock);
  const displayed = currentCandidate ?? accepted;
  const local = process.env.NODE_ENV === "development";
  async function generate() {
    setLoading(true); setError(null); setCandidate(null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/serv/plan-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(planRequest(task)), signal: abort.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "SERV generation failed. Please retry.");
      const result = persistedGeneratedPlanSchema.parse(data);
      const latest = verificationStore.getSnapshot().tasks.find((item) => item.id === task.id);
      if (!latest || latest.source === "sample" || result.fingerprint !== requestFingerprint(planRequest(latest)) || result.fingerprint !== fingerprint) throw new Error("The request changed during generation. Generate a fresh plan.");
      if (!abort.signal.aborted) setCandidate(result);
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error && e.name !== "ZodError" ? e.message : "SERV returned an invalid plan. Please retry."); }
    finally { if (!abort.signal.aborted) setLoading(false); }
  }
  async function accept() {
    if (!currentCandidate) return;
    setSaving(true); setError(null);
    try { await acceptVerificationPlan(task.id, currentCandidate); setCandidate(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Acceptance could not be saved. Retry acceptance."); }
    finally { setSaving(false); }
  }
  return <section className="card form-card serv-plan" aria-labelledby="serv-plan-title" aria-busy={loading || saving}>
    <h2 id="serv-plan-title">SERV field plan</h2>
    <p>Instructions for the field check, not evidence. Accepting a plan does not assign work or change your budget.</p>
    <p role="status"><strong>{loading ? "Generating…" : error ? "Generation or save failed" : currentCandidate ? "Plan ready for review" : accepted ? "Plan accepted" : "Not generated"}</strong></p>
    {(stale || (candidate && candidate.fingerprint !== fingerprint)) && <p role="alert">The request changed. The previous plan is stale and requires regeneration.</p>}
    {task.hasUntrustedPlan && <p role="status">A historical or imported plan is untrusted and cannot qualify for assignment. Generate and accept a new SERV plan.</p>}
    {!local && <p className="field-hint">New plan generation is unavailable here.</p>}
    {expired && <p className="field-hint">This draft has expired. Create a new request before generating or accepting a plan.</p>}
    {error && <p role="alert">{error}</p>}
    {local && <button type="button" className="button primary" onClick={generate} disabled={loading || saving || expired || !!storageIssue}>{loading ? "Generating…" : error ? "Retry generation with SERV" : "Generate plan with SERV"}</button>}
    {displayed && <div className="serv-plan-content">
      <p className="eyebrow">{currentCandidate ? "SERV-GENERATED · REVIEW REQUIRED" : "SERV-GENERATED · ACCEPTED PLAN"}</p>
      <h3>{displayed.plan.summary}</h3><p>{displayed.plan.objective}</p>
      {Object.entries(sections).map(([key, label]) => <div key={key}><h3>{label}</h3>{displayed.plan[key as keyof typeof sections].length ? <ul>{displayed.plan[key as keyof typeof sections].map((text, index) => <li key={index}>{text}</li>)}</ul> : <p>No questions returned.</p>}</div>)}
      <details className="plan-details"><summary>Plan details</summary><p className="field-hint">Model: {displayed.model} · Generated {formatTimestamp(displayed.generatedAt)} · Plan v{displayed.version}{displayed.providerRequestId ? ` · Provider ID: ${displayed.providerRequestId}` : ""}</p>
      {currentCandidate && <p className="field-hint">Saved plan ID: {currentCandidate.planId}. Reloading keeps this plan and does not call SERV.</p>}</details>
      {accepted && !currentCandidate && <p>Accepted {formatTimestamp(accepted.acceptedAt)}. Saved to your workspace.</p>}
      {currentCandidate && <><p>Review the instructions and resolve any questions before accepting. Acceptance does not authorize spending.</p><button type="button" className="button primary" onClick={accept} disabled={saving || loading || expired || !!storageIssue}>{saving ? "Saving…" : "Accept reviewed plan"}</button></>}
    </div>}
  </section>;
}
