export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

class AuthRequestError extends Error {}

export async function authRequest(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal });
    const payload: unknown = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new AuthRequestError("The sign-in service returned an incomplete response. Please try again.");
    }
    return { ok: response.ok, status: response.status, payload: payload as Record<string, unknown> };
  } catch (error) {
    if (controller.signal.aborted) throw new AuthRequestError("Sign-in is taking too long. Please try again.");
    if (error instanceof AuthRequestError) throw error;
    throw new AuthRequestError("Unable to reach the sign-in service. Check your connection and try again.");
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function confirmBrowserSession() {
  const result = await authRequest("/api/auth/session");
  if (!result.ok || result.payload.authenticated !== true) {
    throw new AuthRequestError("Your browser session could not be confirmed. Please sign in again.");
  }
}

export function openAuthenticatedWorkspace(path: string) {
  // Start a document request with the new cookies, without reusing a cached signed-out route.
  window.location.replace(path);
}
