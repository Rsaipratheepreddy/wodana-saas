"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Building2, Network, Pencil, Plus, Users } from "lucide-react";
import {
  Avatar,
  Button,
  Callout,
  Checkbox,
  ConfirmationDialog,
  ControlledModalDialog,
  DesignSystemProvider,
  EmptyState,
  IconButton,
  IconMenuButton,
  SelectField,
  Tabs,
  TextAreaField,
  TextInput,
} from "@/design-system";
import type { BusinessUnitRecord } from "@/lib/workspace/company-profile";
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

  const businessUnitsPanel = !units.length
    ? <EmptyState description="Create the first studio, branch, or department." icon={<Building2 size={20} />} title="No business units" />
    : <div className={styles.cardList}>
      {units.map((unit) => {
        const parent = unit.parentBusinessUnitId ? unitsById.get(unit.parentBusinessUnitId) : null;
        const teamCount = teams.filter((team) => team.businessUnitId === unit.id).length;
        return <article className={styles.unitCard} key={unit.id}>
          <div className={styles.cardMain}>
            <span className={styles.cardIcon}><Building2 aria-hidden="true" size={17} /></span>
            <div className={styles.cardBody}>
              <div className={styles.cardTitle}><strong>{unit.name}</strong><small>{unit.code}</small></div>
              <p>{titleCase(unit.type)} · {entityNames.get(unit.legalEntityId) ?? "Legal entity"}</p>
            </div>
            {initialData.canManage ? <IconMenuButton ariaLabel={`Actions for ${unit.name}`} items={[{ id: "edit", label: "Edit business unit" }, { id: "archive", label: "Archive", tone: "danger" }]} onAction={(action) => action === "edit" ? setEditingUnit(unit) : setArchiveTarget({ kind: "unit", item: unit })} /> : null}
          </div>
          <div className={styles.cardFooter}><span>{parent ? `Under ${parent.name}` : "Top level"}</span><span>{unit.timezone}</span><span>{teamCount} team{teamCount === 1 ? "" : "s"}</span></div>
        </article>;
      })}
    </div>;

  const teamsPanel = !units.length
    ? <EmptyState description="Create a business unit before adding teams." icon={<Network size={20} />} title="Business unit required" />
    : !teams.length
      ? <EmptyState action={initialData.canManage ? <Button onPress={() => setEditingTeam("new")}><Plus size={14} />Create team</Button> : null} description="Group members under a business unit." icon={<Network size={20} />} title="No teams yet" />
      : <div className={styles.cardList}>
        {teams.map((team) => {
          const lead = team.members.find((member) => member.isLead);
          return <article className={styles.teamCard} key={team.id}>
            <div className={styles.cardMain}>
              <span className={styles.cardIcon}><Network aria-hidden="true" size={17} /></span>
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}><strong>{team.name}</strong><small>{team.code}</small></div>
                <p>{team.description || "Workspace team"}</p>
              </div>
              {initialData.canManage ? <IconMenuButton ariaLabel={`Actions for ${team.name}`} items={[{ id: "edit", label: "Edit team" }, { id: "archive", label: "Archive", tone: "danger" }]} onAction={(action) => action === "edit" ? setEditingTeam(team) : setArchiveTarget({ kind: "team", item: team })} /> : null}
            </div>
            <div className={styles.cardFooter}>
              <div className={styles.memberControls}>
                <div aria-label={`${team.members.length} team members`} className={styles.avatars}>{team.members.slice(0, 4).map((member) => <Avatar key={member.membershipId} name={member.displayName} size="sm" />)}{team.members.length > 4 ? <span>+{team.members.length - 4}</span> : null}</div>
                {initialData.canManage ? <IconButton aria-label={`Edit members in ${team.name}`} className={styles.memberEdit} onPress={() => setEditingTeam(team)} size="compact"><Pencil aria-hidden="true" size={12} /></IconButton> : null}
              </div>
              <span>{unitsById.get(team.businessUnitId)?.name ?? "Business unit"} · {lead ? `${lead.displayName}, lead` : `${team.members.length} member${team.members.length === 1 ? "" : "s"}`}</span>
            </div>
          </article>;
        })}
      </div>;

  return (
    <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
      <section aria-labelledby="structure-heading" className={styles.page}>
        <header className={styles.pageHeading}>
          <h1 id="structure-heading">Teams &amp; business units</h1>
          <p>Organize reporting lines and the groups that deliver work.</p>
        </header>

        <section aria-label="Organization structure summary" className={styles.actionStrip}>
          <div className={styles.summary}>
            <span><Network aria-hidden="true" size={16} /><strong>{teams.length}</strong> team{teams.length === 1 ? "" : "s"}</span>
            <span><Building2 aria-hidden="true" size={16} /><strong>{units.length}</strong> business unit{units.length === 1 ? "" : "s"}</span>
            <span><Users aria-hidden="true" size={16} /><strong>{initialData.members.length}</strong> member{initialData.members.length === 1 ? "" : "s"}</span>
          </div>
          {initialData.canManage ? <div className={styles.actions}>
            <Button isDisabled={!units.length} onPress={() => setEditingTeam("new")} variant="primary"><Plus aria-hidden="true" size={14} />Team</Button>
            <Button onPress={() => setEditingUnit("new")}><Plus aria-hidden="true" size={14} />Business unit</Button>
          </div> : null}
        </section>

        {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
        {failure ? <Callout title="Organization action failed" tone="danger">{failure}</Callout> : null}

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
        {!initialData.canManage ? <p className={styles.permissionNote}>Only workspace owners and administrators can change organization structure.</p> : null}
      </section>

      <UnitDialog initialData={initialData} item={editingUnit} key={editingUnit === "new" ? "unit-new" : editingUnit?.id ?? "unit-closed"} onClose={() => setEditingUnit(null)} onSaved={(unit) => { setUnits((current) => [unit, ...current.filter((item) => item.id !== unit.id)]); setEditingUnit(null); setStatus(`${unit.name} was saved.`); }} units={units} />
      <TeamDialog initialData={initialData} item={editingTeam} key={editingTeam === "new" ? "team-new" : editingTeam?.id ?? "team-closed"} onClose={() => setEditingTeam(null)} onSaved={(team) => { setTeams((current) => [team, ...current.filter((item) => item.id !== team.id)]); setEditingTeam(null); setStatus(`${team.name} was saved.`); }} units={units} />
      <ConfirmationDialog body={archiveTarget ? <>Archive <strong>{archiveTarget.item.name}</strong>? It will disappear from active organization structure.</> : null} confirmLabel={isArchiving ? "Archiving…" : "Archive"} isOpen={Boolean(archiveTarget)} onConfirm={() => void archive()} onOpenChange={(open) => { if (!open && !isArchiving) setArchiveTarget(null); }} title={`Archive ${archiveTarget?.kind ?? "item"}?`} />
    </DesignSystemProvider>
  );
}

