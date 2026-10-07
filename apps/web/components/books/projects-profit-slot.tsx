"use client";

import type { LedgerScope } from "@/lib/books/reports-client";
import { ProjectsProfit } from "./projects-profit";

/** Reports › Projects profit: slice E's projects profit grid for the company and period the picker shows. */
export function ProjectsProfitSlot({ workspaceId, scope }: { workspaceId: string; scope: LedgerScope }) {
  return <ProjectsProfit workspaceId={workspaceId} entity={scope.entity || undefined} from={scope.from || undefined} to={scope.to || undefined} />;
}
