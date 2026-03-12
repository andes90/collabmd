# Private Git Deployment Guide

Use this guide when you want CollabMD to bootstrap its vault from a private git repository instead of a pre-mounted local folder.

CollabMD supports two SSH secret inputs:

- `COLLABMD_GIT_SSH_PRIVATE_KEY_FILE`: preferred when you can mount a secret file
- `COLLABMD_GIT_SSH_PRIVATE_KEY_B64`: convenient for env-based deployments and local testing

`COLLABMD_GIT_SSH_PRIVATE_KEY_FILE` takes precedence if both are set.

## What startup does

When `COLLABMD_GIT_REPO_URL` is set, CollabMD uses `COLLABMD_VAULT_DIR` as a persistent checkout directory:

- If the directory is missing or empty, it clones the repo there.
- If the directory already contains the same repo and the working tree is clean, it fast-forwards the remote default branch.
- If the directory already contains the same repo but the working tree is dirty, startup reuses the checkout as-is and skips the sync.
- If the directory points at a different remote, startup fails instead of trying to reconcile it.
- After clone or validation, CollabMD adds `.collabmd/` to `.git/info/exclude` for that checkout so local runtime metadata is ignored without editing the repo's tracked `.gitignore`.

## 1. Generate a dedicated SSH key

Use a dedicated deploy key for CollabMD rather than your personal SSH key.

```bash
mkdir -p ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/collabmd-test -C "collabmd-test" -N ""
```

This creates:

- `~/.ssh/collabmd-test`
- `~/.ssh/collabmd-test.pub`

## 2. Add the public key to the private repo

For GitHub:

1. Open the private repository.
2. Go to `Settings` -> `Deploy keys`.
3. Click `Add deploy key`.
4. Paste the public key:

```bash
cat ~/.ssh/collabmd-test.pub
```

5. Enable `Allow write access` if you want to test in-app `push`.

Read-only deploy keys are enough for clone and pull.

## 3. Create a `known_hosts` file

For GitHub:

```bash
ssh-keyscan github.com > ~/.ssh/collabmd_known_hosts
chmod 644 ~/.ssh/collabmd_known_hosts
```

If you use GitLab or another SSH host, replace `github.com`.

## 4. Set git author identity for commit tests

If you also want to test commit and push from the CollabMD UI:

```bash
export GIT_AUTHOR_NAME="CollabMD Test"
export GIT_AUTHOR_EMAIL="you@example.com"
export GIT_COMMITTER_NAME="CollabMD Test"
export GIT_COMMITTER_EMAIL="you@example.com"
```

## 5. Test locally with the CLI first

Testing the CLI path first is simpler than starting with Docker because startup errors are easier to inspect.

Build CollabMD:

```bash
cd /Users/andes/Documents/andes/collabmd
npm install
npm run build
```

Pick an empty or non-existent checkout path and export the git settings:

```bash
export COLLABMD_GIT_REPO_URL="git@github.com:YOUR_ORG/YOUR_PRIVATE_REPO.git"
export COLLABMD_GIT_SSH_PRIVATE_KEY_FILE="$HOME/.ssh/collabmd-test"
export COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE="$HOME/.ssh/collabmd_known_hosts"
```

Start the app:

```bash
node bin/collabmd.js /tmp/collabmd-git-test --no-tunnel
```

Expected result:

- CollabMD clones the repo into `/tmp/collabmd-git-test`
- the server starts normally
- the served vault is the cloned checkout

Verify the checkout:

```bash
ls -la /tmp/collabmd-git-test
git -C /tmp/collabmd-git-test remote -v
git -C /tmp/collabmd-git-test status
```

## 6. Test restart behavior

Stop the app and start it again with the same directory:

```bash
node bin/collabmd.js /tmp/collabmd-git-test --no-tunnel
```

Expected result:

- startup reuses the checkout
- verifies `origin`
- fast-forwards the remote default branch when the checkout is clean
- skips the sync and starts anyway when the checkout has local changes

## 7. Test pull-on-startup

Create a second clone, push a change there, then restart CollabMD:

```bash
git clone git@github.com:YOUR_ORG/YOUR_PRIVATE_REPO.git /tmp/collabmd-peer
cd /tmp/collabmd-peer
git config user.name "Peer Test"
git config user.email "peer@example.com"

echo "" >> README.md
echo "pull test" >> README.md
git add README.md
git commit -m "Test remote update"
git push
```

