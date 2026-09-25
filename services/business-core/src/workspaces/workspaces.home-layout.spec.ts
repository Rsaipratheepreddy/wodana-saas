import { describe, expect, it, vi } from "vitest";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { WorkspacesService } from "./workspaces.service";
import { UpdateHomeLayoutDto } from "./dto/update-home-layout.dto";

const widgets = [{ id: "tools" as const, visible: true, wide: false }];
function setup(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  const access = { asMember: vi.fn(async (_actor, _workspace, work) => work({ query }, { userId: "authenticated-user" })) };
  return { query, access, service: new WorkspacesService({} as never, {} as never, access as never, {} as never, {} as never) };
}
describe("personal Home layouts", () => {
  it("checks permissions before querying Home module records", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "member-id" }] });
    const access = { asMember: vi.fn(async (_actor, _workspace, work) => work({ query }, { userId: "authenticated-user" })), hasPermission: vi.fn().mockResolvedValue(false) };
    const service = new WorkspacesService({} as never, {} as never, access as never, {} as never, {} as never);
    const overview = await service.homeOverview({} as never, "workspace");
    expect(access.hasPermission).toHaveBeenCalledTimes(4);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(["workspace", "authenticated-user"]);
    expect(overview.sales).toEqual([]);
    expect(overview.metrics.myFollowUps).toBeNull();
  });
  it("reads only the authenticated member's workspace layout", async () => {
    const { service, query, access } = setup([{ widgets, version: 2 }]);
    expect(await service.homeLayout({} as never, "workspace")).toEqual({ widgets, version: 2 });
    expect(access.asMember).toHaveBeenCalledWith({}, "workspace", expect.any(Function));
    expect(query.mock.calls[0][1]).toEqual(["workspace", "authenticated-user"]);
  });
  it("binds saves to the member, workspace and expected version", async () => {
    const { service, query } = setup([{ widgets, version: 3 }]);
    await service.updateHomeLayout({} as never, "workspace", { version: 2, widgets });
    expect(query.mock.calls[0][1]).toEqual(["workspace", "authenticated-user", JSON.stringify(widgets), 2]);
    expect(query.mock.calls[0][0]).toContain("home_layout_version=$4");
    expect(query.mock.calls[0][0]).toContain("status='active'");
  });
  it("refuses stale writes rather than overwriting another session", async () => {
    await expect(setup([]).service.updateHomeLayout({} as never, "workspace", { version: 1, widgets })).rejects.toThrow("changed elsewhere");
  });
  it.each([
    { version: -1, widgets },
    { version: 0, widgets: [{ id: "admin", visible: true, wide: false }] },
    { version: 0, widgets: [...widgets, ...widgets] },
    { version: 0, widgets: [{ id: "tools", visible: "yes", wide: false }] },
    { version: 0, widgets: [null] },
  ])("rejects malformed layout %j", async input => {
    expect((await validate(plainToInstance(UpdateHomeLayoutDto, input))).length).toBeGreaterThan(0);
  });
});
