import type { ShowcaseStop, ShowcaseStory } from "../../seed/showcase";
import { regionAmount, regionPerson, type RegionFixture } from "./scenario-regions";

/**
 * The demo scenarios' stories, told by the showcase engine (src/seed/showcase.ts) in the organization's own people,
 * places and money: an enquiry through planning, design, quotation, the deal file and the project, each stopping where
 * its scenario is. Every story has its own client (a stable number n picks the person) and its own id namespace, so a
 * second run finds what the first made.
 */

export type StoryKey =
  | "design-uploaded" | "design-internal" | "design-client" | "design-changes"
  | "quote-draft" | "quote-qs" | "quote-review" | "quote-approved" | "quote-sent" | "quote-declined" | "quote-discount" | "quote-revision"
  | "deal-finance" | "deal-approval" | "deal-released"
  | `stage-${string}` | "project-completed" | "project-hold" | "project-risk" | "project-budget";

/** Each story's client number in the region's people list (stable: changing it would make a new client). */
const CLIENT: Record<string, number> = {
  "design-uploaded": 21, "design-internal": 22, "design-client": 23, "design-changes": 24,
  "quote-draft": 31, "quote-qs": 32, "quote-review": 33, "quote-approved": 34, "quote-sent": 35, "quote-declined": 36, "quote-discount": 37, "quote-revision": 38,
  "deal-finance": 41, "deal-approval": 42, "deal-released": 43,
  "project-completed": 61, "project-hold": 62, "project-risk": 63, "project-budget": 64,
};
const STAGE_CLIENT = 50;

export type StoryOptions = {
  fixture: RegionFixture;
  country: string;
  /** The region option (emirate, state…) of the workspace that the place's region matches, by id. */
  regionId: (name: string) => string | undefined;
  /** The workspace's project route, in order: a stage story stops at its stage. */
  routeStages: readonly string[];
};

const TERMS = [
  { title: "Advance on signing", percent: 50, trigger: "Signed agreement", requiredForRelease: true, requiredForProduction: false },
  { title: "Before production", percent: 40, trigger: "Before factory production starts", requiredForRelease: false, requiredForProduction: true },
  { title: "On handover", percent: 10, trigger: "At client handover", requiredForRelease: false, requiredForProduction: false },
];

