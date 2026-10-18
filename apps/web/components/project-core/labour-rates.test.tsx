import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { LabourRates, TradeRate } from "@/lib/project-core/types";
import { LabourRatesSection } from "./labour-rates";

const rate = (patch: Partial<TradeRate>): TradeRate => ({ id: "t1", key: "carpenters", trade: "Carpenters", from: "2026-09-01", rate: "180.0000", currency: "AED", version: 1,
  updatedByName: "Omar Manager", updatedAt: "2026-09-01T08:00:00Z", ...patch });
const state = (patch: Partial<LabourRates> = {}): LabourRates => ({
  currency: "AED", today: "2026-09-27", canManage: true, trades: [
    { key: "carpenters", name: "Carpenters", reports: 4, rates: [rate({}), rate({ id: "t2", from: "2026-10-01", rate: "200.0000" })] },
    { key: "painters", name: "Painters", reports: 1, rates: [] }],
  ...patch,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));
const section = () => render(<DesignSystemProvider><LabourRatesSection workspaceId="w" /></DesignSystemProvider>);
const trade = async (name: string) => (await screen.findByText(name)).closest(".wd-settings-row") as HTMLElement;

describe("labour rates", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows each trade's day rate today and the next one, and prices a trade the site reports use without a rate", async () => {
    let current = state();
    const fetcher = mount((url, body) => {
      if (body) current = state({ trades: [current.trades[0], { ...current.trades[1], rates: [rate({ id: "t3", key: "painters", trade: "Painters", rate: "150.5000", from: String(body.from) })] }] });
      return current;
    });
    section();
    expect(await trade("Carpenters")).toHaveTextContent(/AED\s?200\.00 from .* · On 4 site reports.*AED\s?180\.00 a day/);
    const painters = await trade("Painters");
    expect(painters).toHaveTextContent("No rate");
    await userEvent.click(within(painters).getByRole("button", { name: "Set rate" }));
    const dialog = await screen.findByRole("dialog", { name: "Painters" });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Day rate" }), "150.5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "save", trade: "Painters", dayRate: "150.5", from: "2026-09-27", version: 0 }));
    expect(posts(fetcher).at(-1)!.url).toContain("/api/project-core/labour-rates");
    expect(await trade("Painters")).toHaveTextContent(/AED\s?150\.50 a day/);
  });

  it("corrects a rate from the same day against its version, removes a mistaken one, and says when someone else changed it", async () => {
    const fetcher = mount((url, body) => (body?.action === "save" ? new Error("Someone else changed this rate. Reload to see their change.")
      : body?.action === "remove" ? state({ today: "2026-09-01", trades: [{ ...state().trades[0], rates: [rate({})] }, state().trades[1]] }) : state({ today: "2026-09-01" })));
    section();
    await userEvent.click(within(await trade("Carpenters")).getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "Carpenters" });
    const history = within(dialog).getByRole("list", { name: "Rates" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(within(history).getAllByRole("button", { name: /Remove/ })[0]);
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "remove", id: "t2", version: 1 }));
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(1));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Day rate" }), "185");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "save", trade: "Carpenters", dayRate: "185", from: "2026-09-01", version: 1 }));
    expect(await within(dialog).findByText("Someone else changed this rate. Reload to see their change.")).toBeInTheDocument();
  });

  it("shows the rates read-only to people who don't manage settings", async () => {
    mount(() => state({ canManage: false }));
    section();
    expect(await trade("Painters")).toHaveTextContent("No rate");
    expect(screen.queryByRole("button", { name: "Add trade" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Change|Set rate/ })).toBeNull();
  });
});
