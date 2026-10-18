"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, PageShell, Skeleton } from "@/design-system";
import {
  LEDGER_REPORT_LABELS, LEDGER_REPORTS, STATEMENT_REPORTS, ledgerApi, ledgerPaths, scopeFrom, type AgeingReport, type BalanceSheetReport, type CompanyReport,
  type GeneralLedgerReport, type LedgerApi, type LedgerReportCode, type LedgerScope, type LedgerSection, type ReportEntity, type TrialBalanceReport, type VatReport,
} from "@/lib/books/reports-client";
import { statementScopeFrom, statementsApi, type StatementScope } from "@/lib/books/statements-client";
import { useT } from "@/lib/i18n/i18n-provider";
import { moduleTabs, type ModuleTab } from "../../operations/module-tabs";
import { LedgerAttentionSlot } from "../attention-slot";
import { JournalSheet } from "../journal-sheet";
import { LedgerOverview } from "../overview";
import { ProjectsProfitSlot } from "../projects-profit-slot";
import { LedgerRegion, useLedgerFormat, useLedgerT } from "./ledger-format";
import { JournalsTab, type JournalsSheet, type JournalsView } from "./journals-tab";
import { AccountsTable } from "./ledger-lists";
import { ReportActions, ReportPicker } from "./report-picker";
import { AgeingView, BalanceSheetView, GeneralLedgerView, ReportState, TrialBalanceView, VatView } from "./report-views";
import { CashFlowReport, ProfitAndLossReport } from "./statements";
import { useLoad } from "./use-load";
import styles from "./ledger.module.css";

