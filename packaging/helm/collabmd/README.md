# CollabMD Helm Chart

This chart deploys CollabMD as a single-replica Kubernetes application with persistent `/data` storage.

Important constraints:

- Run exactly one replica. CollabMD keeps collaboration room state in-process and does not support horizontal scaling.
- Persist `/data`. CollabMD stores both vault content and runtime sidecar state under the vault root, including `.collabmd/`.

## Prerequisites

- Kubernetes cluster
- Helm 3.17+
- A storage class or an existing PVC if you want persistent vault data

## Quick Start

```bash
helm install collabmd ./packaging/helm/collabmd
```

This installs:

- one CollabMD `Deployment`
- one `ClusterIP` service on port `1234`
- one PVC mounted at `/data`

## Use An Existing PVC

```bash
helm install collabmd ./packaging/helm/collabmd \
  --set persistence.existingClaim=collabmd-data
```

## Expose Through Ingress

If you run behind an ingress controller, set a stable public URL and matching ingress host/path:

```bash
helm install collabmd ./packaging/helm/collabmd \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.hosts[0].host=notes.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix \
  --set config.publicBaseUrl=https://notes.example.com
```

If you publish under a path prefix, also set `config.basePath` and match the ingress path.

## Password Auth

Quick start with inline values:

```bash
helm install collabmd ./packaging/helm/collabmd \
  --set auth.strategy=password \
  --set auth.password.value='change-me' \
  --set auth.sessionSecret.value='replace-with-a-long-random-secret'
```

Production-style existing secret:

```bash
kubectl create secret generic collabmd-auth \
  --from-literal=AUTH_PASSWORD='change-me' \
  --from-literal=AUTH_SESSION_SECRET='replace-with-a-long-random-secret'

helm install collabmd ./packaging/helm/collabmd \
  --set auth.strategy=password \
  --set auth.password.existingSecret=collabmd-auth \
  --set auth.sessionSecret.existingSecret=collabmd-auth
```

## Google OIDC

OIDC requires a stable public URL. Quick start:

```bash
helm install collabmd ./packaging/helm/collabmd \
  --set auth.strategy=oidc \
  --set config.publicBaseUrl=https://notes.example.com \
  --set auth.oidc.clientId='your-google-client-id' \
  --set auth.oidc.clientSecret='your-google-client-secret' \
  --set auth.sessionSecret.value='replace-with-a-long-random-secret'
```

Optional allowlists:

```bash
helm upgrade --install collabmd ./packaging/helm/collabmd \
  --set auth.strategy=oidc \
  --set config.publicBaseUrl=https://notes.example.com \
  --set auth.oidc.allowedDomains=example.com \
  --set auth.oidc.allowedEmails=alice@example.com,bob@example.com
```

## Bundled PlantUML

By default CollabMD uses the external public PlantUML renderer. To deploy an in-cluster PlantUML service with the same Helm release:

```bash
helm install collabmd ./packaging/helm/collabmd \
  --set plantuml.enabled=true
```

When enabled, the chart rewires `PLANTUML_SERVER_URL` to the in-cluster PlantUML service automatically.

## Private Git Bootstrap

### Base64 SSH Key

```bash
helm install collabmd ./packaging/helm/collabmd \
  --set git.repoUrl=git@github.com:your-org/your-private-vault.git \
  --set git.userName='CollabMD Bot' \
  --set git.userEmail='bot@example.com' \
  --set git.ssh.privateKeyBase64="$(base64 < ~/.ssh/id_ed25519 | tr -d '\n')"
```

### File-Mounted SSH Key And `known_hosts`

```bash
kubectl create secret generic collabmd-git-key \
  --from-file=id_ed25519=$HOME/.ssh/id_ed25519

kubectl create secret generic collabmd-known-hosts \
  --from-file=known_hosts=$HOME/.ssh/known_hosts

helm install collabmd ./packaging/helm/collabmd \
  --set git.repoUrl=git@github.com:your-org/your-private-vault.git \
  --set git.userName='CollabMD Bot' \
  --set git.userEmail='bot@example.com' \
  --set git.ssh.privateKeyFileSecret=collabmd-git-key \
  --set git.ssh.knownHostsSecret=collabmd-known-hosts
```

When file-mounted SSH auth is configured, the chart exports:

- `COLLABMD_GIT_SSH_PRIVATE_KEY_FILE`
- `COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE`

That path takes precedence over `COLLABMD_GIT_SSH_PRIVATE_KEY_B64`, matching the application behavior.

## Validation

Useful local checks:

```bash
helm lint ./packaging/helm/collabmd
helm template test ./packaging/helm/collabmd
helm template test ./packaging/helm/collabmd --set ingress.enabled=true --set ingress.hosts[0].host=notes.example.com --set ingress.hosts[0].paths[0].path=/ --set ingress.hosts[0].paths[0].pathType=Prefix
helm template test ./packaging/helm/collabmd --set plantuml.enabled=true
```

## Values Overview

The chart exposes these main value groups:

- `image`
- `serviceAccount`
- `service`
- `ingress`
- `resources`
- `persistence`
- `config`
- `auth`
- `git`
- `plantuml`
- `networkPolicy`
- `tests`
