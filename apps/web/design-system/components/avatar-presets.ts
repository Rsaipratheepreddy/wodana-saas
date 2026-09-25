/**
 * Default people avatars: line portraits in one ink, drawn on a 64×64 grid.
 * Plain data (no JSX) so web and mobile render the same shapes.
 * Ink follows the text colour and skin/cloth follow the surface, so they
 * work in light and dark themes and with any tenant brand.
 */
export type AvatarShape = ["path" | "circle" | "ellipse", Record<string, string | number>];
export type AvatarPreset = { id: string; set: "a" | "b"; shapes: AvatarShape[] };

const INK = "currentColor";
const SKIN = "var(--wd-color-surface)";
const line = { fill: "none", stroke: INK, "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round" } as const;
const solid = (d: string): AvatarShape => ["path", { d, fill: INK }];
const outlined = (d: string, fill = SKIN): AvatarShape => ["path", { d, fill, stroke: INK, "stroke-width": 2.2, "stroke-linejoin": "round" }];
const stroke = (d: string, width = 2.2): AvatarShape => ["path", { d, ...line, "stroke-width": width }];

const TOPS = {
  crew: [outlined("M11 66 C12 56 20 51.5 32 51.5 C44 51.5 52 56 53 66 Z"), stroke("M27 52 Q32 55.5 37 52")],
  vneck: [outlined("M11 66 C12 56 20 51.5 32 51.5 C44 51.5 52 56 53 66 Z"), stroke("M27 52 L32 58.5 L37 52")],
  shirt: [outlined("M11 66 C12 56 20 51.5 32 51.5 C44 51.5 52 56 53 66 Z"), stroke("M27 51.5 L29.5 57 L32 53.5 L34.5 57 L37 51.5"), stroke("M32 57 V66")],
  dark: [outlined("M11 66 C12 56 20 51.5 32 51.5 C44 51.5 52 56 53 66 Z", INK)],
  turtle: [outlined("M11 66 C12 56 20 51.5 32 51.5 C44 51.5 52 56 53 66 Z", INK), outlined("M26.5 48 H37.5 V53.5 Q32 55 26.5 53.5 Z")],
} satisfies Record<string, AvatarShape[]>;

const NECK = outlined("M27.5 43 V52 Q32 54.5 36.5 52 V43 Z");
const EARS: AvatarShape[] = [["circle", { cx: 20, cy: 33, r: 3, fill: SKIN, stroke: INK, "stroke-width": 2.2 }], ["circle", { cx: 44, cy: 33, r: 3, fill: SKIN, stroke: INK, "stroke-width": 2.2 }]];
const FACE: AvatarShape = ["ellipse", { cx: 32, cy: 32, rx: 12, ry: 14, fill: SKIN, stroke: INK, "stroke-width": 2.2 }];
const EYES: AvatarShape[] = [["circle", { cx: 27.5, cy: 32.5, r: 1.4, fill: INK }], ["circle", { cx: 36.5, cy: 32.5, r: 1.4, fill: INK }]];
const NOSE = stroke("M32.2 34 Q29.8 38.4 32.6 38.9", 1.8);
const SMILE = stroke("M28.5 41.5 Q32 44.3 35.5 41.5", 1.9);
const CALM = stroke("M29.5 42.3 H34.5", 1.9);
const BROWS = [stroke("M25 29 Q27.5 27.6 30 28.6", 1.8), stroke("M34 28.6 Q36.5 27.6 39 29", 1.8)];
const GLASSES: AvatarShape[] = [["circle", { cx: 27.5, cy: 32.5, r: 4.1, ...line, "stroke-width": 1.9 }], ["circle", { cx: 36.5, cy: 32.5, r: 4.1, ...line, "stroke-width": 1.9 }], stroke("M31.6 32.3 H32.4", 1.9)];
const EARRINGS: AvatarShape[] = [["circle", { cx: 20, cy: 38, r: 1.4, ...line, "stroke-width": 1.6 }], ["circle", { cx: 44, cy: 38, r: 1.4, ...line, "stroke-width": 1.6 }]];
/** A carpenter's pencil tucked behind the ear. */
const PENCIL: AvatarShape[] = [stroke("M41.5 21 L49.5 30.5", 3.4), ["path", { d: "M49.5 30.5 L51.3 32.8 L48.3 31.8 Z", fill: INK }]];
/** Site safety helmet with brim and ridge. */
const HELMET: AvatarShape[] = [outlined("M17.5 26.5 C17.5 16.5 24 11 32 11 C40 11 46.5 16.5 46.5 26.5 Z"), stroke("M14 27 H50", 3), stroke("M32 11.5 V19", 1.9), stroke("M25 13.5 Q24 19 24.5 26", 1.6), stroke("M39 13.5 Q40 19 39.5 26", 1.6)];

