import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { checkServerIdentity } from "node:tls";

// Shared by the owner-only provisioning and read-only diagnostic scripts.
// Never import this into application routes or expose it through a public RPC.
const SAFE_CATEGORIES = new Set([
  "KEY_FORMAT_INVALID",
  "DB_PASSWORD_MISSING",
  "LINK_METADATA_INVALID",
  "TLS_FAILURE",
  "TLS_CA_FILE_INVALID",
  "AUTH_FAILURE",
  "NETWORK_TIMEOUT",
  "NETWORK_FAILURE",
  "CONNECTION_FAILURE",
  "SESSION_LOGGING_REJECTED",
  "SQL_PERMISSION_DENIED",
  "SCHEMA_NOT_READY",
  "SQL_FAILURE",
  "CONFIG_INVALID",
  "RESULT_UNCONFIRMED",
  "PGCRYPTO_NOT_READY",
  "RPC_NOT_READY",
  "PRIVATE_TABLE_NOT_READY",
  "KEY_MISSING",
  "KEY_MISMATCH",
]);
const SAFE_STAGES = new Set([
  "CONFIG",
  "CONNECT",
  "BEGIN",
  "EXISTING_KEY_CHECK",
  "INSERT_PERMISSION_CHECK",
  "SESSION_LOGGING",
  "INSERT",
  "COMMIT",
  "PGCRYPTO_CHECK",
  "RPC_CHECK",
  "PRIVATE_TABLE_CHECK",
  "KEY_COMPARE",
  "ROLLBACK",
]);

export class SigningDatabaseError extends Error {
  constructor(category, stage, reason) {
    // Never retain a raw cause, message, detail, connection config, or SQL values.
    super(category);
    this.name = "SigningDatabaseError";
    this.category = category;
    this.stage = stage;
    if (reason) this.reason = reason;
  }
}
export function safeSigningFailure(error) {
  return error instanceof SigningDatabaseError &&
    SAFE_CATEGORIES.has(error.category) &&
    SAFE_STAGES.has(error.stage)
    ? `${error.category} stage=${error.stage}${SAFE_TLS_REASONS.has(error.reason) ? ` reason=${error.reason}` : ""}`
    : "RESULT_UNCONFIRMED stage=CONFIG";
}
const SAFE_TLS_REASONS = new Set([
  "CA_UNTRUSTED",
  "HOSTNAME_MISMATCH",
  "CERT_EXPIRED",
  "CERT_NOT_YET_VALID",
  "HANDSHAKE_FAILED",
]);
export function tlsReason(error) {
  const codes = [
    error,
    error?.cause,
    ...(Array.isArray(error?.errors) ? error.errors : []),
  ]
    .filter(Boolean)
    .map((item) => item.code);
  if (codes.includes("ERR_TLS_CERT_ALTNAME_INVALID"))
    return "HOSTNAME_MISMATCH";
  if (codes.includes("CERT_HAS_EXPIRED")) return "CERT_EXPIRED";
  if (codes.includes("CERT_NOT_YET_VALID")) return "CERT_NOT_YET_VALID";
  if (
    codes.some((code) =>
      [
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "UNABLE_TO_GET_ISSUER_CERT",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "CERT_UNTRUSTED",
      ].includes(code),
    )
  )
    return "CA_UNTRUSTED";
  return "HANDSHAKE_FAILED";
}
export function loadTrustedCA(path, readFile = readFileSync) {
  if (!path) return undefined;
  try {
    // Accept PEM CA bundles or a single DER certificate. Never log file contents.
    const data = readFile(path);
    const text = data.toString();
    const blocks = text.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    );
    if (
      blocks &&
      text
        .replace(
          /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
          "",
        )
        .trim()
    )
      throw new Error();
    const certificates = (blocks ?? [data]).map(
      (value) => new X509Certificate(value),
    );
    if (certificates.some((cert) => !cert.ca)) throw new Error();
    // Explicit CA scope: do not silently fall back to other trust roots on failure.
    return certificates.map((cert) => cert.toString());
  } catch {
    throw new SigningDatabaseError("TLS_CA_FILE_INVALID", "CONFIG");
  }
}
export function classifyFailure(error, stage) {
  // Examine standard codes and a few known driver messages internally only.
  // Some node-postgres connect/SCRAM timeouts have no code; none of this text is emitted.
  const nested = [
    error,
    error?.cause,
    ...(Array.isArray(error?.errors) ? error.errors : []),
  ].filter(Boolean);
  const codes = nested.map((value) =>
    typeof value.code === "string" ? value.code : "",
  );
  const messages = nested.map((value) =>
    typeof value.message === "string" ? value.message : "",
  );
  if (
    codes.some((code) =>
      /^(?:ERR_TLS_|ERR_SSL_|ERR_OSSL_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT)/.test(
        code,
      ),
    ) ||
    messages.some((message) =>
      /^(?:The server does not support SSL connections|There was an error establishing an SSL connection)/.test(
        message,
      ),
    )
  )
    return "TLS_FAILURE";
  if (
    codes.some((code) => code === "28P01" || code === "28000") ||
    (stage === "CONNECT" &&
      messages.some((message) =>
        /^(?:SASL:|password authentication failed|Tenant or user not found|Authentication error)/i.test(
          message,
        ),
      ))
  )
    return "AUTH_FAILURE";
  if (
    codes.includes("ETIMEDOUT") ||
    messages.some((message) =>
      /^(?:Connection terminated due to connection timeout|timeout expired|Query read timeout)$/.test(
        message,
      ),
    )
  )
    return "NETWORK_TIMEOUT";
  if (
    codes.some((code) =>
      /^(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EPIPE|08\w{3})$/.test(
        code,
      ),
    )
  )
    return "NETWORK_FAILURE";
  if (stage === "SESSION_LOGGING") return "SESSION_LOGGING_REJECTED";
  if (codes.includes("42501")) return "SQL_PERMISSION_DENIED";
  if (
    codes.some(
      (code) => code === "42P01" || code === "3F000" || code === "42703",
    )
  )
    return "SCHEMA_NOT_READY";
  return stage === "CONNECT" ? "CONNECTION_FAILURE" : "SQL_FAILURE";
}

