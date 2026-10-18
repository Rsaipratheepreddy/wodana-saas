import { describe, expect, it } from "vitest";
import { outstanding, receivable, receivedStatus } from "./receiving";

describe("receiving quantities", () => {
  it("owes what isn't accepted or waiting for inspection; rejected goods are still owed", () => {
    expect(outstanding({ quantity: "10", accepted: "5", pending: "0" }).toString()).toBe("5");
    expect(outstanding({ quantity: "10", accepted: "5", pending: "3" }).toString()).toBe("2");
    expect(outstanding({ quantity: "10", accepted: "11", pending: "0" }).toString()).toBe("0");
  });

  it("allows over-delivery on the whole line, never below zero", () => {
    expect(receivable({ quantity: "10", accepted: "5", pending: "0" }, "10").toString()).toBe("6");
    expect(receivable({ quantity: "1", accepted: "0", pending: "0" }, "10").toString()).toBe("1.1");
    expect(receivable({ quantity: "3", accepted: "0", pending: "0" }, "12.5").toString()).toBe("3.375");
    expect(receivable({ quantity: "0.3333", accepted: "0", pending: "0" }, "33.33").toString()).toBe("0.4443");
    expect(receivable({ quantity: "10", accepted: "11", pending: "0" }, "10").toString()).toBe("0");
  });

  it("is received once every line has arrived, partly received before", () => {
    const lines = [{ quantity: "10", accepted: "10", pending: "0" }, { quantity: "1", accepted: "0", pending: "1" }];
    expect(receivedStatus(lines, true)).toBe("received");
    expect(receivedStatus([lines[0], { quantity: "1", accepted: "0", pending: "0" }], true)).toBe("partly_received");
    expect(receivedStatus([{ quantity: "1", accepted: "0", pending: "0" }], false)).toBeNull();
  });
});
