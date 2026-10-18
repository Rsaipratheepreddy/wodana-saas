import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { MaterialChips, materialLabel, materialParts } from "./material-chips";

describe("material chips", () => {
  it("reads each material and its code from the line's text", () => {
    expect(materialParts("Velvet · FB-102 / Oak veneer (OV-7)\nBrass handle").map(materialLabel))
      .toEqual(["Velvet · FB-102", "Oak veneer · OV-7", "Brass handle"]);
    expect(materialParts("  ")).toEqual([]);
  });

  it("shows every material as its own chip", () => {
    render(<DesignSystemProvider><MaterialChips value="Velvet · FB-102 / Walnut" /></DesignSystemProvider>);
    expect(screen.getByText("Velvet · FB-102")).toHaveClass("wd-tag");
    expect(screen.getByText("Walnut")).toHaveClass("wd-tag");
  });
});