Restart CollabMD against the original checkout path. The new commit should be present after startup.

## 8. Test commit and push from the UI

In the running app:

1. Edit a file.
2. Stage it in the Git panel.
3. Commit it.
4. Push it.

Verify from another shell:

```bash
git -C /tmp/collabmd-git-test log --oneline -n 3
git -C /tmp/collabmd-git-test status
```

If push fails, the most common cause is a read-only deploy key.

## 9. Test base64 key input

Unset the file-based secret and provide the private key as base64:

```bash
export COLLABMD_GIT_SSH_PRIVATE_KEY_B64="$(base64 < ~/.ssh/collabmd-test | tr -d '\n')"
unset COLLABMD_GIT_SSH_PRIVATE_KEY_FILE
```

Then start a fresh checkout:

```bash
node bin/collabmd.js /tmp/collabmd-git-test-b64 --no-tunnel
```

This exercises the temp-file path CollabMD creates from the base64 secret.

## 10. Test with Docker

Build the local image:

```bash
cd /Users/andes/Documents/andes/collabmd
docker build -t collabmd:local .
```

Run with file-based SSH auth:

```bash
docker run --rm \
  -p 1234:1234 \
  -v /tmp/collabmd-docker-test:/data \
  -v "$HOME/.ssh/collabmd-test:/run/secrets/collabmd_git_key:ro" \
  -v "$HOME/.ssh/collabmd_known_hosts:/run/secrets/collabmd_known_hosts:ro" \
  -e COLLABMD_GIT_REPO_URL="git@github.com:YOUR_ORG/YOUR_PRIVATE_REPO.git" \
  -e COLLABMD_GIT_SSH_PRIVATE_KEY_FILE=/run/secrets/collabmd_git_key \
  -e COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE=/run/secrets/collabmd_known_hosts \
  -e GIT_AUTHOR_NAME="CollabMD Test" \
  -e GIT_AUTHOR_EMAIL="you@example.com" \
  -e GIT_COMMITTER_NAME="CollabMD Test" \
  -e GIT_COMMITTER_EMAIL="you@example.com" \
  collabmd:local
```

Run with base64 SSH auth:

```bash
docker run --rm \
  -p 1234:1234 \
  -v /tmp/collabmd-docker-test-b64:/data \
  -v "$HOME/.ssh/collabmd_known_hosts:/run/secrets/collabmd_known_hosts:ro" \
  -e COLLABMD_GIT_REPO_URL="git@github.com:YOUR_ORG/YOUR_PRIVATE_REPO.git" \
  -e COLLABMD_GIT_SSH_PRIVATE_KEY_B64="$(base64 < ~/.ssh/collabmd-test | tr -d '\n')" \
  -e COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE=/run/secrets/collabmd_known_hosts \
  -e GIT_AUTHOR_NAME="CollabMD Test" \
  -e GIT_AUTHOR_EMAIL="you@example.com" \
  -e GIT_COMMITTER_NAME="CollabMD Test" \
  -e GIT_COMMITTER_EMAIL="you@example.com" \
  collabmd:local
```

Open [http://localhost:1234](http://localhost:1234).

## 11. Common failure cases

Dirty checkout:

```bash
echo "dirty" >> /tmp/collabmd-git-test/README.md
node bin/collabmd.js /tmp/collabmd-git-test --no-tunnel
```

Wrong remote:

```bash
git -C /tmp/collabmd-git-test remote set-url origin git@github.com:someone/other-repo.git
node bin/collabmd.js /tmp/collabmd-git-test --no-tunnel
```

Read-only deploy key:

- clone works
- pull works
- push fails from the UI or git API

Missing host verification:

- if `COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE` is not set, CollabMD falls back to `StrictHostKeyChecking=accept-new`
- for tighter control in production, mount a `known_hosts` file and set the env var explicitly

## 12. Cleanup

```bash
rm -rf /tmp/collabmd-git-test /tmp/collabmd-git-test-b64 /tmp/collabmd-docker-test /tmp/collabmd-docker-test-b64 /tmp/collabmd-peer
rm -f ~/.ssh/collabmd-test ~/.ssh/collabmd-test.pub ~/.ssh/collabmd_known_hosts
```
