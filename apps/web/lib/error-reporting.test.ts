import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEnvelope, parseDsn, reportServerError } from "./error-reporting";

describe("web error reporting", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("does nothing without SENTRY_DSN", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const send = vi.fn();
    await reportServerError(new Error("boom"), { path: "/workspace" }, send);
    expect(send).not.toHaveBeenCalled();
  });

  it("parses a DSN into the envelope endpoint", () => {
    expect(parseDsn("https://key1@o1.ingest.example.io/77")).toEqual({ endpoint: "https://o1.ingest.example.io/api/77/envelope/", publicKey: "key1" });
    expect(parseDsn("nonsense")).toBeNull();
  });

  it("sends the error with the route and path but not the query string", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key1@o1.ingest.example.io/77");
    vi.stubEnv("WODANA_RELEASE_ID", "r9");
    const send = vi.fn(async () => ({ ok: true }));
    await reportServerError(new Error("render failed once"), {
      method: "GET", path: "/workspace/projects?token=secret", routePath: "/workspace/projects", routeType: "render",
    }, send);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.example.io/api/77/envelope/");
    const event = JSON.parse(String(init.body).split("\n")[2]);
    expect(event).toMatchObject({ release: "r9", transaction: "/workspace/projects",
      request: { method: "GET", url: "/workspace/projects" }, exception: { values: [{ value: "render failed once" }] } });
    expect(String(init.body)).not.toContain("secret");
  });

  it("drops a repeat of the same error within five minutes", () => {
    const error = new Error("repeat me");
    expect(buildEnvelope(error, {}, { now: 10_000_000 })).not.toBeNull();
    expect(buildEnvelope(error, {}, { now: 10_060_000 })).toBeNull();
    expect(buildEnvelope(error, {}, { now: 10_400_000 })).not.toBeNull();
  });
});
