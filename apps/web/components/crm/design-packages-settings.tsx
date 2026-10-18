"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, DataGrid, FormDialog, IconButton, InlineNotice, MoneyField, MoreDetails, SaveBar, SelectField, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TagsField, TextAreaField, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { loadDesignSettings, MAX_SITE_QUESTIONS, questionKey, saveDesignFlow, saveDesignPackage, saveDesignTimings, saveMinimumDeposit, setDesignPackageStatus, type ChecklistScope, type DesignFlow, type DesignPackage, type DesignSettings, type DesignSteps, type DesignTeamRoles, type MinimumDeposit, type PricingMethod, type SiteQuestion } from "@/lib/design/packages";
import styles from "./design-packages-settings.module.css";

const amount = (value: string) => value.replace(/[^\d.]/g, "");
type DepositKind = "amount" | "percent";
/** The saved minimum as the field shows it: its kind and its number ("" for none). */
const depositField = (minimum: MinimumDeposit | null | undefined): { kind: DepositKind; value: string } =>
  !minimum ? { kind: "amount", value: "" } : "percent" in minimum ? { kind: "percent", value: String(Number(minimum.percent)) } : { kind: "amount", value: String(Number(minimum.amount)) };
const scopeKey = (scope: string) => scope.replace(/\s+/g, " ").trim().toLowerCase();
/** The checklists the questions name, in list order, each with its match words (kept from before) and whether it's for every job. */
function checklistScopes(questions: SiteQuestion[], scopes: ChecklistScope[]): ChecklistScope[] {
  const names = [...new Map(questions.filter((item) => item.scope?.trim()).map((item) => [scopeKey(item.scope!), item.scope!.replace(/\s+/g, " ").trim()])).entries()];
  return names.map(([key, scope]) => {
    const found = scopes.find((entry) => scopeKey(entry.scope) === key);
    return { scope, match: found?.match ?? [], ...(found?.everyJob ? { everyJob: true } : {}) };
  });
}
const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/** PLM-041: the design package price list and the minimum design deposit. Owners and admins edit; others read. */
export function DesignPackagesSettings({ workspaceId, currency, locale, canManage }: { workspaceId: string; currency: string; locale?: string; canManage: boolean }) {
  const t = useT();
  const [settings, setSettings] = useState<DesignSettings | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [minimum, setMinimum] = useState("");
  const [minimumKind, setMinimumKind] = useState<DepositKind>("amount");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [editing, setEditing] = useState<Partial<DesignPackage> | null>(null);
  const [timings, setTimings] = useState({ inspirationDays: "", siteVisitHours: "" });
  const [flow, setFlow] = useState<DesignFlow | null>(null);
  const load = useCallback(() => loadDesignSettings(workspaceId).then((next) => { setSettings(next); const deposit = depositField(next.minimumDeposit); setMinimum(deposit.value); setMinimumKind(deposit.kind); setTimings({ inspirationDays: String(next.timings?.inspirationDays ?? 7), siteVisitHours: String(next.timings?.siteVisitHours ?? 72) }); setFlow(next.flow ?? null); }).catch((error: Error) => setFailure(error.message)), [workspaceId]);
  useEffect(() => { void load(); }, [load]);

  const money = (value: string, code: string) => { try { return new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(Number(value)); } catch { return `${code} ${value}`; } };
  const unitPrice = (pkg: DesignPackage) => pkg.pricingMethod === "per_space" ? `${money(pkg.rate, pkg.currency)} / ${t("space")}` : pkg.pricingMethod === "per_area" ? `${money(pkg.rate, pkg.currency)} / ${pkg.areaUnit === "sqm" ? t("sq m") : t("sq ft")}` : money(pkg.rate, pkg.currency);
  // PLM-139: "from" a rate that can go higher with approval, and what one unit is.
  const price = (pkg: DesignPackage) => [pkg.rateFrom ? t("From {price}", { price: unitPrice(pkg) }) : unitPrice(pkg), pkg.unitDefinition].filter(Boolean).join(" · ");
  const run = async (work: () => Promise<unknown>, success: string) => {
    setFailure(""); setNotice("");
    try { await work(); setNotice(success); await load(); } catch (error) { setFailure(error instanceof Error ? error.message : t("Design settings could not be saved.")); }
  };

  if (!settings && !failure) return <Skeleton lines={4} shape="form" />;
  // The deposit and the timings are saved together from the one save bar.
  const savedMinimum = depositField(settings?.minimumDeposit);
  const savedTimings = { inspirationDays: String(settings?.timings?.inspirationDays ?? 7), siteVisitHours: String(settings?.timings?.siteVisitHours ?? 72) };
  const minimumChanged = minimum !== savedMinimum.value || (Boolean(minimum) && minimumKind !== savedMinimum.kind);
  // A percentage of the design fee is more than 0 and at most 100.
  const minimumValid = minimumKind === "amount" || !minimum || (Number(minimum) > 0 && Number(minimum) <= 100);
  const depositCurrency = settings?.minimumDeposit && "currency" in settings.minimumDeposit ? settings.minimumDeposit.currency : currency;
  const timingsChanged = timings.inspirationDays !== savedTimings.inspirationDays || timings.siteVisitHours !== savedTimings.siteVisitHours;
  const flowChanged = Boolean(flow && settings?.flow && JSON.stringify(flow) !== JSON.stringify(settings.flow));
  const steps = flow?.steps;
  const flowValid = !flow || (flow.siteVisitQuestions.every((item) => item.question.trim()) && flow.designClientDays >= flow.designInternalDays
    && [flow.designInternalDays, flow.designClientDays, flow.materialSelectionDays, flow.estimateDays].every((days) => days >= 1)
    && (flow.renderClientDays ?? flow.designClientDays) >= (flow.renderInternalDays ?? flow.designInternalDays)
    && (!steps || ([steps.allocationDays, steps.kickoffDays, steps.conceptDays, steps.siteMeasureDays, steps.developmentMinDays, steps.developmentMaxDays, steps.sampleCollectionDays, steps.sampleMeetingDays]
      .every((days) => days >= 1) && steps.developmentMaxDays >= steps.developmentMinDays))
    && (!flow.team || Boolean(flow.team.lead_designer)));
  const setFlowValue = <K extends keyof DesignFlow>(key: K, value: DesignFlow[K]) => { setJustSaved(false); setFlow((current) => current ? { ...current, [key]: value } : current); };
  /** PLM-140–144: the days of a step of the design order. */
  const stepDays = (key: Exclude<keyof DesignSteps, "conceptOptionsMax">, max: number, label: string) =>
    <TextInput aria-label={label} isDisabled={!canManage} label={null} inputMode="numeric" suffix={t("days")} value={String(steps?.[key] ?? "")}
      onChange={(value) => steps && setFlowValue("steps", { ...steps, [key]: Math.min(max, Number(value.replace(/\D/g, "") || 0)) })} />;
  const roleItems = (settings?.roles ?? []).map((role) => ({ id: role.key, label: role.label }));
  /** PLM-151: which team role a part of the design team uses; every part but the lead can be left out. */
  const teamRole = (key: keyof Omit<DesignTeamRoles, "technicalLeadRoleCode">, label: string) => flow?.team ? <SelectField aria-label={label} isDisabled={!canManage} label={null}
    items={[...(key === "lead_designer" ? [] : [{ id: "none", label: t("Not used") }]), ...roleItems, ...(flow.team[key] && !roleItems.some((item) => item.id === flow.team![key]) ? [{ id: flow.team[key]!, label: flow.team[key]! }] : [])]}
    selectedKey={flow.team[key] ?? "none"} onSelectionChange={(selected) => setFlowValue("team", { ...flow.team!, [key]: selected === "none" ? null : String(selected) })} /> : null;
  const days = (key: "designInternalDays" | "designClientDays" | "materialSelectionDays" | "estimateDays", max: number, label: string) =>
    <TextInput aria-label={label} isDisabled={!canManage} label={null} inputMode="numeric" suffix={t("days")} value={String(flow?.[key] ?? "")}
      onChange={(value) => setFlowValue(key, Math.min(max, Number(value.replace(/\D/g, "") || 0)))} />;
  /** A render deadline of its own, or empty to follow the design deadline. */
  const renderDays = (key: "renderInternalDays" | "renderClientDays", label: string, fallback: number) =>
    <TextInput aria-label={label} isDisabled={!canManage} label={null} inputMode="numeric" suffix={t("days")} placeholder={String(fallback)} value={flow?.[key] ? String(flow[key]) : ""}
      onChange={(value) => { const digits = value.replace(/\D/g, ""); setFlowValue(key, digits ? Math.min(365, Math.max(1, Number(digits))) : null); }} />;
  const saveChanges = async () => {
    setSaving(true); setFailure(""); setNotice("");
    try {
      let version = settings?.version ?? 0;
      if (minimumChanged) version = (await saveMinimumDeposit(workspaceId, !minimum ? null : minimumKind === "percent" ? { percent: Number(Number(minimum).toFixed(2)) }
        : { amount: Number(minimum).toFixed(2), currency: depositCurrency }, version)).version;
      if (timingsChanged) version = (await saveDesignTimings(workspaceId, { inspirationDays: Number(timings.inspirationDays), siteVisitHours: Number(timings.siteVisitHours) }, version)).version;
      if (flowChanged && flow) {
        const questions = flow.siteVisitQuestions.map((item) => {
          const scope = item.scope?.trim() || null;
          // A section heads general questions only; a checklist is its scope.
          return { key: item.key, question: item.question.trim(), scope, section: scope ? null : item.section?.trim() || null, kind: item.kind === "check" ? "check" as const : null,
            ...(item.required ? { required: true } : {}) };
        });
        await saveDesignFlow(workspaceId, { ...flow, siteVisitQuestions: questions, siteVisitScopes: checklistScopes(questions, flow.siteVisitScopes ?? []) }, version);
      }
      await load();
      setJustSaved(true);
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Design settings could not be saved.")); }
    setSaving(false);
  };
  const columns: DataGridColumn<DesignPackage>[] = [
    { accessorKey: "name", header: t("Package"), size: 240, cell: ({ row: { original: pkg } }) => <span className={styles.name}><strong>{pkg.name}</strong>{pkg.inclusions ? <small>{pkg.inclusions}</small> : null}</span> },
    { id: "price", header: t("Price"), size: 170, accessorFn: price },
    { accessorKey: "includedRevisions", header: t("Revisions"), size: 110, cell: ({ getValue }) => t("{count} included", { count: Number(getValue()) }) },
    { id: "includes", header: t("Includes"), size: 200, enableSorting: false, cell: ({ row: { original: pkg } }) => <span className={styles.chips}>{pkg.includesSpacePlanning ? <Badge hue={6}>{t("Space planning")}</Badge> : null}{pkg.includesRenders ? <Badge hue={2}>{t("Renders")}</Badge> : null}{pkg.reviewRoleCode ? <Badge tone="info">{t("Reviewed by {role}", { role: pkg.reviewRoleCode.replace(/_/g, " ") })}</Badge> : null}{pkg.requiredRoleCode ? <Badge hue="auto">{pkg.requiredRoleCode.replace(/_/g, " ")}</Badge> : null}</span> },
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
          {/* An amount, or a share of the job's design fee (100% for the whole fee). */}
          <SelectField aria-label={t("Minimum deposit as")} isDisabled={!canManage} label={null} accent="neutral" selectedKey={minimumKind}
            onSelectionChange={(key) => { setJustSaved(false); setMinimumKind(key === "percent" ? "percent" : "amount"); }}
            items={[{ id: "amount", label: t("Amount") }, { id: "percent", label: t("% of the design fee") }]} />
          <TextInput aria-label={t("Minimum deposit")} isDisabled={!canManage} label={null} onChange={(value) => { setJustSaved(false); setMinimum(amount(value)); }} placeholder={t("No minimum")}
            suffix={minimumKind === "percent" ? "%" : depositCurrency} value={minimum} errorMessage={minimumValid ? undefined : t("Between 0 and 100%")} isInvalid={!minimumValid} />
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
    {flow ? <SettingsSection id="design-flow" title={t("Design flow")}>
      <SettingsRow hint={t("What the team works to on concepts, space planning and renders.")} label={t("Internal deadline")}>{days("designInternalDays", 365, t("Internal deadline"))}</SettingsRow>
      <SettingsRow hint={t("What the client is promised; at least the internal deadline.")} label={t("Client deadline")}>{days("designClientDays", 365, t("Client deadline"))}</SettingsRow>
      <SettingsRow hint={t("Empty: the internal deadline above.")} label={t("Renders, internal")}>{renderDays("renderInternalDays", t("Renders, internal"), flow.designInternalDays)}</SettingsRow>
      <SettingsRow hint={t("Empty: the client deadline above.")} label={t("Renders, client")}>{renderDays("renderClientDays", t("Renders, client"), flow.designClientDays)}</SettingsRow>
      <SettingsRow hint={t("From the start of material selection to the confirmed material list.")} label={t("Material selection")}>{days("materialSelectionDays", 90, t("Material selection"))}</SettingsRow>
      <SettingsRow hint={t("From the design approval to sharing the estimate.")} label={t("Estimate")}>{days("estimateDays", 90, t("Estimate"))}</SettingsRow>
      <SettingsRow hint={t("Free slots come from this booking page's hours, buffers and the designer's calendar.")} label={t("Showroom appointment")}>
        <SelectField aria-label={t("Showroom appointment")} isDisabled={!canManage} label={null} items={[{ id: "none", label: t("Pick times by hand") }, ...(settings?.bookingTypes ?? []).map((type) => ({ id: type.id, label: type.name }))]}
          selectedKey={flow.showroomBookingTypeId ?? "none"} onSelectionChange={(key) => setFlowValue("showroomBookingTypeId", key === "none" ? null : String(key))} />
      </SettingsRow>
      <SettingsRow hint={t("Renders go to someone with this role.")} label={t("Visualiser role")}>
        <TextInput aria-label={t("Visualiser role")} isDisabled={!canManage} label={null} value={flow.visualiserRoleCode} onChange={(value) => setFlowValue("visualiserRoleCode", value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 60))} />
      </SettingsRow>
    </SettingsSection> : null}
    {steps ? <SettingsSection id="design-steps" title={t("Design steps")}>
      <SettingsRow hint={t("From the paid design fee to the design team allocated.")} label={t("Design team")}>{stepDays("allocationDays", 30, t("Design team"))}</SettingsRow>
      <SettingsRow hint={t("From the end of inspiration to the kick-off meeting.")} label={t("Kick-off")}>{stepDays("kickoffDays", 60, t("Kick-off"))}</SettingsRow>
      <SettingsRow hint={t("From the kick-off to the first concept.")} label={t("First concept")}>{stepDays("conceptDays", 90, t("First concept"))}</SettingsRow>
      <SettingsRow hint={t("From the kick-off to the design site measure.")} label={t("Site measure")}>{stepDays("siteMeasureDays", 30, t("Site measure"))}</SettingsRow>
      <SettingsRow hint={t("What the client is promised for design development: the days per room, between the shortest and the longest.")} label={t("Development window")}>
        <span className={styles.window}>{stepDays("developmentMinDays", 365, t("Shortest"))}{stepDays("developmentMaxDays", 365, t("Longest"))}{stepDays("developmentDaysPerRoom", 90, t("Per room"))}</span>
      </SettingsRow>
      <SettingsRow hint={t("From the render sign-off (or the concept, without renders) to the samples collected.")} label={t("Sample collection")}>{stepDays("sampleCollectionDays", 60, t("Sample collection"))}</SettingsRow>
      <SettingsRow hint={t("From the samples collected to the sample meeting.")} label={t("Sample meeting")}>{stepDays("sampleMeetingDays", 60, t("Sample meeting"))}</SettingsRow>
      <SettingsRow hint={t("Empty: as many as the designer adds.")} label={t("Concept options")}>
        <TextInput aria-label={t("Concept options")} isDisabled={!canManage} label={null} inputMode="numeric" value={steps.conceptOptionsMax ? String(steps.conceptOptionsMax) : ""}
          onChange={(value) => { const digits = value.replace(/\D/g, ""); setFlowValue("steps", { ...steps, conceptOptionsMax: digits ? Math.min(12, Math.max(1, Number(digits))) : null }); }} />
      </SettingsRow>
    </SettingsSection> : null}
    {flow?.team ? <SettingsSection id="design-team" title={t("Design team")}>
      <SettingsRow hint={t("Chosen by the Account Manager once the design fee is paid, or by the package's reviewer.")} label={t("Lead designer")}>{teamRole("lead_designer", t("Lead designer"))}</SettingsRow>
      <SettingsRow hint={t("Chosen by the Account Manager. Clients see every designer as Interior designer.")} label={t("Junior designer")}>{teamRole("junior_designer", t("Junior designer"))}</SettingsRow>
      <SettingsRow hint={t("Chosen by the Account Manager.")} label={t("Sales Admin")}>{teamRole("sales_admin", t("Sales Admin"))}</SettingsRow>
      <SettingsRow hint={t("Tagged by the lead designer.")} label={t("Visualiser")}>{teamRole("visualiser", t("Visualiser"))}</SettingsRow>
      <SettingsRow hint={t("Tagged by the technical lead.")} label={t("Draftsman")}>{teamRole("draftsman", t("Draftsman"))}</SettingsRow>
      <SettingsRow hint={t("Collects the samples. Without one on the job, someone with this role.")} label={t("Material Coordinator")}>{teamRole("material_coordinator", t("Material Coordinator"))}</SettingsRow>
      <SettingsRow hint={t("People with this role or team tag the Draftsman.")} label={t("Technical lead role")}>
        <TextInput aria-label={t("Technical lead role")} isDisabled={!canManage} label={null} value={flow.team.technicalLeadRoleCode ?? ""}
          onChange={(value) => setFlowValue("team", { ...flow.team!, technicalLeadRoleCode: value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 64) || null })} />
      </SettingsRow>
    </SettingsSection> : null}
    {flow ? <SettingsSection id="site-visit-questions" title={t("Site visit questions")}
      actions={canManage && flow.siteVisitQuestions.length < MAX_SITE_QUESTIONS ? <Button size="compact" onPress={() => setFlowValue("siteVisitQuestions", [...flow.siteVisitQuestions, { key: "", question: "" }])}><Plus aria-hidden="true" size={14} />{t("Add question")}</Button> : null}>
      <ol className={styles.questions}>{flow.siteVisitQuestions.map((item, index) => {
        const change = (patch: Partial<SiteQuestion>) => setFlowValue("siteVisitQuestions", flow.siteVisitQuestions.map((current, position) => position === index ? { ...current, ...patch } : current));
        return <li key={item.key || `new-${index}`}>
          {/* A checklist is its scope (matched to the job's rooms); a section only heads general questions. */}
          <TextInput aria-label={t("Scope of question {number}", { number: index + 1 })} isDisabled={!canManage} label={null} maxLength={60} placeholder={t("General")} value={item.scope ?? ""}
            onChange={(scope) => change({ scope })} />
          <TextInput aria-label={t("Section of question {number}", { number: index + 1 })} isDisabled={!canManage || Boolean(item.scope?.trim())} label={null} maxLength={60}
            placeholder={t("Section")} value={item.scope?.trim() ? "" : item.section ?? ""} onChange={(section) => change({ section })} />
          <TextInput aria-label={t("Question {number}", { number: index + 1 })} isDisabled={!canManage} label={null} maxLength={500} value={item.question}
            onChange={(question) => change({ question, key: item.key || questionKey(question, flow.siteVisitQuestions.filter((_, other) => other !== index).map((entry) => entry.key)) })} />
          <SelectField aria-label={t("Answer of question {number}", { number: index + 1 })} isDisabled={!canManage} label={null} accent="neutral" selectedKey={item.kind === "check" ? "check" : "answer"}
            items={[{ id: "answer", label: t("In words") }, { id: "check", label: t("Check") }]} onSelectionChange={(kind) => change({ kind: kind === "check" ? "check" : null })} />
          {/* Optional unless marked: only required questions block completing the visit. */}
          <Switch aria-label={t("Question {number} is required", { number: index + 1 })} isDisabled={!canManage} isSelected={item.required === true}
            onChange={(required) => change({ required })}>{t("Required")}</Switch>
          {canManage ? <IconButton aria-label={t("Remove question {number}", { number: index + 1 })} size="compact" variant="quiet" onPress={() => setFlowValue("siteVisitQuestions", flow.siteVisitQuestions.filter((_, position) => position !== index))}><Trash2 aria-hidden="true" size={14} /></IconButton> : null}
        </li>;
      })}</ol>
    </SettingsSection> : null}
    {flow && checklistScopes(flow.siteVisitQuestions, []).length ? <SettingsSection id="site-visit-checklists" title={t("Checklists")}>
      {checklistScopes(flow.siteVisitQuestions, flow.siteVisitScopes ?? []).map((entry) => {
        const count = flow.siteVisitQuestions.filter((item) => item.scope && scopeKey(item.scope) === scopeKey(entry.scope)).length;
        const set = (patch: Partial<ChecklistScope>) => setFlowValue("siteVisitScopes",
          checklistScopes(flow.siteVisitQuestions, flow.siteVisitScopes ?? []).map((current) => scopeKey(current.scope) === scopeKey(entry.scope) ? { ...current, ...patch } : current));
        return <SettingsRow key={scopeKey(entry.scope)} align="start" label={entry.scope} hint={t("{count} questions", { count })}>
          <div className={styles.checklist}>
            {entry.everyJob ? null : <TagsField label={t("Applies to rooms or items named")} values={entry.match} isReadOnly={!canManage} placeholder={t("e.g. wardrobe, walk-in")}
              onChange={(match) => set({ match: match.slice(0, 20).map((word) => word.slice(0, 40)) })} />}
            <Switch isSelected={Boolean(entry.everyJob)} isDisabled={!canManage} onChange={(everyJob) => set({ everyJob })}>{t("Every job")}</Switch>
          </div>
        </SettingsRow>;
      })}
    </SettingsSection> : null}
    {canManage ? <SaveBar isDirty={minimumChanged || timingsChanged || flowChanged} isSaving={saving} saved={justSaved} isDisabled={!timings.inspirationDays || !timings.siteVisitHours || !flowValid || !minimumValid}
      onDiscard={() => { setMinimum(savedMinimum.value); setMinimumKind(savedMinimum.kind); setTimings(savedTimings); setFlow(settings?.flow ?? null); setFailure(""); }} onSave={() => void saveChanges()} /> : null}
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
    await onSave({ ...value, code: value.code || slug(value.name), rate: value.rate, areaUnit: value.pricingMethod === "per_area" ? value.areaUnit ?? "sqft" : null, requiredRoleCode: value.requiredRoleCode || null, inclusions: value.inclusions || null,
      reviewRoleCode: value.reviewRoleCode || null, rateFrom: value.pricingMethod !== "fixed" && Boolean(value.rateFrom), unitDefinition: value.pricingMethod === "fixed" ? null : value.unitDefinition?.trim() || null });
  };
  const per = value.pricingMethod === "per_area" ? (value.areaUnit === "sqm" ? t("Per sq m") : t("Per sq ft")) : value.pricingMethod === "per_space" ? t("Per space") : undefined;
  return <FormDialog isDirty={JSON.stringify(value) !== JSON.stringify(start)} onClose={onClose} onSubmit={save} submitLabel={t("Save package")} title={initial.id ? t("Edit package") : t("New package")}>
    <TextInput isRequired label={t("Name")} onChange={set("name")} value={value.name ?? ""} />
    <SelectField isRequired items={methods} label={t("Priced")} onSelectionChange={(key) => set("pricingMethod")(String(key) as PricingMethod)} selectedKey={value.pricingMethod ?? "per_area"} />
    <MoneyField currency={value.currency ?? undefined} description={per} isRequired label={t("Rate")} min="0" onChange={(next) => set("rate")(next)} value={value.rate ?? ""} />
    {value.pricingMethod === "per_area" ? <SelectField items={[{ id: "sqft", label: t("Square feet") }, { id: "sqm", label: t("Square metres") }]} label={t("Area unit")} onSelectionChange={(key) => set("areaUnit")(String(key) as "sqft" | "sqm")} selectedKey={value.areaUnit ?? "sqft"} /> : null}
    {value.pricingMethod && value.pricingMethod !== "fixed" ? <>
      <TextInput description={t("Shown with the rate, e.g. 1 space = 1 room with a door.")} label={t("One unit is")} maxLength={200} onChange={set("unitDefinition")} value={value.unitDefinition ?? ""} />
      <Switch isSelected={Boolean(value.rateFrom)} onChange={set("rateFrom")}>{t("Priced from this rate (a higher rate is approved first)")}</Switch>
    </> : null}
    <MoreDetails filled={[value.requiredRoleCode, value.reviewRoleCode, value.inclusions, value.includesSpacePlanning, value.includesRenders].filter(Boolean).length}>
      <TextInput inputMode="numeric" label={t("Included revisions")} onChange={(next) => set("includedRevisions")(Math.min(20, Number(next.replace(/\D/g, "") || 0)))} value={String(value.includedRevisions ?? 2)} />
      <TextInput description={t("Concepts and renders wait for someone with this role before the client sees them; they choose the lead designer. E.g. creative_director.")} label={t("Reviewed by")}
        onChange={(next) => set("reviewRoleCode")(next.toLowerCase().replace(/[^a-z0-9_]/g, ""))} value={value.reviewRoleCode ?? ""} />
      <TextInput description={t("The designer at the intro meeting must hold this role.")} label={t("Required role")} onChange={(next) => set("requiredRoleCode")(next.toLowerCase().replace(/[^a-z0-9_]/g, ""))} value={value.requiredRoleCode ?? ""} />
      <div className={styles.toggles}>
        <Switch isSelected={Boolean(value.includesSpacePlanning)} onChange={set("includesSpacePlanning")}>{t("Space planning")}</Switch>
        <Switch isSelected={Boolean(value.includesRenders)} onChange={set("includesRenders")}>{t("Renders")}</Switch>
      </div>
      <TextAreaField label={t("What's included")} maxLength={2000} onChange={set("inclusions")} value={value.inclusions ?? ""} />
    </MoreDetails>
  </FormDialog>;
}
