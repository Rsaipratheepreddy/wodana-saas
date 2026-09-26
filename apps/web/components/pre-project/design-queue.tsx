"use client";

import { useRouter } from "next/navigation";
import { DataGrid, EmptyState, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { DesignQueueItem } from "@/lib/pre-project/server";

const STEP_LABEL: Record<DesignQueueItem["step"], string> = { review: "Review", record_client: "Record client decision", present: "Present to client", revise: "Upload a revision" };
const STAGE_LABEL: Record<string, string> = { space_planning: "Space planning", concepts: "Concepts", material_selection: "Material selection", renders: "3D renders" };

/** Home → Approvals → Designs: what's waiting on me; each row opens the drawing in Design. */
export function DesignQueue({ items, error }: { items: DesignQueueItem[]; error?: string }) {
  const t = useT();
  const router = useRouter();
  const { locale, timeZone } = useDesignSystem();
  const date = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" }).format(new Date(value));
  const open = (item: DesignQueueItem) => router.push(`/workspace/pre-projects/cases/${item.caseId}/designs?file=${item.designId}`);
  if (error) return <EmptyState illustration="error" title={t("Design reviews didn't load")} description={error} />;
  if (!items.length) return <EmptyState illustration="done" title={t("Nothing waiting on you")} description={t("Designs to review, present or revise appear here.")} />;
  const columns: DataGridColumn<DesignQueueItem>[] = [
    { id: "title", header: t("Design"), size: 280, accessorFn: (item) => item.title, meta: { primary: true } },
    { id: "where", header: t("Room · stage"), size: 220, accessorFn: (item) => [item.roomName, item.stage ? t(STAGE_LABEL[item.stage] as never) : null].filter(Boolean).join(" · ") || "—" },
    { id: "client", header: t("Client"), size: 200, accessorFn: (item) => item.clientName },
    { id: "step", header: t("Your step"), size: 190, accessorFn: (item) => t(STEP_LABEL[item.step] as never) },
    { id: "since", header: t("Waiting since"), size: 140, accessorFn: (item) => item.dueAt && item.step === "record_client" ? t("Due {date}", { date: date(item.dueAt) }) : date(item.since) },
  ];
  return <DataGrid ariaLabel={t("Designs waiting on you")} appearance="flush" columns={columns} data={items} getRowId={(item) => item.designId} onRowAction={open} selectable={false} rowNumbers={false} showToolbar={false} pageSize={50} emptyTitle={t("Nothing waiting on you")} />;
}
