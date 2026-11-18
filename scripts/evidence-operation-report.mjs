import { httpStatus } from "./storage-limit-diagnostics.mjs";
import { safeDiagnostic } from "./run-security-authorization.mjs";
import { transportDetails } from "./storage-transport.mjs";

export const evidenceOperations = [
  "C uploads reserved PNG", "exact uploaded object confirmed", "C downloads original bytes",
  "A downloads original bytes", "B download denied", "anonymous download denied",
  "overwrite denied", "deletion denied", "evidence finalization and retry", "dispatcher review and completion",
];
export function safeEvidenceDiagnostic(error, observedStatus) {
  const status = httpStatus(observedStatus) ?? httpStatus(error?.status);
  const sql = safeDiagnostic(error);
  const state = /^SQLSTATE ([A-Z0-9]{5}); (\w+)$/.exec(sql);
  let category = state?.[2];
  if (!category) {
    if (["NoSuchKey", "not_found"].includes(error?.code) || error?.message === "Object not found") category = "OBJECT_NOT_FOUND_OR_HIDDEN";
    else if ([401, 403].includes(status)) category = "AUTHORIZATION_DENIED";
    else if (status >= 500) category = "SERVER_ERROR";
    else if (status === 409) category = "OBJECT_CONFLICT";
    else if (error?.message === "BYTE_INTEGRITY_MISMATCH") category = "BYTE_INTEGRITY_MISMATCH";
    else if (error?.message === "OBJECT_BINDING_MISMATCH") category = "OBJECT_BINDING_MISMATCH";
    else if (error?.message === "UNEXPECTED_ALLOW") category = "UNEXPECTED_ALLOW";
    else if (!error) category = "SUCCESS";
    else if (error?.name === "TypeError") category = "CLIENT_OR_RESPONSE_ERROR";
    else category = status ? "REQUEST_OR_ASSERTION_FAILED" : "NETWORK_OR_ASSERTION_FAILED";
  }
  const transport = transportDetails(error);
  return `actual_http=${status ?? "UNAVAILABLE"}; sqlstate=${state?.[1] ?? "UNAVAILABLE"}; category=${category}; error_name=${transport.error_name}; known_code=${transport.known_code}; timeout=${transport.timeout}`;
}
export function operationReport(report, status) {
  const states = evidenceOperations.map(() => "NOT RUN");
  return {
    async run(number, action) {
      const index = number - 1;
      if (!evidenceOperations[index] || states[index] !== "NOT RUN") throw new Error("INVALID_OPERATION_SEQUENCE");
      status.reset();
      try {
        const value = await action();
        states[index] = "PASS";
        report(`PASS evidence ${number}: ${evidenceOperations[index]}; operation=${safeOperation(status.operation?.())}; ${safeEvidenceDiagnostic(status.error(), status.http())}`);
        return value;
      } catch (error) {
        states[index] = "FAIL";
        report(`FAIL evidence ${number}: ${evidenceOperations[index]}; operation=${safeOperation(status.operation?.())}; ${safeEvidenceDiagnostic(error, status.http())}`);
        throw error;
      }
    },
    summary() {
      states.forEach((state, index) => report(`${state} evidence summary ${index + 1}: ${evidenceOperations[index]}`));
    },
  };
}
const operationNames = new Set(["storage.upload", "storage.download", "storage.upload-upsert", "storage.update", "storage.remove",
  "catalog.confirm-exact-object", "rpc.submit_task_evidence", "rpc.transition.approve", "rpc.transition.complete", "rpc.transition.accept", "assignment.read-state"]);
const safeOperation = value => operationNames.has(value) ? value : "LOCAL_CHECK_OR_UNKNOWN";
