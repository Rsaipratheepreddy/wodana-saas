import { describe, expect, it } from "vitest";
import { getPreProjectRedirect } from "./routes";

describe("Planning bookmarks", () => {
  it.each([
    ["site-visits", "requirements"],
    ["measurements", "measurements"],
    ["site-layouts", "site-layouts"],
    ["inspirations", "inspiration"],
    ["client-approvals", "client-portal"],
  ])("redirects %s to the grouped %s section", (previous, current) => {
    const destination = getPreProjectRedirect(`/workspace/pre-projects/${previous}`);
    expect(destination).toBe(`/workspace/pre-projects?section=${current}`);
    expect(getPreProjectRedirect(destination!)).toBeUndefined();
  });

  it.each([['measurements', 'measurements'], ['site-layouts', 'site-layouts']])('keeps the %s destination on its own case section', (previous, section) => {
    expect(getPreProjectRedirect(`/workspace/pre-projects/${previous}`, { record: 'case' })).toBe(`/workspace/pre-projects?section=${section}&record=case`);
  });

  it("preserves and encodes query context, including repeated filters", () => {
    expect(getPreProjectRedirect("/workspace/pre-projects/inspirations", {
      record: "demo-case",
      room: ["Kitchen & pantry", "Bedroom #2"],
      missing: undefined,
    })).toBe("/workspace/pre-projects?section=inspiration&record=demo-case&room=Kitchen+%26+pantry&room=Bedroom+%232");
  });

  it.each(["/workspace/pre-projects/inspiration", "/workspace/pre-projects/requirements", "/workspace/crm", "/workspace/projects", "/workspace/pre-projects/unknown", "/workspace/pre-projects", "https://example.com", "__proto__"])("does not redirect unrelated or unknown destination %s", (pathname) => {
    expect(getPreProjectRedirect(pathname)).toBeUndefined();
  });
});
