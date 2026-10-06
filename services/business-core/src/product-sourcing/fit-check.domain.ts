import { createHash } from "node:crypto";
import { convert } from "../catalog-core/units";

/**
 * Fit check (plan §0.7 R5, edge case E5-6): will an item get from the street to its room?
 *
 * The rule, in millimetres after unit conversion:
 * - The item is a box with sides a ≤ b ≤ c (from W × D × H). A maker's "diagonal depth" (sofas, recliners) is used
 *   for the tilt rule only.
 * - Handling allowance: every gap must be at least 20 mm (hands, blankets, wrapping) to "fit". A gap between 0 and
 *   20 mm is "tight" (a warning, never a block); a negative gap "does not fit"; a missing measurement is "unknown".
 * - Opening (door, window, stair, corridor, other) W × H: the item goes through lengthwise (c along the way), so its
 *   cross-section a × b must pass the opening, in either orientation.
 *   Tilt rule: with a diagonal depth D', the item tilted back presents D' across the narrow side of the opening and at
 *   most √(a² + b²) along the long side. This is the furniture trade's "door wider than the diagonal depth" rule,
 *   kept conservative by also checking the tilted profile's full diagonal against the other side.
 * - Turn (a corridor or stair landing with a turn width T after a 90° corner of a passage W wide): carried flat on
 *   edge (thickness t across, the other short side upright under the height) or stood upright (c vertical under the
 *   height), the length along the way must not exceed the longest box of thickness t that turns the corner:
 *   L(t) = min over θ of W / sin θ + T / cos θ − t / (sin θ · cos θ). The best carry is used.
 * - Lift: its door is an opening (straight or tilted) and the item must also fit inside the cabin, either square to
 *   the walls or leaned across it: one side along one cabin axis, the other two as a rectangle p × q inside the cabin's
 *   other two sides A × B at an angle (Carver's condition: p ≤ A and q ≤ B, or p > A, q ≤ B and
 *   ((A + B) / (p + q))² + ((A − B) / (p − q))² ≥ 2).
 * - Points on one route are passed one after another, so a route is as bad as its worst point; an item needs one
 *   route that works (the best route decides). No access points recorded → "unknown".
 */
export const FIT_UNITS = ["mm", "cm", "m", "in", "ft"] as const;
export type FitUnit = (typeof FIT_UNITS)[number];
export type FitStatus = "fits" | "tight" | "does_not_fit" | "unknown";
export type FitWay = "straight" | "tilted" | "flat" | "upright" | "square" | "leaned";
export type ItemSize = { width: string | null; depth: string | null; height: string | null; diagonalDepth?: string | null; unit: FitUnit };
export type AccessKind = "door" | "lift" | "stair" | "corridor" | "window" | "other";
export type AccessPoint = {
  id: string; route: string; position: number; kind: AccessKind; label: string; unit: FitUnit;
  width: string | null; height: string | null; turnWidth?: string | null;
  cabinWidth?: string | null; cabinDepth?: string | null; cabinHeight?: string | null;
};
export type PointResult = { pointId: string; label: string; kind: AccessKind; route: string; status: FitStatus; way: FitWay | null; spareMm: number | null; missing: string[] };
export type RouteResult = { route: string; status: FitStatus; points: PointResult[] };
export type FitResult = { status: FitStatus; reason: "no_access_points" | "item_size_missing" | null; routes: RouteResult[]; clearanceMm: number };

export const CLEARANCE_MM = 20;
const SEVERITY: Record<FitStatus, number> = { fits: 0, tight: 1, unknown: 2, does_not_fit: 3 };
export const worse = (a: FitStatus, b: FitStatus) => (SEVERITY[a] >= SEVERITY[b] ? a : b);
export const severity = (status: FitStatus) => SEVERITY[status];

export const toMm = (value: string | null | undefined, unit: FitUnit): number | null =>
  value === null || value === undefined || value === "" ? null : convert(value, unit, "mm").round(1).toNumber();

