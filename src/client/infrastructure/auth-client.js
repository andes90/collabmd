import '../styles/features/auth-gate.css';

import { getRuntimeConfig } from './runtime-config.js';

const DEFAULT_AUTH_CONFIG = {
  enabled: false,
  implemented: true,
  loginEndpoint: '/api/auth/oidc/login',
  passwordLabel: 'Password',
  provider: '',
  requiresLogin: false,
  sessionEndpoint: '/api/auth/session',
  statusEndpoint: '/api/auth/status',
  strategy: 'none',
  submitLabel: 'Continue',
};

const GOOGLE_G_LOGO_DATA_URL = 'data:image/png;base64,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';

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

function consumeHashParam(name) {
  const params = getHashParams();
  const value = params.get(name) || '';
  if (!value) {
    return '';
  }

  params.delete(name);
  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`;
  window.history.replaceState(null, '', nextUrl);
  return value;
}

function getCurrentReturnTo() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
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

function syncOidcIdentityToLocalState(status) {
  const authConfig = status?.auth ?? {};
  if (authConfig.strategy !== 'oidc') {
    return;
  }

  const userName = String(status?.user?.name ?? '').trim();
  if (!userName) {
    return;
  }

  try {
    window.localStorage.setItem('collabmd-user-name', userName);
  } catch {
    // Ignore storage errors.
  }
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
  const overlay = document.createElement('div');
  overlay.className = 'auth-gate-overlay';

  const card = document.createElement('section');
  card.className = 'auth-gate-card';
  overlay.append(card);

  return { card, overlay };
}

function createGoogleIcon() {
  const icon = document.createElement('span');
  icon.className = 'auth-gate-button__icon';
  icon.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img');
  image.alt = '';
  image.decoding = 'async';
  image.height = 20;
  image.loading = 'eager';
  image.src = GOOGLE_G_LOGO_DATA_URL;
  image.width = 20;
  icon.append(image);
  return icon;
}

function renderOidcPrompt(card, config, {
  errorMessage = '',
}) {
  card.replaceChildren();

  const heading = document.createElement('h1');
  heading.textContent = 'Authentication required';

  const copy = document.createElement('p');
  copy.textContent = 'Sign in to join this session.';

  const actions = document.createElement('div');
  actions.className = 'auth-gate-actions';

  const isGoogle = config.provider === 'google';
  const signInButton = document.createElement('button');
  signInButton.className = `ui-button ui-button--secondary auth-gate-button${isGoogle ? ' auth-gate-button--google' : ''}`;
  signInButton.type = 'button';
  if (isGoogle) {
    signInButton.append(createGoogleIcon());
  }
  signInButton.append(document.createTextNode(config.submitLabel || 'Continue'));

  const error = document.createElement('div');
  error.className = 'auth-gate-error';
  error.textContent = errorMessage;

  actions.append(signInButton);
  card.append(heading, copy, error, actions);
  signInButton.addEventListener('click', () => {
    const loginUrl = new URL(config.loginEndpoint, window.location.origin);
    loginUrl.searchParams.set('returnTo', getCurrentReturnTo());
    window.location.assign(loginUrl.toString());
  });
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
    button.className = 'ui-button ui-button--secondary auth-gate-secondary-button';
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
  input.className = 'ui-input auth-gate-input';
  input.type = 'password';
  input.name = 'password';
  input.autocomplete = 'current-password';
  input.required = true;

  const error = document.createElement('div');
  error.className = 'auth-gate-error';

  const actions = document.createElement('div');
  actions.className = 'auth-gate-actions';

  const submitButton = document.createElement('button');
  submitButton.className = 'ui-button ui-button--primary auth-gate-button';
  submitButton.type = 'submit';
  submitButton.textContent = config.submitLabel;

  actions.append(submitButton);
  label.append(input);
  form.append(heading, copy, label, error, actions);
  card.append(form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = input.value;
    input.disabled = true;
    submitButton.disabled = true;
    error.textContent = '';

    void onSubmit(password).catch((submissionError) => {
      error.textContent = submissionError instanceof Error
        ? submissionError.message
        : 'Authentication failed';
      input.disabled = false;
      submitButton.disabled = false;
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
  let pendingOidcError = consumeHashParam('auth_error');
  return new Promise((resolve) => {
    const resolveAuthenticated = (status = null) => {
      removePasswordFromHash();
      syncOidcIdentityToLocalState(status);
      overlay.remove();
      resolve({
        authenticated: true,
        auth: status?.auth ?? config,
        user: status?.user ?? null,
      });
    };

    const verifyAccess = async () => {
      renderStatusCard(card, {
        body: 'Checking access to this session…',
        title: 'CollabMD',
      });

      try {
        const status = await fetchAuthStatus(config);
        if (status.authenticated) {
          resolveAuthenticated(status);
          return;
        }
      } catch (error) {
        renderStatusCard(card, {
          body: error instanceof Error
            ? `${error.message} Refresh the page and try again.`
            : 'Failed to contact the auth service. Refresh the page and try again.',
          title: 'Cannot verify access',
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
          onSubmit: async (password) => {
            await submitPassword(config, password);
            resolveAuthenticated();
          },
        });
        return;
      }

      if (config.strategy === 'oidc') {
        renderOidcPrompt(card, config, {
          errorMessage: pendingOidcError,
        });
        pendingOidcError = '';
        return;
      }

      renderStatusCard(card, {
        body: 'This authentication strategy is not available.',
        title: 'Authentication unavailable',
      });
    };

    void verifyAccess();
  });
}
