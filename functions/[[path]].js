const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;
const MAX_URL_LENGTH = 2048;
const MAX_EXPIRY_SECONDS = 365 * 24 * 60 * 60;

const MAX_REQUEST_BYTES = 8192;
const CREATE_LIMIT_WINDOW_MS = 60_000;
const CREATE_LIMIT_MAX = 10;
const MAX_RATE_LIMIT_KEYS = 4096;

// Best-effort per-isolate limiter. The source IP is hashed with the current minute
// and only the short-lived hash/count are kept in memory; no IP or click event is stored.
const CREATE_RATE_LIMITS = new Map();
let rateLimitChecks = 0;

function getCorsPolicy(request, url, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return { allowed: true, headers: {} };

  let normalizedOrigin;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return { allowed: false, headers: {} };
  }

  const allowed = new Set([
    url.origin,
    "https://life-of-lohibv.pages.dev"
  ]);

  // Additional integrations can be configured as a comma-separated Pages variable.
  if (typeof env.QUIETLINK_ALLOWED_ORIGINS === "string") {
    for (const item of env.QUIETLINK_ALLOWED_ORIGINS.split(",")) {
      const candidate = item.trim();
      if (!candidate) continue;
      try {
        allowed.add(new URL(candidate).origin);
      } catch {
        // Ignore malformed configuration entries rather than breaking link creation.
      }
    }
  }

  if (!allowed.has(normalizedOrigin)) {
    return { allowed: false, headers: {} };
  }

  return {
    allowed: true,
    headers: {
      "Access-Control-Allow-Origin": normalizedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin"
    }
  };
}

async function readJsonPayload(request) {
  const contentType = (request.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    return { ok: false, status: 415, error: "Send the request as application/json." };
  }

  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return { ok: false, status: 413, error: "The request is too large. Keep it under 8 KB." };
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, error: "Send a valid JSON object." };
  }

  let reader;
  try {
    reader = request.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;

      if (totalBytes > MAX_REQUEST_BYTES) {
        try { await reader.cancel(); } catch { /* Body is already rejected. */ }
        return { ok: false, status: 413, error: "The request is too large. Keep it under 8 KB." };
      }
      chunks.push(result.value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    let payload;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
      payload = JSON.parse(text);
    } catch {
      return { ok: false, status: 400, error: "Send a valid JSON object." };
    }

    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, status: 400, error: "Send a valid JSON object." };
    }
    return { ok: true, payload };
  } catch {
    try { if (reader) await reader.cancel(); } catch { /* Ignore reader cleanup errors. */ }
    return { ok: false, status: 400, error: "The request body could not be read. Please try again." };
  }
}

async function checkCreateRateLimit(request) {
  const sourceIp = request.headers.get("CF-Connecting-IP");
  // Cloudflare supplies CF-Connecting-IP on live requests. Skip this local-only
  // fallback when it is absent rather than merging unrelated local clients.
  if (!sourceIp) return { allowed: true, retryAfter: 0 };

  const now = Date.now();
  const bucket = Math.floor(now / CREATE_LIMIT_WINDOW_MS);
  let digest;

  try {
    digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(sourceIp + ":" + bucket)
    );
  } catch {
    return { allowed: false, retryAfter: 60, unavailable: true };
  }

  const bytes = new Uint8Array(digest);
  let key = "";
  for (const byte of bytes) key += byte.toString(16).padStart(2, "0");
  key = "create:" + key;

  const current = CREATE_RATE_LIMITS.get(key);
  if (current && current.count >= CREATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil(((bucket + 1) * CREATE_LIMIT_WINDOW_MS - now) / 1000))
    };
  }

  if (!current) {
    if ((++rateLimitChecks % 64) === 0 || CREATE_RATE_LIMITS.size >= MAX_RATE_LIMIT_KEYS) {
      for (const [storedKey, value] of CREATE_RATE_LIMITS) {
        if (value.expiresAt <= now) CREATE_RATE_LIMITS.delete(storedKey);
      }
    }
    if (CREATE_RATE_LIMITS.size >= MAX_RATE_LIMIT_KEYS) {
      return { allowed: false, retryAfter: 60 };
    }
    CREATE_RATE_LIMITS.set(key, {
      count: 1,
      expiresAt: (bucket + 1) * CREATE_LIMIT_WINDOW_MS
    });
  } else {
    current.count += 1;
  }

  return { allowed: true, retryAfter: 0 };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders
    }
  });
}

