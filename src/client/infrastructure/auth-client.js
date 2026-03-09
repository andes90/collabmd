import { getRuntimeConfig } from './runtime-config.js';

const DEFAULT_AUTH_CONFIG = {
  enabled: false,
  implemented: true,
  passwordLabel: 'Password',
  requiresLogin: false,
  sessionEndpoint: '/api/auth/session',
  statusEndpoint: '/api/auth/status',
  strategy: 'none',
  submitLabel: 'Continue',
};

let authGateStylesInjected = false;

function ensureAuthGateStyles() {
  if (authGateStylesInjected || !document.head) {
    return;
  }

  const style = document.createElement('style');
  style.textContent = `
    .auth-gate-overlay {
      position: fixed;
      inset: 0;
      z-index: 5000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background:
        radial-gradient(circle at top, rgba(59, 130, 246, 0.18), transparent 42%),
        rgba(10, 15, 29, 0.74);
      backdrop-filter: blur(14px);
    }

    .auth-gate-card {
      width: min(100%, 420px);
      padding: 28px;
      border-radius: 18px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(15, 23, 42, 0.94);
      color: #e2e8f0;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.36);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .auth-gate-card h1 {
      margin: 0 0 10px;
      font-size: 1.35rem;
      line-height: 1.2;
    }

    .auth-gate-card p {
      margin: 0 0 18px;
      color: #cbd5e1;
      line-height: 1.5;
    }

    .auth-gate-form {
      display: grid;
      gap: 12px;
    }

    .auth-gate-label {
      display: grid;
      gap: 8px;
      font-size: 0.92rem;
      color: #cbd5e1;
    }

    .auth-gate-input {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.72);
      color: inherit;
      font: inherit;
    }

    .auth-gate-input:focus {
      outline: 2px solid rgba(59, 130, 246, 0.5);
      outline-offset: 2px;
    }

    .auth-gate-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .auth-gate-button,
    .auth-gate-secondary-button {
      border: 0;
      border-radius: 999px;
      font: inherit;
      cursor: pointer;
    }

    .auth-gate-button {
      padding: 11px 16px;
      background: linear-gradient(135deg, #0f766e, #0284c7);
      color: #f8fafc;
      font-weight: 600;
    }

    .auth-gate-secondary-button {
      padding: 10px 0;
      background: transparent;
      color: #93c5fd;
    }

    .auth-gate-button[disabled],
    .auth-gate-secondary-button[disabled] {
      opacity: 0.7;
      cursor: wait;
    }

    .auth-gate-error {
      min-height: 1.25rem;
      color: #fca5a5;
      font-size: 0.92rem;
    }
  `;

  document.head.append(style);
  authGateStylesInjected = true;
}

function getClientAuthConfig() {
  return {
    ...DEFAULT_AUTH_CONFIG,
    ...(getRuntimeConfig().auth ?? {}),
  };
}

function getHashParams() {
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(rawHash);
}

function getPasswordFromHash() {
  return getHashParams().get('auth_password') || '';
}

