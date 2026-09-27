const id = "[0-9a-f-]{36}";
const routes: Record<string, RegExp> = {
  GET: new RegExp(
    `^(bootstrap|people|calendars|crews|crew-days|documents|documents/${id}/file|site-access|time/(mine|team|project|utilisation)|payroll|payroll/export|attendance/(current|history|export)|reviews|leave/(types|balances|requests)|captures/${id}/photo)$`,
  ),
  POST: new RegExp(
    `^(calendars|calendars/${id}/holidays|holidays/${id}/remove|captures|attendance/actions|reviews|reviews/${id}/decision|leave/requests|leave/requests/${id}/(cancel|decision)|crew-days/${id}/(submit|decision)|documents/${id}/remove|site-access|site-access/${id}/remove|time/${id}/(submit|decision))$`,
  ),
  PUT: new RegExp(
    `^(settings|people/${id}|calendars/${id}|holidays/${id}|captures/${id}/photo|leave/(types|allowances)|crews|workers|crew-days/${id}|documents/${id}|documents/${id}/file|time/weeks/\\d{4}-\\d{2}-\\d{2})$`,
  ),
};
/** Uploads the proxy passes on as files, each with its form field and size limit. */
const uploads: Array<{ path: RegExp; field: string; maxBytes: number }> = [
  { path: new RegExp(`^captures/${id}/photo$`), field: "photo", maxBytes: 6 * 1024 * 1024 },
  { path: new RegExp(`^documents/${id}/file$`), field: "file", maxBytes: 10 * 1024 * 1024 },
];
export function hrmsUpload(path: string) {
  return uploads.find((upload) => upload.path.test(path)) ?? null;
}
/** Files the proxy streams back as they are (photos, scans and CSV exports). */
export function streamedHrmsRoute(path: string) {
  return new RegExp(`^(captures/${id}/photo|documents/${id}/file|attendance/export|payroll/export)$`).test(path);
}
export function allowedHrmsRoute(method: string, path: string) {
  return routes[method]?.test(path) ?? false;
}
/** Projects serves HRMS its work contexts and workplaces, and Settings its workflow templates. */
export function allowedProjectsRoute(method: string, path: string) {
  return (
    (method === "GET" &&
      (["", "locations", "workflow-templates"].includes(path) ||
        new RegExp(`^workflow-templates/${id}/history$`).test(path))) ||
    (method === "PUT" &&
      (path === "locations" ||
        new RegExp(`^workflow-templates/${id}$`).test(path))) ||
    (method === "POST" &&
      (new RegExp(`^workflow-templates/${id}/(archive|rollback)$`).test(path)))
  );
}
