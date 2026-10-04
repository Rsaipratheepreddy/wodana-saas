"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Pencil, Plus } from "lucide-react";
import {
  Avatar, Button, ConfirmationDialog, EmptyState, ErrorState, FormDialog, IconMenuButton, NoAccessState, PageHeader, TextInput, formatDate, formatNumber,
  typeHue, useDesignSystem, useToast,
} from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import type { EnquiryTypeSummary, TypeColor } from "@/lib/flows/flow-model";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { ColorSwatches, TypeDot } from "./enquiry-type-colors";
import { NewEnquiryTypeDialog } from "./new-enquiry-type-dialog";
import styles from "./flows.module.css";

export { NewEnquiryTypeDialog } from "./new-enquiry-type-dialog";

type Editing = { type: EnquiryTypeSummary; action: "rename" | "color" | "archive" };

/** Enquiry types (plan §5a, F3): one card per type with a summary of its own steps, and a way to add a type. */
export function EnquiryTypesPage({ canManage, loadError = false, types: initial, workspaceId }: { canManage: boolean; loadError?: boolean; types: EnquiryTypeSummary[]; workspaceId: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { locale, timeZone } = useDesignSystem();
  const [types, setTypes] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<TypeColor>(1);
  const [archiving, setArchiving] = useState(false);

  if (!canManage) return <NoAccessState area={t("Enquiry types")} />;

  /** Saves a change to a type (version-checked); an archived type leaves the list. */
  async function save(type: EnquiryTypeSummary, change: { label?: string; color?: TypeColor; status?: "archived" }) {
    const saved = await crmRequest<EnquiryTypeSummary>(workspaceId, `enquiry-types/${type.id}`, "PATCH", { version: type.version, ...change });
    setTypes((current) => saved.status === "archived" ? current.filter((item) => item.id !== type.id)
      : current.map((item) => item.id === type.id ? { ...item, label: saved.label, color: saved.color, version: saved.version } : item));
    return saved;
  }

  function open(type: EnquiryTypeSummary, action: string) {
    setLabel(type.label);
    setColor(type.color ?? typeHue(type.code));
    setEditing({ type, action: action as Editing["action"] });
  }

  async function archive(type: EnquiryTypeSummary) {
    setArchiving(true);
    try {
      await save(type, { status: "archived" });
      toast.push({ tone: "success", title: t("Archived"), message: type.label });
      setEditing(null);
    } catch (error) {
      toast.push({ tone: "danger", title: t("Not saved"), message: translateKnown(t, error instanceof Error ? error.message : t("Please try again.")) });
    } finally {
      setArchiving(false);
    }
  }

  const action = <Button onPress={() => setCreating(true)} variant="primary"><Plus aria-hidden="true" size={16} />{t("New enquiry type")}</Button>;
  return <div className={styles.page}>
    <PageHeader actions={loadError ? undefined : action} title={t("Enquiry types")} />
    {loadError ? <ErrorState onRetry={() => router.refresh()} />
      : !types.length ? <EmptyState action={action} title={t("No enquiry types yet")} />
      : <ul aria-label={t("Enquiry types")} className={styles.flowCards}>{types.map((type) => {
        const steps = type.latest?.steps ?? [];
        const href = `/workspace/enquiry-types/${type.id}`;
        return <li className={styles.flowCard} key={type.id}>
          <div className={styles.cardTop}>
            <Link className={styles.flowHead} href={href}>
              <h2 className={styles.flowTitle}><TypeDot code={type.code} color={type.color} />{type.label}</h2>
              {steps.length ? <span className={styles.summary}>
                <span>{t("{count} steps", { count: steps.length })}</span><span aria-hidden="true">·</span>
                <span>{steps[0]}</span>{steps.length > 1 ? <><ArrowRight aria-label={t("to")} size={12} /><span>{steps.at(-1)}</span></> : null}
              </span> : null}
            </Link>
            <IconMenuButton ariaLabel={t("More actions for {name}", { name: type.label })} onAction={(id) => open(type, id)} items={[
              { id: "rename", label: t("Rename") }, { id: "color", label: t("Change colour") }, { id: "archive", label: t("Archive"), tone: "danger" },
            ]} />
          </div>
          <p className={styles.meta}>
            <span>{t("{count} running jobs", { count: formatNumber(type.runningJobs ?? 0, { locale }) })}</span>
            {type.latest ? <>
              <span className={styles.version}>{t("Version {version}", { version: type.latest.version })}</span>
              <span className={styles.published}>
                {type.latest.publishedBy ? <Avatar name={type.latest.publishedBy} seed={type.latest.publishedBy} size="sm" /> : null}
                {type.latest.source === "starter" ? t("Starter") : formatDate(type.latest.publishedAt, { locale, timeZone })}
              </span>
            </> : null}
          </p>
          <div className={styles.flowActions}>
            <Link className={`wd-button ${styles.editLink}`} data-size="compact" data-variant="quiet" href={href}><Pencil aria-hidden="true" size={14} />{t("Edit steps")}</Link>
          </div>
        </li>;
      })}</ul>}
    {loadError ? null : <p className={styles.footnote}>{t("Not sure yet — stays in New Opportunity until a type is chosen.")}</p>}
    {editing?.action === "rename" ? <FormDialog isDirty={label !== editing.type.label} onClose={() => setEditing(null)} submitLabel={t("Save")} title={t("Rename {name}", { name: editing.type.label })}
      onSubmit={async () => { await save(editing.type, { label: label.trim() }); setEditing(null); }} isSubmitDisabled={!label.trim()}>
      <TextInput isRequired label={t("Name")} maxLength={160} onChange={setLabel} value={label} />
    </FormDialog> : null}
    {editing?.action === "color" ? <FormDialog isDirty={color !== (editing.type.color ?? typeHue(editing.type.code))} onClose={() => setEditing(null)} submitLabel={t("Save")}
      title={t("Change colour of {name}", { name: editing.type.label })} onSubmit={async () => { await save(editing.type, { color }); setEditing(null); }}>
      <ColorSwatches onChange={setColor} value={color} />
    </FormDialog> : null}
    {editing?.action === "archive" ? <ConfirmationDialog body={t("New enquiries can no longer choose it. Its jobs and history stay.")} confirmLabel={t("Archive")}
      isConfirming={archiving} isOpen onConfirm={() => void archive(editing.type)} onOpenChange={(isOpen) => { if (!isOpen) setEditing(null); }}
      title={t("Archive {name}?", { name: editing.type.label })} /> : null}
    {creating ? <NewEnquiryTypeDialog onClose={() => setCreating(false)} types={types} workspaceId={workspaceId} /> : null}
  </div>;
}
