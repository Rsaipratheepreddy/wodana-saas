"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { HrmsBootstrap } from "@wodana/contracts";
import { Button, EmptyState, ErrorState, NoAccessState, PageShell, PageSkeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { hrmsApi } from "@/lib/hrms/api";
import { hrmsHref, type HrmsSection } from "@/lib/hrms/sections";
import { AttendanceTab } from "./attendance-tab";
import { CheckInDialog, useAttendance, type CaptureKind } from "./check-in";
import { LinkedCrewDay } from "./crew-days";
import { CrewsTab, type CrewView } from "./crews-tab";
import { DocumentsTab } from "./documents-tab";
import { useHrmsFormat } from "./hrms-format";
import { LeaveTab } from "./leave-tab";
import { PayrollTab } from "./payroll-tab";
import { PeopleTab } from "./people-tab";
import { TeamTab } from "./team-tab";
import { TimeTab } from "./time-tab";
import { moduleTabs, type ModuleTab } from "../operations/module-tabs";

/**
 * People › Attendance & leave: my attendance (today and my days), my hours, my leave, documents, my team's day and what waits
 * for my decision, everyone's HR record, the crews without logins and the month's payroll. Tabs follow what
 * the person may do; records open in place from the address.
 */
/** Over six tabs (someone who runs HR sees eight), the occasional ones sit under "More": my hours, documents and the month's payroll. */
const MORE: HrmsSection[] = ["time", "documents", "payroll"];

export function HrmsPage({ workspaceId, section }: { workspaceId: string; section: HrmsSection }) {
  const t = useT();
  const format = useHrmsFormat();
  const router = useRouter();
  const params = useSearchParams();
  const api = useMemo(() => hrmsApi(workspaceId), [workspaceId]);
  const [boot, setBoot] = useState<HrmsBootstrap | null>(null);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState<CaptureKind | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [crewView, setCrewView] = useState<CrewView>(() => (params.get("worker") ? "workers" : "crews"));
  const [creating, setCreating] = useState<CrewView | null>(null);
  const [newDocument, setNewDocument] = useState(false);
  // Crew leads without a team or HR role see crews too; only the crews list itself can tell.
  const [leadsCrew, setLeadsCrew] = useState<boolean | null>(null);
  const load = useCallback(async () => {
    try { setBoot(await api.bootstrap()); setError(""); } catch (cause) { setError(format.failure(cause, t("People didn't load."))); }
  }, [api, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const crewRole = Boolean(boot && (boot.permissions.manage || boot.permissions.team || boot.permissions.manageProjects));
  useEffect(() => {
    if (!boot || crewRole) return;
    let live = true;
    api.crews().then(() => { if (live) setLeadsCrew(true); }).catch(() => { if (live) setLeadsCrew(false); });
    return () => { live = false; };
  }, [api, boot, crewRole]);
  const attendance = useAttendance(api, workspaceId, boot);
  const go = (next: HrmsSection, open: Record<string, string | null | undefined> = {}) => router.replace(hrmsHref(next, open), { scroll: false });

  if (!boot) return error ? <PageShell title={t("Attendance & leave")}><ErrorState description={error} onRetry={() => void load()} /></PageShell>
    : <PageSkeleton variant="list" tabs={6} columns={6} />;
  const { permissions } = boot;
  const employee = boot.employee?.enabled ? boot.employee : null;
  const notTracked = <EmptyState title={t("Attendance and leave aren't on for you")} />;
  const blocked = attendance.current === undefined || attendance.storage !== "ready" || Boolean(attendance.pending) || attendance.busy;
  // One primary action, for the tab it belongs to.
  const action = section === "attendance" && employee ? <>
    {attendance.checkedIn ? <Button isDisabled={blocked} onPress={() => setCapturing("switch")}>{t("Switch place")}</Button> : null}
    <Button variant="primary" isDisabled={blocked} onPress={() => setCapturing(attendance.checkedIn ? "check_out" : "check_in")}>{attendance.checkedIn ? t("Check out") : t("Check in")}</Button>
  </> : section === "leave" && employee ? <Button variant="primary" onPress={() => setRequesting(true)}>{t("Request leave")}</Button>
    : section === "crews" && permissions.manage ? <Button variant="primary" onPress={() => setCreating(crewView)}>{crewView === "workers" ? t("New worker") : t("New crew")}</Button>
    : section === "documents" && permissions.manage ? <Button variant="primary" onPress={() => setNewDocument(true)}>{t("New document")}</Button>
    : undefined;
  const openDocument = (document: string) => go("documents", { document });
  const crewDay = params.get("crewDay");
  const items: Array<ModuleTab<HrmsSection>> = [
    ...(permissions.self ? [
      { id: "attendance" as const, label: t("Attendance"), panel: employee ? <AttendanceTab api={api} employee={employee} attendance={attendance} openDay={params.get("day")}
        onOpenDay={(day) => go("attendance", { day })} /> : notTracked },
      { id: "time" as const, label: t("Time"), panel: employee ? <TimeTab api={api} employee={employee} date={params.get("week")} onDate={(week) => go("time", { week })} /> : notTracked },
      { id: "leave" as const, label: t("Leave"), panel: employee ? <LeaveTab api={api} employee={employee} requesting={requesting} onRequestDone={() => setRequesting(false)}
        openId={params.get("request")} onOpen={(request) => go("leave", { request })} /> : notTracked },
    ] : []),
    ...(permissions.self || permissions.manage ? [{ id: "documents" as const, label: t("Documents"), panel: <DocumentsTab api={api} boot={boot} creating={newDocument}
      onCreateDone={() => setNewDocument(false)} openId={params.get("document")} onOpen={(document) => go("documents", { document })} /> }] : []),
    ...(permissions.team || permissions.manage ? [{ id: "team" as const, label: t("Team"), panel: <TeamTab api={api} boot={boot}
      open={{ leave: params.get("leave"), review: params.get("review"), timesheet: params.get("timesheet") }}
      onOpen={(open) => go("team", { leave: params.get("leave"), review: params.get("review"), timesheet: params.get("timesheet"), ...open })} /> }] : []),
    ...(permissions.manage ? [{ id: "people" as const, label: t("HR records"), panel: <PeopleTab api={api} boot={boot} openId={params.get("person")} onOpen={(person) => go("people", { person })}
      onOpenDocument={openDocument} /> }] : []),
    ...(crewRole || leadsCrew ? [{ id: "crews" as const, label: t("Crews"), panel: <>
      <CrewsTab api={api} boot={boot} workspaceId={workspaceId} view={crewView} onView={(view) => { setCrewView(view); setCreating(null); }} creating={creating} onCreate={setCreating}
        open={{ crew: params.get("crew"), worker: params.get("worker") }} onOpen={(open) => go("crews", { crew: params.get("crew"), worker: params.get("worker"), ...open })}
        onOpenDocument={openDocument} />
      {crewDay ? <LinkedCrewDay key={crewDay} api={api} boot={boot} id={crewDay} onClose={() => go("crews")} /> : null}
    </> }] : []),
    ...(permissions.manage ? [{ id: "payroll" as const, label: t("Payroll"), panel: <PayrollTab api={api} boot={boot} /> }] : []),
  ];
  const { tabs, content } = moduleTabs<HrmsSection>({ t, value: section, onChange: (key) => go(key), more: MORE, items });
  const allowed = items.some((item) => item.id === section);
  return <PageShell title={t("Attendance & leave")} action={allowed ? action : undefined} tabs={allowed ? tabs : undefined}>
    {allowed ? content : section === "crews" && leadsCrew === null && !crewRole ? <PageSkeleton variant="list" columns={6} /> : <NoAccessState />}
    {capturing && employee ? <CheckInDialog api={api} employee={employee} kind={capturing} attendance={attendance} onClose={() => setCapturing(null)} /> : null}
  </PageShell>;
}
