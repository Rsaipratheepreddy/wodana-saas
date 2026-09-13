"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Building2, KeyRound, Network, Plug, Plus, ShieldCheck, Users } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  ConfirmationDialog,
  ControlledModalDialog,
  DesignSystemProvider,
  IconMenuButton,
  SelectField,
  Switch,
  TextAreaField,
  TextInput,
} from "@/design-system";
import type { WorkspaceRole } from "@/lib/workspace/members";
import {
  ROLE_PERMISSION_ACTIONS,
  ROLE_PERMISSION_MODULES,
  modulePermissionCode,
  type RolesPermissionsPageData,
  type WorkspacePermissionModule,
} from "@/lib/workspace/roles-permissions";
import styles from "./roles-permissions-page.module.css";

const SYSTEM_ROLE_ORDER: Record<string, number> = { owner: 0, administrator: 1, member: 2, viewer: 3 };

const MODULE_ICONS = {
  organization: Building2,
  members: Users,
  teams: Network,
  roles: ShieldCheck,
  integrations: Plug,
} as const;

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
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? roles[0];
  const customRoleCount = roles.filter((role) => !role.isSystem).length;
  const changed = Boolean(selectedRole && !selectedRole.isSystem
    && !samePermissions(drafts[selectedRole.id], selectedRole.permissions));

  const mergeRole = (role: WorkspaceRole) => {
    setRoles((current) => {
      const previous = current.find((item) => item.id === role.id);
      const next = { ...previous, ...role, memberCount: role.memberCount ?? previous?.memberCount ?? 0 };
      return sortRoles(previous ? current.map((item) => item.id === role.id ? next : item) : [...current, next]);
    });
    setDrafts((current) => ({ ...current, [role.id]: new Set(role.permissions) }));
  };

  const selectRole = (roleId: string) => {
    setSelectedRoleId(roleId);
    setFailure("");
    setStatus("");
  };

  const togglePermission = (module: WorkspacePermissionModule, action: typeof ROLE_PERMISSION_ACTIONS[number], enabled: boolean) => {
    if (!selectedRole || selectedRole.isSystem || !initialData.canManage) return;
    const permissionCode = modulePermissionCode(module.id, action.id);
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
    if (!selectedRole || selectedRole.isSystem || !changed) return;
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
    if (!deletingRole) return;
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
  const isEditable = initialData.canManage && !selectedRole.isSystem;

  return (
    <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
      <section aria-labelledby="roles-heading" className={styles.page}>
        <header className={styles.pageHeading}>
          <h1 id="roles-heading">Roles &amp; permissions</h1>
          <p>Create roles and control access by module.</p>
        </header>

        <div aria-label="Role actions" className={styles.toolbar}>
          <div className={styles.summary}>
            <span><ShieldCheck aria-hidden="true" size={15} /><strong>{roles.length}</strong> roles</span>
            <span><KeyRound aria-hidden="true" size={15} /><strong>{customRoleCount}</strong> custom</span>
            <span><Users aria-hidden="true" size={15} /><strong>{initialData.memberCount}</strong> member{initialData.memberCount === 1 ? "" : "s"}</span>
          </div>
          <div className={styles.actions}>
            <SelectField
              accent="neutral"
              aria-label="Role"
              items={roles.map((role) => ({ id: role.id, label: role.name, description: role.isSystem ? "System role" : "Custom role" }))}
              label={<span className="wd-visually-hidden">Role</span>}
              onSelectionChange={(key) => key && selectRole(String(key))}
              selectedKey={selectedRole.id}
            />
            {isEditable ? <>
              <IconMenuButton ariaLabel={`Actions for ${selectedRole.name}`} items={[{ id: "edit", label: "Edit role" }, { id: "delete", label: "Delete role", tone: "danger" }]} onAction={(action) => action === "edit" ? setEditingRole(selectedRole) : setDeletingRole(selectedRole)} />
              <Button isDisabled={!changed || saving} onPress={resetChanges} size="compact">Reset</Button>
              <Button isDisabled={!changed} isLoading={saving} onPress={() => void saveChanges()} size="compact" variant="primary">Save changes</Button>
            </> : null}
            {initialData.canManage ? <Button onPress={() => setEditingRole("new")} size="compact" variant="primary"><Plus aria-hidden="true" size={14} />Custom role</Button> : null}
          </div>
        </div>

        {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
        {failure ? <Callout title="Role action failed" tone="danger">{failure}</Callout> : null}

        <div className={styles.roleContext}>
          <div>
            <strong>{selectedRole.name}</strong>
            <Badge>{selectedRole.isSystem ? "System" : "Custom"}</Badge>
            <span>{selectedRole.memberCount ?? 0} member{selectedRole.memberCount === 1 ? "" : "s"}</span>
          </div>
          <p>{selectedRole.description || "Module permissions for this role."}</p>
        </div>

        <div className={styles.tableScroll} tabIndex={0}>
          <table data-record-table="" aria-label={`Module permissions for ${selectedRole.name}`} className={styles.permissionTable}>
            <colgroup>
              <col className={styles.moduleColumn} />
              <col className={styles.parentColumn} />
              {ROLE_PERMISSION_ACTIONS.map((action) => <col className={styles.actionColumn} key={action.id} />)}
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Module</th>
                <th scope="col">Parent module</th>
                {ROLE_PERMISSION_ACTIONS.map((action) => <th key={action.id} scope="col">{action.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROLE_PERMISSION_MODULES.map((module) => {
                const ModuleIcon = MODULE_ICONS[module.id];
                return <tr key={module.id}>
                  <th scope="row">
                    <span className={styles.moduleIdentity}>
                      <span className={styles.moduleIcon}><ModuleIcon aria-hidden="true" size={15} /></span>
                      <span><strong>{module.label}</strong><small>{module.description}</small></span>
                    </span>
                  </th>
                  <td className={styles.parentModule}><Badge>{module.parentModule}</Badge></td>
                  {ROLE_PERMISSION_ACTIONS.map((action) => {
                    const code = modulePermissionCode(module.id, action.id);
                    return <td key={action.id}>
                      <Switch
                        aria-label={`${selectedRole.name}: ${module.label} ${action.label}`}
                        isDisabled={!isEditable}
                        isSelected={selectedPermissions.has(code)}
                        onChange={(enabled) => togglePermission(module, action, enabled)}
                      />
                    </td>;
                  })}
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <p className={styles.permissionNote}>
          {selectedRole.isSystem
            ? "System role permissions are managed by Wodana and cannot be changed."
            : "Each setting applies to every feature inside that module."}
        </p>
      </section>

      <RoleDialog initialData={initialData} item={editingRole} key={editingRole === "new" ? "role-new" : editingRole?.id ?? "role-closed"} onClose={() => setEditingRole(null)} onSaved={(role) => { mergeRole(role); setSelectedRoleId(role.id); setEditingRole(null); setStatus(`${role.name} was saved.`); }} />
      <ConfirmationDialog body={deletingRole ? <>Delete <strong>{deletingRole.name}</strong>? This cannot be undone.</> : null} confirmLabel={deleting ? "Deleting…" : "Delete role"} isOpen={Boolean(deletingRole)} onConfirm={() => void deleteRole()} onOpenChange={(open) => { if (!open && !deleting) setDeletingRole(null); }} title="Delete custom role?" />
    </DesignSystemProvider>
  );
}

function RoleDialog({ initialData, item, onClose, onSaved }: { initialData: RolesPermissionsPageData; item: WorkspaceRole | "new" | null; onClose: () => void; onSaved: (role: WorkspaceRole) => void }) {
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

  return <ControlledModalDialog description={existing ? "Update the role details. Module permissions stay in the table." : "Create the role, then choose its module access from the table."} footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>Cancel</Button><Button form={formId} isLoading={saving} type="submit" variant="primary">Save role</Button></div>} isDismissable={!saving} isOpen={Boolean(item)} onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={existing ? "Edit custom role" : "Create custom role"}>
    <form className={styles.form} id={formId} onSubmit={save}>
      {failure ? <Callout title="Could not save role" tone="danger">{failure}</Callout> : null}
      <div className={styles.formColumns}>
        <TextInput isRequired label="Role name" onChange={(value) => { setName(value); if (!existing && !codeTouched) setCode(roleCode(value)); }} placeholder="Studio lead" value={name} />
        <TextInput description={existing ? "Role codes cannot be changed." : "Used internally for access assignments."} isDisabled={Boolean(existing)} isRequired label="Role code" onChange={(value) => { setCodeTouched(true); setCode(roleCode(value)); }} placeholder="studio_lead" value={code} />
      </div>
      <TextAreaField label="Description" onChange={setDescription} placeholder="What members with this role can do" value={description} />
    </form>
  </ControlledModalDialog>;
}
