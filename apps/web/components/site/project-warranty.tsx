"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseDate } from "@internationalized/date";
import { Plus } from "lucide-react";
import { Button, ControlledModalDialog, DateField, EmptyState, ErrorState, InlineNotice, SegmentedControl, SelectField, SettingsSection, Skeleton, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { createVariation } from "@/lib/project-core/variations";
import { siteApi, warrantySettingsApi } from "@/lib/site/client";
import type { Supply, WarrantyClaim, WarrantyItem, WarrantySettings, WarrantyState } from "@/lib/site/types";
import { useProjectFormat } from "../project-core/format";
import styles from "./site.module.css";

type Decision = "covered" | "not_covered" | "chargeable";

/**
 * A project's warranty: each item's cover (from the handover it was accepted in) and the client's claims,
 * decided as covered (a warranty snag to fix), not covered or chargeable.
 */
export function ProjectWarranty({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => siteApi(workspaceId, projectId), [workspaceId, projectId]);
  const [state, setState] = useState<WarrantyState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<{ kind: "claim" } | { kind: "decide"; claim: WarrantyClaim } | { kind: "months"; item: WarrantyItem } | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const router = useRouter();
  const load = useCallback(async () => {
    try { setState(await api.warranty()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The warranty didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const run = async (action: string, input: Record<string, unknown> = {}) => {
    setNotice("");
    try { setState(await api.warrantyCommand(action, input)); return true; }
    catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return false;
    }
  };
  /** A chargeable claim goes on as a draft variation of the accepted quotation, linked to the claim, opened in the builder. */
  const charge = async (claim: WarrantyClaim) => {
    if (!state?.caseId || !state.baselineQuoteId) return;
    setStarting(claim.id); setNotice("");
    try {
      const quoteId = await createVariation(workspaceId, state.caseId, state.baselineQuoteId);
      if (await run("link_variation", { claimId: claim.id, quoteId, version: claim.version })) router.push(`/workspace/projects/${projectId}/changes/${quoteId}`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not start a variation.")); }
    setStarting(null);
  };
  const variationStatus = (status: string | null | undefined) => status === "accepted" ? t("Accepted") : status === "issued" || status === "sent" ? t("With the client")
    : status === "declined" ? t("Declined") : t("Draft");
  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={6} shape="rows" />;
  const statusLabel = { open: t("To decide"), covered: t("Covered"), not_covered: t("Not covered"), chargeable: t("Chargeable") };
  const channels = { phone: t("By phone"), email: t("By email"), visit: t("On a visit"), message: t("By message"), portal: t("In the portal") };

  return <div className={styles.site}>
    <div className={styles.toolbar}>
      <span className={styles.muted}>{state.items.length ? t("{active} of {count} items under warranty", { active: state.items.filter((item) => item.active).length, count: state.items.length })
        : t("The warranty starts when the client accepts the handover.")}</span>
      <span className={styles.spacer} />
      {state.canRecord ? <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "claim" })}><Plus aria-hidden="true" size={14} />{t("Record a claim")}</Button> : null}
    </div>
    {notice ? <InlineNotice tone="error" message={notice} /> : null}
    <section className={styles.stack} aria-label={t("Claims")}>
      <h3 className={styles.subhead}>{t("Claims")}</h3>
      {!state.claims.length ? <EmptyState illustration={null} title={t("No claims")} /> : <ul className={styles.reports}>{state.claims.map((claim) => <li key={claim.id} className={styles.report}>
        <div className={styles.reportHead}>
          <strong>{t("Claim {number}", { number: claim.number })}</strong>
          <span className={styles.muted}>{[format.day(claim.raisedOn), claim.raisedByName, channels[claim.channel], claim.lineTitle].filter(Boolean).join(" · ")}</span>
          <span className={styles.status} data-status={claim.status === "open" ? "submitted" : claim.status === "covered" ? "approved" : "returned"}>{statusLabel[claim.status]}</span>
          <span className={styles.spacer} />
          {claim.status === "open" && state.canManage ? <Button size="compact" onPress={() => setDialog({ kind: "decide", claim })}>{t("Decide")}</Button> : null}
        </div>
        <p className={styles.body}>{claim.description}</p>
        {claim.decisionNote ? <span className={styles.muted}>{t("{name}: {note}", { name: claim.decidedByName ?? "", note: claim.decisionNote })}</span> : null}
        {claim.status === "chargeable" && claim.variationId ? <Link href={`/workspace/projects/${projectId}/changes/${claim.variationId}`} className={styles.link}>
          {claim.variationApplied ? t("Charged as {label}", { label: claim.variationApplied }) : t("Variation V{number} · {status}", { number: claim.variationNumber ?? 0, status: variationStatus(claim.variationStatus) })}</Link>
          : claim.status === "chargeable" && state.canManage && state.caseId && state.baselineQuoteId ? <span><Button size="compact" isLoading={starting === claim.id} onPress={() => void charge(claim)}>{t("Start variation")}</Button></span> : null}
        {claim.snagId ? <Link href={`/workspace/projects/${projectId}/plan?item=${claim.snagId}`} className={styles.link}>
          {t("Snag #{number} · {status}", { number: claim.snagNumber ?? 0, status: claim.snagStatus === "done" ? t("Fixed") : t("Open") })}</Link> : null}
      </li>)}</ul>}
    </section>
    {state.items.length ? <section className={styles.stack} aria-label={t("Cover")}>
      <h3 className={styles.subhead}>{t("Cover")}</h3>
      <ul className={styles.facts}>{state.items.map((item) => <li key={item.lineId} className={styles.document}>
        <span>{[item.title, item.areaName].filter(Boolean).join(" · ")}</span>
        <span className={item.active ? styles.muted : styles.alert}>{item.months === 0 ? t("Not covered")
          : item.active ? t("Until {date}", { date: format.day(item.endsOn) }) : t("Ended {date}", { date: format.day(item.endsOn) })}</span>
        {state.canManage ? <Button size="compact" variant="quiet" onPress={() => setDialog({ kind: "months", item })}>{t("Change")}</Button> : null}
      </li>)}</ul>
    </section> : null}

    {dialog?.kind === "claim" ? <ClaimDialog state={state} channels={channels} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("record_claim", { id: crypto.randomUUID(), ...input })) setDialog(null); }} /> : null}
    {dialog?.kind === "decide" ? <DecideDialog claim={dialog.claim} item={state.items.find((item) => item.lineId === dialog.claim.lineId) ?? null} onClose={() => setDialog(null)}
      onSave={async (input) => { if (await run("decide_claim", { claimId: dialog.claim.id, version: dialog.claim.version, ...input })) setDialog(null); }} /> : null}
    {dialog?.kind === "months" ? <MonthsDialog item={dialog.item} onClose={() => setDialog(null)}
      onSave={async (months, reason) => { if (await run("set_months", { lineId: dialog.item.lineId, months, reason })) setDialog(null); }} /> : null}
  </div>;
}

