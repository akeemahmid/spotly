"use client";
import { useSyncExternalStore } from "react";
import { persistedGeneratedPlanSchema } from "./validation/plan";
import type { Verification, VerificationInput } from "../types/verification";
import { assignmentCountsSchema, type AssignmentCounts } from "./verifier/models";
interface Snapshot { tasks: Verification[]; activity: AssignmentCounts | null; ready: boolean; issue: string | null; }
const initial: Snapshot = { tasks: [], activity: null, ready: false, issue: null };
let snapshot = initial;
let pending: Promise<void> | null = null;
let controller: AbortController | null = null;
let generation = 0;
const listeners = new Set<() => void>();
function publish(next: Snapshot) { snapshot = next; listeners.forEach(fn => fn()); }
export async function api(body?: unknown, signal?: AbortSignal) {
 const response = await fetch("/api/verifications", { method: body ? "POST" : "GET", cache: "no-store", signal, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
 const data = await response.json();
 if (!response.ok) throw new Error(data.error || "The database request failed. Retry without closing your form.");
 return data;
}
function refresh() {
 if (pending) return pending;
 const current = generation;
 controller = new AbortController();
 const signal = controller.signal;
 pending = (async () => {
  try { const data = await api(undefined, signal); const activity = assignmentCountsSchema.safeParse(data.activity); if (current === generation) publish({ tasks: data.tasks, activity: activity.success ? activity.data : null, ready: true, issue: null }); }
  catch (error) { if (current === generation) publish({ tasks: [], activity: null, ready: true, issue: error instanceof Error ? error.message : "Requests could not load." }); }
  finally { if (current === generation) { pending = null; controller = null; } }
 })();
 return pending;
}
function invalidateRefresh() {
 generation++;
 controller?.abort();
 controller = null;
 pending = null;
}
function subscribe(listener: () => void) {
 listeners.add(listener);
 if (listeners.size === 1) { window.addEventListener("focus", refresh); void refresh(); }
 return () => { listeners.delete(listener); if (!listeners.size) { window.removeEventListener("focus", refresh); invalidateRefresh(); snapshot = initial; } };
}
export async function createVerification(input: VerificationInput) {
 const { id } = await api({ action: "create", input });
 invalidateRefresh();
 await refresh();
 return { id };
}
export function useVerifications() { return { ...useSyncExternalStore(subscribe, () => snapshot, () => initial), retry: refresh }; }
export const verificationStore = { subscribe, getSnapshot: () => snapshot, getServerSnapshot: () => initial, refresh, create: createVerification };
export async function acceptVerificationPlan(id: string, plan: unknown) { const selection = persistedGeneratedPlanSchema.parse(plan); await api({ action: "accept", id, planId: selection.planId }); invalidateRefresh(); await refresh(); }
