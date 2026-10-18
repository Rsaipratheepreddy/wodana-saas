import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider, ListTabs, PageShell } from "@/design-system";
import { LogisticsCalendar } from "./logistics-calendar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/workspace/factory/calendar", useSearchParams: () => new URLSearchParams() }));

const workspaceId = "00000000-0000-4000-8000-000000000001";
const P1 = "00000000-0000-4000-8000-0000000000a1", P2 = "00000000-0000-4000-8000-0000000000a2";
const ALI = "00000000-0000-4000-8000-0000000000b1", SAM = "00000000-0000-4000-8000-0000000000b2", OMAR = "00000000-0000-4000-8000-0000000000b3";
const VAN = "00000000-0000-4000-8000-0000000000c1", TRUCK = "00000000-0000-4000-8000-0000000000c2";
const day = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

type Call = { url: string; method: string; body: Record<string, unknown> };
let calls: Call[] = [];
const entries = () => [
  { key: `delivery:${P1}`, kind: "delivery", recordId: P1, subject: "PRJ-1 · Villa 12", detail: null, start: day(0), end: day(0), allDay: true, days: null, status: "booked", overdue: false,
    ownerName: "Ali Khan", href: `/workspace/projects/${P1}`, projectId: P1, workOrderId: null, permitId: null,
    crew: { people: [{ id: ALI, name: "Ali Khan", lead: true }, { id: SAM, name: "Sam", lead: false }], crew: null, vehicle: { id: VAN, name: "Van 2" }, driver: { id: OMAR, name: "Omar Driver" }, note: "Gate 4", version: 3 } },
  { key: `installation:${P2}`, kind: "installation", recordId: P2, subject: "PRJ-2 · Flat 4", detail: null, start: day(0), end: day(0), allDay: true, days: null, status: "not_started", overdue: false,
    ownerName: null, href: `/workspace/projects/${P2}`, projectId: P2, workOrderId: null, permitId: null,
    crew: { people: [{ id: SAM, name: "Sam", lead: true }], crew: null, vehicle: null, driver: null, note: "", version: 1 }, permit: { covered: false, validTo: null } },
  { key: "deal-delivery:00000000-0000-4000-8000-0000000000e1", kind: "delivery", recordId: "00000000-0000-4000-8000-0000000000e1", subject: "O-2 · Sofa set", detail: null, start: day(0), end: day(0),
    allDay: true, days: null, status: "booked", overdue: false, ownerName: null, href: "/workspace/crm/opportunities?record=00000000-0000-4000-8000-0000000000e1",
    opportunityId: "00000000-0000-4000-8000-0000000000e1", workOrderId: null, permitId: null,
    crew: { people: [], crew: null, vehicle: { id: TRUCK, name: "Truck 1" }, driver: null, note: "", version: 1 }, permit: { covered: true, validTo: day(5) } },
];
const options = {
  projects: [{ id: P1, label: "PRJ-1 · Villa 12", deliveryOn: day(0), installationOn: day(2), slotOn: null, permitRequired: true, plannedPermitId: null },
    { id: P2, label: "PRJ-2 · Flat 4", deliveryOn: null, installationOn: day(0), slotOn: null, permitRequired: false, plannedPermitId: null }],
  deals: [{ id: "00000000-0000-4000-8000-0000000000e1", label: "O-2 · Sofa set", deliveryOn: null, plannedPermitId: null, permitRequired: true }],
  permitTypes: ["Building access"],
  workOrders: [], crews: [{ id: "00000000-0000-4000-8000-0000000000d1", name: "Carpentry A", trade: "Carpentry", workerIds: [ALI, SAM] }],
  workers: [{ id: ALI, name: "Ali Khan", phone: "+971501234567", trade: "Installer", crewId: null }, { id: SAM, name: "Sam", phone: "", trade: "Helper", crewId: null },
    { id: OMAR, name: "Omar Driver", phone: "", trade: "Driver", crewId: null }],
  vehicles: [{ id: VAN, name: "Van 2", plate: "DXB A 1", kind: "Van", capacityNote: "" }, { id: TRUCK, name: "Truck 1", plate: "DXB B 2", kind: "Truck", capacityNote: "3 t" }],
  canBook: true, canAddPeople: true, permitWarningDays: 3,
};
const emptyBooking = (kind: string, projectId: string) => ({ kind, projectId, opportunityId: null, workOrderId: null, permitId: null, project: "PRJ-2 · Flat 4", start: null, end: null, assignmentId: null, version: 0,
  people: [], crew: null, vehicle: null, driver: null, note: "", permit: { required: false, permits: [] }, canBook: true, canClear: true });

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : {} });
    const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.startsWith("/api/workspace/team-calendars/logistics?")) return reply({ team: "logistics", today: day(0), timeZone: "UTC", entries: entries(), canBook: true, canManage: true, google: false });
    if (url.startsWith("/api/logistics/options?")) return reply(options);
    if (url.startsWith("/api/logistics/booking?")) return reply(emptyBooking(new URL(url, "http://x").searchParams.get("kind")!, new URL(url, "http://x").searchParams.get("projectId")!));
    if (url.startsWith("/api/logistics/bookings/conflicts?")) {
      const body = JSON.parse(String(init.body));
      return reply({ warnings: (body.workerIds as string[]).includes(SAM) && body.projectId === P2 && body.kind === "delivery"
        ? [{ kind: "person", id: SAM, name: "Sam", key: `delivery:${P1}`, what: "delivery", project: "PRJ-1 · Villa 12", day: day(0) }] : [] });
    }
    if (url.startsWith("/api/logistics/people?")) { const body = JSON.parse(String(init.body)); return reply({ id: body.id, name: body.name, phone: body.phone, trade: body.trade, crewId: null }); }
    if (url.startsWith("/api/logistics/bookings?")) return reply({ ...emptyBooking("delivery", P2), start: day(0), warnings: [] });
    return reply({});
  }));
});
afterEach(() => vi.unstubAllGlobals());

