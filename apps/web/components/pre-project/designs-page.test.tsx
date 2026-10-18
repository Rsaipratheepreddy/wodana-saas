import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { DesignSystemProvider } from "@/design-system";
import type {
  CaseContent,
  CaseDesign,
  DesignOptions,
} from "@/lib/pre-project/content";
import { DesignsPage } from "./designs-page";
import { DesignFileDetails } from "./design-file-details";
import { mergeDesigns } from "@/lib/pre-project/design-workflow";
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    usePathname: () => "/designs",
    useSearchParams: () =>
      new URLSearchParams(
        React.useSyncExternalStore(
          (callback) => {
            window.addEventListener("popstate", callback);
            return () => window.removeEventListener("popstate", callback);
          },
          () => window.location.search,
        ),
      ),
  };
});
beforeEach(() => {
  window.history.replaceState(null, "", "/designs");
  const push = window.history.pushState.bind(window.history);
  vi.spyOn(window.history, "pushState").mockImplementation((...args) => {
    push(...args);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
vi.mock("./case-controls", () => ({
  CaseModal: ({
    title,
    children,
    footer,
  }: {
    title: string;
    children: ReactNode;
    footer: ReactNode;
  }) => (
    <section aria-label={title}>
      {children}
      {footer}
    </section>
  ),
  AssetFiles: () => null,
  AssetUpload: () => null,
}));
const data = {
  workspaceId: "w",
  caseId: "c",
  canEdit: true,
  rooms: [],
  entries: [],
} as unknown as CaseContent;
const options: DesignOptions = {
  folders: [
    {
      id: "folder",
      name: "Reception",
      description: "",
      roomId: null,
      scopeEntryId: null,
      version: 1,
    },
  ],
  reviewers: [{ id: "reviewer", name: "Reviewer" }],
  actorId: "reviewer",
  canReview: true,
  canRecordClient: true,
};
const design: CaseDesign = {
  id: "design",
  folderId: "folder",
  title: "Layout",
  description: "",
  documentType: "2D layout / space plan",
  roomId: null,
  scopeEntryId: null,
  version: 1,
  archivedAt: null,
  updatedAt: "2026-09-07T00:00:00Z",
  activity: [],
  versions: [
    {
      id: "v1",
      number: 1,
      status: "draft",
      note: "",
      asset: {
        id: "a1",
        name: "layout.pdf",
        mimeType: "application/pdf",
        byteSize: 100,
        hasPreview: false,
      },
      createdAt: "2026-09-07T00:00:00Z",
      createdByName: "Designer",
    },
  ],
};
function setupReview(d: CaseDesign) {
  render(
    <DesignSystemProvider>
      <DesignFileDetails
        data={data}
        design={d}
        folderName="Reception"
        options={options}
        onClose={() => {}}
        onUpdate={() => {}}
        onReviewed={() => {}}
      />
    </DesignSystemProvider>,
  );
  return userEvent.setup();
}
describe("design review details", () => {
  it("shows comments without legacy thread blockers", async () => {
    setupReview({
      ...design,
      threads: [
        {
          id: "thread",
          versionId: "v1",
          title: "Clearance issue",
          blocking: true,
          status: "open",
          version: 1,
          createdBy: "reviewer",
          createdByName: "Reviewer",
          createdAt: "2026-09-07T00:00:00Z",
          resolvedAt: null,
          resolvedByName: null,
          messages: [],
        },
      ],
      versions: [
        {
          ...design.versions[0],
          status: "internal_review",
          reviewerId: "reviewer",
        },
      ],
    });
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.queryByText(/blocking discussion/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Comments" }),
    ).toBeInTheDocument();
  });
  it("shows the revision author, source context and included client-review usage", () => {
    setupReview({
      ...design,
      roomName: "Reception",
      scopeTitle: "Custom counter",
      clientRoundsUsed: 3,
      versions: [
        { ...design.versions[0], includedClientRounds: 2 },
      ],
    });
    expect(screen.getByText("R1 · Designer")).toBeInTheDocument();
    expect(
      screen.getByText("Room: Reception · Item: Custom counter"),
    ).toBeInTheDocument();
    expect(screen.getByText("3 of 2 used · over allowance")).toBeInTheDocument();
  });
  it("compares two exact revisions side by side and labels feedback with its revision", async () => {
    const user = setupReview({
      ...design,
      activity: [
        {
          id: "comment",
          versionId: "v2",
          action: "comment",
          note: "Keep the earlier ceiling line.",
          decisionBy: "",
          createdAt: "2026-09-08T00:00:00Z",
          createdByName: "Reviewer",
        },
      ],
      versions: [
        {
          ...design.versions[0],
          id: "v2",
          number: 2,
          note: "Raised ceiling",
          asset: { ...design.versions[0].asset, id: "a2", name: "layout-r2.pdf" },
        },
        {
          ...design.versions[0],
          id: "v1",
          number: 1,
          note: "Original ceiling",
        },
      ],
    });
    expect(screen.getByText("Pinned to R2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Compare revisions" }));
    expect(
      screen.getByRole("region", { name: "Revision 2 comparison" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Revision 1 comparison" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Raised ceiling")).toBeInTheDocument();
    expect(screen.getByText("Original ceiling")).toBeInTheDocument();
  });
  it("ignores a stale background listing after a local save", () => {
    const saved = { ...design, version: 4, description: "Newest note" };
    expect(mergeDesigns([saved], [design])[0]).toEqual(saved);
  });
});

const scopedData = {
  ...data,
  rooms: [{ id: "room-1", name: "Master bedroom", version: 1 }, { id: "room-2", name: "Kitchen", version: 1 }],
  entries: [
    { id: "scope-1", version: 1, kind: "requirement", title: "Built-in wardrobe", roomId: "room-1", scopeStatus: "included", archivedAt: null, updatedAt: "2026-09-08T00:00:00Z" },
    { id: "scope-2", version: 1, kind: "requirement", title: "Kitchen cabinets", roomId: "room-2", scopeStatus: "included", archivedAt: null, updatedAt: "2026-09-08T00:00:00Z" },
    { id: "scope-3", version: 1, kind: "requirement", title: "Excluded item", roomId: "room-2", scopeStatus: "excluded", archivedAt: null, updatedAt: "2026-09-08T00:00:00Z" },
  ],
} as unknown as CaseContent;
const wardrobeDesign: CaseDesign = { ...design, id: "design-wardrobe", title: "Wardrobe elevation", roomId: "room-1", scopeEntryId: "scope-1", versions: [{ ...design.versions[0], status: "internal_review", reviewerId: "reviewer" }] };

describe("design board", () => {
  it("lists every included scope item with its design stage and next step", () => {
    render(<DesignSystemProvider><DesignsPage initialData={scopedData} initialDesigns={[wardrobeDesign]} options={options} /></DesignSystemProvider>);
    const table = screen.getByRole("table", { name: "Design board" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Room", "Scope item", "Design", "Stage", "With", "Folder", "Updated", "Next step"]);
    expect(within(table).getByText("Built-in wardrobe")).toBeInTheDocument();
    expect(within(table).getByText("Needs internal review")).toBeInTheDocument();
    expect(within(table).getByText("Reviewer")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Review now: Built-in wardrobe" })).toBeInTheDocument();
    expect(within(table).getByText("Needs design")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Upload design: Kitchen cabinets" })).toBeInTheDocument();
    expect(within(table).queryByText("Excluded item")).not.toBeInTheDocument();
    expect(screen.getByText("0 of 2 designs approved")).toBeVisible();
  });
  it("uploads a design for a scope item without one, linked to its room and item", async () => {
    render(<DesignSystemProvider><DesignsPage initialData={scopedData} initialDesigns={[wardrobeDesign]} options={options} /></DesignSystemProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Upload design: Kitchen cabinets" }));
    expect(await screen.findByRole("region", { name: "Add design files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
  });
  it("opens the design details from a row and returns to the board", async () => {
    render(<DesignSystemProvider><DesignsPage initialData={scopedData} initialDesigns={[wardrobeDesign]} options={options} /></DesignSystemProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Review now: Built-in wardrobe" }));
    expect(window.location.search).toContain("file=design-wardrobe");
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to files" }));
    await waitFor(() => expect(screen.getByRole("table", { name: "Design board" })).toBeInTheDocument());
  });
  it("keeps viewers read-only", () => {
    render(<DesignSystemProvider><DesignsPage initialData={{ ...scopedData, canEdit: false } as CaseContent} initialDesigns={[]} options={options} /></DesignSystemProvider>);
    expect(screen.queryByRole("button", { name: "Upload design" })).not.toBeInTheDocument();
    expect(screen.getAllByText("No design yet")).toHaveLength(2);
  });
  it("ignores a stale background listing after a local save", () => {
    const saved = { ...design, version: 2 };
    expect(mergeDesigns([saved], [design])[0]).toEqual(saved);
  });
});
