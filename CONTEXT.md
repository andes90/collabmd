# CollabMD

CollabMD turns a local markdown-and-diagram folder into a collaborative browser workspace while keeping plain files as the enduring user-facing model.

## Language

**Vault**:
A regular folder containing markdown, diagram, and related workspace files. The vault is the user-visible body of content that CollabMD serves.
_Avoid_: Account, tenant, database

**Vault Source**:
The durable place a **Team** considers its **Vault** to live. For a single-tenant hosted workspace, the vault source is the team's GitHub repository rather than CollabMD-owned document storage; private, public, and empty repositories can be valid vault sources.
_Avoid_: Database, app storage, CollabMD storage

**Vault Content**:
The durable user-facing files inside a **Vault**, including markdown files, Base files, diagrams, and attachments. Vault content excludes **Hosted Workspace Metadata**, invitations, access audit events, and collaboration sidecars such as comments or editor snapshots.
_Avoid_: Hosted metadata, sidecar data, repository metadata

**Editable Vault Content**:
The subset of **Vault Content** that CollabMD reads and writes as editor text, including markdown files, Base files, Excalidraw JSON, draw.io XML, Mermaid diagrams, and PlantUML diagrams. Attachments are **Vault Content** but not editable vault content.
_Avoid_: Attachment, binary content, sidecar data

**Open-only File Session**:
A collaborator's interaction with **Editable Vault Content** where they open, view, navigate, or switch away without making an intentional content change. An open-only file session preserves **Vault Content** bytes exactly and is distinct from a **Vault Mutation**; related **Collaboration Sidecars** may still exist outside **Vault Content**.
_Avoid_: Edit, autosave, no-op write, format-on-open

**Diagram Chrome**:
The shared browser interaction surface around rendered Mermaid and PlantUML diagrams, including toolbar controls, zooming, fitting, native scrolling, maximizing, restoring, copying, downloading, resize handling, and preservation across preview render commits. Diagram Chrome excludes the diagram rendering implementation itself; Mermaid and PlantUML rendering remain separate diagram adapters.
_Avoid_: Diagram renderer, preview compiler, diagram source

**Vault Mutation**:
An intentional CollabMD command that changes **Vault Content**, such as creating, writing, renaming, deleting, or uploading an attachment. A vault mutation is distinct from observing that the vault changed outside CollabMD.
_Avoid_: Filesystem event, sync event, Git publish

**Editable Content Save**:
A **Vault Mutation** that records an intentional collaborator edit to **Editable Vault Content**. Editable content saves write canonical editor text with LF line endings, while opening, hydration, initial sync, cursor movement, selection changes, scrolling, presence updates, comments, and **Collaboration Sidecar** persistence do not cause editable content saves.
_Avoid_: Autosave, open, preview render, sidecar persistence, presence update

**Vault Change Observation**:
An observed change to **Vault Content** or directories after an external process changes the **Vault**, such as filesystem watcher activity or a Git operation that updates the working tree. A vault change observation is reconciled into **Workspace State**, but it is not itself a **Vault Mutation**.
_Avoid_: Vault mutation, user command, published change

**External Content Reconciliation**:
The live-room handling of a **Vault Change Observation** for **Editable Vault Content**. External content reconciliation updates the collaborative view of the file but does not create an **Editable Content Save** unless a collaborator later makes an intentional content edit.
_Avoid_: Editable content save, autosave, collaborator edit

**Git Working Tree Observation**:
A **Vault Change Observation** produced after a Git command changes the workspace working tree, such as pull or reset-file. Git command rules stay in Git modules; only the resulting working-tree change is reconciled into **Workspace State**.
_Avoid_: Vault mutation, published change, Git command

**Collaboration Sidecar**:
Durable collaboration data stored beside **Vault Content**, such as comment threads or editor snapshots. A collaboration sidecar is not **Vault Content**, may be persisted without causing a **Vault Mutation**, and its lifecycle follows the Vault path it belongs to.
_Avoid_: Vault content, hosted metadata, workspace state

**Open Comment Thread**:
A current unresolved discussion attached to a location in **Editable Vault Content**. An open comment thread belongs to the **Collaboration Sidecar** for one Vault path and is visible to collaborators until it is resolved.
_Avoid_: Vault content, comment history, notification

**Comment Overview**:
A workspace-wide view of **Open Comment Threads** grouped by Vault path. The comment overview helps collaborators find existing discussions but does not imply unread state, personal notification delivery, mentions, or alerting.
_Avoid_: Notification inbox, unread comments, mentions

