# SQLite per hosted workspace for hosted metadata

Hosted workspace metadata will be stored in a SQLite database scoped to one single-tenant hosted workspace. This keeps membership, invitations, GitHub vault source setup, and access audit events outside the team's vault source while still preserving the operational simplicity of the single-workspace deployment model. SQLite is preferred over repository files because access control needs transactional updates and immediate revocation, and over central Postgres because the first hosted offering is not a shared multi-tenant account system.

**Considered Options**

- Repository files: easy to inspect and back up with the vault, but risks exposing access data and makes authorization depend on git state.
- Central Postgres: better for a future multi-tenant control plane, but premature for the first single-tenant hosted workspace model.
