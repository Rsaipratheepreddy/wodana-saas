/**
 * Drawing on a photo: marks are kept in the photo's own coordinates (0–1 across and down), so they sit in
 * the same place whatever size the photo is shown or saved at. Pure functions only.
 */
export type Point = { x: number; y: number };
export type PenMark = { kind: 'pen'; color: string; width: number; points: Point[] };
export type ArrowMark = { kind: 'arrow'; color: string; width: number; from: Point; to: Point };
export type TextMark = { kind: 'text'; color: string; text: string; at: Point; size: number };
export type Mark = PenMark | ArrowMark | TextMark;

/** Annotation colours: picked to read on any photo, not theme colours. */
export const MARK_COLORS = ['#FF3B30', '#FFCC00', '#34C759', '#0A84FF', '#FFFFFF', '#111111'] as const;
/** Pen widths as a share of the photo's width. */
export const MARK_WIDTHS = { thin: 0.006, thick: 0.014 } as const;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const normalise = (x: number, y: number, width: number, height: number): Point => ({ x: clamp(x / width), y: clamp(y / height) });

/** Add a point to a stroke unless it's too close to the last one (keeps strokes light). */
export function addPoint(points: Point[], next: Point, minDistance = 0.004) {
  const last = points[points.length - 1];
  if (last && Math.hypot(next.x - last.x, next.y - last.y) < minDistance) return points;
  return [...points, next];
}

/** A smooth SVG path through a stroke's points at a given drawing size. */
export function penPath(points: Point[], width: number, height: number) {
  if (!points.length) return '';
  const at = (point: Point) => `${(point.x * width).toFixed(1)} ${(point.y * height).toFixed(1)}`;
  if (points.length === 1) return `M ${at(points[0])} L ${at({ x: points[0].x + 0.0001, y: points[0].y })}`;
  let path = `M ${at(points[0])}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const mid = { x: (points[index].x + points[index + 1].x) / 2, y: (points[index].y + points[index + 1].y) / 2 };
    path += ` Q ${at(points[index])} ${at(mid)}`;
  }
  return `${path} L ${at(points[points.length - 1])}`;
}

/** The two short lines of an arrow's head, as points in the photo's coordinates. */
export function arrowHead(from: Point, to: Point, width: number, height: number, length = 0.04): [Point, Point] {
  const angle = Math.atan2((to.y - from.y) * height, (to.x - from.x) * width);
  const size = length * width;
  const wing = (turn: number): Point => ({
    x: clamp((to.x * width - size * Math.cos(angle + turn)) / width),
    y: clamp((to.y * height - size * Math.sin(angle + turn)) / height),
  });
  return [wing(Math.PI / 7), wing(-Math.PI / 7)];
}

export function arrowPath(mark: ArrowMark, width: number, height: number) {
  const [left, right] = arrowHead(mark.from, mark.to, width, height);
  const at = (point: Point) => `${(point.x * width).toFixed(1)} ${(point.y * height).toFixed(1)}`;
  return `M ${at(mark.from)} L ${at(mark.to)} M ${at(left)} L ${at(mark.to)} L ${at(right)}`;
}

/** Keep at most `max` points, evenly spaced, always keeping the first and last. */
export function decimate(points: Point[], max: number) {
  if (points.length <= max) return points;
  if (max < 2) return points.slice(0, max);
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => points[Math.round(index * step)]);
}

/**
 * The marks as the server's photo markup takes them: freehand polylines only (≤100 strokes, ≤1500 points
 * each, ≤4000 in total, widths 0.001–0.03). Arrows become three short lines; text can't be sent this way.
 */
export function toServerStrokes(marks: Mark[]) {
  const strokes: Array<{ color: string; width: number; points: Point[] }> = [];
  for (const mark of marks) {
    if (mark.kind === 'pen' && mark.points.length) strokes.push({ color: mark.color, width: mark.width, points: mark.points });
    if (mark.kind === 'arrow') {
      const [left, right] = arrowHead(mark.from, mark.to, 1, 1);
      strokes.push({ color: mark.color, width: mark.width, points: [mark.from, mark.to] });
      strokes.push({ color: mark.color, width: mark.width, points: [left, mark.to, right] });
    }
  }
  const kept = strokes.slice(0, 100).map((stroke) => ({ ...stroke, width: Math.max(0.001, Math.min(0.03, stroke.width)), points: decimate(stroke.points, 1500) }));
  const total = kept.reduce((sum, stroke) => sum + stroke.points.length, 0);
  if (total <= 4000) return kept;
  const share = 4000 / total;
  return kept.map((stroke) => ({ ...stroke, points: decimate(stroke.points, Math.max(1, Math.floor(stroke.points.length * share))) }));
}

/** The size to show a photo at inside a frame, keeping its shape. */
export function fit(photoWidth: number, photoHeight: number, frameWidth: number, frameHeight: number) {
  if (!photoWidth || !photoHeight || !frameWidth || !frameHeight) return { width: 0, height: 0 };
  const scale = Math.min(frameWidth / photoWidth, frameHeight / photoHeight);
  return { width: Math.floor(photoWidth * scale), height: Math.floor(photoHeight * scale) };
}

/**
 * The size to ask the view capture for, and the pixels that come back. The flattened photo keeps the photo's
 * own size up to `longEdge`. iOS renders the capture at the screen's scale (a 3x phone turns 2048 points
 * into 6144 pixels: nine times the memory and a far larger upload), so there the request is in points;
 * Android and the web take pixels.
 */
export function captureSize(photoWidth: number, photoHeight: number, pixelRatio: number, os: string, longEdge = 2048) {
  const scale = Math.min(1, longEdge / Math.max(photoWidth, photoHeight, 1));
  const output = { width: Math.max(1, Math.round(photoWidth * scale)), height: Math.max(1, Math.round(photoHeight * scale)) };
  const ratio = os === 'ios' && pixelRatio > 0 ? pixelRatio : 1;
  return { output, request: { width: Math.max(1, Math.round(output.width / ratio)), height: Math.max(1, Math.round(output.height / ratio)) } };
}
