/**
 * What the QR code on a printed purchase order or stock move opens (D-46): the phone's receive screen for that
 * order or move. A phone camera opens the link itself; the in-app scanner reads it and stays in the app, taking
 * only the path and the id (never another host).
 */
export type ReceiveTarget = { kind: "order" | "move"; id: string };

export const RECEIVE_PATH = "/workspace/receive";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function receiveHref(target: ReceiveTarget) {
  return `${RECEIVE_PATH}?${new URLSearchParams({ [target.kind]: target.id })}`;
}

export function receiveUrl(origin: string, target: ReceiveTarget) {
  return `${origin.replace(/\/+$/, "")}${receiveHref(target)}`;
}

/** The order or move a scanned code names, or null when it isn't one of ours. */
export function parseReceiveLink(text: string): ReceiveTarget | null {
  let url: URL;
  try { url = new URL(text.trim(), "https://scan.invalid"); } catch { return null; }
  if (url.pathname.replace(/\/+$/, "") !== RECEIVE_PATH) return null;
  for (const kind of ["order", "move"] as const) {
    const id = url.searchParams.get(kind);
    if (id && UUID.test(id)) return { kind, id: id.toLowerCase() };
  }
  return null;
}
