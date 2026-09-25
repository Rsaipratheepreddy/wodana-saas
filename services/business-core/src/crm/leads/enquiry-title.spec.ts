import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LEAD_OPTIONS } from "./lead-options";
import { enquiryTitle, refreshEnquiryTitlesForParty } from "./enquiry-title";

const choices = { emirates: DEFAULT_LEAD_OPTIONS.emirates, areas: { dubai: [{ id: "al_barsha", label: "Al Barsha" }] } };

describe("enquiry title", () => {
  it("uses the customer name, area and emirate", () => {
    expect(enquiryTitle(" Cece Serna ", { emirate: "dubai", area: "al_barsha" }, choices)).toBe("Cece Serna — Al Barsha, Dubai");
  });
  it("omits an empty area", () => {
    expect(enquiryTitle("Cece Serna", { emirate: "dubai" }, choices)).toBe("Cece Serna — Dubai");
  });
  it("uses free-text city and country for Outside UAE", () => {
    expect(enquiryTitle("Cece Serna", { emirate: "outside_uae", area: "London, UK" }, choices)).toBe("Cece Serna — London, UK");
  });
  it("refreshes every linked enquiry after a customer name changes", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_taxonomies")) return { rows: [] };
      if (sql.includes("SELECT id, details FROM crm_enquiries")) return { rows: [
        { id: "enquiry-1", details: { emirate: "dubai" } },
        { id: "enquiry-2", details: { emirate: "outside_uae", area: "London, UK" } },
      ] };
      return { rows: [] };
    });
    await refreshEnquiryTitlesForParty({ query } as never, "workspace", "party", "Cece Serna");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE crm_enquiries SET title=$3"), ["workspace", "enquiry-1", "Cece Serna — Dubai"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE crm_enquiries SET title=$3"), ["workspace", "enquiry-2", "Cece Serna — London, UK"]);
  });
});