const statusFor = (spare: number, clearance: number): FitStatus => (spare >= clearance ? "fits" : spare >= 0 ? "tight" : "does_not_fit");
const round = (value: number) => Math.round(value);

/** The longest box of thickness t that turns a 90° corner from a passage w wide into one turn wide. */
export function longestThroughTurn(w: number, turn: number, t: number): number {
  if (t >= w || t >= turn) return -Infinity;
  let best = Infinity;
  for (let step = 1; step < 900; step += 1) {
    const theta = (step / 900) * (Math.PI / 2);
    const s = Math.sin(theta), c = Math.cos(theta);
    best = Math.min(best, w / s + turn / c - t / (s * c));
  }
  return best;
}

/** Carver's condition: does a p × q rectangle fit in an A × B rectangle (at any angle)? */
export function rectangleFits(p0: number, q0: number, a0: number, b0: number): boolean {
  const [p, q] = p0 >= q0 ? [p0, q0] : [q0, p0];
  const [A, B] = a0 >= b0 ? [a0, b0] : [b0, a0];
  if (p <= A && q <= B) return true;
  if (q > B || p === q) return false;
  return ((A + B) / (p + q)) ** 2 + ((A - B) / (p - q)) ** 2 >= 2;
}

type Box = { a: number; b: number; c: number; diagonal: number | null };
type Option = { spare: number; way: FitWay };
const best = (options: Option[]) => options.reduce((top, option) => (option.spare > top.spare ? option : top));

function throughOpening(box: Box, w: number, h: number): Option {
  const narrow = Math.min(w, h), wide = Math.max(w, h);
  const options: Option[] = [{ spare: Math.min(narrow - box.a, wide - box.b), way: "straight" }];
  if (box.diagonal !== null) options.push({ spare: Math.min(narrow - box.diagonal, wide - Math.hypot(box.a, box.b)), way: "tilted" });
  return best(options);
}

function throughTurn(box: Box, w: number, h: number, turn: number): Option {
  const { a, b, c } = box;
  const options: Option[] = [
    // Flat on edge: the thinnest side across, the middle side upright, the longest along the way.
    { spare: Math.min(w - a, turn - a, h - b, longestThroughTurn(w, turn, a) - c), way: "flat" },
    { spare: Math.min(w - b, turn - b, h - a, longestThroughTurn(w, turn, b) - c), way: "flat" },
    // Stood upright: the longest side vertical, the footprint a × b turns the corner.
    { spare: Math.min(w - a, turn - a, h - c, longestThroughTurn(w, turn, a) - b), way: "upright" },
  ];
  return best(options);
}

function insideCabin(box: Box, cabin: [number, number, number], clearance: number): { status: FitStatus; way: FitWay; spare: number | null } {
  const item = [box.a, box.b, box.c];
  const sorted = [...cabin].sort((x, y) => x - y);
  const square = Math.min(...sorted.map((side, index) => side - item[index]));
  if (square >= 0) return { status: statusFor(square, clearance), way: "square", spare: round(square) };
  // Leaned: one item side along one cabin axis, the other two at an angle in the cabin's other two sides.
  let leaned: FitStatus = "does_not_fit";
  for (let along = 0; along < 3; along += 1) for (let axis = 0; axis < 3; axis += 1) {
    const [p, q] = item.filter((_, index) => index !== along);
    const [A, B] = cabin.filter((_, index) => index !== axis);
    if (cabin[axis] - item[along] < 0) continue;
    const roomy = cabin[axis] - item[along] >= clearance && rectangleFits(p + clearance, q + clearance, A, B);
    const status: FitStatus = roomy ? "fits" : rectangleFits(p, q, A, B) ? "tight" : "does_not_fit";
    leaned = SEVERITY[status] < SEVERITY[leaned] ? status : leaned;
  }
  return { status: leaned, way: "leaned", spare: null };
}

