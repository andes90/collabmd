# Docker / Coolify deployment

> Operator docs. Start with the [README](../README.md) for the product overview.

Published image: `ghcr.io/andes90/collabmd:latest`

From the vault directory:

```bash
docker run --rm -p 1234:1234 -v "$PWD:/data" ghcr.io/andes90/collabmd:latest
```

Open `http://localhost:1234`. The published Docker image includes `ripgrep`, so global text search works without installing extra packages in the container.

The container listens on `0.0.0.0:1234` and stores vault files at `/data`.

### Kubernetes / Helm

CollabMD now includes a Helm chart at [`packaging/helm/collabmd`](../packaging/helm/collabmd).

Use it when you want a Kubernetes-native deployment with:

- one supported application replica
- a persistent volume mounted at `/data`
- optional ingress
- optional bundled PlantUML
- secret-backed auth and private git bootstrap settings

Quick start:

```bash
helm install collabmd ./packaging/helm/collabmd
```

For examples covering ingress, OIDC, PlantUML, and private git bootstrap, see [packaging/helm/collabmd/README.md](../packaging/helm/collabmd/README.md).

To bootstrap `/data` from a private git repository instead, pass the repo URL plus SSH credentials:

```bash
docker run \
  -p 1234:1234 \
  -v /path/to/persistent/vault:/data \
  -e COLLABMD_GIT_REPO_URL=git@github.com:your-org/your-private-vault.git \
  -e COLLABMD_GIT_SSH_PRIVATE_KEY_B64="$(base64 < ~/.ssh/id_ed25519 | tr -d '\n')" \
  -e COLLABMD_GIT_USER_NAME="CollabMD Bot" \
  -e COLLABMD_GIT_USER_EMAIL="bot@example.com" \
  ghcr.io/andes90/collabmd:latest
```

For a full local and Docker test walkthrough, including key generation and deploy-key setup, see [docs/private-git-deployment.md](private-git-deployment.md).

When `COLLABMD_GIT_REPO_URL` is set, CollabMD clones into `COLLABMD_VAULT_DIR` on first boot, then reuses that checkout on later starts. If the checkout already exists, startup validates that `origin` matches. Clean checkouts are fast-forwarded to the remote default branch; dirty checkouts are reused as-is and startup skips the sync.

On every startup, CollabMD adds `.collabmd/` to the vault's local git exclude file at `.git/info/exclude` so runtime metadata stays out of git status and bulk staging without modifying the repository's tracked `.gitignore`.

File-based secrets are also supported and take precedence over base64 input:

```bash
docker run \
  -p 1234:1234 \
  -v /path/to/persistent/vault:/data \
  -v ~/.ssh/id_ed25519:/run/secrets/collabmd_git_key:ro \
  -v ~/.ssh/known_hosts:/run/secrets/collabmd_known_hosts:ro \
  -e COLLABMD_GIT_REPO_URL=git@github.com:your-org/your-private-vault.git \
  -e COLLABMD_GIT_SSH_PRIVATE_KEY_FILE=/run/secrets/collabmd_git_key \
  -e COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE=/run/secrets/collabmd_known_hosts \
  -e COLLABMD_GIT_USER_NAME="CollabMD Bot" \
  -e COLLABMD_GIT_USER_EMAIL="bot@example.com" \
  ghcr.io/andes90/collabmd:latest
```

### Local docker-compose with private diagram renderers

The included `docker-compose.yml` runs a prebuilt CollabMD image together with local PlantUML and Structurizr containers. PlantUML SVG rendering and Structurizr `workspace.dsl` previews stay on the private Docker network automatically.

```bash
mkdir -p data/vault
docker compose up
```

Open `http://localhost:1234`.

To test Google OIDC locally with the included compose setup, register this redirect URI in Google Cloud Console:

```text
http://localhost:1234/api/auth/oidc/callback
```

Then start compose with the OIDC env vars:

```bash
AUTH_STRATEGY=oidc \
PUBLIC_BASE_URL=http://localhost:1234 \
AUTH_OIDC_CLIENT_ID=your-google-client-id \
AUTH_OIDC_CLIENT_SECRET=your-google-client-secret \
docker compose up
```

If you change `COLLABMD_HOST_PORT`, update `PUBLIC_BASE_URL` and the Google redirect URI to match that host port.

By default, compose uses `COLLABMD_IMAGE=ghcr.io/andes90/collabmd:latest`. If you want to test a local image while developing instead:

```bash
docker build -t collabmd:local .
COLLABMD_IMAGE=collabmd:local docker compose up
```

The PlantUML container is published on loopback by default at `http://127.0.0.1:18080`, and Structurizr is published at `http://127.0.0.1:19090` for host-based CLI use:

```bash
npm run start:local-plantuml

# Start CollabMD with Structurizr DSL support
npm run start:local-structurizr -- --no-tunnel
```

To use an existing vault on your machine instead of `./data/vault`:

```bash
HOST_VAULT_DIR=/absolute/path/to/vault docker compose up
```

`HOST_VAULT_DIR` controls the host-side bind mount source. The app uses `COLLABMD_VAULT_DIR` for the in-container vault path and defaults that to `/data` in Docker.

To bootstrap the compose-managed vault from a private repo, set the git env vars in `.env` and keep `HOST_VAULT_DIR` on a persistent host path. For file-based SSH auth, point `COLLABMD_GIT_SSH_PRIVATE_KEY_FILE` and `COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE` at mounted secret paths; for simpler setups, set `COLLABMD_GIT_SSH_PRIVATE_KEY_B64` instead.

If you want the in-app Git commit action to work inside the container without OIDC, also set `COLLABMD_GIT_USER_NAME` and `COLLABMD_GIT_USER_EMAIL` so CollabMD can configure the checkout identity automatically. With `AUTH_STRATEGY=oidc`, CollabMD uses the signed-in Google identity for each commit instead.

To change the host port:

```bash
COLLABMD_HOST_PORT=3000 docker compose up
```

To change the local PlantUML host port used by both `docker compose` and `--local-plantuml`:

```bash
PLANTUML_HOST_PORT=18081 npm run start:local-plantuml
```

Recommended Coolify setup:

1. Use the included `Dockerfile`.
2. Expose port `1234`.
3. Mount a persistent volume to `/data` for the vault checkout and runtime files. It can be pre-populated with markdown files or start empty when `COLLABMD_GIT_REPO_URL` is enabled.
4. Add `COLLABMD_GIT_REPO_URL` plus either `COLLABMD_GIT_SSH_PRIVATE_KEY_FILE` or `COLLABMD_GIT_SSH_PRIVATE_KEY_B64` if the vault should be cloned from a private repo.
5. Mount `known_hosts` and set `COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE` if you want strict host verification.
6. Add a health check for `GET /health` with enough startup grace for the initial clone.
7. Run a single replica only because room state is in-process and not shared across instances.
8. Set `BASE_PATH` if the app is mounted under a subpath such as `/collabmd`.
9. Set `PUBLIC_WS_BASE_URL` only if your WebSocket endpoint differs from the app origin.

For a standard Coolify reverse-proxy setup, the default same-origin WebSocket routing works as-is and you should not need `PUBLIC_WS_BASE_URL`.

Health check: `GET /health`

