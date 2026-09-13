"use client";

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Copy, Download, Sparkles, Upload } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Checkbox,
  ControlledModalDialog,
  DesignSystemProvider,
  GroupedTable,
  IconMenuButton,
  SelectField,
  TextInput,
  ValidationSummary,
  formatDate,
  type GroupedTableColumn,
  type GroupedTableSection,
} from "@/design-system";
import {
  readableRole,
  type MembersPageData,
  type WorkspaceInvitation,
  type WorkspaceMember,
} from "@/lib/workspace/members";
import styles from "./members-page.module.css";

type DirectoryRow =
  | { id: string; kind: "member"; member: WorkspaceMember }
  | { id: string; kind: "invitation"; invitation: WorkspaceInvitation };

type InvitationResult = {
  deliveryStatus: "sent" | "not_configured" | "failed";
  email: string;
  expiresAt: string;
  link: string;
};

type BulkInvitationResult = {
  created: InvitationResult[];
  failedEmails: string[];
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CSV_EMAIL_PATTERN = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAX_BULK_INVITATIONS = 50;

function parseEmailList(value: string): string[] {
  return Array.from(new Set(
    value.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean),
  ));
}

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

function dateLabel(value: string | null, prefix?: string) {
  if (!value) return "Not recorded";
  return `${prefix ? `${prefix} ` : ""}${formatDate(value, { locale: "en-GB", timeZone: "Asia/Dubai" })}`;
}

