const previousRoutes = new Map([
  ["/workspace/pre-projects/all", "/workspace/pre-projects"],
  ["/workspace/pre-projects/site-visits", "/workspace/pre-projects/requirements"],
  ["/workspace/pre-projects/measurements", "/workspace/pre-projects/requirements"],
  ["/workspace/pre-projects/site-layouts", "/workspace/pre-projects/requirements"],
  ["/workspace/pre-projects/inspirations", "/workspace/pre-projects/inspiration"],
  ["/workspace/pre-projects/client-approvals", "/workspace/pre-projects/client-portal"],
]);

/** Preserve bookmarked destinations while consolidating the planned sections. */
export function getPreProjectRedirect(
  pathname: string,
  query: Record<string, string | string[] | undefined> = {},
): string | undefined {
  const destination = previousRoutes.get(pathname);
  if (!destination) return undefined;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
    }
  }
  if (pathname.endsWith('/measurements')) params.set('tab', 'measurements');
  if (pathname.endsWith('/site-layouts')) params.set('tab', 'site-plan');
  const search = params.toString();
  return search ? `${destination}?${search}` : destination;
}
