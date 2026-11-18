import { test } from "node:test";
import assert from "node:assert/strict";
import { isolatedStorageConfig } from "./isolated-storage-check.mjs";

const config = () => ({
  SPOTLY_ISOLATED_TEST: "yes",
  SPOTLY_TEST_URL: "https://ogqmifuylakjhwveqrmd.supabase.co",
  SPOTLY_TEST_CONFIRMED_ORIGIN: "https://ogqmifuylakjhwveqrmd.supabase.co",
  SPOTLY_TEST_PUBLISHABLE_KEY: "sb_publishable_testfixture",
  SPOTLY_TEST_A_PASSWORD: "test-a", SPOTLY_TEST_B_PASSWORD: "test-b", SPOTLY_TEST_C_PASSWORD: "test-c",
});
test("isolated runner refuses the real project even with explicit acknowledgement", () => {
  const env = config();
  env.SPOTLY_TEST_URL = env.SPOTLY_TEST_CONFIRMED_ORIGIN = "https://onfdusisfidlfdmluwxl.supabase.co";
  assert.throws(() => isolatedStorageConfig(env), /^Error: ISOLATED_CONFIGURATION_REQUIRED$/);
});
test("isolated runner requires acknowledgement, independently confirmed origin and dedicated passwords", () => {
  for (const name of ["SPOTLY_ISOLATED_TEST", "SPOTLY_TEST_CONFIRMED_ORIGIN", "SPOTLY_TEST_A_PASSWORD", "SPOTLY_TEST_B_PASSWORD", "SPOTLY_TEST_C_PASSWORD"]) {
    const env = config(); delete env[name];
    assert.throws(() => isolatedStorageConfig(env));
  }
  const env = config(); env.SPOTLY_TEST_URL = "https://wrongtarget.supabase.co";
  assert.throws(() => isolatedStorageConfig(env));
  assert.equal(isolatedStorageConfig(config()).url, "https://ogqmifuylakjhwveqrmd.supabase.co");
});
test("isolated runner rejects privileged keys and embedded credentials without echoing secrets", () => {
  const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  for (const key of ["sb_secret_DO_NOT_ECHO", jwt("service_role"), "malformed"]) {
    const env = config(); env.SPOTLY_TEST_PUBLISHABLE_KEY = key;
    assert.throws(() => isolatedStorageConfig(env), /^Error: ISOLATED_CONFIGURATION_REQUIRED$/);
  }
  const env = config(); env.SPOTLY_TEST_PUBLISHABLE_KEY = jwt("anon");
  assert.equal(isolatedStorageConfig(env).key, env.SPOTLY_TEST_PUBLISHABLE_KEY);
  env.SPOTLY_TEST_URL = "https://user:DO_NOT_ECHO@disposabletest.supabase.co";
  assert.throws(() => isolatedStorageConfig(env), /^Error: ISOLATED_CONFIGURATION_REQUIRED$/);
});
