import { describe, expect, it } from "vitest";
import { memberAccessCapabilities, membersPageFixture } from "./members";

describe("member access capabilities", () => {
  it("keeps a reader read-only", () => {
    const access = memberAccessCapabilities(["module.members.read"], ["viewer"], membersPageFixture.roles);
    expect(access).toMatchObject({ canView: true, canInvite: false, canEdit: false, canCancelInvitations: false, canReadInvitations: true });
    expect(access.assignableRoleCodes).not.toContain("owner");
  });

  it("does not treat role-catalogue access as People access", () => {
    const access = memberAccessCapabilities(["module.roles.read"], ["role_viewer"], membersPageFixture.roles);
    expect(access.canView).toBe(false);
  });

  it("allows a scoped inviter to delegate only permissions they hold", () => {
    const roles = [
      ...membersPageFixture.roles,
      { ...membersPageFixture.roles[2], id: "scoped", code: "people_inviter", permissions: ["module.members.write"] },
      { ...membersPageFixture.roles[2], id: "finance", code: "finance_reviewer", permissions: ["commercial.finance.verify"] },
    ];
    const access = memberAccessCapabilities(["module.members.write"], ["people_inviter"], roles);
    expect(access).toMatchObject({ canManage: false, canInvite: true, canEdit: false, canReadInvitations: true });
    expect(access.assignableRoleCodes).toContain("people_inviter");
    expect(access.assignableRoleCodes).not.toContain("finance_reviewer");
    expect(access.assignableRoleCodes).not.toContain("owner");
  });

  it("allows a named Owner to manage every role", () => {
    const access = memberAccessCapabilities([], ["owner"], membersPageFixture.roles);
    expect(access).toMatchObject({ canManage: true, canInvite: true, canEdit: true, canCancelInvitations: true });
    expect(access.assignableRoleCodes).toContain("owner");
  });
});
