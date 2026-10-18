import { HttpException, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ErrorReporter, parseDsn, stackFrames } from "./error-reporting";
import { ErrorReportingFilter, ReportingLogger } from "./error-reporting.filter";

const DSN = "https://publickey123@o42.ingest.example.io/4501";

function reporterWith(now = () => 1_000_000) {
  const send = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true }));
  const reporter = new ErrorReporter(parseDsn(DSN), { service: "business-core", environment: "production", release: "r1", send, now });
  const events = () => send.mock.calls.map(([, init]) => JSON.parse(String(init.body).split("\n")[2]));
  return { reporter, send, events };
}

describe("error reporter", () => {
  it("is off without a DSN and never sends", async () => {
    const reporter = ErrorReporter.fromEnv("business-core", {});
    expect(reporter.enabled).toBe(false);
    reporter.captureException(new Error("boom"));
    await reporter.flush();
  });

  it("parses a Sentry DSN into its envelope endpoint", () => {
    expect(parseDsn(DSN)).toEqual({ endpoint: "https://o42.ingest.example.io/api/4501/envelope/", publicKey: "publickey123" });
    expect(parseDsn("https://key@glitchtip.example.com/sub/7")?.endpoint).toBe("https://glitchtip.example.com/sub/api/7/envelope/");
    expect(parseDsn("not a dsn")).toBeNull();
    expect(parseDsn("https://example.com/7")).toBeNull();
  });

  it("sends the error, route and subject only, with the release", async () => {
    const { reporter, send, events } = reporterWith();
    const error = new TypeError("cannot read x");
    reporter.captureException(error, { method: "GET", path: "/api/v1/workspaces/w/projects", status: 500, subject: "local:u1" });
    await reporter.flush();
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0];
    expect(url).toBe("https://o42.ingest.example.io/api/4501/envelope/");
    expect((init.headers as Record<string, string>)["x-sentry-auth"]).toContain("sentry_key=publickey123");
    const [event] = events();
    expect(event).toMatchObject({
      level: "error", environment: "production", release: "r1", platform: "node",
      request: { method: "GET", url: "/api/v1/workspaces/w/projects" }, user: { id: "local:u1" },
      exception: { values: [{ type: "TypeError", value: "cannot read x" }] },
    });
    expect(event.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
  });

  it("reports the same failure once per five minutes and at most 30 a minute", async () => {
    let clock = 1_000_000;
    const { reporter, send } = reporterWith(() => clock);
    const error = new Error("same");
    reporter.captureException(error);
    reporter.captureLog(error.message, error.stack);
    reporter.captureException(error);
    await reporter.flush();
    expect(send).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 50; index += 1) reporter.captureException(new Error(`distinct ${index}`));
    await reporter.flush();
    expect(send).toHaveBeenCalledTimes(30);
    clock += 6 * 60_000;
    reporter.captureException(error);
    await reporter.flush();
    expect(send).toHaveBeenCalledTimes(31);
  });

  it("never throws when the endpoint fails", async () => {
    const send = vi.fn(async () => { throw new Error("network down"); });
    const reporter = new ErrorReporter(parseDsn(DSN), { service: "business-core", environment: "production", send });
    expect(() => reporter.captureException(new Error("boom"))).not.toThrow();
    await reporter.flush();
  });

  it("reads V8 stack frames oldest first and marks library frames", () => {
    const frames = stackFrames([
      "Error: x",
      "    at handler (/app/dist/projects/projects.service.js:10:5)",
      "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
      "    at node:internal/process/task_queues:105:5",
    ].join("\n"));
    expect(frames.map((frame) => [frame.function, frame.in_app])).toEqual([
      [undefined, false], ["Layer.handle", false], ["handler", true],
    ]);
  });
});

describe("error reporting filter and logger", () => {
  function host(method = "POST", url = "/api/v1/workspaces/w/books?x=secret") {
    const response = {};
    return {
      getType: () => "http",
      switchToHttp: () => ({ getRequest: () => ({ method, originalUrl: url, actor: { subject: "local:u1" } }) }),
      getArgByIndex: () => response,
    } as never;
  }
  const adapter = () => ({ reply: vi.fn(), isHeadersSent: () => false, end: vi.fn() });

  it("reports a 5xx with its route (no query string) and still answers as Nest does", async () => {
    const { reporter, events } = reporterWith();
    const http = adapter();
    const filter = new ErrorReportingFilter(reporter, http as never);
    filter.catch(new Error("db down"), host());
    await reporter.flush();
    expect(events()).toEqual([expect.objectContaining({ request: { method: "POST", url: "/api/v1/workspaces/w/books" } })]);
    expect(http.reply).toHaveBeenCalledWith(expect.anything(), { statusCode: 500, message: "Internal server error" }, 500);
  });

  it("reports intentional 5xx HttpExceptions but never 4xx", async () => {
    const { reporter, events } = reporterWith();
    const http = adapter();
    const filter = new ErrorReportingFilter(reporter, http as never);
    filter.catch(new NotFoundException("Project not found"), host("GET", "/api/v1/x"));
    filter.catch(new HttpException("Too many", 429), host("GET", "/api/v1/y"));
    filter.catch(new ServiceUnavailableException("intelligence down"), host("GET", "/api/v1/z"));
    await reporter.flush();
    expect(events().map((event) => event.tags.status)).toEqual(["503"]);
    expect(http.reply).toHaveBeenCalledTimes(3);
  });

  it("reports error-level log lines from background work, but not client errors or the filter's own lines", async () => {
    const { reporter, events } = reporterWith();
    const logger = new ReportingLogger(reporter, { logLevels: [] });
    const failure = new InternalServerErrorException("sweep failed");
    logger.error("Reminder sweep failed for w1", failure.stack, "RemindersSweep");
    logger.error(Object.assign(new Error("request entity too large"), { statusCode: 413, status: 413, expose: true }));
    logger.error("500 GET /api/v1/x", undefined, "ErrorReportingFilter");
    await reporter.flush();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ logger: "RemindersSweep", tags: { source: "RemindersSweep" } });
  });
});