const renderCalendar = () => render(<DesignSystemProvider><LogisticsCalendar workspaceId={workspaceId} /></DesignSystemProvider>);

describe("the factory and logistics calendar (PLM-135, PLM-136)", () => {
  it("puts its controls and Book in the page's one row, beside Factory's tabs", async () => {
    const { container } = render(<DesignSystemProvider><PageShell title="Factory" tabs={<ListTabs label="Sections" items={[{ id: "calendar", label: "Calendar" }]} value="calendar" onChange={() => undefined} />}>
      <LogisticsCalendar workspaceId={workspaceId} />
    </PageShell></DesignSystemProvider>);
    const row = container.querySelector<HTMLElement>(".wd-page-shell-tabs")!;
    expect(await within(row).findByRole("button", { name: "Book" })).toBeInTheDocument();
    expect(within(row).getByRole("toolbar", { name: "Calendar controls" })).toBeInTheDocument();
    expect(container.querySelector(".wd-page-shell-body [role=toolbar]")).toBeNull();
  });

  it("shows who goes on each booking, the vehicle and driver, Furniture Only deliveries and missing permits, and filters by vehicle", async () => {
    const user = userEvent.setup();
    renderCalendar();
    const delivery = await screen.findByRole("button", { name: "Delivery · PRJ-1 · Villa 12" });
    expect(within(delivery).getByText("Ali Khan · +1 · Van 2")).toBeInTheDocument();
    // PLM-136: an installation whose building permit doesn't cover its day says so.
    expect(within(screen.getByRole("button", { name: "Installation · PRJ-2 · Flat 4" })).getByText("No building permit")).toBeInTheDocument();
    // A Furniture Only deal's delivery is on the same calendar.
    expect(screen.getByRole("button", { name: "Delivery · O-2 · Sofa set" })).toBeInTheDocument();
    await user.click(delivery);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Omar Driver")).toBeInTheDocument();
    expect(within(sheet).getByText("Van 2")).toBeInTheDocument();
    expect(within(sheet).getByText("Ali Khan, Sam")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Edit booking" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // Filtering by a vehicle leaves only the bookings that use it.
    await user.click(screen.getByRole("button", { name: /All vehicles/ }));
    await user.click(await screen.findByRole("option", { name: "Van 2" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Installation · PRJ-2 · Flat 4" })).toBeNull());
    expect(screen.getByRole("button", { name: "Delivery · PRJ-1 · Villa 12" })).toBeInTheDocument();
  });

  it("moves a booking by dragging it to another day, checked against what was seen", async () => {
    renderCalendar();
    const delivery = await screen.findByRole("button", { name: "Delivery · PRJ-1 · Villa 12" });
    const target = delivery.closest("section")!.nextElementSibling as HTMLElement;
    const dataTransfer = { setData: vi.fn(), getData: () => `delivery:${P1}`, effectAllowed: "" };
    fireEvent.dragStart(delivery, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(calls.find((call) => call.method === "POST" && call.url.startsWith("/api/logistics/bookings?"))?.body)
      .toMatchObject({ kind: "delivery", projectId: P1, day: day(1), was: { start: day(0) }, version: 3 }));
  });

  it("adds someone typed as free text to the names list and the booking (PLM-135)", async () => {
    const user = userEvent.setup();
    renderCalendar();
    await user.click(await screen.findByRole("button", { name: "Book" }));
    const dialog = await screen.findByRole("dialog", { name: "Book" });
    await user.click(await within(dialog).findByRole("button", { name: /Project or deal/ }));
    // Deals delivered without a project are offered for a delivery.
    await user.click(await screen.findByRole("option", { name: /O-2 · Sofa set/ }));
    const add = within(dialog).getByPlaceholderText("Add…");
    await user.type(add, "Yusuf Helper");
    await user.click(await screen.findByRole("option", { name: /Create “Yusuf Helper”/ }));
    await waitFor(() => expect(calls.find((call) => call.url.startsWith("/api/logistics/people?"))?.body).toMatchObject({ name: "Yusuf Helper", phone: "", trade: "Delivery crew" }));
    await waitFor(() => expect(within(dialog).getAllByText("Yusuf Helper").length).toBeGreaterThan(0));
  });

  it("books a delivery with its crew, vehicle and driver, warns of a double booking, and adds a driver by name", async () => {
    const user = userEvent.setup();
    renderCalendar();
    await user.click(await screen.findByRole("button", { name: "Book" }));
    const dialog = await screen.findByRole("dialog", { name: "Book" });
    await user.click(await within(dialog).findByRole("button", { name: /Project or deal/ }));
    await user.click(await screen.findByRole("option", { name: "PRJ-2 · Flat 4" }));
    // A crew fills its people; Sam is already on another delivery that day.
    await user.click(within(dialog).getByRole("button", { name: /No crew/ }));
    await user.click(await screen.findByRole("option", { name: /Carpentry A/ }));
    expect(await within(dialog).findByText("Sam is also on delivery · PRJ-1 · Villa 12")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /No vehicle/ }));
    await user.click(await screen.findByRole("option", { name: /Truck 1/ }));
    // Someone not on the list is added by name and phone, without a login.
    await user.click(within(dialog).getByRole("button", { name: "Add driver" }));
    const add = await screen.findByRole("dialog", { name: "Add person" });
    await user.type(within(add).getByRole("textbox", { name: /Name/ }), "Rami New");
    expect(within(add).getByRole("textbox", { name: /Trade/ })).toHaveValue("Driver");
    await user.click(within(add).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.find((call) => call.url.startsWith("/api/logistics/people?"))?.body).toMatchObject({ name: "Rami New", trade: "Driver" }));
    expect(await within(dialog).findByRole("button", { name: /Rami New/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((call) => call.method === "POST" && call.url.startsWith("/api/logistics/bookings?"))?.body).toMatchObject({
      kind: "delivery", projectId: P2, day: day(0), was: { start: null }, version: 0, vehicleId: TRUCK,
      people: [{ workerId: ALI, lead: true }, { workerId: SAM, lead: false }] }));
    const saved = calls.find((call) => call.method === "POST" && call.url.startsWith("/api/logistics/bookings?"))!.body;
    expect(saved.driverWorkerId).toBe(calls.find((call) => call.url.startsWith("/api/logistics/people?"))!.body.id);
  });
});