export type LedgerRoute = { section: LedgerSection; sub: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The address of a place in the Ledger with the company and period it shows (and the project Journals is filtered to). */
export function ledgerHrefFor(route: LedgerRoute, scope: LedgerScope, project = "") {
  switch (route.section) {
    case "overview": return ledgerPaths.overview(scope);
    case "reports": return route.sub ? ledgerPaths.report(route.sub as LedgerReportCode, scope) : ledgerPaths.reports(scope);
    case "journals": {
      const href = route.sub ? ledgerPaths.journal(route.sub, scope) : ledgerPaths.journals(scope);
      return project ? `${href}${href.includes("?") ? "&" : "?"}project=${project}` : href;
    }
    case "accounts": return route.sub ? ledgerPaths.account(route.sub, scope) : ledgerPaths.accounts(scope);
    case "attention": return ledgerPaths.attention(scope);
  }
}

/** A statement's address: its company and period, and its basis and comparison when they aren't the defaults. */
export function statementHref(report: LedgerReportCode, scope: StatementScope) {
  const href = ledgerPaths.report(report, scope);
  const extra = new URLSearchParams();
  if (scope.basis && report === "profit-and-loss") extra.set("basis", scope.basis);
  if (scope.compare && report === "profit-and-loss") extra.set("compare", scope.compare);
  return extra.size ? `${href}${href.includes("?") ? "&" : "?"}${extra}` : href;
}

/** Point-in-time reports: the period's end is the date they're at. */
const AS_AT: readonly LedgerReportCode[] = ["balance-sheet", "ar-ageing", "ap-ageing"];

/**
 * The Ledger area (books.view): Overview · Reports · Journals · Accounts · Needs attention under one title. The
 * company and period live in the address, so a report can be shared, reloaded and printed as seen. A tab changes
 * the address in place; a drill-down (statement → account → journal → source) is a link, so Back returns. Without
 * the Ledger a company still has its P&L and cash flow, read from where its books live.
 */
export function LedgerArea({ workspaceId, section, sub }: { workspaceId: string; section: LedgerSection; sub: string | null }) {
  const t = useLedgerT();
  const translate = useT();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => ledgerApi(workspaceId), [workspaceId]);
  const statements = useMemo(() => statementsApi(workspaceId), [workspaceId]);
  const routeKey = `${section}/${sub ?? ""}`;
  const [state, setState] = useState<{ key: string; route: LedgerRoute }>({ key: routeKey, route: { section, sub } });
  if (state.key !== routeKey) setState({ key: routeKey, route: { section, sub } });
  const route = state.key === routeKey ? state.route : { section, sub };
  const scope = useMemo(() => scopeFrom(params), [params]);
  const statementScope = useMemo(() => statementScopeFrom(params), [params]);
  const project = UUID.test(params.get("project") ?? "") ? params.get("project")! : "";
  const manualId = UUID.test(params.get("manual") ?? "") ? params.get("manual")! : null;
  const overview = useLoad(`overview|${scope.entity}`, (signal) => api.overview(scope.entity, signal));
  // Journals: posted or manual (?view=manual from the home's to-do), and the manual journal editor (a notice opens
  // /workspace/ledger/journals?manual=<id>).
  const manualView = params.get("view") === "manual";
  const journalsKey = `${manualId ?? ""}|${manualView}`;
  const [journals, setJournals] = useState<{ key: string; view: JournalsView; sheet: JournalsSheet }>(
    { key: journalsKey, view: manualId || manualView ? "manual" : "posted", sheet: manualId ? { kind: "editor", journalId: manualId } : null });
  if (journals.key !== journalsKey) {
    setJournals({ key: journalsKey, view: manualId || manualView ? "manual" : journals.view, sheet: manualId ? { kind: "editor", journalId: manualId } : null });
  }

  /** A tab: the address changes in place (the page already holds what it needs). */
  const go = useCallback((next: LedgerRoute) => {
    setState({ key: routeKey, route: next });
    window.history.replaceState(null, "", ledgerHrefFor(next, scope, next.section === "journals" ? project : ""));
  }, [routeKey, scope, project]);
  const setScope = useCallback((next: Partial<LedgerScope>, nextProject = project) => {
    router.replace(ledgerHrefFor(route, { ...scope, ...next }, nextProject), { scroll: false });
  }, [project, route, router, scope]);
  const setSheet = (sheet: JournalsSheet) => {
    setJournals((current) => ({ ...current, sheet }));
    if (!sheet && manualId) router.replace(ledgerHrefFor({ section: "journals", sub: null }, scope, project), { scroll: false });
  };
  const canPost = Boolean(overview.data?.canPost && overview.data.entity);

  const off = overview.data && !overview.data.entity;
  const reports = off ? STATEMENT_REPORTS : LEDGER_REPORTS;
  const report = (route.sub as LedgerReportCode | null) ?? "profit-and-loss";
  const panel = (id: LedgerSection) => {
    if (off && id !== "reports") return <LedgerOverview overview={overview.data!} onEntity={(entity) => setScope({ entity })} />;
    switch (id) {
      case "overview": return overview.data ? <LedgerOverview overview={overview.data} onEntity={(entity) => setScope({ entity, from: "", to: "" })} />
        : <ReportState loading={!overview.error} error={overview.error} onRetry={overview.reload}>{null}</ReportState>;
      case "reports": {
        const onReport = (next: LedgerReportCode) => go({ section: "reports", sub: next });
        if (report === "profit-and-loss" || report === "cash-flow" || off) {
          const shown = reports.includes(report) ? report : "profit-and-loss";
          const onScope = (next: Partial<StatementScope>) => router.replace(statementHref(shown, { ...statementScope, ...next }), { scroll: false });
          const picker = { report: shown, onReport, reports };
          return shown === "cash-flow" ? <CashFlowReport api={statements} scope={statementScope} onScope={onScope} picker={picker} />
            : <ProfitAndLossReport api={statements} scope={statementScope} onScope={onScope} picker={picker} />;
        }
        return <ReportsTab api={api} workspaceId={workspaceId} report={report} scope={scope} entities={overview.data?.entities ?? []} onScope={setScope} onReport={onReport} />;
      }
      case "journals": return <JournalsTab api={api} workspaceId={workspaceId} canPost={canPost} scope={scope} entities={overview.data?.entities ?? []} project={project}
        view={journals.view} sheet={journals.sheet} onScope={setScope} onView={(view) => setJournals((current) => ({ ...current, view }))} onSheet={setSheet}
        onClearProject={() => setScope({}, "")} onOpen={(journalId) => router.push(ledgerHrefFor({ section: "journals", sub: journalId }, scope, project), { scroll: false })} />;
      case "accounts": return route.sub
        ? <AccountTab api={api} accountId={route.sub} scope={scope} entities={overview.data?.entities ?? []} onScope={setScope} />
        : <AccountsTab api={api} scope={scope} entities={overview.data?.entities ?? []} onScope={setScope} />;
      case "attention": return <LedgerAttentionSlot workspaceId={workspaceId} entityId={scope.entity || overview.data?.entity?.id || null} />;
    }
  };
  const { tabs, content } = moduleTabs<LedgerSection>({ t: translate, value: route.section, onChange: (id) => go({ section: id, sub: null }), items: ([
    { id: "overview", label: t("Overview"), panel: panel("overview") },
    { id: "reports", label: t("Reports"), panel: route.section === "reports" ? panel("reports") : null },
    { id: "journals", label: t("Journals"), panel: route.section === "journals" ? panel("journals") : null },
    { id: "accounts", label: t("Accounts"), panel: route.section === "accounts" ? panel("accounts") : null },
    { id: "attention", label: t("Needs attention"), count: overview.data?.openIssues || undefined, panel: route.section === "attention" ? panel("attention") : null },
  ] satisfies Array<ModuleTab<LedgerSection>>) });
  return <>
    <div className={styles.area} data-ledger="">
      <PageShell kind={route.section === "overview" ? "dashboard" : "list"} title={t("Ledger")} tabs={tabs}
        action={route.section === "journals" && canPost ? <Button variant="primary" onPress={() => { setJournals((current) => ({ ...current, view: "manual" })); setSheet({ kind: "editor", journalId: null }); }}>
          {t("New journal")}</Button> : undefined}>{content}</PageShell>
    </div>
    {route.section === "journals" && route.sub ? <JournalSheet api={api} journalId={route.sub} scope={scope}
      onClose={() => router.push(ledgerHrefFor({ section: "journals", sub: null }, scope, project), { scroll: false })} /> : null}
  </>;
}

