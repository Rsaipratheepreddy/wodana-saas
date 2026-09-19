import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobDetailProjection, JobIdentityProjection } from "@/lib/jobs/jobs";
import { JobProfile } from "./job-profile";
import { JobsPage, TodayJobsPage } from "./job-tables";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const job: JobIdentityProjection = {
  jobId: "91000000-0000-4000-8000-000000000001",
  reference: "JOB-2026-001",
  createdAt: "2026-09-10T06:30:00.000Z",
  title: "Jumeirah villa interiors",
  customer: { id: "93000000-0000-4000-8000-000000000001", name: "Amira Hassan" },
  links: [
    { type: "opportunity", id: "92000000-0000-4000-8000-000000000003", caseId: null, status: "active", version: 3, sourceState: "available" },
    { type: "project", id: "92000000-0000-4000-8000-000000000006", caseId: "92000000-0000-4000-8000-000000000004", status: "active", version: 6, sourceState: "available" },
  ],
  missingSourceCount: 0,
  repairableLinkCount: 0,
  phase: "deliver",
  phaseSource: { type: "project", id: "92000000-0000-4000-8000-000000000006", version: 6 },
  accessLimited: false,
  stage: { label: "Site preparation", manual: true, version: 1, reason: "Site mobilization is confirmed.", setBy: "94000000-0000-4000-8000-000000000001", setByName: "Administrator", setAt: "2026-09-17T08:00:00.000Z" },
  owner: { membershipId: "94000000-0000-4000-8000-000000000001", name: "Omar Rahman" },
  targetDate: "2026-10-02T00:00:00.000Z",
  flags: {
    blocked: { active: false, reason: null, source: null },
    awaiting_client: { active: false, reason: null, source: null },
    at_risk: { active: true, reason: "Delivery dependency needs review.", source: { type: "project", id: "92000000-0000-4000-8000-000000000006", version: 6 } },
  },
  nextAction: { title: "Confirm joinery production slot", owner: { membershipId: "94000000-0000-4000-8000-000000000001", name: "Omar Rahman" }, dueAt: "2026-09-20T08:00:00.000Z", reason: "Project control next action", route: "/workspace/projects/92000000-0000-4000-8000-000000000006", source: { type: "project", id: "92000000-0000-4000-8000-000000000006", version: 6 } },
};

describe("Job web shell", () => {
  beforeEach(() => push.mockReset());

  it("renders Today as an actionable dashboard and opens the source action", async () => {
    const user = userEvent.setup();
    render(<TodayJobsPage items={[job]} />);
    expect(screen.getByRole("region", { name: "Today's work summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What needs your attention" })).toBeInTheDocument();
    expect(screen.getByText("Confirm joinery production slot")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Confirm joinery production slot/ }));
    expect(push).toHaveBeenCalledWith(job.nextAction?.route);
  });

  it("keeps Today useful when there is no actionable work", () => {
    render(<TodayJobsPage items={[]} />);
    expect(screen.getByRole("heading", { name: "You’re clear for now" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job health" })).toBeInTheDocument();
    expect(screen.getByText("No promises scheduled")).toBeInTheDocument();
  });

  it("renders the Jobs record spine with bordered shared table semantics", () => {
    render(<JobsPage items={[job]} total={1} />);
    expect(screen.getByRole("table", { name: "Jobs" })).toBeInTheDocument();
    expect(screen.getByText("JOB-2026-001")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Jobs" })).toHaveTextContent("Deliver");
  });

  it("renders contextual source links, phase and permission-filtered history", async () => {
    const user = userEvent.setup();
    const detail: JobDetailProjection = {
      ...job,
      clientTimelineAccess: { communications: true, activities: true },
      clientTimeline: [{ id: "message-1", kind: "message", channel: "email", direction: "outbound", status: "queued", providerStatus: "queued", title: "Quotation sent", detail: "Please review the attached quotation.", occurredAt: "2026-09-17T08:10:00.000Z", actor: { id: "user-1", name: "Administrator" }, failureCode: null, source: { type: "conversation", id: "conversation-1" } }],
      timeline: [{ id: "event-1", kind: "stage", title: "Stage set to Site preparation", detail: "Site mobilization is confirmed.", occurredAt: "2026-09-17T08:00:00.000Z", recordedAt: "2026-09-17T08:00:00.000Z", actor: { id: "user-1", name: "Administrator" }, source: null }],
    };
    render(<JobProfile job={detail} />);
    expect(screen.getByRole("list", { name: "Job phases" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Linked Job records" })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("stage set to site preparation") === true)).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Please review the attached quotation.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Project" }));
    expect(push).toHaveBeenCalledWith("/workspace/projects/92000000-0000-4000-8000-000000000006/overview");
  });
});
