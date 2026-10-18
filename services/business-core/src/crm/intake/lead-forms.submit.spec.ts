import { describe, expect, it, vi } from "vitest";
import { stableHash } from "../shared/crm-types";
import { LeadFormsService } from "./lead-forms.service";

const token = "a".repeat(32);
const schema = {
  title: "Palm project enquiry",
  description: "Tell us about the project",
  source: "company",
  channel: "website",
  questions: [
    { id: "name", title: "Your name", description: "", type: "text", required: true, field: "displayName", options: [] },
    { id: "mobile", title: "Mobile", description: "", type: "tel", required: true, field: "mobile", options: [] },
    { id: "email", title: "Email", description: "", type: "email", required: true, field: "email", options: [] },
    { id: "location", title: "Property location", description: "", type: "text", required: true, field: "location", options: [] },
    { id: "service", title: "What can we help with?", description: "", type: "dropdown", required: true, field: "serviceType", options: [{ id: "renovation_fit_out", label: "Renovation / Fit-Out" }] },
    { id: "budget", title: "Approximate project budget", description: "", type: "dropdown", required: false, field: "budgetRange", options: [{ id: "not_sure", label: "Not sure yet" }] },
    { id: "summary", title: "Tell us about your project", description: "", type: "paragraph", required: false, field: "summary", options: [] },
  ],
};
const answers = {
  name: "Noor Al Mansoori",
  mobile: "+971500000001",
  email: "noor@example.test",
  location: "Dubai Hills",
  core_emirate: "dubai",
  service: "renovation_fit_out",
  budget: "not_sure",
  summary: "Villa renovation",
};

function setup(blocked = false) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT published FROM crm_lead_forms")) return { rows: [{ published: schema }], rowCount: 1 };
    if (sql.includes("SELECT payload_hash, original_payload")) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT default_locale")) return { rows: [{ defaultLocale: "en-AE" }], rowCount: 1 };
    if (sql.includes("FROM crm_taxonomies taxonomy")) return { rows: [{ code: "enquiry_type", options: [{ id: "renovation_fit_out", label: "Renovation / Fit-Out" }] }], rowCount: 1 };
    if (sql.includes("tenant_setup_profiles")) return { rows: [{ options: ["Dubai", "Sharjah"] }], rowCount: 1 };
    if (sql.includes("SELECT count(*)::int AS total")) return { rows: [{ total: 0, contact: 0 }], rowCount: 1 };
    if (sql.includes("party.blocked_at IS NOT NULL")) return blocked ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const db = { tenantTransaction: vi.fn(async (_workspaceId: string, _actorId: string, work: (client: unknown) => Promise<unknown>) => work({ query })) };
  const intake = { createFormIntake: vi.fn().mockResolvedValue({ status: "ready" }) };
  const service = new LeadFormsService(db as never, {} as never, {} as never, intake as never);
  vi.spyOn(service as never, "resolve" as never).mockResolvedValue({ id: "form-id", workspace_id: "workspace-id", published: schema } as never);
  return { intake, service };
}

describe("public enquiry submission evidence", () => {
  it("requires explicit service contact consent", async () => {
    const { intake, service } = setup();
    await expect(service.submit(token, { requestId: "10000000-0000-4000-8000-000000000001", revision: stableHash(schema), answers, serviceConsent: false }))
      .rejects.toThrow("Consent is required");
    expect(intake.createFormIntake).not.toHaveBeenCalled();
  });

  it("retains raw and readable answers with server-authored consent and separate routing dimensions", async () => {
    const { intake, service } = setup();
    await expect(service.submit(token, { requestId: "10000000-0000-4000-8000-000000000001", revision: stableHash(schema), answers, serviceConsent: true }))
      .resolves.toEqual({ received: true });
    expect(intake.createFormIntake).toHaveBeenCalledWith(expect.anything(), "workspace-id", "lead-form:form-id:10000000-0000-4000-8000-000000000001", expect.objectContaining({
      source: "company",
      channel: "website",
      intakeMethod: "form",
      assignment: { mode: "automatic" },
      details: expect.objectContaining({ emirate: "dubai", area: "Dubai Hills" }),
      consents: [expect.objectContaining({ purpose: "service", channel: "all", status: "granted", evidence: expect.objectContaining({ method: "public_enquiry_form", formId: "form-id", formRevision: stableHash(schema), capturedAt: expect.any(String) }) })],
      originalPayload: expect.objectContaining({
        formRawAnswers: answers,
        formAnswers: expect.arrayContaining([expect.objectContaining({ questionId: "service", value: "Renovation / Fit-Out" })]),
        consent: expect.objectContaining({ method: "public_enquiry_form", capturedAt: expect.any(String) }),
      }),
    }));
  });

  it("saves a locally entered public-form mobile in international format", async () => {
    const { intake, service } = setup();
    await service.submit(token, {
      requestId: "10000000-0000-4000-8000-000000000002", revision: stableHash(schema),
      answers: { ...answers, mobile: "050 123 4567" }, phoneCountryCodes: { mobile: "AE" }, serviceConsent: true,
    });
    expect(intake.createFormIntake).toHaveBeenCalledWith(expect.anything(), "workspace-id", expect.any(String), expect.objectContaining({
      party: expect.objectContaining({ mobile: "+971501234567", mobileCountryCode: "AE" }),
    }));
  });

  it("takes junk as received but makes no enquiry: the hidden field filled, sent too fast, or a blocked contact (S-13)", async () => {
    const base = { requestId: "10000000-0000-4000-8000-000000000002", revision: stableHash(schema), answers, serviceConsent: true };
    for (const junk of [{ website: "https://spam.example" }, { elapsedMs: 400 }]) {
      const { intake, service } = setup();
      intake.createFormIntake.mockClear();
      await expect(service.submit(token, { ...base, ...junk })).resolves.toEqual({ received: true });
      expect(intake.createFormIntake).not.toHaveBeenCalled();
    }
    const blocked = setup(true);
    blocked.intake.createFormIntake.mockClear();
    await expect(blocked.service.submit(token, { ...base, elapsedMs: 45_000 })).resolves.toEqual({ received: true });
    expect(blocked.intake.createFormIntake).not.toHaveBeenCalled();
  });
});
