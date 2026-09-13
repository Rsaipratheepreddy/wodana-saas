import { render, screen, waitFor, within, act } from "@testing-library/react";
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
import { inDesignTab, mergeDesigns } from "@/lib/pre-project/design-workflow";
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
function setup(d = design, o = options) {
  render(
    <DesignSystemProvider>
      <DesignsPage initialData={data} initialDesigns={[d]} options={o} />
    </DesignSystemProvider>,
  );
  return userEvent.setup();
}
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
describe("design folder workflow", () => {
  it("reloads rooms and items before creating, then stays on the folder list", async () => {
    const fresh = {
      ...data,
      rooms: [{ id: "room", name: "Meeting room", version: 1 }],
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => fresh })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...options, items: [design] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "new-folder",
          name: "Meeting room",
          roomId: "room",
          scopeEntryId: null,
          description: "",
          version: 1,
        }),
      });
    vi.stubGlobal("fetch", fetcher);
    const user = setup();
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.click(
      await screen.findByRole("button", { name: "Choose a room Room" }),
    );
    await user.click(screen.getByRole("option", { name: "Meeting room" }));
    expect(
      screen.queryByRole("textbox", { name: "Folder name" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create folder" }));
    await screen.findByRole("button", { name: "Open folder Meeting room" });
    expect(window.location.search).not.toContain("folder=");
    expect(
      screen.queryByRole("button", { name: "Add files" }),
    ).not.toBeInTheDocument();
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({
      name: "Meeting room",
      roomId: "room",
      scopeEntryId: null,
    });
  });
  it("shows a load failure with a working retry instead of an empty folder form", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Connection lost"));
    vi.stubGlobal("fetch", fetcher);
    const user = setup();
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("region", { name: "New design folder" }),
    ).not.toBeInTheDocument();
    fetcher.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("/brief") ? data : { ...options, items: [design] },
    }));
    await user.click(screen.getByRole("button", { name: "Reload designs" }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Open folder Reception" }),
    ).toBeInTheDocument();
  });
  it("shows only the folder name and file count without duplicate context labels", () => {
    setup(design, {
      ...options,
      folders: [
        {
          id: "folder",
          name: "Reception + Custom reception desk",
          description: "",
          roomId: "room",
          roomName: "Reception",
          scopeEntryId: "item",
          scopeTitle: "Custom reception desk",
          version: 1,
        },
      ],
    });
    expect(
      screen.getByRole("button", {
        name: "Open folder Reception + Custom reception desk",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Item · Custom reception desk"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add files" }),
    ).not.toBeInTheDocument();
  });
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
  it("opens folders first, then a simple file, design type and note screen", async () => {
    const user = setup();
    expect(
      screen.queryByRole("button", { name: "Open Layout" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Open folder Reception" }),
    );
    expect(
      screen.getByRole("button", { name: "Add files" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New folder" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Layout" }));
    expect(
      screen.getByRole("region", { name: "Design file" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByRole("textbox", { name: "Note" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /2D layout \/ space plan Design type/,
      }),
    ).toBeInTheDocument();
    expect(window.location.search).toContain("file=design");
    expect(
      screen.queryByRole("list", { name: "Review progress" }),
    ).not.toBeInTheDocument();
  });
  it("keeps existing unfiled documents discoverable", async () => {
    const user = setup({ ...design, folderId: null });
    await user.click(
      screen.getByRole("button", { name: "Open folder Unfiled" }),
    );
    expect(
      screen.getByRole("button", { name: "Open Layout" }),
    ).toBeInTheDocument();
  });
  it("hides internal approval from a member who is not assigned", async () => {
    setupReview({
      ...design,
      versions: [
        {
          ...design.versions[0],
          status: "internal_review",
          reviewerId: "someone-else",
        },
      ],
    });
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Thread" }),
    ).not.toBeInTheDocument();
  });
});
describe("stable design library and review queues", () => {
  it.each([
    "draft",
    "internal_review",
    "internal_approved",
    "client_review",
    "approved",
    "changes_requested",
  ])("keeps %s files in their folder", async (status) => {
    const user = setup({
      ...design,
      versions: [{ ...design.versions[0], status }],
    });
    expect(screen.getByRole("tab", { name: /^Designs/ })).toHaveTextContent(
      "1",
    );
    expect(
      screen.getByRole("button", { name: "Open folder Reception" }),
    ).toHaveTextContent("1 file");
    await user.click(
      screen.getByRole("button", { name: "Open folder Reception" }),
    );
    expect(
      screen.getByRole("button", { name: "Open Layout" }),
    ).toBeInTheDocument();
  });
  it("ignores a stale background listing after a local save", () => {
    const saved = { ...design, version: 4, description: "Newest note" };
    expect(mergeDesigns([saved], [design])[0]).toEqual(saved);
    expect(inDesignTab(saved, "designs")).toBe(true);
  });
  it("finds an empty folder and files across folders from library search", async () => {
    const user = setup(design, {
      ...options,
      folders: [
        ...options.folders,
        {
          id: "empty",
          name: "Kitchen",
          description: "",
          roomId: null,
          scopeEntryId: null,
          version: 1,
        },
      ],
    });
    await user.type(screen.getByRole("searchbox"), "Kitchen");
    expect(
      screen.getByRole("button", { name: "Open folder Kitchen" }),
    ).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "Layout");
    expect(
      screen.getByRole("button", { name: "Open Layout" }),
    ).toBeInTheDocument();
  });
  it("keeps the reviewed file open and makes the next action available", async () => {
    let saved = {
      ...design,
      versions: [
        {
          ...design.versions[0],
          status: "internal_review",
          reviewerId: "reviewer",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const input = JSON.parse(String(init?.body ?? "{}"));
        saved = {
          ...saved,
          version: saved.version + 1,
          versions: [{ ...saved.versions[0], status: input.action }],
        };
        return { ok: true, json: async () => saved };
      }),
    );
    const user = setup(saved);
    await user.click(screen.getByRole("tab", { name: /Internal approval/ }));
    await user.click(screen.getByRole("button", { name: "Open Layout" }));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("region", { name: "Approve" });
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await screen.findByRole("button", { name: "Send to client" });
    expect(window.location.search).toContain("file=design");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to files" }));
    expect(
      screen.getByRole("button", { name: "Open Layout" }),
    ).toHaveTextContent("Ready to send to client");
  });
  it("applies portal approval without closing the open file", async () => {
    const waiting = {
      ...design,
      versions: [{ ...design.versions[0], status: "client_review" }],
    };
    const approved = {
      ...waiting,
      version: 2,
      versions: [{ ...waiting.versions[0], status: "approved" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ...options, items: [approved] }),
      })),
    );
    const user = setup(waiting);
    await user.click(screen.getByRole("tab", { name: /Client approval/ }));
    await user.click(screen.getByRole("button", { name: "Open Layout" }));
    act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByText(
      "Approved by the client. This revision and its decision are kept in history.",
    );
    expect(window.location.search).toContain("file=design");
    await user.click(screen.getByRole("button", { name: "Back to files" }));
    expect(
      screen.queryByRole("button", { name: "Open Layout" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /^Approved/ }));
    expect(
      screen.getByRole("button", { name: "Open Layout" }),
    ).toBeInTheDocument();
  });
  it("preserves unsent comments on failed requests and guards the back action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    const close = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <DesignSystemProvider>
        <DesignFileDetails
          data={data}
          design={design}
          folderName="Reception"
          options={options}
          onClose={close}
          onUpdate={() => {}}
          onReviewed={() => {}}
        />
      </DesignSystemProvider>,
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Add a comment" }),
      "Please check clearance",
    );
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox", { name: "Add a comment" })).toHaveValue(
      "Please check clearance",
    );
    await user.click(screen.getByRole("button", { name: "Back to files" }));
    expect(confirm).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
  it("shows a setup action instead of sending to an unavailable portal", async () => {
    const user = setup(
      {
        ...design,
        versions: [{ ...design.versions[0], status: "internal_approved" }],
      },
      {
        ...options,
        portal: { enabled: false, slug: null, hasApprover: false },
      },
    );
    await user.click(
      screen.getByRole("button", { name: "Open folder Reception" }),
    );
    await user.click(screen.getByRole("button", { name: "Open Layout" }));
    await user.click(screen.getByRole("button", { name: "Send to client" }));
    const dialog = screen.getByRole("region", { name: "Send to client" });
    expect(
      within(dialog).getByRole("button", { name: "Send to client" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "Set up client access" }),
    ).toHaveAttribute("href", "/workspace/pre-projects/cases/c/client-portal");
  });
});
