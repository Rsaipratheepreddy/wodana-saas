"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FilePlus2, LoaderCircle } from "lucide-react";
import { Callout, ControlledModalDialog, Skeleton, Tag, TextInput, typeHue } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { TEMPLATE_GROUPS, type EnquiryTypeSummary, type FlowTemplate, type TypeColor } from "@/lib/flows/flow-model";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import { ColorSwatches, TypeDot } from "./enquiry-type-colors";
import styles from "./flows.module.css";

const GROUP_LABELS: Record<string, ReturnType<typeof tKey>> = {
  Furniture: tKey("Furniture"), "Interior design": tKey("Interior design"), "Fit-out": tKey("Fit-out"), Other: tKey("Other"),
};

type Choice = { id: string; body: Record<string, unknown> };

/**
 * New enquiry type: its name and colour, then where its steps start from: a template, another type's steps, or blank.
 * Picking one creates the type with its steps and opens the builder.
 */
export function NewEnquiryTypeDialog({ onClose, types, workspaceId }: { onClose: () => void; types: EnquiryTypeSummary[]; workspaceId: string }) {
  const t = useT();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<TypeColor>(() => ((types.length % 6) + 1) as TypeColor);
  const [templates, setTemplates] = useState<FlowTemplate[] | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingName, setMissingName] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    crmRequest<FlowTemplate[] | { data: FlowTemplate[] }>(workspaceId, "flows/templates", "GET", undefined, controller.signal)
      .then((result) => setTemplates(Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : null))
      .catch(() => { if (!controller.signal.aborted) setTemplates(null); });
    return () => controller.abort();
  }, [workspaceId]);

  async function create(choice: Choice) {
    const name = label.trim();
    if (!name) { setMissingName(true); return; }
    setBusy(choice.id);
    setError(null);
    try {
      const created = await crmRequest<{ id: string }>(workspaceId, "enquiry-types", "POST", { label: name, color, ...choice.body });
      router.push(`/workspace/enquiry-types/${created.id}`);
    } catch (failure) {
      setError(translateKnown(t, failure instanceof Error ? failure.message : t("Please try again.")));
      setBusy(null);
    }
  }

  const option = (choice: Choice, title: string, children?: React.ReactNode, icon?: React.ReactNode) => <li key={choice.id}>
    <button aria-busy={busy === choice.id || undefined} className={styles.option} disabled={Boolean(busy)} onClick={() => void create(choice)} type="button">
      <span className={styles.optionHead}>{icon}<strong>{title}</strong>{busy === choice.id ? <LoaderCircle aria-hidden="true" className="wd-spin" size={14} /> : null}</span>
      {children}
    </button>
  </li>;
  const groups = templates ? [...TEMPLATE_GROUPS, ...new Set(templates.map((item) => item.group).filter((group) => !(TEMPLATE_GROUPS as readonly string[]).includes(group)))]
    .map((group) => ({ group, items: templates.filter((item) => item.group === group) })).filter((entry) => entry.items.length) : [];
  const groupLabel = (group: string) => GROUP_LABELS[group] ? t(GROUP_LABELS[group]) : group;
  const copies = types.filter((type) => type.flowId);

  return <ControlledModalDialog isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }} size="lg" title={t("New enquiry type")}>
    <div className={styles.picker}>
      {error ? <Callout title={t("Not created")} tone="danger">{error}</Callout> : null}
      <div className={styles.typeFields}>
        <TextInput autoFocus errorMessage={missingName ? t("Give the enquiry type a name") : undefined} isDisabled={Boolean(busy)} isInvalid={missingName} isRequired
          label={t("Name")} maxLength={160} onChange={(value) => { setLabel(value); if (value.trim()) setMissingName(false); }} value={label} />
        <ColorSwatches isDisabled={Boolean(busy)} onChange={setColor} value={color} />
      </div>
      <h2 className={styles.startFrom}>{t("Start from")}</h2>
      {templates === undefined ? <Skeleton lines={4} /> : groups.map(({ group, items }) => <section aria-label={groupLabel(group)} className={styles.pickerGroup} key={group}>
        <h3 className={styles.pickerTitle}>{groupLabel(group)}</h3>
        <ul className={styles.options}>{items.map((item) => option({ id: `template:${item.key}`, body: { templateKey: item.key } }, item.name, <>
          {item.description ? <span className={styles.optionText}>{item.description}</span> : null}
          <span className={styles.optionMeta}>
            <span>{t("{count} steps", { count: item.stepCount })}</span>
            {item.suggestedEnquiryTypes.map((type) => <Tag key={type} tone="neutral">{type}</Tag>)}
          </span>
        </>))}</ul>
      </section>)}
      {copies.length ? <section aria-label={t("Copy steps from another type")} className={styles.pickerGroup}>
        <h3 className={styles.pickerTitle}>{t("Copy steps from another type")}</h3>
        <ul className={styles.options}>{copies.map((type) => option({ id: `type:${type.id}`, body: { copyFromTypeId: type.id } }, type.label,
          type.latest?.steps?.length ? <span className={styles.optionMeta}>{t("{count} steps", { count: type.latest.steps.length })}</span> : null,
          <TypeDot code={type.code} color={type.color ?? typeHue(type.code)} />))}</ul>
      </section> : null}
      <ul className={styles.options}>
        {option({ id: "blank", body: { blank: true } }, t("Blank"), <span className={styles.optionText}>{t("The fewest steps, to build up yourself")}</span>, <FilePlus2 aria-hidden="true" size={14} />)}
      </ul>
    </div>
  </ControlledModalDialog>;
}
