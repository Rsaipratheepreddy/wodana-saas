"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useId, useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Lock, Plus } from "lucide-react";
import { Avatar, AvatarGroup, Badge, Button, Callout, Checkbox, ConfirmationDialog, DesignSystemProvider, EmptyState, IconMenuButton, SaveBar, SegmentedControl, SelectField, SettingsPage, Tabs, TextAreaField, TextInput, FormDialog } from "@/design-system";
import type { WorkspaceRole } from "@/lib/workspace/members";
import {
  ACCESS_LEVELS,
  ACCESS_MODULES,
  levelLabel,
  MODULE_LABELS,
  accessChanges,
  describeAccess,
  levelPermissions,
  modulePermissions,
  offeredLevels,
  withExtra,
  withLevel,
  type AccessLevel,
  type AccessModule,
  type RoleAccess,
} from "@/lib/workspace/access-levels";
import { permissionLabel, roleSentence, type RoleMemberSummary, type RolesPermissionsPageData } from "@/lib/workspace/roles-permissions";
import styles from "./roles-permissions-page.module.css";
import type { ViewAsTarget } from "@/lib/workspace/view-as";
import { ViewAsDialog } from "./view-as-dialog";

const SYSTEM_ROLE_ORDER: Record<string, number> = { owner: 0, administrator: 1, member: 2, viewer: 3 };
const AVATAR_STACK = 3;

/** Approvals someone other than the person who raised the work gives. */
const APPROVALS = ["commercial.estimate", "commercial.finance.verify", "commercial.deal.approve", "purchasing.approve", "vendors.approve", "factory.approve", "stock.adjust", "payables.approve"] as const;
type RoleDialogItem = { mode: "new" } | { mode: "edit"; role: WorkspaceRole } | { mode: "duplicate"; role: WorkspaceRole } | null;

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

function roleCode(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}

function sortRoles(roles: WorkspaceRole[]) {
  return [...roles].sort((left, right) => {
    const leftRank = SYSTEM_ROLE_ORDER[left.code] ?? (left.isSystem ? 4 : 5);
    const rightRank = SYSTEM_ROLE_ORDER[right.code] ?? (right.isSystem ? 4 : 5);
    return leftRank - rightRank || left.name.localeCompare(right.name);
  });
}

/**
 * Roles & permissions by module. The roles on the inline start; for the selected role, one row per module with
 * one access level (No access, View, Edit, Manage) and, for rare cases, the fine permissions under Advanced.
 * Members lists who has the role. Saves are version-checked on the server and audited.
 */
