import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PortalProject } from "@/lib/client-portal/types";
import { HomeSection } from "./home-section";
import type { SectionProps } from "./section-types";

const stages = [
  { name: "Design", state: "done", startedOn: "2026-08-01", finishedOn: "2026-08-20" },
  { name: "Delivery and installation", state: "current", startedOn: "2026-09-20", finishedOn: null },
  { name: "Handover", state: "upcoming", startedOn: null, finishedOn: null },
];
const project = (handoverDate: string | null) => ({
  id: "c", title: "Villa 12", reference: "PRJ-4", role: "approver", status: "active", paused: false, handoverDate, handedOverOn: null,
  sections: { progress: true }, next: [], latestUpdate: null, documents: [], messages: null,
  progress: { stages, updates: [], photoDays: [], percent: 60, cards: [], weeks: [] },
}) as unknown as PortalProject;
const props = (handoverDate: string | null): SectionProps => ({
  project: project(handoverDate), site: {} as SectionProps["site"], api: { file: vi.fn() } as unknown as SectionProps["api"],
  format: { date: (value: string) => `on ${value}` } as unknown as SectionProps["format"], today: "2026-09-29", open: vi.fn(), go: vi.fn(), reload: vi.fn(async () => undefined), wide: true,
});

describe("the portal's Coming up (m19)", () => {
  it("shows the handover once: its date on the handover stage", () => {
    render(<HomeSection {...props("2026-10-30")} />);
    const coming = screen.getByRole("region", { name: "Coming up" });
    expect(within(coming).getAllByText("Handover")).toHaveLength(1);
    expect(within(coming).getAllByRole("listitem")).toHaveLength(2);
    expect(within(coming).getByText("on 2026-10-30")).toBeInTheDocument();
  });

  it("shows no date when the project has no handover date yet", () => {
    render(<HomeSection {...props(null)} />);
    expect(within(screen.getByRole("region", { name: "Coming up" })).queryByText(/^on /)).not.toBeInTheDocument();
  });
});
