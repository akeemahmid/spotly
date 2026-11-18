// Manual loopback browser rehearsal launcher. Never reads production settings as
// defaults; explicit child variables override .env.local and inherited exports.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { check, TEST_PROJECT } from "./security-test-db.mjs";
export function demoEnvironment(file, inherited = process.env) {
  check(file.NEXT_PUBLIC_SUPABASE_URL === `https://${TEST_PROJECT}.supabase.co`);
  check(typeof file.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === "string" && file.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_"));
  check(file.SERV_PLAN_SIGNING_KEY === "cd".repeat(32)); // Public synthetic test key only.
  check(inherited.NODE_TLS_REJECT_UNAUTHORIZED !== "0");
  return { ...inherited, NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: file.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: file.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SERV_PLAN_SIGNING_KEY: file.SERV_PLAN_SIGNING_KEY, SERV_API_KEY: "", PHASE3B_ENABLED: "true" };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(process.argv.length === 2);
    const env = demoEnvironment(parseEnv(readFileSync(new URL("../.env.isolated-browser", import.meta.url), "utf8")));
    const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)),
      "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3001"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), env, stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`Test-only browser server starting on http://127.0.0.1:3001 for ${TEST_PROJECT}. SERV is disabled.`);
    // Do not forward raw child diagnostics or environment contents.
    child.stdout.on("data", bytes => { if (/Ready in/.test(bytes.toString())) console.log("Browser rehearsal server ready."); });
    child.stderr.on("data", () => {});
    const stop = () => child.kill("SIGINT");
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    child.on("error", () => { console.error("Test server could not start; private details suppressed."); process.exitCode = 1; });
    child.on("exit", (code, signal) => {
      process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
      process.exitCode = code === 0 || code === 130 || signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1;
      console.log("Test server stopped. Return to the Storage runner to close its gate and finish cleanup.");
    });
  } catch {
    console.error("Test server refused: check the private .env.isolated-browser file for the exact disposable URL/public key/synthetic signing key. Private details suppressed.");
    process.exitCode = 1;
  }
}
