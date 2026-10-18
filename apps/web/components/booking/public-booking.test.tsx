import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ManageView, PublicBookingType } from "@/lib/booking/booking";
import { ManageBooking } from "./manage-booking";
import { PublicBooking } from "./public-booking";

const data: PublicBookingType = {
  type: { name: "Design consultation", slug: "design-consultation", durationMinutes: 60, color: "viz-1", locationKind: "our_location", locationDetail: "Studio 4, Marina",
    questions: [{ field: "summary", required: false }], asksEnquiryType: false, confirmation: "automatic", windowDays: 30, cancelNoticeMinutes: 240 },
  timeZone: "Europe/London", locale: "en-GB", defaultCountryCode: "GB", branding: { displayName: "Studio One", primaryColor: null, logoUrl: null },
  options: { enquiryTypes: [], regions: [], areas: {}, budgetRanges: [] }, consentLabel: "I agree to be contacted about this booking.",
};
const slots = [
  { start: "2031-03-03T09:00:00.000Z", end: "2031-03-03T10:00:00.000Z" },
  { start: "2031-03-03T10:00:00.000Z", end: "2031-03-03T11:00:00.000Z" },
  { start: "2031-03-04T09:00:00.000Z", end: "2031-03-04T10:00:00.000Z" },
];
const token = "a".repeat(43);
// The visitor's clock: London unless a test says otherwise.
let visitorZone = "Europe/London";
const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
beforeEach(() => {
  visitorZone = "Europe/London";
  // Only the browser's own zone (a formatter made without one) changes; formatters for a named zone keep it.
  const system = resolved.call(new Intl.DateTimeFormat()).timeZone;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    const options = resolved.call(this);
    return options.timeZone === system ? { ...options, timeZone: visitorZone } : options;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function renderPage(dir: "ltr" | "rtl" = "ltr") {
  return render(<DesignSystemProvider locale="en-GB" timeZone="Europe/London" direction={dir}><PublicBooking data={data} workspace="studio-one" slots={slots} link={{ placement: "showroom-door" }} /></DesignSystemProvider>);
}

async function pickAndFill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Tuesday,? 4 March/ }));
  await user.click(screen.getByRole("button", { name: /^0?9:00/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: /Your name/ }), "Maya Client");
  await user.type(screen.getByRole("textbox", { name: /Mobile number/ }), "7400123456");
  await user.type(screen.getByRole("textbox", { name: /Email address/ }), "maya@example.com");
  await user.click(screen.getByRole("checkbox", { name: "WhatsApp" }));
  await user.click(screen.getByRole("checkbox", { name: /I agree to be contacted/ }));
}

describe("Public booking page", () => {
  it("goes day → time → short form → done, with Add to calendar and the manage link", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ received: true, status: "confirmed", bookingId: "b1", start: slots[2].start, end: slots[2].end, manageToken: token }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    expect(screen.getByRole("heading", { name: "Design consultation" })).toBeInTheDocument();
    expect(screen.getByText("60 min")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await pickAndFill(user);
    await user.click(screen.getByRole("button", { name: "Book" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "You're booked" })).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/book/studio-one/design-consultation");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ start: slots[2].start, serviceConsent: true, consents: { whatsapp: true, email: false, sms: false }, link: { placement: "showroom-door" },
      answers: { displayName: "Maya Client", mobile: "7400123456", email: "maya@example.com", mobileCountryCode: "GB" } });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.website).toBeUndefined();
    expect(screen.getByRole("link", { name: "Add to calendar" })).toHaveAttribute("href", `/api/book/studio-one/manage/${token}/ics`);
    expect(screen.getByRole("link", { name: "Reschedule or cancel" })).toHaveAttribute("href", `/book/studio-one/manage/${token}`);
  });

  it("sends a visitor back to pick again when someone else took the time", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string) => url.includes("/slots")
      ? new Response(JSON.stringify({ slots: slots.slice(0, 2) }), { status: 200 })
      : new Response(JSON.stringify({ code: "slot_taken", message: "That time was just taken. Choose another time", nextSlots: [slots[1]] }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    await pickAndFill(user);
    await user.click(screen.getByRole("button", { name: "Book" }));
    await waitFor(() => expect(screen.getByText("That time was just taken")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/slots?"))).toBe(true));
  });

  it("shows times on the visitor's clock and names the firm's when they differ", async () => {
    const user = userEvent.setup();
    visitorZone = "Asia/Dubai";
    vi.stubGlobal("fetch", vi.fn());
    renderPage();
    expect(await screen.findByText(/we are on London time/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^13:00/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/^0?9:00 London time$/)).toBeInTheDocument();
  });

  it("asks for consent before booking and keeps the trap field out of reach", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn());
    const { container } = renderPage("rtl");
    expect(container.querySelector("[dir=rtl]")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: /^0?9:00/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Book" })).toBeDisabled();
    const trap = container.querySelector("input[name=website]") as HTMLInputElement;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest("[aria-hidden=true]")).not.toBeNull();
  });
});

describe("Manage booking page", () => {
  const view: ManageView = {
    booking: { status: "confirmed", version: 1, start: slots[0].start, end: slots[0].end, visitorTimeZone: "Europe/London", visitorName: "Maya", canChange: true, reason: null },
    type: { name: "Design consultation", slug: "design-consultation", durationMinutes: 60, locationKind: "video", locationDetail: null, windowDays: 30 },
    timeZone: "Europe/London", locale: "en-GB", branding: { displayName: "Studio One", primaryColor: null, logoUrl: null },
  };

  it("moves the booking to a new time with its version", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "confirmed", version: 2, start: slots[2].start, end: slots[2].end }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DesignSystemProvider locale="en-GB" timeZone="Europe/London"><ManageBooking data={view} workspace="studio-one" token={token} slots={slots} /></DesignSystemProvider>);
    await user.click(screen.getByRole("button", { name: "Reschedule" }));
    await user.click(screen.getByRole("button", { name: /Tuesday,? 4 March/ }));
    await user.click(screen.getByRole("button", { name: /^0?9:00/ }));
    await user.click(screen.getByRole("button", { name: "Move to this time" }));
    await waitFor(() => expect(screen.getByText("Your booking has a new time.")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/book/studio-one/manage/${token}/reschedule`);
    expect(JSON.parse(String(init.body))).toMatchObject({ version: 1, start: slots[2].start });
  });

  it("explains why a booking close to its start can't be changed online", () => {
    render(<DesignSystemProvider locale="en-GB" timeZone="Europe/London"><ManageBooking data={{ ...view, booking: { ...view.booking, canChange: false, reason: "It is too close to the start to change this booking. Please contact us" } }} workspace="studio-one" token={token} /></DesignSystemProvider>);
    expect(screen.getByText("This booking can't be changed online")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reschedule" })).toBeNull();
    expect(screen.getByRole("link", { name: "Add to calendar" })).toBeInTheDocument();
  });
});