**Workspace Reconciliation**:
The process of turning a **Vault Mutation** or **Vault Change Observation** into updated **Workspace State**, aligned **Collaboration Sidecars**, refreshed indexes, collaboration room effects, and workspace events. Workspace reconciliation owns when downstream indexes run, while Backlink and Base internals remain separate modules.
_Avoid_: Filesystem sync, autosave, published change

**Vault Mutation Method**:
A precise operation on the Workspace Reconciliation module for one kind of **Vault Mutation**, such as writing editable content, uploading an attachment, or renaming a directory. Vault mutation methods are explicit rather than a single generic command bag, because each mutation kind has different invariants and result data.
_Avoid_: Generic mutation command, arbitrary payload, filesystem event

**GitHub Vault Source Setup**:
The in-app Team Settings flow where a Team Admin connects one selected GitHub repository and branch as the **Vault Source** for a **Single-tenant hosted workspace** during initial setup. GitHub is the only supported hosted vault source provider in the first hosted version, repository access is limited to the selected vault repository, and changing the vault source later is outside the first version. Setup uses a signed, short-lived GitHub App installation callback; the browser does not directly submit arbitrary repository or installation metadata.
_Avoid_: SSH deploy key setup, personal token setup, generic git provider setup

**Configured Branch**:
The default branch of the team's selected GitHub **Vault Source** captured during setup and used by the hosted workspace for reading and publishing. In the first hosted version, published changes go directly to this branch rather than through review branches or pull requests.
_Avoid_: PR branch, review branch, draft branch

**Workspace Git Credential**:
The workspace-level credential used by a **Single-tenant hosted workspace** to read from and publish changes to the team's **Vault Source**. It is separate from the collaborator identity shown on published changes.
_Avoid_: User git token, personal GitHub login, collaborator credential

**Published Change**:
A workspace change that a **Collaborator** has intentionally recorded back to the team's **Vault Source**. Hosted workspace edits are not considered published merely because they are visible in the live workspace; publishing is not limited to Team Admins.
_Avoid_: Autosave, sync, background publish

**Commit Author**:
The collaborator identity recorded on a git commit when the commit is created. Pushing a commit later does not change its commit author.
_Avoid_: Publisher, pusher, git credential

**Publisher**:
A **Collaborator** who pushes existing commits from the hosted workspace back to the team's **Vault Source**. The publisher may differ from the commit author, and publishing does not rewrite commit authorship.
_Avoid_: Commit author, owner, deploy key

**Workspace**:
The collaborative browser experience over exactly one **Vault**. A workspace is what collaborators open, edit, discuss, and navigate together.
_Avoid_: Site, app instance, tenant

**Workspace State**:
The server-maintained current view of a **Workspace**'s **Vault** tree and file metadata, used to update collaborators, indexes, and query modules. Workspace state is derived from **Vault Content** and directories; it is not itself durable **Vault Content** and excludes comments, editor snapshots, and other collaboration sidecars.
_Avoid_: Vault content, sidecar data, editor snapshot

**Workspace Setup**:
The initial state of a **Single-tenant hosted workspace** before its **Vault Source** has been connected. The first Team Admin can access workspace setup, but invitation creation and the collaborative editor are not available until setup is complete; non-admin access during setup sees only that setup is incomplete.
_Avoid_: Onboarding, signup, empty workspace

**Workspace Claim**:
The one-time first-admin claim flow for a manually provisioned **Single-tenant hosted workspace**. The intended first Team Admin must authenticate with the verified Google email bound to the workspace claim before becoming the initial Team Admin; workspace claims expire after 7 days.
_Avoid_: Public signup, first user wins, invitation

**Workspace Unavailable**:
A hosted workspace state where the connected **Vault Source** cannot be reached or authorized. The editor is blocked rather than read-only, and publishing is unavailable, but Team Settings remain available to Team Admins with a high-level reason and recovery guidance; regular collaborators see only that the workspace is unavailable. Already-saved unpublished workspace changes are preserved.
_Avoid_: Offline mode, read-only mode, stale checkout

**Workspace Recovery View**:
A Team Admin view shown during **Workspace Unavailable** that exposes preserved unpublished change status and diffs. It exists to help admins understand recovery risk, not to continue normal editing.
_Avoid_: Editor, read-only workspace, backup browser

