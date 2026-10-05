import { describe, expect, it } from "vitest";
import { dateIn, dayParts, iframeSnippet, linkFromQuery, popupSnippet, shareUrl, slotRange, slotsByDay } from "./booking";

describe("booking helpers", () => {
  it("groups free slots by the visitor's own date", () => {
    // 21:00 and 22:00 UTC are the same evening in London but the next morning in Dubai.
    const slots = [{ start: "2031-03-03T22:00:00Z", end: "2031-03-03T23:00:00Z" }, { start: "2031-03-03T21:00:00Z", end: "2031-03-03T22:00:00Z" }];
    expect(slotsByDay(slots, "Europe/London").map((day) => [day.date, day.slots.length])).toEqual([["2031-03-03", 2]]);
    expect(slotsByDay(slots, "Asia/Dubai").map((day) => day.date)).toEqual(["2031-03-04"]);
    expect(dateIn("2031-03-03T21:00:00Z", "Asia/Dubai")).toBe("2031-03-04");
  });

  it("asks for the booking window, two months at most", () => {
    expect(slotRange("2031-03-01", 14)).toEqual({ from: "2031-03-01", to: "2031-03-15" });
    expect(slotRange("2031-03-01", 365).to).toBe("2031-04-30");
  });

  it("keeps only safe source, channel, placement and UTM values from a link", () => {
    expect(linkFromQuery({ source: "company", channel: "website", placement: "showroom-door", utm_campaign: "autumn sale", utm_source: "<script>" }))
      .toEqual({ source: "company", channel: "website", placement: "showroom-door", utm: { campaign: "autumn sale" } });
    expect(linkFromQuery({})).toBeUndefined();
  });

  it("builds the share link, the inline embed and the popup script", () => {
    const url = shareUrl("https://app.example", "palm", "design-consultation", { placement: "showroom-door" });
    expect(url).toBe("https://app.example/book/palm/design-consultation?placement=showroom-door");
    expect(iframeSnippet(url, "Design \"consult\"")).toContain(`src="${url}&embed=1"`);
    expect(iframeSnippet(url, "Design \"consult\"")).toContain("title=\"Design &quot;consult&quot;\"");
    expect(popupSnippet("https://app.example", url, "Book")).toBe(`<script src="https://app.example/book/embed.js" data-url="${url}" data-label="Book" async></script>`);
  });

  it("names a day in the visitor's language", () => {
    expect(dayParts("2031-03-03", "en-GB")).toEqual({ weekday: "Mon", date: "3 Mar" });
    expect(dayParts("2031-03-03", "ar").weekday).not.toBe("Mon");
  });
});
