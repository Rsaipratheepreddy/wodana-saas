import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { leadsPageFixture } from "@/lib/crm/leads";
vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));
vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
import { crmRequest } from "@/lib/crm/client";
import { LeadWorkbench } from "./lead-workbench";

const lead = structuredClone(leadsPageFixture.items[0]);
function detail(change: Record<string, unknown> = {}) {
  return {
    ...lead, version: 4, status: "connected", qualification: [], assignments: [], sla: [], opportunities: [], clientMatches: [],
    qualificationState: { ready: true, missingRequired: [], form: null },
    enquiry: { reference: "E-0042", partyName: "Layla Haddad", serviceType: "design", details: { emirate: "dubai", internalNotes: "Calls after 6pm" }, attribution: [], primaryMobile: "+971501112233" },
    team: [], teamRoles: ["designer"], notesVisible: true,
    conversion: { ready: false, missing: [{ key: "email", label: "Enter the client's email" }, { key: "team:designer", label: "Tag the designer, or choose Not applicable" }] },
    ...change,
  };
}
function setup(change?: Record<string, unknown>, options: Record<string, unknown> = {}, page: Partial<typeof leadsPageFixture> = {}) {
  const data = { ...structuredClone(leadsPageFixture), ...page };
  data.leadOptions = { sources: [{ id: "referral", label: "Referral" }], channels: { referral: [{ id: "phone", label: "Phone" }] }, enquiryTypes: [{ id: "design", label: "Design" }], budgetRanges: [], customerTypes: [],
    emirates: [{ id: "dubai", label: "Dubai" }], areas: {}, teamRoles: { design: ["designer"] }, ...options };
  vi.mocked(crmRequest).mockImplementation(async (_workspace: string, path: string) => (path === `leads/${lead.id}` ? detail(change) : { data: [] }) as never);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })));
  render(<DesignSystemProvider><LeadWorkbench lead={lead} initialData={data} onChanged={vi.fn().mockResolvedValue(undefined)} onQualify={vi.fn()} /></DesignSystemProvider>);
}
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(crmRequest).mockReset(); });

describe("an enquiry's next step and team", () => {
  it("lists what its enquiry type still needs before converting, and opens the form on those fields (PLM-096)", async () => {
    setup();
    const card = (await screen.findByRole("heading", { name: "Before converting" })).closest("section") as HTMLElement;
    expect(within(card).getByText("Enter the client's email")).toBeInTheDocument();
    expect(within(card).getByText("Tag the designer, or choose Not applicable")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Convert to opportunity" })).not.toBeInTheDocument();
    await userEvent.setup().click(within(card).getByRole("button", { name: "Complete details" }));
    const box = await screen.findByRole("alert");
    expect(box).toHaveTextContent("Before converting");
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the team role its type asks for, and the internal notes only to someone who may read them (PLM-100, PLM-024)", async () => {
    setup({ team: [{ role: "designer", membershipId: null, name: null, notApplicable: true, setAt: "2026-10-01T08:00:00Z", setByName: "Sara", version: 1 }], conversion: { ready: true, missing: [] }, notesVisible: false });
    await waitFor(() => expect(screen.getByText("Designer")).toBeInTheDocument());
    expect(screen.getAllByText("Not applicable").length).toBeGreaterThan(0);
    expect(screen.queryByText("Internal notes")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Convert to opportunity" })).toBeInTheDocument();
  });

  it("offers the designers in the Designer field, not the member directory, and names who it was assigned to (PLM-100)", async () => {
    // A salesperson reads no member directory; the assignment names its owner itself.
    setup({ conversion: { ready: true, missing: [] }, assignments: [{ id: "a1", ownerMembershipId: "m-sam", ownerName: "Sam Sales", assignmentMethod: "manual", explanation: { mode: "manual" }, reason: "Selected during creation", assignedAt: "2026-10-01T08:00:00Z" }] },
      { teamMembers: { designer: [{ id: "d1", displayName: "Dana Designer" }, { id: "d2", displayName: "Jamie Junior Designer" }] } },
      { members: [] });
    expect(await screen.findByText("Assigned to Sam Sales")).toBeInTheDocument();
    expect(screen.queryByText("Assigned to A team member")).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit Designer" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Dana Designer", "Jamie Junior Designer", "Not applicable"]);
  });
});
