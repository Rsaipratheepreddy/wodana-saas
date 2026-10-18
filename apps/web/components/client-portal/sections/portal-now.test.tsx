import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PortalJourney, PortalProject } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import { PortalNow } from "./portal-now";

const format = { date: (value: string) => `on ${value}` } as unknown as PortalFormat;
const project = { team: [{ roles: ["designer"], name: "Dana Designer", email: null, avatar: null }] } as unknown as PortalProject;
const step = (key: string, chapter: PortalJourney["steps"][number]["chapter"], label: string, state: PortalJourney["steps"][number]["state"], yours = false, dueAt: string | null = null) =>
  ({ key, chapter, label, state, yours, at: null, dueAt });

describe("the portal's Now (§0.3 P5)", () => {
  it("says what is the client's to do, by when, who looks after them and what comes next", () => {
    const journey: PortalJourney = {
      chapter: "design", now: { label: "You approve the design", yours: true, dueAt: "2026-10-20" },
      next: [step("quotation_sent", "price", "Your quotation", "upcoming"), step("quotation_accepted", "price", "You sign the quotation", "upcoming", true)],
      steps: [step("design_fee", "win", "Design fee paid", "done", true), step("design:approval", "design", "You approve the design", "now", true),
        step("quotation_sent", "price", "Your quotation", "upcoming")],
      progress: { done: 1, total: 3 },
    };
    render(<PortalNow journey={journey} project={project} format={format} />);
    const now = screen.getByRole("region", { name: "You approve the design" });
    expect(within(now).getByText("Waiting for you")).toBeInTheDocument();
    expect(within(now).getByText("Please by on 2026-10-20")).toBeInTheDocument();
    expect(within(now).getByText("Dana Designer")).toBeInTheDocument();
    const chapters = within(now).getByRole("list", { name: "Your journey" });
    expect(within(chapters).getAllByRole("listitem").map((item) => item.dataset.state)).toEqual(["done", "now", "upcoming"]);
    const next = within(now).getByText("What happens next").parentElement!;
    expect(within(next).getAllByRole("listitem")).toHaveLength(2);
    expect(within(next).getByText("You")).toBeInTheDocument();
  });

  it("names what the team is on when nothing waits for the client", () => {
    const journey: PortalJourney = { chapter: "make", now: { label: "Made for you", yours: false, dueAt: null }, next: [], steps: [step("factory", "make", "Made for you", "now")],
      progress: { done: 0, total: 1 } };
    render(<PortalNow journey={journey} project={project} format={format} />);
    expect(screen.getByRole("heading", { name: "Next: Made for you" })).toBeInTheDocument();
    expect(screen.getByText("Your team is working on it")).toBeInTheDocument();
    expect(screen.queryByText("What happens next")).not.toBeInTheDocument();
  });
});
