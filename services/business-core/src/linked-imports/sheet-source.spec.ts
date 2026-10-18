import { describe, expect, it } from "vitest";
import { sheetErrorMessage } from "./sheet-source.service";

describe("a linked sheet that can't be read", () => {
  it("asks to reconnect when Google's access ended, without Google's words", () => {
    const message = sheetErrorMessage("reconnect_required", "Token has been expired or revoked.");
    expect(message).toContain("Reconnect it in Connections");
    expect(message).not.toContain("revoked");
  });

  it("keeps the integration service's own sentence for a sheet it can't open", () => {
    expect(sheetErrorMessage("sheet_unavailable", "Wodana can't open this sheet any more. Link it again from Google"))
      .toBe("Wodana can't open this sheet any more. Link it again from Google");
  });

  it("never passes a provider's text for any other failure", () => {
    expect(sheetErrorMessage("sheet_read_failed", "Requested entity was not found.")).not.toContain("Requested entity");
    expect(sheetErrorMessage(undefined, undefined)).toContain("couldn't read the sheet");
  });
});
