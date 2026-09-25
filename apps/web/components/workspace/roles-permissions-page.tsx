"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useMemo, useState, type FormEvent } from "react";
import { Building2, ClipboardCheck, FolderKanban, Handshake, KeyRound, Package, Plus, ShieldCheck, Sparkles, Users, Wallet } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  ConfirmationDialog,
  ControlledModalDialog,
  DataGrid,
  DesignSystemProvider,
  IconMenuButton,
  SearchInput,
  SelectField,
  Switch,
  TextAreaField,
  TextInput,
  type DataGridColumn,
} from "@/design-system";
import type { WorkspaceRole } from "@/lib/workspace/members";
import {
  PERMISSION_AREAS,
  permissionArea,
  permissionAreaLabel,
  permissionLabel,
  type PermissionAreaId,
  type RolesPermissionsPageData,
  type WorkspacePermissionDefinition,
} from "@/lib/workspace/roles-permissions";
import styles from "./roles-permissions-page.module.css";

const SYSTEM_ROLE_ORDER: Record<string, number> = { owner: 0, administrator: 1, member: 2, viewer: 3 };

const AREA_ICONS = {
  company: Building2,
  sales: Handshake,
  planning: ClipboardCheck,
  commercial: Wallet,
  projects: FolderKanban,
  supply: Package,
  clients: Users,
  people: Users,
  platform: Sparkles,
} as const;

const AREA_ORDER = Object.fromEntries(PERMISSION_AREAS.map((area, index) => [area.id, index]));

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

function samePermissions(left: Set<string> | undefined, right: string[]) {
  return Boolean(left && left.size === right.length && right.every((permission) => left.has(permission)));
}