/** One access point. */
export function checkPoint(item: ItemSize, point: AccessPoint, clearance = CLEARANCE_MM): PointResult {
  const base = { pointId: point.id, label: point.label, kind: point.kind, route: point.route };
  const sides = [toMm(item.width, item.unit), toMm(item.depth, item.unit), toMm(item.height, item.unit)];
  if (sides.some((side) => side === null)) return { ...base, status: "unknown", way: null, spareMm: null, missing: ["item"] };
  const [a, b, c] = (sides as number[]).sort((x, y) => x - y);
  const box: Box = { a, b, c, diagonal: toMm(item.diagonalDepth ?? null, item.unit) };
  const w = toMm(point.width, point.unit), h = toMm(point.height, point.unit);
  const missing = [...(w === null ? ["width"] : []), ...(h === null ? ["height"] : [])];
  if (point.kind === "lift") {
    const cabin = [toMm(point.cabinWidth, point.unit), toMm(point.cabinDepth, point.unit), toMm(point.cabinHeight, point.unit)];
    if (cabin.some((side) => side === null)) missing.push("cabin");
    if (missing.length) return { ...base, status: "unknown", way: null, spareMm: null, missing };
    const door = throughOpening(box, w!, h!);
    const doorStatus = statusFor(door.spare, clearance);
    const inside = insideCabin(box, cabin as [number, number, number], clearance);
    if (SEVERITY[doorStatus] > SEVERITY[inside.status]) return { ...base, status: doorStatus, way: door.way, spareMm: round(door.spare), missing: [] };
    return { ...base, status: inside.status, way: inside.way, spareMm: inside.spare, missing: [] };
  }
  if (missing.length) return { ...base, status: "unknown", way: null, spareMm: null, missing };
  const straight = throughOpening(box, w!, h!);
  const turn = toMm(point.turnWidth ?? null, point.unit);
  const option = turn !== null && (point.kind === "corridor" || point.kind === "stair")
    ? (() => { const turning = throughTurn(box, w!, h!, turn); return turning.spare < straight.spare ? turning : straight; })()
    : straight;
  return { ...base, status: statusFor(option.spare, clearance), way: option.way, spareMm: Number.isFinite(option.spare) ? round(option.spare) : null, missing: [] };
}

/** Every route; the best route decides. */
export function checkFit(item: ItemSize, points: AccessPoint[], clearance = CLEARANCE_MM): FitResult {
  if (!points.length) return { status: "unknown", reason: "no_access_points", routes: [], clearanceMm: clearance };
  const routes = new Map<string, AccessPoint[]>();
  for (const point of [...points].sort((x, y) => x.position - y.position)) routes.set(point.route, [...(routes.get(point.route) ?? []), point]);
  const results: RouteResult[] = [...routes].map(([route, list]) => {
    const checked = list.map((point) => checkPoint(item, point, clearance));
    return { route, status: checked.reduce<FitStatus>((status, point) => worse(status, point.status), "fits"), points: checked };
  });
  const status = results.reduce<FitStatus>((top, route) => (SEVERITY[route.status] < SEVERITY[top] ? route.status : top), "does_not_fit");
  const sizeMissing = [item.width, item.depth, item.height].some((side) => side === null || side === "");
  return { status, reason: sizeMissing ? "item_size_missing" : null, routes: results, clearanceMm: clearance };
}

/** What a decision was made on: the item's size and every access point, in millimetres. */
export function fitInputsHash(item: ItemSize, points: AccessPoint[]) {
  const canonical = {
    item: [item.width, item.depth, item.height, item.diagonalDepth ?? null].map((value) => toMm(value, item.unit)),
    points: [...points].sort((x, y) => x.id.localeCompare(y.id)).map((point) => [point.id, point.route, point.kind,
      ...[point.width, point.height, point.turnWidth, point.cabinWidth, point.cabinDepth, point.cabinHeight].map((value) => toMm(value ?? null, point.unit))]),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Ordering is blocked (E5-6) only when the check fails with every measurement present; "unknown" and "tight" warn.
 * Items without a size (paint, hardware) and sites without access points never block.
 */
export const blocksOrdering = (status: FitStatus) => status === "does_not_fit";
