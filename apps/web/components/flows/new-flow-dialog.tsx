"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Copy, FilePlus2, LoaderCircle } from "lucide-react";
import { Callout, ControlledModalDialog, Skeleton, Tag } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { TEMPLATE_GROUPS, uniqueFlowName, type FlowSummary, type FlowTemplate } from "@/lib/flows/flow-model";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import styles from "./flows.module.css";

/** The starter flows every workspace can begin from when the template library is not there (plan §5a). */
export const STARTERS = [
  { code: "furniture", name: tKey("Furniture") },
  { code: "design", name: tKey("Design") },
  { code: "fit_out", name: tKey("Fit-out") },
  { code: "basic", name: tKey("Basic") },
];
const GROUP_LABELS: Record<string, ReturnType<typeof tKey>> = {
  Furniture: tKey("Furniture"), "Interior design": tKey("Interior design"), "Fit-out": tKey("Fit-out"), Other: tKey("Other"),
};

type Choice = { id: string; body: Record<string, unknown> };

/** New flow: pick a template, a copy of one of the firm's flows, or blank. Picking one creates it and opens the builder. */
export function NewFlowDialog({ flows, onClose, workspaceId }: { flows: FlowSummary[]; onClose: () => void; workspaceId: string }) {
  const t = useT();
  const router = useRouter();
  const [templates, setTemplates] = useState<FlowTemplate[] | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // No library yet (or it fails): the starters stand in for it.
    crmRequest<FlowTemplate[] | { data: FlowTemplate[] }>(workspaceId, "flows/templates", "GET", undefined, controller.signal)
      .then((result) => setTemplates(Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : null))
      .catch(() => { if (!controller.signal.aborted) setTemplates(null); });
    return () => controller.abort();
  }, [workspaceId]);

  async function create(choice: Choice) {
    setBusy(choice.id);
    setError(null);
    try {
      const created = await crmRequest<{ id: string }>(workspaceId, "flows", "POST", choice.body);
      router.push(`/workspace/flows/${created.id}`);
    } catch (failure) {
      setError(translateKnown(t, failure instanceof Error ? failure.message : t("Please try again.")));
      setBusy(null);
    }
  }

  const named = (base: string) => uniqueFlowName(base, flows);
  const option = (choice: Choice, title: string, children?: React.ReactNode, icon?: React.ReactNode) => <li key={choice.id}>
    <button aria-busy={busy === choice.id || undefined} className={styles.option} disabled={Boolean(busy)} onClick={() => void create(choice)} type="button">
      <span className={styles.optionHead}>{icon}<strong>{title}</strong>{busy === choice.id ? <LoaderCircle aria-hidden="true" className="wd-spin" size={14} /> : null}</span>
      {children}
    </button>
  </li>;
  const groups = templates ? [...TEMPLATE_GROUPS, ...new Set(templates.map((item) => item.group).filter((group) => !(TEMPLATE_GROUPS as readonly string[]).includes(group)))]
    .map((group) => ({ group, items: templates.filter((item) => item.group === group && item.key !== "blank") })).filter((entry) => entry.items.length) : [];
  const blank = templates?.find((item) => item.key === "blank");
  const copies = flows.filter((flow) => flow.status === "active");

  return <ControlledModalDialog isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }} size="lg" title={t("New flow")}>
    <div className={styles.picker}>
      {error ? <Callout title={t("Not created")} tone="danger">{error}</Callout> : null}
      {templates === undefined ? <Skeleton lines={4} /> : templates ? groups.map(({ group, items }) => <section aria-label={GROUP_LABELS[group] ? t(GROUP_LABELS[group]) : group} className={styles.pickerGroup} key={group}>
        <h3 className={styles.pickerTitle}>{GROUP_LABELS[group] ? t(GROUP_LABELS[group]) : group}</h3>
        <ul className={styles.options}>{items.map((item) => option({ id: `template:${item.key}`, body: { templateKey: item.key, name: named(item.name) } }, item.name, <>
          {item.description ? <span className={styles.optionText}>{item.description}</span> : null}
          <span className={styles.optionMeta}>
            <span>{t("{count} steps", { count: item.stepCount })}</span>
            {item.suggestedEnquiryTypes.map((type) => <Tag key={type} tone="neutral">{type}</Tag>)}
          </span>
        </>))}</ul>
      </section>) : <section aria-label={t("Starters")} className={styles.pickerGroup}>
        <h3 className={styles.pickerTitle}>{t("Starters")}</h3>
        <ul className={styles.options}>{STARTERS.map((starter) => option({ id: `starter:${starter.code}`, body: { starter: starter.code, name: named(t(starter.name)) } }, t(starter.name)))}</ul>
      </section>}
      {copies.length ? <section aria-label={t("Start from a copy of an existing flow")} className={styles.pickerGroup}>
        <h3 className={styles.pickerTitle}>{t("Start from a copy of an existing flow")}</h3>
        <ul className={styles.options}>{copies.map((flow) => option({ id: `flow:${flow.id}`, body: { sourceFlowId: flow.id, name: named(t("Copy of {name}", { name: flow.name })) } }, flow.name,
          flow.latest?.steps?.length ? <span className={styles.optionMeta}>{t("{count} steps", { count: flow.latest.steps.length })}</span> : null, <Copy aria-hidden="true" size={14} />))}</ul>
      </section> : null}
      <ul className={styles.options}>
        {option({ id: "blank", body: blank ? { templateKey: blank.key, name: named(t("New flow")) } : { starter: "basic", name: named(t("New flow")) } }, t("Blank"),
          <span className={styles.optionText}>{t("The fewest steps, to build up yourself")}</span>, <FilePlus2 aria-hidden="true" size={14} />)}
      </ul>
    </div>
  </ControlledModalDialog>;
}
