import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { UiLanguageContext } from "@/lib/i18n/i18n-provider";
import { DesignSystemProvider, WorkspaceRegionProvider, useDesignSystem, usePortalThemeAttributes } from "./provider";

function Nested() {
  const settings = useDesignSystem();
  return <DesignSystemProvider {...settings} data-testid="nested"><span /></DesignSystemProvider>;
}

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

  it("says 'document' in server markup when it follows the page, so a dark page never renders light first", () => {
    expect(renderToString(<DesignSystemProvider><Nested /></DesignSystemProvider>).match(/data-wd-theme="document"/g)).toHaveLength(2);
    expect(renderToString(<DesignSystemProvider theme="light"><Nested /></DesignSystemProvider>).match(/data-wd-theme="light"/g)).toHaveLength(2);
  });

  it("follows the page in a nested provider handed the settings above it", () => {
    document.documentElement.dataset.theme = "dark";
    render(<DesignSystemProvider><Nested /></DesignSystemProvider>);
    expect(screen.getByTestId("nested")).toHaveAttribute("data-wd-theme", "dark");
  });
});

describe("design-system provider direction", () => {
  function Inherits() {
    const settings = useDesignSystem();
    return <DesignSystemProvider {...settings} data-testid="page"><span /></DesignSystemProvider>;
  }
  it("reads right to left in Arabic for a page that re-uses the workspace's settings", () => {
    render(<UiLanguageContext.Provider value="ar"><WorkspaceRegionProvider currency="AED"><Inherits /></WorkspaceRegionProvider></UiLanguageContext.Provider>);
    expect(screen.getByTestId("page")).toHaveAttribute("dir", "rtl");
  });
  it("reads left to right in English", () => {
    render(<UiLanguageContext.Provider value="en"><WorkspaceRegionProvider currency="AED"><Inherits /></WorkspaceRegionProvider></UiLanguageContext.Provider>);
    expect(screen.getByTestId("page")).toHaveAttribute("dir", "ltr");
  });
});
