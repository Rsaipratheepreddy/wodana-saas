import { describe, expect, it, vi } from "vitest";
import { enquiryTitle, refreshEnquiryTitlesForParty } from "./enquiry-title";

const choices = { emirates: [{ id: "dubai", label: "Dubai" }, { id: "other", label: "Other" }], areas: { dubai: [{ id: "al_barsha", label: "Al Barsha" }] } };

describe("enquiry title", () => {
  it("uses the customer name, area and emirate", () => {
    expect(enquiryTitle(" Cece Serna ", { emirate: "dubai", area: "al_barsha" }, choices)).toBe("Cece Serna — Al Barsha, Dubai");
  });
  it("omits an empty area", () => {
    expect(enquiryTitle("Cece Serna", { emirate: "dubai" }, choices)).toBe("Cece Serna — Dubai");
  });
  it("uses the typed place for a region outside the list", () => {
    expect(enquiryTitle("Cece Serna", { emirate: "other", area: "London, UK" }, choices)).toBe("Cece Serna — London, UK");
  });
  it("refreshes every linked enquiry after a customer name changes", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_taxonomies")) return { rows: [{ code: "emirate", options: [{ id: "dubai", label: "Dubai" }] }] };
      if (sql.includes("SELECT id, details FROM crm_enquiries")) return { rows: [
        { id: "enquiry-1", details: { emirate: "dubai" } },
        { id: "enquiry-2", details: { emirate: "other", area: "London, UK" } },
      ] };
      return { rows: [] };
    });
    await refreshEnquiryTitlesForParty({ query } as never, "workspace", "party", "Cece Serna");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE crm_enquiries SET title=$3"), ["workspace", "enquiry-1", "Cece Serna — Dubai"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE crm_enquiries SET title=$3"), ["workspace", "enquiry-2", "Cece Serna — London, UK"]);
  });
});
