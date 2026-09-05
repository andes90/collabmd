import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';

function sendHostedError(req, res, error) {
  const statusCode = Number(error?.statusCode || 500);
  if (statusCode >= 500) {
    console.error('[api] Hosted workspace request failed:', error.message);
  }

  jsonResponse(req, res, statusCode, {
    code: error?.code || 'HOSTED_REQUEST_FAILED',
    error: statusCode >= 500 ? 'Hosted workspace request failed' : error.message,
  });
}

function authenticatedUser(authService, req) {
  return authService?.getAuthenticatedUser?.(req) ?? null;
}

function readPathId(pathname, prefix) {
  if (!pathname.startsWith(prefix)) {
    return '';
  }

  const value = pathname.slice(prefix.length).split('/')[0] || '';
  return decodeURIComponent(value);
}

export function createHostedApiHandler({
  authService,
  githubSetupFlow = null,
  hostedWorkspaceService = null,
}) {
  const exactRoutes = new Map([
    ['GET /api/hosted/status', async ({ req, res, user }) => {
      jsonResponse(req, res, 200, await hostedWorkspaceService.getStatus(user));
    }],
    ['POST /api/hosted/claim', async ({ req, res, user }) => {
      const body = await parseJsonBody(req);
      jsonResponse(req, res, 200, await hostedWorkspaceService.claimWorkspace({
        teamName: body?.teamName,
        token: body?.token,
        user,
      }));
    }],
    ['POST /api/hosted/setup/complete', async ({ req, res, user }) => {
      const admin = await hostedWorkspaceService.requireAdmin(user);
      const team = await hostedWorkspaceService.completeWorkspaceSetup({ user: admin });
      jsonResponse(req, res, 200, { ok: true, setupComplete: true, team });
    }],
    ['GET /api/hosted/vault-source', async ({ req, res, user }) => {
      jsonResponse(req, res, 200, { vaultSource: await hostedWorkspaceService.getVaultSource(user) });
    }],
    ['POST /api/hosted/vault-source/github/setup', async ({ req, res, user }) => {
      const admin = await hostedWorkspaceService.requireAdmin(user);
      const setup = githubSetupFlow?.begin(req, { admin });
      if (!setup) {
        const error = new Error('GitHub App setup is not configured.');
        error.statusCode = 503;
        error.code = 'HOSTED_GITHUB_APP_NOT_CONFIGURED';
        throw error;
      }
      res.setHeader('Set-Cookie', setup.setCookie);
      jsonResponse(req, res, 200, {
        expiresAt: setup.expiresAt,
        setupUrl: setup.setupUrl,
      });
    }],
    ['GET /api/hosted/vault-source/github/callback', async ({ req, requestUrl, res, user }) => {
      const admin = await hostedWorkspaceService.requireAdmin(user);
      const setup = await githubSetupFlow?.complete(req, requestUrl, { admin });
      if (!setup) {
        const error = new Error('GitHub App setup is not configured.');
        error.statusCode = 503;
        error.code = 'HOSTED_GITHUB_APP_NOT_CONFIGURED';
        throw error;
      }

      const result = await hostedWorkspaceService.configureGithubVaultSource({
        github: setup.github,
        user,
      });
      res.setHeader('Set-Cookie', setup.clearCookie);
      jsonResponse(req, res, 200, result);
    }],
    ['GET /api/hosted/memberships', async ({ req, res, user }) => {
      jsonResponse(req, res, 200, { memberships: await hostedWorkspaceService.listMemberships(user) });
    }],
    ['POST /api/hosted/memberships/leave', async ({ req, res, user }) => {
      jsonResponse(req, res, 200, await hostedWorkspaceService.leaveTeam(user));
    }],
    ['GET /api/hosted/invitations', async ({ req, res, user }) => {
      jsonResponse(req, res, 200, { invitations: await hostedWorkspaceService.listInvitations(user) });
    }],
    ['POST /api/hosted/invitations', async ({ req, res, user }) => {
      const body = await parseJsonBody(req);
      jsonResponse(req, res, 200, {
        invitation: await hostedWorkspaceService.createInvitation({
          email: body?.email,
          role: body?.role,
          user,
        }),
      });
    }],
    ['POST /api/hosted/invitations/accept', async ({ req, res, user }) => {
      jsonResponse(req, res, 200, {
        membership: await hostedWorkspaceService.acceptInvitation(user),
      });
    }],
    ['GET /api/hosted/audit', async ({ req, res, user }) => {
      jsonResponse(req, res, 200, { events: await hostedWorkspaceService.listAuditEvents(user) });
    }],
  ]);

  const prefixRoutes = [
    {
      method: 'PATCH',
      prefix: '/api/hosted/memberships/',
      handle: async ({ req, res, requestUrl, user }) => {
        const membershipId = readPathId(requestUrl.pathname, '/api/hosted/memberships/');
        const body = await parseJsonBody(req);
        jsonResponse(req, res, 200, {
          membership: await hostedWorkspaceService.updateMembershipRole({
            membershipId,
            role: body?.role,
            user,
          }),
        });
      },
    },
    {
      method: 'DELETE',
      prefix: '/api/hosted/memberships/',
      handle: async ({ req, res, requestUrl, user }) => {
        const membershipId = readPathId(requestUrl.pathname, '/api/hosted/memberships/');
        jsonResponse(req, res, 200, await hostedWorkspaceService.removeMembership({ membershipId, user }));
      },
    },
    {
      method: 'PATCH',
      prefix: '/api/hosted/invitations/',
      handle: async ({ req, res, requestUrl, user }) => {
        const invitationId = readPathId(requestUrl.pathname, '/api/hosted/invitations/');
        const body = await parseJsonBody(req);
        jsonResponse(req, res, 200, {
          invitation: await hostedWorkspaceService.updateInvitationRole({
            invitationId,
            role: body?.role,
            user,
          }),
        });
      },
    },
    {
      method: 'DELETE',
      prefix: '/api/hosted/invitations/',
      handle: async ({ req, res, requestUrl, user }) => {
        const invitationId = readPathId(requestUrl.pathname, '/api/hosted/invitations/');
        jsonResponse(req, res, 200, await hostedWorkspaceService.revokeInvitation({ invitationId, user }));
      },
    },
  ];

  return async function handleHostedApi(req, res, requestUrl) {
    if (!requestUrl.pathname.startsWith('/api/hosted')) {
      return false;
    }

    if (!hostedWorkspaceService?.enabled) {
      jsonResponse(req, res, 404, { error: 'Hosted workspace API is not enabled' });
      return true;
    }

    const auth = authService.authorizeApiRequest(req);
    if (!auth.ok) {
      jsonResponse(req, res, auth.statusCode, auth.body);
      return true;
    }

    const user = authenticatedUser(authService, req);

    try {
      const routeContext = { req, requestUrl, res, user };
      const exactRoute = exactRoutes.get(`${req.method} ${requestUrl.pathname}`);
      if (exactRoute) {
        await exactRoute(routeContext);
        return true;
      }

      const prefixRoute = prefixRoutes.find((route) => (
        route.method === req.method && requestUrl.pathname.startsWith(route.prefix)
      ));
      if (prefixRoute) {
        await prefixRoute.handle(routeContext);
        return true;
      }

      jsonResponse(req, res, 404, { error: 'Hosted workspace endpoint not found' });
      return true;
    } catch (error) {
      sendHostedError(req, res, error);
      return true;
    }
  };
}
