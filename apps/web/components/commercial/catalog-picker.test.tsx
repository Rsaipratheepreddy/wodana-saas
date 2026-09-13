import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommercialCatalogPicker,
  type CommercialCatalogChoice,
} from "./catalog-picker";
const oak = {
  id: "oak",
  name: "Oak veneer",
  code: "OAK-01",
  catalogName: "Timber",
  version: 1,
} as CommercialCatalogChoice;
const walnut = { ...oak, id: "walnut", name: "Walnut veneer", code: "WAL-01" };
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(async (url: string) => ({
        ok: true,
        json: async () => ({
          items: [oak, walnut].filter((m) =>
            m.name
              .toLowerCase()
              .includes(
                new URL(url, "http://localhost").searchParams
                  .get("search")
                  ?.toLowerCase() ?? "",
              ),
          ),
        }),
      })),
  ),
);
function Picker() {
  const [value, setValue] = useState<CommercialCatalogChoice | null>(null);
  return (
    <>
      <CommercialCatalogPicker
        workspaceId="workspace"
        caseId="case"
        kind="material"
        label="Material"
        value={value}
        onChange={setValue}
      />
      <output aria-label="Saved material">{value?.id ?? "none"}</output>
      <button onClick={() => setValue(walnut)}>
        Change selection externally
      </button>
    </>
  );
}
describe("Catalog selection in quotation sidebars", () => {
  it("keeps async search results open and commits an actual record with Enter", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const field = screen.getByRole("combobox", { name: "Material" });
    await user.type(field, "Oak");
    expect(
      await screen.findByRole("option", { name: "Oak veneer · Timber" }),
    ).toBeVisible();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Saved material")).toHaveTextContent("oak");
    expect(field).toHaveValue("Oak veneer · Timber");
    expect(field).toHaveAttribute("aria-expanded", "false");
  });
  it("does not save search text as a material and reflects external selection changes", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const field = screen.getByRole("combobox", { name: "Material" });
    await user.type(field, "Custom search");
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Saved material")).toHaveTextContent("none");
    await user.click(
      screen.getByRole("button", { name: "Change selection externally" }),
    );
    expect(field).toHaveValue("Walnut veneer · Timber");
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(field).toHaveValue("");
    expect(screen.getByLabelText("Saved material")).toHaveTextContent("none");
  });
  it("filters the old selection out when searching for a replacement", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    await user.click(
      screen.getByRole("button", { name: "Change selection externally" }),
    );
    const field = screen.getByRole("combobox", { name: "Material" });
    await user.clear(field);
    await user.type(field, "Oak");
    await screen.findByRole("option", { name: "Oak veneer · Timber" });
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "Walnut veneer · Timber" }),
      ).toBeNull(),
    );
    await user.click(
      screen.getByRole("option", { name: "Oak veneer · Timber" }),
    );
    expect(screen.getByLabelText("Saved material")).toHaveTextContent("oak");
  });
});
