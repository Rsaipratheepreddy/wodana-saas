"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, InlineNotice, SelectField, SettingsRow, SettingsSection, Skeleton, Switch, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { crmRequest } from "@/lib/crm/client";
import { loadDesignSettings, quoteDesignFee, type DesignPackage } from "@/lib/design/packages";
import { useCrmResource } from "./crm-workbench";
import styles from "./opportunity-discovery.module.css";

type AreaUnit = "sqft" | "sqm";
type Facts = { area: string | null; areaUnit: AreaUnit | null; spaces: number | null; propertyLocation: string | null; clientEmail: string | null; floorPlanAssetId: string | null; designPackageId: string | null };
type Question = { key: string; label: string; required: boolean; dataType?: string; options?: Array<{ id: string; label: string }> };
export type DiscoveryView = {
  facts: Facts; designFee: { amount: string; currency: string } | null; package: { id: string; name: string } | null;
  enquiryType: string | null; clientType: string | null; questions: Question[]; answers: Record<string, unknown>;
  files: Array<{ id: string; name: string; mimeType: string }>; missing: Array<{ key: string; label: string }>; version: number;
};
type Draft = { area: string; areaUnit: AreaUnit; spaces: string; propertyLocation: string; clientEmail: string; floorPlanAssetId: string; designPackageId: string; answers: Record<string, unknown> };

const decimal = (value: string) => value.replace(/[^\d.]/g, "").replace(/^(\d*\.\d{0,2}).*$/, "$1");
const whole = (value: string) => value.replace(/\D/g, "").slice(0, 3);

function draftOf(view: DiscoveryView, fallbackUnit: AreaUnit): Draft {
  const facts = view.facts;
  return {
    area: facts.area ? String(Number(facts.area)) : "", areaUnit: facts.areaUnit ?? fallbackUnit, spaces: facts.spaces ? String(facts.spaces) : "",
    propertyLocation: facts.propertyLocation ?? "", clientEmail: facts.clientEmail ?? "", floorPlanAssetId: facts.floorPlanAssetId ?? "",
    designPackageId: facts.designPackageId ?? "", answers: { ...view.answers },
  };
}

