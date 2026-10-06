import { describe, expect, it } from "vitest";
import { blocksOrdering, checkFit, checkPoint, fitInputsHash, longestThroughTurn, rectangleFits, toMm, type AccessPoint, type ItemSize } from "./fit-check.domain";

const point = (overrides: Partial<AccessPoint>): AccessPoint => ({ id: "p1", route: "Main", position: 0, kind: "door", label: "Front door", unit: "mm", width: null, height: null, ...overrides });
const sofa: ItemSize = { width: "2200", depth: "950", height: "850", unit: "mm" };
const door = (width: string, height = "2000") => point({ width, height });

describe("fit check geometry", () => {
  it("converts units exactly", () => {
    expect(toMm("31.5", "in")).toBe(800.1);
    expect(toMm("2.4", "m")).toBe(2400);
    expect(toMm("7", "ft")).toBe(2133.6);
    expect(toMm(null, "cm")).toBeNull();
  });

  it("passes an opening lengthwise with the 20 mm handling allowance: fits, tight, doesn't fit", () => {
    expect(checkPoint(sofa, door("900"))).toMatchObject({ status: "fits", way: "straight", spareMm: 50 });
    expect(checkPoint(sofa, door("860"))).toMatchObject({ status: "tight", spareMm: 10 });
    expect(checkPoint(sofa, door("800"))).toMatchObject({ status: "does_not_fit", spareMm: -50 });
  });

  it("tilt rule: a door wider than the maker's diagonal depth lets a sofa through", () => {
    expect(checkPoint({ ...sofa, diagonalDepth: "700" }, door("800"))).toMatchObject({ status: "fits", way: "tilted", spareMm: 100 });
    expect(checkPoint({ ...sofa, diagonalDepth: "790" }, door("800"))).toMatchObject({ status: "tight", way: "tilted", spareMm: 10 });
    // The tilted profile's full diagonal (√(850² + 950²) ≈ 1275 mm) must still clear the height.
    expect(checkPoint({ ...sofa, diagonalDepth: "700" }, door("800", "1200"))).toMatchObject({ status: "does_not_fit" });
  });

  it("mixed units: an inch-measured door against a centimetre item", () => {
    const chair: ItemSize = { width: "228", depth: "95", height: "82", unit: "cm" };
    expect(checkPoint(chair, point({ width: "31.5", height: "80", unit: "in" }))).toMatchObject({ status: "does_not_fit", spareMm: -20 });
  });

  it("turning a 90° corner: the longest box of thickness t through two passages", () => {
    expect(longestThroughTurn(1000, 1000, 0)).toBeCloseTo(2828.43, 1);
    expect(longestThroughTurn(1000, 1000, 400)).toBeCloseTo(2028.43, 1); // 2√2·w − 2t at 45°
    expect(longestThroughTurn(1000, 800, 900)).toBe(-Infinity);
    expect(longestThroughTurn(1200, 900, 300)).toBeLessThan(longestThroughTurn(1200, 900, 0));
    const panel: ItemSize = { width: "2600", depth: "500", height: "400", unit: "mm" };
    const corridor = (height: string) => point({ kind: "corridor", label: "Hall", width: "1000", height, turnWidth: "1000" });
    expect(checkPoint(panel, corridor("2400"))).toMatchObject({ status: "does_not_fit" });
    // With room to stand it up, it turns upright.
    expect(checkPoint(panel, corridor("2700"))).toMatchObject({ status: "fits", way: "upright", spareMm: 100 });
  });

  it("Carver's condition for leaning a rectangle inside another", () => {
    expect(rectangleFits(2400, 100, 1400, 2200)).toBe(true);
    expect(rectangleFits(2700, 100, 1400, 2200)).toBe(false);
    expect(rectangleFits(1000, 500, 1200, 600)).toBe(true);
    expect(rectangleFits(1300, 1300, 1200, 1400)).toBe(false);
  });

  it("lift: the door, then the cabin square or leaned", () => {
    const lift = point({ kind: "lift", label: "Lift", width: "800", height: "2100", cabinWidth: "1100", cabinDepth: "1400", cabinHeight: "2200" });
    expect(checkPoint({ width: "900", depth: "600", height: "1800", unit: "mm" }, lift)).toMatchObject({ status: "fits", way: "square" });
    expect(checkPoint({ width: "2400", depth: "900", height: "100", unit: "mm" }, lift)).toMatchObject({ status: "fits", way: "leaned" });
    expect(checkPoint({ width: "2700", depth: "900", height: "100", unit: "mm" }, lift)).toMatchObject({ status: "does_not_fit", way: "leaned" });
    expect(checkPoint(sofa, point({ kind: "lift", label: "Lift", width: "800", height: "2100" }))).toMatchObject({ status: "unknown", missing: ["cabin"] });
  });

  it("routes: points on a route are passed in turn; one route that works is enough", () => {
    const tall: ItemSize = { width: "2700", depth: "900", height: "100", unit: "mm" };
    const points = [
      point({ id: "a", route: "Lift", position: 0, label: "Lobby door", width: "1000", height: "2100" }),
      point({ id: "b", route: "Lift", position: 1, kind: "lift", label: "Lift", width: "800", height: "2100", cabinWidth: "1100", cabinDepth: "1400", cabinHeight: "2200" }),
      point({ id: "c", route: "Stairs", position: 0, kind: "stair", label: "Stair", width: "1000", height: "2100", turnWidth: "1200" }),
    ];
    const both = checkFit(tall, points);
    expect(both.routes.map((route) => [route.route, route.status])).toEqual([["Lift", "does_not_fit"], ["Stairs", "fits"]]);
    expect(both.status).toBe("fits");
    expect(checkFit(tall, points.slice(0, 2)).status).toBe("does_not_fit");
    expect(blocksOrdering(checkFit(tall, points.slice(0, 2)).status)).toBe(true);
  });

  it("unknowns warn and never block", () => {
    expect(checkFit(sofa, [])).toMatchObject({ status: "unknown", reason: "no_access_points" });
    const noHeight = checkFit({ ...sofa, height: null }, [door("900")]);
    expect(noHeight).toMatchObject({ status: "unknown", reason: "item_size_missing" });
    expect(checkFit(sofa, [point({ width: "900" })]).routes[0].points[0]).toMatchObject({ status: "unknown", missing: ["height"] });
    expect(blocksOrdering("unknown")).toBe(false);
    expect(blocksOrdering("tight")).toBe(false);
  });

  it("an override's inputs: the hash follows the size and the points, not their order or unit spelling", () => {
    const points = [door("800"), point({ id: "p2", route: "Main", width: "1000", height: "2100" })];
    const hash = fitInputsHash(sofa, points);
    expect(fitInputsHash(sofa, [...points].reverse())).toBe(hash);
    expect(fitInputsHash({ width: "220", depth: "95", height: "85", unit: "cm" }, points)).toBe(hash);
    expect(fitInputsHash(sofa, [door("810"), points[1]])).not.toBe(hash);
    expect(fitInputsHash({ ...sofa, diagonalDepth: "700" }, points)).not.toBe(hash);
  });
});