**Team**:
The customer group that owns exactly one **Single-tenant hosted workspace**. A team contains the collaborators who are allowed to work together in that workspace.
_Avoid_: Organization, account, tenant

**Team Name**:
The display label for a **Team** in the hosted workspace UI and invitation emails. Changing the team name does not change the workspace URL, deployment identity, or vault source.
_Avoid_: Workspace URL, tenant slug, repository name

**Team Membership**:
The relationship that gives a person a role in a **Team** and access to that team's **Workspace**. Team membership starts when an invited person accepts with the matching verified Google identity; Team Admins may change a collaborator's role while preserving at least one Team Admin. Leaving or removing membership immediately ends that person's workspace access and active collaboration presence; rejoining requires a new invitation. Restored membership still requires authentication with the matching verified Google identity.
_Avoid_: Subscription, login session, seat

**Historical Attribution**:
The preserved identity attached to past workspace activity, such as comments, chat messages, audit events, and commit authorship. Removing team membership does not erase historical attribution.
_Avoid_: Active membership, current access, presence

**Collaborator**:
A person who belongs to a **Team** and can access and edit that team's **Workspace**. Collaborators are added through workspace invitations rather than by open domain access alone.
_Avoid_: User, team member, account

**Agent Connection**:
An authorization that lets one named external AI agent client access a **Workspace** with explicit scopes and expiry. In a **Single-tenant hosted workspace**, a **Collaborator** grants the connection and the agent acts on that collaborator's behalf; losing team membership ends access. In password-protected **Self-hosted CollabMD**, Agent Connections have workspace-level attribution. A no-auth self-hosted workspace does not create Agent Connections: MCP follows the workspace's anonymous access policy. Revocation or expiry always ends managed access, and agent-origin metadata remains distinct from any human attribution.
_Avoid_: Agent membership, service account, anonymous managed token

**Team Admin**:
A **Collaborator** who can manage workspace access for the **Team**, including inviting collaborators, removing collaborators, and changing roles. During **Workspace Claim**, the first authenticated claimant becomes the initial Team Admin; after that, the team must always have at least one Team Admin.
_Avoid_: Owner, super admin, host user

**Invitation**:
A pending request, delivered by email, for a person with a specific email address to become a **Collaborator** or **Team Admin** in a **Team**. The invitation link alone does not grant access; the invited person joins with the invitation's current role only after signing in with a verified Google identity matching that email address. Pending invitations expire after 7 days, may have their role changed, and may be revoked by a Team Admin.
_Avoid_: Signup link, share link, guest pass

**Pending Invitation**:
An **Invitation** that has not yet been accepted, expired, or revoked. A pending invitation is not a team membership.
_Avoid_: Member, collaborator, active invite

**Access State**:
The current access relationship between one email address and a **Team**: pending invitation, active team membership, or no access. A person cannot have duplicate access states for the same team.
_Avoid_: User status, auth state, account state

**Access Audit Trail**:
A record of hosted workspace events for a **Team**, such as successful workspace claim, invitations, acceptances, revocations, removals, self-service leaves, role changes, **Agent Connection** grants and revocations, and publish actions. It is visible to Team Admins, does not include ordinary sign-ins, sign-outs, Vault Content reads, or editable content saves, is retained indefinitely in the first version, and does not replace published change history in the team's vault source.
_Avoid_: Git history, activity feed, edit log

**Operational Security Event**:
A hosted workspace security event visible to operators rather than Team Admins, such as a failed workspace claim before the team exists. Operational security events are separate from the Team-facing access audit trail.
_Avoid_: Access audit event, team activity, git history

**Operational Health**:
Operator-facing status for a hosted workspace deployment, covering whether authentication, hosted metadata, vault source access, checkout state, and collaboration basics are healthy. Public liveness may be shallow, but detailed operational health is not public; operational health is separate from Team Settings and user-facing workspace state.
_Avoid_: Team Settings, access audit trail, workspace content

**Hosted Workspace Metadata**:
Operational information for a **Single-tenant hosted workspace**, such as team membership, invitations, GitHub vault source setup, and the access audit trail. Hosted workspace metadata is separate from the team's **Vault Source** and is backed up as workspace operational state rather than vault content.
_Avoid_: Vault content, repository file, documentation

**Team Settings**:
The in-workspace area where Team Admins manage collaborators, pending invitations, roles, and access history for their **Team**. It shows active collaborators and pending invitations in one access-management surface.
_Avoid_: Admin console, operator config, control plane