function ClaimDialog({ state, channels, onClose, onSave }: {
  state: WarrantyState; channels: Record<WarrantyClaim["channel"], string>; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const [raisedOn, setRaisedOn] = useState(state.today);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<WarrantyClaim["channel"]>("phone");
  const [description, setDescription] = useState("");
  const [lineId, setLineId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Record a claim")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!name.trim() || !description.trim()} onPress={async () => {
        setBusy(true); await onSave({ raisedOn, raisedByName: name.trim(), channel, description: description.trim(), boqLineId: lineId || null, areaId: areaId || null }); setBusy(false);
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <div className={styles.pair}>
        <DateField label={t("Day")} isRequired value={parseDate(raisedOn)} onChange={(value) => setRaisedOn(value ? value.toString() : state.today)} />
        <SelectField label={t("How it came in")} selectedKey={channel} onSelectionChange={(key) => setChannel((key ?? "phone") as WarrantyClaim["channel"])}
          items={(Object.keys(channels) as Array<WarrantyClaim["channel"]>).map((id) => ({ id, label: channels[id] }))} />
      </div>
      <TextInput label={t("Who raised it")} isRequired value={name} onChange={setName} />
      <TextAreaField label={t("What's wrong")} isRequired value={description} onChange={setDescription} />
      <div className={styles.pair}>
        <SelectField label={t("Item")} placeholder={t("Choose")} selectedKey={lineId} onSelectionChange={(key) => setLineId(key ? String(key) : "")}
          items={state.lines.map((line) => ({ id: line.id, label: line.title }))} />
        {state.areas.length ? <SelectField label={t("Area")} placeholder={t("Choose")} selectedKey={areaId} onSelectionChange={(key) => setAreaId(key ? String(key) : "")}
          items={state.areas.map((area) => ({ id: area.id, label: area.name }))} /> : <span />}
      </div>
    </div>
  </ControlledModalDialog>;
}

/** Covered becomes a warranty snag (outside its item's cover only with why); not covered or chargeable say why. */
function DecideDialog({ claim, item, onClose, onSave }: { claim: WarrantyClaim; item: WarrantyItem | null; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const format = useProjectFormat();
  const inside = Boolean(item && item.months > 0 && item.startsOn <= claim.raisedOn && claim.raisedOn <= item.endsOn);
  const [decision, setDecision] = useState<Decision>(inside ? "covered" : "not_covered");
  const [severity, setSeverity] = useState<"minor" | "major" | "critical">("major");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const needsNote = decision !== "covered" || !inside;
  return <ControlledModalDialog isOpen size="md" title={t("Claim {number}", { number: claim.number })} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={needsNote && !note.trim()} onPress={async () => { setBusy(true); await onSave({ decision, note: note.trim(), severity }); setBusy(false); }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <span className={styles.muted}>{item ? item.months === 0 ? t("{item} isn't covered.", { item: item.title })
        : t("{item} is covered from {from} to {to}.", { item: item.title, from: format.day(item.startsOn), to: format.day(item.endsOn) }) : t("No item chosen.")}</span>
      <SegmentedControl label={t("Decision")} value={decision} onChange={(value) => setDecision(value as Decision)}
        options={[{ id: "covered", label: t("Covered") }, { id: "not_covered", label: t("Not covered") }, { id: "chargeable", label: t("Chargeable") }]} />
      {decision === "covered" ? <SelectField label={t("Severity")} selectedKey={severity} onSelectionChange={(key) => setSeverity((key ?? "major") as typeof severity)}
        items={[{ id: "minor", label: t("Minor") }, { id: "major", label: t("Major") }, { id: "critical", label: t("Critical") }]} /> : null}
      <TextAreaField label={decision === "covered" ? (inside ? t("Note") : t("Why it's covered anyway")) : decision === "chargeable" ? t("What the client will be charged for") : t("Why it isn't covered")}
        isRequired={needsNote} value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}

function MonthsDialog({ item, onClose, onSave }: { item: WarrantyItem; onClose: () => void; onSave: (months: number, reason: string) => Promise<void> }) {
  const t = useT();
  const [months, setMonths] = useState(String(item.months));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^\d{1,3}$/.test(months) && Number(months) <= 600 && reason.trim();
  return <ControlledModalDialog isOpen size="md" title={item.title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => { setBusy(true); await onSave(Number(months), reason.trim()); setBusy(false); }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("Months of warranty")} isRequired inputMode="numeric" value={months} onChange={(value) => setMonths(value.replace(/\D/g, "").slice(0, 3))} />
      <TextAreaField label={t("Why it changes")} isRequired value={reason} onChange={setReason} />
    </div>
  </ControlledModalDialog>;
}

/** Settings → Projects → Warranty: months for each way of delivering a package; applies to handovers from now on. */
export function WarrantySettingsSection({ workspaceId, supplies }: { workspaceId: string; supplies: Record<Supply, string> }) {
  const t = useT();
  const api = useMemo(() => warrantySettingsApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<WarrantySettings | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const accept = (next: WarrantySettings) => { setData(next); setForm(Object.fromEntries(Object.entries(next.months).map(([key, value]) => [key, String(value)]))); };
  const load = useCallback(async () => {
    try { accept(await api.get()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (!data) return error ? <InlineNotice tone="error" message={error} /> : <Skeleton lines={4} shape="rows" />;
  return <SettingsSection id="warranty" title={t("Warranty")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <div className={styles.months}>{(Object.keys(supplies) as Supply[]).map((supply) => <TextInput key={supply} label={supplies[supply]} inputMode="numeric" suffix={t("months")}
      isReadOnly={!data.canManage} value={form[supply] ?? ""} onChange={(value) => setForm({ ...form, [supply]: value.replace(/\D/g, "").slice(0, 3) })} />)}</div>
    {data.canManage ? <div className={styles.actions}><Button variant="primary" isLoading={busy} onPress={async () => {
      setBusy(true); setError("");
      try { accept(await api.save(Object.fromEntries(Object.entries(form).map(([key, value]) => [key, Number(value || "0")])))); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
      setBusy(false);
    }}>{t("Save")}</Button></div> : null}
  </SettingsSection>;
}
