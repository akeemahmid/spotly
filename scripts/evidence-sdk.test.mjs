import test from "node:test";
import assert from "node:assert/strict";
import { StorageClient } from "@supabase/storage-js";
import { createClient } from "@supabase/supabase-js";

test("installed SDK upload path and Blob download round-trip with mocked HTTP without a policy or route workaround", async () => {
  const origin = "https://ogqmifuylakjhwveqrmd.supabase.co/storage/v1";
  const path = "69000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000001";
  const bytes = Buffer.from([137, 80, 78, 71]), requests = [];
  const storage = new StorageClient(origin, { Authorization: "Bearer private-test-token" },
    async (url, options) => {
      assert.equal(String(url), `${origin}/object/verification-evidence/${path}`);
      requests.push(options.method);
      if (options.method === "POST") {
        assert.equal(options.headers["x-upsert"], "false");
        return new Response(JSON.stringify({ Id: "59000000-0000-4000-8000-000000000001", Key: `verification-evidence/${path}` }), { status: 200 });
      }
      return new Response(bytes, { status: 200, headers: { "Content-Type": "image/png" } });
    });
  const uploaded = await storage.from("verification-evidence").upload(path, bytes, { contentType: "image/png", upsert: false });
  assert.equal(uploaded.data.path, path);
  const downloaded = await storage.from("verification-evidence").download(path);
  assert.equal(downloaded.error, null);
  assert.deepEqual(Buffer.from(await downloaded.data.arrayBuffer()), bytes);
  assert.deepEqual(requests, ["POST", "GET"]);
});
test("installed full SDK preserves each login's JWT on same-path pre-finalization readback; B/anonymous transport denials remain errors (mock HTTP)", async () => {
  const origin = "https://ogqmifuylakjhwveqrmd.supabase.co";
  const path = "69000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000001";
  const bytes = Buffer.from([137, 80, 78, 71]);
  const tokens = new Map(), requests = [];
  let stored;
  const fetcher = async (input, init) => {
    const url = new URL(input), headers = new Headers(init.headers);
    assert.equal(url.origin, origin);
    if (url.pathname === "/auth/v1/token") {
      const { email } = JSON.parse(init.body);
      const label = email.slice(6, 7);
      const user = { id: `18000000-0000-4000-8000-00000000000${{ a: 1, b: 2, c: 3 }[label]}`, email, aud: "authenticated", role: "authenticated" };
      const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.synthetic-signature`;
      tokens.set(`Bearer ${token}`, label);
      return new Response(JSON.stringify({ access_token: token, refresh_token: `synthetic-refresh-${label}`, token_type: "bearer", expires_in: 3600, user }), { status: 200 });
    }
    assert.equal(url.pathname, `/storage/v1/object/verification-evidence/${path}`);
    const role = tokens.get(headers.get("Authorization")) ?? "anonymous";
    requests.push(`${role}:${init.method}`);
    // Mock service contract only. Actual RLS is covered by the rollback SQL
    // regression, not by this fake HTTP server.
    if (init.method === "POST" && role === "c") {
      stored = Buffer.from(await new Response(init.body).arrayBuffer());
      return new Response(JSON.stringify({ Key: `verification-evidence/${path}` }), { status: 200 });
    }
    if (init.method === "GET" && ["a", "c"].includes(role) && stored) return new Response(stored, { status: 200 });
    return new Response(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }), { status: 400 });
  };
  const makeClient = () => createClient(origin, "sb_publishable_synthetic_contract_only", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher },
  });
  const [a, b, c, anonymous] = [makeClient(), makeClient(), makeClient(), makeClient()];
  for (const [client, label] of [[a, "a"], [b, "b"], [c, "c"]]) {
    assert.equal((await client.auth.signInWithPassword({ email: `pilot-${label}@example.test`, password: "synthetic-password" })).error, null);
  }
  assert.equal((await c.storage.from("verification-evidence").upload(path, bytes, { contentType: "image/png", upsert: false })).error, null);
  for (const client of [c, a]) {
    const result = await client.storage.from("verification-evidence").download(path);
    assert.equal(result.error, null);
    assert.deepEqual(Buffer.from(await result.data.arrayBuffer()), bytes);
  }
  for (const client of [b, anonymous]) {
    const result = await client.storage.from("verification-evidence").download(path);
    assert.equal(result.error.status, 400);
    assert.equal(result.data, null);
  }
  assert.deepEqual(requests, ["c:POST", "c:GET", "a:GET", "b:GET", "anonymous:GET"]);
});
