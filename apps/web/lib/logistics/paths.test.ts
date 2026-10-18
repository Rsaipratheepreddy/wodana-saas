import { describe, expect, it } from "vitest";
import { allowedLogisticsPath, isPermitUpload } from "./paths";

const id = "00000000-0000-4000-8000-000000000001";

describe("logistics resources", () => {
  it("reaches bookings, people, vehicles and permits by method, and nothing else", () => {
    expect(allowedLogisticsPath(["options"], "GET")).toBe(true);
    expect(allowedLogisticsPath(["booking"], "GET")).toBe(true);
    expect(allowedLogisticsPath(["bookings"], "POST")).toBe(true);
    expect(allowedLogisticsPath(["bookings", "cancel"], "POST")).toBe(true);
    expect(allowedLogisticsPath(["bookings", "conflicts"], "POST")).toBe(true);
    expect(allowedLogisticsPath(["people"], "POST")).toBe(true);
    expect(allowedLogisticsPath(["vehicles"], "GET")).toBe(true);
    expect(allowedLogisticsPath(["settings"], "PUT")).toBe(true);
    expect(allowedLogisticsPath(["projects", id, "permits"], "GET")).toBe(true);
    expect(allowedLogisticsPath(["projects", id, "permits", id], "POST")).toBe(true);
    expect(allowedLogisticsPath(["projects", id, "permits", id, "withdraw"], "POST")).toBe(true);
    expect(allowedLogisticsPath(["permits", id, "file"], "GET")).toBe(true);
    // PLM-136: an order with no project keeps its permit on the deal.
    expect(allowedLogisticsPath(["deals", id, "permits"], "GET")).toBe(true);
    expect(allowedLogisticsPath(["deals", id, "permits", id], "POST")).toBe(true);
    expect(isPermitUpload(["deals", id, "permits", id])).toBe(true);
    expect(isPermitUpload(["projects", id, "permits", id])).toBe(true);
    expect(allowedLogisticsPath(["bookings"], "GET")).toBe(false);
    expect(allowedLogisticsPath(["people"], "DELETE")).toBe(false);
    expect(allowedLogisticsPath(["projects", "x", "permits"], "GET")).toBe(false);
    expect(allowedLogisticsPath(["settings"], "POST")).toBe(false);
  });
});