export function RolesPermissionsPage({ initialData }: { initialData: RolesPermissionsPageData }) {
  const t = useT();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const initialRoles = useMemo(() => sortRoles(initialData.roles), [initialData.roles]);
  const [roles, setRoles] = useState(initialRoles);
  const [drafts, setDrafts] = useState<Record<string, Set<string>>>(() => permissionDrafts(initialRoles));
  const [selectedRoleId, setSelectedRoleId] = useState(
    initialRoles.find((role) => !role.isSystem)?.id ?? initialRoles[0]?.id ?? "",
  );
  const [editingRole, setEditingRole] = useState<WorkspaceRole | "new" | null>(null);
  const [deletingRole, setDeletingRole] = useState<WorkspaceRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState("");
  const [permissionAreaFilter, setPermissionAreaFilter] = useState<PermissionAreaId>("all");
  const [permissionSearch, setPermissionSearch] = useState("");
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? roles[0];
  const customRoleCount = roles.filter((role) => !role.isSystem).length;
  const changed = Boolean(selectedRole && !selectedRole.isSystem
    && !samePermissions(drafts[selectedRole.id], selectedRole.permissions));

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

  const togglePermission = (permissionCode: string, enabled: boolean) => {
    if (!selectedRole || selectedRole.isSystem || !initialData.canEdit ||
      (initialData.delegablePermissions !== null && !initialData.delegablePermissions.includes(permissionCode))) return;
    setDrafts((current) => {
      const nextPermissions = new Set(current[selectedRole.id] ?? selectedRole.permissions);
      if (enabled) nextPermissions.add(permissionCode); else nextPermissions.delete(permissionCode);
      return { ...current, [selectedRole.id]: nextPermissions };
    });
  };

  const resetChanges = () => {
    if (!selectedRole) return;
    setDrafts((current) => ({ ...current, [selectedRole.id]: new Set(selectedRole.permissions) }));
    setFailure("");
  };

  const saveChanges = async () => {
    if (!selectedRole || selectedRole.isSystem || !initialData.canEdit || !changed) return;
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
      if (!response.ok) throw new Error(await responseMessage(response, `${selectedRole.name} permissions could not be saved.`));
      const saved = await response.json() as WorkspaceRole;
      mergeRole(saved);
      setStatus(`${saved.name} permissions updated.`);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Permissions could not be saved.");
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
      if (!response.ok) throw new Error(await responseMessage(response, "The role could not be deleted."));
      const remainingRoles = roles.filter((role) => role.id !== deletingRole.id);
      setRoles(remainingRoles);
      setDrafts((current) => {
        const next = { ...current };
        delete next[deletingRole.id];
        return next;
      });
      if (selectedRoleId === deletingRole.id) setSelectedRoleId(remainingRoles[0]?.id ?? "");
      setStatus(`${deletingRole.name} was deleted.`);
      setDeletingRole(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The role could not be deleted.");
      setDeletingRole(null);
    } finally {
      setDeleting(false);
    }
  };

  if (!selectedRole) return null;
  const selectedPermissions = drafts[selectedRole.id] ?? new Set(selectedRole.permissions);
  const roleWithinDelegation = initialData.delegablePermissions === null
    || selectedRole.permissions.every((code) => initialData.delegablePermissions?.includes(code));
  const isEditable = initialData.canEdit && !selectedRole.isSystem && roleWithinDelegation;
  const assignedCount = (selectedRole.memberCount ?? 0) + (selectedRole.teamCount ?? 0) + (selectedRole.pendingInvitationCount ?? 0);
  const isDeletable = initialData.canDelete && !selectedRole.isSystem && roleWithinDelegation && assignedCount === 0;
  const canUseRoleActions = isEditable || isDeletable;
  const normalizedPermissionSearch = permissionSearch.trim().toLocaleLowerCase();
  const visiblePermissions = initialData.permissions
    .filter((permission) => permissionAreaFilter === "all" || permissionArea(permission.code) === permissionAreaFilter)
    .filter((permission) => !normalizedPermissionSearch || [permission.code, permission.description, permissionLabel(permission.code), permissionAreaLabel(permission.code)]
      .some((value) => value.toLocaleLowerCase().includes(normalizedPermissionSearch)))
    .sort((left, right) => (AREA_ORDER[permissionArea(left.code)] ?? 99) - (AREA_ORDER[permissionArea(right.code)] ?? 99)
      || permissionLabel(left.code).localeCompare(permissionLabel(right.code)));
  const columns: DataGridColumn<WorkspacePermissionDefinition>[] = [
    {
      id: "capability",
      accessorFn: (permission) => permissionLabel(permission.code),
      header: "Capability",
      size: 560,
      enableSorting: false,
      cell: ({ row }) => {
        const permission = row.original;
        const label = permissionLabel(permission.code);
        const ModuleIcon = AREA_ICONS[permissionArea(permission.code)];
        return <span className={styles.moduleIdentity}>
          <span className={styles.moduleIcon}><ModuleIcon aria-hidden="true" size={15} /></span>
          <span className={styles.moduleDetails}><strong>{label}</strong><small>{permission.description === label ? permission.code : permission.description}</small></span>
        </span>;
      },
    },
    {
      id: "productArea",
      accessorFn: (permission) => permissionAreaLabel(permission.code),
      header: "Product area",
      size: 180,
      enableSorting: false,
      meta: { mobileHidden: true },
      cell: ({ row }) => <span className={styles.parentModule}><Badge>{permissionAreaLabel(row.original.code)}</Badge></span>,
    },
    {
      id: "access",
      accessorFn: (permission) => selectedPermissions.has(permission.code),
      header: "Access",
      size: 120,
      enableSorting: false,
      meta: { align: "center" },
      cell: ({ row }) => {
        const permission = row.original;
        return <Switch
          aria-label={`${selectedRole.name}: ${permissionLabel(permission.code)}`}
          isDisabled={!isEditable || (initialData.delegablePermissions !== null && !initialData.delegablePermissions.includes(permission.code))}
          isSelected={selectedPermissions.has(permission.code)}
          onChange={(enabled) => togglePermission(permission.code, enabled)}
        />;
      },
    },
  ];

  return (
    <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
      <section aria-labelledby="roles-heading" className={styles.page}>
        <header className={styles.pageHeading}>
          <h1 id="roles-heading">Roles &amp; permissions</h1>
          <p>{t("Set who can see and act in each part of the workspace.")}</p>
        </header>

        <div aria-label={t("Role actions")} className={styles.toolbar}>
          <div className={styles.summary}>
            <span><ShieldCheck aria-hidden="true" size={15} /><strong>{roles.length}</strong> {t("roles")}</span>
            <span><KeyRound aria-hidden="true" size={15} /><strong>{customRoleCount}</strong> {t("custom")}</span>
            {initialData.memberCount === null ? null : <span><Users aria-hidden="true" size={15} /><strong>{initialData.memberCount}</strong> {t("member")}{initialData.memberCount === 1 ? "" : "s"}</span>}
            <span><ClipboardCheck aria-hidden="true" size={15} /><strong>{initialData.permissions.length}</strong> {t("capabilities")}</span>
          </div>
          <div className={styles.actions}>
            <SelectField
              accent="neutral"
              aria-label={t("Role")}
              items={roles.map((role) => ({ id: role.id, label: role.name, description: role.isSystem ? "System role" : "Custom role" }))}
              label={<span className="wd-visually-hidden">{t("Role")}</span>}
              onSelectionChange={(key) => key && selectRole(String(key))}
              selectedKey={selectedRole.id}
            />
            {canUseRoleActions ? <IconMenuButton ariaLabel={`Actions for ${selectedRole.name}`} items={[
              ...(isEditable ? [{ id: "edit", label: "Edit role" }] : []),
              ...(isDeletable ? [{ id: "delete", label: "Delete role", tone: "danger" as const }] : []),
            ]} onAction={(action) => action === "edit" ? setEditingRole(selectedRole) : setDeletingRole(selectedRole)} /> : null}
            {isEditable && changed ? <>
              <Button isDisabled={saving} onPress={resetChanges} size="compact">{t("Reset")}</Button>
              <Button isLoading={saving} onPress={() => void saveChanges()} size="compact" variant="primary">{t("Save changes")}</Button>
            </> : null}
            {initialData.canCreate ? <Button onPress={() => setEditingRole("new")} size="compact" variant="primary"><Plus aria-hidden="true" size={14} />{t("Custom role")}</Button> : null}
          </div>
        </div>

        {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
        {failure ? <Callout title={t("Role action failed")} tone="danger">{failure}</Callout> : null}

        <div className={styles.roleContext}>
          <div>
            <strong>{selectedRole.name}</strong>
            <Badge>{selectedRole.isSystem ? "System" : "Custom"}</Badge>
            <span>{selectedRole.memberCount ?? 0} {t("direct member")}{selectedRole.memberCount === 1 ? "" : "s"}</span>
            {(selectedRole.teamCount ?? 0) > 0 ? <span>{selectedRole.teamCount} {t("team")}{selectedRole.teamCount === 1 ? "" : "s"}</span> : null}
            {(selectedRole.pendingInvitationCount ?? 0) > 0 ? <span>{selectedRole.pendingInvitationCount} {t("pending invite")}{selectedRole.pendingInvitationCount === 1 ? "" : "s"}</span> : null}
          </div>
          <p>{selectedRole.description || "Product capabilities available to this role."}
            {!selectedRole.isSystem && assignedCount > 0 ? " Reassign members, teams and pending invites before deleting this role." : null}</p>
        </div>

        <div className={styles.permissionToolbar}>
          <div aria-label={t("Permission product area")} className={styles.areaFilters} role="group">
            {PERMISSION_AREAS.map((area) => {
              const count = area.id === "all"
                ? initialData.permissions.length
                : initialData.permissions.filter((permission) => permissionArea(permission.code) === area.id).length;
              return count ? <button aria-pressed={permissionAreaFilter === area.id} key={area.id} onClick={() => setPermissionAreaFilter(area.id)} type="button">{area.label}<span>{count}</span></button> : null;
            })}
          </div>
          <SearchInput label={t("Search permissions")} onChange={setPermissionSearch} placeholder={t("Search capabilities…")} value={permissionSearch} />
        </div>

        <div className={styles.permissionGrid}>
          <DataGrid
            appearance="flush"
            ariaLabel={`Permissions for ${selectedRole.name}`}
            columns={columns}
            data={visiblePermissions}
            emptyDescription="Try another product area or search term."
            emptyTitle="No matching permissions"
            getRowId={(permission) => permission.code}
            pageSize={100}
            pinFirstColumn={false}
            rowNumbers={false}
            selectable={false}
            showFooter
            showToolbar={false}
            totalRowCount={visiblePermissions.length}
          />
        </div>
        <p className={styles.permissionNote}>
          {selectedRole.isSystem
            ? "System role permissions are managed by Wodana and cannot be changed."
            : isEditable
              ? `Save changes to apply access. ${initialData.delegablePermissions === null ? "Some approvals also require a named role and completed business checks." : "You can grant only permissions you hold."}`
              : roleWithinDelegation
                ? "You can review this role. Permission changes require role editing access."
                : "This role contains permissions outside your access and is read-only for you."}
        </p>
      </section>

      <RoleDialog initialData={initialData} item={editingRole} key={editingRole === "new" ? "role-new" : editingRole?.id ?? "role-closed"} onClose={() => setEditingRole(null)} onSaved={(role) => { mergeRole(role, editingRole !== "new"); setSelectedRoleId(role.id); setEditingRole(null); setStatus(editingRole === "new" ? `${role.name} was saved.` : `${role.name} details saved. Any unsaved permission changes remain ready to apply.`); }} />
      <ConfirmationDialog body={deletingRole ? <>{t("Delete")}{" "}<strong>{deletingRole.name}</strong>{t("? This cannot be undone.")}</> : null} confirmLabel={deleting ? "Deleting…" : "Delete role"} isOpen={Boolean(deletingRole)} onConfirm={() => void deleteRole()} onOpenChange={(open) => { if (!open && !deleting) setDeletingRole(null); }} title={t("Delete custom role?")} />
    </DesignSystemProvider>
  );
}

function RoleDialog({ initialData, item, onClose, onSaved }: { initialData: RolesPermissionsPageData; item: WorkspaceRole | "new" | null; onClose: () => void; onSaved: (role: WorkspaceRole) => void }) {
  const t = useT();
  const existing = item && item !== "new" ? item : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [code, setCode] = useState(existing?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(false);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const formId = `role-${existing?.id ?? "new"}`;

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
          ...(existing ? { version: existing.version } : { code, permissionCodes: [] }),
          name,
          description,
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The role could not be saved."));
      const saved = await response.json() as WorkspaceRole;
      onSaved({ ...saved, memberCount: saved.memberCount ?? existing?.memberCount ?? 0 });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The role could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return <ControlledModalDialog description={existing ? "Update the role details. Product capabilities stay in the table." : "Create the role, then choose its product capabilities from the table."} footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>{t("Cancel")}</Button><Button form={formId} isLoading={saving} type="submit" variant="primary">{t("Save role")}</Button></div>} isDismissable={!saving} isOpen={Boolean(item)} onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={existing ? "Edit custom role" : "Create custom role"}>
    <form className={styles.form} id={formId} onSubmit={save}>
      {failure ? <Callout title={t("Could not save role")} tone="danger">{failure}</Callout> : null}
      <div className={styles.formColumns}>
        <TextInput isRequired label={t("Role name")} onChange={(value) => { setName(value); if (!existing && !codeTouched) setCode(roleCode(value)); }} placeholder={t("Studio lead")} value={name} />
        <TextInput description={existing ? "Role codes cannot be changed." : "Used internally for access assignments."} isDisabled={Boolean(existing)} isRequired label={t("Role code")} onChange={(value) => { setCodeTouched(true); setCode(roleCode(value)); }} placeholder={t("studio_lead")} value={code} />
      </div>
      <TextAreaField label={t("Description")} onChange={setDescription} placeholder={t("What members with this role can do")} value={description} />
    </form>
  </ControlledModalDialog>;
}
