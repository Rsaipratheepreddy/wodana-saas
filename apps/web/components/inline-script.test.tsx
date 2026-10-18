import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineScript } from "./inline-script";

describe("an inline script that runs before paint (m6)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs from the server's HTML and is inert when React renders it in the browser", () => {
    expect(renderToString(<InlineScript html="document.documentElement.dataset.theme='dark'" />)).toContain('type="text/plain"');
    vi.stubGlobal("window", undefined);
    expect(renderToString(<InlineScript html="document.documentElement.dataset.theme='dark'" />)).toContain('type="text/javascript"');
  });
});
