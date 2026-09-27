"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { ProjectMaterials } from "./project-materials";
import { SealedDocument } from "./sealed-document";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>) => Promise<boolean>;
type View = "items" | "materials" | "changes" | "sealed";
const VIEWS: View[] = ["items", "materials", "changes", "sealed"];
type Group = "package" | "area";
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
export function ProjectScope({ workspaceId, projectId, version, run }: { workspaceId: string; projectId: string; version: number; run: Run }) {
  const t = useT();
  const format = useProjectFormat();
  const supplies = useSupplyLabels();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [scope, setScope] = useState<LiveScope | null>(null);
  const [error, setError] = useState("");
  const requested = useSearchParams().get("view") as View | null;
  const [view, setView] = useState<View>(requested && VIEWS.includes(requested) ? requested : "items");
  const [group, setGroup] = useState<Group>("package");
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
  const money = (value: string) => format.money(value, scope.currency);
  const active = scope.lines.filter((item) => item.status === "active");
  const omitted = scope.lines.filter((item) => item.status === "omitted");
  const unpackaged = active.filter((item) => !item.packageId);
  const variationLabels = new Set(scope.seals.filter((item) => item.kind === "variation").map((item) => item.revisionLabel));
  const agreed = addAmounts(scope.seals.map((item) => item.total));

  const sections: GroupedTableSection<ScopeLine>[] = group === "package"
    ? [...scope.packages.map((item) => {
        const rows = active.filter((row) => row.packageId === item.id);
        return { id: item.id, label: item.name, rows, emptyMessage: t("No items in this package."),
          headerLabels: { where: supplies[item.supply], quantity: item.ownerName ?? "", amount: money(addAmounts(rows.map((row) => row.net))) } };
      }), ...(unpackaged.length ? [{ id: NONE, label: t("Not in a package"), rows: unpackaged, emptyMessage: "", headerLabels: { where: "", quantity: "", amount: money(addAmounts(unpackaged.map((row) => row.net))) } }] : [])]
    : [...new Map(active.map((row) => [row.areaId ?? NONE, row.areaName ?? t("General")])).entries()].map(([id, label]) => {
        const rows = active.filter((row) => (row.areaId ?? NONE) === id);
        return { id, label, rows, emptyMessage: "", headerLabels: { where: "", quantity: "", amount: money(addAmounts(rows.map((row) => row.net))) } };
      });
  if (omitted.length) sections.push({ id: "omitted", label: t("Removed by variations"), rows: omitted, emptyMessage: "", headerLabels: { where: "", quantity: "", amount: "" } });
  const packageName = (id: string | null) => scope.packages.find((item) => item.id === id)?.name ?? t("Not in a package");
  const columns: GroupedTableColumn<ScopeLine>[] = [
    { id: "item", label: t("Item"), width: "44%", render: (row) => <span className={styles.lineCell} data-omitted={row.status === "omitted" || undefined}>
      <span>{row.title}{variationLabels.has(row.origin) ? <span className={styles.originTag}>{row.origin}</span> : null}</span>
      {row.description ? <small>{row.description}</small> : null}
    </span> },
    { id: "where", label: group === "package" ? t("Area") : t("Package"), width: "22%", mobileHidden: true, render: (row) => <span className={styles.muted}>{group === "package" ? row.areaName ?? t("General") : packageName(row.packageId)}</span> },
    { id: "quantity", label: t("Qty"), width: "16%", render: (row) => <span className={styles.number}>{Number(row.quantity).toLocaleString()} {row.unit}</span> },
    { id: "amount", label: t("Amount"), width: "18%", render: (row) => <span className={styles.number}>{row.status === "omitted" ? "—" : money(row.net)}</span> },
  ];
  const packageOptions = [...scope.packages.map((item) => ({ id: item.id, label: item.name })), { id: NONE, label: t("Not in a package") }];

  return <div className={styles.scopeView}>
    <PillTabs ariaLabel={t("Scope")} selectedKey={view} onSelectionChange={(key) => { setView(key as View); setSeal(null); }}
      items={[{ id: "items", label: t("Items") }, { id: "materials", label: t("Materials") }, { id: "changes", label: t("Changes") }, { id: "sealed", label: t("Sealed") }]} />

    {view === "items" ? <>
      <div className={styles.scopeToolbar}>
        <SegmentedControl label={t("Group by")} value={group} onChange={(value) => setGroup(value as Group)}
          options={[{ id: "package", label: t("By package") }, { id: "area", label: t("By area") }]} />
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
      <p className={styles.agreedLine}><span>{t("Agreed value")}</span><strong>{money(agreed)}</strong></p>
    </> : view === "materials" ? <ProjectMaterials workspaceId={workspaceId} projectId={projectId} version={version} run={run} lines={scope.lines} />
    : view === "changes" ? <Changes workspaceId={workspaceId} projectId={projectId} scope={scope} />
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
        <div><dt>{t("Rate")}</dt><dd>{format.money(current.rate, scope.currency)}</dd></div>
        <div><dt>{t("Amount")}</dt><dd>{current.status === "omitted" ? t("Removed") : format.money(current.net, scope.currency)}</dd></div>
        {current.description ? <div><dt>{t("Description")}</dt><dd>{current.description}</dd></div> : null}
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

const QUOTE_STATUS: Record<string, string> = { draft: "Draft", internal_review: "In review", internal_approved: "Approved internally", issued: "Sent", accepted: "Accepted", changes_requested: "Changes requested", declined: "Declined", expired: "Expired" };

/** The project's variations: drafts, sent, accepted, and what each became once applied. A new one opens in the quotation builder. */
function Changes({ workspaceId, projectId, scope }: { workspaceId: string; projectId: string; scope: LiveScope }) {
  const t = useT();
  const router = useRouter();
  const format = useProjectFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = (quoteId: string) => router.push(`/workspace/projects/${projectId}/changes/${quoteId}`);
  const create = async () => {
    setBusy(true); setError("");
    try { open(await createVariation(workspaceId, scope.caseId, scope.baselineQuoteId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not start a variation.")); setBusy(false); }
  };
  return <div className={styles.changes}>
    <div className={styles.scopeToolbar}>
      <span />
      <Button size="compact" variant="primary" isLoading={busy} onPress={() => void create()}><Plus aria-hidden="true" size={14} />{t("New variation")}</Button>
    </div>
    {error ? <p className={styles.errorLine} role="alert">{error}</p> : null}
    {scope.variations.length ? <ul className={styles.sealList} aria-label={t("Variations")}>
      {scope.variations.map((item) => <li key={item.id}><button type="button" onClick={() => open(item.id)}>
        <span><strong>{item.appliedAs ?? t("Q-{number}", { number: item.number })}</strong> {item.title}</span>
        <span className={styles.muted}>{item.appliedAs ? t("Applied") : QUOTE_STATUS[item.status] ? t(QUOTE_STATUS[item.status] as never) : item.status}</span>
        <span className={styles.number}>{format.money(item.total, scope.currency)}</span>
      </button></li>)}
    </ul> : <EmptyState illustration={null} title={t("No variations yet")} description={t("Changes after the scope is sealed are priced and accepted here.")} />}
  </div>;
}

/** Starts a draft variation of the accepted quotation through the commercial case; returns its id. */
async function createVariation(workspaceId: string, caseId: string, baselineQuoteId: string) {
  const url = `/api/commercial/cases/${caseId}?${new URLSearchParams({ workspaceId })}`;
  const read = async (response: Response) => {
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Could not start a variation.");
    return data as { data: { revision: number; quotes: Array<{ id: string; number: number; kind: string }> } };
  };
  const current = await read(await fetch(url, { cache: "no-store" }));
  const next = await read(await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "variation", revision: current.data.revision, quoteId: baselineQuoteId }) }));
  return [...next.data.quotes].filter((quote) => quote.kind === "variation").sort((a, b) => b.number - a.number)[0].id;
}
