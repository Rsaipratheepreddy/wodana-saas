"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseDate } from "@internationalized/date";
import { LocateFixed } from "lucide-react";
import { Button, DateField, FileUploader, InlineNotice, InspectorSheet, MoneyField, NumericInput, SelectField, Skeleton, Switch, TextInput } from "@/design-system";
import { OpenInMaps } from "@/components/ui/site-location";
import { parseMapLink, validCoordinates } from "@/lib/geo/map-link";
import { useCurrentPosition } from "@/lib/geo/use-current-position";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey } from "@/lib/i18n/keys";
import { crmRequest } from "@/lib/crm/client";
import { loadDesignSettings, quoteDesignFee, type DesignPackage } from "@/lib/design/packages";
import { useCrmResource } from "./crm-workbench";
import { useRequirementNotes } from "./requirement-notes";
import styles from "./opportunity-discovery.module.css";

type AreaUnit = "sqft" | "sqm";
type Facts = { area: string | null; areaUnit: AreaUnit | null; spaces: number | null; propertyLocation: string | null; clientEmail: string | null; floorPlanAssetId: string | null; designPackageId: string | null;
  /** The property's position (WGS 84 degrees): both or neither. */
  latitude: number | null; longitude: number | null;
  /** PLM-139: the rate agreed with the client on a package priced from its rate. */
  designRate?: string | null };
type Question = { key: string; label: string; required: boolean; dataType?: string; options?: Array<{ id: string; label: string }> };
type FileItem = { id: string; name: string; mimeType: string };
export type DiscoveryView = {
  facts: Facts; designFee: { amount: string; currency: string } | null; package: { id: string; name: string } | null;
  /** PLM-139: an agreed rate above the package's and where its approval stands. */
  designRate?: { requested: string; rate: string; approval: "pending" | "approved" | "rejected" | "returned"; waitingFor: string[] } | null;
  enquiryType: string | null; clientType: string | null; questions: Question[]; answers: Record<string, unknown>;
  files: FileItem[]; missing: Array<{ key: string; label: string }>; version: number;
};
/** Latitude and longitude are NaN while empty (the number field's empty value). */
type Draft = { area: string; areaUnit: AreaUnit; spaces: string; propertyLocation: string; latitude: number; longitude: number; clientEmail: string; floorPlanAssetId: string; designPackageId: string; designRate: string; answers: Record<string, unknown> };
/** The parts of discovery a side sheet edits. */
export type DiscoveryGroup = "property" | "package" | "questions";

export const DISCOVERY_TITLES: Record<DiscoveryGroup, MessageKey> = {
  property: tKey("Property details"), package: tKey("Design package"), questions: tKey("Intro questions"),
};

const decimal = (value: string) => value.replace(/[^\d.]/g, "").replace(/^(\d*\.\d{0,2}).*$/, "$1");
const whole = (value: string) => value.replace(/\D/g, "").slice(0, 3);

function draftOf(view: DiscoveryView, fallbackUnit: AreaUnit): Draft {
  const facts = view.facts;
  return {
    area: facts.area ? String(Number(facts.area)) : "", areaUnit: facts.areaUnit ?? fallbackUnit, spaces: facts.spaces ? String(facts.spaces) : "",
    propertyLocation: facts.propertyLocation ?? "", latitude: facts.latitude ?? Number.NaN, longitude: facts.longitude ?? Number.NaN, clientEmail: facts.clientEmail ?? "", floorPlanAssetId: facts.floorPlanAssetId ?? "",
    designPackageId: facts.designPackageId ?? "", designRate: facts.designRate ? String(Number(facts.designRate)) : "", answers: { ...view.answers },
  };
}

/** An answer counts once it holds something. */
export function answered(value: unknown) {
  return !(value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length));
}

/** PLM-040: the discovery facts, the design packages on offer and the unit areas default to. */
export function useDiscovery(workspaceId: string, opportunityId: string) {
  const resource = useCrmResource<DiscoveryView>(workspaceId, `opportunities/${opportunityId}/discovery`);
  const [packages, setPackages] = useState<DesignPackage[]>([]);
  useEffect(() => { void loadDesignSettings(workspaceId).then((settings) => setPackages(Array.isArray(settings?.packages) ? settings.packages : [])).catch(() => setPackages([])); }, [workspaceId]);
  // Only a well-formed discovery view is used; anything else waits or shows the error.
  const view = resource.data && typeof resource.data === "object" && "facts" in resource.data ? resource.data : undefined;
  const fallbackUnit: AreaUnit = packages.find((pkg) => pkg.status === "active" && pkg.areaUnit)?.areaUnit ?? "sqm";
  return { view, failure: resource.failure, refresh: resource.refresh, packages, fallbackUnit };
}
export type Discovery = ReturnType<typeof useDiscovery>;

