import { test } from "node:test";
import assert from "node:assert/strict";
import { retry } from "../src/lib/retry.js";
import { qs } from "../src/lib/qs.js";
import { logRequest } from "../src/lib/logger.js";

// Unit tests for the three "safe defaults" the README promises:
// retries with backoff, Retry-After handling, and secret redaction in logs.

test("retry: succeeds after transient failures when shouldRetry says yes", async () => {
  let calls = 0;
  const result = await retry(async () => {
    calls++;
    if (calls < 3) throw new Error("503");
    return "ok";
  }, { attempts: 3, minDelayMs: 1, shouldRetry: () => true });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("retry: does not retry when shouldRetry is not set (the default)", async () => {
  let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error("boom"); }, { minDelayMs: 1 }));
  assert.equal(calls, 1);
});

test("retry: gives up after the configured number of attempts", async () => {
  let calls = 0;
  await assert.rejects(
    retry(async () => { calls++; throw new Error("still down"); }, { attempts: 4, minDelayMs: 1, shouldRetry: () => true }),
    /still down/,
  );
  assert.equal(calls, 4);
});

test("retry: waits for the server's Retry-After delay when one is given", async () => {
  let calls = 0;
  const started = Date.now();
  await retry(async () => {
    calls++;
    if (calls === 1) throw new Error("429");
    return "ok";
  }, { attempts: 2, minDelayMs: 1, shouldRetry: () => true, retryAfterMs: () => 120 });
  assert.ok(Date.now() - started >= 100, "expected to wait roughly the Retry-After delay");
});

test("qs: drops empty values and encodes the rest", () => {
  assert.equal(qs(undefined), "");
  assert.equal(qs({ a: undefined, b: null, c: "" }), "");
  assert.equal(qs({ q: "a b", page: 2, skip: "" }), "?q=a+b&page=2");
});

test("logRequest: redacts key, token, secret and password query values", () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (msg: string) => { lines.push(msg); };
  try {
    logRequest({
      tool: "api_get", method: "GET", status: 200, ms: 5,
      url: "https://api.example.com/v1/items?api_key=abc123&Token=xyz&client_secret=s&password=p&page=2",
    });
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]).url as string;
  for (const leaked of ["abc123", "xyz", "=s&", "=p&"]) {
    assert.ok(!logged.includes(leaked), `log line leaked a secret: ${logged}`);
  }
  assert.ok(logged.includes("page=2"), "non-secret params should be kept");
});
