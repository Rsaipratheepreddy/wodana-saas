import { describe, expect, it } from "vitest";
import { AVATAR_ROLES, avatarVariant, roleAvatarFile, roleAvatarKey, roleAvatarPath, woddyPath } from "./brand.js";

describe("role avatars", () => {
  it("maps every workspace role code to an avatar in the set", () => {
    const expected: Record<string, string> = {
      owner: "owner", administrator: "owner", sales: "sales", quantity_surveyor: "estimator",
      finance_reviewer: "finance", project_manager: "project_manager", site_supervisor: "site_supervisor",
      operations_approver: "purchasing", designer: "designer", purchasing: "purchasing", people: "people",
      factory: "factory", carpenter: "carpenter", electrician: "electrician", painter: "painter",
      installer: "installer", client: "client", member: "default", viewer: "default",
    };
    for (const [code, avatar] of Object.entries(expected)) {
      expect(roleAvatarKey([code]), code).toBe(avatar);
      expect(AVATAR_ROLES).toContain(roleAvatarKey([code]));
    }
  });

  it("ignores case, spaces and dashes in a code", () => {
    expect(roleAvatarKey(["Site Supervisor"])).toBe("site_supervisor");
    expect(roleAvatarKey(["project-manager"])).toBe("project_manager");
  });

  it("reads a kit's own codes by their first word", () => {
    expect(roleAvatarKey(["sales_executive"])).toBe("sales");
    expect(roleAvatarKey(["people_inviter"])).toBe("people");
    expect(roleAvatarKey(["ops_admin"])).toBe("purchasing");
  });

  it("uses default for unknown, empty or missing roles", () => {
    expect(roleAvatarKey(["wizard"])).toBe("default");
    expect(roleAvatarKey([])).toBe("default");
    expect(roleAvatarKey(null)).toBe("default");
    expect(roleAvatarKey(undefined)).toBe("default");
    expect(roleAvatarKey([null, undefined, ""])).toBe("default");
  });

  it("picks the main role when a person holds several", () => {
    expect(roleAvatarKey(["member", "sales"])).toBe("sales");
    expect(roleAvatarKey(["sales", "owner"])).toBe("owner");
    expect(roleAvatarKey(["viewer", "site_supervisor", "project_manager"])).toBe("project_manager");
    expect(roleAvatarKey("finance_reviewer")).toBe("finance");
  });

  it("chooses the woman or man deterministically from the id", () => {
    const ids = ["3f1c2b7e-1d2a-4f5b-9c8d-0a1b2c3d4e5f", "user-1", "user-2", "user-3", "omar", "sara"];
    for (const id of ids) {
      expect(avatarVariant(id)).toBe(avatarVariant(id));
      expect(["f", "m"]).toContain(avatarVariant(id));
    }
    // Both variants appear across ids, so the set is not one-sided.
    expect(new Set(ids.map(avatarVariant)).size).toBe(2);
    expect(avatarVariant(null)).toBe("f");
    expect(avatarVariant("")).toBe("f");
  });

  it("builds the file name and web path", () => {
    const variant = avatarVariant("u-42");
    expect(roleAvatarFile(["quantity_surveyor"], "u-42")).toBe(`estimator-${variant}.webp`);
    expect(roleAvatarPath(["quantity_surveyor"], "u-42")).toBe(`/brand/avatars/estimator-${variant}.webp`);
    expect(woddyPath("thinking")).toBe("/brand/woddy/thinking.webp");
  });
});