/** Live fee from Business Core's pricing (exact decimals); null until the package has what it is priced on. */
function useFeePreview(workspaceId: string, pkg: DesignPackage | undefined, draft: Draft | null) {
  const [fee, setFee] = useState<{ key: string; amount: string; currency: string } | null>(null);
  const measure = !pkg || !draft ? null
    : pkg.pricingMethod === "fixed" ? {}
    : pkg.pricingMethod === "per_space" ? (draft.spaces ? { spaces: Number(draft.spaces) } : null)
    : draft.area ? { area: draft.area, areaUnit: draft.areaUnit } : null;
  const key = pkg && measure ? `${pkg.id}:${JSON.stringify(measure)}` : "";
  useEffect(() => {
    if (!pkg || !measure || pkg.status !== "active") return;
    const timer = window.setTimeout(() => { void quoteDesignFee(workspaceId, pkg.id, measure).then((quote) => setFee({ key, amount: quote.fee, currency: quote.currency })).catch(() => undefined); }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, key]);
  return fee?.key === key && key ? fee : null;
}

/** PLM-040: the discovery facts, design package and intro answers that the Design Quote stage requires. */
export function OpportunityDiscovery({ workspaceId, opportunityId, locale, onSaved }: { workspaceId: string; opportunityId: string; locale?: string; onSaved?: () => void | Promise<void> }) {
  const t = useT();
  const resource = useCrmResource<DiscoveryView>(workspaceId, `opportunities/${opportunityId}/discovery`);
  const [packages, setPackages] = useState<DesignPackage[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { void loadDesignSettings(workspaceId).then((settings) => setPackages(Array.isArray(settings?.packages) ? settings.packages : [])).catch(() => setPackages([])); }, [workspaceId]);
  // Only a well-formed discovery view is used; anything else waits or shows the error.
  const view = resource.data && typeof resource.data === "object" && "facts" in resource.data ? resource.data : undefined;
  const fallbackUnit: AreaUnit = packages.find((pkg) => pkg.status === "active" && pkg.areaUnit)?.areaUnit ?? "sqm";
  useEffect(() => { if (view) setDraft(draftOf(view, fallbackUnit)); }, [view, fallbackUnit]);

  const fee = useFeePreview(workspaceId, packages.find((item) => item.id === draft?.designPackageId), draft);
  const offered = useMemo(() => packages.filter((pkg) => pkg.status === "active" || pkg.id === view?.facts?.designPackageId), [packages, view?.facts?.designPackageId]);
  if (resource.failure) return <InlineNotice message={resource.failure} tone="error" />;
  if (!view || !draft) return <Skeleton lines={5} />;

  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const answer = (key: string) => (value: unknown) => setDraft((current) => current ? { ...current, answers: { ...current.answers, [key]: value } } : current);
  const pkg = packages.find((item) => item.id === draft.designPackageId);
  const money = (amount: string, currency: string) => { try { return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount as unknown as number); } catch { return `${currency} ${amount}`; } };
  const units = [{ id: "sqft", label: t("sq ft") }, { id: "sqm", label: t("sq m") }];
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(view, fallbackUnit));

  const missingLabel = (item: { key: string; label: string }) => ({ floorPlan: t("Floor plan"), area: t("Area"), clientEmail: t("Client email"), propertyLocation: t("Property location"), enquiryType: t("Enquiry type"), clientType: t("Client type"), spaces: t("Spaces") } as Record<string, string>)[item.key] ?? item.label;
  const save = async () => {
    setSaving(true); setFailure(""); setNotice("");
    try {
      await crmRequest(workspaceId, `opportunities/${opportunityId}/discovery`, "PUT", {
        version: view.version, area: draft.area || null, areaUnit: draft.area ? draft.areaUnit : null, spaces: draft.spaces ? Number(draft.spaces) : null,
        propertyLocation: draft.propertyLocation.trim() || null, clientEmail: draft.clientEmail.trim() || null,
        floorPlanAssetId: draft.floorPlanAssetId || null, designPackageId: draft.designPackageId || null, answers: draft.answers,
      });
      setNotice(t("Discovery saved."));
      resource.refresh();
      await onSaved?.();
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Discovery could not be saved.")); }
    finally { setSaving(false); }
  };

  return <div className={styles.discovery}>
    {view.missing.length
      ? <InlineNotice tone="info" message={<span className={styles.missing}>{t("Needed for Design Quote")}: {view.missing.map((item) => missingLabel(item)).join(", ")}</span>} />
      : <InlineNotice tone="success" message={t("Ready for Design Quote")} />}
    {failure ? <InlineNotice message={failure} tone="error" /> : null}
    {notice ? <InlineNotice message={notice} tone="success" /> : null}
    <SettingsSection id="discovery-property" title={t("Property")}>
      <SettingsRow label={t("Floor plan")}><div className={styles.control}>
        {view.files.length
          ? <SelectField aria-label={t("Floor plan")} items={view.files.map((file) => ({ id: file.id, label: file.name }))} label={null} onSelectionChange={(key) => set("floorPlanAssetId")(String(key ?? ""))} placeholder={t("Choose a file")} selectedKey={draft.floorPlanAssetId || null} />
          : <span className={styles.empty}>{t("Add the floor plan to the enquiry's files first.")}</span>}
      </div></SettingsRow>
      <SettingsRow label={t("Area")}><div className={styles.control}>
        <span className={styles.pair}>
          <TextInput aria-label={t("Area")} inputMode="decimal" label={null} onChange={(value) => set("area")(decimal(value))} value={draft.area} />
          <SelectField aria-label={t("Area unit")} accent="neutral" items={units} label={null} onSelectionChange={(key) => set("areaUnit")(String(key) as AreaUnit)} selectedKey={draft.areaUnit} />
        </span>
      </div></SettingsRow>
      {!pkg || pkg.pricingMethod === "per_space" || draft.spaces ? <SettingsRow label={t("Spaces")}><div className={styles.control}>
        <TextInput aria-label={t("Spaces")} inputMode="numeric" label={null} onChange={(value) => set("spaces")(whole(value))} value={draft.spaces} />
      </div></SettingsRow> : null}
      <SettingsRow label={t("Property location")}><div className={styles.control}>
        <TextInput aria-label={t("Property location")} label={null} maxLength={240} onChange={set("propertyLocation")} value={draft.propertyLocation} />
      </div></SettingsRow>
      <SettingsRow label={t("Client email")}><div className={styles.control}>
        <TextInput aria-label={t("Client email")} inputType="email" label={null} maxLength={254} onChange={set("clientEmail")} value={draft.clientEmail} />
      </div></SettingsRow>
    </SettingsSection>
    <SettingsSection id="discovery-package" title={t("Design package")}>
      <SettingsRow label={t("Package")}><div className={styles.control}>
        {offered.length
          ? <SelectField aria-label={t("Package")} items={offered.map((item) => ({ id: item.id, label: item.name }))} label={null} onSelectionChange={(key) => set("designPackageId")(String(key ?? ""))} placeholder={t("Choose a package")} selectedKey={draft.designPackageId || null} />
          : <span className={styles.empty}>{t("No design packages are offered yet.")}</span>}
      </div></SettingsRow>
      <SettingsRow label={t("Design fee")}><div className={styles.control}>
        {(() => { const shown = fee ?? (view.designFee && !dirty ? view.designFee : null); return <strong className={styles.fee} data-empty={!shown || undefined}>{shown ? money(shown.amount, shown.currency) : t("Not priced yet")}</strong>; })()}
      </div></SettingsRow>
    </SettingsSection>
    {view.questions.length ? <SettingsSection id="discovery-questions" title={t("Intro questions")}>
      {view.questions.map((question) => <SettingsRow key={question.key} label={<>{question.label}{question.required ? <span aria-hidden="true" className={styles.required}> *</span> : null}</>}><div className={styles.control}>
        <QuestionInput question={question} value={draft.answers[question.key]} onChange={answer(question.key)} />
      </div></SettingsRow>)}
    </SettingsSection> : null}
    <div className={styles.footer}>
      <Button isDisabled={!dirty} isLoading={saving} size="compact" variant="primary" onPress={() => void save()}>{t("Save")}</Button>
    </div>
  </div>;
}

function QuestionInput({ question, value, onChange }: { question: Question; value: unknown; onChange: (value: unknown) => void }) {
  const t = useT();
  if (question.options?.length) return <SelectField aria-label={question.label} items={question.options} label={null} onSelectionChange={(key) => onChange(key === null ? null : String(key))} placeholder={t("Choose")} selectedKey={typeof value === "string" ? value : null} />;
  if (question.dataType === "boolean") return <Switch aria-label={question.label} isSelected={value === true} onChange={onChange}>{value === true ? t("Yes") : t("No")}</Switch>;
  if (question.dataType === "number") return <TextInput aria-label={question.label} inputMode="decimal" label={null} onChange={(next) => onChange(next === "" ? null : decimal(next))} value={value === null || value === undefined ? "" : String(value)} />;
  if (question.dataType === "date") return <TextInput aria-label={question.label} inputType="date" label={null} onChange={(next) => onChange(next || null)} value={typeof value === "string" ? value : ""} />;
  return <TextInput aria-label={question.label} label={null} onChange={onChange} value={typeof value === "string" ? value : ""} />;
}
