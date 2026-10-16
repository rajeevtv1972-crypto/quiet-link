# Security Policy

## Reporting a vulnerability

Please report suspected security issues privately by emailing **contactussiteinfotechdesk@gmail.com** with the subject line **QuietLink Security Report**. Please do not publish an exploitable issue in a public repository issue before the maintainer has had a reasonable opportunity to review it.

Include the affected URL or component, clear reproduction steps, expected and observed behavior, and a brief description of possible impact. Do not include anyone else's private information, active management keys, or credentials in your report.

We aim to acknowledge reports within a reasonable time and will investigate in good faith. QuietLink does not currently operate a paid bug bounty program.

## Safe testing

Only test with links and data you control. Do not perform denial-of-service testing, high-volume scanning, social engineering, or tests that affect other users or destinations. Never attempt to access, change, or revoke another person's links.

## Scope and limitations

The public service is hosted on Cloudflare Pages and uses Pages Functions and Workers KV. Cloudflare's platform-level request processing is outside the application's direct control. QuietLink's in-memory request throttle is best-effort and is not a globally coordinated edge rate limit.

Please do not assume that a short link is an anonymity proxy or that destination websites cannot see the visitors who open their pages.