**Single-tenant hosted workspace**:
A hosted CollabMD workspace dedicated to one **Team**, backed by one **Vault**. In the first version, one deployed CollabMD app replica equals one single-tenant hosted workspace, one team, one vault source, and one hosted metadata store; it is manually provisioned and is not a shared multi-tenant product where unrelated customers create workspaces inside one common application account system.
_Avoid_: SaaS, tenant, organization

**Self-hosted CollabMD**:
A CollabMD workspace operated by the person or team using it, outside the hosted workspace offering. Self-hosted CollabMD may use local-only access, shared password access, or externally configured identity access.
_Avoid_: Hosted workspace, SaaS

**Hosted Workspace Access**:
Access to a **Single-tenant hosted workspace** through a verified Google identity and active **Team Membership**. Shared password access is not part of hosted workspace access, and GitHub repository visibility does not determine workspace access.
_Avoid_: Host password, shared secret, public link

**Authentication**:
The act of proving a person's verified Google identity to CollabMD. Authentication does not itself grant hosted workspace access without active **Team Membership**.
_Avoid_: Membership, authorization, invitation

**Membership Authorization**:
The hosted workspace decision that an authenticated person may access a **Team** because they have active **Team Membership**. Membership authorization is separate from authentication and is re-checked for active API and WebSocket access.
_Avoid_: Login, Google sign-in, auth strategy

**GitHub Repository Access**:
Access a person has directly in GitHub to the team's **Vault Source**. GitHub repository access does not create CollabMD **Team Membership**, and CollabMD membership changes do not manage a person's GitHub repository permissions.
_Avoid_: Hosted workspace access, collaborator, invitation

## Flagged Ambiguities

**SaaS**:
Resolved to mean **Single-tenant hosted workspace** for the first hosted offering, not a multi-tenant application account system.

**Billing**:
Billing, seat limits, invoices, subscriptions, and plans are outside the first hosted workspace design.

**Hosted Metadata Export**:
User-facing export of hosted workspace metadata is outside the first hosted workspace design; backups remain operational state.

**Workspace URL Customization**:
Team Admin customization of the workspace URL or slug is outside the first hosted workspace design; the URL is provisioning-owned.

## Example Dialogue

Developer: "For the first hosted offering, is each customer getting one workspace?"

Domain expert: "Yes. A single-tenant hosted workspace means one deployed app replica for one team, one collaborative workspace, one vault source, and one hosted metadata store."

Developer: "Can one hosted workspace run multiple app replicas?"

Domain expert: "No. The first hosted version runs one app replica per workspace."

Developer: "Can teams create hosted workspaces through public signup?"

Domain expert: "No. The first version uses manual provisioning; the first Team Admin receives the workspace URL and completes setup."

Developer: "So we should not model unrelated customers sharing one application-level tenant system yet?"

Domain expert: "Correct. Keep the product language focused on hosted workspaces and vaults."

Developer: "Who is the customer for a hosted workspace?"

Domain expert: "A team. The team owns one hosted workspace, and its collaborators work together inside that workspace."

Developer: "Can the Team Admin change the team name?"

Domain expert: "Yes. The team name is a display label only and does not change the workspace URL, deployment identity, or vault source."

Developer: "How do collaborators get access?"

Domain expert: "They are invited into the team, rather than joining only because their email domain is allowed."

Developer: "Who creates the first admin?"

Domain expert: "The intended first admin uses the one-time workspace claim flow, authenticates with Google, and becomes the initial Team Admin."

Developer: "Can anyone with the claim link become the first admin?"

Domain expert: "No. The workspace claim is bound to the intended first admin's verified Google email."

Developer: "Can workspace claims linger forever?"

Domain expert: "No. Workspace claims expire after 7 days."

Developer: "What proves an invited person is the right person?"

Domain expert: "The invitation names an email address, and the person must sign in with a verified Google identity for that same email."

Developer: "Do we need viewer, commenter, or editor roles?"

Domain expert: "No. In the first version, Team Admin and Collaborator are the only roles, and Collaborator implies edit access."

Developer: "Can Team Admins change roles after someone joins?"

Domain expert: "Yes. They can promote or demote collaborators as long as at least one Team Admin remains."

Developer: "Can collaborators leave the team themselves?"

Domain expert: "Yes, as long as a Team Admin leaving does not leave the team with zero Team Admins."

Developer: "Can someone rejoin after leaving without a new invitation?"

Domain expert: "No. Rejoining after leaving or removal requires a new invitation."

