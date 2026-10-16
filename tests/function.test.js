import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { onRequest } from "../functions/[[path]].js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class MemoryKV {
  constructor() {
    this.items = new Map();
    this.failGet = false;
    this.failPut = false;
  }

  async get(key) {
    if (this.failGet) throw new Error("KV get failed");
    return this.items.has(key) ? this.items.get(key) : null;
  }

  async put(key, value, options) {
    if (this.failPut) throw new Error("KV put failed");
    this.items.set(key, value);
    this.lastPutOptions = options;
  }

  async delete(key) {
    this.items.delete(key);
  }
}

function makeRequest({
  method = "POST",
  url = "https://quiet-link.pages.dev/api/shorten",
  headers = {},
  body
} = {}) {
  const requestHeaders = new Headers(headers);
  const requestOptions = { method, headers: requestHeaders };
  if (body !== undefined) requestOptions.body = body;
  return new Request(url, requestOptions);
}

async function call(request, env = {}) {
  const response = await onRequest({
    request,
    env,
    next: async () => new Response("static asset", { status: 200 })
  });
  return response;
}

function validBody(url = "https://example.com/path", expiresInSeconds = 3600) {
  return JSON.stringify({ url, expiresInSeconds });
}

function jsonHeaders(origin = "https://quiet-link.pages.dev", extra = {}) {
  return {
    "Content-Type": "application/json",
    ...(origin ? { Origin: origin } : {}),
    ...extra
  };
}

test("creates and stores a short link with minimal mapping data", async () => {
  const kv = new MemoryKV();
  const response = await call(makeRequest({
    headers: jsonHeaders(),
    body: validBody()
  }), { LINKS: kv });

  assert.equal(response.status, 201);
  const result = await response.json();
  assert.match(result.code, /^[A-Za-z0-9_-]{8}$/);
  assert.equal(result.shortUrl, "https://quiet-link.pages.dev/" + result.code);
  assert.equal(typeof result.expiresAt, "number");
  const stored = JSON.parse(kv.items.get(result.code));
  assert.deepEqual(Object.keys(stored).sort(), ["expiresAt", "url"]);
  assert.equal(stored.url, "https://example.com/path");
  assert.match(response.headers.get("Access-Control-Allow-Origin"), /^https:\/\/quiet-link\.pages\.dev$/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("allows the documented related site and supports configured origins", async () => {
  const kv = new MemoryKV();
  const response = await call(makeRequest({
    headers: jsonHeaders("https://life-of-lohibv.pages.dev"),
    body: validBody()
  }), { LINKS: kv });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://life-of-lohibv.pages.dev");

  const custom = await call(makeRequest({
    headers: jsonHeaders("https://tools.example.org"),
    body: validBody("https://example.org")
  }), {
    LINKS: new MemoryKV(),
    QUIETLINK_ALLOWED_ORIGINS: "https://tools.example.org"
  });
  assert.equal(custom.status, 201);
  assert.equal(custom.headers.get("Access-Control-Allow-Origin"), "https://tools.example.org");
});

test("rejects unapproved browser origins before storage writes", async () => {
  const kv = new MemoryKV();
  const response = await call(makeRequest({
    headers: jsonHeaders("https://untrusted.example"),
    body: validBody()
  }), { LINKS: kv });

  assert.equal(response.status, 403);
  assert.equal(kv.items.size, 0);
});

test("handles preflight only for allowed origins", async () => {
  const allowed = await call(makeRequest({
    method: "OPTIONS",
    headers: { Origin: "https://life-of-lohibv.pages.dev" }
  }), { LINKS: new MemoryKV() });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");

  const blocked = await call(makeRequest({
    method: "OPTIONS",
    headers: { Origin: "https://untrusted.example" }
  }), { LINKS: new MemoryKV() });
  assert.equal(blocked.status, 403);
});

test("rejects non-POST requests to the creation endpoint", async () => {
  const response = await call(makeRequest({
    method: "GET",
    headers: { Origin: "https://quiet-link.pages.dev" }
  }), { LINKS: new MemoryKV() });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "POST, OPTIONS");
});

test("requires application/json", async () => {
  const response = await call(makeRequest({
    headers: { Origin: "https://quiet-link.pages.dev", "Content-Type": "text/plain" },
    body: "url=https://example.com"
  }), { LINKS: new MemoryKV() });
  assert.equal(response.status, 415);
});

test("rejects malformed JSON and non-object JSON", async () => {
  const malformed = await call(makeRequest({
    headers: jsonHeaders(),
    body: "{"
  }), { LINKS: new MemoryKV() });
  assert.equal(malformed.status, 400);

  const array = await call(makeRequest({
    headers: jsonHeaders(),
    body: "[]"
  }), { LINKS: new MemoryKV() });
  assert.equal(array.status, 400);
});

test("rejects request bodies over 8 KB", async () => {
  const oversized = JSON.stringify({
    url: "https://example.com/" + "x".repeat(9000),
    expiresInSeconds: 3600
  });
  const response = await call(makeRequest({
    headers: jsonHeaders(),
    body: oversized
  }), { LINKS: new MemoryKV() });
  assert.equal(response.status, 413);
});

test("rejects unsafe destinations and embedded credentials", async (t) => {
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "http://localhost/admin",
    "http://127.0.0.1/",
    "http://192.168.1.5/",
    "https://user:password@example.com/"
  ]) {
    await t.test(url, async () => {
      const response = await call(makeRequest({
        headers: jsonHeaders(),
        body: validBody(url)
      }), { LINKS: new MemoryKV() });
      assert.equal(response.status, 400);
    });
  }
});

