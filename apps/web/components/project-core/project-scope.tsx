"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { parseDate } from "@internationalized/date";
import {
  Button, DateField, EmptyState, ErrorState, GroupedTable, InspectorSheet, PillTabs, SegmentedControl, SelectField, Skeleton, TextInput,
  type GroupedTableColumn, type GroupedTableSection,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { LineHistoryEntry, LiveScope, ScopeLine, ScopePackage, Supply } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import { factoryApi } from "@/lib/factory/client";
import { SampleRequests } from "../factory/samples";
import { ProjectMaterials } from "./project-materials";
import { ProjectDrawings } from "./project-drawings";
import { FinishesSchedule } from "../finishes/finishes-schedule";
import { ProjectReadiness } from "./project-readiness";
import { ProjectBrief } from "./project-brief";
import { SealedDocument } from "./sealed-document";
import { ProjectChanges } from "../change-requests/project-changes";
import { RecordLink, recordHrefs } from "../record/linked-records";
import { orderNumber } from "../factory/factory-labels";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>, options?: { inDialog?: boolean }) => Promise<boolean>;
type View = "items" | "brief" | "readiness" | "materials" | "finishes" | "drawings" | "changes" | "sealed";
const VIEWS: View[] = ["items", "brief", "readiness", "materials", "finishes", "drawings", "changes", "sealed"];
type Group = "package" | "area";
/** PLM-170: the items as the client sees them (selling rates), or with each line's cost, what is committed and the margin. */
type Mode = "client" | "internal";
type CostKey = "estimate" | "committed" | "margin";

/** part ÷ whole as a percentage to one place, for display beside exact sums; empty without a whole. */
function percentText(part: string, whole: string) {
  const base = Number(whole);
  return base ? `${(Number(part) / base * 100).toFixed(1)}%` : "";
}
const SUPPLIES: Supply[] = ["make", "buy", "ready_made", "subcontract", "client", "site_work"];
const NONE = "__none";

export function useSupplyLabels() {
  const t = useT();
  return useMemo<Record<Supply, string>>(() => ({
    make: t("Made in our factory"), buy: t("Bought materials"), ready_made: t("Bought ready-made"),
    subcontract: t("Subcontracted"), client: t("Supplied by the client"), site_work: t("Site work"),
  }), [t]);
}

/** Adds decimal amounts exactly (four places), never with floating point. */
export function addAmounts(values: string[]) {
  const scaled = values.reduce((sum, value) => {
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    const units = BigInt(whole || "0") * 10_000n + BigInt((fraction + "0000").slice(0, 4));
    return sum + (value.startsWith("-") ? -units : units);
  }, 0n);
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  return `${negative ? "-" : ""}${absolute / 10_000n}.${String(absolute % 10_000n).padStart(4, "0")}`;
}

/**
 * The project's scope: the live BOQ (the sealed quotation plus accepted variations), grouped by
 * package or by area. A line opens its history; a package opens to be named, owned and dated.
 * The sealed documents it all comes from are one tap away.
 */
