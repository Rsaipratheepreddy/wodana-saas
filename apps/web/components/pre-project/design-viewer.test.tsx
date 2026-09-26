import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import * as content from "@/lib/pre-project/content";
import { DesignViewer } from "./design-viewer";

const version = { id: "v1", number: 1, status: "draft", reviewerId: "reviewer", asset: { id: "a", name: "plan.png", mimeType: "image/png", hasPreview: true } };
const thread = { id: "t1", versionId: "v1", title: "Move the island", blocking: true, status: "open", version: 1, anchor: { x: 0.2, y: 0.3 }, createdBy: "u", createdByName: "Designer", createdAt: "2026-09-20T10:00:00Z", resolvedAt: null, resolvedByName: null,
  messages: [{ id: "t1", body: "Move the island", createdBy: "u", createdByName: "Designer", createdAt: "2026-09-20T10:00:00Z" }] };
const design = { id: "d", title: "Kitchen concept", roomName: "Kitchen", archivedAt: null, activity: [], threads: [], versions: [version] } as unknown as content.CaseDesign;
const data = { workspaceId: "w", caseId: "c", canEdit: true } as content.CaseContent;
const options = { reviewers: [], members: [{ id: "u", name: "Designer" }], actorId: "u" } as unknown as content.DesignOptions;
const view = (record: content.CaseDesign, extra: Partial<Parameters<typeof DesignViewer>[0]> = {}) =>
  <DesignSystemProvider><DesignViewer data={data} design={record} options={options} onClose={vi.fn()} onUpdate={vi.fn()} {...extra} /></DesignSystemProvider>;

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => vi.restoreAllMocks());

it("titles the viewer with the design, not its room", () => {
  render(view(design));
  expect(screen.getByRole("heading", { name: "Kitchen concept" })).toBeVisible();
});

it("pins a new comment where the drawing was clicked, with mentions and must-fix", async () => {
  const request = vi.spyOn(content, "caseRequest").mockResolvedValue(design);
  const update = vi.fn();
  render(view(design, { onUpdate: update }));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Comment" }));
  fireEvent.click(screen.getByRole("button", { name: "Place a comment on the drawing" }), { detail: 0 });
  const box = screen.getByRole("textbox", { name: "Add a comment · @ to mention" });
  await user.type(box, "Adjust this cabinet. @Des");
  await user.click(screen.getByRole("option", { name: "Designer" }));
  await user.click(screen.getByRole("checkbox", { name: "Must fix before approval" }));
  await user.click(screen.getByRole("button", { name: "Post" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(design));
  expect(request).toHaveBeenCalledWith("w", "c", "designs/d/threads", "POST", expect.objectContaining({ versionId: "v1", anchor: { x: 0.5, y: 0.5 }, mentions: ["u"], blocking: true, body: "Adjust this cabinet. @Designer" }));
});

it("opens a thread at its pin to reply and resolve", async () => {
  const request = vi.spyOn(content, "caseRequest").mockResolvedValue(design);
  render(view({ ...design, threads: [thread] } as unknown as content.CaseDesign));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Comment by Designer" }));
  await user.type(screen.getByRole("textbox", { name: "Reply" }), "Done{Enter}");
  await waitFor(() => expect(request).toHaveBeenCalledWith("w", "c", "designs/d/threads/t1/replies", "POST", expect.objectContaining({ body: "Done" })));
  await user.click(screen.getByRole("button", { name: "Resolve" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("w", "c", "designs/d/threads/t1/status", "POST", { version: 1, status: "resolved" }));
});

it("lists comments in the panel and opens one from the list", async () => {
  render(view({ ...design, threads: [thread] } as unknown as content.CaseDesign));
  const panel = screen.getByRole("complementary", { name: "Review" });
  await userEvent.click(within(panel).getByRole("button", { name: /Move the island/ }));
  expect(screen.getByRole("button", { name: "Comment by Designer" })).toHaveAttribute("aria-expanded", "true");
});

it("keeps locked records view-only", () => {
  render(view(design, { data: { ...data, canEdit: false } }));
  expect(screen.queryByRole("button", { name: "Comment" })).not.toBeInTheDocument();
  expect(screen.getByText("No comments yet.")).toBeVisible();
});

it("shows earlier revisions read-only with their own file", async () => {
  const older = { ...version, id: "old", number: 1, asset: { ...version.asset, id: "old-asset", name: "old.png" } };
  render(view({ ...design, versions: [{ ...version, number: 2 }, older] } as unknown as content.CaseDesign));
  await userEvent.click(screen.getByRole("tab", { name: "R1" }));
  expect(screen.getByRole("img", { name: "old.png" })).toHaveAttribute("src", expect.stringContaining("old-asset"));
  expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", expect.stringContaining("old-asset"));
  expect(screen.queryByRole("button", { name: "Comment" })).not.toBeInTheDocument();
  expect(screen.getByText("Earlier revision · read-only")).toBeVisible();
});

it("asks before closing with an unsent comment", async () => {
  const close = vi.fn();
  render(view(design, { onClose: close }));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Comment" }));
  fireEvent.click(screen.getByRole("button", { name: "Place a comment on the drawing" }), { detail: 0 });
  await user.type(screen.getByRole("textbox", { name: "Add a comment · @ to mention" }), "Half a thought");
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText("Discard your comment?")).toBeVisible();
});
