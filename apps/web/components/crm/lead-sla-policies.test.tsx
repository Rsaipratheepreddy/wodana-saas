import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { leadsPageFixture } from "@/lib/crm/leads";
import { LeadResponseSla } from "./lead-sla-policies";

afterEach(() => vi.unstubAllGlobals());

describe("LeadResponseSla", () => {
  it("uses the SLA policy and health endpoints, and preserves a saved business schedule when editing", async () => {
    const user = userEvent.setup();
    const data = structuredClone(leadsPageFixture);
    const policy = data.slaPolicies[0];
    policy.calculationMode = "business";
    policy.schedule = {
      version: 1,
      mode: "business",
      timezone: "Asia/Dubai",
      weeklyHours: { sunday: [{ start: "08:00", end: "16:00" }] },
      holidays: ["2026-12-02"],
      dateOverrides: {},
    };
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => ({
      ok: true,
      json: async () => {
        if (url.includes("reports/sla")) return { summary: { withinTarget: 8, breached: 1, averageResponseMinutes: 125 }, rows: [] };
        if (init.method === "PATCH") return { ...policy, name: "Urgent first response" };
        return data.slaPolicies;
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<LeadResponseSla initialData={data} />);

    expect(await screen.findByRole("region", { name: "Response SLA policies" })).toHaveTextContent("Business hours");
    expect(screen.getByLabelText("Response SLA health")).toHaveTextContent("2 h 5 min");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit response SLA" });
    const name = within(dialog).getByRole("textbox", { name: "Policy name" });
    await user.clear(name);
    await user.type(name, "Urgent first response");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes(`sla-policies/${policy.id}`) && init.method === "PATCH")).toBe(true));
    const [, request] = fetchMock.mock.calls.find(([url, init]) => String(url).includes(`sla-policies/${policy.id}`) && init.method === "PATCH")!;
    expect(JSON.parse(String(request.body))).toMatchObject({
      version: policy.version,
      name: "Urgent first response",
      calculationMode: "business",
      schedule: policy.schedule,
    });
  });

  it("shows the Palm weekday office calendar without confusing it with the elapsed takeover clock", async () => {
    const data = structuredClone(leadsPageFixture);
    data.slaPolicies[0].calculationMode = "business";
    data.slaPolicies[0].schedule = {
      version: 1,
      mode: "business",
      timezone: "Asia/Dubai",
      weeklyHours: {
        monday: [{ start: "08:00", end: "18:00" }],
        tuesday: [{ start: "08:00", end: "18:00" }],
        wednesday: [{ start: "08:00", end: "18:00" }],
        thursday: [{ start: "08:00", end: "18:00" }],
        friday: [{ start: "08:00", end: "18:00" }],
      },
      holidays: [],
      dateOverrides: {},
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.includes("reports/sla") ? { summary: {}, rows: [] } : data.slaPolicies,
    })));
    render(<LeadResponseSla initialData={data} />);
    expect(await screen.findByText("Mon–Fri · 08:00–18:00 · Asia/Dubai")).toBeInTheDocument();
  });
});