/** Live fee from Business Core's pricing (exact decimals); null until the package has what it is priced on. */
function useFeePreview(workspaceId: string, pkg: DesignPackage | undefined, draft: Draft | null) {
  const [fee, setFee] = useState<{ key: string; amount: string; currency: string } | null>(null);
  // PLM-139: on a package priced from its rate, the fee at the rate agreed with the client.
  const rate = pkg?.rateFrom && draft?.designRate ? { rate: draft.designRate } : {};
  const measure = !pkg || !draft ? null
    : pkg.pricingMethod === "fixed" ? { ...rate }
    : pkg.pricingMethod === "per_space" ? (draft.spaces ? { spaces: Number(draft.spaces), ...rate } : null)
    : draft.area ? { area: draft.area, areaUnit: draft.areaUnit, ...rate } : null;
  const key = pkg && measure ? `${pkg.id}:${JSON.stringify(measure)}` : "";
  useEffect(() => {
    if (!pkg || !measure || pkg.status !== "active") return;
    const timer = window.setTimeout(() => { void quoteDesignFee(workspaceId, pkg.id, measure).then((quote) => setFee({ key, amount: quote.fee, currency: quote.currency })).catch(() => undefined); }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, key]);
  return fee?.key === key && key ? fee : null;
}

export function formatMoney(amount: string, currency: string, locale?: string) {
  try { return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount as unknown as number); } catch { return `${currency} ${amount}`; }
}

/**
 * One part of discovery in a side sheet: the property details (with the floor plan uploaded straight into the
 * enquiry's files), the design package and fee, or the intro questions. Save closes it.
 */
