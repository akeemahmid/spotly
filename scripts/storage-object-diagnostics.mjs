const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const uuidPattern = new RegExp(`^${uuid}$`);
// Only shapes needed for this investigation may be displayed. Never echo an
// arbitrary object name/metadata value that could contain credentials or tokens.
const displayPath = new RegExp(`^(?:${uuid}/)?(?:\\.emptyFolderPlaceholder|${uuid}(?:\\.(?:png|jpg|jpeg|webp))?)$`);
const mimes = new Set(["image/png", "image/jpeg", "image/webp", "text/plain", "application/octet-stream", "application/x-empty", "inode/directory"]);
const safeId = value => value == null ? "NULL" : uuidPattern.test(value) ? value : "WITHHELD";
const safePath = value => typeof value === "string" && displayPath.test(value) ? value : "WITHHELD_UNRECOGNIZED_NAME";
const safeMime = value => value == null ? "NULL" : mimes.has(value) ? value : "WITHHELD_UNRECOGNIZED_MIME";
function safeSize(value) {
  if (value == null) return "NULL";
  if (!/^(0|[1-9][0-9]{0,15})$/.test(String(value))) return "WITHHELD_INVALID_SIZE";
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : "WITHHELD_INVALID_SIZE";
}
const safeTime = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) ? value : "UNAVAILABLE";

// Diagnostic hypotheses only. These do NOT participate in deletion permission.
export function storageObjectDetails(row) {
  const size = safeSize(row.catalog_size), name = safePath(row.name);
  const marker = typeof row.name === "string" && /(?:^|\/)\.emptyFolderPlaceholder$/.test(row.name);
  const kind = marker ? "FOLDER_PLACEHOLDER_CANDIDATE" : size === 8388609 ? "OVERSIZED_UPLOAD_ARTIFACT_CANDIDATE" :
    row.reservation_path === true ? "RESERVED_EVIDENCE_PATH" : "OTHER_OR_UNRESOLVED";
  return { kind, catalog_id: safeId(row.catalog_id), actual_name: name,
    owner_id: row.catalog_owner === "" ? "EMPTY" : safeId(row.catalog_owner),
    legacy_owner: row.catalog_legacy_owner === "" ? "EMPTY" : safeId(row.catalog_legacy_owner),
    metadata_size: size, metadata_mime: safeMime(row.catalog_mime),
    metadata_content_length: safeSize(row.catalog_content_length), metadata_content_type: safeMime(row.catalog_content_type),
    created_at: safeTime(row.catalog_created_at), updated_at: safeTime(row.catalog_updated_at),
    assignment_id: row.synthetic_chain === true ? safeId(row.assignment_id) : "UNVERIFIED",
    evidence_id: row.synthetic_chain === true ? safeId(row.evidence_id) : "UNVERIFIED",
    expected_reservation_path: row.synthetic_chain === true ? safePath(row.expected_path) : "UNVERIFIED",
    reserved_size: row.synthetic_chain === true ? safeSize(row.reserved_size) : "UNVERIFIED",
    reserved_mime: row.synthetic_chain === true ? safeMime(row.reserved_mime) : "UNVERIFIED",
    reservation_created_at: row.synthetic_chain === true ? safeTime(row.reservation_created_at) : "UNVERIFIED",
    request_expires_at: row.synthetic_chain === true ? safeTime(row.request_expires_at) : "UNVERIFIED",
  };
}
export function reportStorageObjectDetails(row, index, report) {
  report(`OBJECT ${index + 1} catalog details (read-only; diagnostic classification is NOT deletion approval): ${JSON.stringify(storageObjectDetails(row))}`);
  report("INFO metadata is limited to size/MIME; arbitrary metadata, URLs, tokens and unsupported names are withheld. Review catalog fields privately; do not post raw metadata or browser credentials.");
}