export function signingDatabaseConfig({
  env = process.env,
  readFile = readFileSync,
  applicationName = "spotly-signing-check",
} = {}) {
  if (
    typeof env.SUPABASE_DB_PASSWORD !== "string" ||
    !env.SUPABASE_DB_PASSWORD
  )
    throw new SigningDatabaseError("DB_PASSWORD_MISSING", "CONFIG");

  let ref, linked;
  try {
    ref = readFile(
      new URL("../supabase/.temp/project-ref", import.meta.url),
      "utf8",
    ).trim();
    linked = new URL(
      readFile(
        new URL("../supabase/.temp/pooler-url", import.meta.url),
        "utf8",
      ).trim(),
    );
    if (
      !/^[a-z0-9]+$/.test(ref) ||
      linked.protocol !== "postgresql:" ||
      !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(linked.hostname) ||
      linked.port !== "5432" ||
      linked.pathname !== "/postgres" ||
      decodeURIComponent(linked.username) !== `postgres.${ref}` ||
      new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== `${ref}.supabase.co`
    )
      throw new Error();
  } catch {
    throw new SigningDatabaseError("LINK_METADATA_INVALID", "CONFIG");
  }

  const ca = loadTrustedCA(env.SUPABASE_DB_CA_FILE, readFile);
  return {
    host: linked.hostname,
    port: Number(linked.port),
    database: "postgres",
    user: decodeURIComponent(linked.username),
    password: env.SUPABASE_DB_PASSWORD,
    // Use explicit owner credentials, independent of CLI/API authentication.
    // Explicit fields prevent URI sslmode options from replacing this TLS policy.
    ssl: {
      rejectUnauthorized: true,
      servername: linked.hostname,
      checkServerIdentity,
      ...(ca ? { ca } : {}),
    },
    sslnegotiation: "postgres",
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
    statement_timeout: 10000,
    application_name: applicationName,
  };
}
