# QuietLink — Anonymous URL Shortener

QuietLink is a privacy-first URL shortener built for Cloudflare Pages Functions with Cloudflare Workers KV. It requires no accounts and does not implement click analytics.

## Features

- Random 8-character short codes.
- Optional destination preview page that shows the destination domain and full URL before continuing.
- Account-free revocation: each new link gets a one-time 256-bit management key; only its SHA-256 digest is stored.
- QR codes generated in the visitor's browser and downloaded as PNG without sending destinations to a third-party QR service.
- Redirects to HTTP(S) destinations.
- Expiration presets: 1 hour, 24 hours, 7 days, 30 days, custom duration (1 hour to 365 days), or never expire.
- Cloudflare KV persists mappings and applies TTL for expiring links.
- No click counts, visitor profiles, analytics cookies, or application-level access logs.
- Persistent link records contain only the destination URL and optional expiry timestamp.
- Creation requests are capped at 8 KB and require JSON.
- Cross-origin browser requests are limited to QuietLink, the documented Life of Lohibv integration, and HTTPS origins explicitly listed in `QUIETLINK_ALLOWED_ORIGINS`.
- Best-effort in-memory throttling limits link creation to 10 attempts per minute per source IP hash within a Worker isolate. The source IP itself and throttle state are not written to KV or logs; this local throttle is not a globally coordinated edge limit.
- Referrer Policy `no-referrer` on redirects.
- Rejects non-HTTP(S) schemes, URLs with embedded credentials, local hostnames, and private/reserved IPv4 destinations.
- Responsive accessible interface, privacy notice, and security headers.

## Deploy using GitHub + Cloudflare Pages

1. In Cloudflare, open **Workers & Pages** and create a **Pages** project by connecting the GitHub repository `rajeevtv1972-crypto/quiet-link`.
2. Set the production branch to `main`.
3. There is no build step. Set the build command to blank (or no command) and the build output directory to `public`.
4. Create a Cloudflare **Workers KV** namespace, for example `quietlink-links`.
5. In the Pages project, open **Settings → Bindings → Add → KV namespace**. Set the variable name to exactly `LINKS`, choose the namespace you created, save, and redeploy. The Function returns a setup message until this binding exists.
6. Open the deployed Pages URL and create a one-hour test link. Confirm it redirects correctly. Also test an expired link and the **Never expire** option.

The repository does not include a Cloudflare account ID, namespace ID, API token, or other deployment secret. Create the KV namespace in your own account; don't commit credentials to GitHub.

### Optional local preview

Install Node.js, clone this repository, then run:

```bash
npx wrangler pages dev public --kv=LINKS
```

This provides a local development binding. If you need durable local test data, follow the current Wrangler KV local-development instructions.

## Routes

- `/` — shortener interface
- `/about.html` — about QuietLink
- `/contact.html` — contact information (`contactussiteinfotechdesk@gmail.com`)
- `/privacy-policy.html` — full privacy policy
- `/privacy.html` — legacy path that redirects to the privacy policy
- `POST /api/shorten` — validate and store a destination mapping; optional JSON `preview: true` enables the destination interstitial. On creation, a random management key is returned once; store it securely.
- `POST /api/revoke` — revoke a link with JSON `{ "code": "…", "managementToken": "…" }`. The token is never stored in plaintext. Links made before this feature won't have a management key and cannot be revoked through this route.
- `/<8-character-code>` — redirect to a saved destination

The `functions/[[path]].js` Pages Function passes static assets through to Pages and handles creation, revocation, direct redirects, and optional destination previews. `public/qrcode.min.js` is a locally hosted QRCode.js build under the MIT license; see `public/QR-CODE-LICENSE.txt`.

## Privacy scope and limitations

QuietLink doesn't collect identifiers or click events in its application code. Cloudflare necessarily processes network requests and its platform-level handling depends on Cloudflare's own policies and settings. A short link is not an anonymity proxy: the destination can still receive network information from the person opening it.

“Never expire” links remain in KV until removed or the service changes. Expiring links are given a KV TTL and are also checked at redirect time. Expiration does not guarantee immediate physical deletion from every underlying storage layer. Link revocation deletes the mapping from KV, but KV deletion may take a short time to propagate to every Cloudflare location.

## Phase 1 abuse protection

The Function includes request-size and content-type checks, a browser Origin allowlist, safe destination validation, consistent storage error responses, and a short-lived in-memory throttle. The throttle is intentionally privacy-minimal but is **best-effort only**: isolate-local counters are not globally coordinated and can reset when Cloudflare replaces an isolate.

For a stronger edge limit, attach a custom domain to the Pages project and use Cloudflare Security rules > Rate limiting rules (where available for that zone). Start with a rule matching `http.host eq "YOUR_CUSTOM_HOST" and http.request.uri.path eq "/api/shorten" and http.request.method eq "POST"`, count by source IP, and begin around 10 requests per 60 seconds with a short block window. Test with your real traffic before tightening the threshold. For a Pages-only `.pages.dev` deployment, Cloudflare zone-level WAF controls may not be available for the shared `.pages.dev` zone; a dedicated API Worker with a Rate Limiting binding or a challenge such as Turnstile is a stronger next step.

If another website needs to call the API, add its exact HTTPS origin to the comma-separated `QUIETLINK_ALLOWED_ORIGINS` variable in the Pages project's Settings > Variables and Secrets, then redeploy. Do not use `*` unless you intentionally want every browser origin to call the public endpoint.

Public URL shorteners can be abused for phishing, so keep destination validation and acceptable-use language in place. No click analytics are required to enforce these controls.

## License

Choose a license before accepting external contributions or redistributing the code.