test("rejects invalid expiry values", async () => {
  for (const expiry of [0, 59, 31536001, 1.5, "3600", undefined]) {
    const payload = expiry === undefined
      ? JSON.stringify({ url: "https://example.com" })
      : JSON.stringify({ url: "https://example.com", expiresInSeconds: expiry });
    const response = await call(makeRequest({
      headers: jsonHeaders(),
      body: payload
    }), { LINKS: new MemoryKV() });
    assert.equal(response.status, 400);
  }
});

test("returns a storage error instead of leaking an exception", async () => {
  const kv = new MemoryKV();
  kv.failPut = true;
  const response = await call(makeRequest({
    headers: jsonHeaders(),
    body: validBody()
  }), { LINKS: kv });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /storage is temporarily unavailable/i);
});

test("returns a clear setup error when KV is missing", async () => {
  const response = await call(makeRequest({
    headers: jsonHeaders(),
    body: validBody()
  }), {});
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /storage isn't connected/i);
});

test("redirects saved links without referrer leakage", async () => {
  const kv = new MemoryKV();
  kv.items.set("abcDef23", JSON.stringify({
    url: "https://example.com/destination",
    expiresAt: Date.now() + 60000
  }));
  const response = await call(makeRequest({
    method: "GET",
    url: "https://quiet-link.pages.dev/abcDef23"
  }), { LINKS: kv });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://example.com/destination");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("removes expired links and returns 410", async () => {
  const kv = new MemoryKV();
  kv.items.set("expired1", JSON.stringify({
    url: "https://example.com/destination",
    expiresAt: Date.now() - 1000
  }));
  const response = await call(makeRequest({
    method: "GET",
    url: "https://quiet-link.pages.dev/expired1"
  }), { LINKS: kv });

  assert.equal(response.status, 410);
  assert.equal(kv.items.has("expired1"), false);
});

test("best-effort throttling rejects the 11th create from the same source in one minute", async () => {
  const kv = new MemoryKV();
  const sourceIp = "203.0.113.77";

  for (let i = 0; i < 10; i += 1) {
    const response = await call(makeRequest({
      headers: jsonHeaders("https://quiet-link.pages.dev", { "CF-Connecting-IP": sourceIp }),
      body: validBody("https://example.com/page-" + i)
    }), { LINKS: kv });
    assert.equal(response.status, 201);
  }

  const blocked = await call(makeRequest({
    headers: jsonHeaders("https://quiet-link.pages.dev", { "CF-Connecting-IP": sourceIp }),
    body: validBody("https://example.com/page-blocked")
  }), { LINKS: kv });

  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("Retry-After") !== null, true);
});
