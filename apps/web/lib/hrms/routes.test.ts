import { describe, it, expect } from "vitest";
import { allowedHrmsRoute, allowedProjectsRoute } from "./routes";
import { hrmsUrl, localDay } from "./client";
describe("HRMS web boundary", () => {
  it("allows supported resources and rejects arbitrary backend paths", () => {
    expect(allowedHrmsRoute("POST", "attendance/actions")).toBe(true);
    expect(
      allowedHrmsRoute("PUT", "people/00000000-0000-4000-8000-000000000001"),
    ).toBe(true);
    for (const path of [
      "../auth",
      "people",
      "settings/anything",
      "attendance/actions?admin=1",
    ])
      expect(allowedHrmsRoute("POST", path)).toBe(false);
    expect(allowedHrmsRoute("DELETE", "settings")).toBe(false);
    expect(allowedProjectsRoute("POST", "from-pre-project")).toBe(true);
    expect(allowedProjectsRoute("PUT", "arbitrary")).toBe(false);
  });
  it("keeps workspace scope and employee calendar dates explicit", () => {
    expect(hrmsUrl("abc", "attendance/history?from=2026-09-01")).toBe(
      "/api/workspace/hrms/attendance/history?from=2026-09-01&workspaceId=abc",
    );
    expect(localDay("Asia/Kolkata", new Date("2026-09-06T20:00:00Z"))).toBe(
      "2026-09-07",
    );
  });
});

import { scopedHrmsNavigation } from './navigation';
import { workspaceModules } from '@/components/workspace/workspace-navigation';
it('shows only self-service navigation until team permissions are known',()=>{
 const hrms=workspaceModules.find(m=>m.id==='hrms')!;
 const links=(permissions?:Parameters<typeof scopedHrmsNavigation>[1])=>scopedHrmsNavigation(hrms,permissions).navigation.flatMap(g=>g.items.map(i=>i.href));
 expect(links()).toHaveLength(4);
 expect(links({self:true,team:true,manage:false,evidence:false,manageProjects:false})).toContain('/workspace/hrms/team');
 expect(links({self:true,team:true,manage:true,evidence:true,manageProjects:true})).toHaveLength(9);
});
