import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DesignSystemProvider, WorkspaceRegionProvider, usePortalThemeAttributes } from "./provider";

function PortaledTheme() {
  const attributes = usePortalThemeAttributes();
  return <span data-testid="portaled">{attributes["data-wd-theme"]}</span>;
}

describe("design-system provider theme", () => {
  afterEach(() => { document.documentElement.dataset.theme = "light"; });

  it("follows the document's theme when a page's provider doesn't choose one, and switches with it", async () => {
    document.documentElement.dataset.theme = "dark";
    const { container } = render(<WorkspaceRegionProvider currency="AED"><DesignSystemProvider><PortaledTheme /></DesignSystemProvider></WorkspaceRegionProvider>);
    expect(container.querySelector(".wd-root")).toHaveAttribute("data-wd-theme", "dark");
    expect(screen.getByTestId("portaled")).toHaveTextContent("dark");

    await act(async () => { document.documentElement.dataset.theme = "light"; await Promise.resolve(); });
    expect(container.querySelector(".wd-root")).toHaveAttribute("data-wd-theme", "light");
    expect(screen.getByTestId("portaled")).toHaveTextContent("light");
  });

  it("keeps a theme a provider chose, for itself and the providers inside it", () => {
    document.documentElement.dataset.theme = "dark";
    render(<DesignSystemProvider data-testid="portal" theme="light"><DesignSystemProvider data-testid="inner"><PortaledTheme /></DesignSystemProvider></DesignSystemProvider>);
    expect(screen.getByTestId("portal")).toHaveAttribute("data-wd-theme", "light");
    expect(screen.getByTestId("inner")).toHaveAttribute("data-wd-theme", "light");
    expect(screen.getByTestId("portaled")).toHaveTextContent("light");
  });

  it("is light outside a dark document", () => {
    const { container } = render(<DesignSystemProvider><span /></DesignSystemProvider>);
    expect(container.querySelector(".wd-root")).toHaveAttribute("data-wd-theme", "light");
  });
});