function entityOf(entities: ReportEntity[], scope: LedgerScope, loaded: ReportEntity | null | undefined) {
  return loaded ?? entities.find((item) => item.id === scope.entity) ?? entities[0] ?? null;
}

/** Reports kept in the Ledger: the picker (report, company, period), the report, CSV and print. */
function ReportsTab({ api, workspaceId, report, scope, entities, onScope, onReport }: {
  api: LedgerApi; workspaceId: string; report: LedgerReportCode; scope: LedgerScope; entities: ReportEntity[];
  onScope: (next: Partial<LedgerScope>) => void; onReport: (report: LedgerReportCode) => void;
}) {
  const t = useLedgerT();
  const company = report === "project-profit" || report === "general-ledger" || report === "profit-and-loss" || report === "cash-flow" ? null : report;
  const load = useLoad(company ? `${company}|${scope.entity}|${scope.from}|${scope.to}` : null, (signal) => api.report<CompanyReport>(company as never, scope, {}, signal));
  const data = load.data;
  const entity = entityOf(entities, scope, data?.entity);
  const shown: LedgerScope = { entity: scope.entity || entity?.id || "", from: scope.from || data?.scope.from || "", to: scope.to || data?.scope.to || "" };
  return <LedgerRegion entity={entity}>
    <ReportPicker report={report} onReport={onReport} entities={entities} entity={entity} scope={shown} onScope={onScope} pointInTime={AS_AT.includes(report)}
      actions={<ReportActions csvHref={company && data ? api.csvHref(company as never, shown) : null} />} />
    <PrintTitle title={t(LEDGER_REPORT_LABELS[report])} entity={entity} scope={shown} pointInTime={AS_AT.includes(report)} />
    {report === "project-profit" ? <ProjectsProfitSlot workspaceId={workspaceId} scope={shown} />
      : <ReportState loading={load.loading} error={load.error} onRetry={load.reload}>{data ? <ReportBody report={data} scope={shown} api={api} /> : null}</ReportState>}
  </LedgerRegion>;
}

