"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import Link from "next/link";
import { useId, useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Lock, Plus } from "lucide-react";
import { Avatar, AvatarGroup, Badge, Button, Callout, ConfirmationDialog, ControlledModalDialog, DesignSystemProvider, IconMenuButton, SaveBar, SearchInput, SegmentedControl, SelectField, SettingsPage, Switch, TextAreaField, TextInput } from "@/design-system";
import type { WorkspaceRole } from "@/lib/workspace/members";
import {
  isSensitivePermission,
  permissionLabel,
  permissionSections,
  roleSentence,
  sectionState,
  type PermissionSection,
  type RoleMemberSummary,
  type RolesPermissionsPageData,
  type WorkspacePermissionDefinition,
} from "@/lib/workspace/roles-permissions";
import styles from "./roles-permissions-page.module.css";

const SYSTEM_ROLE_ORDER: Record<string, number> = { owner: 0, administrator: 1, member: 2, viewer: 3 };
const PEOPLE_HREF = "/workspace/members";
const AVATAR_STACK = 3;

type AccessFilter = "all" | "granted" | "denied";
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

function permissionDrafts(roles: WorkspaceRole[]) {
  return Object.fromEntries(roles.map((role) => [role.id, new Set(role.permissions)]));
}

function changedPermissions(draft: Set<string> | undefined, saved: string[]) {
  if (!draft) return 0;
  const savedSet = new Set(saved);
  return saved.filter((code) => !draft.has(code)).length + [...draft].filter((code) => !savedSet.has(code)).length;
}

function peopleHref(role: WorkspaceRole) {
  return `${PEOPLE_HREF}?role=${encodeURIComponent(role.code)}`;
}

