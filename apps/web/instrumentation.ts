import type { Instrumentation } from "next";

// Server errors in pages, route handlers, actions and the proxy go to error tracking when SENTRY_DSN is set.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!process.env.SENTRY_DSN) return;
  const { reportServerError } = await import("./lib/error-reporting");
  await reportServerError(error, {
    method: request.method,
    path: request.path,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
