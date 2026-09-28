/**
 * Demo safety: while a tour runs, the app may only read. Any request that could write (POST, PUT, PATCH,
 * DELETE…) is refused before it leaves the browser, as a cancelled request, and reported once so a quiet
 * notice can say nothing is saved. Session upkeep stays allowed so nobody is signed out mid-tour.
 */
const READS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALWAYS_ALLOWED = [/^\/api\/auth\/(refresh|session)(\/|$|\?)/u];

export class DemoModeError extends Error {
  constructor() {
    super("Demo mode: nothing is saved");
    // Callers treat an aborted request as cancelled rather than failed.
    this.name = "AbortError";
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function pathOf(url: string, origin: string): string {
  try { return new URL(url, origin).pathname; } catch { return url; }
}

export function isAllowedDuringTour(method: string, url: string, origin = "http://localhost"): boolean {
  if (READS.has(method.toUpperCase())) return true;
  const path = pathOf(url, origin);
  return ALWAYS_ALLOWED.some((pattern) => pattern.test(path));
}

type GuardWindow = Pick<Window, "fetch" | "location"> & { XMLHttpRequest?: typeof XMLHttpRequest };

/** Installs the guard on `fetch` and `XMLHttpRequest`; returns the function that removes it. */
export function installWriteGuard(onBlocked: (method: string, url: string) => void, target: GuardWindow = window): () => void {
  const original = target.fetch;
  const origin = target.location?.origin ?? "http://localhost";
  const guarded: typeof fetch = (input, init) => {
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const url = requestUrl(input);
    if (isAllowedDuringTour(method, url, origin)) return original.call(target, input, init);
    onBlocked(method, url);
    return Promise.reject(new DemoModeError());
  };
  target.fetch = guarded;

  const xhr = target.XMLHttpRequest?.prototype;
  const open = xhr?.open;
  const send = xhr?.send;
  const methods = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
  if (xhr && open && send) {
    xhr.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      methods.set(this, { method: String(method).toUpperCase(), url: String(url) });
      return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof xhr.open;
    xhr.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const request = methods.get(this);
      if (request && !isAllowedDuringTour(request.method, request.url, origin)) {
        onBlocked(request.method, request.url);
        this.abort();
        return;
      }
      return send.call(this, body);
    };
  }

  return () => {
    if (target.fetch === guarded) target.fetch = original;
    if (xhr && open && send) { xhr.open = open; xhr.send = send; }
  };
}
