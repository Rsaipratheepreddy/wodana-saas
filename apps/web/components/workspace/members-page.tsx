"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Copy, Download } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Checkbox,
  ConfirmationDialog,
  ControlledModalDialog,
  DesignSystemProvider,
  FileUploader,
  Form,
  GroupedTable,
  IconMenuButton,
  MultiSelectField,
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

function sameRoles(roles: readonly string[], selected: ReadonlySet<string>) {
  return roles.length === selected.size && roles.every((role) => selected.has(role));
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
  const [quickAccess, setQuickAccess] = useState(initialData.teams[0] ? `team:${initialData.teams[0].id}` : `role:${defaultRole}`);
  const [quickFailure, setQuickFailure] = useState("");
  const [isQuickInviting, setIsQuickInviting] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState<Set<string>>(new Set());
  const [inviteTeamIds, setInviteTeamIds] = useState<Set<string>>(new Set());
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
  const [memberReviewOpen, setMemberReviewOpen] = useState(false);

  const [cancellingInvitation, setCancellingInvitation] = useState<WorkspaceInvitation | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [actionFailure, setActionFailure] = useState("");
  const [isResending, setIsResending] = useState(false);

  const exportRows = (selectedRows: DirectoryRow[]) => {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [
      ["Name", "Email", "Access", "Team", "Status", "Added"].map(quote).join(","),
      ...selectedRows.map((row) => {
        const record = row.kind === "member" ? row.member : row.invitation;
        const roleCodes = row.kind === "member" ? [...row.member.roles, ...(row.member.inheritedRoles ?? [])] : row.invitation.roles;
        const teams = (record.teams ?? []).map((team) => team.name).join("; ");
        const added = row.kind === "member" ? row.member.joinedAt ?? "" : row.invitation.createdAt;
        return [record.displayName || inviteeFallback(record.email), record.email, [...new Set(roleCodes)].map((role) => readableRole(role, initialData.roles)).join("; "), teams, record.status, added].map(quote).join(",");
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
    .filter((member) => [...member.roles, ...(member.inheritedRoles ?? [])].length > 0 && [...member.roles, ...(member.inheritedRoles ?? [])].every((role) => role === "viewer"))
    .map((member) => ({ id: `member-${member.id}`, kind: "member" as const, member })), [members]);
  const memberRows = useMemo<DirectoryRow[]>(() => members
    .filter((member) => ![...member.roles, ...(member.inheritedRoles ?? [])].length || [...member.roles, ...(member.inheritedRoles ?? [])].some((role) => role !== "viewer"))
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
    setInviteRoles(new Set());
    setInviteTeamIds(new Set());
    setInviteOpen(true);
  };

  const requestInvitation = async ({ displayName, email, roleCodes, teamIds = [] }: { displayName: string; email: string; roleCodes: string[]; teamIds?: string[] }) => {
    const response = await fetch("/api/workspace/members/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: initialData.workspaceId, displayName, email, roleCodes, teamIds }),
    });
    if (!response.ok) throw new Error(await responseMessage(response, "The invitation could not be created."));
    const payload = await response.json() as {
      id: string;
      displayName: string;
      email: string;
      roleCodes: string[];
      teamIds?: string[];
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
      teams: initialData.teams.filter((team) => (payload.teamIds ?? teamIds).includes(team.id)),
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
    if (!quickAccess) {
      setQuickFailure("Choose a team or role.");
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
              roleCodes: quickAccess.startsWith("role:") ? [quickAccess.slice(5)] : [],
              teamIds: quickAccess.startsWith("team:") ? [quickAccess.slice(5)] : [],
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

  const loadInvitationCsv = async (files: File[]) => {
    const file = files[0];
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
      inviteRoles.size || inviteTeamIds.size ? "" : "Choose a team or a direct role.",
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
        teamIds: Array.from(inviteTeamIds),
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
    setMemberReviewOpen(false);
  };

  const reviewMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingMember) return;
    if (!editRoles.size && !(editingMember.inheritedRoles?.length)) {
      setEditFailure("Select a direct role or assign an active team role first.");
      return;
    }
    if (editingMember.userId === initialData.currentUserId && editStatus === "suspended") {
      setEditFailure("You cannot suspend your own active session here.");
      return;
    }
    if (sameRoles(editingMember.roles, editRoles) && editStatus === editingMember.status) {
      setEditFailure("No access changes to review.");
      return;
    }
    setEditFailure("");
    setMemberReviewOpen(true);
  };

  const saveMember = async () => {
    if (!editingMember) return;
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
      setMemberReviewOpen(false);
      setEditingMember(null);
      setStatus(`${updated.displayName}'s access was updated.`);
    } catch (error) {
      setEditFailure(error instanceof Error ? error.message : "The member could not be updated.");
      setMemberReviewOpen(false);
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
      mobileWidth: "14rem",
      width: "25%",
      render: (item) => {
        const name = item.kind === "member"
          ? item.member.displayName
          : item.invitation.displayName || inviteeFallback(item.invitation.email);
        const email = item.kind === "member" ? item.member.email : item.invitation.email;
        const isCurrentUser = item.kind === "member" && item.member.userId === initialData.currentUserId;
        return <span className={styles.identity}><Avatar name={name} /><span className={styles.identityDetails}><strong>{name}{isCurrentUser ? " (You)" : ""}</strong><small>{email}</small></span></span>;
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
      mobileHidden: true,
      width: "25%",
      render: (item) => {
        const email = item.kind === "member" ? item.member.email : item.invitation.email;
        return <a className={styles.emailLink} href={`mailto:${email}`}>{email}</a>;
      },
    },
    {
      id: "role",
      label: "Access",
      mobileWidth: "7rem",
      width: "15%",
      render: (item) => {
        const roleCodes = item.kind === "member" ? item.member.roles : item.invitation.roles;
        const inherited = item.kind === "member" ? item.member.inheritedRoles ?? [] : [];
        return <span className={styles.roleText}>{[...roleCodes, ...inherited].map((role) => readableRole(role, initialData.roles)).filter((role, index, all) => all.indexOf(role) === index).join(", ") || "Via team"}</span>;
      },
    },
    {
      id: "team",
      label: "Team",
      mobileHidden: true,
      width: "15%",
      render: (item) => (item.kind === "member" ? item.member.teams : item.invitation.teams)?.map((team) => team.name).join(", ") || "—",
    },
    {
      id: "status",
      label: "Status",
      mobileWidth: "6rem",
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
      mobileWidth: "3rem",
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
    { id: "invited", label: "Invited", emptyMessage: "No pending invitations.", rows: invitedRows, headerLabels: { date: "Invited at", role: "Access", status: "Invitation" } },
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
      <section aria-label="People" className={styles.page}>

        {initialData.canManage ? <section aria-label="Invite people" className={styles.inviteComposer}>
          <Form className={styles.quickInviteForm} onSubmit={createQuickInvitation}>
            <TextInput autoComplete="off" label="Work emails" onChange={setQuickEmail} placeholder="name@company.com" value={quickEmail} />
            <SelectField
              items={[
                ...initialData.teams.map((team) => ({ id: `team:${team.id}`, label: `${team.name} team` })),
                ...initialData.roles.map((role) => ({ id: `role:${role.code}`, label: `${role.name} role` })),
              ]}
              label="Access"
              onSelectionChange={(key) => key && setQuickAccess(String(key))}
              selectedKey={quickAccess}
            />
            <Button variant="primary" isLoading={isQuickInviting} type="submit">Invite{quickInviteEmails.length ? ` (${quickInviteEmails.length})` : ""}</Button>
          </Form>
          <div className={styles.inviteComposerFooter}>
            <div className={styles.inviteComposerActions}>
              <Button onPress={openInvite} size="compact" variant="quiet">Invite with details</Button>
              <FileUploader accept=".csv,text/csv" appearance="button" label="Upload CSV" multiple={false} onFiles={(files) => void loadInvitationCsv(files)} />
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
          <GroupedTable appearance="plain"
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
          <div className={styles.linkField}><TextInput isReadOnly label="Activation link" onFocus={(event) => event.currentTarget.select()} value={invitationResult.link} /><Button onPress={copyInvitation} size="compact"><Copy aria-hidden="true" size={14} />Copy</Button></div>
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
        </div> : <Form className={styles.form} data-wd-density="compact" id="invite-member-form" noValidate onSubmit={createInvitation}>
          <ValidationSummary errors={inviteErrors} />
          {inviteFailure ? <Callout title="Could not create invitation" tone="danger">{inviteFailure}</Callout> : null}
          <TextInput isRequired label="Full name" onChange={setInviteName} placeholder="e.g. Maya Thomas" value={inviteName} />
          <TextInput inputType="email" isRequired label="Work email" onChange={setInviteEmail} placeholder="maya@company.com" value={inviteEmail} />
          <MultiSelectField items={initialData.teams.map((team) => ({ id: team.id, label: team.name }))} label="Teams" onSelectionChange={(keys) => setInviteTeamIds(new Set(Array.from(keys, String)))} selectedKeys={inviteTeamIds} />
          <RoleChoices onChange={setInviteRoles} roles={initialData.roles} selected={inviteRoles} />
        </Form>}
      </ControlledModalDialog>

      <ControlledModalDialog
        description={editingMember ? `Update workspace access for ${editingMember.email}.` : undefined}
        footer={<div className="wd-dialog-actions"><Button isDisabled={isSavingMember} onPress={() => { setMemberReviewOpen(false); setEditingMember(null); }}>Cancel</Button><Button form="edit-member-form" isLoading={isSavingMember} type="submit" variant="primary">Review changes</Button></div>}
        isDismissable={!isSavingMember}
        isOpen={Boolean(editingMember)}
        onOpenChange={(open) => { if (!open && !isSavingMember) { setMemberReviewOpen(false); setEditingMember(null); } }}
        title="Edit member access"
      >
        {editingMember ? <Form className={styles.form} data-wd-density="compact" id="edit-member-form" noValidate onSubmit={reviewMember}>
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
        </Form> : null}
      </ControlledModalDialog>

      <ConfirmationDialog
        body={editingMember ? <div className={styles.accessReview}>
          <p>Confirm the effective access change for <strong>{editingMember.displayName}</strong>.</p>
          <dl>
            {editStatus !== editingMember.status ? <div><dt>Status</dt><dd><span>{editingMember.status === "active" ? "Active" : "Suspended"}</span><span aria-hidden="true">→</span><strong>{editStatus === "active" ? "Active" : "Suspended"}</strong></dd></div> : null}
            {!sameRoles(editingMember.roles, editRoles) ? <div><dt>Direct roles</dt><dd><span>{editingMember.roles.map((role) => readableRole(role, initialData.roles)).join(", ") || "None"}</span><span aria-hidden="true">→</span><strong>{Array.from(editRoles).map((role) => readableRole(role, initialData.roles)).join(", ") || "None"}</strong></dd></div> : null}
            <div><dt>Team access</dt><dd><strong>{editingMember.teams?.map((team) => team.name).join(", ") || "No assigned teams"}</strong></dd></div>
          </dl>
          {editStatus === "suspended" && editingMember.status !== "suspended" ? <Callout title="This releases a licensed seat" tone="warning">The member will lose workspace access immediately. Their records remain available, and reactivation will require a free seat.</Callout> : null}
          {editingMember.inheritedRoles?.length ? <p className={styles.reviewNote}>Team-inherited roles remain managed from Teams.</p> : null}
        </div> : null}
        confirmLabel="Apply access changes"
        confirmVariant="primary"
        isConfirming={isSavingMember}
        isOpen={memberReviewOpen}
        onConfirm={() => void saveMember()}
        onOpenChange={(open) => { if (!isSavingMember) setMemberReviewOpen(open); }}
        title="Apply member access changes?"
      />

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
  return <fieldset className={styles.roleChoices}><legend>Direct roles</legend><div>{roles.map((role) => <Checkbox isSelected={selected.has(role.code)} key={role.id} onChange={(checked) => { const next = new Set(selected); if (checked) next.add(role.code); else next.delete(role.code); onChange(next); }}><span><strong>{role.name}</strong><small>{role.description}</small></span></Checkbox>)}</div></fieldset>;
}
