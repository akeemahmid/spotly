import { check, completion } from "./security-test-db.mjs";

const permittedMimes = ["image/jpeg", "image/png", "image/webp"];
const knownMimes = new Set([...permittedMimes, "text/plain", "image/*", "*/*", "image/svg+xml", "application/octet-stream"]);
export const STORAGE_BYTE_LIMIT = 8388608;
export function httpStatus(value) {
  return (typeof value === "number" || typeof value === "string" && /^[1-5][0-9]{2}$/.test(value)) &&
    Number.isInteger(Number(value)) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : undefined;
}
const reasons = new Map([
  ["InvalidMimeType", "MIME_LIMIT"], ["invalid_mime_type", "MIME_LIMIT"],
  ["EntityTooLarge", "SIZE_LIMIT"], ["Payload too large", "SIZE_LIMIT"],
  ["AccessDenied", "AUTHORIZATION_DENIED"], ["Unauthorized", "AUTHORIZATION_DENIED"],
  ["InvalidJWT", "AUTHORIZATION_DENIED"], ["KeyAlreadyExists", "OBJECT_CONFLICT"],
  ["ResourceAlreadyExists", "OBJECT_CONFLICT"], ["NoSuchBucket", "BUCKET_NOT_FOUND"],
  ["InternalError", "SERVER_ERROR"],
]);
export function storageLimitCategory(result, status) {
  const error = result?.error;
  if (!error) return "UNEXPECTED_SUCCESS";
  if ([401, 403].includes(status)) return "AUTHORIZATION_DENIED";
  if (status >= 500) return "SERVER_ERROR";
  if (status === 429) return "RATE_LIMITED";
  if (status === 409) return "OBJECT_CONFLICT";
  // SDK versions expose service codes differently. Only fixed known values are
  // classified; none of these raw fields or messages ever leave this function.
  for (const value of [error.code, error.error, error.statusCode]) if (reasons.has(value)) return reasons.get(value);
  if (error.code) return "UNKNOWN_STORAGE_ERROR";
  if (error.message === "invalid_mime_type" || /^mime type text\/plain(?:;charset=utf-8)? is not (?:supported|allowed)\.?$/i.test(error.message ?? "")) return "MIME_LIMIT";
  if (/^(?:Payload too large|Request Entity Too Large|The (?:object|file|request|payload) exceeded (?:the maximum allowed size|[0-9]+(?: bytes)?))\.?$/i.test(error.message ?? "")) return "SIZE_LIMIT";
  return status === undefined ? "NETWORK_OR_UNKNOWN_ERROR" : "UNKNOWN_STORAGE_ERROR";
}
export function assertStorageLimit(kind, result, observedStatus, report = console.log) {
  check(kind === "mime" || kind === "size");
  // The fetch Response is the HTTP authority. A symbolic SDK statusCode is a
  // service reason, not an HTTP status. Never replace a known status with it.
  const status = httpStatus(observedStatus) ?? httpStatus(result?.error?.status);
  const serviceStatus = httpStatus(result?.error?.statusCode);
  const category = storageLimitCategory(result, status);
  const expectedCategory = kind === "mime" ? "MIME_LIMIT" : "SIZE_LIMIT";
  const allowedStatuses = kind === "mime" ? [400, 415] : [400, 413];
  const pass = Boolean(result?.error) && allowedStatuses.includes(status) && category === expectedCategory;
  const expected = kind === "mime" ? "HTTP 400/415 with a specific MIME rejection" : "HTTP 400/413 with a specific size rejection";
  const probe = kind === "mime" ? "declared_mime=text/plain; bytes=25" : `declared_mime=image/png; bytes=${STORAGE_BYTE_LIMIT + 1}`;
  report(`${pass ? "PASS" : "FAIL"} HTTP ${kind}-restriction: expected=${expected}; actual_http=${status ?? "UNAVAILABLE"}; service_status=${serviceStatus ?? "UNAVAILABLE"}; category=${category}; ${probe}`);
  check(pass); // No success, generic auth failure, 5xx or network error is a pass.
}

export async function inspectStorageBucket(open, report = console.log, onStage = () => {}) {
  onStage("bucket.connect");
  const client = await open();
  try {
    onStage("bucket.begin-read-only");
    completion(await client.query("begin read only"), "BEGIN");
    onStage("bucket.select-configuration");
    const result = await client.query(`select jsonb_build_object('public',public,'file_size_limit',file_size_limit,
      'allowed_mime_types',allowed_mime_types) as storage_bucket_diagnostic
      from storage.buckets where id='verification-evidence'`);
    onStage("bucket.validate-result");
    completion(result, "SELECT");
    const config = result.rows?.length === 1 ? result.rows[0].storage_bucket_diagnostic : undefined;
    const size = Number.isSafeInteger(config?.file_size_limit) && config.file_size_limit >= 0 ? config.file_size_limit : "UNAVAILABLE";
    const types = config?.allowed_mime_types;
    const mimeSummary = Array.isArray(types) ? types.slice(0, 10).map(mime => knownMimes.has(mime) ? mime : "OTHER").join(",") : "UNRESTRICTED_OR_UNAVAILABLE";
    const privateBucket = config?.public === false ? "true" : config?.public === true ? "false" : "UNAVAILABLE";
    const valid = config?.public === false && size === STORAGE_BYTE_LIMIT && Array.isArray(types) && types.length === 3 && permittedMimes.every(mime => types.includes(mime));
    report(`${valid ? "PASS" : "FAIL"} read-only bucket configuration: verification-evidence; private=${privateBucket}; file_size_limit=${size}; allowed_mimes=${mimeSummary}; mime_count=${Array.isArray(types) ? types.length : "UNAVAILABLE"}; expected=private,8388608,image/jpeg+image/png+image/webp`);
    onStage("bucket.validate-configuration");
    check(valid);
    onStage("bucket.rollback");
    completion(await client.query("rollback"), "ROLLBACK");
  } finally { await client.query("rollback").catch(() => {}); await client.end().catch(() => {}); }
}