function removePasswordFromHash() {
  const params = getHashParams();
  if (!params.has('auth_password')) {
    return;
  }

  params.delete('auth_password');
  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`;
  window.history.replaceState(null, '', nextUrl);
}

async function fetchAuthStatus(config) {
  const response = await fetch(config.statusEndpoint, {
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to read auth status');
  }

  return payload;
}

async function submitPassword(config, password) {
  const response = await fetch(config.sessionEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Authentication failed');
  }

  return payload;
}

function createOverlayShell() {
  ensureAuthGateStyles();

  const overlay = document.createElement('div');
  overlay.className = 'auth-gate-overlay';

  const card = document.createElement('section');
  card.className = 'auth-gate-card';
  overlay.append(card);

  return { card, overlay };
}

function renderStatusCard(card, {
  title,
  body,
  secondaryActionLabel = '',
  onSecondaryAction = null,
}) {
  card.replaceChildren();

  const heading = document.createElement('h1');
  heading.textContent = title;

  const copy = document.createElement('p');
  copy.textContent = body;

  card.append(heading, copy);

  if (secondaryActionLabel && typeof onSecondaryAction === 'function') {
    const button = document.createElement('button');
    button.className = 'auth-gate-secondary-button';
    button.type = 'button';
    button.textContent = secondaryActionLabel;
    button.addEventListener('click', () => {
      void onSecondaryAction();
    });
    card.append(button);
  }
}

function renderPasswordPrompt(card, config, {
  onSubmit,
  onRetryStatus,
}) {
  card.replaceChildren();

  const heading = document.createElement('h1');
  heading.textContent = 'Authentication required';

  const copy = document.createElement('p');
  copy.textContent = 'Enter the host password to join this shared session.';

  const form = document.createElement('form');
  form.className = 'auth-gate-form';

  const label = document.createElement('label');
  label.className = 'auth-gate-label';
  label.textContent = config.passwordLabel;

  const input = document.createElement('input');
  input.className = 'auth-gate-input';
  input.type = 'password';
  input.name = 'password';
  input.autocomplete = 'current-password';
  input.required = true;

  const error = document.createElement('div');
  error.className = 'auth-gate-error';

  const actions = document.createElement('div');
  actions.className = 'auth-gate-actions';

  const retryButton = document.createElement('button');
  retryButton.className = 'auth-gate-secondary-button';
  retryButton.type = 'button';
  retryButton.textContent = 'Retry status';

  const submitButton = document.createElement('button');
  submitButton.className = 'auth-gate-button';
  submitButton.type = 'submit';
  submitButton.textContent = config.submitLabel;

  actions.append(retryButton, submitButton);
  label.append(input);
  form.append(heading, copy, label, error, actions);
  card.append(form);

  retryButton.addEventListener('click', () => {
    void onRetryStatus();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = input.value;
    input.disabled = true;
    submitButton.disabled = true;
    retryButton.disabled = true;
    error.textContent = '';

    void onSubmit(password).catch((submissionError) => {
      error.textContent = submissionError instanceof Error
        ? submissionError.message
        : 'Authentication failed';
      input.disabled = false;
      submitButton.disabled = false;
      retryButton.disabled = false;
      input.select();
      input.focus();
    });
  });

  queueMicrotask(() => {
    input.focus();
  });
}

export async function ensureClientAuthenticated() {
  const config = getClientAuthConfig();
  if (!config.enabled || config.strategy === 'none') {
    return { authenticated: true, auth: config };
  }

  const { card, overlay } = createOverlayShell();
  document.body.append(overlay);
  return new Promise((resolve) => {
    const resolveAuthenticated = () => {
      removePasswordFromHash();
      overlay.remove();
      resolve({ authenticated: true, auth: config });
    };

    const verifyAccess = async () => {
      renderStatusCard(card, {
        body: 'Checking access to this session…',
        title: 'CollabMD',
      });

      try {
        const status = await fetchAuthStatus(config);
        if (status.authenticated) {
          resolveAuthenticated();
          return;
        }
      } catch (error) {
        renderStatusCard(card, {
          body: error instanceof Error ? error.message : 'Failed to contact the auth service.',
          secondaryActionLabel: 'Retry',
          title: 'Cannot verify access',
          onSecondaryAction: verifyAccess,
        });
        return;
      }

      if (config.strategy === 'password') {
        const sharedPassword = getPasswordFromHash();
        if (sharedPassword) {
          try {
            removePasswordFromHash();
            await submitPassword(config, sharedPassword);
            resolveAuthenticated();
            return;
          } catch {
            // Fall through to the interactive prompt.
          }
        }

        renderPasswordPrompt(card, config, {
          onRetryStatus: verifyAccess,
          onSubmit: async (password) => {
            await submitPassword(config, password);
            resolveAuthenticated();
          },
        });
        return;
      }

      renderStatusCard(card, {
        body: config.strategy === 'oidc'
          ? 'OIDC authentication is configured but not implemented in this build yet.'
          : 'This authentication strategy is not available.',
        secondaryActionLabel: 'Retry status',
        title: 'Authentication unavailable',
        onSecondaryAction: verifyAccess,
      });
    };

    void verifyAccess();
  });
}