export function ProjectScope({ workspaceId, projectId, version, run, onChanged }: { workspaceId: string; projectId: string; version: number; run: Run;
  /** A change made here outside the project's command (a drawing uploaded): the project reloads. */
  onChanged?: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const supplies = useSupplyLabels();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [scope, setScope] = useState<LiveScope | null>(null);
  const [error, setError] = useState("");
  const requested = useSearchParams().get("view") as View | null;
  const [view, setView] = useState<View>(requested && VIEWS.includes(requested) ? requested : "items");
  const [group, setGroup] = useState<Group>("package");
  const [mode, setMode] = useState<Mode>("client");
  const [line, setLine] = useState<ScopeLine | null>(null);
  const [editing, setEditing] = useState<ScopePackage | "new" | null>(null);
  const [seal, setSeal] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try { setScope(await api.scope(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The scope didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, version]);

  if (error && !scope) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!scope) return <Skeleton lines={6} shape="rows" />;
  // QA-006: prices and amounts only for the people who see the project's value; the server leaves them out for the rest.
  const priced = scope.canSeeValue !== false;
  // PLM-170: the internal view exists only for people with cost access (the server never sends cost fields to anyone else).
  const internal = mode === "internal" && Boolean(scope.canSeeCosts);
  const money = (value: string | null) => (value === null ? "" : format.money(value, scope.currency));
  const sum = (values: Array<string | null>) => (priced ? money(addAmounts(values.map((value) => value ?? "0"))) : "");
  const costSum = (rows: ScopeLine[], key: CostKey) => addAmounts(rows.map((row) => row.cost?.[key] ?? "0"));
  const costText = (row: ScopeLine, key: CostKey) => (row.status === "omitted" || row.cost?.[key] == null ? "—" : money(row.cost[key]));
  const active = scope.lines.filter((item) => item.status === "active");
  const omitted = scope.lines.filter((item) => item.status === "omitted");
  const unpackaged = active.filter((item) => !item.packageId);
  const variationLabels = new Set(scope.seals.filter((item) => item.kind === "variation").map((item) => item.revisionLabel));
  const agreed = sum(scope.seals.map((item) => item.total));
  const costLabels = (rows: ScopeLine[]): Record<string, string> => (internal ? { estimate: money(costSum(rows, "estimate")), committed: money(costSum(rows, "committed")), margin: money(costSum(rows, "margin")) } : {});

  const sections: GroupedTableSection<ScopeLine>[] = group === "package"
    ? [...scope.packages.map((item) => {
        const rows = active.filter((row) => row.packageId === item.id);
        return { id: item.id, label: item.name, rows, emptyMessage: t("No items in this package."),
          headerLabels: { where: supplies[item.supply], quantity: item.ownerName ?? "", amount: sum(rows.map((row) => row.net)), ...costLabels(rows) } };
      }), ...(unpackaged.length ? [{ id: NONE, label: t("Not in a package"), rows: unpackaged, emptyMessage: "", headerLabels: { where: "", quantity: "", amount: sum(unpackaged.map((row) => row.net)), ...costLabels(unpackaged) } }] : [])]
    : [...new Map(active.map((row) => [row.areaId ?? NONE, row.areaName ?? t("General")])).entries()].map(([id, label]) => {
        const rows = active.filter((row) => (row.areaId ?? NONE) === id);
        return { id, label, rows, emptyMessage: "", headerLabels: { where: "", quantity: "", amount: sum(rows.map((row) => row.net)), ...costLabels(rows) } };
      });
  if (omitted.length) sections.push({ id: "omitted", label: t("Removed by variations"), rows: omitted, emptyMessage: "", headerLabels: { where: "", quantity: "", amount: "" } });
  const packageName = (id: string | null) => scope.packages.find((item) => item.id === id)?.name ?? t("Not in a package");
  const columns: GroupedTableColumn<ScopeLine>[] = [
    { id: "item", label: t("Item"), width: internal ? "28%" : "44%", render: (row) => <span className={styles.lineCell} data-omitted={row.status === "omitted" || undefined}>
      <span>{row.title}{variationLabels.has(row.origin) ? <span className={styles.originTag}>{row.origin}</span> : null}</span>
      {row.description ? <small>{row.description}</small> : null}
    </span> },
    { id: "where", label: group === "package" ? t("Area") : t("Package"), width: internal ? "14%" : "22%", mobileHidden: true, render: (row) => <span className={styles.muted}>{group === "package" ? row.areaName ?? t("General") : packageName(row.packageId)}</span> },
    { id: "quantity", label: t("Qty"), width: internal ? "10%" : "16%", render: (row) => <span className={styles.number}>{Number(row.quantity).toLocaleString()} {row.unit}</span> },
    ...(internal ? [{ id: "rate", label: t("Rate"), width: "10%", align: "end" as const, mobileHidden: true, render: (row: ScopeLine) => <span className={styles.number}>{row.status === "omitted" ? "—" : money(row.rate)}</span> }] : []),
    ...(priced ? [{ id: "amount", label: t("Amount"), width: internal ? "12%" : "18%", align: internal ? "end" as const : undefined, render: (row: ScopeLine) => <span className={styles.number}>{row.status === "omitted" ? "—" : money(row.net)}</span> }] : []),
    ...(internal ? [
      { id: "estimate", label: t("Est. cost"), width: "12%", align: "end" as const, render: (row: ScopeLine) => <span className={styles.number}>{costText(row, "estimate")}</span> },
      { id: "committed", label: t("Committed"), width: "12%", align: "end" as const, mobileHidden: true, render: (row: ScopeLine) => <span className={styles.lineCell}>
        <span className={styles.number}>{costText(row, "committed")}</span>
        {row.cost?.committedForeign ? <small>{t("+{count} in another currency", { count: row.cost.committedForeign })}</small> : null}
      </span> },
      ...(scope.canSeeMargin ? [{ id: "margin", label: t("Margin"), width: "12%", align: "end" as const, render: (row: ScopeLine) => <span className={styles.lineCell}>
        <span className={styles.number}>{costText(row, "margin")}</span>
        {row.cost?.marginPercent ? <small className={styles.number}>{row.cost.marginPercent}%</small> : null}
      </span> }] : []),
    ] : []),
  ];
  const packageOptions = [...scope.packages.map((item) => ({ id: item.id, label: item.name })), { id: NONE, label: t("Not in a package") }];

  return <div className={styles.scopeView}>
    <PillTabs ariaLabel={t("Scope")} selectedKey={view} onSelectionChange={(key) => { setView(key as View); setSeal(null); }}
      items={[{ id: "items", label: t("Items") }, { id: "brief", label: t("Brief") }, { id: "readiness", label: t("Readiness") }, { id: "materials", label: t("Materials") }, { id: "finishes", label: t("Finishes") }, { id: "drawings", label: t("Drawings") }, { id: "changes", label: t("Changes") }, ...(priced ? [{ id: "sealed", label: t("Sealed") }] : [])]} />

    {view === "items" ? <>
      <div className={styles.scopeToolbar}>
        <div className={styles.toolbarActions}>
          <SegmentedControl label={t("Group by")} value={group} onChange={(value) => setGroup(value as Group)}
            options={[{ id: "package", label: t("By package") }, { id: "area", label: t("By area") }]} />
          {/* PLM-170: the switch exists only for people with cost access. */}
          {scope.canSeeCosts ? <SegmentedControl label={t("View")} tour="scope-view" value={mode} onChange={(value) => setMode(value as Mode)}
            options={[{ id: "client", label: t("Client view") }, { id: "internal", label: t("Internal") }]} /> : null}
        </div>
        {scope.canManage && selected.size ? <div className={styles.bulk}>
          <span>{t("{count} selected", { count: selected.size })}</span>
          <SelectField aria-label={t("Move to package")} label={null} accent="neutral" placeholder={t("Move to…")} selectedKey={null}
            onSelectionChange={async (key) => { if (await run("assign_lines", { lineIds: [...selected], packageId: String(key) === NONE ? null : String(key) })) setSelected(new Set()); }}
            items={packageOptions} />
          <Button size="compact" variant="quiet" onPress={() => setSelected(new Set())}>{t("Clear")}</Button>
        </div> : scope.canManage ? <div className={styles.toolbarActions}>
          {unpackaged.length ? <Button size="compact" onPress={() => void run("propose_packages")}><Sparkles aria-hidden="true" size={14} />{t("Suggest packages")}</Button> : null}
          <Button size="compact" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("New package")}</Button>
        </div> : null}
      </div>
      {active.length || omitted.length ? <GroupedTable<ScopeLine> ariaLabel={t("Scope items")} columns={columns} sections={sections} getRowId={(row) => row.id} getRowLabel={(row) => row.title}
        selectable={scope.canManage} selectedIds={selected} onSelectionChange={setSelected} onRowAction={setLine}
        onSectionAction={group === "package" && scope.canManage ? (id) => { const found = scope.packages.find((item) => item.id === id); if (found) setEditing(found); } : undefined} />
        : <EmptyState illustration={null} title={t("No items")} />}
      {priced ? <p className={styles.agreedLine}>
        <span>{t("Agreed value")}</span><strong>{agreed}</strong>
        {internal ? <>
          <span>{t("Est. cost")}</span><strong>{money(costSum(active, "estimate"))}</strong>
          <span>{t("Committed")}</span><strong>{money(costSum(active, "committed"))}</strong>
          {scope.canSeeMargin ? <><span>{t("Margin")}</span><strong>{[money(costSum(active, "margin")), percentText(costSum(active, "margin"), addAmounts(active.map((row) => row.net ?? "0")))].filter(Boolean).join(" · ")}</strong></> : null}
        </> : null}
      </p> : null}
    </> : view === "brief" ? <ProjectBrief workspaceId={workspaceId} projectId={projectId} version={version} />
    : view === "readiness" ? <ProjectReadiness workspaceId={workspaceId} projectId={projectId} version={version} onView={(next) => { setView(next); setSeal(null); }} />
    : view === "materials" ? <>
      <ProjectMaterials workspaceId={workspaceId} projectId={projectId} version={version} run={run} lines={scope.lines} />
      {/* PLM-061: the samples the design team asked the factory for. */}
      <SampleRequests api={factoryApi(workspaceId)} caseId={scope.caseId} />
    </>
    // PLM-156: the finishes schedule (design and installation views, the drawings schedule), the same record as on the case.
    : view === "finishes" ? <FinishesSchedule source={{ kind: "project", workspaceId, projectId }} />
    : view === "drawings" ? <ProjectDrawings workspaceId={workspaceId} projectId={projectId} version={version} onChanged={onChanged} />
    : view === "changes" ? <ProjectChanges workspaceId={workspaceId} projectId={projectId} onChanged={onChanged} />
    : seal ? <SealedDocument workspaceId={workspaceId} projectId={projectId} sealId={seal} onBack={() => setSeal(null)} />
      : <ul className={styles.sealList} aria-label={t("Sealed documents")}>
          {scope.seals.map((item) => <li key={item.id}><button type="button" onClick={() => setSeal(item.id)}>
            <span><strong>{item.revisionLabel}</strong> {item.kind === "baseline" ? t("Accepted quotation") : t("Variation")}</span>
            <span className={styles.muted}>{t("Accepted by {name} on {date}", { name: item.acceptedBy, date: format.when(item.acceptedAt) })}</span>
            <span className={styles.number}>{money(item.total)}</span>
          </button></li>)}
        </ul>}

    {line ? <LineSheet workspaceId={workspaceId} projectId={projectId} line={line} scope={scope} run={run} onClose={() => setLine(null)} /> : null}
    {editing ? <PackageSheet item={editing === "new" ? null : editing} scope={scope} run={run} onClose={() => setEditing(null)} /> : null}
  </div>;
}