Developer: "What happens when a collaborator is removed?"

Domain expert: "Their team membership ends, and workspace access should be revoked immediately rather than waiting for their login session to expire."

Developer: "Do removed collaborators stay visible in live presence?"

Domain expert: "No. Their active collaboration connections close, and presence updates like a normal disconnect."

Developer: "Does removing a collaborator erase their past activity?"

Domain expert: "No. Comments, chat messages, audit events, and commit authorship keep historical attribution."

Developer: "Can the last Team Admin remove or demote themselves?"

Domain expert: "No. A team must always have at least one Team Admin."

Developer: "Can collaborators use a shared password to enter a hosted workspace?"

Domain expert: "No. Hosted workspace access requires Google sign-in and active team membership; shared passwords belong to local or self-hosted use."

Developer: "Does Google sign-in alone grant hosted workspace access?"

Domain expert: "No. Google sign-in authenticates identity; active team membership authorizes workspace access."

Developer: "Can an old login session keep access after membership changes?"

Domain expert: "No. Active API and WebSocket access re-checks current team membership and role."

Developer: "Is self-hosting still supported?"

Domain expert: "Yes. Self-hosted CollabMD remains a separate product mode with its own access options."

Developer: "Who owns the durable vault content in hosted mode?"

Domain expert: "The team owns it in their git repository. CollabMD hosts a workspace over that vault source rather than becoming the permanent document store."

Developer: "Does hosted publishing create pull requests?"

Domain expert: "No. In the first version, published changes go directly to the configured branch."

Developer: "Who configures the hosted vault source?"

Domain expert: "A Team Admin configures it in Team Settings through a GitHub-only setup flow for the first hosted version."

Developer: "Can collaborators use the editor before GitHub is connected?"

Domain expert: "No. The workspace is in setup until its vault source is connected."

Developer: "Can the Team Admin invite collaborators during workspace setup?"

Domain expert: "No. Invitations start only after the vault source is connected and setup is complete."

Developer: "What if a non-admin reaches the workspace during setup?"

Domain expert: "They see only that workspace setup is incomplete and do not receive setup controls."

Developer: "What if the connected GitHub repo becomes unavailable?"

Domain expert: "The workspace becomes unavailable for editing and publishing, while Team Settings remain available to Team Admins."

Developer: "Who sees details when a workspace is unavailable?"

Domain expert: "Team Admins see a high-level reason and recovery guidance; regular collaborators see only that the workspace is unavailable."

Developer: "Can collaborators keep reading from a stale checkout?"

Domain expert: "No. The editor is blocked rather than offered as a read-only stale view."

Developer: "Are unpublished workspace changes discarded during source unavailability?"

Domain expert: "No. Already-saved unpublished changes are preserved until the vault source is healthy again."

Developer: "Can Team Admins inspect preserved unpublished changes during unavailability?"

Domain expert: "Yes. A recovery view should show unpublished change status and diffs without reopening normal editing."

Developer: "How broad is the GitHub access?"

Domain expert: "It is limited to the selected vault repository rather than broad account or organization access."

Developer: "Which branch does the hosted workspace use?"

Domain expert: "The hosted workspace uses the selected GitHub repository's default branch."

Developer: "If GitHub's default branch changes later, does CollabMD switch automatically?"

Domain expert: "No. The configured branch is captured during setup and changes only through explicit workspace reconfiguration."

Developer: "Can a Team Admin change the vault source after setup?"

Domain expert: "Not in the first version. The Team Admin connects the vault source during initial setup only."

Developer: "Can the vault source start empty?"

Domain expert: "Yes. An empty selected repository can be a valid vault source."

Developer: "Do public and private repositories work differently for workspace access?"

Domain expert: "No. Repository visibility does not determine CollabMD workspace access; team membership does."

Developer: "Do GitHub repository collaborators automatically enter CollabMD?"

Domain expert: "No. GitHub repository access and CollabMD team membership are separate."

Developer: "Does removing someone from CollabMD remove their GitHub repository access?"

Domain expert: "No. CollabMD manages hosted workspace membership only, not GitHub repository permissions."

Developer: "Do hosted edits publish automatically?"

Domain expert: "No. Edits are saved in the workspace, but publishing back to the team's vault source is an intentional collaborator action."

Developer: "If someone only opens a CRLF markdown file and switches away, should CollabMD convert it to LF?"

Domain expert: "No. An open-only file session preserves the vault content bytes exactly."

