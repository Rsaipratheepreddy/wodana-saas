import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { NoticeGroups, type WorkspaceNotice } from "./notification-list";

const notice = (patch: Partial<WorkspaceNotice>): WorkspaceNotice => ({ id: "n", eventType: "invoice.overdue", subject: "Update", body: "", deepLink: null, readAt: null,
  createdAt: new Date().toISOString(), ...patch });

describe("alerts in the notification list (§0.3)", () => {
  it("puts unhandled alerts under Needs action first, tagged, and never shows them twice", () => {
    render(<DesignSystemProvider><NoticeGroups onOpen={vi.fn()} items={[
      notice({ id: "a", subject: "Invoice overdue", critical: true }),
      notice({ id: "b", subject: "Design approved" }),
      notice({ id: "c", subject: "Old alert", critical: true, readAt: new Date().toISOString() }),
    ]} /></DesignSystemProvider>);
    const sections = screen.getAllByRole("region");
    expect(sections[0]).toHaveAccessibleName("Needs action");
    expect(within(sections[0]).getByText("Invoice overdue")).toBeInTheDocument();
    expect(within(sections[0]).getByText("Alert")).toBeInTheDocument();
    expect(within(sections[0]).queryByText("Design approved")).not.toBeInTheDocument();
    expect(screen.getAllByText("Invoice overdue")).toHaveLength(1);
    // A handled alert goes back to its day, still marked as an alert.
    expect(within(sections[1]).getByText("Old alert")).toBeInTheDocument();
  });
});