/** One story: the client, the job and how far it goes. */
export function buildStory(key: StoryKey, options: StoryOptions, shape: {
  stop: ShowcaseStop; design?: ShowcaseStory["design"]; stagesUntil?: string | null; handover?: boolean | "issued";
  factory?: "in_production" | "done"; siteStartDaysAgo?: number | null; reports?: number; snags?: ShowcaseStory["execution"]["snags"];
  orders?: ShowcaseStory["execution"]["orders"]; daysAgo?: number; startDaysAgo?: number; promiseDays?: number; productionPayment?: boolean;
  reportAwaitingApproval?: boolean;
}): ShowcaseStory {
  const { fixture } = options;
  const n = key.startsWith("stage-") ? STAGE_CLIENT + Math.max(0, options.routeStages.indexOf(key.slice(6))) : CLIENT[key] ?? 90;
  const person = regionPerson(fixture, n, options.country);
  const home = fixture.homes[n % (fixture.homes.length - 1)];
  const unit = 1100 + n * 7;
  const title = `${person.place.area} ${home} ${unit}`;
  const money = (value: string) => regionAmount(fixture, value);
  const tag = key.toUpperCase().replace(/[^A-Z0-9]+/g, "-");
  const rooms = ["Living room", "Master bedroom", "Kitchen"];
  return {
    key: `scenario-${key}`, ns: `scenario:${key}:`, reference: `SCENARIO-${tag}`, owner: n % 2 ? "sales" : "salesAdmin",
    client: { displayName: person.displayName, email: person.email, mobile: person.mobile, demoCode: "123456" },
    title, area: person.place.area, emirate: options.regionId(person.place.region) ?? "", daysAgo: shape.daysAgo ?? 30, amount: Number(money("60000")),
    summary: `${home} in ${person.place.area}, ${person.place.city}: living room media wall, a fitted wardrobe and new flooring and lighting. Fictional client for the demo scenarios.`,
    pick: { source: n, channel: n, type: /interior|fit.?out|full/i },
    rooms,
    requirements: [
      { key: "living-tv", room: "Living room", title: "Fitted TV wall with hidden storage", note: "Walnut veneer, made in the factory.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: ["TV unit"] },
      { key: "bed-wardrobe", room: "Master bedroom", title: "Hinged wardrobe, wall to wall", note: "Soft-close, matt laminate.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: ["Wardrobe · hinged"] },
      { key: "living-floor", room: "Living room", title: "Engineered oak flooring", note: "Wide plank, matt finish.", category: "Flooring", priority: "preferred", quantity: 40, unit: "sqm", catalog: ["Engineered oak flooring 14mm"] },
      { key: "kitchen-lights", room: "Kitchen", title: "Warm downlights", note: "Dimmable.", category: "Lighting", priority: "preferred", quantity: 10, unit: "nos", catalog: ["LED downlight 9W warm"] },
    ],
    inspiration: [{ key: "mood-walnut", title: "Walnut and warm white", catalog: ["Walnut veneer"] }, { key: "mood-oak", title: "Oak floor, off-white walls", catalog: ["Engineered oak flooring 14mm"] }],
    measurement: { requirement: "living-tv", title: "TV wall opening", width: 3600, height: 2700 },
    design: shape.design ?? "accepted",
    lines: [
      { key: "living-tv", room: "Living room", catalog: ["TV unit", "media"], title: "Fitted TV wall · walnut veneer, hidden storage", quantity: "1", unit: "nos", unitCost: money("7400"), rate: money("12900") },
      { key: "bed-wardrobe", room: "Master bedroom", catalog: ["Wardrobe · hinged", "wardrobe"], title: "Hinged wardrobe · wall to wall, matt laminate", quantity: "1", unit: "nos", unitCost: money("8400"), rate: money("14500") },
      { key: "living-floor", room: "Living room", catalog: ["Engineered oak flooring 14mm", "flooring"], quantity: "40", unit: "sqm", unitCost: money("190"), rate: money("320") },
      { key: "kitchen-lights", room: "Kitchen", catalog: ["LED downlight 9W warm", "downlight", "light"], quantity: "10", unit: "nos", unitCost: money("45"), rate: money("95") },
      { key: "living-paint", room: "Living room", catalog: ["Wall painting, 2 coats", "paint"], quantity: "110", unit: "sqm", unitCost: money("14"), rate: money("28") },
    ],
    terms: TERMS, stop: shape.stop, made: /tv wall|wardrobe/i,
    materials: [
      { name: "Walnut veneer, natural", code: "WAL-NAT", specification: "Quarter cut, matt lacquer, 0.6 mm on 18 mm MDF", quantity: "10", unit: "sheet" },
      { name: "Soft-close hinges and drawer runners", code: "HW-SC", specification: "Concealed 110° hinges; full-extension runners", quantity: "24", unit: "nos" },
    ],
    messages: [],
    execution: {
      startDaysAgo: shape.startDaysAgo ?? 14, promiseDays: shape.promiseDays ?? 60, productionPayment: shape.productionPayment ?? true,
      updates: [], tasks: [
        { key: "task:drawings", title: "Shop drawings for the TV wall and wardrobe", role: "designer", start: -10, due: -5, made: true, status: "done" },
        { key: "task:installation", title: "Install the TV wall and wardrobe", role: "site", start: shape.handover === true ? -6 : 6, due: shape.handover === true ? -2 : 10, made: true,
          ...(shape.handover === true ? { status: "done" as const } : {}) },
      ],
      orders: shape.orders ?? [], factory: shape.factory ?? "in_production", siteStartDaysAgo: shape.siteStartDaysAgo ?? null, reports: shape.reports ?? 0,
      reportAwaitingApproval: shape.reportAwaitingApproval,
      snags: shape.snags ?? [], stagesUntil: shape.stagesUntil === undefined ? null : shape.stagesUntil, handover: shape.handover ?? false,
      handoverOpenReason: "The client asked to walk through this week.",
    },
  };
}

const RECEIVED = (expected: number): ShowcaseStory["execution"]["orders"] => [
  { key: "joinery-materials", label: "joinery materials", pick: "materials", supplier: 0, state: "received", expected, promised: expected + 1 },
  { key: "fit-out-supplies", label: "flooring and lighting", pick: /./, supplier: 1, state: "received", expected, promised: expected + 1 },
];

/** Every story the scenarios can tell, by key, for this organization. */
export function storyCatalog(options: StoryOptions): Map<StoryKey, ShowcaseStory> {
  const stories = new Map<StoryKey, ShowcaseStory>();
  const add = (key: StoryKey, shape: Parameters<typeof buildStory>[2]) => stories.set(key, buildStory(key, options, shape));
  add("design-uploaded", { stop: "planning", design: "uploaded", daysAgo: 6 });
  add("design-internal", { stop: "planning", design: "internal_review", daysAgo: 9 });
  add("design-client", { stop: "planning", design: "client_review", daysAgo: 12 });
  add("design-changes", { stop: "planning", design: "changes_requested", daysAgo: 15 });
  add("quote-draft", { stop: "quotation_draft", daysAgo: 18 });
  add("quote-qs", { stop: "quotation_qs", daysAgo: 19 });
  add("quote-review", { stop: "quotation_review", daysAgo: 20 });
  add("quote-approved", { stop: "quotation_approved", daysAgo: 21 });
  add("quote-sent", { stop: "quotation_issued", daysAgo: 22 });
  add("quote-declined", { stop: "quotation_issued", daysAgo: 40 });
  add("quote-discount", { stop: "quotation_draft", daysAgo: 23 });
  add("quote-revision", { stop: "quotation_issued", daysAgo: 26 });
  add("deal-finance", { stop: "deal_finance", daysAgo: 28 });
  add("deal-approval", { stop: "deal_approval", daysAgo: 30 });
  add("deal-released", { stop: "accepted", daysAgo: 33 });
  const route = options.routeStages;
  const at = (stage: string) => route.indexOf(stage);
  for (const stage of route) {
    const index = at(stage);
    const past = (other: string) => at(other) >= 0 && index > at(other);
    add(`stage-${stage}`, {
      stop: past("installation") || stage === "installation" ? "site" : "project", stagesUntil: stage, daysAgo: 50 + index * 6, startDaysAgo: 10 + index * 5,
      orders: past("procurement") ? RECEIVED(-(8 + index)) : stage === "procurement" ? [
        { key: "joinery-materials", label: "joinery materials", pick: "materials", supplier: 0, state: "received", expected: -6, promised: -5 },
        { key: "fit-out-supplies", label: "flooring and lighting", pick: /./, supplier: 1, state: "confirmed", expected: 5, promised: 7 },
      ] : [],
      factory: past("production") ? "done" : "in_production",
      siteStartDaysAgo: past("permit") ? 6 : null, reports: past("permit") ? 3 : 0,
      snags: stage === "snagging" ? [{ key: "snag:1", title: "Wardrobe door rubs on the frame", severity: "minor", source: "inspection", room: "Master bedroom", close: false }] : [],
      handover: stage === "handover" ? "issued" : false,
    });
  }
  add("project-completed", { stop: "handover", daysAgo: 120, startDaysAgo: 70, promiseDays: -5, orders: RECEIVED(-40), factory: "done", siteStartDaysAgo: 20, reports: 3,
    snags: [{ key: "snag:1", title: "Touch up paint by the window", severity: "minor", source: "inspection", room: "Living room", close: true }], handover: true });
  add("project-hold", { stop: "project", stagesUntil: route.includes("procurement") ? "procurement" : route[1] ?? null, daysAgo: 45, startDaysAgo: 20 });
  add("project-risk", { stop: "site", stagesUntil: route.includes("production") ? "production" : null, daysAgo: 60, startDaysAgo: 30, promiseDays: 12,
    orders: [
      { key: "joinery-materials", label: "joinery materials", pick: "materials", supplier: 0, state: "received", expected: -12, promised: -10 },
      { key: "fit-out-supplies", label: "flooring and lighting", pick: /./, supplier: 1, state: "confirmed", expected: -7, promised: -5 },
    ], factory: "in_production", siteStartDaysAgo: 8, reports: 1 });
  add("project-budget", { stop: "site", stagesUntil: route.includes("installation") ? "installation" : null, daysAgo: 70, startDaysAgo: 35, orders: RECEIVED(-20),
    factory: "done", siteStartDaysAgo: 6, reports: 2, reportAwaitingApproval: true });
  return stories;
}
