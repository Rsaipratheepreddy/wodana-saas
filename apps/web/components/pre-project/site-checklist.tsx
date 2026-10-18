"use client";

import { useState } from "react";
import { Badge, InlineNotice, SegmentedControl, Switch, TextAreaField, TextInput, useDesignSystem, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import type { CheckStatus, ChecklistGroupRead, SiteAnswerInput, SiteChecklistGroup, SiteChecklistItem } from "@/lib/pre-project/design-workspace";
import styles from "./site-checklist.module.css";

export const CHECK_STATUS_LABEL: Record<CheckStatus, MessageKey> = { confirmed: tKey("Confirmed"), pending: tKey("Pending"), not_applicable: tKey("Not applicable") };
const CHECK_STATUS_TONE: Record<CheckStatus, StatusTone> = { confirmed: "success", pending: "warning", not_applicable: "neutral" };

/** A question's draft: its words (a checklist line's note) and a checklist line's status. */
export type ChecklistDraft = { answer: string; status: CheckStatus | null };
export const checklistDrafts = (checklist: SiteChecklistItem[]): Record<string, ChecklistDraft> =>
  Object.fromEntries(checklist.map((item) => [item.key, { answer: item.answer ?? "", status: item.status ?? null }]));
/** The answers that differ from what is saved, as the save command takes them. */
export function changedAnswers(checklist: SiteChecklistItem[], drafts: Record<string, ChecklistDraft>): SiteAnswerInput[] {
  return checklist.flatMap((item) => {
    const draft = drafts[item.key] ?? { answer: "", status: null };
    const answer = draft.answer.trim();
    const check = item.kind === "check";
    if (answer === (item.answer ?? "") && (!check || draft.status === (item.status ?? null))) return [];
    return [check ? { key: item.key, answer, status: draft.status } : { key: item.key, answer }];
  });
}
/** Answered: a question in words, a checklist line marked (a pending line counts). */
export const isAnswered = (item: Pick<SiteChecklistItem, "kind" | "answer" | "status">) => (item.kind === "check" ? Boolean(item.status) : Boolean(item.answer));
/** The list as groups; an old view without groups is one group. */
export const checklistGroups = (groups: SiteChecklistGroup[] | undefined, checklist: SiteChecklistItem[]): SiteChecklistGroup[] =>
  groups?.length ? groups : [{ scope: null, matches: true, required: true, keys: checklist.map((item) => item.key) }];

/**
 * The question list on the kick-off and the site measure: the general questions under their sections, then each
 * checklist with its "Applies to this job" switch. A checklist that doesn't apply shows its name and switch only.
 * `checksOnly`: after the visit, only the checklist lines can still change.
 */
export function ChecklistFields({ checklist, groups, drafts, onDraft, onApplies, checksOnly = false }: {
  checklist: SiteChecklistItem[]; groups: SiteChecklistGroup[]; drafts: Record<string, ChecklistDraft>; onDraft: (key: string, draft: ChecklistDraft) => void;
  onApplies?: (group: SiteChecklistGroup, applies: boolean) => Promise<unknown>; checksOnly?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ scope: string | null; message: string } | null>(null);
  const choose = async (group: SiteChecklistGroup, applies: boolean) => {
    if (!onApplies) return;
    setBusy(group.scope); setError(null);
    try { await onApplies(group, applies); } catch (cause) { setError({ scope: group.scope, message: cause instanceof Error ? cause.message : t("Could not save.") }); } finally { setBusy(null); }
  };
  const several = groups.length > 1;
  return <div className={styles.list}>
    {groups.map((group) => {
      const items = group.keys.map((key) => checklist.find((item) => item.key === key)).filter((item): item is SiteChecklistItem => Boolean(item));
      if (!items.length) return null;
      const applies = group.applies ?? group.required;
      const title = group.scope ?? group.section ?? t("General");
      return <section key={group.scope ? `scope:${group.scope}` : `section:${group.section ?? ""}`} className={styles.group} aria-label={title}>
        {several || group.scope ? <div className={styles.groupHead}>
          <h4 className={styles.groupTitle}>{title}</h4>
          {group.pending ? <Badge tone="warning">{t("{count} pending", { count: group.pending })}</Badge> : null}
          {group.scope && onApplies ? <Switch isSelected={applies} isDisabled={busy !== null} onChange={(next) => void choose(group, next)}>{t("Applies to this job")}</Switch>
            : group.scope && !applies ? <span className={styles.muted}>{t("Not for this job")}</span> : null}
        </div> : null}
        {error && error.scope === group.scope ? <InlineNotice tone="error" message={error.message} /> : null}
        {applies ? items.map((item) => {
          const draft = drafts[item.key] ?? { answer: "", status: null };
          const by = item.answeredByName && isAnswered(item) ? t("Answered by {name}", { name: item.answeredByName }) : undefined;
          if (item.kind !== "check") return <TextAreaField key={item.key} label={item.question} maxLength={2000} value={draft.answer} isDisabled={checksOnly}
            onChange={(answer) => onDraft(item.key, { ...draft, answer })} description={by} />;
          return <div key={item.key} className={styles.check} data-pending={draft.status === "pending" || undefined}>
            <p className={styles.question}>{item.question}</p>
            <SegmentedControl label={item.question} value={draft.status ?? ""}
              onChange={(next) => onDraft(item.key, { ...draft, status: draft.status === next ? null : next as CheckStatus })}
              options={(Object.keys(CHECK_STATUS_LABEL) as CheckStatus[]).map((status) => ({ id: status, label: t(CHECK_STATUS_LABEL[status]) }))} />
            <TextInput label={t("Requirement or reference")} maxLength={2000} value={draft.answer} onChange={(answer) => onDraft(item.key, { ...draft, answer })} description={by} />
          </div>;
        }) : null}
      </section>;
    })}
  </div>;
}

/** The answers read-only, grouped as asked (the project's brief, a work order's checklists); pending lines stand out. */
export function ChecklistAnswers({ groups }: { groups: ChecklistGroupRead[] }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const day = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)); } catch { return iso; } };
  return <div className={styles.list}>
    {groups.map((group) => <section key={group.scope ? `scope:${group.scope}` : `section:${group.section ?? ""}`} className={styles.group} aria-label={group.scope ?? group.section ?? t("General")}>
      <div className={styles.groupHead}>
        <h4 className={styles.groupTitle}>{group.scope ?? group.section ?? t("General")}</h4>
        {group.pending ? <Badge tone="warning">{t("{count} pending", { count: group.pending })}</Badge> : null}
      </div>
      <dl className={styles.answers}>
        {group.items.map((item) => <div key={item.key} className={styles.answer} data-pending={item.status === "pending" || undefined}>
          <dt>{item.question}</dt>
          <dd>
            {item.kind === "check" ? (item.status ? <Badge tone={CHECK_STATUS_TONE[item.status]}>{t(CHECK_STATUS_LABEL[item.status])}</Badge> : <span className={styles.muted}>{t("Not marked")}</span>) : null}
            {item.answer ? <span>{item.answer}</span> : item.kind === "answer" ? <span className={styles.muted}>{t("Not answered")}</span> : null}
            {item.answeredByName && item.answeredAt && (item.answer || item.status) ? <small className={styles.muted}>{item.answeredByName} · {day(item.answeredAt)}</small> : null}
          </dd>
        </div>)}
      </dl>
    </section>)}
  </div>;
}