function UnitDialog({ initialData, item, onClose, onSaved, units }: { initialData: OrganizationStructurePageData; item: BusinessUnitRecord | "new" | null; onClose: () => void; onSaved: (unit: BusinessUnitRecord) => void; units: BusinessUnitRecord[] }) {
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
  return <ControlledModalDialog description="Business units define the legal and reporting hierarchy." footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>Cancel</Button><Button form={formId} isLoading={saving} type="submit" variant="primary">Save business unit</Button></div>} isDismissable={!saving} isOpen={Boolean(item)} onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={existing ? "Edit business unit" : "Create business unit"}><form className={styles.form} id={formId} onSubmit={save}>{failure ? <Callout title="Could not save business unit" tone="danger">{failure}</Callout> : null}<div className={styles.formColumns}><TextInput isRequired label="Name" onChange={setName} placeholder="Design Studio" value={name} /><TextInput isDisabled={Boolean(existing)} isRequired label="Code" onChange={setCode} placeholder="DESIGN" value={code} /></div><div className={styles.formColumns}><SelectField items={initialData.legalEntities.map((entity) => ({ id: entity.id, label: entity.displayName }))} label="Legal entity" onSelectionChange={(key) => key && setLegalEntityId(String(key))} selectedKey={legalEntityId} /><SelectField items={[{ id: "studio", label: "Studio" }, { id: "department", label: "Department" }, { id: "branch", label: "Branch" }, { id: "division", label: "Division" }]} label="Unit type" onSelectionChange={(key) => key && setType(String(key))} selectedKey={type} /></div><SelectField items={[{ id: "none", label: "Top level" }, ...units.filter((unit) => unit.id !== existing?.id && unit.legalEntityId === legalEntityId).map((unit) => ({ id: unit.id, label: unit.name }))]} label="Parent business unit" onSelectionChange={(key) => key && setParentId(String(key))} selectedKey={parentId} /><TextInput isRequired label="Time zone" onChange={setTimezone} value={timezone} /></form></ControlledModalDialog>;
}