function htmlPage(title, message, status) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>${safeTitle} · QuietLink</title><style>body{margin:0;background:#f7f8fc;color:#202840;font:16px/1.7 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px;box-sizing:border-box}.card{max-width:460px;background:#fff;border:1px solid #e5e8f0;border-radius:20px;padding:32px;box-shadow:0 18px 55px #2f375f12}h1{font-size:27px;letter-spacing:-1px;margin:0 0 10px}p{color:#778096;margin:0 0 24px;font-size:14px}.brand{display:block;margin-bottom:25px;color:#6657d9;font-size:14px;font-weight:800;letter-spacing:-.2px;text-decoration:none}a.button{display:inline-block;border-radius:10px;background:#6657d9;color:#fff;padding:10px 15px;font-size:13px;font-weight:700;text-decoration:none}</style></head><body><main class="card"><a class="brand" href="/">quietlink ↗</a><h1>${safeTitle}</h1><p>${safeMessage}</p><a class="button" href="/">Go to QuietLink</a></main></body></html>`;
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function isPrivateOrLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") ||
      host.endsWith(".home") || host.endsWith(".test") || host.endsWith(".example") ||
      host.endsWith(".invalid")) return true;

  // This service only accepts global IPv4 literals, not IPv6 literals. This avoids
  // accidentally making internal IPv6 services easier to reach through a short link.
  if (host.includes(":")) return true;

  const parts = host.split(".");
  if (parts.every((part) => /^\d+$/.test(part))) {
    if (parts.length !== 4 || parts.some((part) => Number(part) > 255)) return true;
    const [a, b, c] = parts.map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    return false;
  }

  // Avoid single-label hostnames that may resolve differently on private networks.
  if (!host.includes(".")) return true;
  return false;
}

function validateDestination(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    return { error: "Enter a URL up to 2,048 characters long." };
  }

  let destination;
  try {
    destination = new URL(rawUrl);
  } catch {
    return { error: "Enter a valid URL including https://." };
  }

  if (destination.protocol !== "https:" && destination.protocol !== "http:") {
    return { error: "Only http:// and https:// links are supported." };
  }
  if (destination.username || destination.password) {
    return { error: "URLs containing a username or password are not supported." };
  }
  if (isPrivateOrLocalHost(destination.hostname)) {
    return { error: "Use a public website address, not a localhost, private-network, or IP-literal destination." };
  }

  return { destination };
}

function validateExpiry(value) {
  if (value === null) return { expiresAt: null, ttl: null };
  if (!Number.isInteger(value) || value < 3600 || value > MAX_EXPIRY_SECONDS) {
    return { error: "Choose an expiry between 1 hour and 365 days, or select Never expire." };
  }
  const expiresAt = Date.now() + value * 1000;
  return { expiresAt, ttl: Math.floor(expiresAt / 1000) };
}

