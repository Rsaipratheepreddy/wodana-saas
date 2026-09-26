import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { CrmScreenPage } from "./crm-screen-page";
import { crmRecordLink } from "./crm-product-shell";

vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));
afterEach(() => vi.unstubAllGlobals());
const response = (payload: unknown, status = 200) => ({ ok: status < 400, status, json: async () => payload });

describe("CRM product workflows", () => {
  it("filters the source chart by the selected month", async () => {
    const user = userEvent.setup();
    render(<CrmScreenPage initialData={structuredClone(crmScreenFixture("crm-overview"))} />);
    await user.click(screen.getByRole("button", { name: /Source chart period/ }));
    await user.click(screen.getByRole("option", { name: "Apr 2026" }));
    expect(screen.getByRole("img", { name: "5 enquiries: Website 3, Instagram 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Source chart period/ })).toHaveTextContent("Apr 2026");
  });

  it("opens actionable priority links and uses totals instead of capped list counts", () => {
    const fixture = structuredClone(crmScreenFixture("crm-overview"));
    fixture.supporting.summary = { pendingFollowUps: 1250, wonThisMonth: null };
    render(<CrmScreenPage initialData={fixture} />);
    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Won this month/ })).toHaveTextContent("—");
    expect(screen.getByRole("link", { name: /Pending follow-ups/ })).toHaveAttribute("href", "/workspace/crm/follow-ups");
    expect(crmRecordLink({ deepLink: "/crm/leads/78000000-0000-4000-8000-000000000001" })).toBe("/workspace/crm/leads?lead=78000000-0000-4000-8000-000000000001");
    expect(crmRecordLink({ deepLink: "javascript:alert(1)" })).toBe("/workspace/crm/follow-ups");
  });

});
