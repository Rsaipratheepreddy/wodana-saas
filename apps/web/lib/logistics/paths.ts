const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The logistics resources each method may reach (bookings, people, vehicles, permits), and nothing else. */
export function allowedLogisticsPath(path: string[], method: string) {
  if (method === "GET") return (path.length === 1 && ["options", "booking", "vehicles"].includes(path[0]))
    || (path.length === 3 && ["projects", "deals"].includes(path[0]) && UUID.test(path[1]) && path[2] === "permits")
    || (path.length === 3 && path[0] === "permits" && UUID.test(path[1]) && path[2] === "file");
  if (method === "POST") return (path.length === 1 && ["bookings", "people", "vehicles"].includes(path[0]))
    || (path.length === 2 && path[0] === "bookings" && ["cancel", "conflicts"].includes(path[1]))
    || (path.length === 4 && ["projects", "deals"].includes(path[0]) && UUID.test(path[1]) && path[2] === "permits" && UUID.test(path[3]))
    || (path.length === 5 && ["projects", "deals"].includes(path[0]) && UUID.test(path[1]) && path[2] === "permits" && UUID.test(path[3]) && path[4] === "withdraw");
  if (method === "PUT") return path.length === 1 && path[0] === "settings";
  return false;
}

/** A permit's file upload: the permit itself, sent as a form with its file. */
export const isPermitUpload = (path: string[]) => path.length === 4 && ["projects", "deals"].includes(path[0]) && path[2] === "permits";
