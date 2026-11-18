/** Recover the actual authority without trusting forwarded headers or arbitrary Host overrides. */
export function requestOrigin(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    if (/[\s/@?#\\]/.test(host)) return null;
    const authority = new URL(`${url.protocol}//${host}`);
    const normalizedLoopback = url.hostname === "localhost"
      && ["127.0.0.1", "[::1]"].includes(authority.hostname);
    if (authority.port !== url.port || (authority.hostname !== url.hostname && !normalizedLoopback)) return null;
    return authority.origin;
  } catch {
    return null;
  }
}

/** localhost Origin with a numeric Host is still cross-origin. */
export function hasSameOrigin(request: Request): boolean {
  const origin = requestOrigin(request);
  return origin !== null && request.headers.get("origin") === origin;
}