export function RolesPermissionsPage({ initialData }: { initialData: RolesPermissionsPageData }) {
  const t = useT();
  const baseId = useId();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ViewAsTarget | null>(null);
  const initialRoles = useMemo(() => sortRoles(initialData.roles), [initialData.roles]);
  const [roles, setRoles] = useState(initialRoles);
  const [members, setMembers] = useState<RoleMemberSummary[]>(initialData.members ?? []);
  const [drafts, setDrafts] = useState<Record<string, RoleAccess>>({});
  const [selectedRoleId, setSelectedRoleId] = useState(initialRoles.find((role) => !role.isSystem)?.id ?? initialRoles[0]?.id ?? "");
  const [tab, setTab] = useState("access");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<RoleDialogItem>(null);
  const [deletingRole, setDeletingRole] = useState<WorkspaceRole | null>(null);
  const [blockedRole, setBlockedRole] = useState<WorkspaceRole | null>(null);
  const [resetting, setResetting] = useState<WorkspaceRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState("");
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? roles[0];

  const holdersOf = (role: WorkspaceRole) => members.filter((member) => member.roles.includes(role.code));
  const mergeRole = (role: WorkspaceRole) => {
    setRoles((current) => {
      const previous = current.find((item) => item.id === role.id);
      const next = { ...previous, ...role, memberCount: role.memberCount ?? previous?.memberCount ?? 0, teamCount: role.teamCount ?? previous?.teamCount ?? 0, pendingInvitationCount: role.pendingInvitationCount ?? previous?.pendingInvitationCount ?? 0 };
      return sortRoles(previous ? current.map((item) => item.id === role.id ? next : item) : [...current, next]);
    });
    setDrafts((current) => { const next = { ...current }; delete next[role.id]; return next; });
  };
  const selectRole = (roleId: string) => { setSelectedRoleId(roleId); setFailure(""); setStatus(""); };

  if (!selectedRole) return null;
  const saved = describeAccess(selectedRole.permissions);
  const draft = drafts[selectedRole.id] ?? saved;
  const delegable = initialData.delegablePermissions;
  const canGrant = (code: string) => delegable === null || delegable.includes(code);
  const roleWithinDelegation = selectedRole.permissions.every(canGrant);
  const isEditable = initialData.canEdit && !selectedRole.isSystem && roleWithinDelegation;
  const canDelete = initialData.canDelete && !selectedRole.isSystem && roleWithinDelegation;
  const changeCount = isEditable ? accessChanges(selectedRole.permissions, draft) : 0;
  const unsaved = (role: WorkspaceRole) => Boolean(drafts[role.id]) && accessChanges(role.permissions, drafts[role.id]) > 0;
  const setDraft = (next: RoleAccess) => { if (isEditable) setDrafts((current) => ({ ...current, [selectedRole.id]: next })); };

  const send = async (path: string, init: RequestInit, fallback: string) => {
    const response = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
    if (!response.ok) throw new Error(await responseMessage(response, fallback));
    return response.json();
  };
  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true); setFailure(""); setStatus("");
    try { await work(); } catch (error) { setFailure(error instanceof Error ? error.message : fallback); } finally { setBusy(false); }
  };

  const saveAccess = () => run(async () => {
    const role = await send(`/api/workspace/roles/${selectedRole.id}/access`, { method: "PUT", body: JSON.stringify({ workspaceId: initialData.workspaceId, version: selectedRole.version, levels: draft.levels, extras: draft.extras }) },
      t("{name} permissions could not be saved.", { name: selectedRole.name })) as WorkspaceRole;
    mergeRole(role);
    setStatus(t("{name} permissions updated.", { name: role.name }));
  }, t("Permissions could not be saved."));

  const resetToTemplate = () => run(async () => {
    if (!resetting) return;
    const role = await send(`/api/workspace/roles/${resetting.id}/reset-to-template`, { method: "POST", body: JSON.stringify({ workspaceId: initialData.workspaceId, version: resetting.version }) },
      t("The role could not be reset.")) as WorkspaceRole;
    mergeRole(role);
    setResetting(null);
    setStatus(t("{name} is back to its template.", { name: role.name }));
  }, t("The role could not be reset."));

  const deleteRole = () => run(async () => {
    if (!deletingRole) return;
    const response = await fetch(`/api/workspace/roles/${deletingRole.id}?workspaceId=${initialData.workspaceId}&version=${deletingRole.version}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await responseMessage(response, t("The role could not be deleted.")));
    const remaining = roles.filter((role) => role.id !== deletingRole.id);
    setRoles(remaining);
    if (selectedRoleId === deletingRole.id) setSelectedRoleId(remaining[0]?.id ?? "");
    setStatus(t("{name} was deleted.", { name: deletingRole.name }));
    setDeletingRole(null);
  }, t("The role could not be deleted."));

  // Members: the role is added to or removed from a person's direct roles (a team's roles come from the team).
  const changeMember = (member: RoleMemberSummary, add: boolean) => run(async () => {
    const direct = member.directRoles ?? member.roles;
    const roleCodes = add ? [...new Set([...direct, selectedRole.code])] : direct.filter((code) => code !== selectedRole.code);
    const updated = await send(`/api/workspace/members/${member.id}`, { method: "PATCH", body: JSON.stringify({ workspaceId: initialData.workspaceId, version: member.version, roleCodes }) },
      t("The member could not be updated.")) as { version?: number; roles?: string[]; inheritedRoles?: string[] };
    const nextDirect = updated.roles ?? roleCodes;
    setMembers((current) => current.map((item) => item.id === member.id ? {
      ...item, version: updated.version ?? (item.version ?? 0) + 1, directRoles: nextDirect,
      roles: [...new Set([...nextDirect, ...(updated.inheritedRoles ?? item.roles.filter((code) => !direct.includes(code)))])],
    } : item));
    setStatus(add ? t("{person} now has {role}.", { person: member.displayName, role: selectedRole.name }) : t("{person} no longer has {role}.", { person: member.displayName, role: selectedRole.name }));
  }, t("The member could not be updated."));

  const memberStack = (role: WorkspaceRole) => {
    const holders = holdersOf(role);
    if (!holders.length) return null;
    return <AvatarGroup aria-hidden="true" className={styles.stack} label={t("People with {name}", { name: role.name })}>
      {holders.slice(0, AVATAR_STACK).map((member) => <Avatar key={member.id} name={member.displayName} preset={member.avatarPreset ?? "auto"} seed={member.id} size="sm" src={member.photoUrl} />)}
    </AvatarGroup>;
  };
  const memberCount = (role: WorkspaceRole) => initialData.members ? holdersOf(role).length : role.memberCount ?? 0;
  const memberLabel = (role: WorkspaceRole) => memberCount(role) === 1 ? t("1 member") : t("{count} members", { count: memberCount(role) });

  const canPreview = Boolean(initialData.viewAs?.canViewAs) && (initialData.viewAs?.viewerIsOwner || selectedRole.code !== "owner");
  const roleActions = [
    ...(isEditable ? [{ id: "edit", label: t("Edit details") }] : []),
    ...(initialData.canCreate ? [{ id: "duplicate", label: t("Duplicate role") }] : []),
    ...(isEditable && selectedRole.templateCode ? [{ id: "reset", label: t("Reset to template") }] : []),
    ...(canPreview ? [{ id: "preview", label: t("Preview as {role}", { role: selectedRole.name }) }] : []),
    ...(canDelete ? [{ id: "delete", label: t("Delete"), tone: "danger" as const }] : []),
  ];
  const assigned = (selectedRole.memberCount ?? 0) + (selectedRole.teamCount ?? 0) + (selectedRole.pendingInvitationCount ?? 0);
  const onRoleAction = (action: string) => {
    if (action === "preview") setPreviewTarget({ kind: "role", roleId: selectedRole.id, name: selectedRole.name });
    if (action === "edit") setDialog({ mode: "edit", role: selectedRole });
    if (action === "duplicate") setDialog({ mode: "duplicate", role: selectedRole });
    if (action === "reset") setResetting(selectedRole);
    if (action === "delete") { if (assigned > 0) setBlockedRole(selectedRole); else setDeletingRole(selectedRole); }
  };

  // Nobody approves their own order, output, count or bill: an approval only one person holds stalls.
  const approvalText: Record<(typeof APPROVALS)[number], [one: string, none: string]> = {
    "commercial.estimate": [t("Only one person can approve QS estimates."), t("Nobody can approve QS estimates.")],
    "commercial.finance.verify": [t("Only one person can verify client payments."), t("Nobody can verify client payments.")],
    "commercial.deal.approve": [t("Only one person can approve deals."), t("Nobody can approve deals.")],
    "vendors.approve": [t("Only one person can approve suppliers."), t("Nobody can approve suppliers.")],
    "purchasing.approve": [t("Only one person can approve orders."), t("Nobody can approve orders.")],
    "factory.approve": [t("Only one person can approve factory output."), t("Nobody can approve factory output.")],
    "stock.adjust": [t("Only one person can approve stock corrections."), t("Nobody can approve stock corrections.")],
    "payables.approve": [t("Only one person can approve supplier bills."), t("Nobody can approve supplier bills.")],
  };
  const approvalGaps = APPROVALS.flatMap((code) => {
    const holders = new Set(members.filter((member) => member.roles.some((held) => roles.find((role) => role.code === held)?.permissions.includes(code))).map((member) => member.id));
    return holders.size > 1 ? [] : [approvalText[code][holders.size ? 0 : 1]];
  });

  const levelHint = (module: AccessModule, level: AccessLevel) => {
    const name = t(MODULE_LABELS[module.id]);
    if (level === "none") return t("No access to {module}", { module: name });
    return `${t(levelLabel(module.id, level))}: ${levelPermissions(module, level).map((code) => permissionLabel(code, t)).join(", ")}`;
  };
  const toggleOpen = (moduleId: string) => setOpen((current) => { const next = new Set(current); if (next.has(moduleId)) next.delete(moduleId); else next.add(moduleId); return next; });

  const access = <ul className={styles.modules} aria-label={t("Access by module")}>
    {ACCESS_MODULES.map((module) => {
      const name = t(MODULE_LABELS[module.id]);
      const level = draft.levels[module.id] ?? "none";
      const offered = offeredLevels(module);
      const included = new Set(levelPermissions(module, level));
      const extras = draft.extras.filter((code) => modulePermissions(module).includes(code));
      const panelId = `${baseId}-${module.id}`;
      const expanded = open.has(module.id);
      const Chevron = expanded ? ChevronDown : ChevronRight;
      return <li className={styles.module} key={module.id}>
        <div className={styles.moduleRow}>
          <span className={styles.moduleName}>{name}</span>
          <SegmentedControl isDisabled={!isEditable} label={t("{module} access", { module: name })} value={level}
            options={ACCESS_LEVELS.map((option) => ({ id: option, label: t(levelLabel(module.id, option)), description: levelHint(module, option),
              isDisabled: !offered.includes(option) || !levelPermissions(module, option).every(canGrant) }))}
            onChange={(next) => setDraft(withLevel(draft, module.id, next as AccessLevel))} />
          <button aria-controls={panelId} aria-expanded={expanded} className={styles.advancedToggle} onClick={() => toggleOpen(module.id)} type="button">
            <Chevron aria-hidden="true" size={14} />{t("Advanced")}{extras.length ? <span className="wd-count-chip" title={t("{count} more permissions", { count: extras.length })}>{extras.length}</span> : null}
          </button>
        </div>
        <ul className={styles.fine} hidden={!expanded} id={panelId} aria-label={t("{module} permissions", { module: name })}>
          {modulePermissions(module).map((code) => <li key={code}>
            <Checkbox isDisabled={!isEditable || included.has(code) || !canGrant(code)} isSelected={included.has(code) || draft.extras.includes(code)}
              onChange={(granted) => setDraft(withExtra(draft, code, granted))}>
              <span>{permissionLabel(code, t)}</span>
              {included.has(code) ? <small className={styles.included}>{t("Included in {level}", { level: t(levelLabel(module.id, level)) })}</small> : null}
            </Checkbox>
          </li>)}
        </ul>
      </li>;
    })}
  </ul>;

  const holders = holdersOf(selectedRole);
  const directOwners = selectedRole.code === "owner" ? holders.filter((member) => (member.directRoles ?? member.roles).includes("owner")).length : Infinity;
  const canEditMembers = Boolean(initialData.canEditMembers) && roleWithinDelegation;
  const addable = members.filter((member) => !member.roles.includes(selectedRole.code));
  const membersPanel = <div className={styles.members}>
    {canEditMembers && addable.length ? <SelectField accent="neutral" items={addable.map((member) => ({ id: member.id, label: member.displayName, description: member.email }))}
      label={t("Add a person")} placeholder={t("Choose a person")} selectedKey={null} isDisabled={busy}
      onSelectionChange={(key) => { const member = addable.find((item) => item.id === key); if (member) void changeMember(member, true); }} /> : null}
    {holders.length ? <ul className={styles.memberList}>
      {holders.map((member) => {
        const direct = (member.directRoles ?? member.roles).includes(selectedRole.code);
        const lastOwner = direct && directOwners <= 1;
        return <li className={styles.member} key={member.id}>
          <Avatar name={member.displayName} preset={member.avatarPreset ?? "auto"} seed={member.id} size="sm" src={member.photoUrl} />
          <span className={styles.memberName}><strong>{member.displayName}</strong>{member.email ? <small>{member.email}</small> : null}</span>
          {!direct ? <small className={styles.memberNote}>{t("Through a team")}</small>
            : canEditMembers ? <span title={lastOwner ? t("A workspace keeps at least one owner") : undefined}>
              <Button size="compact" variant="quiet" isDisabled={busy || lastOwner} onPress={() => void changeMember(member, false)}>{t("Remove")}</Button></span> : null}
        </li>;
      })}
    </ul> : <EmptyState illustration="empty" title={t("Nobody has this role yet")} description={canEditMembers && addable.length ? t("Add a person above.") : undefined} />}
  </div>;

  const headingId = `${baseId}-role`;
  return (
    <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
      <SettingsPage
        actions={initialData.canCreate ? <Button onPress={() => setDialog({ mode: "new" })} size="compact" variant="primary"><Plus aria-hidden="true" size={14} />{t("New role")}</Button> : null}
        aria-label={t("Roles & permissions")}
        title={t("Roles")}
        width="wide"
      >
        {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
        {failure ? <Callout title={t("Role action failed")} tone="danger">{failure}</Callout> : null}
        {approvalGaps.length ? <Callout title={t("Approvals need a second person")} tone="warning">{approvalGaps.join(" ")}</Callout> : null}

        <div className={styles.layout}>
          <nav aria-label={t("Roles")} className={styles.rolesPane}>
            <ul>
              {roles.map((role) => <li key={role.id}>
                <button aria-current={role.id === selectedRole.id ? "true" : undefined} className={styles.roleItem} onClick={() => selectRole(role.id)} type="button">
                  <span className={styles.roleItemName}>{role.name}</span>
                  {unsaved(role) ? <Badge tone="warning">{t("Unsaved")}</Badge> : role.isSystem ? <Lock aria-label={t("Built-in")} className={styles.roleLock} size={12} /> : null}
                  <span className={styles.roleItemMembers}>{memberStack(role)}{memberLabel(role)}</span>
                </button>
              </li>)}
            </ul>
          </nav>

          <div className={styles.mobileRoles}>
            <SelectField accent="neutral" aria-label={t("Role")} items={roles.map((role) => ({ id: role.id, label: role.name, description: memberLabel(role) }))}
              label={<span className="wd-visually-hidden">{t("Role")}</span>} onSelectionChange={(key) => key && selectRole(String(key))} selectedKey={selectedRole.id} />
          </div>

          <section aria-labelledby={headingId} className={styles.detail}>
            <header className={styles.roleHeader}>
              <div className={styles.roleTitle}>
                <h2 id={headingId}>{selectedRole.name}</h2>
                {selectedRole.isSystem ? <Badge>{t("Built-in")}</Badge> : selectedRole.templateCode ? <Badge>{t("From a template")}</Badge> : null}
                {roleActions.length ? <IconMenuButton ariaLabel={t("Actions for {name}", { name: selectedRole.name })} items={roleActions} onAction={onRoleAction} /> : null}
              </div>
              {selectedRole.description ? <p className={styles.roleDescription}>{roleSentence(selectedRole.description, "")}</p> : null}
              {selectedRole.isSystem
                ? <p className={styles.lockNote}><Lock aria-hidden="true" size={12} />{t("Built-in roles keep their access, so the workspace always has an owner who can change settings.")}</p>
                : !isEditable
                  ? <p className={styles.lockNote}><Lock aria-hidden="true" size={12} />{roleWithinDelegation ? t("You can review this role. Changing it needs role editing access.") : t("This role has access you don't have, so you can't change it.")}</p>
                  : null}
            </header>
            <Tabs selectedKey={tab} onSelectionChange={setTab} items={[
              { id: "access", label: t("Access"), panel: access },
              { id: "members", label: t("Members"), count: holders.length, panel: membersPanel },
            ]} />
          </section>
        </div>

        {isEditable ? <SaveBar isDirty={changeCount > 0} isSaving={busy} message={changeCount === 1 ? t("1 change") : t("{count} changes", { count: changeCount })}
          onDiscard={() => setDrafts((current) => { const next = { ...current }; delete next[selectedRole.id]; return next; })} onSave={() => void saveAccess()} /> : null}
      </SettingsPage>

      <ViewAsDialog mfaEnabled={Boolean(initialData.viewAs?.mfaEnabled)} onClose={() => setPreviewTarget(null)} target={previewTarget} workspaceId={initialData.workspaceId} />

      <RoleDialog
        initialData={initialData}
        item={dialog}
        key={dialog ? `${dialog.mode}-${dialog.mode === "new" ? "new" : dialog.role.id}` : "role-closed"}
        onClose={() => setDialog(null)}
        onSaved={(role) => {
          const editing = dialog?.mode === "edit";
          const pending = drafts[role.id];
          mergeRole(role);
          if (editing && pending) setDrafts((current) => ({ ...current, [role.id]: pending }));
          setSelectedRoleId(role.id);
          setDialog(null);
          setStatus(editing ? t("{name} details saved. Any unsaved permission changes remain ready to apply.", { name: role.name }) : t("{name} was saved.", { name: role.name }));
        }}
      />
      <ConfirmationDialog
        body={resetting ? t("Give {name} its template's access back? People with it get exactly the template's access.", { name: resetting.name }) : null}
        confirmLabel={busy ? t("Resetting…") : t("Reset to template")}
        isOpen={Boolean(resetting)}
        onConfirm={() => void resetToTemplate()}
        onOpenChange={(isOpen) => { if (!isOpen && !busy) setResetting(null); }}
        title={t("Reset to template?")}
      />
      <ConfirmationDialog
        body={deletingRole ? t("Delete {name}? This cannot be undone.", { name: deletingRole.name }) : null}
        confirmLabel={busy ? t("Deleting…") : t("Delete role")}
        isOpen={Boolean(deletingRole)}
        onConfirm={() => void deleteRole()}
        onOpenChange={(isOpen) => { if (!isOpen && !busy) setDeletingRole(null); }}
        title={t("Delete custom role?")}
      />
      <ConfirmationDialog
        body={t("Reassign members, teams and pending invites before deleting this role.")}
        cancelLabel={t("Keep editing")}
        confirmLabel={t("Open Members")}
        confirmVariant="primary"
        isOpen={Boolean(blockedRole)}
        onConfirm={() => { setBlockedRole(null); setTab("members"); }}
        onOpenChange={(isOpen) => { if (!isOpen) setBlockedRole(null); }}
        title={t("Delete custom role?")}
      />
    </DesignSystemProvider>
  );
}

function RoleDialog({ initialData, item, onClose, onSaved }: { initialData: RolesPermissionsPageData; item: RoleDialogItem; onClose: () => void; onSaved: (role: WorkspaceRole) => void }) {
  const t = useT();
  const existing = item?.mode === "edit" ? item.role : null;
  const source = item?.mode === "duplicate" ? item.role : null;
  const initialName = existing?.name ?? (source ? t("{name} copy", { name: source.name }) : "");
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(existing?.code ?? roleCode(initialName));
  const [codeTouched, setCodeTouched] = useState(false);
  const [description, setDescription] = useState(existing?.description ?? source?.description ?? "");
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const copiedPermissions = source
    ? source.permissions.filter((permission) => initialData.delegablePermissions === null || initialData.delegablePermissions.includes(permission))
    : [];

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFailure("");
    try {
      const response = await fetch(existing ? `/api/workspace/roles/${existing.id}` : "/api/workspace/roles", {
        method: existing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: initialData.workspaceId,
          ...(existing ? { version: existing.version } : { code, permissionCodes: copiedPermissions }),
          name,
          description,
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, t("The role could not be saved.")));
      const saved = await response.json() as WorkspaceRole;
      onSaved({ ...saved, memberCount: saved.memberCount ?? existing?.memberCount ?? 0 });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("The role could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const title = existing ? t("Edit custom role") : source ? t("Duplicate {name}", { name: source.name }) : t("Create custom role");

  return <FormDialog isOpen={Boolean(item)} title={title} onClose={onClose} isSubmitting={saving} submitLabel={t("Save role")} onSubmit={save}>

      {failure ? <Callout title={t("Could not save role")} tone="danger">{failure}</Callout> : null}
      <TextInput isRequired label={t("Role name")} onChange={(value) => { setName(value); if (!existing && !codeTouched) setCode(roleCode(value)); }} placeholder={t("Studio lead")} value={name} />
      <TextInput isDisabled={Boolean(existing)} isRequired label={t("Role code")} onChange={(value) => { setCodeTouched(true); setCode(roleCode(value)); }} placeholder={t("studio_lead")} value={code} />
      <TextAreaField label={t("Description")} onChange={setDescription} placeholder={t("What members with this role can do")} value={description} />
    
</FormDialog>;
}
