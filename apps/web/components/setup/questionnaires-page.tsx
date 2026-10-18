"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge, DataGrid, ErrorState, SettingsPage, SettingsSection, Skeleton, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown, type MessageKey } from "@/lib/i18n/keys";
import { loadQuestionnaires, type ElsewhereQuestionnaire, type QuestionnaireList, type QuestionnaireSummary } from "@/lib/setup/questionnaires";
import styles from "./setup.module.css";

type Row = { id: string; name: string; step: string; questions: number; required: number; href: string; version?: number; draftChanged?: boolean; elsewhere: boolean };

/**
 * §0.3 P3, Setup → Questionnaires: every question the firm asks, in one list. The firm's own questionnaires open their
 * editor here; consultation and site visit questions open where they're edited (their screens carry enquiry types and rooms).
 */
export function QuestionnairesPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const router = useRouter();
  const [list, setList] = useState<QuestionnaireList | null>(null);
  const [failure, setFailure] = useState("");
  const load = useCallback(() => { setFailure(""); loadQuestionnaires(workspaceId).then(setList).catch((error: Error) => setFailure(error.message)); }, [workspaceId]);
  useEffect(() => { queueMicrotask(load); }, [load]);
  const label = (text: string) => translateKnown(t, text as MessageKey);
  const rows: Row[] = list ? [
    ...list.questionnaires.map((item: QuestionnaireSummary) => ({ id: item.purpose, name: item.name, step: item.step, questions: item.questions, required: item.required,
      href: `/workspace/settings/questionnaires/${item.purpose}`, version: item.version, draftChanged: item.draftChanged, elsewhere: false })),
    ...list.elsewhere.map((item: ElsewhereQuestionnaire) => ({ id: item.key, name: item.name, step: item.step, questions: item.questions, required: item.required, href: item.href, elsewhere: true })),
  ] : [];
  const columns: DataGridColumn<Row>[] = [
    { accessorKey: "name", header: t("Questionnaire"), size: 260, cell: ({ row: { original: row } }) => <span className={styles.nameCell}>
      <Link href={row.href}><strong>{label(row.name)}</strong></Link><small>{label(row.step)}</small></span> },
    { id: "questions", header: t("Questions"), size: 150, accessorFn: (row) => row.questions,
      cell: ({ row: { original: row } }) => <span className={styles.chips}><Badge tone="neutral">{t("{count} questions", { count: row.questions })}</Badge>
        {row.required ? <Badge tone="info">{t("{count} required", { count: row.required })}</Badge> : null}</span> },
    { id: "status", header: t("Status"), size: 180, enableSorting: false, cell: ({ row: { original: row } }) => row.elsewhere ? <span className={styles.muted}>{t("Edited on its own page")}</span>
      : <span className={styles.chips}><Badge tone={row.version ? "success" : "neutral"}>{row.version ? t("Version {number}", { number: row.version }) : t("Kit questions")}</Badge>
        {row.draftChanged ? <Badge tone="warning">{t("Unpublished changes")}</Badge> : null}</span> },
  ];
  return <SettingsPage title={t("Questionnaires")} width="wide">
    {failure ? <ErrorState description={failure} onRetry={load} /> : !list ? <Skeleton lines={5} shape="rows" /> : <SettingsSection id="questionnaires" title={t("Questions the firm asks")}>
      <div data-sales-grid><DataGrid ariaLabel={t("Questionnaires")} columns={columns} data={rows} getRowId={(row) => row.id} rowNumbers={false} selectable={false} showToolbar={false}
        emptyTitle={t("No questionnaires")} emptyDescription={t("Questionnaires appear here once modules are on.")} onRowAction={(row) => router.push(row.href)} /></div>
    </SettingsSection>}
  </SettingsPage>;
}
