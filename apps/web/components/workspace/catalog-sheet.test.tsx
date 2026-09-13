import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  blankCatalogRecord,
  type CatalogRecord,
} from "@/lib/workspace/catalog";
import { CatalogSheet } from "./catalog-sheet";

function fixture() {
  const unit = {
    ...blankCatalogRecord("unit"),
    code: "SHEET",
    name: "Sheet",
    version: 1,
  };
  const route = {
    ...blankCatalogRecord("execution"),
    code: "FACTORY",
    name: "Factory",
    version: 1,
  };
  const process = {
    ...blankCatalogRecord("factory_process"),
    code: "CUT",
    name: "Cutting",
    version: 1,
    configuration: { processGroup: "Panels", performer: "in_house" },
    links: [{ relation: "unit", targetId: unit.id }],
  };
  return { unit, route, process };
}

function Harness({
  save,
}: {
  save: (r: CatalogRecord) => Promise<CatalogRecord>;
}) {
  const [records, setRecords] = useState(() => Object.values(fixture()));
  return (
    <CatalogSheet
      kind="factory_process"
      items={records}
      rows={records.filter((r) => r.kind === "factory_process")}
      canManage
      onSave={save}
      onOpen={() => {}}
      onSaved={(r) =>
        setRecords((old) => [...old.filter((x) => x.id !== r.id), r])
      }
    />
  );
}

describe("catalog editable sheet", () => {
  it("keeps the generated code while tabbing through a new row", async () => {
    const user = userEvent.setup();
    render(<Harness save={async (r) => ({ ...r, version: 1 })} />);
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.type(
      screen.getByRole("textbox", { name: "Edit Name" }),
      "Edge banding",
    );
    await user.keyboard("{Tab}");
    expect(screen.getByRole("textbox", { name: "Edit Code" })).toHaveValue(
      "EDGE_BANDING",
    );
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("textbox", { name: "Edit Name" })).toHaveValue(
      "Edge banding",
    );
  });
  it("pastes linked rows, undoes the paste and keeps only failed rows for retry", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (r: CatalogRecord) => {
      if (r.code === "SAND" && save.mock.calls.length === 2)
        throw new Error("A current version is required.");
      return { ...r, version: r.version + 1 };
    });
    render(<Harness save={save} />);
    const pasteRows = () =>
      fireEvent.paste(
        screen.getByRole("button", { name: "Edit Name for Cutting" }),
        {
          clipboardData: {
            getData: () =>
              "Panel cutting\tCUT\tSHEET\tFACTORY\tPanels\tin_house\nSanding\tSAND\tSHEET\tFACTORY\tFinishing\tsubcontractor",
          },
        },
      );
    pasteRows();
    expect(
      screen.getByRole("button", { name: "Edit Name for Sanding" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      screen.queryByRole("button", { name: "Edit Name for Sanding" }),
    ).not.toBeInTheDocument();
    pasteRows();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A current version is required.",
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0].links.map((l) => l.relation)).toEqual([
      "unit",
      "execution",
    ]);
    expect(save.mock.calls[1][0].configuration).toEqual({
      processGroup: "Finishing",
      performer: "subcontractor",
    });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(save.mock.calls[2][0].code).toBe("SAND");
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("stores numeric cell values as numbers and rejects unknown linked records", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async (r: CatalogRecord) => ({ ...r, version: 2 }));
    render(<Harness save={save} />);
    await user.click(screen.getByText("Columns", { exact: true }));
    await user.click(
      screen.getByRole("checkbox", { name: "Setup minutes per batch" }),
    );
    await user.click(screen.getByText("Columns", { exact: true }));
    await user.click(
      screen.getByRole("button", {
        name: "Edit Setup minutes per batch for Cutting",
      }),
    );
    const input = screen.getByRole("spinbutton", {
      name: "Edit Setup minutes per batch",
    });
    fireEvent.change(input, { target: { value: "15.5" } });
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].configuration?.setupMinutes).toBe(15.5);
    fireEvent.paste(
      screen.getByRole("button", { name: "Edit Name for Cutting" }),
      {
        clipboardData: { getData: () => "Cutting\tCUT\tUNKNOWN" },
      },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unknown measurement unit",
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});
