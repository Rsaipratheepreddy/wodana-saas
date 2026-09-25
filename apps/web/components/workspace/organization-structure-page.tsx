"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useMemo, useState, type FormEvent } from "react";
import { Building2, Network, Pencil, Plus, RotateCcw, Users } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Checkbox,
  ConfirmationDialog,
  ControlledModalDialog,
  DesignSystemProvider,
  EmptyState,
  Form,
  IconButton,
  IconMenuButton,
  InspectorSheet,
  MultiSelectField,
  SelectField,
  Surface,
  Tabs,
  TextAreaField,
  TextInput,
} from "@/design-system";
import type { BusinessUnitRecord } from "@/lib/workspace/company-profile";
import type { WorkspaceConfigurationRevision } from "@/lib/workspace/company-profile";
import type {
  OrganizationStructurePageData,
  WorkspaceTeamRecord,
} from "@/lib/workspace/organization-structure";
import styles from "./organization-structure-page.module.css";

type ArchiveTarget =
  | { kind: "unit"; item: BusinessUnitRecord }
  | { kind: "team"; item: WorkspaceTeamRecord };

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function OrganizationStructurePage({ initialData }: { initialData: OrganizationStructurePageData }) {
  const t = useT();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [units, setUnits] = useState(initialData.businessUnits);
  const [teams, setTeams] = useState(initialData.teams);
  const [editingUnit, setEditingUnit] = useState<BusinessUnitRecord | "new" | null>(null);
  const [editingTeam, setEditingTeam] = useState<WorkspaceTeamRecord | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState("");
  const [activeView, setActiveView] = useState("teams");
  const [historyTeam, setHistoryTeam] = useState<WorkspaceTeamRecord | null>(null);
  const [revisions, setRevisions] = useState<WorkspaceConfigurationRevision[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [rollbackTarget, setRollbackTarget] = useState<WorkspaceConfigurationRevision | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);

  const unitsById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const entityNames = useMemo(
    () => new Map(initialData.legalEntities.map((entity) => [entity.id, entity.displayName])),
    [initialData.legalEntities],
  );

  const archive = async () => {
    if (!archiveTarget) return;
    setIsArchiving(true);
    setFailure("");
    const path = archiveTarget.kind === "unit"
      ? `/api/workspace/business-units/${archiveTarget.item.id}/archive`
      : `/api/workspace/teams/${archiveTarget.item.id}/archive`;
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: initialData.workspaceId, version: archiveTarget.item.version }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The item could not be archived."));
      if (archiveTarget.kind === "unit") {
        setUnits((current) => current.filter((unit) => unit.id !== archiveTarget.item.id));
      } else {
        setTeams((current) => current.filter((team) => team.id !== archiveTarget.item.id));
      }
      setStatus(`${archiveTarget.item.name} was archived.`);
      setArchiveTarget(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The item could not be archived.");
      setArchiveTarget(null);
    } finally {
      setIsArchiving(false);
    }
  };

  const openTeamHistory = async (team: WorkspaceTeamRecord) => {
    setHistoryTeam(team);
    setHistoryError("");
    try {
      const response = await fetch(`/api/workspace/teams/${team.id}/history?workspaceId=${encodeURIComponent(initialData.workspaceId)}`);
      if (!response.ok) throw new Error(await responseMessage(response, "Team history could not be loaded."));
      setRevisions(await response.json() as WorkspaceConfigurationRevision[]);
    } catch (error) {
      setRevisions([]);
      setHistoryError(error instanceof Error ? error.message : "Team history could not be loaded.");
    }
  };

  const rollbackTeam = async () => {
    if (!historyTeam || !rollbackTarget || isRollingBack) return;
    setIsRollingBack(true);
    setHistoryError("");
    try {
      const current = teams.find((team) => team.id === historyTeam.id) ?? historyTeam;
      const response = await fetch(`/api/workspace/teams/${historyTeam.id}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: initialData.workspaceId, version: current.version, revisionId: rollbackTarget.id }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The team revision could not be restored."));
      const saved = await response.json() as WorkspaceTeamRecord;
      setTeams((items) => saved.status === "active" ? [saved, ...items.filter((item) => item.id !== saved.id)] : items.filter((item) => item.id !== saved.id));
      setHistoryTeam(saved);
      setRollbackTarget(null);
      setStatus(`${saved.name} was restored from history.`);
      await openTeamHistory(saved);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "The team revision could not be restored.");
      setRollbackTarget(null);
    } finally {
      setIsRollingBack(false);
    }
  };

  const businessUnitsPanel = !units.length
    ? <EmptyState description={t("Create the first studio, branch, or department.")} icon={<Building2 size={20} />} title={t("No business units")} />
    : <div className={styles.cardList}>
      {units.map((unit) => {
        const parent = unit.parentBusinessUnitId ? unitsById.get(unit.parentBusinessUnitId) : null;
        const teamCount = teams.filter((team) => team.businessUnitId === unit.id).length;
        return <Surface as="article" className={styles.unitCard} key={unit.id} tone="subtle">
          <div className={styles.cardMain}>
            <span className={styles.cardIcon}><Building2 aria-hidden="true" size={17} /></span>
            <div className={styles.cardBody}>
              <div className={styles.cardTitle}><strong>{unit.name}</strong><small>{unit.code}</small></div>
              <p>{titleCase(unit.type)} · {entityNames.get(unit.legalEntityId) ?? "Legal entity"}</p>
            </div>
            {initialData.canManage ? <IconMenuButton ariaLabel={`Actions for ${unit.name}`} items={[{ id: "edit", label: "Edit business unit" }, { id: "archive", label: "Archive", tone: "danger" }]} onAction={(action) => action === "edit" ? setEditingUnit(unit) : setArchiveTarget({ kind: "unit", item: unit })} /> : null}
          </div>
          <div className={styles.cardFooter}><span>{parent ? `Under ${parent.name}` : "Top level"}</span><span>{unit.timezone}</span><span>{teamCount} {t("team")}{teamCount === 1 ? "" : "s"}</span></div>
        </Surface>;
      })}
    </div>;

  const teamsPanel = !units.length
    ? <EmptyState description={t("Create a business unit before adding teams.")} icon={<Network size={20} />} title={t("Business unit required")} />
    : !teams.length
      ? <EmptyState action={initialData.canManage ? <Button onPress={() => setEditingTeam("new")}><Plus size={14} />{t("Create team")}</Button> : null} description={t("Group members under a business unit.")} icon={<Network size={20} />} title={t("No teams yet")} />
      : <div className={styles.cardList}>
        {teams.map((team) => {
          const lead = team.members.find((member) => member.isLead);
          const access = (team.roleIds ?? []).map((id) => initialData.roles.find((role) => role.id === id)?.name).filter(Boolean);
          const routing = (team.queueIds ?? []).map((id) => initialData.queues.find((queue) => queue.id === id)?.name).filter(Boolean);
          return <Surface as="article" className={styles.teamCard} key={team.id} tone="subtle">
            <div className={styles.cardMain}>
              <span className={styles.cardIcon}><Network aria-hidden="true" size={17} /></span>
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}><strong>{team.name}</strong><small>{team.code}</small></div>
                <p>{[access.length ? `${access.join(", ")} access` : null, routing.length ? `${routing.join(", ")} enquiries` : null, team.description].filter(Boolean).join(" · ") || "No access or enquiry routing set"}</p>
              </div>
              {initialData.canManage ? <IconMenuButton ariaLabel={`Actions for ${team.name}`} items={[{ id: "edit", label: "Edit team" }, { id: "history", label: "History" }, { id: "archive", label: "Archive", tone: "danger" }]} onAction={(action) => action === "edit" ? setEditingTeam(team) : action === "history" ? void openTeamHistory(team) : setArchiveTarget({ kind: "team", item: team })} /> : null}
            </div>
            <div className={styles.cardFooter}>
              <div className={styles.memberControls}>
                <div aria-label={`${team.members.length} team members`} className={styles.avatars}>{team.members.slice(0, 4).map((member) => <Avatar key={member.membershipId} name={member.displayName} size="sm" />)}{team.members.length > 4 ? <span>+{team.members.length - 4}</span> : null}</div>
                {initialData.canManage ? <IconButton aria-label={`Edit members in ${team.name}`} onPress={() => setEditingTeam(team)} size="standard"><Pencil aria-hidden="true" size={14} /></IconButton> : null}
              </div>
              <span>{unitsById.get(team.businessUnitId)?.name ?? "Business unit"} · {lead ? `${lead.displayName}, lead` : `${team.members.length} member${team.members.length === 1 ? "" : "s"}`}</span>
            </div>
          </Surface>;
        })}
      </div>;

  return (
    <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
      <section aria-label={t("Teams and departments")} className={styles.page}>

        <section aria-label={t("Organization structure summary")} className={styles.actionStrip}>
          <div className={styles.summary}>
            <span><Network aria-hidden="true" size={16} /><strong>{teams.length}</strong> {t("team")}{teams.length === 1 ? "" : "s"}</span>
            <span><Building2 aria-hidden="true" size={16} /><strong>{units.length}</strong> {t("department")}{units.length === 1 ? "" : "s"}</span>
            <span><Users aria-hidden="true" size={16} /><strong>{initialData.members.length}</strong> {t("member")}{initialData.members.length === 1 ? "" : "s"}</span>
          </div>
          {initialData.canManage ? <div className={styles.actions}>
            <Button isDisabled={!units.length} onPress={() => setEditingTeam("new")} variant="primary"><Plus aria-hidden="true" size={14} />{t("Team")}</Button>
            <Button onPress={() => setEditingUnit("new")}><Plus aria-hidden="true" size={14} />{t("Department")}</Button>
          </div> : null}
        </section>

        {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
        {failure ? <Callout title={t("Organization action failed")} tone="danger">{failure}</Callout> : null}

        <div className={styles.organizationTabs}>
          <Tabs
            items={[
              { id: "teams", label: `Teams (${teams.length})`, panel: teamsPanel },
              { id: "units", label: `Business units (${units.length})`, panel: businessUnitsPanel },
            ]}
            onSelectionChange={setActiveView}
            selectedKey={activeView}
          />
        </div>
        {!initialData.canManage ? <p className={styles.permissionNote}>{t("Only workspace owners and administrators can change organization structure.")}</p> : null}
      </section>

      <UnitDialog initialData={initialData} item={editingUnit} key={editingUnit === "new" ? "unit-new" : editingUnit?.id ?? "unit-closed"} onClose={() => setEditingUnit(null)} onSaved={(unit) => { setUnits((current) => [unit, ...current.filter((item) => item.id !== unit.id)]); setEditingUnit(null); setStatus(`${unit.name} was saved.`); }} units={units} />
      <TeamDialog initialData={initialData} item={editingTeam} key={editingTeam === "new" ? "team-new" : editingTeam?.id ?? "team-closed"} onClose={() => setEditingTeam(null)} onSaved={(team) => { setTeams((current) => [team, ...current.filter((item) => item.id !== team.id)]); setEditingTeam(null); setStatus(`${team.name} was saved.`); }} units={units} />
      <InspectorSheet isOpen={Boolean(historyTeam)} onOpenChange={(open) => { if (!open && !isRollingBack) setHistoryTeam(null); }} size="sm" title={historyTeam ? `${historyTeam.name} history` : "Team history"} description={t("Member access, inherited roles, and enquiry queues are versioned together.")}>
        {historyError ? <Callout title={t("Team history unavailable")} tone="danger">{historyError}</Callout> : null}
        {!historyError && !revisions.length ? <p className={styles.historyStatus}>{t("No saved changes yet.")}</p> : null}
        {revisions.length ? <ol className={styles.historyList}>{revisions.map((revision, index) => <li key={revision.id}><div><strong>{t("Revision")}{" "}{revision.revisionNumber}</strong>{index === 0 ? <Badge tone="neutral">{t("Current")}</Badge> : null}</div><small>{new Date(revision.createdAt).toLocaleString()} · {revision.changes.length} {t("changed")}{" "}{revision.changes.length === 1 ? "field" : "fields"}</small>{index ? <Button isDisabled={isRollingBack} onPress={() => setRollbackTarget(revision)} size="compact" variant="quiet"><RotateCcw aria-hidden="true" size={14} />{t("Restore")}</Button> : null}</li>)}</ol> : null}
      </InspectorSheet>
      <ConfirmationDialog body={archiveTarget ? <>{t("Archive")}{" "}<strong>{archiveTarget.item.name}</strong>{t("? It will disappear from active organization structure.")}</> : null} confirmLabel={isArchiving ? "Archiving…" : "Archive"} isOpen={Boolean(archiveTarget)} onConfirm={() => void archive()} onOpenChange={(open) => { if (!open && !isArchiving) setArchiveTarget(null); }} title={`Archive ${archiveTarget?.kind ?? "item"}?`} />
      <ConfirmationDialog body="The selected team members, lead, inherited roles, and enquiry queues will become current. The existing configuration stays in history." confirmLabel={isRollingBack ? "Restoring…" : "Restore revision"} isOpen={Boolean(rollbackTarget)} onConfirm={() => void rollbackTeam()} onOpenChange={(open) => { if (!open && !isRollingBack) setRollbackTarget(null); }} title={t("Restore this team revision?")} />
    </DesignSystemProvider>
  );
}

function UnitDialog({ initialData, item, onClose, onSaved, units }: { initialData: OrganizationStructurePageData; item: BusinessUnitRecord | "new" | null; onClose: () => void; onSaved: (unit: BusinessUnitRecord) => void; units: BusinessUnitRecord[] }) {
  const t = useT();
  const existing = item && item !== "new" ? item : null;
  const defaultEntity = existing?.legalEntityId ?? initialData.legalEntities[0]?.id ?? "";
  const [name, setName] = useState(existing?.name ?? "");
  const [code, setCode] = useState(existing?.code ?? "");
  const [legalEntityId, setLegalEntityId] = useState(defaultEntity);
  const [parentId, setParentId] = useState(existing?.parentBusinessUnitId ?? "none");
  const [type, setType] = useState(existing?.type ?? "studio");
  const [timezone, setTimezone] = useState(existing?.timezone ?? initialData.legalEntities.find((entity) => entity.id === defaultEntity)?.timezone ?? "Asia/Dubai");
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const formId = `business-unit-${existing?.id ?? "new"}`;
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setFailure(""); try { const response = await fetch(existing ? `/api/workspace/business-units/${existing.id}` : "/api/workspace/business-units", { method: existing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: initialData.workspaceId, ...(existing ? { version: existing.version } : { code }), legalEntityId, parentBusinessUnitId: parentId === "none" ? null : parentId, name, type, timezone }) }); if (!response.ok) throw new Error(await responseMessage(response, "The business unit could not be saved.")); onSaved(await response.json() as BusinessUnitRecord); } catch (error) { setFailure(error instanceof Error ? error.message : "The business unit could not be saved."); } finally { setSaving(false); } };
  return <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>{t("Cancel")}</Button><Button form={formId} isLoading={saving} type="submit" variant="primary">{t("Save business unit")}</Button></div>} isDismissable={!saving} isOpen={Boolean(item)} onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={existing ? "Edit business unit" : "Create business unit"}><Form className={styles.form} id={formId} onSubmit={save}>{failure ? <Callout title={t("Could not save business unit")} tone="danger">{failure}</Callout> : null}<div className={styles.formColumns}><TextInput isRequired label={t("Name")} onChange={setName} placeholder={t("Design Studio")} value={name} /><TextInput isDisabled={Boolean(existing)} isRequired label={t("Code")} onChange={setCode} placeholder={t("DESIGN")} value={code} /></div><div className={styles.formColumns}><SelectField items={initialData.legalEntities.map((entity) => ({ id: entity.id, label: entity.displayName }))} label={t("Legal entity")} onSelectionChange={(key) => key && setLegalEntityId(String(key))} selectedKey={legalEntityId} /><SelectField items={[{ id: "studio", label: "Studio" }, { id: "department", label: "Department" }, { id: "branch", label: "Branch" }, { id: "division", label: "Division" }]} label={t("Unit type")} onSelectionChange={(key) => key && setType(String(key))} selectedKey={type} /></div><SelectField items={[{ id: "none", label: "Top level" }, ...units.filter((unit) => unit.id !== existing?.id && unit.legalEntityId === legalEntityId).map((unit) => ({ id: unit.id, label: unit.name }))]} label={t("Parent business unit")} onSelectionChange={(key) => key && setParentId(String(key))} selectedKey={parentId} /><TextInput isRequired label={t("Time zone")} onChange={setTimezone} value={timezone} /></Form></ControlledModalDialog>;
}

function TeamDialog({ initialData, item, onClose, onSaved, units }: { initialData: OrganizationStructurePageData; item: WorkspaceTeamRecord | "new" | null; onClose: () => void; onSaved: (team: WorkspaceTeamRecord) => void; units: BusinessUnitRecord[] }) {
  const t = useT();
  const existing = item && item !== "new" ? item : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [code, setCode] = useState(existing?.code ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [unitId, setUnitId] = useState(existing?.businessUnitId ?? units[0]?.id ?? "");
  const [memberIds, setMemberIds] = useState(() => new Set(existing?.members.map((member) => member.membershipId) ?? []));
  const [leadId, setLeadId] = useState(existing?.members.find((member) => member.isLead)?.membershipId ?? "none");
  const [roleIds, setRoleIds] = useState(() => new Set(existing?.roleIds ?? []));
  const [queueIds, setQueueIds] = useState(() => new Set(existing?.queueIds ?? []));
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const formId = `team-${existing?.id ?? "new"}`;
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setFailure(""); try { const response = await fetch(existing ? `/api/workspace/teams/${existing.id}` : "/api/workspace/teams", { method: existing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: initialData.workspaceId, ...(existing ? { version: existing.version } : { code }), businessUnitId: unitId, name, description, memberIds: Array.from(memberIds), leadMembershipId: leadId === "none" ? null : leadId, roleIds: Array.from(roleIds), queueIds: Array.from(queueIds) }) }); if (!response.ok) throw new Error(await responseMessage(response, "The team could not be saved.")); onSaved(await response.json() as WorkspaceTeamRecord); } catch (error) { setFailure(error instanceof Error ? error.message : "The team could not be saved."); } finally { setSaving(false); } };
  return <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>{t("Cancel")}</Button><Button form={formId} isLoading={saving} type="submit" variant="primary">{t("Save team")}</Button></div>} isDismissable={!saving} isOpen={Boolean(item)} onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={existing ? "Edit team" : "Create team"}>
    <Form className={styles.form} id={formId} onSubmit={save}>
      {failure ? <Callout title={t("Could not save team")} tone="danger">{failure}</Callout> : null}
      <div className={styles.formColumns}><TextInput isRequired label={t("Team name")} onChange={setName} placeholder={t("Sales")} value={name} /><TextInput isDisabled={Boolean(existing)} isRequired label={t("Code")} onChange={setCode} placeholder={t("SALES")} value={code} /></div>
      <SelectField items={units.map((unit) => ({ id: unit.id, label: unit.name }))} label={t("Department")} onSelectionChange={(key) => key && setUnitId(String(key))} selectedKey={unitId} />
      <MultiSelectField items={initialData.roles.filter((role) => !["owner", "administrator"].includes(role.code)).map((role) => ({ id: role.id, label: role.name }))} label={t("Access inherited by this team")} onSelectionChange={(keys) => setRoleIds(new Set(Array.from(keys, String)))} selectedKeys={roleIds} />
      <MultiSelectField items={initialData.queues.map((queue) => ({ id: queue.id, label: queue.name }))} label={t("Enquiry queues for this team")} onSelectionChange={(keys) => setQueueIds(new Set(Array.from(keys, String)))} selectedKeys={queueIds} />
      <fieldset className={styles.memberChoices}><legend>{t("Members")}</legend><div>{initialData.members.map((member) => <Checkbox isSelected={memberIds.has(member.id)} key={member.id} onChange={(checked) => { const next = new Set(memberIds); if (checked) next.add(member.id); else { next.delete(member.id); if (leadId === member.id) setLeadId("none"); } setMemberIds(next); }}><span><strong>{member.displayName}</strong><small>{member.email}</small></span></Checkbox>)}</div></fieldset>
      <SelectField items={[{ id: "none", label: "No team lead" }, ...initialData.members.filter((member) => memberIds.has(member.id)).map((member) => ({ id: member.id, label: member.displayName }))]} label={t("Team lead")} onSelectionChange={(key) => key && setLeadId(String(key))} selectedKey={leadId} />
      <TextAreaField label={t("Description")} onChange={setDescription} placeholder={t("What this team owns")} value={description} />
    </Form>
  </ControlledModalDialog>;
}
