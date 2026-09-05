# Public access

> Operator docs. Start with the [README](../README.md) for the product overview.

CollabMD can optionally expose the session using a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Since the editor uses same-origin WebSocket routing (`/ws/:file`), the tunnel works for both HTTP and collaboration traffic.

If you are exposing the session publicly, `collabmd --auth password` is the intended first-line protection. When you do not pass `--auth-password`, CollabMD generates a password for that host run and prints it in the terminal. Restarting the app rotates that password and the signed session secret.

To share safely:

```bash
collabmd ~/my-vault --auth password
```

`cloudflared` is optional. Install it only if you want public tunnel access:

- macOS: `brew install cloudflared`
- Linux/Windows: [official installer](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)

To disable the tunnel:

```bash
collabmd --no-tunnel
```

### Google OIDC setup

`--auth oidc` uses Google OpenID Connect with the authorization code + PKCE flow.

For the full Google Cloud Console walkthrough, including where to create the OAuth client and copy the client ID/client secret, see [docs/google-oidc-setup.md](google-oidc-setup.md).

Required environment variables:

```bash
PUBLIC_BASE_URL=https://notes.example.com
AUTH_OIDC_CLIENT_ID=your-google-client-id
AUTH_OIDC_CLIENT_SECRET=your-google-client-secret
```

In Google Cloud Console, create a Web application OAuth client and register this redirect URI:

```text
https://notes.example.com/api/auth/oidc/callback
```

If you mount the app under a subpath with `BASE_PATH=/collabmd`, the redirect URI becomes:

```text
https://notes.example.com/collabmd/api/auth/oidc/callback
```

Notes:

- OIDC requires a stable public URL and is not compatible with ephemeral Cloudflare Quick Tunnel URLs
- After sign-in, the verified Google name/email become the displayed app identity and the default in-app git commit author
- Set `AUTH_SESSION_MAX_AGE_MS` to keep the signed-in session valid longer than the default token lifetime
- You can restrict sign-in to exact users with `AUTH_OIDC_ALLOWED_EMAILS` or entire domains with `AUTH_OIDC_ALLOWED_DOMAINS`
- The CLI disables the tunnel automatically when `--auth oidc` is active

### Single-tenant hosted workspace mode

Hosted workspace mode is for manually provisioned, single-tenant deployments: one CollabMD app replica for one team, one workspace, one vault source, and one hosted metadata store. It is not a shared multi-tenant account system.

Hosted mode requires Google OIDC:

```bash
AUTH_STRATEGY=oidc
PUBLIC_BASE_URL=https://notes.example.com
AUTH_OIDC_CLIENT_ID=your-google-client-id
AUTH_OIDC_CLIENT_SECRET=your-google-client-secret
COLLABMD_HOSTED_ENABLED=true
```

The first Team Admin is created through an email-bound workspace claim. Set the intended admin email and a one-time claim token when provisioning the deployment:

```bash
COLLABMD_HOSTED_CLAIM_EMAIL=admin@example.com
COLLABMD_HOSTED_CLAIM_TOKEN=generated-one-time-secret
```

The claim is seeded into hosted metadata and expires after 7 days. The claimant must sign in with the matching verified Google email. After claim, Team Admins can manage active memberships, pending invitations, roles, and the access audit trail through the hosted API. The first roles are:

- `admin` — can manage team access and configure initial workspace setup
- `collaborator` — can access, edit, and publish changes after setup is complete

Hosted metadata is stored in SQLite and defaults to `.collabmd/hosted.sqlite` inside the vault directory. Override it when the metadata store should live on a separate persistent volume:

```bash
COLLABMD_HOSTED_METADATA_DB_PATH=/data/.collabmd/hosted.sqlite
```

Hosted vault-source setup is GitHub-only in the first version and uses a GitHub App installation flow. Configure the GitHub App credentials on the server:

```bash
COLLABMD_GITHUB_APP_ID=123456
COLLABMD_GITHUB_APP_SLUG=collabmd
COLLABMD_GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/collabmd_github_app_private_key.pem
```

`COLLABMD_GITHUB_APP_PRIVATE_KEY` is also supported for environments that inject the private key directly. The Team Admin starts setup, installs the GitHub App, and selects exactly one repository. CollabMD resolves the installation and repository from GitHub, captures the selected repository's default branch as the configured branch, and stores that vault-source metadata in SQLite. The browser does not directly submit trusted repository or installation metadata.

Current backend endpoints include:

- `GET /api/hosted/status`
- `POST /api/hosted/claim`
- `POST /api/hosted/setup/complete`
- `POST /api/hosted/vault-source/github/setup`
- `GET /api/hosted/vault-source/github/callback`
- `GET /api/hosted/memberships`
- `POST /api/hosted/memberships/leave`
- `POST /api/hosted/invitations`
- `POST /api/hosted/invitations/accept`
- `GET /api/hosted/audit`

The workspace also ships a basic hosted onboarding surface: a claim screen for the first Team Admin, a setup screen (Team Admins complete setup without a vault source for now), an invitation-acceptance prompt for signed-in invitees, and a Team Settings dialog in the toolbar overflow menu for admins with collaborators, pending invitations, roles, and the access audit trail. Setup completion and invitations stay gated until the Team Admin completes workspace setup; invitation email delivery is still pending, so share the workspace URL manually with invited people.


For a local end-to-end checklist, see [Test hosted workspace administration locally](dev/hosted-workspace-local-testing.md).
### Draw.io setup

CollabMD uses diagrams.net for `.drawio` rendering and editing. By default it points at the hosted embed runtime:

```bash
COLLABMD_DRAWIO_BASE_URL=https://embed.diagrams.net
```

You can also point it at a self-hosted diagrams.net deployment:

```bash
COLLABMD_DRAWIO_BASE_URL=https://drawio.example.com
```

If the draw.io runtime is unavailable, direct `.drawio` file opens fall back to plain XML editing instead of leaving the file inaccessible.

You can also configure the tunnel via environment variables:

```bash
TUNNEL_TARGET_PORT=4000 collabmd
TUNNEL_TARGET_URL=http://127.0.0.1:4000 collabmd
CLOUDFLARED_EXTRA_ARGS="--loglevel info" collabmd
```

For the full runtime env var reference, see the `Environment variables` details block in the Development section below.

