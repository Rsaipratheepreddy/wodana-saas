import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignSystemProvider } from "@/design-system";
import { ProjectShortcuts } from "./project-shortcuts";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/commercial/client", () => ({ jsonRequest: request }));
afterEach(() => { localStorage.clear(); request.mockReset(); });
function view() { return render(<DesignSystemProvider><ProjectShortcuts workspaceId="workspace" pathname="/workspace/projects" visible /></DesignSystemProvider>); }
function responses() {
  request.mockImplementation(async (url: string) => url.startsWith("/api/projects/")
    ? [{ id: "execution", caseId: "case", name: "Villa", customer: "Client" }]
    : { items: [{ id: "case", title: "Villa", customerName: "Client" }], total: 1 });
}
it("keeps existing sidebar shortcuts removable without showing Add project", async () => {
  localStorage.setItem("wodana:project-shortcuts:workspace", '["case"]');
  responses(); view(); const user = userEvent.setup();
  expect(await screen.findByRole("link", { name: "Villa" })).toHaveAttribute("href", "/workspace/projects/execution/overview");
  expect(screen.queryByRole("button", { name: "Add project" })).not.toBeInTheDocument();
  expect(localStorage.getItem("wodana:project-shortcuts:workspace")).toBe('["case"]');
  await user.click(screen.getByRole("button", { name: "Remove Villa from sidebar" }));
  await waitFor(() => expect(screen.queryByRole("link", { name: "Villa" })).not.toBeInTheDocument());
  expect(request.mock.calls.every(call => call.length === 1)).toBe(true);
});
it("does not render inaccessible saved project identifiers as links", async () => {
  localStorage.setItem("wodana:project-shortcuts:workspace", '["not-authorized"]');
  responses(); view();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
