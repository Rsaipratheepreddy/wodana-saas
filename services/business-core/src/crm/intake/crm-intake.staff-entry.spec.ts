import { describe, expect, it, vi } from "vitest";

// Past the staff checks the next step validates the lead options: stop there, so a test sees only the checks.
vi.mock("../leads/lead-options", () => ({ loadLeadOptions: vi.fn(), validateLeadOptions: vi.fn().mockRejectedValue(new Error("past the checks")), UNRESOLVED_ENQUIRY_TYPE: "not_sure" }));

import { CrmIntakeService } from "./crm-intake.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
const query = vi.fn(async (sql: string) => sql.includes("default_locale") ? { rowCount: 1, rows: [{ defaultLocale: "en-IN" }] } : { rowCount: 0, rows: [] });
const intake = new CrmIntakeService({} as never, {} as never, { record: vi.fn() } as never, {} as never);
vi.spyOn(intake as never, "createProblems" as never).mockResolvedValue([] as never);
const enquiry = (party: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  source: "company", channel: "call", intakeMethod: "manual", party, serviceType: "design", details: { emirate: "x" }, originalPayload: { origin: "wodana_leads_ui" }, ...extra,
});
const ingest = (input: Record<string, unknown>, sourceActor: "user" | "integration" = "user") =>
  (intake as unknown as { ingest: (...args: unknown[]) => Promise<unknown> }).ingest({ query }, workspaceId, "u1", sourceActor, `key-${Math.random()}`, undefined, input);
const problems = async (input: Record<string, unknown>, sourceActor: "user" | "integration" = "user") => {
  try { await ingest(input, sourceActor); } catch (error) {
    const body = (error as { getResponse?: () => { missing?: unknown } }).getResponse?.();
    if (body?.missing) return body.missing;
    if ((error as Error).message === "past the checks") return [];
    throw error;
  }
  return [];
};

describe("an enquiry typed by staff", () => {
  it("refuses a mobile that is not valid for its country, on the mobile field, with the digit count", async () => {
    expect(await problems(enquiry({ displayName: "Priya Sharma", mobile: "987654321", mobileCountryCode: "IN" })))
      .toEqual([{ key: "mobile", label: "Enter a valid mobile number for India (10 digits)" }]);
    expect(await problems(enquiry({ displayName: "Priya Sharma", mobile: "98765432101", mobileCountryCode: "IN" })))
      .toEqual([{ key: "mobile", label: "Enter a valid mobile number for India (10 digits)" }]);
    expect(await problems(enquiry({ displayName: "Priya Sharma", mobile: "9876543210", mobileCountryCode: "IN" }))).toEqual([]);
    // No country chosen: the workspace's region decides.
    expect(await problems(enquiry({ displayName: "Priya Sharma", mobile: "9876543210" }))).toEqual([]);
  });

  it("refuses a name with digits or symbols and accepts real names", async () => {
    expect(await problems(enquiry({ displayName: "Priya 2", mobile: "9876543210", mobileCountryCode: "IN" })))
      .toEqual([{ key: "displayName", label: "Use letters and spaces only" }]);
    for (const name of ["Mohammed Al-Suwaidi", "Anil D'Souza", "John Smith Jr.", "محمد عبد الله"])
      expect(await problems(enquiry({ displayName: name, mobile: "9876543210", mobileCountryCode: "IN" })), name).toEqual([]);
  });

  it("keeps what came from a channel as it came", async () => {
    const chatName = enquiry({ displayName: "Ali 🙂", mobile: "9876543210", mobileCountryCode: "IN" });
    expect(await problems({ ...chatName, originalPayload: { origin: "wodana_leads_ui", nameFromChannel: true } })).toEqual([]);
    expect(await problems({ ...chatName, originalPayload: { origin: "woddy" } })).toEqual([]);
    expect(await problems({ ...chatName, identity: "existing", partyId: "62000000-0000-4000-8000-000000000001" })).toEqual([]);
    expect(await problems({ ...chatName, intakeMethod: "import" })).toEqual([]);
    expect(await problems({ ...chatName, intakeMethod: "form" }, "integration")).toEqual([]);
  });
});