function TeamDialog({ initialData, item, onClose, onSaved, units }: { initialData: OrganizationStructurePageData; item: WorkspaceTeamRecord | "new" | null; onClose: () => void; onSaved: (team: WorkspaceTeamRecord) => void; units: BusinessUnitRecord[] }) {
  const existing = item && item !== "new" ? item : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [code, setCode] = useState(existing?.code ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [unitId, setUnitId] = useState(existing?.businessUnitId ?? units[0]?.id ?? "");
  const [memberIds, setMemberIds] = useState(() => new Set(existing?.members.map((member) => member.membershipId) ?? []));
  const [leadId, setLeadId] = useState(existing?.members.find((member) => member.isLead)?.membershipId ?? "none");
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const formId = `team-${existing?.id ?? "new"}`;
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setFailure(""); try { const response = await fetch(existing ? `/api/workspace/teams/${existing.id}` : "/api/workspace/teams", { method: existing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: initialData.workspaceId, ...(existing ? { version: existing.version } : { code }), businessUnitId: unitId, name, description, memberIds: Array.from(memberIds), leadMembershipId: leadId === "none" ? null : leadId }) }); if (!response.ok) throw new Error(await responseMessage(response, "The team could not be saved.")); onSaved(await response.json() as WorkspaceTeamRecord); } catch (error) { setFailure(error instanceof Error ? error.message : "The team could not be saved."); } finally { setSaving(false); } };
  return <ControlledModalDialog description="Teams group active members for day-to-day delivery." footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>Cancel</Button><Button form={formId} isLoading={saving} type="submit" variant="primary">Save team</Button></div>} isDismissable={!saving} isOpen={Boolean(item)} onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={existing ? "Edit team" : "Create team"}><form className={styles.form} id={formId} onSubmit={save}>{failure ? <Callout title="Could not save team" tone="danger">{failure}</Callout> : null}<div className={styles.formColumns}><TextInput isRequired label="Team name" onChange={setName} placeholder="Studio A" value={name} /><TextInput isDisabled={Boolean(existing)} isRequired label="Code" onChange={setCode} placeholder="STUDIO_A" value={code} /></div><SelectField items={units.map((unit) => ({ id: unit.id, label: unit.name }))} label="Business unit" onSelectionChange={(key) => key && setUnitId(String(key))} selectedKey={unitId} /><TextAreaField label="Description" onChange={setDescription} placeholder="What this team owns" value={description} /><fieldset className={styles.memberChoices}><legend>Team members</legend><div>{initialData.members.map((member) => <Checkbox isSelected={memberIds.has(member.id)} key={member.id} onChange={(checked) => { const next = new Set(memberIds); if (checked) next.add(member.id); else { next.delete(member.id); if (leadId === member.id) setLeadId("none"); } setMemberIds(next); }}><span><strong>{member.displayName}</strong><small>{member.email}</small></span></Checkbox>)}</div></fieldset><SelectField items={[{ id: "none", label: "No team lead" }, ...initialData.members.filter((member) => memberIds.has(member.id)).map((member) => ({ id: member.id, label: member.displayName }))]} label="Team lead" onSelectionChange={(key) => key && setLeadId(String(key))} selectedKey={leadId} /></form></ControlledModalDialog>;
}
