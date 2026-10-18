const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEAM = /^(design|logistics)$/;

/** The team calendars' resources (PLM-090/091): what each method may reach, and nothing else. */
export function allowedTeamCalendarPath(path: string[], method: string) {
  if (method === "GET") return (path.length === 1 && (["settings", "booking-options"].includes(path[0]) || TEAM.test(path[0]))) || (path.length === 2 && TEAM.test(path[0]) && path[1] === "push-plan");
  if (method === "POST") return (path.length === 1 && path[0] === "bookings") || (path.length === 3 && path[0] === "bookings" && UUID.test(path[1]) && ["complete", "cancel", "move"].includes(path[2]))
    || (path.length === 2 && TEAM.test(path[0]) && path[1] === "pushes");
  if (method === "PUT") return path.length === 2 && TEAM.test(path[0]) && path[1] === "settings";
  return false;
}
