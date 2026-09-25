import { describe, expect, it, vi } from "vitest";
import { LeadFormsService } from "./lead-forms.service";

const token = "a".repeat(32);
const schema = {
  title: "Project enquiry",
  description: "Tell us about your project",
  source: "company",
  channel: "instagram",
  questions: [{ id: "name", title: "Your name", description: "", type: "text", required: true, field: "displayName", options: [] }],
};

describe("public enquiry form branding", () => {
  it("returns tenant branding without exposing internal routing fields", async () => {
    const resolveQuery = vi.fn(async (sql: string) => sql.includes("FROM crm_lead_forms")
      ? { rows: [{ id: "form-id", workspace_id: "workspace-id", published: schema }], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    const brandQuery = vi.fn(async () => ({ rows: [{
      displayName: "Palm Living", loginSlug: "plm", primaryColor: "#E4E3DE",
      secondaryColor: "#000000", headingFont: "alta", bodyFont: "montserrat", hasLogo: true,
    }] }));
    const db = {
      transaction: async (work: (client: unknown) => Promise<unknown>) => work({ query: resolveQuery }),
      tenantTransaction: async (_workspaceId: string, _actorId: string, work: (client: unknown) => Promise<unknown>) => work({ query: brandQuery }),
    };
    const service = new LeadFormsService(db as never, {} as never, {} as never, {} as never);

    const result = await service.publicForm(token);

    expect(result.branding).toEqual({
      displayName: "Palm Living", primaryColor: "#E4E3DE", secondaryColor: "#000000",
      headingFont: "alta", bodyFont: "montserrat", logoUrl: "/api/auth/tenant-logo/plm",
    });
    expect(result.consentLabel).toBe("I agree to be contacted about this enquiry.");
    expect(result.questions[0]).toMatchObject({ id: "name", field: "displayName" });
    expect(result).not.toHaveProperty("source");
    expect(result).not.toHaveProperty("channel");
    expect(result).not.toHaveProperty("workspaceId");
    expect(brandQuery).toHaveBeenCalledWith(expect.stringContaining("FROM tenant_login_branding"), ["workspace-id"]);
  });
});