export function DiscoverySheet({ workspaceId, opportunityId, leadId, group, discovery, locale, focus, onClose, onSaved }: {
  workspaceId: string; opportunityId: string; leadId: string | null; group: DiscoveryGroup; discovery: Discovery; locale?: string;
  /** The requirement that opened the sheet: its field takes focus. */
  focus?: string;
  onClose: () => void; onSaved?: () => void | Promise<void>;
}) {
  const t = useT();
  const { view, packages, fallbackUnit } = discovery;
  const [draft, setDraft] = useState<Draft | null>(() => view ? draftOf(view, fallbackUnit) : null);
  const [added, setAdded] = useState<FileItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState("");
  const notes = useRequirementNotes({ workspaceId, leadId: leadId ?? undefined }, false);
  const position = useCurrentPosition();
  const [mapLink, setMapLink] = useState("");
  useEffect(() => { if (view && !draft) setDraft(draftOf(view, fallbackUnit)); }, [view, draft, fallbackUnit]);
  const fee = useFeePreview(workspaceId, packages.find((item) => item.id === draft?.designPackageId), draft);
  const offered = useMemo(() => packages.filter((pkg) => pkg.status === "active" || pkg.id === view?.facts?.designPackageId), [packages, view?.facts?.designPackageId]);
  const dirty = Boolean(view && draft && JSON.stringify(draft) !== JSON.stringify(draftOf(view, fallbackUnit)));

  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  // A map link is read once it is complete: pasted, or when the field is left or Enter pressed. Never while it is being
  // typed: a link typed key by key passes through "…/@25.2,5" on its way to "…/@25.2,55.27" (a wrong longitude).
  // A link with coordinates fills them and clears itself; one without stays, marked.
  const [linkUnread, setLinkUnread] = useState(false);
  const pasted = useRef(false);
  const readLink = (value: string) => {
    const found = value.trim() ? parseMapLink(value) : null;
    if (found) { setDraft((current) => current ? { ...current, ...found } : current); setMapLink(""); }
    setLinkUnread(Boolean(value.trim()) && !found);
  };
  const typeLink = (value: string) => {
    setMapLink(value); setLinkUnread(false);
    if (pasted.current) { pasted.current = false; readLink(value); }
  };
  const locate = () => position.locate((fix) => setDraft((current) => current ? { ...current, ...fix } : current));
  const answer = (key: string) => (value: unknown) => setDraft((current) => current ? { ...current, answers: { ...current.answers, [key]: value } } : current);

  // The floor plan goes into the enquiry's files as its own note, then is chosen here.
  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file || !leadId) return;
    setUploading(true); setFailure("");
    try {
      const noteId = crypto.randomUUID();
      const asset = await notes.upload(noteId, file, crypto.randomUUID());
      await notes.save({ id: noteId, version: 0, title: t("Floor plan"), note: "", archived: false, pinned: false, assets: [asset], links: [] });
      setAdded((current) => [...current, { id: asset.id, name: asset.name, mimeType: asset.mimeType }]);
      set("floorPlanAssetId")(asset.id);
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Upload failed.")); }
    finally { setUploading(false); }
  };

  const hasLatitude = Number.isFinite(draft?.latitude), hasLongitude = Number.isFinite(draft?.longitude);
  const located = Boolean(draft && validCoordinates(draft.latitude, draft.longitude));
  // Both or neither: a half-entered position blocks the save.
  const positionValid = located || (!hasLatitude && !hasLongitude);
  const save = async () => {
    if (!view || !draft || !positionValid) return;
    setSaving(true); setFailure("");
    try {
      await crmRequest(workspaceId, `opportunities/${opportunityId}/discovery`, "PUT", {
        version: view.version, area: draft.area || null, areaUnit: draft.area ? draft.areaUnit : null, spaces: draft.spaces ? Number(draft.spaces) : null,
        propertyLocation: draft.propertyLocation.trim() || null,
        latitude: located ? draft.latitude : null, longitude: located ? draft.longitude : null, clientEmail: draft.clientEmail.trim() || null,
        floorPlanAssetId: draft.floorPlanAssetId || null, designPackageId: draft.designPackageId || null, answers: draft.answers,
        designRate: pkg?.rateFrom && draft.designRate ? Number(draft.designRate).toFixed(2) : null,
      });
      discovery.refresh();
      await onSaved?.();
      onClose();
    } catch (error) { setFailure(error instanceof Error ? translateKnown(t, error.message) : t("Discovery could not be saved.")); }
    finally { setSaving(false); }
  };

  const units = [{ id: "sqft", label: t("sq ft") }, { id: "sqm", label: t("sq m") }];
  const wanted = (focus ?? "").replace(/^discovery:/, "");
  const first = (field: string) => wanted === field || (field === "area" && wanted === "floorPlanOrArea") || undefined;
  const pkg = packages.find((item) => item.id === draft?.designPackageId);
  const files = [...(view?.files ?? []), ...added.filter((file) => !view?.files.some((item) => item.id === file.id))];
  const footer = <div className="wd-dialog-actions">
    <Button variant="quiet" onPress={onClose}>{t("Cancel")}</Button>
    <Button isDisabled={!dirty || uploading || !positionValid} isLoading={saving} variant="primary" onPress={() => void save()}>{t("Save")}</Button>
  </div>;
  return <InspectorSheet isOpen isDirty={dirty && !saving} size="sm" title={t(DISCOVERY_TITLES[group])} onOpenChange={(open) => { if (!open) onClose(); }} footer={footer}>
    {failure ? <InlineNotice message={failure} tone="error" /> : null}
    {discovery.failure ? <InlineNotice message={discovery.failure} tone="error" />
      : !view || !draft ? <Skeleton lines={5} shape="facts" />
      : <div className={styles.fields}>
        {group === "property" ? <>
          <div className={styles.field}>
            {files.length ? <SelectField items={files.map((file) => ({ id: file.id, label: file.name }))} label={t("Floor plan")} onSelectionChange={(key) => set("floorPlanAssetId")(String(key ?? ""))} placeholder={t("Choose a file")} selectedKey={draft.floorPlanAssetId || null} />
              : <span className={styles.label}>{t("Floor plan")}</span>}
            {leadId ? <FileUploader accept="image/*,application/pdf" appearance="button" label={uploading ? t("Uploading…") : t("Upload floor plan")} multiple={false} onFiles={(picked) => void upload(picked)} /> : null}
          </div>
          <div className={styles.pair}>
            <TextInput autoFocus={first("area")} inputMode="decimal" label={t("Area")} onChange={(value) => set("area")(decimal(value))} value={draft.area} />
            <SelectField accent="neutral" items={units} label={t("Area unit")} onSelectionChange={(key) => set("areaUnit")(String(key) as AreaUnit)} selectedKey={draft.areaUnit} />
          </div>
          {!pkg || pkg.pricingMethod === "per_space" || draft.spaces ? <TextInput autoFocus={first("spaces")} inputMode="numeric" label={t("Spaces")} onChange={(value) => set("spaces")(whole(value))} value={draft.spaces} /> : null}
          <TextInput autoFocus={first("propertyLocation")} label={t("Property location")} maxLength={240} onChange={set("propertyLocation")} value={draft.propertyLocation} />
          <div className={styles.coordinates}>
            <NumericInput label={t("Latitude")} minValue={-90} maxValue={90} formatOptions={{ maximumFractionDigits: 7 }} value={draft.latitude} onChange={set("latitude")}
              isInvalid={!hasLatitude && hasLongitude} errorMessage={t("Enter both latitude and longitude")} />
            <NumericInput label={t("Longitude")} minValue={-180} maxValue={180} formatOptions={{ maximumFractionDigits: 7 }} value={draft.longitude} onChange={set("longitude")}
              isInvalid={hasLatitude && !hasLongitude} errorMessage={t("Enter both latitude and longitude")} />
          </div>
          <TextInput label={t("Paste a Google Maps link")} inputType="url" value={mapLink} onChange={typeLink} onPaste={() => { pasted.current = true; }}
            onBlur={() => readLink(mapLink)} onKeyDown={(event) => { if (event.key === "Enter") readLink(mapLink); }}
            isInvalid={linkUnread} errorMessage={t("No coordinates in this link")} />
          <div className={styles.locate}>
            <Button size="compact" isLoading={position.locating} onPress={locate}><LocateFixed aria-hidden="true" size={14} />{t("Use my current location")}</Button>
            {located ? <OpenInMaps latitude={draft.latitude} longitude={draft.longitude} /> : null}
          </div>
          {position.failed ? <InlineNotice tone="error" message={t("Location unavailable")} /> : null}
          <TextInput autoFocus={first("clientEmail")} inputType="email" label={t("Client email")} maxLength={254} onChange={set("clientEmail")} value={draft.clientEmail} />
        </> : null}
        {group === "package" ? <>
          {offered.length
            ? <SelectField items={offered.map((item) => ({ id: item.id, label: item.name }))} label={t("Package")} onSelectionChange={(key) => set("designPackageId")(String(key ?? ""))} placeholder={t("Choose a package")} selectedKey={draft.designPackageId || null} />
            : <p className={styles.empty}>{t("No design packages are offered yet.")}</p>}
          {pkg?.unitDefinition ? <p className={styles.empty}>{pkg.unitDefinition}</p> : null}
          {pkg?.rateFrom ? <>
            <MoneyField currency={pkg.currency} description={t("Above {rate}, it is approved before the fee uses it.", { rate: formatMoney(pkg.rate, pkg.currency, locale) })} label={t("Agreed rate")} min="0"
              onChange={(next) => set("designRate")(decimal(next))} value={draft.designRate} />
            {view.designRate && !dirty ? <InlineNotice tone={view.designRate.approval === "approved" ? "success" : view.designRate.approval === "pending" ? "info" : "error"}
              message={view.designRate.approval === "approved" ? t("Rate approved") : view.designRate.approval === "pending"
                ? (view.designRate.waitingFor.length ? t("Rate waiting for {names}", { names: view.designRate.waitingFor.join(", ") }) : t("Rate waiting for approval")) : t("Rate not approved. Change it or agree the package rate.")} /> : null}
          </> : null}
          <div className={styles.field}>
            <span className={styles.label}>{t("Design fee")}</span>
            {(() => { const shown = fee ?? (view.designFee && !dirty ? view.designFee : null); return <strong className={styles.fee} data-empty={!shown || undefined}>{shown ? formatMoney(shown.amount, shown.currency, locale) : t("Not priced yet")}</strong>; })()}
          </div>
        </> : null}
        {group === "questions" ? view.questions.map((question) => <QuestionInput key={question.key} question={question} value={draft.answers[question.key]} onChange={answer(question.key)} />) : null}
      </div>}
  </InspectorSheet>;
}

function QuestionInput({ question, value, onChange }: { question: Question; value: unknown; onChange: (value: unknown) => void }) {
  const t = useT();
  const common = { isRequired: question.required, label: question.label };
  if (question.options?.length) return <SelectField {...common} items={question.options} onSelectionChange={(key) => onChange(key === null ? null : String(key))} placeholder={t("Choose")} selectedKey={typeof value === "string" ? value : null} />;
  if (question.dataType === "boolean") return <Switch isSelected={value === true} onChange={onChange}>{question.label}</Switch>;
  if (question.dataType === "number") return <TextInput {...common} inputMode="decimal" onChange={(next) => onChange(next === "" ? null : decimal(next))} value={value === null || value === undefined ? "" : String(value)} />;
  if (question.dataType === "date") return <DateField {...common} onChange={(next) => onChange(next ? next.toString() : null)} value={typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? parseDate(value.slice(0, 10)) : null} />;
  return <TextInput {...common} onChange={onChange} value={typeof value === "string" ? value : ""} />;
}
