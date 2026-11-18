import { generatedPlanSchema } from "./validation/plan";
import { planRequest, requestFingerprint } from "./plan-request";
import type {
  DraftVerification,
  VerificationInput,
} from "../types/verification";
import {
  storedDraftSchema,
  validateNewVerification,
} from "./validation/verification";

export const TASK_STORAGE_KEY = "spotly.verifications.v1";
export interface TaskStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface StoredTasks {
  tasks: DraftVerification[];
  issue: string | null;
}
const unreadable =
  "Some saved drafts could not be read. Existing data has been left untouched; creation is paused to avoid overwriting it. Back up or repair this browser’s Spotly storage, then retry.";

export function readStoredTasks(storage: TaskStorage): StoredTasks {
  try {
    const raw = storage.getItem(TASK_STORAGE_KEY);
    if (raw === null) return { tasks: [], issue: null };
    const envelope: unknown = JSON.parse(raw);
    if (
      !envelope ||
      typeof envelope !== "object" ||
      !("version" in envelope) ||
      envelope.version !== 1 ||
      !("tasks" in envelope) ||
      !Array.isArray(envelope.tasks)
    )
      return { tasks: [], issue: unreadable };
    const tasks: DraftVerification[] = [];
    const ids = new Set<string>();
    let invalid = false;
    for (const item of envelope.tasks) {
      const result = storedDraftSchema.safeParse(item);
      if (!result.success || ids.has(result.data.id)) {
        invalid = true;
        continue;
      }
      ids.add(result.data.id);
      tasks.push(result.data);
    }
    return { tasks, issue: invalid ? unreadable : null };
  } catch {
    return {
      tasks: [],
      issue:
        "Local drafts are unavailable or unreadable in this browser. Your saved data has not been changed. Check browser storage access, back up or repair the Spotly storage entry if needed, then retry.",
    };
  }
}

export function createStoredTask(
  storage: TaskStorage,
  input: VerificationInput,
  now = Date.now(),
  uuid: () => string = () => crypto.randomUUID(),
): DraftVerification {
  const result = validateNewVerification(input, now);
  if (!result.success)
    throw new Error(
      result.error.issues[0]?.message ?? "Please review the request.",
    );
  const existing = readStoredTasks(storage);
  if (existing.issue) throw new Error(existing.issue);
  const ids = new Set(existing.tasks.map((task) => task.id));
  let id = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    id = `SP-${uuid()}`;
    if (!ids.has(id)) break;
    id = "";
  }
  if (!id)
    throw new Error("Unable to generate a unique task ID. Please retry.");
  const task = storedDraftSchema.parse({
    ...result.data,
    id,
    source: "local",
    status: "draft",
    createdAt: new Date(now).toISOString(),
  });
  try {
    storage.setItem(
      TASK_STORAGE_KEY,
      JSON.stringify({ version: 1, tasks: [task, ...existing.tasks] }),
    );
  } catch {
    throw new Error(
      "This request was not saved. Browser storage may be full or blocked. Your form is still available; enable storage or free space, then retry.",
    );
  }
  return task;
}

export function acceptStoredPlan(storage: TaskStorage, id: string, value: unknown, now = Date.now()): DraftVerification {
  const plan = generatedPlanSchema.parse(value);
  const existing = readStoredTasks(storage);
  if (existing.issue) throw new Error(existing.issue);
  const task = existing.tasks.find((item) => item.id === id);
  if (!task) throw new Error("The original draft is no longer available.");
  if (Date.parse(task.expiresAt) <= now) throw new Error("This draft has expired; the plan cannot be accepted.");
  if (plan.fingerprint !== requestFingerprint(planRequest(task))) throw new Error("The request changed. Generate a fresh plan before accepting.");
  const updated = storedDraftSchema.parse({ ...task, acceptedPlan: { ...plan, acceptedAt: new Date(now).toISOString() } });
  try { storage.setItem(TASK_STORAGE_KEY, JSON.stringify({ version: 1, tasks: existing.tasks.map((item) => item.id === id ? updated : item) })); }
  catch { throw new Error("Plan acceptance was not saved. Enable browser storage or free space, then retry. The plan remains available for review."); }
  return updated;
}
