import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectMaterials } from "./project-materials";

afterEach(() => vi.unstubAllGlobals());

const material = { id: "m1", name: "Oak veneer", code: "", supplier: "", specification: "", usedIn: [], clientChoice: false, decision: null };

it("says what Suggest from the scope did, including when there was nothing to add", async () => {
  let items: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ state: "draft", items, revisions: [], version: 1, canEdit: true }) })));
  // The first suggestion finds nothing; the second adds one material.
  const run = vi.fn().mockResolvedValueOnce(true).mockImplementationOnce(async () => { items = [material]; return true; });
  render(<ProjectMaterials workspaceId="w" projectId="p" version={1} run={run} lines={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: /Suggest from the scope/ }));
  expect(await screen.findByRole("status")).toHaveTextContent("Nothing new to suggest from the scope.");
  fireEvent.click(screen.getByRole("button", { name: /Suggest from the scope/ }));
  expect(await screen.findByText("1 material added from the scope.")).toBeInTheDocument();
  expect(run).toHaveBeenCalledWith("suggest_materials");
});
