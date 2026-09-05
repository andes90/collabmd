# GitHub-only hosted vault source setup

Single-tenant hosted workspaces will use a team-owned GitHub repository as the vault source, configured by a Team Admin in Team Settings during initial setup. GitHub is the only hosted vault source provider in the first version, access is limited to the selected vault repository, the repository default branch is captured as the configured branch during setup, and access-management data lives in hosted workspace metadata rather than in the vault source. Setup is completed through a signed, short-lived GitHub App installation callback; the server resolves the selected repository from GitHub and requires exactly one selected repository instead of trusting browser-submitted repository metadata. This improves onboarding compared with operator-provisioned SSH deploy keys while avoiding the broader scope of generic git provider support, personal tokens, or changing vault sources after a workspace is live.

**Considered Options**

- Operator-provisioned SSH deploy keys: already supported by the current deployment path, but too manual for hosted workspace onboarding.
- Generic git provider setup: broader market fit, but expands authentication, permission, branch, and credential behavior before the hosted workflow is proven.
- CollabMD-owned document storage: simpler operationally, but conflicts with the product's team-owned vault source and no-migration positioning.
