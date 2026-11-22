import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Writes are off unless ALLOW_DESTRUCTIVE=true. This launches the real server
// with the flag unset and checks that POST, PUT and DELETE refuse before any
// network call is made (API_BASE points at a reserved .invalid host).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tsxCli = path.resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
const serverEntry = path.resolve(repoRoot, "src/server.ts");

test("write tools refuse when ALLOW_DESTRUCTIVE is not true", async () => {
  const env = { ...process.env, API_BASE: "https://api.example.invalid/v1" };
  delete (env as Record<string, string | undefined>)["ALLOW_DESTRUCTIVE"];
  const child = spawn(process.execPath, [tsxCli, serverEntry], { cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] });

  const pending = new Map<number, (m: any) => void>();
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1);
      try { const msg = JSON.parse(line); pending.get(msg.id)?.(msg); } catch { /* ignore */ }
    }
  });
  const call = (id: number, method: string, params: unknown) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10_000);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });

  try {
    await call(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "guard-test", version: "0" } });
    child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    let id = 2;
    for (const [tool, verb] of [["api_post", "POST"], ["api_put", "PUT"], ["api_delete", "DELETE"]]) {
      const res = await call(id++, "tools/call", { name: tool, arguments: { path: "/things/1", payload: { x: 1 } } });
      const text = res.result?.content?.[0]?.text ?? "";
      assert.match(text, new RegExp(`Destructive disabled.*${verb}`), `${tool} should refuse, got: ${JSON.stringify(res)}`);
    }
  } finally {
    child.kill();
  }
});