function inviteeFallback(email: string) {
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function MembersPage({ initialData }: { initialData: MembersPageData }) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [members, setMembers] = useState(initialData.members);
  const [invitations, setInvitations] = useState(initialData.invitations);
  const [status, setStatus] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const defaultRole = initialData.roles.find((role) => role.code === "member")?.code
    ?? initialData.roles.find((role) => role.code === "viewer")?.code
    ?? initialData.roles[0]?.code
    ?? "";
  const [quickEmail, setQuickEmail] = useState("");
  const [quickRole, setQuickRole] = useState(defaultRole);
  const [quickFailure, setQuickFailure] = useState("");
  const [isQuickInviting, setIsQuickInviting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState<Set<string>>(() => {
    return new Set(defaultRole ? [defaultRole] : []);
  });
  const [inviteErrors, setInviteErrors] = useState<string[]>([]);
  const [inviteFailure, setInviteFailure] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [invitationResult, setInvitationResult] = useState<InvitationResult | null>(null);
  const [bulkInvitationResult, setBulkInvitationResult] = useState<BulkInvitationResult | null>(null);
  const [copyStatus, setCopyStatus] = useState("");

  const [editingMember, setEditingMember] = useState<WorkspaceMember | null>(null);
  const [editRoles, setEditRoles] = useState<Set<string>>(new Set());
  const [editStatus, setEditStatus] = useState<"active" | "suspended">("active");
  const [editFailure, setEditFailure] = useState("");
  const [isSavingMember, setIsSavingMember] = useState(false);

  const [cancellingInvitation, setCancellingInvitation] = useState<WorkspaceInvitation | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [actionFailure, setActionFailure] = useState("");
  const [isResending, setIsResending] = useState(false);

  const exportRows = (selectedRows: DirectoryRow[]) => {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [
      ["Name", "Email", "Access", "Status", "Added"].map(quote).join(","),
      ...selectedRows.map((row) => {
        const record = row.kind === "member" ? row.member : row.invitation;
        const roleCodes = row.kind === "member" ? row.member.roles : row.invitation.roles;
        const added = row.kind === "member" ? row.member.joinedAt ?? "" : row.invitation.createdAt;
        return [record.displayName || inviteeFallback(record.email), record.email, roleCodes.map((role) => readableRole(role, initialData.roles)).join("; "), record.status, added].map(quote).join(",");
      }),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wodana-members.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const visibleInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.status === "pending" || invitation.status === "expired"),
    [invitations],
  );
  const invitedRows = useMemo<DirectoryRow[]>(() => visibleInvitations.map((invitation) => ({
    id: `invitation-${invitation.id}`,
    kind: "invitation" as const,
    invitation,
  })), [visibleInvitations]);
  const guestRows = useMemo<DirectoryRow[]>(() => members
    .filter((member) => member.roles.length > 0 && member.roles.every((role) => role === "viewer"))
    .map((member) => ({ id: `member-${member.id}`, kind: "member" as const, member })), [members]);
  const memberRows = useMemo<DirectoryRow[]>(() => members
    .filter((member) => !member.roles.length || member.roles.some((role) => role !== "viewer"))
    .map((member) => ({ id: `member-${member.id}`, kind: "member" as const, member })), [members]);
  const rows = useMemo(() => [...invitedRows, ...guestRows, ...memberRows], [guestRows, invitedRows, memberRows]);
  const quickInviteEmails = useMemo(() => parseEmailList(quickEmail), [quickEmail]);

  const openInvite = () => {
    setInviteName("");
    setInviteEmail("");
    setInviteErrors([]);
    setInviteFailure("");
    setInvitationResult(null);
    setBulkInvitationResult(null);
    setCopyStatus("");
    setInviteRoles(new Set(defaultRole ? [defaultRole] : []));
    setInviteOpen(true);
  };

  const requestInvitation = async ({ displayName, email, roleCodes }: { displayName: string; email: string; roleCodes: string[] }) => {
    const response = await fetch("/api/workspace/members/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: initialData.workspaceId, displayName, email, roleCodes }),
    });
    if (!response.ok) throw new Error(await responseMessage(response, "The invitation could not be created."));
    const payload = await response.json() as {
      id: string;
      displayName: string;
      email: string;
      roleCodes: string[];
      expiresAt: string;
      invitationToken: string;
      emailDelivery?: { status?: "sent" | "not_configured" | "failed" };
    };
    const invitation: WorkspaceInvitation = {
      id: payload.id,
      displayName: payload.displayName || displayName,
      email: payload.email,
      status: "pending",
      expiresAt: payload.expiresAt,
      acceptedAt: null,
      cancelledAt: null,
      createdAt: new Date().toISOString(),
      invitedByName: initialData.currentUserName,
      roles: payload.roleCodes,
    };
    setInvitations((current) => [invitation, ...current.filter((item) => item.id !== invitation.id)]);
    const activation = new URL("/login", window.location.origin);
    activation.searchParams.set("invitation", payload.invitationToken);
    return {
      invitation,
      result: {
        deliveryStatus: payload.emailDelivery?.status ?? "not_configured",
        email: payload.email,
        expiresAt: payload.expiresAt,
        link: activation.toString(),
      } satisfies InvitationResult,
    };
  };

  const createQuickInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const emails = parseEmailList(quickEmail);
    setQuickFailure("");
    if (!emails.length || emails.some((email) => !EMAIL_PATTERN.test(email))) {
      setQuickFailure("Enter valid work email addresses separated by commas or spaces.");
      return;
    }
    if (emails.length > MAX_BULK_INVITATIONS) {
      setQuickFailure(`Invite up to ${MAX_BULK_INVITATIONS} people at a time.`);
      return;
    }
    if (!quickRole) {
      setQuickFailure("Choose an access role.");
      return;
    }
    setIsQuickInviting(true);
    try {
      const created: InvitationResult[] = [];
      const failedEmails: string[] = [];
      for (let start = 0; start < emails.length; start += 5) {
        const batch = emails.slice(start, start + 5);
        await Promise.all(batch.map(async (email) => {
          try {
            const response = await requestInvitation({
              displayName: inviteeFallback(email),
              email,
              roleCodes: [quickRole],
            });
            created.push(response.result);
          } catch {
            failedEmails.push(email);
          }
        }));
      }
      if (!created.length) {
        setQuickFailure("None of the invitations could be created. Check for existing members or pending invitations.");
        return;
      }
      setQuickEmail("");
      setCopyStatus("");
      if (emails.length === 1 && !failedEmails.length) {
        setInvitationResult(created[0]);
        setBulkInvitationResult(null);
      } else {
        setInvitationResult(null);
        setBulkInvitationResult({ created, failedEmails });
      }
      setInviteOpen(true);
      const emailed = created.filter((item) => item.deliveryStatus === "sent").length;
      setStatus(`${created.length} invitation${created.length === 1 ? "" : "s"} created${emailed ? `; ${emailed} emailed` : ""}.`);
      if (failedEmails.length) {
        setQuickFailure(`${failedEmails.length} address${failedEmails.length === 1 ? "" : "es"} could not be invited.`);
      }
    } catch (error) {
      setQuickFailure(error instanceof Error ? error.message : "The invitation could not be created.");
    } finally {
      setIsQuickInviting(false);
    }
  };

  const loadInvitationCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setQuickFailure("");
    if (file.size > 1024 * 1024) {
      setQuickFailure("Choose a CSV file smaller than 1 MB.");
      return;
    }
    const emails = Array.from(new Set(
      (await file.text()).match(CSV_EMAIL_PATTERN)?.map((email) => email.toLowerCase()) ?? [],
    ));
    if (!emails.length) {
      setQuickFailure("No valid email addresses were found in that CSV file.");
      return;
    }
    if (emails.length > MAX_BULK_INVITATIONS) {
      setQuickFailure(`The CSV contains ${emails.length} addresses. Invite up to ${MAX_BULK_INVITATIONS} at a time.`);
      return;
    }
    setQuickEmail(emails.join(", "));
  };

  const createInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = [
      inviteName.trim().length < 2 ? "Enter the member's full name." : "",
      /^\S+@\S+\.\S+$/.test(inviteEmail) ? "" : "Enter a valid work email address.",
      inviteRoles.size ? "" : "Select at least one workspace role.",
    ].filter(Boolean);
    setInviteErrors(errors);
    setInviteFailure("");
    if (errors.length) return;

    setIsInviting(true);
    try {
      const created = await requestInvitation({
        displayName: inviteName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        roleCodes: Array.from(inviteRoles),
      });
      setInvitationResult(created.result);
      setBulkInvitationResult(null);
      setCopyStatus("");
      setStatus(created.result.deliveryStatus === "sent"
        ? `Invitation emailed to ${created.result.email}.`
        : `Invitation created for ${created.result.email}.`);
    } catch (error) {
      setInviteFailure(error instanceof Error ? error.message : "The invitation could not be created.");
    } finally {
      setIsInviting(false);
    }
  };

  const copyInvitation = async () => {
    if (!invitationResult) return;
    try {
      await navigator.clipboard.writeText(invitationResult.link);
      setCopyStatus("Activation link copied.");
    } catch {
      setCopyStatus("Copy failed. Select and copy the link manually.");
    }
  };

  const downloadBulkFallbackLinks = () => {
    if (!bulkInvitationResult) return;
    const fallbackLinks = bulkInvitationResult.created.filter((item) => item.deliveryStatus !== "sent");
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [
      ["Email", "Activation link", "Email delivery"].map(quote).join(","),
      ...fallbackLinks.map((item) => [item.email, item.link, item.deliveryStatus].map(quote).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wodana-invitation-links.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openMemberEditor = (member: WorkspaceMember) => {
    setEditingMember(member);
    setEditRoles(new Set(member.roles));
    setEditStatus(member.status);
    setEditFailure("");
  };

  const saveMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingMember) return;
    if (!editRoles.size) {
      setEditFailure("Select at least one workspace role.");
      return;
    }
    setIsSavingMember(true);
    setEditFailure("");
    try {
      const response = await fetch(`/api/workspace/members/${editingMember.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: initialData.workspaceId,
          version: editingMember.version,
          status: editStatus,
          roleCodes: Array.from(editRoles),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The member could not be updated."));
      const updated = await response.json() as WorkspaceMember;
      setMembers((current) => current.map((member) => member.id === updated.id ? updated : member));
      setEditingMember(null);
      setStatus(`${updated.displayName}'s access was updated.`);
    } catch (error) {
      setEditFailure(error instanceof Error ? error.message : "The member could not be updated.");
    } finally {
      setIsSavingMember(false);
    }
  };

  const resendInvitation = async (invitation: WorkspaceInvitation) => {
    setIsResending(true);
    setActionFailure("");
    try {
      const response = await fetch(`/api/workspace/members/invitations/${invitation.id}/resend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: initialData.workspaceId }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The invitation could not be renewed."));
      const payload = await response.json() as {
        email: string;
        expiresAt: string;
        invitationToken: string;
        emailDelivery?: { status?: "sent" | "not_configured" | "failed" };
      };
      setInvitations((current) => current.map((item) => item.id === invitation.id
        ? { ...item, status: "pending", expiresAt: payload.expiresAt }
        : item));
      const activation = new URL("/login", window.location.origin);
      activation.searchParams.set("invitation", payload.invitationToken);
      setInvitationResult({
        deliveryStatus: payload.emailDelivery?.status ?? "not_configured",
        email: payload.email,
        expiresAt: payload.expiresAt,
        link: activation.toString(),
      });
      setBulkInvitationResult(null);
      setCopyStatus("");
      setInviteOpen(true);
      setStatus(payload.emailDelivery?.status === "sent"
        ? `Invitation re-emailed to ${payload.email}.`
        : `Invitation renewed for ${payload.email}.`);
    } catch (error) {
      setActionFailure(error instanceof Error ? error.message : "The invitation could not be renewed.");
    } finally {
      setIsResending(false);
    }
  };

  const cancelInvitation = async () => {
    if (!cancellingInvitation) return;
    setIsCancelling(true);
    setActionFailure("");
    try {
      const response = await fetch(`/api/workspace/members/invitations/${cancellingInvitation.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: initialData.workspaceId }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The invitation could not be cancelled."));
      setInvitations((current) => current.map((item) => item.id === cancellingInvitation.id
        ? { ...item, status: "cancelled", cancelledAt: new Date().toISOString() }
        : item));
      setStatus(`Invitation for ${cancellingInvitation.email} was cancelled.`);
      setCancellingInvitation(null);
    } catch (error) {
      setActionFailure(error instanceof Error ? error.message : "The invitation could not be cancelled.");
      setCancellingInvitation(null);
    } finally {
      setIsCancelling(false);
    }
  };

  const columns: GroupedTableColumn<DirectoryRow>[] = [
    {
      id: "person",
      label: "Person",
      width: "25%",
      render: (item) => {
        const name = item.kind === "member"
          ? item.member.displayName
          : item.invitation.displayName || inviteeFallback(item.invitation.email);
        const isCurrentUser = item.kind === "member" && item.member.userId === initialData.currentUserId;
        return <span className={styles.identity}><Avatar name={name} /><strong>{name}</strong>{isCurrentUser ? <small>(You)</small> : null}</span>;
      },
    },
    {
      id: "date",
      label: "Created at",
      mobileHidden: true,
      width: "17%",
      render: (item) => dateLabel(item.kind === "member" ? item.member.joinedAt : item.invitation.createdAt),
    },
    {
      id: "email",
      label: "Email",
      width: "25%",
      render: (item) => {
        const email = item.kind === "member" ? item.member.email : item.invitation.email;
        return <a className={styles.emailLink} href={`mailto:${email}`}>{email}</a>;
      },
    },
    {
      id: "role",
      label: "Role",
      width: "15%",
      render: (item) => {
        const roleCodes = item.kind === "member" ? item.member.roles : item.invitation.roles;
        return <span className={styles.roleText}>{roleCodes.map((role) => readableRole(role, initialData.roles)).join(", ") || "Member"}</span>;
      },
    },
    {
      id: "status",
      label: "Status",
      width: "12%",
      render: (item) => {
        const value = item.kind === "member" ? item.member.status : item.invitation.status;
        const label = value === "pending" ? "Pending" : value[0].toUpperCase() + value.slice(1);
        const tone = value === "active" ? "success" : value === "pending" ? "info" : value === "expired" ? "warning" : "neutral";
        return <Badge tone={tone}>{label}</Badge>;
      },
    },
    {
      id: "actions",
      label: "",
      width: "3rem",
      render: (item) => {
        if (!initialData.canManage) return null;
        if (item.kind === "member") {
          return <IconMenuButton ariaLabel={`Actions for ${item.member.displayName}`} items={[{ id: "edit", label: "Edit access" }]} onAction={() => openMemberEditor(item.member)} />;
        }
        return <IconMenuButton ariaLabel={`Actions for invitation to ${item.invitation.email}`} items={[
          { id: "resend", label: item.invitation.status === "expired" ? "Renew invitation" : "Create a new link", isDisabled: isResending },
          { id: "cancel", label: "Cancel invitation", tone: "danger" },
        ]} onAction={(action) => action === "resend" ? void resendInvitation(item.invitation) : setCancellingInvitation(item.invitation)} />;
      },
    },
  ];

  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const sectionDefinitions: GroupedTableSection<DirectoryRow>[] = [
    { id: "invited", label: "Invited", emptyMessage: "No pending invitations.", rows: invitedRows, headerLabels: { date: "Invited at", role: "Type", status: "Invitation" } },
    { id: "guests", label: "Guest", emptyMessage: "No guests have access.", rows: guestRows, headerLabels: { date: "Created at", role: "Permission", status: "Status" } },
    { id: "members", label: "Member", emptyMessage: "No members have joined yet.", rows: memberRows, headerLabels: { date: "Created at", role: "Role", status: "Status" } },
  ];
  const tableSections = sectionDefinitions.some((section) => section.rows.length)
    ? sectionDefinitions.filter((section) => section.rows.length)
    : [sectionDefinitions[2]];
  const bulkFallbackCount = bulkInvitationResult?.created
    .filter((item) => item.deliveryStatus !== "sent").length ?? 0;
  const hasInvitationOutcome = Boolean(invitationResult || bulkInvitationResult);

  return (
    <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
      <section aria-labelledby="members-heading" className={styles.page}>
        <header className={styles.pageHeading}>
          <h1 id="members-heading">Member settings</h1>
          <p>Manage and view your coworkers and guests.</p>
        </header>

        {initialData.canManage ? <section aria-label="Invite people" className={styles.inviteComposer}>
          <form className={styles.quickInviteForm} onSubmit={createQuickInvitation}>
            <label className={styles.visuallyHidden} htmlFor="quick-invite-email">Email addresses to invite</label>
            <input autoComplete="off" id="quick-invite-email" inputMode="email" onChange={(event) => setQuickEmail(event.target.value)} placeholder="Add emails…" type="text" value={quickEmail} />
            <div className={styles.quickRole}>
              <SelectField
                accent="neutral"
                aria-label="Invitation role"
                items={initialData.roles.map((role) => ({ id: role.code, label: role.name }))}
                label={<span className={styles.visuallyHidden}>Invitation role</span>}
                onSelectionChange={(key) => key && setQuickRole(String(key))}
                selectedKey={quickRole}
              />
            </div>
            <Button className={styles.inviteButton} variant="primary" isLoading={isQuickInviting} type="submit">Invite{quickInviteEmails.length ? ` (${quickInviteEmails.length})` : ""}</Button>
          </form>
          <div className={styles.inviteComposerFooter}>
            <div className={styles.inviteComposerActions}>
              <Button onPress={openInvite} size="compact" variant="quiet"><Sparkles aria-hidden="true" size={14} />Personalize invitation</Button>
              <input accept=".csv,text/csv" aria-label="Upload invitation CSV" className={styles.visuallyHidden} onChange={loadInvitationCsv} ref={csvInputRef} type="file" />
              <Button onPress={() => csvInputRef.current?.click()} size="compact" variant="quiet"><Upload aria-hidden="true" size={14} />Upload CSV</Button>
            </div>
            <span>Activation links expire automatically after 7 days.</span>
          </div>
          {quickFailure ? <p className={styles.composerError} role="alert">{quickFailure}</p> : null}
        </section> : null}

        {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
        {actionFailure ? <Callout title="Member action failed" tone="danger">{actionFailure}</Callout> : null}

        {selectedRows.length ? <div className={styles.selectionBar}>
          <span><strong>{selectedRows.length}</strong> selected</span>
          <Button onPress={() => exportRows(selectedRows)} size="compact"><Download aria-hidden="true" size={14} />Export selected</Button>
        </div> : null}

        <div className={styles.tableRegion}>
          <GroupedTable appearance="enclosed"
            ariaLabel="Workspace members"
            columns={columns}
            getRowId={(row) => row.id}
            getRowLabel={(row) => row.kind === "member" ? row.member.displayName : row.invitation.email}
            onSelectionChange={setSelectedIds}
            sections={tableSections}
            selectedIds={selectedIds}
          />
        </div>
        {!initialData.canManage ? <p className={styles.permissionNote}>Only workspace owners and administrators can invite people or change access.</p> : null}
      </section>

      <ControlledModalDialog
        description={invitationResult
          ? invitationResult.deliveryStatus === "sent"
            ? "The invitation was emailed. The secure copy link is shown only now."
            : "Email was not delivered. Share this secure link with the invited member; it is shown only now."
          : bulkInvitationResult
            ? "Bulk invitation processing is complete."
            : "The member will receive access after activating the invitation."}
        footer={hasInvitationOutcome
          ? <div className="wd-dialog-actions"><Button onPress={() => setInviteOpen(false)}>Done</Button></div>
          : <div className="wd-dialog-actions"><Button isDisabled={isInviting} onPress={() => setInviteOpen(false)}>Cancel</Button><Button form="invite-member-form" isLoading={isInviting} type="submit" variant="primary">Create invitation</Button></div>}
        isDismissable={!isInviting}
        isOpen={inviteOpen}
        onOpenChange={(open) => { if (!isInviting) setInviteOpen(open); }}
        title={invitationResult ? "Invitation ready" : bulkInvitationResult ? "Bulk invitations ready" : "Invite a member"}
      >
        {invitationResult ? <div className={styles.invitationReady}>
          <Callout title={`${invitationResult.deliveryStatus === "sent" ? "Invitation emailed to" : "Invitation created for"} ${invitationResult.email}`} tone="success">The link expires {dateLabel(invitationResult.expiresAt)}.</Callout>
          <label className={styles.linkField}><span>Activation link</span><span><input onFocus={(event) => event.currentTarget.select()} readOnly value={invitationResult.link} /><Button onPress={copyInvitation} size="compact"><Copy aria-hidden="true" size={14} />Copy</Button></span></label>
          <p aria-live="polite">{copyStatus}</p>
        </div> : bulkInvitationResult ? <div className={styles.invitationReady}>
          <Callout title={`${bulkInvitationResult.created.length} invitation${bulkInvitationResult.created.length === 1 ? "" : "s"} created`} tone="success">
            {bulkInvitationResult.created.length - bulkFallbackCount} email{bulkInvitationResult.created.length - bulkFallbackCount === 1 ? " was" : "s were"} accepted for delivery.
          </Callout>
          {bulkFallbackCount ? <Callout title={`${bulkFallbackCount} fallback link${bulkFallbackCount === 1 ? "" : "s"} need sharing`} tone="warning">
            Email was not delivered for these invitations. Download their one-time activation links before closing.
          </Callout> : null}
          {bulkFallbackCount ? <Button onPress={downloadBulkFallbackLinks}><Download aria-hidden="true" size={14} />Download fallback links</Button> : null}
          {bulkInvitationResult.failedEmails.length ? <Callout title={`${bulkInvitationResult.failedEmails.length} invitation${bulkInvitationResult.failedEmails.length === 1 ? "" : "s"} failed`} tone="danger">
            {bulkInvitationResult.failedEmails.slice(0, 5).join(", ")}{bulkInvitationResult.failedEmails.length > 5 ? ` and ${bulkInvitationResult.failedEmails.length - 5} more` : ""}
          </Callout> : null}
        </div> : <form className={styles.form} data-wd-density="compact" id="invite-member-form" noValidate onSubmit={createInvitation}>
          <ValidationSummary errors={inviteErrors} />
          {inviteFailure ? <Callout title="Could not create invitation" tone="danger">{inviteFailure}</Callout> : null}
          <TextInput isRequired label="Full name" onChange={setInviteName} placeholder="e.g. Maya Thomas" value={inviteName} />
          <TextInput inputType="email" isRequired label="Work email" onChange={setInviteEmail} placeholder="maya@company.com" value={inviteEmail} />
          <RoleChoices onChange={setInviteRoles} roles={initialData.roles} selected={inviteRoles} />
        </form>}
      </ControlledModalDialog>

      <ControlledModalDialog
        description={editingMember ? `Update workspace access for ${editingMember.email}.` : undefined}
        footer={<div className="wd-dialog-actions"><Button isDisabled={isSavingMember} onPress={() => setEditingMember(null)}>Cancel</Button><Button form="edit-member-form" isLoading={isSavingMember} type="submit" variant="primary">Save access</Button></div>}
        isDismissable={!isSavingMember}
        isOpen={Boolean(editingMember)}
        onOpenChange={(open) => { if (!open && !isSavingMember) setEditingMember(null); }}
        title="Edit member access"
      >
        {editingMember ? <form className={styles.form} data-wd-density="compact" id="edit-member-form" noValidate onSubmit={saveMember}>
          {editFailure ? <Callout title="Could not save member" tone="danger">{editFailure}</Callout> : null}
          <div className={styles.memberPreview}><Avatar name={editingMember.displayName} size="lg" /><span><strong>{editingMember.displayName}</strong><small>{editingMember.email}</small></span></div>
          <RoleChoices onChange={setEditRoles} roles={initialData.roles} selected={editRoles} />
          <SelectField
            accent="neutral"
            description={editingMember.userId === initialData.currentUserId ? "You cannot suspend your own active session here." : "Suspended members cannot sign in to this workspace."}
            isDisabled={editingMember.userId === initialData.currentUserId}
            items={[{ id: "active", label: "Active" }, { id: "suspended", label: "Suspended" }]}
            label="Member status"
            onSelectionChange={(key) => key && setEditStatus(String(key) as "active" | "suspended")}
            selectedKey={editStatus}
          />
        </form> : null}
      </ControlledModalDialog>

      <ControlledModalDialog
        footer={<div className="wd-dialog-actions"><Button isDisabled={isCancelling} onPress={() => setCancellingInvitation(null)}>Keep invitation</Button><Button isLoading={isCancelling} onPress={cancelInvitation} variant="danger">Cancel invitation</Button></div>}
        isDismissable={!isCancelling}
        isOpen={Boolean(cancellingInvitation)}
        onOpenChange={(open) => { if (!open && !isCancelling) setCancellingInvitation(null); }}
        title="Cancel invitation?"
      >
        {cancellingInvitation ? <>The activation link for <strong>{cancellingInvitation.email}</strong> will stop working immediately.</> : null}
      </ControlledModalDialog>
    </DesignSystemProvider>
  );
}

function RoleChoices({
  onChange,
  roles,
  selected,
}: {
  onChange: (roles: Set<string>) => void;
  roles: MembersPageData["roles"];
  selected: Set<string>;
}) {
  return <fieldset className={styles.roleChoices}><legend>Workspace roles <span aria-hidden="true">*</span></legend><p>Select one or more roles. Permissions are combined when multiple roles are assigned.</p><div>{roles.map((role) => <Checkbox isSelected={selected.has(role.code)} key={role.id} onChange={(checked) => { const next = new Set(selected); if (checked) next.add(role.code); else next.delete(role.code); onChange(next); }}><span><strong>{role.name}</strong><small>{role.description}</small></span></Checkbox>)}</div></fieldset>;
}
