"use client";
/* eslint-disable @next/next/no-img-element -- the tenant's logo comes from its own branding record, printed as it is. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import type { HrmsCrewState, SiteAccess, SiteClearance } from "@wodana/contracts";
import {
  Button, ControlledModalDialog, DataGrid, DocumentTable, EmptyState, ErrorState, IconButton, InlineNotice, NoAccessState, NoResultsState, SegmentedControl, SelectField, Skeleton,
  type DataGridColumn,
} from "@/design-system";
import { useWorkspaceIdentity } from "@/components/workspace/workspace-identity";
import { useT } from "@/lib/i18n/i18n-provider";
import { hrmsApi, type HrmsApi } from "@/lib/hrms/api";
import { HrmsError } from "@/lib/hrms/client";
import { useHrmsFormat } from "./hrms-format";
import { ClearanceStatus, useDocumentKinds } from "./hrms-labels";
import styles from "./hrms.module.css";

type Member = { membershipId: string; name: string };
const rowId = (person: SiteClearance) => `${person.subject.kind}:${person.subject.id}`;

/**
 * Who may go to a project's site: the crews, workers and staff on its list, each person cleared or not by
 * the documents the workspace needs on site. The project's managers change the list; its site supervisors
 * see it. The cleared people print as a gate list.
 */
