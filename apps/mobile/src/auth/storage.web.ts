import type { SessionStorage } from './client';

// The dev BFF owns the real refresh token in an HttpOnly cookie. Only nonsecret
// session metadata and this placeholder may be persisted in the browser.
const key = 'wodana.mobile.session.v1';
export const sessionStorage: SessionStorage = {
  read: async () => globalThis.localStorage.getItem(key),
  write: async (value) => {
    if (JSON.parse(value).refreshToken !== 'http-only-cookie') throw new Error('Browser session must use the auth proxy.');
    globalThis.localStorage.setItem(key, value);
  },
  clear: async () => globalThis.localStorage.removeItem(key),
};
