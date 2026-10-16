import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, access } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const repoRoot = resolve(publicRoot, "..");
const ORIGIN = "https://quiet-link.pages.dev";

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

test("all local HTML assets and page links exist in the public build", async () => {
  const htmlFiles = (await walk(publicRoot)).filter(path => path.endsWith(".html"));
  assert.ok(htmlFiles.length > 0, "expected checked-in HTML pages");

  for (const htmlPath of htmlFiles) {
    const html = await readFile(htmlPath, "utf8");
    const pagePath = "/" + relative(publicRoot, htmlPath).replaceAll("\\", "/");
    const baseUrl = pagePath === "/index.html" ? ORIGIN + "/" : ORIGIN + pagePath;

    for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
      const reference = match[1].trim();
      if (!reference || reference.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) {
        if (reference.startsWith("https://quiet-link.pages.dev/")) {
          // Same-origin absolute canonical URLs still need to point to a real local page.
        } else {
          continue;
        }
      }

      let target;
      try {
        target = new URL(reference, baseUrl);
      } catch {
        assert.fail(`Invalid local URL reference "${reference}" in ${relative(publicRoot, htmlPath)}`);
      }

      if (target.origin !== ORIGIN) continue;
      const pathname = decodeURIComponent(target.pathname);
      if (pathname === "/") continue;
      const localPath = resolve(publicRoot, "." + pathname);
      assert.ok(
        localPath.startsWith(publicRoot),
        `Local reference must not escape public/: ${reference}`
      );
      await access(localPath).catch(() => {
        assert.fail(`Missing local asset/page "${pathname}" referenced by ${relative(publicRoot, htmlPath)}`);
      });
    }
  }
});

test("all fixed frontend ID selectors exist in the homepage", async () => {
  const [html, app] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app-phase2.js"), "utf8")
  ]);
  const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
  const queriedIds = new Set([...app.matchAll(/querySelector\(\s*["']#([A-Za-z][\w-]*)["']\s*\)/g)].map(match => match[1]));
  const missingIds = [...queriedIds].filter(id => !htmlIds.has(id));
  assert.deepEqual(missingIds, [], "frontend queries IDs that are not present in index.html");
});

test("legacy and cache-busted frontend JavaScript stay in sync", async () => {
  const [legacy, current] = await Promise.all([
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "app-phase2.js"), "utf8")
  ]);
  assert.equal(legacy, current, "update both frontend copies together");
});

test("static security and cache headers remain enabled", async () => {
  const headers = await readFile(resolve(publicRoot, "_headers"), "utf8");
  for (const required of [
    "X-Content-Type-Options: nosniff",
    "Referrer-Policy: no-referrer",
    "X-Frame-Options: DENY",
    "Content-Security-Policy:",
    "default-src 'self'",
    "frame-ancestors 'none'",
    "/app-phase2.js",
    "Cache-Control: no-cache, must-revalidate",
    "/qrcode.min.js",
    "Cache-Control: public, max-age=31536000, immutable"
  ]) {
    assert.ok(headers.includes(required), `missing expected header/config: ${required}`);
  }
});

test("security contact file and policy use the public contact address", async () => {
  const [securityTxt, securityPolicy] = await Promise.all([
    readFile(resolve(publicRoot, ".well-known/security.txt"), "utf8"),
    readFile(resolve(repoRoot, "SECURITY.md"), "utf8")
  ]);
  const email = "contactussiteinfotechdesk@gmail.com";
  assert.ok(securityTxt.includes("Contact: mailto:" + email));
  const expiry = securityTxt.match(/^Expires:\s*(.+)$/mi)?.[1];
  assert.ok(expiry, "security.txt must declare an expiry");
  assert.ok(Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.now(), "security.txt expiry must be in the future");
  assert.ok(securityTxt.includes("Canonical: https://quiet-link.pages.dev/.well-known/security.txt"));
  assert.ok(securityPolicy.includes(email));
  const robots = await readFile(resolve(publicRoot, "robots.txt"), "utf8");
  assert.match(robots, /Allow:\s*\/\.well-known\/security\.txt/i, "security.txt must remain explicitly discoverable to compliant crawlers");
});

test("public assets do not ship Monetag references or ad scripts", async () => {
  const publicFiles = await walk(publicRoot);
  const searchable = publicFiles.filter(path => /\.(?:html|js|css|txt|svg)$/i.test(path));
  for (const path of searchable) {
    const contents = await readFile(path, "utf8");
    assert.doesNotMatch(
      contents,
      /monetag|monetag\.com/i,
      `unexpected Monetag reference in ${relative(publicRoot, path)}`
    );
  }
});