export function ProjectSiteAccess({ workspaceId, projectId, projectName, members, switcher }: {
  workspaceId: string; projectId: string; projectName: string; members: Member[]; switcher: ReactNode;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const kinds = useDocumentKinds();
  const api = useMemo(() => hrmsApi(workspaceId), [workspaceId]);
  const [access, setAccess] = useState<SiteAccess | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const load = useCallback(async () => {
    try { setAccess(await api.siteAccess(projectId)); setError(null); }
    catch (cause) { setError({ message: format.failure(cause, t("Site access didn't load.")), denied: cause instanceof HrmsError && cause.status === 403 }); }
  }, [api, projectId, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const documents = useCallback((person: SiteClearance) => person.documents.map((document) => [kinds[document.kind], document.number,
    document.expiresOn ? t("until {date}", { date: format.date(document.expiresOn) }) : ""].filter(Boolean).join(" ")).join(" · "), [kinds, format, t]);
  const columns = useMemo<DataGridColumn<SiteClearance>[]>(() => [
    { id: "name", header: t("Name"), accessorFn: (row) => row.name, size: 240, meta: { primary: true,
      renderCell: (row) => <span className={styles.nameCell}><span>{row.name}</span>{row.detail ? <small>{row.detail}</small> : null}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => (row.cleared ? 0 : 1), size: 220, meta: { renderCell: (row) => <ClearanceStatus person={row} /> } },
    { id: "documents", header: t("Documents"), accessorFn: (row) => documents(row), size: 320, meta: { mobileHidden: true } },
  ], [t, documents]);
  if (error && !access) return <><div className={styles.toolbar}>{switcher}</div>
    {error.denied ? <NoAccessState /> : <ErrorState description={error.message} onRetry={() => void load()} />}</>;
  const needle = search.trim().toLocaleLowerCase();
  // Who can't go yet comes first.
  const rows = (access?.people ?? []).filter((person) => !needle || `${person.name} ${person.detail}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(a.cleared) - Number(b.cleared) || a.name.localeCompare(b.name));
  const cleared = (access?.people ?? []).filter((person) => person.cleared).sort((a, b) => a.name.localeCompare(b.name));
  const actions = access ? <>
    <Button isDisabled={!cleared.length} onPress={() => setPrinting(true)}><Printer aria-hidden="true" size={14} />{t("Print")}</Button>
    {access.canManage ? <Button variant="primary" onPress={() => setEditing(true)}>{t("Edit list")}</Button> : null}
  </> : undefined;
  return <>
    <DataGrid<SiteClearance> ariaLabel={t("Site access")} columns={columns} data={rows} getRowId={rowId} isLoading={!access}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search people")} rowNumbers={false} selectable={false} wrapText toolbarLeading={switcher} toolbarActions={actions}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No one on this site's list yet")} />} />
    {access && editing ? <SiteListDialog api={api} access={access} members={members} onChanged={setAccess} onClose={() => setEditing(false)} /> : null}
    {access && printing ? <GateList access={access} people={cleared} projectName={projectName} documents={documents} onDone={() => setPrinting(false)} /> : null}
  </>;
}

type AddKind = "crew" | "worker" | "member";

/** The site's list: the crews, workers and staff on it, each removable, and one more added at a time. */
function SiteListDialog({ api, access, members, onChanged, onClose }: {
  api: HrmsApi; access: SiteAccess; members: Member[]; onChanged: (access: SiteAccess) => void; onClose: () => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const [crews, setCrews] = useState<HrmsCrewState | null>(null);
  const [kind, setKind] = useState<AddKind>("crew");
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.crews().then((state) => { if (live) setCrews(state); }).catch(() => { if (live) setCrews({ crews: [], workers: [], canManage: false }); });
    return () => { live = false; };
  }, [api]);
  const listed = new Set(access.entries.flatMap((entry) => [entry.crewId, entry.workerId, entry.membershipId]).filter(Boolean));
  const options = kind === "crew" ? (crews?.crews ?? []).filter((crew) => crew.active && !listed.has(crew.id)).map((crew) => ({ id: crew.id, label: crew.name, description: crew.trade }))
    : kind === "worker" ? (crews?.workers ?? []).filter((worker) => worker.active && !listed.has(worker.id)).map((worker) => ({ id: worker.id, label: worker.name,
      description: [worker.workerCode, worker.trade].filter(Boolean).join(" · ") || undefined }))
    : members.filter((member) => !listed.has(member.membershipId)).map((member) => ({ id: member.membershipId, label: member.name }));
  const run = async (key: string, work: () => Promise<SiteAccess>) => {
    setBusy(key); setError("");
    try { onChanged(await work()); if (key === "add") setChosen(null); } catch (cause) { setError(format.failure(cause, t("Could not save."))); }
    setBusy(null);
  };
  const what = (entry: SiteAccess["entries"][number]) => (entry.crewId ? t("Crew") : entry.workerId ? t("Crew worker") : t("Staff"));
  return <ControlledModalDialog isOpen size="md" title={t("Site list")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Done")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {access.entries.length ? <ul className={styles.list} aria-label={t("On the list")}>{access.entries.map((entry) => <li key={entry.id}>
        <span className={styles.grow}><span>{entry.name}</span><small>{what(entry)}</small></span>
        <IconButton aria-label={t("Remove {name}", { name: entry.name })} size="compact" variant="quiet" isDisabled={Boolean(busy)}
          onPress={() => void run(entry.id, () => api.removeSiteAccess(entry.id))}><X aria-hidden="true" size={14} /></IconButton>
      </li>)}</ul> : <p className={styles.muted}>{t("No one on this site's list yet")}</p>}
      <div className={styles.part}>
        <SegmentedControl label={t("Add")} value={kind} onChange={(value) => { setKind(value as AddKind); setChosen(null); }}
          options={[{ id: "crew", label: t("Crew") }, { id: "worker", label: t("Crew worker") }, { id: "member", label: t("Staff") }]} />
        {kind !== "member" && !crews ? <Skeleton lines={1} /> : <div className={styles.addRow}>
          <SelectField label={kind === "crew" ? t("Crew") : kind === "worker" ? t("Crew worker") : t("Staff")} placeholder={t("Choose")} selectedKey={chosen} items={options}
            onSelectionChange={(key) => setChosen(key ? String(key) : null)} />
          <Button isLoading={busy === "add"} isDisabled={!chosen || Boolean(busy)} onPress={() => void run("add", () => api.addSiteAccess({ projectId: access.projectId,
            crewId: kind === "crew" ? chosen : null, workerId: kind === "worker" ? chosen : null, membershipId: kind === "member" ? chosen : null }))}>{t("Add")}</Button>
        </div>}
      </div>
    </div>
  </ControlledModalDialog>;
}

/**
 * The gate list: who is cleared for the site today with the numbers of the documents it needs, under the
 * workspace's own name and logo. Printed on its own; the page stays as it was.
 */
function GateList({ access, people, projectName, documents, onDone }: {
  access: SiteAccess; people: SiteClearance[]; projectName: string; documents: (person: SiteClearance) => string; onDone: () => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const identity = useWorkspaceIdentity();
  const finish = useRef(onDone);
  useEffect(() => { finish.current = onDone; }, [onDone]);
  // Printed once, as soon as it's on the page; closing the print dialog takes it away again.
  useEffect(() => {
    const done = () => finish.current();
    window.addEventListener("afterprint", done);
    const timer = window.setTimeout(() => { try { window.print(); } catch { done(); } }, 0);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, []);
  return createPortal(<section className={styles.gateList} aria-label={t("Gate list")}>
    <header>
      {identity?.logoUrl ? <img src={identity.logoUrl} alt={identity.name} /> : null}
      <div>
        <strong>{identity?.name}</strong>
        <h1>{projectName}</h1>
        <p>{t("Cleared for site on {date}", { date: format.longDay(access.day) })}</p>
      </div>
    </header>
    <DocumentTable label={t("Gate list")} rows={people} getRowKey={(person) => rowId(person)}
      columns={[
        { id: "name", header: t("Name"), cell: (person) => person.name },
        { id: "role", header: t("Role"), cell: (person) => person.detail },
        { id: "documents", header: t("Documents"), cell: (person) => documents(person) },
      ]} />
  </section>, document.body);
}
