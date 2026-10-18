import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { SiteAttention } from "@/lib/site/types";
import { SiteProgressAttention } from "./site-progress-attention";

const WS = "00000000-0000-4000-8000-000000000001";
const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const attention = (patch: Partial<SiteAttention> = {}): SiteAttention => ({
  today: "2026-09-29", dueTime: "18:00", pastDue: true,
  toReview: [{ reportId: "r1", projectId: PID, reference: "PRJ-7", name: "Villa 12", reportDate: "2026-09-28", authorName: "Dana Karim", summary: "The kitchen carcasses are in.",
    submittedAt: "2026-09-28T15:00:00.000Z", photos: 1, photoId: "ph1" }],
  missing: [{ projectId: PID, reference: "PRJ-7", name: "Villa 12", supervisor: "Dana Karim" }], ...patch,
});
const show = (value: SiteAttention) => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => value })));
  return render(<DesignSystemProvider><SiteProgressAttention workspaceId={WS} /></DesignSystemProvider>);
};

describe("Home: daily progress", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("lists the days to review with their words and photo, and the sites without today's report after the end of the day", async () => {
    show(attention());
    const review = await screen.findByRole("region", { name: "Reports to review" });
    expect(within(review).getByText("The kitchen carcasses are in.")).toBeInTheDocument();
    expect(within(review).getByText("Dana Karim · 1 photo")).toBeInTheDocument();
    expect(within(review).getByRole("link", { name: "Review" })).toHaveAttribute("href", `/workspace/projects/${PID}/site?report=r1`);
    const missing = screen.getByRole("region", { name: "Sites without today's report" });
    expect(within(missing).getByText("PRJ-7 · Villa 12")).toBeInTheDocument();
    expect(within(missing).getByText("Dana Karim · Due by 18:00")).toBeInTheDocument();
  });

  it("shows nothing before the end of the day when nothing waits", async () => {
    const { container } = show(attention({ pastDue: false, toReview: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.querySelector("section")).toBeNull();
  });
});
