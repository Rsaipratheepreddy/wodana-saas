import { describe, expect, it } from "vitest";
import { getPreProjectRedirect } from "./routes";
import { workspaceScreens } from "@/components/workspace/workspace-navigation";

describe("Pre-execution bookmarks", () => {
  it.each([
    ["site-visits", "requirements"],
    ["inspirations", "inspiration"],
    ["client-approvals", "client-portal"],
  ])("redirects %s to the grouped %s section", (previous, current) => {
    const destination = getPreProjectRedirect(`/workspace/pre-projects/${previous}`);
    expect(destination).toBe(`/workspace/pre-projects/${current}`);
    expect(workspaceScreens.some((screen) => screen.href === destination)).toBe(true);
    expect(getPreProjectRedirect(destination!)).toBeUndefined();
  });

  it.each([['measurements', 'measurements'], ['site-layouts', 'site-plan']])('keeps the %s destination on its own tab', (previous, tab) => {
    expect(getPreProjectRedirect(`/workspace/pre-projects/${previous}`, { record: 'case' })).toBe(`/workspace/pre-projects/requirements?record=case&tab=${tab}`);
  });

  it("preserves and encodes query context, including repeated filters", () => {
    expect(getPreProjectRedirect("/workspace/pre-projects/inspirations", {
      record: "demo-case",
      room: ["Kitchen & pantry", "Bedroom #2"],
      missing: undefined,
    })).toBe("/workspace/pre-projects/inspiration?record=demo-case&room=Kitchen+%26+pantry&room=Bedroom+%232");
  });

  it.each(["/workspace/pre-projects/inspiration", "/workspace/pre-projects/requirements", "/workspace/crm", "/workspace/projects", "/workspace/pre-projects/unknown", "/workspace/pre-projects", "https://example.com", "__proto__"])("does not redirect unrelated or unknown destination %s", (pathname) => {
    expect(getPreProjectRedirect(pathname)).toBeUndefined();
  });
});