function ReportBody({ report, scope, api }: { report: CompanyReport; scope: LedgerScope; api: LedgerApi }) {
  switch (report.report) {
    case "trial-balance": return <TrialBalanceView report={report as TrialBalanceReport} scope={scope} />;
    case "balance-sheet": return <BalanceSheetView report={report as BalanceSheetReport} scope={scope} />;
    case "vat": return <VatView report={report as VatReport} scope={scope} api={api} />;
    case "ar-ageing": case "ap-ageing": return <AgeingView report={report as AgeingReport} scope={scope} />;
    case "general-ledger": return <GeneralLedgerView report={report as GeneralLedgerReport} scope={scope} />;
    default: return null;
  }
}

/** What a printed report says at its top (screens show it in the picker). */
function PrintTitle({ title, entity, scope, pointInTime }: { title: string; entity: ReportEntity | null; scope: LedgerScope; pointInTime: boolean }) {
  const t = useLedgerT();
  const format = useLedgerFormat();
  const period = pointInTime ? t("As at {date}", { date: format.day(scope.to) }) : format.period(scope.from, scope.to);
  return <p className={styles.printTitle}>{[title, entity?.name, period].filter(Boolean).join(" · ")}</p>;
}

function AccountsTab({ api, scope, entities, onScope }: { api: LedgerApi; scope: LedgerScope; entities: ReportEntity[]; onScope: (next: Partial<LedgerScope>) => void }) {
  const load = useLoad(`accounts|${scope.entity}|${scope.from}|${scope.to}`, (signal) => api.accounts(scope, signal));
  const entity = entityOf(entities, scope, load.data?.entity);
  const shown: LedgerScope = { entity: scope.entity || entity?.id || "", from: scope.from || load.data?.scope.from || "", to: scope.to || load.data?.scope.to || "" };
  return <LedgerRegion entity={entity}>
    <ReportPicker entities={entities} entity={entity} scope={shown} onScope={onScope} />
    <AccountsTable list={load.data} error={load.error} scope={shown} onRetry={load.reload} />
  </LedgerRegion>;
}

/** One account's ledger for the period (the general ledger, drilled into from any report). */
function AccountTab({ api, accountId, scope, entities, onScope }: {
  api: LedgerApi; accountId: string; scope: LedgerScope; entities: ReportEntity[]; onScope: (next: Partial<LedgerScope>) => void;
}) {
  const t = useLedgerT();
  const load = useLoad(`account|${accountId}|${scope.entity}|${scope.from}|${scope.to}`, (signal) => api.account(accountId, scope, signal));
  const entity = entityOf(entities, scope, load.data?.entity);
  const shown: LedgerScope = { entity: scope.entity || entity?.id || "", from: scope.from || load.data?.scope.from || "", to: scope.to || load.data?.scope.to || "" };
  return <LedgerRegion entity={entity}>
    <ReportPicker entities={entities.filter((item) => item.id === entity?.id)} entity={entity} scope={shown} onScope={(next) => onScope({ ...next, entity: shown.entity })}
      actions={<ReportActions csvHref={load.data ? api.accountCsvHref(accountId, shown) : null} />} />
    <PrintTitle title={load.data ? `${load.data.account.code} ${load.data.account.name}` : t("General ledger")} entity={entity} scope={shown} pointInTime={false} />
    {load.loading && !load.data ? <Skeleton shape="rows" lines={10} />
      : <ReportState loading={false} error={load.error} onRetry={load.reload}>{load.data ? <GeneralLedgerView report={load.data} scope={shown} /> : null}</ReportState>}
  </LedgerRegion>;
}
