# Security Policy

## Reporting a vulnerability

If you discover a security issue, please report it privately via GitHub
Security Advisories:

1. Open the repository on GitHub.
2. Go to the **Security** tab → **Advisories** → **Report a vulnerability**.
3. Provide a description and reproduction steps.

Do **not** open public issues for security reports.

## Scope

This is a static browser game with no backend, no account and no telemetry:

- Everything runs in the visitor's browser. Nothing is stored beyond the
  current page; there is no server-side state and no API.
- The site is served as static assets from a Cloudflare Worker with a
  Content Security Policy and the usual hardening headers (`public/_headers`).

In-scope vulnerabilities include:

- A way to run script on the page that the CSP should have blocked
- Header or caching misconfiguration that ships stale or wrong content
- Anything in the build or CI pipeline that could alter what is deployed

Out of scope:

- Self-XSS or social-engineering scenarios
- Best-practice deviations without a concrete exploit

## Response

I aim to acknowledge reports within 7 days and provide a remediation plan
within 30 days. Critical issues are patched as soon as practical.
