import { describe, expect, it } from "vitest";
import { parseReceiveLink, receiveHref, receiveUrl } from "./receive-link";

const id = "6d0f2b67-6f6a-4a22-8cb0-3f2d5d77a33a";

describe("the receive link on printed orders and moves (D-46)", () => {
  it("opens the order's or the move's receive screen", () => {
    expect(receiveHref({ kind: "order", id })).toBe(`/workspace/receive?order=${id}`);
    expect(receiveUrl("https://studio.example.com/", { kind: "move", id })).toBe(`https://studio.example.com/workspace/receive?move=${id}`);
  });

  it("reads a scanned code back, taking only the path and id", () => {
    expect(parseReceiveLink(`https://studio.example.com/workspace/receive?order=${id}`)).toEqual({ kind: "order", id });
    expect(parseReceiveLink(`https://elsewhere.example.org/workspace/receive?move=${id.toUpperCase()}`)).toEqual({ kind: "move", id });
    expect(parseReceiveLink(`/workspace/receive?order=${id}`)).toEqual({ kind: "order", id });
  });

  it("ignores codes that aren't ours", () => {
    for (const text of ["", "hello", `https://studio.example.com/workspace/purchasing?order=${id}`, "https://studio.example.com/workspace/receive?order=12", "javascript:alert(1)"])
      expect(parseReceiveLink(text)).toBeNull();
  });
});
