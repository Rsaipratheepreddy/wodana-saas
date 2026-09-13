/** Keep the browser's device identity when the web server rotates its session. */
export function forwardedDeviceHeaders(incoming: Pick<Headers, "get">): Record<string, string> {
  const forwardedFor = incoming.get("x-forwarded-for");
  return {
    "user-agent": incoming.get("user-agent") ?? "Wodana Web",
    ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
  };
}