const BEARD = solid("M20 33 C20.5 44 26 49 32 49 C38 49 43.5 44 44 33 C42.5 39.5 38.5 40.5 32 40.5 C25.5 40.5 21.5 39.5 20 33 Z");
const BEARD_MOUTH = ["path", { d: "M29 43 Q32 44.8 35 43", fill: "none", stroke: SKIN, "stroke-width": 1.9, "stroke-linecap": "round" }] as AvatarShape;
const MOUSTACHE = solid("M26.8 40.8 Q29.5 38 32 39.4 Q34.5 38 37.2 40.8 Q34.5 40 32 41 Q29.5 40 26.8 40.8 Z");
const GOATEE = solid("M29.5 45 Q32 49 34.5 45 Q32 46.3 29.5 45 Z");
const STUBBLE = stroke("M23 41 Q32 50 41 41", 1.2);

const face = (hair: AvatarShape[], extras: AvatarShape[] = [], mouth: AvatarShape = SMILE) => [FACE, ...EYES, NOSE, mouth, ...hair, ...extras];

const base = (top: AvatarShape[], back: AvatarShape[] = [], ears = true) => [...back, ...top, NECK, ...(ears ? EARS : [])];

const preset = (id: string, set: "a" | "b", shapes: AvatarShape[]): AvatarPreset => ({ id, set, shapes });

