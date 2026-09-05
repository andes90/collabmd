# Single-tenant hosted workspaces with invite-based membership

CollabMD's first hosted offering will be a manually provisioned single-tenant hosted workspace: one deployed app replica for one team, one vault source, and one hosted metadata store, not a multi-tenant application account system where unrelated customers create many workspaces inside one shared product surface. The intended first admin uses an email-bound one-time workspace claim flow with Google authentication to become the initial Team Admin, and later access is managed through email-bound Google invitations, active team membership, and the invariant that every team must keep at least one Team Admin. This keeps hosted CollabMD close to the existing one-vault workspace model while adding the minimum user-management layer needed for a team-operated hosted product.

**Considered Options**

- Use domain/email allowlists only: simpler and close to the current OIDC implementation, but too weak for the desired admin-managed team workflow.
- Build full multi-tenant SaaS accounts: more flexible long term, but premature for the filesystem-first product model and substantially harder to reverse.
