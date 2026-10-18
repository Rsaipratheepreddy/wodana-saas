import { render, screen, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { PreProjectProvider, usePreProject } from "@/components/pre-project/pre-project-context";
import type { CasePlan, PreProjectCase } from "@/lib/pre-project/types";
import { WorkspaceFlowNavigation } from "./workspace-flow-navigation";
import { workspaceModules } from "./workspace-navigation";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
const id = "38b5a26d-0c2f-4608-8d4d-efe6024e7c3e";
const root = `/workspace/pre-projects/cases/${id}`;

function Selected({ plan, children }: { plan?: CasePlan; children: ReactNode }) {
  const { setSelected } = usePreProject();
  useEffect(() => { setSelected({ record: { id, title: "Sofa", customerName: "Dana", plan } as PreProjectCase, search: "" }); }, [plan, setSelected]);
  return <>{children}</>;
}
const nav = (section: string, plan?: CasePlan) => render(<PreProjectProvider><Selected plan={plan}><WorkspaceFlowNavigation module={workspaceModules[2]} pathname={`${root}/${section}`} /></Selected></PreProjectProvider>);
const stock: CasePlan = { source: "path", phases: ["price", "agree", "release"], siteVisit: false, design: false, release: "fulfilment" };

it("keeps one tab row: the open area's views sit at the end of the same row (L16)", () => {
  const view = nav("contracts");
  const areas = screen.getByRole("navigation", { name: "Planning sections" });
  const views = screen.getByRole("navigation", { name: "Deal views" });
  expect(views.parentElement).toBe(areas.parentElement);
  expect(view.container.querySelectorAll("nav")).toHaveLength(2);
  expect(within(views).getAllByRole("link").map((link) => link.textContent)).toEqual(["Agreement", "Payments", "Deal File", "Release", "Changes", "Approvals"]);
});

it("shows no Site, Moodboard or Design tab for an order whose path has none (L12)", async () => {
  nav("quotations", stock);
  const areas = screen.getByRole("navigation", { name: "Planning sections" });
  expect(await within(areas).findAllByRole("link")).toHaveLength(4);
  expect(within(areas).getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "Requirements", "Quotes", "Deal"]);
});

it("keeps a site visit the path asks for, and always the open area", async () => {
  nav("designs", { ...stock, siteVisit: true, phases: ["design", "price", "agree", "release"] });
  const areas = screen.getByRole("navigation", { name: "Planning sections" });
  expect(await within(areas).findByRole("link", { name: "Site" })).toBeInTheDocument();
  expect(within(areas).queryByRole("link", { name: "Moodboard" })).not.toBeInTheDocument();
  expect(within(areas).getByRole("link", { name: "Design" })).toHaveAttribute("aria-current", "page");
});

it("shows every area when the case has no path plan", () => {
  nav("overview");
  expect(within(screen.getByRole("navigation", { name: "Planning sections" })).getAllByRole("link")).toHaveLength(7);
});
