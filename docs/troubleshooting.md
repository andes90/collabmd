# Troubleshooting

> Operator docs. Start with the [README](../README.md) for the product overview.

- `npx collabmd@latest` fails immediately: confirm you are running Node.js 26, which is the supported runtime for source and npm usage
- The app is reachable only from localhost: pass `--host 0.0.0.0` or set `HOST=0.0.0.0` when you intend to expose it on your network
- Port `1234` is already in use: pass `--port 3000` or set `PORT` to another free port
- Tunnel did not start: install `cloudflared`, or pass `--no-tunnel` to stay local-only
- `--auth oidc` fails on startup: set `PUBLIC_BASE_URL`, `AUTH_OIDC_CLIENT_ID`, and `AUTH_OIDC_CLIENT_SECRET`, and make sure the Google redirect URI matches `/api/auth/oidc/callback`
- Google login loops back to the auth screen: verify the configured `PUBLIC_BASE_URL` matches the browser URL and that your reverse proxy forwards HTTPS correctly
- `--local-plantuml` fails: make sure Docker is installed and running, or point `PLANTUML_SERVER_URL` at another PlantUML server
- Global text search is disabled: install `ripgrep` on the server host and restart CollabMD. Docker images already include `ripgrep`.
- Private git bootstrap fails on startup: verify `COLLABMD_GIT_REPO_URL` plus either `COLLABMD_GIT_SSH_PRIVATE_KEY_FILE` or `COLLABMD_GIT_SSH_PRIVATE_KEY_B64`
- WSL2 path issues: run CollabMD against a directory inside your Linux filesystem when possible rather than a mounted Windows path