function createCode() {
  const randomBytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(randomBytes);
  let code = "";
  for (const byte of randomBytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

const STATIC_PATHS = new Set([
  "/", "/index.html", "/styles.css", "/app.js", "/favicon.svg", "/robots.txt", "/privacy.html"
]);

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/shorten") {
    const cors = getCorsPolicy(request, url, env);
    if (!cors.allowed) {
      return json({ error: "This origin is not allowed to use QuietLink." }, 403);
    }
    const corsHeaders = cors.headers;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST to create a short link." }, 405, {
        ...corsHeaders,
        "Allow": "POST, OPTIONS"
      });
    }
    if (!env.LINKS) {
      return json({ error: "Link storage isn't connected yet. Bind a Cloudflare KV namespace named LINKS, then redeploy." }, 503, corsHeaders);
    }

    const rateLimit = await checkCreateRateLimit(request);
    if (!rateLimit.allowed) {
      return json({
        error: rateLimit.unavailable
          ? "Link creation is temporarily unavailable. Please try again shortly."
          : "Too many links have been created from this network. Wait a moment and try again."
      }, rateLimit.unavailable ? 503 : 429, {
        ...corsHeaders,
        "Retry-After": String(rateLimit.retryAfter || 60)
      });
    }

    const parsedBody = await readJsonPayload(request);
    if (!parsedBody.ok) {
      return json({ error: parsedBody.error }, parsedBody.status, corsHeaders);
    }
    const payload = parsedBody.payload;

    const checkedUrl = validateDestination(payload.url);
    if (checkedUrl.error) return json({ error: checkedUrl.error }, 400, corsHeaders);

    const expiry = validateExpiry(payload.expiresInSeconds);
    if (expiry.error) return json({ error: expiry.error }, 400, corsHeaders);

    // No visitor identifier, referrer, click count, or creation timestamp is stored.
    // Only the destination and expiry needed to perform the redirect are persisted.
    let code = "";
    let stored = false;
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        code = createCode();
        const existing = await env.LINKS.get(code);
        if (existing !== null) continue;

        const value = JSON.stringify({
          url: checkedUrl.destination.href,
          expiresAt: expiry.expiresAt
        });
        const options = expiry.ttl ? { expiration: expiry.ttl } : undefined;
        await env.LINKS.put(code, value, options);
        stored = true;
        break;
      }
    } catch {
      return json({ error: "Link storage is temporarily unavailable. Please try again shortly." }, 503, corsHeaders);
    }

    if (!stored) return json({ error: "We couldn't reserve a short code. Please try again." }, 503, corsHeaders);

    return json({
      code,
      shortUrl: url.origin + "/" + code,
      expiresAt: expiry.expiresAt
    }, 201, corsHeaders);
  }

  if (path.startsWith("/api/")) return json({ error: "Not found." }, 404);

  // Let Pages serve known assets. Other multi-segment paths can fall through to
  // the static asset handler; only a single 8-character path segment is a short code.
  if (STATIC_PATHS.has(path) || path.includes(".") || path.endsWith("/")) {
    return context.next();
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return context.next();
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 1 || !/^[A-Za-z0-9_-]{8}$/.test(segments[0])) {
    return context.next();
  }
  if (!env.LINKS) {
    return htmlPage("Almost ready", "The link database hasn't been connected yet. Bind the LINKS KV namespace in Cloudflare Pages and redeploy.", 503);
  }

  const code = segments[0];
  let link;
  try {
    const value = await env.LINKS.get(code);
    link = value ? JSON.parse(value) : null;
  } catch {
    return htmlPage("Link unavailable", "This link couldn't be read right now. Please try again later.", 503);
  }

  if (!link || typeof link.url !== "string") {
    return htmlPage("Link not found", "This short link may be incorrect, removed, or already expired.", 404);
  }

  if (link.expiresAt !== null && (!Number.isFinite(link.expiresAt) || Date.now() >= link.expiresAt)) {
    // A read-time check makes expired links stop working even if KV cleanup lags.
    try { await env.LINKS.delete(code); } catch { /* no request details are logged */ }
    return htmlPage("This link has expired", "The owner set an expiry for this short link, and that time has passed.", 410);
  }

  // Re-validate stored destinations before redirecting in case data was altered.
  const destination = validateDestination(link.url);
  if (destination.error) {
    return htmlPage("Link unavailable", "This destination is no longer accepted by QuietLink.", 410);
  }

  return new Response(null, {
    status: 302,
    headers: {
      "Location": destination.destination.href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}