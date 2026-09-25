import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import { ProjectPlanningPanel } from "./project-planning-panel";
import { loadProjectPlanning } from "@/lib/projects/planning";

vi.mock("@/lib/projects/planning", () => ({ loadProjectPlanning: vi.fn() }));
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return { default: (load: () => Promise<ComponentType<Record<string, unknown>>>) => {
    const Component = React.lazy(async () => ({ default: await load() }));
    return function Dynamic(props: Record<string, unknown>) { return <React.Suspense fallback={<p>Loading component</p>}><Component {...props}/></React.Suspense>; };
  } };
});
vi.mock("@/components/pre-project/brief-scope-page", () => ({ BriefScopePage: ({ initialData }: { initialData: { canEdit: boolean } }) => <div>Requirement cards · {initialData.canEdit ? "editable" : "read only"}</div> }));
vi.mock("@/components/pre-project/designs-page", () => ({ DesignsPage: ({ preserveNavigation }: { preserveNavigation: boolean }) => <div>Design cards · {preserveNavigation ? "project route" : "legacy route"}</div> }));
vi.mock("@/components/commercial/commercial-page", () => ({ CommercialPage: ({ section }: { section: string }) => <div>Commercial · {section}</div> }));

const context = { workspaceId: "workspace", caseId: "case" };
const content = { canEdit: false, brief: { currencyCode: "AED" } };
beforeEach(() => vi.mocked(loadProjectPlanning).mockReset());
afterEach(() => vi.restoreAllMocks());

it("loads real requirements and retains read-only permission", async () => {
  vi.mocked(loadProjectPlanning).mockResolvedValue({ section: "requirements", content } as never);
  render(<ProjectPlanningPanel context={context} section="requirements"/>);
  expect(await screen.findByText("Requirement cards · read only")).toBeVisible();
  expect(loadProjectPlanning).toHaveBeenCalledWith(context, "requirements", expect.any(AbortSignal));
});

it("offers retry for a failed read instead of showing empty cards", async () => {
  vi.mocked(loadProjectPlanning).mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({ section: "requirements", content } as never);
  render(<ProjectPlanningPanel context={context} section="requirements"/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Requirement cards · read only")).toBeVisible();
  expect(loadProjectPlanning).toHaveBeenCalledTimes(2);
});

it("cancels an obsolete load and does not display the previous project", async () => {
  vi.mocked(loadProjectPlanning).mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce({ section: "design", content, designs: [], options: {} } as never);
  const { rerender } = render(<ProjectPlanningPanel context={context} section="requirements"/>);
  const oldSignal = vi.mocked(loadProjectPlanning).mock.calls[0][2];
  rerender(<ProjectPlanningPanel context={context} section="design"/>);
  await waitFor(() => expect(oldSignal.aborted).toBe(true));
  expect(await screen.findByText("Design cards · project route")).toBeVisible();
  expect(screen.queryByText(/Requirement cards/)).not.toBeInTheDocument();
});

it("connects Change Requests to the existing variations workflow", async () => {
  vi.mocked(loadProjectPlanning).mockResolvedValue({ section: "change-requests", commercial: { currency: "AED" }, record: {} } as never);
  render(<ProjectPlanningPanel context={context} section="change-requests"/>);
  expect(await screen.findByText("Commercial · variations")).toBeVisible();
});
