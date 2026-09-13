import type { CommercialCatalogChoice } from "@/components/commercial/catalog-picker";
import type { Quote } from "./types";
import { applyRoom, catalogItem, roomNames, selection } from "./room-builder";
import { itemContext } from "./item-context";
import { updateMaterials } from "./materials";
export type SuggestionItem = {
  work: CommercialCatalogChoice;
  variant: CommercialCatalogChoice | null;
  materials: CommercialCatalogChoice[];
  reason: string;
  sourceIds: string[];
};
export type RoomSuggestion = {
  id: string;
  name: string;
  room: CommercialCatalogChoice | null;
  reason: string;
  sourceIds: string[];
  items: SuggestionItem[];
};
export type QuotationAnalysis = {
  summary: string;
  rooms: RoomSuggestion[];
  sources: {
    requirements: number;
    inspirations: number;
    layouts: number;
    measurements: number;
  };
  filesAnalyzed: number;
  notes: string[];
  review: string[];
  coverage: { total: number; linked: number };
  analyzedAt: string;
};
export type AssistCatalogRecord = CommercialCatalogChoice & {
  content?: {
    description?: string;
    configuration?: Record<string, string | number>;
    aliases?: string[];
  };
};
export type AssistLink = {
  recordId: string;
  targetId: string;
  relation: string;
};
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** Resolve every model reference against the authorized graph. Model rates and quantities are never accepted. */
export function resolveRoomSuggestions(
  raw: unknown,
  records: AssistCatalogRecord[],
  links: AssistLink[],
  sourceIds: Set<string>,
): Pick<QuotationAnalysis, "summary" | "rooms"> {
  const data = object(raw),
    index = new Map(records.map((r) => [r.id, r]));
  const related = (a: string, b: string, role?: string) =>
    links.some(
      (l) =>
        ((l.recordId === a && l.targetId === b) ||
          (l.recordId === b && l.targetId === a)) &&
        (!role || l.relation === role),
    );
  const choice = (r: AssistCatalogRecord): CommercialCatalogChoice => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    code: r.code,
    version: r.version,
    catalogId: r.catalogId,
    catalogName: r.catalogName,
    description: r.content?.description,
    configuration:
      r.kind === "unit"
        ? {
            ...r.content?.configuration,
            symbol: String(
              r.content?.configuration?.symbol ??
                r.content?.aliases?.[0] ??
                r.code,
            ),
          }
        : r.content?.configuration,
  });
  const roomSeen = new Set<string>();
  const rooms = (Array.isArray(data.rooms) ? data.rooms : [])
    .slice(0, 100)
    .flatMap((value) => {
      const row = object(value),
        room = index.get(text(row.roomId, 80));
      const sources = (
        Array.isArray(row.sourceIds) ? row.sourceIds : []
      ).filter((s): s is string => typeof s === "string" && sourceIds.has(s));
      const name = text(row.name, 120) || text(room?.name, 120);
      const roomKey = name.toLocaleLowerCase();
      if (
        !room ||
        room.kind !== "room" ||
        !sources.length ||
        roomSeen.has(roomKey)
      )
        return [];
      roomSeen.add(roomKey);
      const itemSeen = new Set<string>();
      const items = (Array.isArray(row.items) ? row.items : [])
        .slice(0, 300)
        .flatMap((value) => {
          const item = object(value),
            work = index.get(text(item.workId, 80)),
            variant = index.get(text(item.variantId, 80));
          if (
            !work ||
            work.kind !== "work" ||
            !related(work.id, room.id, "room") ||
            itemSeen.has(work.id)
          )
            return [];
          itemSeen.add(work.id);
          const validVariant =
            variant?.kind === "variant" && related(variant.id, work.id, "work")
              ? variant
              : null;
          const anchor = validVariant?.id ?? work.id;
          const recipeIds = new Set(
            Array.isArray(item.materialIds) && item.materialIds.length
              ? itemContext(
                  records,
                  links,
                  work.id,
                  validVariant?.id,
                ).materials.flatMap((row) => row.choices.map((c) => c.id))
              : [],
          );
          const materials = [
            ...new Set(
              (Array.isArray(item.materialIds) ? item.materialIds : []).filter(
                (id): id is string => typeof id === "string",
              ),
            ),
          ]
            .map((id) => index.get(id))
            .filter(
              (r): r is AssistCatalogRecord =>
                !!r &&
                [
                  "material",
                  "sku",
                  "hardware",
                  "consumable",
                  "finish",
                ].includes(r.kind) &&
                (related(r.id, anchor) || recipeIds.has(r.id)),
            )
            .slice(0, 8)
            .map(choice);
          const unitLink = links.find(
            (l) => l.recordId === work.id && l.relation === "unit",
          );
          const unit = unitLink ? index.get(unitLink.targetId) : null;
          const itemSources = (
            Array.isArray(item.sourceIds) ? item.sourceIds : []
          ).filter(
            (id): id is string => typeof id === "string" && sourceIds.has(id),
          );
          return [
            {
              work: {
                ...choice(work),
                links: unit
                  ? [
                      {
                        role: "unit",
                        recordId: unit.id,
                        snapshot: choice(unit),
                      },
                    ]
                  : [],
              },
              variant: validVariant ? choice(validVariant) : null,
              materials,
              reason: text(item.reason, 350),
              sourceIds: itemSources,
            },
          ];
        });
      return [
        {
          id: name === room.name ? room.id : `${room.id}:${name}`,
          name,
          room: choice(room),
          reason: text(row.reason, 500),
          sourceIds: sources,
          items,
        },
      ];
    });
  return { summary: text(data.summary, 800), rooms };
}
export function addSuggestedRoom(
  quote: Quote,
  suggestion: RoomSuggestion,
): Quote {
  if (
    quote.direction === "deduction" ||
    roomNames(quote).length >= 100 ||
    roomNames(quote).some(
      (name) => name.toLowerCase() === suggestion.name.toLowerCase(),
    )
  )
    return quote;
  const lines = suggestion.items.slice(0, 300 - quote.lines.length).map((s) => {
    let line = catalogItem(suggestion.name, s.work);
    if (s.variant)
      line = {
        ...line,
        catalogLinks: [
          ...(line.catalogLinks ?? []),
          selection("variant", s.variant),
        ],
      };
    for (const role of ["material", "finish"] as const) {
      const chosen = s.materials
        .filter((m) => (m.kind === "finish") === (role === "finish"))
        .slice(0, 12 - (line.catalogLinks?.length ?? 0));
      line = updateMaterials(
        line,
        role,
        chosen.map((m) => selection(role, m)),
      );
    }
    return line;
  });
  return applyRoom(quote, null, suggestion.name, suggestion.room, lines);
}

