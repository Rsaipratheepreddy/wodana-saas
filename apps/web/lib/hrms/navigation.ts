import type { HrmsBootstrap } from "@wodana/contracts";
import type { WorkspaceModuleDefinition } from "@/components/workspace/workspace-navigation";
export const hrmsSections = [
  "attendance",
  "leave",
  "time-summary",
  "site-attendance",
  "team",
  "people",
  "settings",
  "workplaces",
  "leave-settings",
] as const;
export type HrmsSection = (typeof hrmsSections)[number];
export function scopedHrmsNavigation(
  module: WorkspaceModuleDefinition,
  permissions: HrmsBootstrap["permissions"] | undefined,
) {
  return {
    ...module,
    navigation: module.navigation
      .map((group) => ({
        ...group,
        items: group.items.filter(() =>
          group.id === "hrms-admin"
            ? permissions?.manage
            : group.id === "hrms-team"
              ? permissions?.team
              : true,
        ),
      }))
      .filter((group) => group.items.length),
  };
}
