# QuietLink Phase 3 — Release Readiness

This final phase focuses on operational readiness and regression prevention. It does not add accounts, click analytics, or a link-history database; those would conflict with QuietLink's privacy-first design.

## Automated release checks

Every push to `main` and every pull request runs `npm test`. The suite covers Function behavior and security boundaries, plus static checks that catch missing local assets, frontend/HTML selector drift, stale duplicate JavaScript, missing security headers, or accidental ad-script additions.

Before considering a release complete, confirm the latest [GitHub Actions run](https://github.com/rajeevtv1972-crypto/quiet-link/actions/workflows/tests.yml) is green.

## Cloudflare production checklist

Complete these checks in the Cloudflare dashboard for the Pages project:

- [ ] Confirm the production branch is `main` and the build output directory is `public` (no build command is needed).
- [ ] Confirm the production Pages Function has a Workers KV binding named exactly `LINKS`, connected to the intended namespace.
- [ ] Keep `QUIETLINK_ALLOWED_ORIGINS` empty unless a real integration needs cross-origin access. When required, list only exact HTTPS origins separated by commas; do not use `*`.
- [ ] Do not put account IDs, API tokens, KV credentials, management keys, or other secrets in the repository.
- [ ] Test one short-lived link end to end: create it, open it, and confirm the destination. Test preview mode, QR rendering/download, and link revocation with a fresh test link. Verify the revoked URL no longer redirects.
- [ ] Confirm the root page, About, Contact, Privacy Policy, and `/.well-known/security.txt` load on the deployed site.

## Stronger edge-level abuse protection

The in-memory throttle in the Function is intentionally best-effort: Cloudflare can run multiple isolates, and those counters are not globally coordinated.

For a stronger edge rate limit on the Pages site, first attach a domain/zone you control to the project. Then, where Cloudflare's zone features permit it, add a rate-limiting rule for `POST /api/shorten`, counted by source IP. Start conservatively at about 10 requests per 60 seconds with a short block period, then tune after observing legitimate use. Consider protecting `POST /api/revoke` similarly. Test rules carefully to avoid blocking normal users.

The shared `.pages.dev` hostname is not a zone you control, so a repository change alone cannot enable a zone-level WAF/rate-limiting rule there. Do not advertise the in-memory throttle as equivalent to a global edge limit.

## Privacy and abuse policy

- [ ] Keep click analytics, visitor profiles, link-history dashboards, third-party QR services, and ad scripts out of the product unless the project owner explicitly changes the privacy requirements.
- [ ] Keep the privacy policy accurate about Cloudflare hosting and the limits of application-level privacy.
- [ ] Use the Contact page or `SECURITY.md` reporting instructions to handle abuse or security concerns.
- [ ] Choose and add a repository license before inviting external contributions or redistributing the code.

## Launch status

The repository tests and browser smoke tests can verify application behavior, but they cannot confirm account-level Cloudflare settings. Treat the Cloudflare checklist above as a manual release gate; mark a box complete only after checking the live dashboard or deployed site.