export function RolesPermissionsPage({ initialData }: { initialData: RolesPermissionsPageData }) {
  const t = useT();
  const baseId = useId();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const initialRoles = useMemo(() => sortRoles(initialData.roles), [initialData.roles]);
  const sections = useMemo(() => permissionSections(initialData.permissions, t), [initialData.permissions, t]);
  const membersByRole = useMemo(() => {
    const byRole = new Map<string, RoleMemberSummary[]>();
    for (const member of initialData.members ?? []) {
      for (const code of new Set(member.roles)) byRole.set(code, [...(byRole.get(code) ?? []), member]);
    }
    return byRole;
  }, [initialData.members]);
  const [roles, setRoles] = useState(initialRoles);
  const [drafts, setDrafts] = useState<Record<string, Set<string>>>(() => permissionDrafts(initialRoles));
  const [selectedRoleId, setSelectedRoleId] = useState(
    initialRoles.find((role) => !role.isSystem)?.id ?? initialRoles[0]?.id ?? "",
  );
  const [dialog, setDialog] = useState<RoleDialogItem>(null);
  const [deletingRole, setDeletingRole] = useState<WorkspaceRole | null>(null);
  const [blockedRole, setBlockedRole] = useState<WorkspaceRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all");
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(sections[0] ? [sections[0].id] : []));
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? roles[0];

  const mergeRole = (role: WorkspaceRole, preservePermissionDraft = false) => {
    setRoles((current) => {
      const previous = current.find((item) => item.id === role.id);
      const next = {
        ...previous, ...role,
        memberCount: role.memberCount ?? previous?.memberCount ?? 0,
        teamCount: role.teamCount ?? previous?.teamCount ?? 0,
        pendingInvitationCount: role.pendingInvitationCount ?? previous?.pendingInvitationCount ?? 0,
      };
      return sortRoles(previous ? current.map((item) => item.id === role.id ? next : item) : [...current, next]);
    });
    setDrafts((current) => ({ ...current, [role.id]: preservePermissionDraft && current[role.id]
      ? current[role.id] : new Set(role.permissions) }));
  };

  const selectRole = (roleId: string) => {
    setSelectedRoleId(roleId);
    setFailure("");
    setStatus("");
  };

  if (!selectedRole) return null;
  const selectedPermissions = drafts[selectedRole.id] ?? new Set(selectedRole.permissions);
  const roleWithinDelegation = initialData.delegablePermissions === null
    || selectedRole.permissions.every((code) => initialData.delegablePermissions?.includes(code));
  const isEditable = initialData.canEdit && !selectedRole.isSystem && roleWithinDelegation;
  const canGrant = (code: string) => isEditable
    && (initialData.delegablePermissions === null || initialData.delegablePermissions.includes(code));
  const assignedCount = (selectedRole.memberCount ?? 0) + (selectedRole.teamCount ?? 0) + (selectedRole.pendingInvitationCount ?? 0);
  const canDelete = initialData.canDelete && !selectedRole.isSystem && roleWithinDelegation;
  const changeCount = isEditable ? changedPermissions(drafts[selectedRole.id], selectedRole.permissions) : 0;
  const normalizedSearch = search.trim().toLocaleLowerCase();

  const rowDescription = (permission: WorkspacePermissionDefinition) => {
    const label = permissionLabel(permission.code, t);
    const description = t(permission.description as never);
    return description === label ? permission.code : description;
  };
  const matchesSearch = (permission: WorkspacePermissionDefinition, query: string) => !query
    || [permission.code, permission.description, permissionLabel(permission.code, t), rowDescription(permission)]
      .some((value) => value.toLocaleLowerCase().includes(query));
  const matchesFilter = (permission: WorkspacePermissionDefinition) => accessFilter === "all"
    || (accessFilter === "granted") === selectedPermissions.has(permission.code);
  const visibleSections = sections
    .map((section) => ({ section, rows: section.permissions.filter((permission) => matchesSearch(permission, normalizedSearch) && matchesFilter(permission)) }))
    .filter(({ rows }) => rows.length > 0);

  const changeSearch = (value: string) => {
    setSearch(value);
    const query = value.trim().toLocaleLowerCase();
    if (query) setOpenSections(new Set(sections.filter((section) => section.permissions.some((permission) => matchesSearch(permission, query))).map((section) => section.id)));
  };

  const toggleOpen = (sectionId: string) => setOpenSections((current) => {
    const next = new Set(current);
    if (next.has(sectionId)) next.delete(sectionId); else next.add(sectionId);
    return next;
  });

  const updateDraft = (mutate: (next: Set<string>) => void) => {
    if (!isEditable) return;
    setDrafts((current) => {
      const next = new Set(current[selectedRole.id] ?? selectedRole.permissions);
      mutate(next);
      return { ...current, [selectedRole.id]: next };
    });
  };

  const togglePermission = (code: string, enabled: boolean) => {
    if (!canGrant(code)) return;
    updateDraft((next) => { if (enabled) next.add(code); else next.delete(code); });
  };

  const toggleSection = (section: PermissionSection, enabled: boolean) => updateDraft((next) => {
    for (const permission of section.permissions) {
      if (!canGrant(permission.code)) continue;
      if (enabled) next.add(permission.code); else next.delete(permission.code);
    }
  });

  const resetChanges = () => {
    setDrafts((current) => ({ ...current, [selectedRole.id]: new Set(selectedRole.permissions) }));
    setFailure("");
  };

  const saveChanges = async () => {
    if (!isEditable || changeCount === 0) return;
    setSaving(true);
    setFailure("");
    try {
      const response = await fetch(`/api/workspace/roles/${selectedRole.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: initialData.workspaceId,
          version: selectedRole.version,
          permissionCodes: Array.from(drafts[selectedRole.id] ?? []),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, t("{name} permissions could not be saved.", { name: selectedRole.name })));
      const saved = await response.json() as WorkspaceRole;
      mergeRole(saved);
      setStatus(t("{name} permissions updated.", { name: saved.name }));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("Permissions could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async () => {
    if (!deletingRole || !initialData.canDelete) return;
    setDeleting(true);
    setFailure("");
    try {
      const response = await fetch(`/api/workspace/roles/${deletingRole.id}?workspaceId=${initialData.workspaceId}&version=${deletingRole.version}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseMessage(response, t("The role could not be deleted.")));
      const remainingRoles = roles.filter((role) => role.id !== deletingRole.id);
      setRoles(remainingRoles);
      setDrafts((current) => {
        const next = { ...current };
        delete next[deletingRole.id];
        return next;
      });
      if (selectedRoleId === deletingRole.id) setSelectedRoleId(remainingRoles[0]?.id ?? "");
      setStatus(t("{name} was deleted.", { name: deletingRole.name }));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("The role could not be deleted."));
    } finally {
      setDeleting(false);
      setDeletingRole(null);
    }
  };

  const roleKindLabel = (role: WorkspaceRole) => role.isSystem ? t("Built-in") : t("Custom");
  const memberLabel = (role: WorkspaceRole) => {
    const count = role.memberCount ?? membersByRole.get(role.code)?.length ?? 0;
    return count === 1 ? t("1 member") : t("{count} members", { count });
  };
  const memberStack = (role: WorkspaceRole) => {
    const members = membersByRole.get(role.code) ?? [];
    if (!members.length) return null;
    // Decorative: the member count beside it carries the information.
    return <AvatarGroup aria-hidden="true" className={styles.stack} label={t("People with {name}", { name: role.name })}>
      {members.slice(0, AVATAR_STACK).map((member) => <Avatar key={member.id} name={member.displayName} preset={member.avatarPreset ?? "auto"} seed={member.id} size="sm" src={member.photoUrl} />)}
    </AvatarGroup>;
  };

  const roleActions = [
    ...(isEditable ? [{ id: "edit", label: t("Edit details") }] : []),
    ...(initialData.canCreate ? [{ id: "duplicate", label: t("Duplicate") }] : []),
    ...(canDelete ? [{ id: "delete", label: t("Delete"), tone: "danger" as const }] : []),
  ];
  const onRoleAction = (action: string) => {
    if (action === "edit") setDialog({ mode: "edit", role: selectedRole });
    if (action === "duplicate") setDialog({ mode: "duplicate", role: selectedRole });
    if (action === "delete") { if (assignedCount > 0) setBlockedRole(selectedRole); else setDeletingRole(selectedRole); }
  };

  const headingId = `${baseId}-role`;
  // Nobody approves their own order, output, count or bill: an approval only one person holds stalls when
  // they raised it (or are away), so the page says so.
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
    const holders = new Set((initialData.members ?? []).filter((member) => member.roles.some((roleCode) => roles.find((role) => role.code === roleCode)?.permissions.includes(code))).map((member) => member.id));
    return holders.size > 1 ? [] : [approvalText[code][holders.size ? 0 : 1]];
  });

  return (
    <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
      <SettingsPage
        actions={initialData.canCreate ? <Button onPress={() => setDialog({ mode: "new" })} size="compact" variant="primary"><Plus aria-hidden="true" size={14} />{t("New role")}</Button> : null}
        aria-label={t("Roles & permissions")}
        title={t("Roles & permissions")}
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
                  <span className={styles.roleItemName}>{role.name}</span>{" "}
                  <Badge>{roleKindLabel(role)}</Badge>{" "}
                  <span className={styles.roleItemMembers}>{memberStack(role)}{memberLabel(role)}</span>
                </button>
              </li>)}
            </ul>
          </nav>

          <div className={styles.mobileRoles}>
            <SelectField
              accent="neutral"
              aria-label={t("Role")}
              items={roles.map((role) => ({ id: role.id, label: role.name, description: roleKindLabel(role) }))}
              label={<span className="wd-visually-hidden">{t("Role")}</span>}
              onSelectionChange={(key) => key && selectRole(String(key))}
              selectedKey={selectedRole.id}
            />
          </div>

          <section aria-labelledby={headingId} className={styles.detail}>
            <header className={styles.roleHeader}>
              <div className={styles.roleTitle}>
                <h2 id={headingId}>{selectedRole.name}</h2>
                <Badge>{roleKindLabel(selectedRole)}</Badge>
                {roleActions.length ? <IconMenuButton ariaLabel={t("Actions for {name}", { name: selectedRole.name })} items={roleActions} onAction={onRoleAction} /> : null}
              </div>
              <p className={styles.roleDescription}>{roleSentence(selectedRole.description, t("Product capabilities available to this role."))}</p>
              <p className={styles.roleMeta}>
                <Link href={peopleHref(selectedRole)}>{memberLabel(selectedRole)}</Link>
                {(selectedRole.teamCount ?? 0) > 0 ? <span>{selectedRole.teamCount === 1 ? t("1 team") : t("{count} teams", { count: selectedRole.teamCount ?? 0 })}</span> : null}
                {(selectedRole.pendingInvitationCount ?? 0) > 0 ? <span>{selectedRole.pendingInvitationCount === 1 ? t("1 pending invite") : t("{count} pending invites", { count: selectedRole.pendingInvitationCount ?? 0 })}</span> : null}
              </p>
              {selectedRole.isSystem
                ? <p className={styles.lockNote}><Lock aria-hidden="true" size={12} />{t("System role permissions are managed by Wodana and cannot be changed.")}</p>
                : !isEditable
                  ? <p className={styles.lockNote}><Lock aria-hidden="true" size={12} />{roleWithinDelegation
                    ? t("You can review this role. Permission changes require role editing access.")
                    : t("This role contains permissions outside your access and is read-only for you.")}</p>
                  : null}
            </header>

            <div className={styles.toolbar}>
              <SearchInput label={t("Search capabilities")} onChange={changeSearch} placeholder={t("Search capabilities…")} value={search} />
              <SegmentedControl
                label={t("Access")}
                onChange={(value) => setAccessFilter(value as AccessFilter)}
                options={[{ id: "all", label: t("All") }, { id: "granted", label: t("Granted") }, { id: "denied", label: t("Not granted") }]}
                value={accessFilter}
              />
            </div>

            <div className={styles.sections}>
              {visibleSections.map(({ section, rows }) => {
                const { on, total, state } = sectionState(section, selectedPermissions);
                const open = openSections.has(section.id);
                const panelId = `${baseId}-${section.id}`;
                const Chevron = open ? ChevronDown : ChevronRight;
                return <section className={styles.section} key={section.id}>
                  <div className={styles.sectionHeader}>
                    <button aria-controls={panelId} aria-expanded={open} className={styles.sectionToggle} onClick={() => toggleOpen(section.id)} type="button">
                      <Chevron aria-hidden="true" className={styles.chevron} size={14} />
                      <span className={styles.sectionName}>{section.label}</span>{" "}
                      <span className={styles.sectionCount}>{t("{on} of {total} on", { on, total })}</span>
                    </button>
                    {isEditable ? <button
                      aria-checked={state === "mixed" ? "mixed" : state === "all"}
                      aria-label={t("All {area} capabilities for {role}", { area: section.label, role: selectedRole.name })}
                      className={styles.sectionSwitch}
                      disabled={!section.permissions.some((permission) => canGrant(permission.code))}
                      onClick={() => toggleSection(section, state !== "all")}
                      role="checkbox"
                      type="button"
                    ><span aria-hidden="true" className={styles.sectionSwitchTrack}><span /></span></button> : null}
                  </div>
                  <ul className={styles.rows} hidden={!open} id={panelId}>
                    {rows.map((permission) => {
                      const label = permissionLabel(permission.code, t);
                      return <li className={styles.row} key={permission.code}>
                        <div className={styles.rowText}>
                          <span className={styles.rowName}>{label}{isSensitivePermission(permission.code) ? <Badge tone="warning">{t("Sensitive")}</Badge> : null}</span>
                          <span className={styles.rowDescription}>{rowDescription(permission)}</span>
                        </div>
                        <Switch
                          aria-label={t("{role}: {permission}", { role: selectedRole.name, permission: label })}
                          isDisabled={!canGrant(permission.code)}
                          isSelected={selectedPermissions.has(permission.code)}
                          onChange={(enabled) => togglePermission(permission.code, enabled)}
                        />
                      </li>;
                    })}
                  </ul>
                </section>;
              })}
              {visibleSections.length === 0 ? <div className={styles.empty}>
                <p>{t("No matching capabilities")}</p>
                <Button onPress={() => { changeSearch(""); setAccessFilter("all"); }} size="compact">{t("Show all")}</Button>
              </div> : null}
            </div>

            {isEditable ? <p className={styles.note}>
              {initialData.delegablePermissions === null ? t("Some approvals also require a named role and completed business checks.") : t("You can grant only permissions you hold.")}
            </p> : null}
          </section>
        </div>

        {isEditable ? <SaveBar isDirty={changeCount > 0} isSaving={saving} message={changeCount === 1 ? t("1 change") : t("{count} changes", { count: changeCount })}
          onDiscard={resetChanges} onSave={() => void saveChanges()} /> : null}
      </SettingsPage>

      <RoleDialog
        initialData={initialData}
        item={dialog}
        key={dialog ? `${dialog.mode}-${dialog.mode === "new" ? "new" : dialog.role.id}` : "role-closed"}
        onClose={() => setDialog(null)}
        onSaved={(role) => {
          const editing = dialog?.mode === "edit";
          mergeRole(role, editing);
          setSelectedRoleId(role.id);
          setDialog(null);
          setStatus(editing
            ? t("{name} details saved. Any unsaved permission changes remain ready to apply.", { name: role.name })
            : t("{name} was saved.", { name: role.name }));
        }}
      />
      <ConfirmationDialog
        body={deletingRole ? t("Delete {name}? This cannot be undone.", { name: deletingRole.name }) : null}
        confirmLabel={deleting ? t("Deleting…") : t("Delete role")}
        isOpen={Boolean(deletingRole)}
        onConfirm={() => void deleteRole()}
        onOpenChange={(open) => { if (!open && !deleting) setDeletingRole(null); }}
        title={t("Delete custom role?")}
      />
      <ControlledModalDialog
        footer={<div className="wd-dialog-actions">
          <Button onPress={() => setBlockedRole(null)}>{t("Keep editing")}</Button>
          {blockedRole ? <Link className="wd-button" data-size="standard" data-variant="primary" href={peopleHref(blockedRole)}>{t("Open People")}</Link> : null}
        </div>}
        isOpen={Boolean(blockedRole)}
        onOpenChange={(open) => { if (!open) setBlockedRole(null); }}
        title={t("Delete custom role?")}
      >
        {t("Reassign members, teams and pending invites before deleting this role.")}
      </ControlledModalDialog>
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
  const formId = `role-${existing?.id ?? "new"}`;
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
  const intro = existing
    ? t("Update the role details. Product capabilities stay in the list.")
    : source
      ? t("The copy starts with the same capabilities; adjust them after saving.")
      : t("Create the role, then choose its product capabilities from the list.");

  return <ControlledModalDialog description={intro} footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>{t("Cancel")}</Button><Button form={formId} isLoading={saving} type="submit" variant="primary">{t("Save role")}</Button></div>} isDismissable={!saving} isOpen={Boolean(item)} onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={title}>
    <form className={styles.form} id={formId} onSubmit={save}>
      {failure ? <Callout title={t("Could not save role")} tone="danger">{failure}</Callout> : null}
      <div className={styles.formColumns}>
        <TextInput isRequired label={t("Role name")} onChange={(value) => { setName(value); if (!existing && !codeTouched) setCode(roleCode(value)); }} placeholder={t("Studio lead")} value={name} />
        <TextInput description={existing ? t("Role codes cannot be changed.") : t("Used internally for access assignments.")} isDisabled={Boolean(existing)} isRequired label={t("Role code")} onChange={(value) => { setCodeTouched(true); setCode(roleCode(value)); }} placeholder={t("studio_lead")} value={code} />
      </div>
      <TextAreaField label={t("Description")} onChange={setDescription} placeholder={t("What members with this role can do")} value={description} />
    </form>
  </ControlledModalDialog>;
}
