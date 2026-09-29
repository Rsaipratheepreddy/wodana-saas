import { expect, it } from "vitest";
import { dayWhere } from "./attendance-tab";

const modeName = (mode: string) => ({ office: "Office", site: "Site" })[mode] ?? mode;

it("names general work by the way of working, and projects and places by their own names", () => {
  expect(dayWhere({ breakdown: [{ name: "", mode: "office", minutes: 60 }], place: null } as never, modeName)).toBe("Office");
  expect(dayWhere({ breakdown: [{ name: "Villa 12", mode: "site", minutes: 60 }, { name: "", mode: "office", minutes: 30 }], place: null } as never, modeName)).toBe("Villa 12, Office");
});
