"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { Badge, Button, DataGrid, FormDialog, InlineNotice, MoneyField, MoreDetails, SaveBar, SelectField, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextAreaField, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { loadDesignSettings, saveDesignPackage, saveDesignTimings, saveMinimumDeposit, setDesignPackageStatus, type DesignPackage, type DesignSettings, type PricingMethod } from "@/lib/design/packages";
import styles from "./design-packages-settings.module.css";

const amount = (value: string) => value.replace(/[^\d.]/g, "");
const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/** PLM-041: the design package price list and the minimum design deposit. Owners and admins edit; others read. */
export function DesignPackagesSettings({ workspaceId, currency, locale, canManage }: { workspaceId: string; currency: string; locale?: string; canManage: boolean }) {
  const t = useT();
  const [settings, setSettings] = useState<DesignSettings | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [minimum, setMinimum] = useState("");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [editing, setEditing] = useState<Partial<DesignPackage> | null>(null);
  const [timings, setTimings] = useState({ inspirationDays: "", siteVisitHours: "" });
  const load = useCallback(() => loadDesignSettings(workspaceId).then((next) => { setSettings(next); setMinimum(next.minimumDeposit?.amount ? String(Number(next.minimumDeposit.amount)) : ""); setTimings({ inspirationDays: String(next.timings?.inspirationDays ?? 7), siteVisitHours: String(next.timings?.siteVisitHours ?? 72) }); }).catch((error: Error) => setFailure(error.message)), [workspaceId]);
  useEffect(() => { void load(); }, [load]);

  const money = (value: string, code: string) => { try { return new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(Number(value)); } catch { return `${code} ${value}`; } };
  const price = (pkg: DesignPackage) => pkg.pricingMethod === "per_space" ? `${money(pkg.rate, pkg.currency)} / ${t("space")}` : pkg.pricingMethod === "per_area" ? `${money(pkg.rate, pkg.currency)} / ${pkg.areaUnit === "sqm" ? t("sq m") : t("sq ft")}` : money(pkg.rate, pkg.currency);
  const run = async (work: () => Promise<unknown>, success: string) => {
    setFailure(""); setNotice("");
    try { await work(); setNotice(success); await load(); } catch (error) { setFailure(error instanceof Error ? error.message : t("Design settings could not be saved.")); }
  };

  if (!settings && !failure) return <Skeleton lines={4} shape="form" />;
  // The deposit and the timings are saved together from the one save bar.
  const savedMinimum = settings?.minimumDeposit?.amount ? String(Number(settings.minimumDeposit.amount)) : "";
  const savedTimings = { inspirationDays: String(settings?.timings?.inspirationDays ?? 7), siteVisitHours: String(settings?.timings?.siteVisitHours ?? 72) };
  const minimumChanged = minimum !== savedMinimum;
  const timingsChanged = timings.inspirationDays !== savedTimings.inspirationDays || timings.siteVisitHours !== savedTimings.siteVisitHours;
  const saveChanges = async () => {
    setSaving(true); setFailure(""); setNotice("");
    try {
      let version = settings?.version ?? 0;
      if (minimumChanged) version = (await saveMinimumDeposit(workspaceId, minimum ? { amount: Number(minimum).toFixed(2), currency: settings?.minimumDeposit?.currency ?? currency } : null, version)).version;
      if (timingsChanged) await saveDesignTimings(workspaceId, { inspirationDays: Number(timings.inspirationDays), siteVisitHours: Number(timings.siteVisitHours) }, version);
      await load();
      setJustSaved(true);
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Design settings could not be saved.")); }
    setSaving(false);
  };
  const columns: DataGridColumn<DesignPackage>[] = [
    { accessorKey: "name", header: t("Package"), size: 240, cell: ({ row: { original: pkg } }) => <span className={styles.name}><strong>{pkg.name}</strong>{pkg.inclusions ? <small>{pkg.inclusions}</small> : null}</span> },
    { id: "price", header: t("Price"), size: 170, accessorFn: price },
    { accessorKey: "includedRevisions", header: t("Revisions"), size: 110, cell: ({ getValue }) => t("{count} included", { count: Number(getValue()) }) },
    { id: "includes", header: t("Includes"), size: 200, enableSorting: false, cell: ({ row: { original: pkg } }) => <span className={styles.chips}>{pkg.includesSpacePlanning ? <Badge tone="neutral">{t("Space planning")}</Badge> : null}{pkg.includesRenders ? <Badge tone="neutral">{t("3D renders")}</Badge> : null}{pkg.requiredRoleCode ? <Badge tone="info">{pkg.requiredRoleCode.replace(/_/g, " ")}</Badge> : null}</span> },
    { accessorKey: "status", header: t("Status"), size: 100, cell: ({ row: { original: pkg } }) => <Badge tone={pkg.status === "active" ? "success" : "neutral"}>{pkg.status === "active" ? t("Offered") : t("Archived")}</Badge> },
    ...(canManage ? [{ id: "actions", header: "", size: 170, enableSorting: false, cell: ({ row: { original: pkg } }: { row: { original: DesignPackage } }) => <span className={styles.rowActions}>
      <Button size="compact" variant="secondary" onPress={() => setEditing(pkg)}><Pencil aria-hidden="true" size={13} />{t("Edit")}</Button>
      <Button size="compact" variant="quiet" aria-label={`${pkg.status === "active" ? t("Archive") : t("Restore")} ${pkg.name}`} onPress={() => void run(() => setDesignPackageStatus(workspaceId, pkg.id, pkg.status === "active" ? "archived" : "active", pkg.version), pkg.status === "active" ? t("Package archived.") : t("Package restored."))}>{pkg.status === "active" ? <Archive aria-hidden="true" size={13} /> : <RotateCcw aria-hidden="true" size={13} />}</Button>
    </span> } as DataGridColumn<DesignPackage>] : []),
  ];

  return <SettingsPage title={t("Design packages")}>
    {failure ? <InlineNotice message={failure} tone="error" /> : null}
    {notice ? <InlineNotice message={notice} tone="success" /> : null}
    <SettingsSection id="design-deposit" title={t("Design deposit")}>
      <SettingsRow hint={t("Design work starts only after this much is received and verified.")} label={t("Minimum deposit")}>
        <span className={styles.minimum}>
          <TextInput aria-label={t("Minimum deposit")} isDisabled={!canManage} label={null} onChange={(value) => { setJustSaved(false); setMinimum(amount(value)); }} placeholder={t("No minimum")} suffix={settings?.minimumDeposit?.currency ?? currency} value={minimum} />

        </span>
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="design-timings" title={t("Timings")}>
      <SettingsRow hint={t("Starts when the client adds their first inspiration.")} label={t("Inspiration")}>
        <TextInput aria-label={t("Inspiration days")} isDisabled={!canManage} label={null} onChange={(value) => setTimings((current) => ({ ...current, inspirationDays: value.replace(/\D/g, "").slice(0, 2) }))} suffix={t("days")} value={timings.inspirationDays} />
      </SettingsRow>
      <SettingsRow hint={t("From the end of inspiration to a completed site visit.")} label={t("Site visit")}>
        <span className={styles.minimum}>
          <TextInput aria-label={t("Site visit hours")} isDisabled={!canManage} label={null} onChange={(value) => setTimings((current) => ({ ...current, siteVisitHours: value.replace(/\D/g, "").slice(0, 3) }))} suffix={t("hours")} value={timings.siteVisitHours} />

        </span>
      </SettingsRow>
    </SettingsSection>
    {canManage ? <SaveBar isDirty={minimumChanged || timingsChanged} isSaving={saving} saved={justSaved} isDisabled={!timings.inspirationDays || !timings.siteVisitHours}
      onDiscard={() => { setMinimum(savedMinimum); setTimings(savedTimings); setFailure(""); }} onSave={() => void saveChanges()} /> : null}
    <SettingsSection actions={canManage ? <Button size="compact" variant="primary" onPress={() => setEditing({ pricingMethod: "per_area", areaUnit: "sqft", currency, includedRevisions: 2 })}><Plus aria-hidden="true" size={14} />{t("Add package")}</Button> : null} id="design-packages" title={t("Packages")}>
      <div data-sales-grid><DataGrid ariaLabel={t("Design packages")} columns={columns} data={settings?.packages ?? []} emptyDescription={t("Add the design packages you offer and how each is priced.")} emptyTitle={t("No design packages yet")} getRowId={(pkg) => pkg.id} rowNumbers={false} selectable={false} showToolbar={false} /></div>
    </SettingsSection>
    {editing ? <PackageDialog initial={editing} onClose={() => setEditing(null)} onSave={async (value) => { await saveDesignPackage(workspaceId, value); setEditing(null); setNotice(t("Package saved.")); await load(); }} /> : null}
  </SettingsPage>;
}

function PackageDialog({ initial, onClose, onSave }: { initial: Partial<DesignPackage>; onClose: () => void; onSave: (value: Partial<DesignPackage>) => Promise<void> }) {
  const t = useT();
  const [start] = useState<Partial<DesignPackage>>(() => ({ ...initial, rate: initial.rate ? String(Number(initial.rate)) : "" }));
  const [value, setValue] = useState<Partial<DesignPackage>>(start);
  const set = <K extends keyof DesignPackage>(key: K) => (next: DesignPackage[K]) => setValue((current) => ({ ...current, [key]: next }));
  const methods: Array<{ id: PricingMethod; label: string }> = [{ id: "per_area", label: t("Per area") }, { id: "per_space", label: t("Per space") }, { id: "fixed", label: t("Fixed fee") }];
  const save = async () => {
    if (!value.name?.trim()) throw new Error(t("Enter the package name."));
    if (!value.rate) throw new Error(t("Enter the rate."));
    await onSave({ ...value, code: value.code || slug(value.name), rate: value.rate, areaUnit: value.pricingMethod === "per_area" ? value.areaUnit ?? "sqft" : null, requiredRoleCode: value.requiredRoleCode || null, inclusions: value.inclusions || null });
  };
  const per = value.pricingMethod === "per_area" ? (value.areaUnit === "sqm" ? t("Per sq m") : t("Per sq ft")) : value.pricingMethod === "per_space" ? t("Per space") : undefined;
  return <FormDialog isDirty={JSON.stringify(value) !== JSON.stringify(start)} onClose={onClose} onSubmit={save} submitLabel={t("Save package")} title={initial.id ? t("Edit package") : t("New package")}>
    <TextInput isRequired label={t("Name")} onChange={set("name")} value={value.name ?? ""} />
    <SelectField isRequired items={methods} label={t("Priced")} onSelectionChange={(key) => set("pricingMethod")(String(key) as PricingMethod)} selectedKey={value.pricingMethod ?? "per_area"} />
    <MoneyField currency={value.currency ?? undefined} description={per} isRequired label={t("Rate")} min="0" onChange={(next) => set("rate")(next)} value={value.rate ?? ""} />
    {value.pricingMethod === "per_area" ? <SelectField items={[{ id: "sqft", label: t("Square feet") }, { id: "sqm", label: t("Square metres") }]} label={t("Area unit")} onSelectionChange={(key) => set("areaUnit")(String(key) as "sqft" | "sqm")} selectedKey={value.areaUnit ?? "sqft"} /> : null}
    <MoreDetails filled={[value.requiredRoleCode, value.inclusions, value.includesSpacePlanning, value.includesRenders].filter(Boolean).length}>
      <TextInput inputMode="numeric" label={t("Included revisions")} onChange={(next) => set("includedRevisions")(Math.min(20, Number(next.replace(/\D/g, "") || 0)))} value={String(value.includedRevisions ?? 2)} />
      <TextInput description={t("Added to the project automatically, e.g. creative_director.")} label={t("Required role")} onChange={(next) => set("requiredRoleCode")(next.toLowerCase().replace(/[^a-z0-9_]/g, ""))} value={value.requiredRoleCode ?? ""} />
      <div className={styles.toggles}>
        <Switch isSelected={Boolean(value.includesSpacePlanning)} onChange={set("includesSpacePlanning")}>{t("Space planning")}</Switch>
        <Switch isSelected={Boolean(value.includesRenders)} onChange={set("includesRenders")}>{t("3D renders")}</Switch>
      </div>
      <TextAreaField label={t("What's included")} maxLength={2000} onChange={set("inclusions")} value={value.inclusions ?? ""} />
    </MoreDetails>
  </FormDialog>;
}
