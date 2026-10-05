import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { GridDefaultsProvider, type GridDefault, type GridDefaultsSource } from "../foundations/grid-defaults";
import { DataGrid, type DataGridColumn } from "./data-grid";

type Row = { id: string; name: string; stage: string; owner: string };
const columns: DataGridColumn<Row>[] = [
  { accessorKey: "name", header: "Name", meta: { primary: true } },
  { accessorKey: "stage", header: "Stage" },
  { accessorKey: "owner", header: "Owner" },
];
const rows: Row[] = [{ id: "1", name: "Palm Villa", stage: "Design", owner: "Maya" }];

function source(initial: GridDefault) {
  let current = initial;
  const value: GridDefaultsSource & { load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> } = {
    load: vi.fn(async () => current),
    save: vi.fn(async (_key: string, input: { hiddenColumns: string[]; version: number }) => { current = { ...current, hiddenColumns: input.hiddenColumns, version: input.version + 1 }; return current; }),
  };
  return value;
}

function renderGrid(gridSource: GridDefaultsSource | null, gridKey: string | null = "crm.enquiries") {
  return render(<DesignSystemProvider><GridDefaultsProvider source={gridSource}>
    <DataGrid ariaLabel="Enquiries" columns={columns} data={rows} getRowId={(row) => row.id} gridKey={gridKey ?? undefined} />
  </GridDefaultsProvider></DesignSystemProvider>);
}

describe("DataGrid workspace default (R14)", () => {
  it("starts with the workspace's hidden columns hidden, and never hides the primary column", async () => {
    const gridSource = source({ hiddenColumns: ["owner", "name"], version: 3, canManage: false });
    renderGrid(gridSource);
    await waitFor(() => expect(screen.queryByRole("columnheader", { name: "Owner" })).not.toBeInTheDocument());
    expect(gridSource.load).toHaveBeenCalledWith("crm.enquiries");
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Stage" })).toBeInTheDocument();
  });

  it("lets a person show a hidden column for themselves; Reset columns returns to the workspace default", async () => {
    const user = userEvent.setup();
    renderGrid(source({ hiddenColumns: ["owner"], version: 1, canManage: false }));
    await waitFor(() => expect(screen.queryByRole("columnheader", { name: "Owner" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Table options" }));
    // Only people who manage the module may change the default for everyone.
    expect(screen.queryByRole("button", { name: "Save as the default for everyone" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Owner" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("columnheader", { name: "Owner" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(screen.getByRole("checkbox", { name: "Owner" })).not.toBeChecked();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("columnheader", { name: "Owner" })).not.toBeInTheDocument();
  });

  it("lets a manager save the current columns as the default for everyone", async () => {
    const user = userEvent.setup();
    const gridSource = source({ hiddenColumns: [], version: 0, canManage: true });
    renderGrid(gridSource);
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.click(screen.getByRole("checkbox", { name: "Stage" }));
    await user.click(await screen.findByRole("button", { name: "Save as the default for everyone" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved as the default for everyone");
    expect(gridSource.save).toHaveBeenCalledWith("crm.enquiries", expect.objectContaining({ hiddenColumns: ["stage"], version: 0, requestId: expect.any(String) }));
    // The saved default is what Reset columns now returns to.
    await user.click(screen.getByRole("checkbox", { name: "Owner" }));
    await user.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(screen.getByRole("checkbox", { name: "Stage" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Owner" })).toBeChecked();
  });

  it("says when the default could not be saved", async () => {
    const user = userEvent.setup();
    const gridSource = source({ hiddenColumns: [], version: 2, canManage: true });
    gridSource.save.mockRejectedValueOnce(new Error("This list's default changed"));
    renderGrid(gridSource);
    await user.click(screen.getByRole("button", { name: "Table options" }));
    await user.click(await screen.findByRole("button", { name: "Save as the default for everyone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The default could not be saved. Reload and try again.");
  });

  it("changes nothing without a list key or a workspace source", async () => {
    const user = userEvent.setup();
    const gridSource = source({ hiddenColumns: ["owner"], version: 1, canManage: true });
    const { unmount } = renderGrid(gridSource, null);
    expect(gridSource.load).not.toHaveBeenCalled();
    expect(screen.getByRole("columnheader", { name: "Owner" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Table options" }));
    expect(screen.queryByRole("button", { name: "Save as the default for everyone" })).not.toBeInTheDocument();
    unmount();
    renderGrid(null);
    expect(screen.getByRole("columnheader", { name: "Owner" })).toBeInTheDocument();
  });
});
