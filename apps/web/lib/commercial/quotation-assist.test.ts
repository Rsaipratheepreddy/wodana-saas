import { describe, it, expect } from "vitest";
import {
  resolveRoomSuggestions,
  addSuggestedRoom,
  addQuotationSuggestions,
  type AssistCatalogRecord,
  type AssistLink,
} from "./quotation-assist";
import { itemContext } from "./item-context";
import { applyRoom, selectVariant } from "./room-builder";
import {
  quotationDescription,
  quotationVariantName,
  quotationLineVariant,
} from "./presentation";
import type { Quote } from "./types";
const record = (
  id: string,
  kind: string,
  content = {},
): AssistCatalogRecord => ({
  id,
  kind,
  name: id,
  code: id,
  version: 2,
  catalogId: "catalog",
  content,
});
const records = [
  record("room", "room"),
  record("work", "work"),
  record("variant", "variant"),
  record("otherVariant", "variant"),
  record("plywood", "material"),
  record("wrongMaterial", "material"),
  record("component", "construction", {
    configuration: { recordRole: "component", quantity: 2 },
  }),
  record("unit", "unit", { configuration: { symbol: "nos" } }),
];
const links: AssistLink[] = [
  { recordId: "work", targetId: "room", relation: "room" },
  { recordId: "work", targetId: "unit", relation: "unit" },
  { recordId: "variant", targetId: "work", relation: "work" },
  { recordId: "component", targetId: "work", relation: "work" },
  { recordId: "component", targetId: "variant", relation: "variant" },
  { recordId: "component", targetId: "plywood", relation: "material" },
];
const raw = {
  summary: "Suggested scope",
  rooms: [
    {
      roomId: "room",
      reason: "From brief",
      sourceIds: ["brief", "unrelated-case"],
      items: [
        {
          workId: "work",
          variantId: "variant",
          materialIds: ["plywood", "wrongMaterial"],
          reason: "Required",
          rate: 999,
          quantity: 45,
        },
        { workId: "unknown", variantId: "", materialIds: [] },
        { workId: "work", variantId: "otherVariant", materialIds: [] },
      ],
    },
  ],
};
const quote = (): Quote => ({
  id: "q",
  number: 1,
  kind: "quotation",
  status: "draft",
  title: "Proposal",
  currency: "AED",
  validUntil: "2099-01-01",
  discount: 0,
  taxRate: 5,
  terms: "Terms",
  exclusions: "",
  createdAt: "2026-09-08",
  requestIds: [],
  total: 0,
  lines: [],
  paymentTerms: [],
});
describe("quotation planning and room configuration", () => {
  it("builds the quotation description from edited materials, not stale legacy text", () => {
    const line = {
      material: "Old plywood",
      finish: "Old finish",
      specification: "Install on site",
      materialRows: [
        {
          id: "m",
          name: "Oak veneer",
          specification: "Natural grain",
          type: "material" as const,
          quantity: 2,
          unit: "m²",
          rate: 300,
          suppliedByClient: false,
        },
      ],
    };
    expect(quotationDescription(line)).toBe(
      "Oak veneer · Natural grain · Install on site",
    );
    expect(quotationDescription({ ...line, materialRows: [] })).toBe(
      "Install on site",
    );
    expect(
      quotationDescription({
        ...line,
        materialRows: [
          { ...line.materialRows[0], name: "Walnut", suppliedByClient: true },
        ],
      }),
    ).toBe("Walnut · Natural grain · Client supplied · Install on site");
  });
  it("adds AI items into existing rooms without replacing manual work or duplicating suggestions", () => {
    const suggestion = resolveRoomSuggestions(
      raw,
      records,
      links,
      new Set(["brief"]),
    ).rooms[0];
    const manual = {
      id: "manual",
      room: "ROOM",
      title: "Custom reception",
      quantity: 5,
      rate: 350,
      unitCost: 0,
      unit: "nos",
      material: "Oak",
      finish: "Matte",
      specification: "Keep this note",
    };
    const source = {
      ...quote(),
      rooms: [{ id: "r", name: "ROOM" }],
      lines: [manual],
    };
    const result = addQuotationSuggestions(source, [suggestion]);
    expect(result.rooms).toBe(source.rooms);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toBe(manual);
    expect(result.lines[1]).toMatchObject({
      room: "ROOM",
      quantity: 1,
      rate: 0,
    });
    expect(addQuotationSuggestions(result, [suggestion])).toBe(result);
    expect(
      addQuotationSuggestions({ ...source, direction: "deduction" }, [
        suggestion,
      ]).lines,
    ).toEqual([manual]);
    expect(
      addQuotationSuggestions(
        {
          ...source,
          lines: Array.from({ length: 300 }, (_, i) => ({
            ...manual,
            id: String(i),
          })),
        },
        [suggestion],
      ).lines,
    ).toHaveLength(300);
  });
  it("resolves only real room/item/variant/material links and existing evidence", () => {
    const result = resolveRoomSuggestions(
      raw,
      records,
      links,
      new Set(["brief"]),
    );
    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].sourceIds).toEqual(["brief"]);
    expect(result.rooms[0].items).toHaveLength(1);
    expect(result.rooms[0].items[0].materials.map((m) => m.id)).toEqual([
      "plywood",
    ]);
    expect(
      resolveRoomSuggestions(raw, records, links, new Set()).rooms,
    ).toEqual([]);
  });
  it("follows variant-specific components and rejects another items variant", () => {
    expect(
      itemContext(records, links, "work", "variant").materials,
    ).toHaveLength(1);
    expect(itemContext(records, links, "work").materials).toHaveLength(0);
    expect(
      itemContext(records, links, "work", "otherVariant").materials,
    ).toHaveLength(0);
  });
  it("adds a reviewed suggestion once without accepting AI prices or quantities", () => {
    const suggestion = resolveRoomSuggestions(
      raw,
      records,
      links,
      new Set(["brief"]),
    ).rooms[0];
    const source = quote();
    const added = addSuggestedRoom(source, suggestion);
    expect(source.lines).toEqual([]);
    expect(added.lines[0]).toMatchObject({ quantity: 1, rate: 0, unit: "nos" });
    expect(added.lines[0].catalogLinks?.map((l) => l.role)).toEqual([
      "work",
      "unit",
      "variant",
      "material",
    ]);
    expect(addSuggestedRoom(added, suggestion)).toBe(added);
    expect(
      addSuggestedRoom({ ...source, direction: "deduction" }, suggestion).lines,
    ).toEqual([]);
  });
  it("renames a room and preserves unrelated lines and catalog identity", () => {
    const suggestion = resolveRoomSuggestions(
      raw,
      records,
      links,
      new Set(["brief"]),
    ).rooms[0];
    const added = addSuggestedRoom(quote(), suggestion);
    const other = { ...added.lines[0], id: "other", room: "Kitchen" };
    const original = { ...added, lines: [...added.lines, other] };
    const updated = applyRoom(
      original,
      "room",
      "Living room",
      suggestion.room,
      [{ ...added.lines[0], rate: 250 }],
    );
    expect(updated.lines[0].room).toBe("Living room");
    expect(updated.lines[1]).toBe(other);
    expect(updated.rooms?.[0].id).toBe(added.rooms?.[0].id);
    expect(original.lines[0].rate).toBe(0);
  });
  it("concatenates material descriptions without exposing costs or duplicating text", () => {
    expect(
      quotationDescription({
        material: "Oak\nOak",
        finish: "Matte",
        specification: "Soft close",
        customMaterials: [
          {
            id: "m",
            name: "Handle",
            brand: "Acme",
            code: "code",
            specification: "Brass",
            suppliedByClient: true,
          },
        ],
      }),
    ).toBe(
      "Oak · Matte · Handle · Acme · Brass · Client supplied · Soft close",
    );
  });
  it("omits generated material identifiers from descriptions and keeps written notes", () => {
    const snapshot = {
      id: "m",
      name: "Pine wood frame",
      code: "CS_123",
      kind: "material",
      catalogId: "c",
      version: 1,
    };
    expect(
      quotationDescription({
        material: "Pine wood frame · CS_123\n\nConfirm finish code B20",
        finish: "Matte",
        specification: "Soft close",
        catalogLinks: [
          { role: "material", recordId: "m", version: 1, snapshot },
        ],
      }),
    ).toBe("Pine wood frame · Confirm finish code B20 · Matte · Soft close");
    const row = {
      id: "row",
      name: snapshot.name,
      specification: snapshot.code,
      type: "material" as const,
      quantity: 1,
      unit: "nos",
      rate: 0,
      suppliedByClient: false,
    };
    const item = {
      material: "",
      finish: "",
      specification: "Confirm finish code B20",
      materialRows: [row],
      catalogLinks: [
        { role: "material" as const, recordId: "m", version: 1, snapshot },
      ],
    };
    expect(quotationDescription(item)).toBe(
      "Pine wood frame · Confirm finish code B20",
    );
    expect(row.specification).toBe("CS_123");
    expect(
      quotationDescription({
        ...item,
        materialRows: [
          { ...row, specification: "Use code CS_123 for reorder" },
        ],
      }),
    ).toContain("Use code CS_123 for reorder");
  });
  it("clears incompatible linked materials when changing variant, while retaining custom notes", () => {
    const suggestion = resolveRoomSuggestions(
      raw,
      records,
      links,
      new Set(["brief"]),
    ).rooms[0];
    const added = addSuggestedRoom(quote(), suggestion);
    const line = {
      ...added.lines[0],
      material: added.lines[0].material + "\n\nConfirm grain direction",
    };
    const changed = selectVariant(line, null);
    expect(
      changed.catalogLinks?.some((l) =>
        ["variant", "material"].includes(l.role),
      ),
    ).toBe(false);
    expect(changed.material).toBe("Confirm grain direction");
    expect(changed.rate).toBe(line.rate);
  });
  it("uses a concise variant label in both the builder and client quotation", () => {
    expect(
      quotationVariantName(
        "Deck Flooring WPC · Balcony · Standard",
        "Deck Flooring WPC",
        "Balcony",
        "STANDARD_EL055",
      ),
    ).toBe("Standard");
    expect(
      quotationVariantName(
        "3-Seater Sofa · Luxury · PT116",
        "3-Seater Sofa",
        "Living Room",
        "PT116",
      ),
    ).toBe("Luxury");
  });

  it("keeps the variant label concise after renaming an item or its room", () => {
    const line = {
      title: "Custom seating",
      room: "Lounge 2",
      catalogLinks: [
        {
          role: "work",
          recordId: "w",
          version: 1,
          snapshot: {
            id: "w",
            name: "Sofa · Living Room",
            code: "SF",
            kind: "work",
            version: 1,
            catalogId: "c",
          },
        },
        {
          role: "variant",
          recordId: "v",
          version: 1,
          snapshot: {
            id: "v",
            name: "Sofa · Living Room · Premium · PT118",
            code: "PT118",
            kind: "variant",
            version: 1,
            catalogId: "c",
          },
        },
      ],
    };
    expect(quotationLineVariant(line)).toBe("Premium");
    expect(quotationLineVariant({ ...line, catalogLinks: [] })).toBeUndefined();
  });

  it("keeps material choices and source prices scoped when the master contains many unrelated records", () => {
    const priced = [
      ...records,
      record("price", "rate_card", {
        configuration: { amount: 125, currency: "AED", priceType: "Reference" },
      }),
    ];
    const connected = [
      ...links,
      { recordId: "price", targetId: "plywood", relation: "material" },
      { recordId: "price", targetId: "unit", relation: "unit" },
    ];
    const otherRecords = Array.from({ length: 3000 }, (_, i) => [
      record(`other-component-${i}`, "construction", {
        configuration: { recordRole: "component" },
      }),
      record(`other-price-${i}`, "rate_card", {
        configuration: { amount: 999, currency: "INR" },
      }),
    ]).flat();
    const otherLinks = Array.from({ length: 3000 }, (_, i) => [
      {
        recordId: `other-component-${i}`,
        targetId: `other-work-${i}`,
        relation: "work",
      },
      {
        recordId: `other-price-${i}`,
        targetId: `other-material-${i}`,
        relation: "material",
      },
    ]).flat();
    const expected = itemContext(priced, connected, "work", "variant");
    expect(expected.materials[0].prices).toEqual([
      { label: "Reference", amount: 125, currency: "AED", basis: "unit" },
    ]);
    expect(
      itemContext(
        [...priced, ...otherRecords],
        [...connected, ...otherLinks],
        "work",
        "variant",
      ),
    ).toEqual(expected);
  });
});
