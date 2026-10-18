import { describe, expect, it } from "vitest";
import { categoryKey, categoryTitle } from "./category-names";

describe("category names", () => {
  it("matches one category however a sheet writes it", () => {
    expect(categoryKey("BED & MATTRESS")).toBe(categoryKey("Beds & Mattress"));
    expect(categoryKey("Beds and Mattresses")).toBe(categoryKey("bed & mattress"));
    expect(categoryKey("DINING CHAIRS")).toBe(categoryKey("Dining chair"));
    expect(categoryKey("Bedside-Tables")).toBe(categoryKey("bedside tables"));
    expect(categoryKey("Accessories")).toBe(categoryKey("accessory"));
    expect(categoryKey("Glass")).toBe(categoryKey("glasses"));
    expect(categoryKey("Décor")).toBe(categoryKey("DECOR"));
    expect(categoryKey("Sofas")).not.toBe(categoryKey("Chairs"));
    expect(categoryKey("Lounge Chairs")).not.toBe(categoryKey("Dining Chairs"));
    expect(categoryKey("&")).toBe("&");
  });

  it("writes a category named in capitals in Title Case, and keeps one already in mixed case", () => {
    expect(categoryTitle("DINING CHAIRS")).toBe("Dining Chairs");
    expect(categoryTitle("  LOUNGE   CHAIRS ")).toBe("Lounge Chairs");
    expect(categoryTitle("BED & MATTRESS")).toBe("Bed & Mattress");
    expect(categoryTitle("TABLES AND CHAIRS")).toBe("Tables and Chairs");
    expect(categoryTitle("TV UNITS")).toBe("TV Units");
    expect(categoryTitle("KID'S ROOM")).toBe("Kid's Room");
    expect(categoryTitle("SIDE-TABLES")).toBe("Side-Tables");
    expect(categoryTitle("Beds & Mattress")).toBe("Beds & Mattress");
    expect(categoryTitle("outdoor")).toBe("outdoor");
  });
});
