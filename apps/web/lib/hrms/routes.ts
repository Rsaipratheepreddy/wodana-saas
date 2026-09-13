const id = "[0-9a-f-]{36}";
const routes: Record<string, RegExp> = {
  GET: new RegExp(
    `^(bootstrap|people|attendance/(current|history|export)|reviews|leave/(types|balances|requests)|captures/${id}/photo)$`,
  ),
  POST: new RegExp(
    `^(calendars|captures|attendance/actions|reviews|reviews/${id}/decision|leave/requests|leave/requests/${id}/(cancel|decision))$`,
  ),
  PUT: new RegExp(
    `^(settings|people/${id}|captures/${id}/photo|leave/(types|allowances))$`,
  ),
};
export function allowedHrmsRoute(method: string, path: string) {
  return routes[method]?.test(path) ?? false;
}
export function allowedProjectsRoute(method: string, path: string) {
  return (
    (method === "GET" &&
      ["", "locations", "assignments", "attendance"].includes(path)) ||
    (method === "PUT" && ["locations", "assignments"].includes(path)) ||
    (method === "POST" && path === "from-pre-project")
  );
}
