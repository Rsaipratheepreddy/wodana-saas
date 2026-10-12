import { ArgumentsHost, Catch, ConsoleLogger, type ConsoleLoggerOptions, HttpException, Logger } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { ErrorReporter } from "./error-reporting";

const FILTER_CONTEXT = "ErrorReportingFilter";

function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  const candidate = exception as { statusCode?: unknown; status?: unknown } | null;
  const status = Number(candidate?.statusCode ?? candidate?.status);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

/**
 * Every 5xx is logged once with its route and reported (when SENTRY_DSN is set); the response itself is still
 * written by Nest's own filter, so clients see exactly what they saw before (no stack, no SQL).
 */
@Catch()
export class ErrorReportingFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(FILTER_CONTEXT);

  constructor(
    private readonly reporter: ErrorReporter,
    applicationRef?: ConstructorParameters<typeof BaseExceptionFilter>[0],
  ) {
    super(applicationRef);
  }

  override catch(exception: unknown, host: ArgumentsHost) {
    const status = statusOf(exception);
    if (status >= 500 && host.getType() === "http") {
      const request = host.switchToHttp().getRequest<{
        method?: string;
        originalUrl?: string;
        url?: string;
        actor?: { subject?: string };
      }>();
      const method = request.method ?? "";
      const path = String(request.originalUrl ?? request.url ?? "").split("?")[0];
      this.reporter.captureException(exception, { method, path, status, subject: request.actor?.subject });
      if (exception instanceof HttpException) {
        // Nest doesn't log HttpExceptions; a 5xx one (upstream down, not ready) still deserves a line.
        this.logger.error(`${status} ${method} ${path}: ${exception.message}`, exception.stack);
      } else {
        // Nest logs the error and its stack next; this line ties it to the route.
        this.logger.error(`${status} ${method} ${path}`);
      }
    }
    super.catch(exception, host);
  }
}

/**
 * The app logger: Nest's console logger (one JSON object per line in production) that also reports every
 * error-level line, so failures in timers and background sweeps reach error tracking, not only request errors.
 */
export class ReportingLogger extends ConsoleLogger {
  constructor(
    private readonly reporter: ErrorReporter,
    options: ConsoleLoggerOptions = {},
  ) {
    super(options);
  }

  override error(message: unknown, ...optionalParams: unknown[]) {
    super.error(message, ...(optionalParams as [string?, string?]));
    try {
      const strings = optionalParams.filter((param): param is string => typeof param === "string");
      const stack = strings.find((param) => param.includes("\n    at "));
      const context = [...strings].reverse().find((param) => param !== stack);
      // The exception filter has already reported the request error behind its own lines.
      if (context === FILTER_CONTEXT) return;
      if (message instanceof Error) {
        if (statusOf(message) < 500) return; // a client error (too large, bad JSON) is not a failure
        this.reporter.captureException(message, { source: context });
        return;
      }
      const text = typeof message === "string" ? message : JSON.stringify(message);
      this.reporter.captureLog(text ?? String(message), stack, { source: context });
    } catch {
      // Reporting never breaks logging.
    }
  }
}
