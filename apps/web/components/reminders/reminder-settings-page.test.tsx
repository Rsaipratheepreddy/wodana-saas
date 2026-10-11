import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReminderRuleDto, ReminderSettingsResponse } from "@wodana/contracts";
import { ReminderSettingsPage } from "./reminder-settings-page";

const workspaceId = "00000000-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllGlobals());

const rule = (overrides: Partial<ReminderRuleDto>): ReminderRuleDto => ({
  kind: "work.due", module: "projects", audience: "staff", critical: false, enabled: true, offsets: [-1, 0, 1, 3], unit: "day", workingDays: false,
  escalateAfter: 2, chain: ["manager", "owner"], channels: ["in_app", "push", "email"], digest: false, quietHours: null, isDefault: true, version: 0, ...overrides,
});
const data = (): ReminderSettingsResponse => ({
  settings: { quietStart: "20:00", quietEnd: "08:00", digestTime: "08:00", clientWindow: null, criticalBreaksQuiet: false, version: 2 },
  rules: [
    rule({}),
    rule({ kind: "approval.waiting", module: "approvals", critical: true, offsets: [24, 48], unit: "hour", chain: ["owner"] }),
    rule({ kind: "client.quote_decision", module: "quotations", audience: "client", offsets: [2, 5], escalateAfter: 2, chain: [], channels: ["whatsapp", "email"], isDefault: false, version: 4 }),
  ],
});

type Call = { url: string; method: string; body: unknown };
function api({ status = 200, saveStatus = 200 } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(input), method, body });
    if (method === "GET") return { ok: status < 400, status, json: async () => (status < 400 ? data() : { message: "Permissions required" }) };
    if (saveStatus >= 400) return { ok: false, status: saveStatus, json: async () => ({ message: "Changed by someone else" }) };
    if (String(input).includes("/reminders/settings")) return { ok: true, status: 200, json: async () => ({ ...data(), settings: { ...body, version: body.version + 1 } }) };
    const kind = decodeURIComponent(String(input).split("/rules/")[1].split("?")[0]);
    const base = data().rules.find((item) => item.kind === kind)!;
    return { ok: true, status: 200, json: async () => (method === "DELETE" ? { ...base, kind, offsets: [2, 5], isDefault: true, version: 0 } : { ...base, ...body, isDefault: false, version: (body.version ?? 0) + 1 }) };
  }));
  return calls;
}

