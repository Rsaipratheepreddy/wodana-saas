import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { BookingTypeRecord, BookingTypesData, StaffBooking } from "@/lib/booking/booking";
import { BookingShareSheet } from "./booking-share-sheet";
import { BookingTypesPage } from "./booking-types-page";

vi.mock("qrcode", () => ({ toDataURL: vi.fn(async () => "data:image/png;base64,AAAA") }));

const type: BookingTypeRecord = {
  id: "11111111-1111-4111-8111-111111111111", name: "Design consultation", slug: "design-consultation", durationMinutes: 60, color: "viz-2", locationKind: "video", locationDetail: "https://meet.example/x",
  bufferBeforeMinutes: 0, bufferAfterMinutes: 15, minimumNoticeMinutes: 240, windowDays: 30, maxPerDay: null, slotStepMinutes: 30, cancelNoticeMinutes: 240,
  questions: [{ field: "summary", required: false }], enquiryType: null, source: "company", channel: "website", hostsMode: "one", confirmation: "approval", active: true, version: 3,
  hosts: [{ membershipId: "m1", enquiryType: null, position: 0, name: "Dana Designer" }], upcoming: 2,
};
const data: BookingTypesData = {
  data: [type], members: [{ membershipId: "m1", name: "Dana Designer" }, { membershipId: "m2", name: "Omar Sales" }], timeZone: "Europe/London", publicSlug: "studio-one",
  options: { enquiryTypes: [{ id: "fit_out", label: "Fit-out" }], sources: [{ id: "company", label: "Company" }], channels: { company: [{ id: "website", label: "Website" }, { id: "walk_in", label: "Walk-in" }] }, hasRegions: false },
};
const booking: StaffBooking = { id: "22222222-2222-4222-8222-222222222222", status: "pending", version: 1, startsAt: "2031-03-03T09:00:00.000Z", endsAt: "2031-03-03T10:00:00.000Z", visitorTimeZone: "Asia/Dubai",
  visitorName: "Maya Client", typeId: type.id, typeName: type.name, color: "viz-2", hostMembershipId: "m1", hostName: "Dana Designer", enquiryReference: "E-0042", leadId: "l1", source: "company", channel: "website", placement: null };
const workspaceId = "33333333-3333-4333-8333-333333333333";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const page = () => render(<DesignSystemProvider locale="en-GB" timeZone="Europe/London"><BookingTypesPage workspaceId={workspaceId} initialData={data} /></DesignSystemProvider>);

describe("Booking pages in Sales settings", () => {
  it("lists booking types with their hosts and confirmation, and creates a new one", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({ ...type, id: "new", name: JSON.parse(String(init?.body)).name, version: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    page();
    expect(screen.getByRole("heading", { level: 1, name: "Booking pages" })).toBeInTheDocument();
    const grid = screen.getByRole("table", { name: "Booking types" });
    expect(within(grid).getByText("Design consultation")).toBeInTheDocument();
    expect(within(grid).getByText("Dana Designer")).toBeInTheDocument();
    expect(within(grid).getByText("You confirm each")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /New booking type/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: "New booking type" });
    await user.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "Showroom visit");
    await user.click(within(dialog).getByRole("button", { name: /\bHost\b/ }));
    await user.click(await screen.findByRole("option", { name: "Omar Sales" }));
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/workspace/booking/types?workspaceId=${workspaceId}`);
    expect(JSON.parse(String(init.body))).toMatchObject({ name: "Showroom visit", hostsMode: "one", hosts: [{ membershipId: "m2" }], durationMinutes: 60, active: true });
  });

  it("confirms a requested booking with its version", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string) => url.includes("/confirm")
      ? new Response(JSON.stringify({ id: booking.id, status: "confirmed", version: 2 }), { status: 200 })
      : new Response(JSON.stringify({ data: [booking] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    page();
    await user.click(screen.getByRole("button", { name: /^Bookings/ }));
    const grid = await screen.findByRole("table", { name: "Bookings" });
    expect(within(grid).getByText("Maya Client")).toBeInTheDocument();
    expect(within(grid).getByText("Waiting for you")).toBeInTheDocument();
    await user.click(within(grid).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(within(grid).getByText("Confirmed")).toBeInTheDocument());
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/confirm")) as unknown as [string, RequestInit];
    expect(call[0]).toBe(`/api/workspace/booking/bookings/${booking.id}/confirm?workspaceId=${workspaceId}`);
    expect(JSON.parse(String(call[1].body))).toEqual({ version: 1 });
  });

  it("shares a link per placement, a QR code, an inline embed and a popup button", async () => {
    const user = userEvent.setup();
    render(<DesignSystemProvider locale="en-GB"><BookingShareSheet type={type} publicSlug="studio-one" options={data.options} origin="https://app.example" onClose={() => undefined} /></DesignSystemProvider>);
    const link = screen.getByRole("textbox", { name: "Booking link" }) as HTMLInputElement;
    expect(link.value).toBe("https://app.example/book/studio-one/design-consultation");
    await user.type(screen.getByRole("textbox", { name: /Placement/ }), "Showroom door");
    expect(link.value).toBe("https://app.example/book/studio-one/design-consultation?placement=showroom-door");
    expect((screen.getByRole("textbox", { name: "Embed on a page" }) as HTMLTextAreaElement).value).toContain("<iframe src=\"https://app.example/book/studio-one/design-consultation?placement=showroom-door&embed=1\"");
    expect((screen.getByRole("textbox", { name: "Popup button" }) as HTMLTextAreaElement).value).toContain("https://app.example/book/embed.js");
    expect(await screen.findByRole("img", { name: "QR code for this booking page" })).toBeInTheDocument();
  });
});
