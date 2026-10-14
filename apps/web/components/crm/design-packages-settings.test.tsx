import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { DesignPackagesSettings } from "./design-packages-settings";

afterEach(() => vi.unstubAllGlobals());
const settings = { minimumDeposit: { amount: "15000.00", currency: "AED" }, version: 1, packages: [
  { id: "1", code: "concept", name: "Concept Package", pricingMethod: "per_space", rate: "10000.00", currency: "AED", areaUnit: null, includedRevisions: 2, includesSpacePlanning: false, includesRenders: false, requiredRoleCode: null, inclusions: null, position: 1, status: "active", version: 1 },
  { id: "2", code: "bespoke", name: "Bespoke Interior Design", pricingMethod: "per_area", rate: "40.00", currency: "AED", areaUnit: "sqft", includedRevisions: 2, includesSpacePlanning: true, includesRenders: true, requiredRoleCode: null, inclusions: null, position: 2, status: "active", version: 1 },
] };

describe("design packages settings (PLM-041)", () => {
  it("lists packages with their pricing and the minimum deposit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => settings }));
    render(<DesignSystemProvider><DesignPackagesSettings workspaceId="ws" currency="AED" locale="en-GB" canManage /></DesignSystemProvider>);
    expect(await screen.findByText("Concept Package")).toBeInTheDocument();
    expect(screen.getByText(/10,000\.00 \/ space/)).toBeInTheDocument();
    expect(screen.getByText(/40\.00 \/ sq ft/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Minimum deposit" })).toHaveValue("15000");
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add package" })).toBeInTheDocument();
  });

  it("shows an empty minimum as no minimum, not as 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...settings, minimumDeposit: null }) }));
    render(<DesignSystemProvider><DesignPackagesSettings workspaceId="ws" currency="AED" locale="en-GB" canManage /></DesignSystemProvider>);
    expect(await screen.findByText("Concept Package")).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "Minimum deposit" });
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "No minimum");
    expect(screen.queryByText(/AED\s?0\b/)).not.toBeInTheDocument();
  });

  it("edits a question's section, how it's answered, its scope and the checklist's match words, and saves them with the list", async () => {
    const flow = { designInternalDays: 35, designClientDays: 56, materialSelectionDays: 7, estimateDays: 7, visualiserRoleCode: "visualiser", showroomBookingTypeId: null,
      siteVisitQuestions: [{ key: "core.01", question: "What type of property is this?", section: "Project overview" },
        { key: "kitchen.01", question: "Record appliance brand and model.", scope: "Kitchens and islands", kind: "check" }],
      siteVisitScopes: [{ scope: "Kitchens and islands", match: ["kitchen"] }] };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...settings, flow }) });
    vi.stubGlobal("fetch", fetch);
    render(<DesignSystemProvider><DesignPackagesSettings workspaceId="ws" currency="AED" locale="en-GB" canManage /></DesignSystemProvider>);
    expect(await screen.findByRole("textbox", { name: "Section of question 1" })).toHaveValue("Project overview");
    // A checklist line has no section: its scope is the checklist.
    expect(screen.getByRole("textbox", { name: "Section of question 2" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Section of question 1" }), { target: { value: "Lifestyle and everyday needs" } });
    const words = screen.getByRole("combobox", { name: "Applies to rooms or items named" });
    fireEvent.change(words, { target: { value: "island" } });
    fireEvent.keyDown(words, { key: "Enter" });
    fireEvent.click(screen.getByRole("switch", { name: "Every job" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("flow-settings"))).toBe(true));
    const body = JSON.parse(fetch.mock.calls.find(([url]) => String(url).includes("flow-settings"))![1].body as string);
    expect(body.siteVisitQuestions).toEqual([{ key: "core.01", question: "What type of property is this?", scope: null, section: "Lifestyle and everyday needs", kind: null },
      { key: "kitchen.01", question: "Record appliance brand and model.", scope: "Kitchens and islands", section: null, kind: "check" }]);
    expect(body.siteVisitScopes).toEqual([{ scope: "Kitchens and islands", match: ["kitchen", "island"], everyJob: true }]);
  });

  it("is read-only for people who cannot change settings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => settings }));
    render(<DesignSystemProvider><DesignPackagesSettings workspaceId="ws" currency="AED" canManage={false} /></DesignSystemProvider>);
    expect(await screen.findByText("Bespoke Interior Design")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add package" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Minimum deposit" })).toBeDisabled();
  });
});