describe("Settings › Reminders", () => {
  it("shows the firm defaults and one section per module, critical reminders always on", async () => {
    api();
    render(<ReminderSettingsPage workspaceId={workspaceId} focusKind="client.quote_decision" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Reminders" })).toBeInTheDocument();
    const defaults = await screen.findByRole("region", { name: "Firm defaults" });
    expect(within(defaults).getByRole("switch", { name: "Critical reminders break quiet hours" })).not.toBeChecked();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Firm defaults", "Quotations", "Projects", "Approvals"]);
    const approvals = screen.getByRole("article", { name: "Approvals waiting" });
    const locked = within(approvals).getByRole("switch", { name: "Approvals waiting: always on" });
    expect(locked).toBeChecked();
    expect(locked).toBeDisabled();
    expect(within(approvals).getByText("24 hours after")).toBeInTheDocument();
    expect(within(approvals).queryByRole("switch", { name: "In the daily digest" })).not.toBeInTheDocument();
    const quote = screen.getByRole("article", { name: "Quotation waiting on the client" });
    expect(quote).toHaveAttribute("data-highlighted", "true");
    expect(within(quote).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual(["WhatsApp", "Email"]);
    expect(within(quote).getByRole("button", { name: "Reset to default" })).toBeInTheDocument();
    const work = screen.getByRole("article", { name: "Work due" });
    expect(within(work).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual(["In app", "Push", "Email"]);
    expect(["1 day before", "On the day", "1 day after", "3 days after"].every((text) => within(work).getByText(text))).toBe(true);
    expect(within(work).queryByRole("button", { name: "Reset to default" })).not.toBeInTheDocument();
  });

  it("saves a row's cadence, escalation and channels with its version (0 while it was the default)", async () => {
    const calls = api();
    const user = userEvent.setup();
    render(<ReminderSettingsPage workspaceId={workspaceId} />);
    const work = await screen.findByRole("article", { name: "Work due" });
    expect(within(work).getByRole("button", { name: "Save Work due" })).toBeDisabled();
    await user.click(within(work).getByRole("button", { name: "Remove 3 days after" }));
    await user.click(within(work).getByRole("button", { name: "Add a reminder" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a reminder" });
    await user.clear(within(dialog).getByRole("textbox", { name: "Days" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Days" }), "7");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a reminder" })).not.toBeInTheDocument());
    expect(within(work).getByText("7 days after")).toBeInTheDocument();
    await user.click(within(work).getByRole("switch", { name: "Working days only" }));
    await user.click(within(work).getByRole("checkbox", { name: "Push" }));
    await user.click(within(work).getByRole("button", { name: "Remove 2. Owner" }));
    await user.click(within(work).getByRole("button", { name: "Save Work due" }));
    await waitFor(() => expect(calls.find((call) => call.method === "PUT")).toBeDefined());
    const put = calls.find((call) => call.method === "PUT")!;
    expect(put.url).toBe(`/api/workspace/reminders/rules/work.due?workspaceId=${workspaceId}`);
    expect(put.body).toEqual({ enabled: true, offsets: [-1, 0, 1, 7], unit: "day", workingDays: true, escalateAfter: 2, chain: ["manager"], channels: ["in_app", "email"], digest: false, quietHours: null, version: 0 });
    await waitFor(() => expect(within(screen.getByRole("article", { name: "Work due" })).getByRole("button", { name: "Reset to default" })).toBeInTheDocument());
  });

  it("puts a row back to the default, and says so when someone else changed it first", async () => {
    let calls = api();
    const user = userEvent.setup();
    const { unmount } = render(<ReminderSettingsPage workspaceId={workspaceId} />);
    const quote = await screen.findByRole("article", { name: "Quotation waiting on the client" });
    await user.click(within(quote).getByRole("button", { name: "Reset to default" }));
    await waitFor(() => expect(calls.find((call) => call.method === "DELETE")?.url).toBe(`/api/workspace/reminders/rules/client.quote_decision?workspaceId=${workspaceId}&version=4`));
    unmount();

    calls = api({ saveStatus: 409 });
    render(<ReminderSettingsPage workspaceId={workspaceId} />);
    const work = await screen.findByRole("article", { name: "Work due" });
    await user.click(within(work).getByRole("switch", { name: "Turn on Work due" }));
    await user.click(within(work).getByRole("button", { name: "Save Work due" }));
    const alert = await within(work).findByRole("alert");
    expect(alert).toHaveTextContent("Changed by someone else");
    await user.click(within(alert).getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "GET")).toHaveLength(2));
  });

  it("saves the firm's defaults with their version", async () => {
    const calls = api();
    const user = userEvent.setup();
    render(<ReminderSettingsPage workspaceId={workspaceId} />);
    const defaults = await screen.findByRole("region", { name: "Firm defaults" });
    await user.click(within(defaults).getByRole("switch", { name: "Critical reminders break quiet hours" }));
    await user.click(within(defaults).getByRole("radio", { name: "Custom" }));
    await user.click(within(defaults).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
      quietStart: "20:00", quietEnd: "08:00", digestTime: "08:00", clientWindow: { start: "09:00", end: "18:00" }, criticalBreaksQuiet: true, version: 2,
    }));
  });

  it("tells people without the permission that they can't open it", async () => {
    api({ status: 403 });
    render(<ReminderSettingsPage workspaceId={workspaceId} />);
    expect(await screen.findByText("You don't have access to Reminders")).toBeInTheDocument();
  });
});
