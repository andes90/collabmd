# Security Policy

## Supported versions

Only the latest release on the `master` branch receives security fixes.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Email security reports to the maintainer at the address listed in the
repository's npm package metadata. Include:

1. A description of the vulnerability and its impact.
2. Steps to reproduce or a proof of concept.
3. The affected version(s).

You should receive an acknowledgement within 72 hours. Fixes for
confirmed vulnerabilities will be released as soon as practical, and the
reporter will be credited in the release notes unless they request
otherwise.

## Threat model

CollabMD is a collaborative editor that serves a local file directory
over HTTP and WebSocket. The trust boundary sits at the network edge.

**In scope:**

- Unauthenticated access to vault contents when auth is misconfigured.
- Path traversal allowing reads or writes outside the vault directory.
- Cross-site scripting (XSS) through rendered markdown, diagrams, or
  wiki-links.
- Cross-origin request forgery against mutation endpoints.
- Session hijacking or fixation in the cookie-based auth layer.
- WebSocket room name injection leading to unauthorized file access.
- Container escape or privilege escalation in the Docker image.
- Command injection through the Git SSH integration.

**Out of scope:**

- Attacks requiring local shell access on the host running CollabMD.
- Denial of service through resource exhaustion (single-process design
  is intentional; deploy behind a reverse proxy with rate limiting for
  public exposure).
- Vulnerabilities in upstream dependencies that do not affect CollabMD's
  usage of those dependencies.

## Security controls

| Control | Implementation |
|---------|---------------|
| Authentication | Default `password` strategy with per-run generated secret. OIDC (Google) with PKCE for production. |
| Session management | HMAC-signed cookies, HttpOnly, SameSite=Lax, Secure when behind TLS. 24-hour expiry (configurable). |
| Path traversal | Vault paths resolved and verified against the vault root. Null bytes rejected. |
| XSS mitigation | `html: false` in markdown-it. All dynamic content escaped. Content-Security-Policy header on every response. |
| CSRF protection | Same-origin check on all write methods (POST/PUT/PATCH/DELETE). Cross-origin writes rejected with 403. |
| Rate limiting | Auth endpoint rate-limited to 5 attempts per IP per 60 seconds. |
| HTTP headers | CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy. |
| Docker | Non-root user, all capabilities dropped, read-only root filesystem, no-new-privileges. |
| Git SSH | StrictHostKeyChecking=yes when known_hosts is provided. Warning logged on accept-new fallback. |
| WebSocket | Room names validated against traversal. Auth enforced on upgrade. |

## Disclosure timeline

We follow coordinated disclosure. After a fix is available, we will:

1. Release the patched version.
2. Publish a GitHub Security Advisory.
3. Credit the reporter unless they opt out.

We ask reporters to allow up to 90 days for a fix before public
disclosure.
