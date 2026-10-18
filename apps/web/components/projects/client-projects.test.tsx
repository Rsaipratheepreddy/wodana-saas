import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { translatorFor } from "@/lib/i18n/keys";
import type { ProjectRow } from "@/lib/project-core/types";
import { ClientProjects, clientStatus, projectName } from "./client-projects";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const workspaceId = "00000000-0000-4000-8000-000000000001";
const row = (overrides: Partial<ProjectRow>): ProjectRow => ({
  id: "p1", reference: "PRJ-0003", name: "Arabian Ranches Townhouse 7", clientName: "Omar and Layla Haddad", status: "active", priority: "normal", health: "on_track",
  promiseDate: null, currency: "AED", total: "0", startedAt: "2026-09-01", stage: { name: "Delivery and installation", position: 6, count: 7 }, lead: "Khalid", next: null, ...overrides,
});
const serve = (projects: ProjectRow[]) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ projects, canStart: false }) })));
afterEach(() => { vi.unstubAllGlobals(); });

describe("client projects", () => {
  it("shows where each client's project really is, the project once, and the way to its client updates", async () => {
    serve([row({}), row({ id: "p2", reference: "PRJ-0005", name: "Mariam Al Suwaidi · Villa 27 furniture", clientName: "Mariam Al Suwaidi", status: "completed", stage: null })]);
    render(<DesignSystemProvider><ClientProjects workspaceId={workspaceId} /></DesignSystemProvider>);
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Clients"]);
    const grid = await screen.findByRole("table", { name: "Client projects" });
    const running = (await within(grid).findByText("Omar and Layla Haddad")).closest("tr")!;
    expect(running).toHaveTextContent("Delivery and installation");
    expect(running).not.toHaveTextContent("Planning");
    const done = within(grid).getByText("Mariam Al Suwaidi").closest("tr")!;
    expect(done).toHaveTextContent("Handed over");
    expect(within(done).getByText("Villa 27 furniture · PRJ-0005")).toBeInTheDocument();
    expect(within(running).getByRole("link", { name: "Client updates" })).toHaveAttribute("href", "/workspace/projects/p1/updates");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search clients and projects" }), "nobody");
    expect(await screen.findByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("says where clients come from when there are none yet", async () => {
    serve([]);
    render(<DesignSystemProvider><ClientProjects workspaceId={workspaceId} /></DesignSystemProvider>);
    expect(await screen.findByText("No client projects yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open pipeline" })).toHaveAttribute("href", "/workspace/crm/opportunities");
  });

  it("names the status from the project's state and stage", () => {
    const t = translatorFor({});
    expect(clientStatus(t, { status: "on_hold", stage: { name: "Production", position: 4, count: 7 } }).label).toBe("On hold");
    expect(clientStatus(t, { status: "active", stage: null }).label).toBe("In project");
    expect(projectName({ name: "Villa 12", clientName: "Amira" })).toBe("Villa 12");
  });
});
