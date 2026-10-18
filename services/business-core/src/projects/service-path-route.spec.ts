import { describe, expect, it } from "vitest";
import { servicePathRoute, quotationNeedsSitePlan, quotationRequiresSitePlan, type ServicePathScope } from "./service-path-route";

const full: ServicePathScope = {
  design: true,
  mainQuotation: true,
  materialSelection: true,
  procurement: true,
  manufacturing: true,
  siteWorks: true,
  installation: true,
};

describe("Palm enquiry-to-project route", () => {
  it("opens one project after the design payment and keeps the main round inside it", () => {
    const route = servicePathRoute(full);
    expect(route.firstPaidRound).toBe("design");
    expect(route.crm.at(-1)).toBe("deal_file");
    expect(route.project.slice(0, 6)).toEqual([
      "site_visit", "design_specifications", "main_quote", "main_qs_review", "main_client_approval", "main_agreement_payment",
    ]);
    expect(route.project.indexOf("material_list_signoff")).toBeGreaterThan(route.project.indexOf("main_agreement_payment"));
    expect(route.project.indexOf("manufacturing_readiness")).toBeLessThan(route.project.indexOf("factory_production"));
  });

  it("ends moodboards-only work after design without a main or delivery round", () => {
    expect(servicePathRoute({ ...full, mainQuotation: false, materialSelection: false, procurement: false, manufacturing: false, siteWorks: false, installation: false })).toEqual({
      firstPaidRound: "design",
      crm: ["enquiry", "requirements", "design_quote", "design_qs_review", "design_client_approval", "design_agreement_payment", "deal_file"],
      project: ["site_visit", "design_specifications"],
    });
  });

  it("opens a furniture-only project after the main payment", () => {
    const route = servicePathRoute({ ...full, design: false, siteWorks: false });
    expect(route.firstPaidRound).toBe("main");
    expect(route.crm).toContain("main_qs_review");
    expect(route.project[0]).toBe("material_list_signoff");
    expect(route.project).not.toContain("design_specifications");
    expect(route.project).not.toContain("main_quote");
  });

  it("skips both factory stages for ready-made furniture", () => {
    const route = servicePathRoute({ ...full, design: false, materialSelection: false, manufacturing: false, siteWorks: false });
    expect(route.project).not.toContain("manufacturing_readiness");
    expect(route.project).not.toContain("factory_production");
    expect(route.project).toContain("client_handover");
  });

  it("does not demand a site plan to quote ready-made furniture, but keeps it for measured main work", () => {
    const readyMade = { ...full, design: false, materialSelection: false, manufacturing: false, siteWorks: false };
    expect(quotationRequiresSitePlan(readyMade, "main")).toBe(false);
    expect(quotationRequiresSitePlan({ ...readyMade, manufacturing: true }, "main")).toBe(true);
    expect(quotationRequiresSitePlan({ ...readyMade, siteWorks: true }, "main")).toBe(true);
    expect(quotationRequiresSitePlan(full, "main")).toBe(true);
    expect(quotationRequiresSitePlan(full, "design")).toBe(false);
  });

  it("asks for a site plan only on a path with a site visit, where the Site area shows", () => {
    const madeToOrder = { ...full, design: false, materialSelection: false, siteWorks: false, installation: false };
    // Furniture made to order on a path without a site visit (no Site area): no plan, whatever the scope says.
    expect(quotationNeedsSitePlan({ siteVisit: false }, madeToOrder, "main")).toBe(false);
    expect(quotationNeedsSitePlan({ siteVisit: false }, full, "main")).toBe(false);
    expect(quotationNeedsSitePlan({ siteVisit: false }, null, undefined)).toBe(false);
    // A path with a site visit: the scope decides, and a case without one keeps asking.
    expect(quotationNeedsSitePlan({ siteVisit: true }, madeToOrder, "main")).toBe(true);
    expect(quotationNeedsSitePlan({ siteVisit: true }, { ...madeToOrder, manufacturing: false }, "main")).toBe(false);
    expect(quotationNeedsSitePlan({ siteVisit: true }, full, "design")).toBe(false);
    expect(quotationNeedsSitePlan({ siteVisit: true }, undefined, undefined)).toBe(true);
  });

  it("rejects unsupported stage combinations rather than silently hiding gates", () => {
    expect(() => servicePathRoute({ ...full, design: false, mainQuotation: false })).toThrow();
    expect(() => servicePathRoute({ ...full, procurement: false })).toThrow();
  });
});
