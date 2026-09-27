import { expect, it } from "vitest";
import { defaultHomeLayout, defaultLayoutFor, homeActivityId, homeProfile, homeWidgetIds, homeWidgetSpan, moveHomeWidget, parseHomeLayout, placeHomeWidget } from "./home-layout";

it("recovers missing widgets and ignores unknown or duplicate saved entries", () => {
  const parsed = parseHomeLayout(JSON.stringify([{ id: "tools", visible: false, wide: true }, { id: "tools" }, { id: "admin" }, null]));
  expect(parsed.map(item => item.id)).toEqual(["tools", ...defaultHomeLayout.map(item => item.id).filter(id => id !== "tools")]);
  expect(parsed[0]).toEqual({ id: "tools", visible: false, size: "wide", wide: true });
  expect(parseHomeLayout("invalid")).toEqual(defaultHomeLayout);
});

it("reads sizes, keeps old wide-only layouts and appends new widgets from the role default", () => {
  const fallback = defaultLayoutFor("finance");
  const parsed = parseHomeLayout(JSON.stringify([{ id: "attention", visible: true, wide: false }, { id: "storage", visible: true, size: "medium" }]), fallback);
  expect(parsed[0]).toMatchObject({ id: "attention", size: "medium", wide: false });
  expect(parsed[1]).toMatchObject({ id: "storage", size: "medium", wide: false });
  expect(parsed.map(item => item.id).sort()).toEqual([...homeWidgetIds].sort());
  expect(parsed.find(item => item.id === "money")).toMatchObject({ visible: true });
});

it("builds a different starting Home per role from permissions, packing rows without gaps", () => {
  const grants = (...keys: string[]) => (key: string) => keys.includes(key);
  expect(homeProfile(grants("workspace.settings.manage"))).toBe("owner");
  expect(homeProfile(grants("receivables.view"))).toBe("finance");
  expect(homeProfile(grants("crm.leads.view", "pre_projects.view"))).toBe("sales");
  expect(homeProfile(grants("pre_projects.view"))).toBe("qs");
  expect(homeProfile(grants())).toBe("member");
  expect(defaultLayoutFor("finance").filter(item => item.visible)[0].id).toBe("money");
  expect(defaultLayoutFor("qs").filter(item => item.visible)[0].id).toBe("planning");
  for (const profile of ["owner", "sales", "qs", "finance", "member"] as const) {
    // Compact: at most two rows of the three-column grid.
    expect(defaultLayoutFor(profile).filter(item => item.visible).reduce((sum, item) => sum + homeWidgetSpan[item.size], 0), profile).toBeLessThanOrEqual(6);
    const shown = defaultLayoutFor(profile, id => id !== "planning" && id !== "storage").filter(item => item.visible);
    let used = 0;
    for (const item of shown) { const span = homeWidgetSpan[item.size]; expect(used + span, `${profile}: ${item.id}`).toBeLessThanOrEqual(3); used = (used + span) % 3; }
    expect(used).toBe(0);
  }
});

it("moves widgets earlier and later, skipping hidden ones, and places dragged widgets", () => {
  const layout = defaultLayoutFor("owner");
  const shown = (item: { visible: boolean }) => item.visible;
  const [first, second] = layout.filter(shown);
  const moved = moveHomeWidget(layout, second.id, -1, shown);
  expect(moved.filter(shown).slice(0, 2).map(item => item.id)).toEqual([second.id, first.id]);
  expect(moveHomeWidget(layout, first.id, -1, shown)).toBe(layout);
  const placed = placeHomeWidget(layout, "tools", layout[0].id);
  expect(placed[0].id).toBe("tools");
});

it("only opens activity inspectors for valid internal activity links", () => {
  expect(homeActivityId({ deepLink: "https://example.com/crm/activities/74000000-0000-4000-8000-000000000001" })).toBeNull();
  expect(homeActivityId({ deepLink: "/crm/activities/74000000-0000-4000-8000-000000000001" })).toBe("74000000-0000-4000-8000-000000000001");
});
