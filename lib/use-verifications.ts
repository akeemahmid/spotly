"use client";
import { useSyncExternalStore } from "react";
import { persistedGeneratedPlanSchema } from "./validation/plan";
import type { Verification, VerificationInput } from "../types/verification";
interface Snapshot { tasks: Verification[]; ready: boolean; issue: string | null; }
const initial: Snapshot = { tasks: [], ready: false, issue: null };
let snapshot = initial;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
function publish(next: Snapshot) { snapshot = next; listeners.forEach(fn => fn()); }
export async function api(body?: unknown) {
 const response = await fetch("/api/verifications", { method: body ? "POST" : "GET", cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
 const data = await response.json();
 if (!response.ok) throw new Error(data.error || "The database request failed. Retry without closing your form.");
 return data;
}
function refresh() {
 if (pending) return pending;
 pending = (async () => {
  try { const data = await api(); publish({ tasks: data.tasks, ready: true, issue: null }); }
  catch (error) { publish({ tasks: [], ready: true, issue: error instanceof Error ? error.message : "Requests could not load." }); }
  finally { pending = null; }
 })();
 return pending;
}
function subscribe(listener: () => void) {
 listeners.add(listener);
 if (listeners.size === 1) { window.addEventListener("focus", refresh); void refresh(); }
 return () => { listeners.delete(listener); if (!listeners.size) { window.removeEventListener("focus", refresh); snapshot = initial; } };
}
export async function createVerification(input: VerificationInput) {
 const { id } = await api({ action: "create", input });
 await refresh();
 return { id };
}
export function useVerifications() { return { ...useSyncExternalStore(subscribe, () => snapshot, () => initial), retry: refresh }; }
export const verificationStore = { subscribe, getSnapshot: () => snapshot, getServerSnapshot: () => initial, refresh, create: createVerification };
export async function acceptVerificationPlan(id: string, plan: unknown) { const selection = persistedGeneratedPlanSchema.parse(plan); await api({ action: "accept", id, planId: selection.planId }); await refresh(); }
