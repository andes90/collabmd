import { randomBytes } from 'node:crypto';

export const AUTH_STRATEGY_NONE = 'none';
export const AUTH_STRATEGY_PASSWORD = 'password';
export const AUTH_STRATEGY_OIDC = 'oidc';

export const SUPPORTED_AUTH_STRATEGIES = new Set([
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_PASSWORD,
  AUTH_STRATEGY_OIDC,
]);

export const OIDC_FLOW_TTL_MS = 10 * 60 * 1000;
export const OIDC_PROVIDER_GOOGLE = 'google';
export const OIDC_PROVIDER_GENERIC = 'generic';

export function createRandomAuthPassword(length = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let password = '';

  for (let index = 0; index < length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length];
  }

  return password;
}

export function createRandomSessionSecret() {
  return randomBytes(32).toString('base64url');
}
