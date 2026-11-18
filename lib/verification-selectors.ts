import type { Verification } from "../types/verification";
export function filterVerifications(
  tasks: Verification[],
  status: string,
  query: string,
) {
  const search = query.trim().toLocaleLowerCase();
  return tasks.filter(
    (task) =>
      (status === "All requests" || task.status === status) &&
      `${task.title} ${task.question} ${task.locationDescription} ${task.id}`
        .toLocaleLowerCase()
        .includes(search),
  );
}
export function verificationStats(tasks: Verification[]) {
  return {
    active: tasks.filter(
      (task) => task.status === "In progress" || task.status === "Planning",
    ).length,
    awaitingReview: tasks.filter((task) => task.status === "Awaiting review")
      .length,
    completed: tasks.filter((task) => task.status === "Completed").length,
    sampleSpending: tasks
      .filter((task) => task.source === "sample" && task.status === "Completed")
      .reduce((sum, task) => sum + task.budget, 0),
    drafts: tasks.filter((task) => task.status === "draft").length,
  };
}
export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
export function requestedLabel(task: Verification) {
  return task.source === "sample"
    ? task.requested
    : formatTimestamp(task.createdAt);
}