Developer: "If someone edits that same file, should the editable content save preserve CRLF?"

Domain expert: "No. Once an intentional edit is saved, CollabMD writes canonical editor text with LF line endings."

Developer: "If the user later undoes back to the same visible text, do we still preserve the original bytes?"

Domain expert: "Only if no editable content save happened yet. After an intentional edit has crossed the save boundary, later saves follow the LF save policy."

Developer: "Who can publish changes?"

Domain expert: "Any active collaborator, including Team Admins, can publish changes to the team's vault source."

Developer: "Does publishing change who authored the commit?"

Domain expert: "No. Commits keep the collaborator identity recorded when they were created; any active collaborator may later publish those commits."

Developer: "Should the access audit trail record who published?"

Domain expert: "Yes. Git history records commit authorship; the access audit trail records who published from the hosted workspace."

Developer: "When does an invited person become a collaborator?"

Domain expert: "Only after they accept the invitation by signing in with the matching verified Google identity."

Developer: "Can invitations linger forever?"

Domain expert: "No. Pending invitations expire after 7 days and can be revoked by a Team Admin."

Developer: "Can an invitation make someone a Team Admin immediately?"

Domain expert: "Yes. Invitations name the initial role the person will receive after accepting."

Developer: "Can the invitation role change before acceptance?"

Domain expert: "Yes. The invited person receives the invitation's current role at acceptance time."

Developer: "Can one email have duplicate invitations or membership?"

Domain expert: "No. An email has one access state for a team: pending invitation, active membership, or no access."

Developer: "Can removed collaborators come back?"

Domain expert: "Yes. Removal ends current access, but a Team Admin can invite the same email again later."

Developer: "Do we track access-management history?"

Domain expert: "Yes. Keep an access audit trail for membership and invitation events, while document change history remains in the vault source."

Developer: "Are self-service leaves audited?"

Domain expert: "Yes. The audit trail records both admin removals and self-service leaves."

Developer: "Are ordinary sign-ins and sign-outs part of the access audit trail?"

Domain expert: "No. The first version audits access-management and publish events, not normal login/logout noise."

Developer: "How long is access audit history retained?"

Domain expert: "Indefinitely in the first version."

Developer: "Who can view the access audit trail?"

Domain expert: "Team Admins only."

Developer: "Do failed workspace claim attempts appear in the Team Admin audit trail?"

Domain expert: "No. They are operational security events visible to operators, because the team has not been claimed yet."

Developer: "Do operators need a health view?"

Domain expert: "Yes. Operational health reports deployment-level readiness separately from Team Settings."

Developer: "Can detailed operational health be public?"

Domain expert: "No. Public liveness can be shallow, but detailed operational health is operator-only or internal."

Developer: "Does the successful workspace claim appear in the Team Admin audit trail?"

Domain expert: "Yes. It is the first access audit event for the team."

Developer: "Can Team Admins export hosted workspace metadata?"

Domain expert: "No. Metadata export is out of scope for the first version; backups are operational."

Developer: "Can Team Admins customize the workspace URL?"

Domain expert: "No. The workspace URL is provisioning-owned in the first version."

Developer: "Is billing part of the first hosted workspace design?"

Domain expert: "No. Billing concepts are intentionally out of scope for the first version."

Developer: "Does access-management data belong in the team's vault source?"

Domain expert: "No. Team membership, invitations, and access audit history are hosted workspace metadata, separate from vault content."

Developer: "Is hosted metadata part of the team's vault content?"

Domain expert: "No. It is backed up as workspace operational state, not committed to the vault source."

Developer: "Does restoring hosted metadata bypass Google sign-in?"

Domain expert: "No. Restored membership still requires authentication with the matching verified Google identity."

Developer: "How do Team Admins manage access?"

Domain expert: "They use Team Settings inside the hosted workspace to manage collaborators, invitations, roles, and access history."

Developer: "Do pending invitations appear separately from collaborator management?"

Domain expert: "No. Team Settings shows active collaborators and pending invitations in one access-management surface."

Developer: "Are invitations emailed or copied manually?"

Domain expert: "Invitations are delivered by email as the normal workflow."

Developer: "Can someone join just because they have an invitation link?"

Domain expert: "No. The signed-in verified Google email must match the invitation email."

Developer: "Whose git credentials does the hosted workspace use?"

Domain expert: "The workspace uses a workspace-level git credential for the team's vault source, separate from individual collaborator identities."
