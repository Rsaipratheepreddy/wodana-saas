import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { leadsPageFixture } from "@/lib/crm/leads";
import { SalesReports } from "./sales-reports";

const FIELD = "7d1b6c1e-2f0a-4c55-9d7e-0a1b2c3d4e5f";
const data = () => ({ ...structuredClone(leadsPageFixture), enquiryFields: {
  system: { email: { visible: true, version: 0 }, customerType: { visible: true, version: 0 }, area: { visible: true, version: 0 }, budgetRange: { visible: false, version: 1 }, summary: { visible: true, version: 0 } },
  custom: [{ id: FIELD, key: "ptype", label: "Property type", dataType: "select" as const, configuration: { options: ["Villa"] }, visible: true, position: 1, version: 1 }],
} });
afterEach(() => vi.unstubAllGlobals());

describe("Sales reports", () => {
  it("breaks enquiries down by any shown field, including the workspace's own", async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => String(url).includes("groupBy=cf") ? { rows: [{ id: "Villa", label: "Villa", leads: 4, qualified: 1, qualificationRate: 25 }], summary: { leads: 4, qualified: 1 } } : { rows: [{ id: "company / website", label: "company / website", leads: 2 }], summary: { leads: 2 } } }));
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<DesignSystemProvider><SalesReports initialData={data()} regionLabel="Emirate" /></DesignSystemProvider>);
    expect(await within(await screen.findByRole("table", { name: "Enquiry breakdown" })).findByText(/·/)).toBeInTheDocument();
    const breakdown = screen.getByRole("combobox", { name: "Break down by" });
    await user.clear(breakdown);
    await user.type(breakdown, "Bud");
    expect(screen.queryByRole("option", { name: "Budget" })).not.toBeInTheDocument();
    await user.clear(breakdown);
    await user.type(breakdown, "Property");
    await user.click(await screen.findByRole("option", { name: "Property type" }));
    const table = await screen.findByRole("table", { name: "Enquiry breakdown" });
    expect(await within(table).findByText("Villa")).toBeInTheDocument();
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(`groupBy=cf%3A${FIELD}`);
  });

  it("names the forecast row of opportunities with no value instead of leaving it blank", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => String(url).includes("reports/forecast")
      ? { rows: [{ id: "a", currency: "AED", status: "open", count: 2, amount: "5000", weightedAmount: "2500" }, { id: "b", currency: null, status: "open", count: 1, amount: "0", weightedAmount: "0" }], summary: {} }
      : { rows: [], summary: {} } })));
    const user = userEvent.setup();
    render(<DesignSystemProvider><SalesReports initialData={data()} regionLabel="Emirate" /></DesignSystemProvider>);
    await user.click(screen.getByRole("radio", { name: "Forecast" }));
    expect(await screen.findByText("No value set · Open")).toBeInTheDocument();
    expect(screen.queryByText(/^ · Open$/)).toBeNull();
  });

  it("says plainly when a report needs access, instead of an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("reports/pipeline") ? { ok: false, status: 403, json: async () => ({ message: "Forbidden" }) } : { ok: true, json: async () => ({ rows: [], summary: {} }) }));
    const user = userEvent.setup();
    render(<DesignSystemProvider><SalesReports initialData={data()} regionLabel="Emirate" /></DesignSystemProvider>);
    await user.click(screen.getByRole("radio", { name: "Pipeline" }));
    await waitFor(() => expect(screen.getByText("You can't see this report")).toBeInTheDocument());
  });
});
