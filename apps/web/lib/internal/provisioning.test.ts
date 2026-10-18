import { describe, expect, it } from "vitest";
import { emptyTenantDetails, tenantDraftPayload, validateTenantDetails, type SetupProfile } from "./provisioning";

const profiles: SetupProfile[] = [
  { kind: "region", code: "AE", version: 1, configuration: { countryCode: "AE", currency: "AED", locale: "en-AE", timezone: "Asia/Dubai", unitSystem: "metric", weekStartsOn: 1 } },
  { kind: "firm_kit", code: "design_build", version: 2, configuration: { label: "Design & build" } },
  { kind: "plan", code: "starter", version: 1, configuration: { seatLimit: 5, projectLimit: 25 } },
];

const details = {
  ...emptyTenantDetails, accountName: "Palm Group", contactName: "Contract Contact",
  contactEmail: "CONTACT@example.test", organizationName: "Palm Living",
  slug: "palm-living", ownerName: "Workspace Owner", ownerEmail: "OWNER@example.test",
  regionCode: "AE", firmKitCode: "design_build", planCode: "starter",
};

describe("operator provisioning payload", () => {
  it("keeps customer account, organization, legal business and owner distinct", () => {
    const payload = tenantDraftPayload(details, profiles, "00000000-0000-4000-8000-000000000001");
    expect(payload.externalTenantId).toBe("tenant_00000000-0000-4000-8000-000000000001");
    expect(payload.account).toEqual({ displayName: "Palm Group", contactName: "Contract Contact", contactEmail: "contact@example.test" });
    expect(payload.organization.name).toBe("Palm Living");
    expect(payload.organization.firstLegalEntity.registeredName).toBe("Palm Living");
    expect(payload.owner).toEqual({ displayName: "Workspace Owner", email: "owner@example.test" });
    expect(payload.defaults).toEqual({ region: { code: "AE", version: 1 }, firmKit: { code: "design_build", version: 2 }, plan: { code: "starter", version: 1 } });
  });

  it("does not offer a retired or unknown kit", () => {
    expect(validateTenantDetails({ ...details, firmKitCode: "blank" }, profiles)).toContain("Choose an available firm kit.");
    expect(validateTenantDetails({ ...details, slug: "bad slug" }, profiles)).toContain("Choose a valid login address.");
    expect(validateTenantDetails(details, profiles)).toEqual([]);
  });

  it("sends seats only when they differ from the plan and never assumes a country", () => {
    expect(emptyTenantDetails.regionCode).toBe("");
    expect(tenantDraftPayload({ ...details, seatLimit: 5 }, profiles, "k").defaults).not.toHaveProperty("seatLimit");
    expect(tenantDraftPayload({ ...details, seatLimit: 12 }, profiles, "k").defaults).toMatchObject({ seatLimit: 12 });
  });
});
