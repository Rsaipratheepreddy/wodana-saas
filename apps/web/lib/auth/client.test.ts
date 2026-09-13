import { afterEach, expect, it, vi } from "vitest";
import { authRequest, AUTH_REQUEST_TIMEOUT_MS } from "./client";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("aborts a stalled request and returns a clear timeout instead of hanging", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })));
  const assertion = expect(authRequest("/api/auth/login")).rejects.toThrow("Sign-in is taking too long. Please try again.");
  await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);
  await assertion;
});
