# Test hosted workspace administration locally

Use this guide to test the claim gate, temporary source-less setup, Team Settings, invitations, roles, removals, and access history. GitHub Vault Source checkout and publishing are not part of this test.

## Prerequisites

- Node.js 26 and `npm install` completed
- A Google OAuth Web application
- One Google account for the first Team Admin
- A second Google account if you want to test invitation acceptance

To create the OAuth client and consent screen, follow the [Google OIDC Setup Guide](./google-oidc-setup.md).

In Google Cloud Console, add this authorized redirect URI:

```text
http://localhost:1234/api/auth/oidc/callback
```

If the OAuth consent screen is in testing mode, add both Google accounts as test users.

## 1. Prepare a disposable Vault

From the repository root:

```bash
mkdir -p .tmp/hosted-local-vault
printf '# Hosted workspace test\n' > .tmp/hosted-local-vault/README.md
npm run build
```

Do not use a real Vault for this walkthrough. Hosted metadata persists in `.tmp/hosted-local-vault/.collabmd/hosted.sqlite`.

## 2. Start CollabMD in hosted mode

Replace the Google credentials and admin email:

```bash
AUTH_STRATEGY=oidc \
PUBLIC_BASE_URL=http://localhost:1234 \
AUTH_OIDC_CLIENT_ID='your-google-client-id' \
AUTH_OIDC_CLIENT_SECRET='your-google-client-secret' \
COLLABMD_HOSTED_ENABLED=true \
COLLABMD_HOSTED_CLAIM_EMAIL='admin@example.com' \
COLLABMD_HOSTED_CLAIM_TOKEN='local-claim-secret' \
node bin/collabmd.js .tmp/hosted-local-vault --no-tunnel
```

Open <http://localhost:1234> and sign in with the exact email configured in `COLLABMD_HOSTED_CLAIM_EMAIL`.

## 3. Test the first-admin flow

1. Confirm the application shell stays blocked behind **Claim this workspace**.
2. Enter a Team Name and `local-claim-secret`.
3. Confirm the setup gate appears and the editor remains blocked.
4. Select **Complete setup**.
5. Confirm the application shell initializes and the Vault file tree appears.
6. Open **More actions → Team Settings**.
7. Confirm the first collaborator is your Google identity with the **Admin** role.
8. Confirm access history contains `workspace_claimed` and `workspace_setup_completed`.

Setup completion without a GitHub Vault Source is temporary. Do not use this flow to test GitHub setup.

## 4. Test invitation acceptance

In Team Settings:

1. Invite the second Google account as **Collaborator**.
2. Confirm it appears under **Pending invitations**.
3. Copy `http://localhost:1234`; invitation email delivery is not implemented yet.
4. Open the URL in a separate browser profile or private window.
5. Sign in with the invited Google account.
6. Confirm the application shell stays blocked until **Accept invitation** is selected.
7. Accept the invitation and confirm the Vault opens.
8. Confirm Team Settings is not available to the Collaborator.

Back in the admin session, reopen Team Settings and confirm the invitation became an active collaborator and `invitation_accepted` appears in access history.

## 5. Test admin operations

Use the admin session to verify:

- Change the collaborator between **Collaborator** and **Admin**; reload their session to verify the resulting UI.
- Create another invitation, change its role, then revoke it.
- Remove the test collaborator and confirm their active workspace connection closes.
- Confirm each action appears in access history.
- Confirm the final Team Admin cannot be demoted or removed.

## Reset the test workspace

Stop CollabMD, then remove only the disposable hosted metadata:

```bash
rm -f .tmp/hosted-local-vault/.collabmd/hosted.sqlite*
```

Restart the command from step 2 to repeat the claim flow.

## Troubleshooting

- **Redirect URI mismatch:** The Google redirect URI must exactly equal `http://localhost:1234/api/auth/oidc/callback`.
- **Claim belongs to another account:** Sign in with the exact `COLLABMD_HOSTED_CLAIM_EMAIL` value.
- **No invitation found:** The signed-in Google email must exactly match the invited email.
- **The shell remains blocked:** This is expected until claim/setup or invitation acceptance grants workspace access.
- **The claim screen does not return after restart:** Delete the disposable hosted SQLite files as shown in the reset step.