/** One line: where it sits, what it costs, and everything that happened to it. */
function LineSheet({ workspaceId, projectId, line, scope, run, onClose }: { workspaceId: string; projectId: string; line: ScopeLine; scope: LiveScope; run: Run; onClose: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [history, setHistory] = useState<LineHistoryEntry[] | null>(null);
  const current = scope.lines.find((item) => item.id === line.id) ?? line;
  const hrefs = recordHrefs({ caseId: scope.caseId, project: { id: projectId } });
  useEffect(() => {
    let alive = true;
    projectApi(workspaceId).line(projectId, line.id).then((next) => { if (alive) setHistory(next.history); }).catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, [workspaceId, projectId, line.id, current.packageId]);
  const describe = (entry: LineHistoryEntry) => {
    const detail = entry.detail as Record<string, string | null>;
    if (entry.kind === "agreed") return t("Agreed in {revision} · {quantity}", { revision: String(detail.revision ?? ""), quantity: `${Number(detail.quantity ?? 0).toLocaleString()} ${current.unit}` });
    if (entry.kind === "packaged") return detail.package ? t("Put in {package}", { package: String(detail.package) }) : t("Taken out of its package");
    return entry.kind;
  };
  return <InspectorSheet isOpen size="md" title={current.title} onOpenChange={(open) => { if (!open) onClose(); }}>
    <div className={styles.sheetBody}>
      <dl className={styles.sheetFacts}>
        <div><dt>{t("Area")}</dt><dd>{current.areaName ?? t("General")}</dd></div>
        <div><dt>{t("Package")}</dt><dd>{scope.canManage && current.status === "active"
          ? <SelectField aria-label={t("Package")} label={null} accent="neutral" selectedKey={current.packageId ?? NONE}
              onSelectionChange={(key) => void run("assign_lines", { lineIds: [current.id], packageId: String(key) === NONE ? null : String(key) })}
              items={[...scope.packages.map((item) => ({ id: item.id, label: item.name })), { id: NONE, label: t("Not in a package") }]} />
          : scope.packages.find((item) => item.id === current.packageId)?.name ?? t("Not in a package")}</dd></div>
        <div><dt>{t("Quantity")}</dt><dd>{Number(current.quantity).toLocaleString()} {current.unit}</dd></div>
        {current.rate !== null ? <div><dt>{t("Rate")}</dt><dd>{format.money(current.rate, scope.currency)}</dd></div> : null}
        {current.status === "omitted" ? <div><dt>{t("Amount")}</dt><dd>{t("Removed")}</dd></div>
          : current.net !== null ? <div><dt>{t("Amount")}</dt><dd>{format.money(current.net, scope.currency)}</dd></div> : null}
        {/* PLM-170: the cost side, only sent to people with cost access. */}
        {current.cost ? <>
          <div><dt>{t("Est. cost")}</dt><dd>{current.cost.estimate === null ? t("Not costed") : format.money(current.cost.estimate, scope.currency)}</dd></div>
          <div><dt>{t("Committed")}</dt><dd>{format.money(current.cost.committed, scope.currency)}{current.cost.committedForeign ? ` · ${t("+{count} in another currency", { count: current.cost.committedForeign })}` : ""}</dd></div>
          {current.cost.margin !== null ? <div><dt>{t("Margin")}</dt><dd>{[format.money(current.cost.margin, scope.currency), current.cost.marginPercent ? `${current.cost.marginPercent}%` : ""].filter(Boolean).join(" · ")}</dd></div> : null}
        </> : null}
        {current.description ? <div><dt>{t("Description")}</dt><dd>{current.description}</dd></div> : null}
        {/* PLM-164: the orders this line is on, each opening its record. */}
        <div><dt>{t("Purchase orders")}</dt><dd>{current.purchaseOrders?.length
          ? <span className={styles.toolbarActions}>{current.purchaseOrders.map((order) => <RecordLink key={order.id} href={hrefs.purchaseOrder(order.id)}>{order.number}</RecordLink>)}</span> : <span className={styles.muted}>{t("None yet")}</span>}</dd></div>
        <div><dt>{t("Work orders")}</dt><dd>{current.workOrders?.length
          ? <span className={styles.toolbarActions}>{current.workOrders.map((order) => <RecordLink key={order.id} href={hrefs.workOrder(order.id)}>{orderNumber(order.number)}</RecordLink>)}</span> : <span className={styles.muted}>{t("None yet")}</span>}</dd></div>
      </dl>
      <h3 className={styles.sheetHeading}>{t("History")}</h3>
      {!history ? <Skeleton lines={3} /> : <ol className={styles.history}>
        {history.map((entry) => <li key={entry.id}><span>{describe(entry)}</span><small>{[entry.byName, format.when(entry.at)].filter(Boolean).join(" · ")}</small></li>)}
      </ol>}
    </div>
  </InspectorSheet>;
}

/** A package: its name, how it's delivered, who owns it and when it's due. */
function PackageSheet({ item, scope, run, onClose }: { item: ScopePackage | null; scope: LiveScope; run: Run; onClose: () => void }) {
  const t = useT();
  const supplies = useSupplyLabels();
  const [name, setName] = useState(item?.name ?? "");
  const [supply, setSupply] = useState<Supply>(item?.supply ?? "make");
  const [owner, setOwner] = useState<string>(item?.ownerMembershipId ?? NONE);
  const [due, setDue] = useState<string | null>(item?.dueDate ?? null);
  const [busy, setBusy] = useState(false);
  const empty = item ? !scope.lines.some((line) => line.packageId === item.id) : false;
  const readOnly = !scope.canManage;
  const save = async () => {
    setBusy(true);
    if (await run("save_package", { id: item?.id, name: name.trim(), supply, ownerMembershipId: owner === NONE ? null : owner, dueDate: due })) onClose();
    setBusy(false);
  };
  return <InspectorSheet isOpen size="sm" title={item ? item.name : t("New package")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={readOnly ? null : <div className="wd-dialog-actions">
      {item && empty ? <Button variant="quiet" onPress={async () => { if (await run("delete_package", { packageId: item.id })) onClose(); }}>{t("Delete")}</Button> : null}
      <span className={styles.spacer} />
      <Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!name.trim()} onPress={() => void save()}>{t("Save")}</Button>
    </div>}>
    <div className={styles.sheetBody}>
      <TextInput label={t("Name")} isRequired isReadOnly={readOnly} value={name} onChange={setName} />
      <SelectField label={t("Delivered as")} isDisabled={readOnly} selectedKey={supply} onSelectionChange={(key) => setSupply(key as Supply)} items={SUPPLIES.map((id) => ({ id, label: supplies[id] }))} />
      <SelectField label={t("Owner")} isDisabled={readOnly} selectedKey={owner} onSelectionChange={(key) => setOwner(String(key))}
        items={[{ id: NONE, label: t("Nobody") }, ...scope.members.map((member) => ({ id: member.membershipId, label: member.name }))]} />
      <DateField label={t("Due")} isDisabled={readOnly} value={due ? parseDate(due) : null} onChange={(value) => setDue(value ? value.toString() : null)} />
    </div>
  </InspectorSheet>;
}
