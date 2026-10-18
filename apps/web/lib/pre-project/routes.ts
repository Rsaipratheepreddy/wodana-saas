const previousRoutes = new Map([
  ["/workspace/pre-projects/all", "/workspace/pre-projects"],
  ["/workspace/pre-projects/site-visits", "/workspace/pre-projects?section=requirements"],
  ["/workspace/pre-projects/measurements", "/workspace/pre-projects?section=measurements"],
  ["/workspace/pre-projects/site-layouts", "/workspace/pre-projects?section=site-layouts"],
  ["/workspace/pre-projects/inspirations", "/workspace/pre-projects?section=inspiration"],
  ["/workspace/pre-projects/client-approvals", "/workspace/pre-projects?section=client-portal"],
]);

/** Preserve bookmarked destinations while consolidating the planned sections. */
export function getPreProjectRedirect(
  pathname: string,
  query: Record<string, string | string[] | undefined> = {},
): string | undefined {
  const destination = previousRoutes.get(pathname);
  if (!destination) return undefined;
  const [destinationPath, destinationQuery] = destination.split("?");
  const params = new URLSearchParams(destinationQuery);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
    }
  }
  const selectedSection = new URLSearchParams(destinationQuery).get("section");
  if (selectedSection) params.set("section", selectedSection);
  const search = params.toString();
  return search ? `${destinationPath}?${search}` : destinationPath;
}