export const AVATAR_PRESETS: AvatarPreset[] = [
  // Set A
  preset("a01", "a", [...base(TOPS.crew), ...face([solid("M19.6 30 C18 19.5 25 14.5 32 14.5 C39.5 14.5 46 19.5 44.4 30 C43 24.5 39.5 21.5 34.5 21.5 C29 21.5 23.5 23 19.6 30 Z")], BROWS)]),
  preset("a02", "a", [...base(TOPS.shirt), ...face([solid("M20 29.5 C19 19 26 13 34 13.5 C41 13.5 46.5 19 44 29.5 C43 24 39 21 33 21 C28 21 23.5 23.5 20 29.5 Z"), solid("M29 15 C31 9.5 39 9 42.5 14.5 C38 13 33 13.5 29 15 Z")], PENCIL)]),
  preset("a03", "a", [...base(TOPS.dark), ...face([
    ["circle", { cx: 21.5, cy: 25, r: 4.4, fill: INK }], ["circle", { cx: 25.5, cy: 19.5, r: 4.6, fill: INK }], ["circle", { cx: 32, cy: 17.2, r: 4.8, fill: INK }],
    ["circle", { cx: 38.5, cy: 19.5, r: 4.6, fill: INK }], ["circle", { cx: 42.5, cy: 25, r: 4.4, fill: INK }], ["circle", { cx: 20.3, cy: 29.5, r: 2.8, fill: INK }], ["circle", { cx: 43.7, cy: 29.5, r: 2.8, fill: INK }],
  ])]),
  preset("a04", "a", [...base(TOPS.crew), ...face([solid("M20 28 C19.5 20 25 16.5 32 16.5 C39 16.5 44.5 20 44 28 C41 24.5 37 23.5 32 23.5 C27 23.5 23 24.5 20 28 Z"), BEARD, BEARD_MOUTH], BROWS, CALM)]),
  preset("a05", "a", [...base(TOPS.turtle), ...face([stroke("M20.3 29 Q21 25.5 23 24.5", 2.4), stroke("M43.7 29 Q43 25.5 41 24.5", 2.4), GOATEE], GLASSES)]),
  preset("a06", "a", [...base(TOPS.crew), ...face([
    outlined("M18.5 29 C18 17.5 24.5 11.5 32 11.5 C39.5 11.5 46 17.5 45.5 29 Z"), outlined("M17.8 24.5 H46.2 V30.2 Q32 31.8 17.8 30.2 Z"),
    stroke("M23 12.8 V24.2", 1.4), stroke("M27.5 11.8 V24.2", 1.4), stroke("M32 11.5 V24.2", 1.4), stroke("M36.5 11.8 V24.2", 1.4), stroke("M41 12.8 V24.2", 1.4), MOUSTACHE,
  ], [], CALM)]),
  preset("a07", "a", [...base(TOPS.shirt), ...face([stroke("M20.3 30 V26.5", 2.6), stroke("M43.7 30 V26.5", 2.6), STUBBLE], HELMET)]),
  preset("a08", "a", [...base(TOPS.vneck), ...face([solid("M19.8 30 C18.5 20 25 15 32 15 C39 15 45.5 20 44.2 30 C43 25 39 21.5 32 21.5 C25 21.5 21 25 19.8 30 Z"), ["circle", { cx: 32, cy: 11.5, r: 4.4, fill: INK }], BEARD, BEARD_MOUTH])]),
  preset("a09", "a", [...base(TOPS.dark), ...face([solid("M19.6 31 C17.5 19 24.5 13.5 32 13.5 C40 13.5 46.5 19 44.4 31 C43.5 27 42 25 39.5 24 C38 26 35.5 24.5 34 22.8 C32 25 29 24.5 27.5 22.8 C26 25 23 25.2 21.8 24.4 C20.5 26 20 28.5 19.6 31 Z")], [...GLASSES, ...PENCIL])]),
  preset("a10", "a", [
    ...TOPS.shirt, outlined("M15.5 62 C15.5 45 16.5 30 19 23 C21.5 15.5 26.5 12 32 12 C37.5 12 42.5 15.5 45 23 C47.5 30 48.5 45 48.5 62 Z"), NECK,
    ...face([outlined("M19.3 27 C19.8 17.5 25.5 13 32 13 C38.5 13 44.2 17.5 44.7 27 C40.5 23.5 36.5 22.5 32 22.5 C27.5 22.5 23.5 23.5 19.3 27 Z"), stroke("M18.8 19.5 Q32 13.5 45.2 19.5", 3.2), stroke("M19.2 22.6 Q32 16.8 44.8 22.6", 2.4), BEARD, BEARD_MOUTH]),
  ]),

  // Set B
  preset("b01", "b", [...base(TOPS.crew), ...face([solid("M19.6 31 C18 19 25 14.5 32 14.5 C39 14.5 46 19 44.4 31 C44 25 40 21 33 21 C27 21 22 25 19.6 31 Z"), solid("M36 15 C39.5 7.5 48 6 50.5 12 C52.5 18 47.5 24 45 28 C46 21 44 17 36 15 Z"), stroke("M37.8 13.3 L40.2 16", 2.8)])]),
  preset("b02", "b", [...base(TOPS.vneck), ...face([solid("M19.8 30 C18.5 20 25 15.5 32 15.5 C39 15.5 45.5 20 44.2 30 C43 24.5 38.5 21.5 32 21.5 C25.5 21.5 21 24.5 19.8 30 Z"), ["circle", { cx: 32, cy: 11, r: 5.2, fill: INK }]], GLASSES)]),
  preset("b03", "b", [...base(TOPS.crew, [solid("M18 30 C17 18 24 13 32 13 C40 13 47 18 46 30 L47.5 53 C44.5 55 41.5 55 40.5 53 L23.5 53 C22.5 55 19.5 55 16.5 53 Z")]), ...face([solid("M20 31 C20 20 26 15.5 32 15.5 C38 15.5 44 20 44 31 C42 24 36.5 21 32 18.5 C27.5 21 22 24 20 31 Z")], EARRINGS)]),
  preset("b04", "b", [...base(TOPS.turtle, [solid("M17 30 C16 18 24 13 32 13 C40 13 48 18 47 30 L47 42.5 C43 44.5 21 44.5 17 42.5 Z")]), ...face([solid("M20 27.5 C19.5 19 25.5 15 32 15 C38.5 15 44.5 19 44 27.5 Z")])]),
  preset("b05", "b", [...base(TOPS.shirt, [
    ["circle", { cx: 32, cy: 23, r: 13, fill: INK }], ["circle", { cx: 20, cy: 22, r: 7.5, fill: INK }], ["circle", { cx: 44, cy: 22, r: 7.5, fill: INK }],
    ["circle", { cx: 18, cy: 31, r: 6.5, fill: INK }], ["circle", { cx: 46, cy: 31, r: 6.5, fill: INK }], ["circle", { cx: 25, cy: 13.5, r: 6.5, fill: INK }], ["circle", { cx: 39, cy: 13.5, r: 6.5, fill: INK }],
  ]), ...face([solid("M20.5 26 C22 20.5 26.5 19 32 19 C37.5 19 42 20.5 43.5 26 C39.5 23.5 35.5 23 32 23 C28.5 23 24.5 23.5 20.5 26 Z")], EARRINGS)]),
  preset("b06", "b", [
    ...TOPS.crew, outlined("M14.5 63 C14.5 46 15.5 29.5 19.5 21.5 C22.5 15 27 12.5 32 12.5 C37 12.5 41.5 15 44.5 21.5 C48.5 29.5 49.5 46 49.5 63 Z"), NECK,
    ...face([outlined("M19.8 27 C20.5 18.5 26 15 32 15 C38 15 43.5 18.5 44.2 27 C40 23.2 36 22.3 32 22.3 C28 22.3 24 23.2 19.8 27 Z"), stroke("M20 44 Q32 55 44 44", 1.6)]),
  ]),
  preset("b07", "b", [...base(TOPS.vneck), ...face([
    solid("M19.6 31 C18 19 24.5 14.5 31 14.5 C39.5 14.5 46.5 19.5 44.4 31 C43 25.5 39 20.5 29 22.5 C25 23.5 21.5 26.5 19.6 31 Z"),
    ["ellipse", { cx: 45, cy: 38, rx: 3.3, ry: 3.8, fill: INK }], ["ellipse", { cx: 46, cy: 44.5, rx: 3.1, ry: 3.6, fill: INK }], ["ellipse", { cx: 46.2, cy: 50.8, rx: 2.9, ry: 3.4, fill: INK }], ["ellipse", { cx: 45.6, cy: 56.6, rx: 2.4, ry: 2.9, fill: INK }],
  ])]),
  preset("b08", "b", [...base(TOPS.dark), ...face([solid("M19.6 31 C18 19 25 14 33 14 C41 14 46.5 20 44.4 30 C43 24 38 21 28 25 C24 27 21.5 28.5 19.6 31 Z")], EARRINGS)]),
  preset("b09", "b", [...base(TOPS.crew, [solid("M17 31 C16 18 24 13 32 13 C40 13 48 18 47 31 C49 38 46 42 48.5 48.5 C44.5 50.5 42 48.5 41 46.5 L23 46.5 C22 48.5 19.5 50.5 15.5 48.5 C18 42 15 38 17 31 Z")]), ...face([solid("M20 30 C19.5 20 25.5 15.5 32 15.5 C38.5 15.5 44.5 20 44 30 C42.5 25.5 40 23 37 22 C33 25.5 26 26 20 30 Z")], PENCIL)]),
  preset("b10", "b", [...base(TOPS.shirt, [solid("M41 29 C48.5 32 50.5 43 46 51 C45 44.5 43 38.5 41 34 Z")]), ...face([stroke("M20.3 30 V26.5", 2.6), stroke("M43.7 30 V26.5", 2.6)], [...HELMET, ...EARRINGS])]),
];

export const AVATAR_PRESET_IDS = AVATAR_PRESETS.map((entry) => entry.id);

/** Stable default for someone without a photo or a chosen avatar. */
export function defaultAvatarPreset(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_PRESETS[hash % AVATAR_PRESETS.length];
}

export function avatarPresetById(id: string | null | undefined) {
  return id ? AVATAR_PRESETS.find((entry) => entry.id === id) ?? null : null;
}
