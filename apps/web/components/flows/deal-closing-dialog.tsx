"use client";

import { useEffect, useState } from "react";
import { FormDialog, SelectField, Skeleton, TextInput } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { FURNITURE_PATHS } from "@/lib/crm/opportunity-flow";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

type Rule = { furniturePath: string | null; closingEvent: string; version: number };
type ClosingView = { flowId: string; events: string[]; furniturePaths: string[]; rules: Rule[] };

export const CLOSING_EVENT_LABEL: Record<string, MessageKey> = {
  collected: tKey("Collected by the client"),
  delivered: tKey("Delivered"),
  collected_or_delivered: tKey("Collected or delivered"),
  design_handover: tKey("Design handover"),
  all_produced_delivered_installed: tKey("Everything produced, delivered and installed"),
  completion_handover: tKey("Signed completion and handover"),
};

/**
 * PLM-102: what closes a deal of this enquiry type — one event, or one per furniture path (A–E). Configuration;
 * Deal Closed itself is read from the records.
 */
export function DealClosingDialog({ workspaceId, flowId, typeName, onClose }: { workspaceId: string; flowId: string; typeName: string; onClose: () => void }) {
  const t = useT();
  const [view, setView] = useState<ClosingView | null>(null);
  const [failure, setFailure] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    crmRequest<ClosingView>(workspaceId, `flows/${flowId}/closing`, "GET", undefined, controller.signal).then((next) => {
      setView(next);
      setDraft(Object.fromEntries(next.rules.map((rule) => [rule.furniturePath ?? "", rule.closingEvent])));
    }).catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [workspaceId, flowId]);
  const initial = view ? JSON.stringify(Object.fromEntries(view.rules.map((rule) => [rule.furniturePath ?? "", rule.closingEvent]))) : "";
  const events = (view?.events ?? []).map((id) => ({ id, label: t(CLOSING_EVENT_LABEL[id] ?? tKey("Delivered")) }));
  const pathItems = [{ id: "", label: t("Same as the type") }, ...events];
  return <FormDialog size="md" title={t("Deal closed when")} description={typeName} submitLabel={t("Save")} error={failure || undefined} isDirty={Boolean(view) && JSON.stringify(draft) !== initial}
    isSubmitDisabled={!view || !draft[""]} onClose={onClose} onSubmit={async () => {
      const rules = Object.entries(draft).filter(([, event]) => event).map(([path, closingEvent]) => ({ furniturePath: path || null, closingEvent }));
      await crmRequest(workspaceId, `flows/${flowId}/closing`, "PUT", { rules, versions: view!.rules.map((rule) => `${rule.furniturePath ?? ""}:${rule.version}`).join(",") });
      onClose();
    }}>
    {!view ? (failure ? null : <Skeleton lines={3} shape="form" />) : <>
      <SelectField isRequired label={t("This type")} selectedKey={draft[""] ?? null} onSelectionChange={(key) => setDraft({ ...draft, "": String(key) })} items={events} />
      {view.furniturePaths.map((path) => {
        const choice = FURNITURE_PATHS.find((item) => item.id === path);
        return <SelectField key={path} label={choice ? `${choice.letter} · ${t(choice.label)}` : path} selectedKey={draft[path] ?? ""}
          onSelectionChange={(key) => setDraft({ ...draft, [path]: String(key ?? "") })} items={pathItems} />;
      })}
    </>}
  </FormDialog>;
}

/** PLM-099: the prefix new opportunity references take (O- by default); references already given keep theirs. */
export function ReferencePrefixDialog({ workspaceId, onClose, onSaved }: { workspaceId: string; onClose: () => void; onSaved: (prefix: string) => void }) {
  const t = useT();
  const [settings, setSettings] = useState<{ version: number; opportunityReferencePrefix?: string } | null>(null);
  const [prefix, setPrefix] = useState("");
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    crmRequest<{ version: number; opportunityReferencePrefix?: string }>(workspaceId, "sales-settings", "GET", undefined, controller.signal)
      .then((next) => { setSettings(next); setPrefix(next.opportunityReferencePrefix ?? "O-"); }).catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [workspaceId]);
  const valid = /^[A-Z][A-Z0-9]{0,5}-?$/.test(prefix);
  return <FormDialog size="md" title={t("Opportunity numbers")} submitLabel={t("Save")} error={failure || undefined} isDirty={Boolean(settings) && prefix !== (settings?.opportunityReferencePrefix ?? "O-")}
    isSubmitDisabled={!settings || !valid} onClose={onClose} onSubmit={async () => {
      await crmRequest(workspaceId, "sales-settings", "PATCH", { version: settings!.version, opportunityReferencePrefix: prefix });
      onSaved(prefix); onClose();
    }}>
    <TextInput autoFocus isRequired label={t("Prefix")} value={prefix} maxLength={7} onChange={(value) => setPrefix(value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
      description={t("For example {reference}", { reference: `${prefix || "O-"}0001` })} errorMessage={valid ? undefined : t("Capital letters and digits, for example O-")} />
  </FormDialog>;
}