/** Suggestions only append missing items. Never replace a manually edited room. */
export function addQuotationSuggestions(
  quote: Quote,
  suggestions: RoomSuggestion[],
): Quote {
  if (quote.direction === "deduction") return quote;
  let next = quote;
  for (const suggestion of suggestions) {
    if (!suggestion.items.length || next.lines.length >= 300) continue;
    const name = roomNames(next).find(
      (name) =>
        name.toLocaleLowerCase() === suggestion.name.toLocaleLowerCase(),
    );
    if (!name) {
      next = addSuggestedRoom(next, suggestion);
      continue;
    }
    for (const item of suggestion.items) {
      if (next.lines.length >= 300) break;
      const candidate = catalogItem(name, item.work);
      const exists = next.lines.some(
        (line) =>
          line.room === name &&
          (line.catalogLinks?.some(
            (link) => link.role === "work" && link.recordId === item.work.id,
          ) ||
            line.title.trim().toLocaleLowerCase() ===
              candidate.title.trim().toLocaleLowerCase()),
      );
      if (exists) continue;
      const generated = addSuggestedRoom(
        { ...next, rooms: [], lines: [] },
        { ...suggestion, name, items: [item] },
      );
      next = { ...next, lines: [...next.lines, ...generated.lines] };
    }
  }
  return next;
}
