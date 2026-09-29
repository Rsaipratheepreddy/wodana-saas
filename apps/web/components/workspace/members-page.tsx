"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Copy, Download } from "lucide-react";
import { Avatar, Badge, Button, Callout, Checkbox, ConfirmationDialog, ControlledModalDialog, DesignSystemProvider, FileUploader, Form, FormDialog, GroupedTable, IconMenuButton, MultiSelectField, SelectField, SettingsPage, SettingsRow, SettingsSection, Switch, TextInput, ValidationSummary, formatDate, useDesignSystem, type GroupedTableColumn, type GroupedTableSection } from "@/design-system";
import type { ViewAsSettings, ViewAsTarget } from "@/lib/workspace/view-as";
import { ViewAsDialog } from "./view-as-dialog";
import { OffboardDialog } from "./offboard-dialog";
import type { Translate } from "@/lib/i18n/keys";
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

function dateLabel(value: string | null, t: Translate, context: { locale: string; timeZone: string }) {
  if (!value) return t("Not recorded");
  return formatDate(value, context);
}

function inviteeFallback(email: string) {
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sameRoles(roles: readonly string[], selected: ReadonlySet<string>) {
  return roles.length === selected.size && roles.every((role) => selected.has(role));
}

export function MembersPage({ initialData }: { initialData: MembersPageData }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [members, setMembers] = useState(initialData.members);
  const [offboarding, setOffboarding] = useState<WorkspaceMember | null>(null);
  const [invitations, setInvitations] = useState(initialData.invitations);
  const [status, setStatus] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const canInvite = initialData.canInvite ?? initialData.canManage;
  // Seats before inviting (SP-3): the limit, who uses one, what invitations reserve; full means no new invitations.
  const seats = initialData.seats ?? null;
  const seatsFull = Boolean(seats?.limit && seats.available === 0);
  const canEdit = initialData.canEdit ?? initialData.canManage;
  const canCancelInvitations = initialData.canCancelInvitations ?? initialData.canManage;
  const scopedAssignments = initialData.assignableRoleCodes !== undefined && !initialData.canManage;
  const assignableRoleCodes = new Set(initialData.assignableRoleCodes ?? initialData.roles.map((role) => role.code));
  const assignableRoles = initialData.roles.filter((role) => assignableRoleCodes.has(role.code));
  const assignableRoleIds = new Set(assignableRoles.map((role) => role.id));
  const assignableTeams = initialData.teams.filter((team) => !scopedAssignments
    || (team.roleIds !== undefined && team.roleIds.every((roleId) => assignableRoleIds.has(roleId))));
  const canChangeAssignment = (roles: string[], teams: Array<{ id: string }>) => !scopedAssignments
    || (roles.every((role) => assignableRoleCodes.has(role))
      && teams.every((team) => assignableTeams.some((candidate) => candidate.id === team.id)));

  const defaultRole = assignableRoles.find((role) => role.code === "member")?.code
    ?? assignableRoles.find((role) => role.code === "viewer")?.code
    ?? assignableRoles[0]?.code
    ?? "";
  const [quickEmail, setQuickEmail] = useState("");
  const [quickAccess, setQuickAccess] = useState(assignableTeams[0] ? `team:${assignableTeams[0].id}` : `role:${defaultRole}`);
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

  // View as: an owner or administrator reads the workspace as an active team member (never an owner, unless
  // an owner; never themselves). The server checks the same rules.
  const viewAs = initialData.viewAs;
  const [viewAsTarget, setViewAsTarget] = useState<ViewAsTarget | null>(null);
  const [viewAsSettings, setViewAsSettings] = useState(viewAs?.settings ?? null);
  const [isSavingViewAsSetting, setIsSavingViewAsSetting] = useState(false);
  const canViewAsMember = (member: WorkspaceMember) => Boolean(viewAs?.canViewAs) && member.status === "active"
    && member.userId !== initialData.currentUserId
    && (viewAs?.viewerIsOwner || ![...member.roles, ...(member.inheritedRoles ?? [])].includes("owner"));
  const saveViewAsNotice = async (notifySubject: boolean) => {
    if (!viewAsSettings) return;
    setIsSavingViewAsSetting(true);
    setActionFailure("");
    try {
      const response = await fetch("/api/workspace/view-as/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: initialData.workspaceId, notifySubject, version: viewAsSettings.version }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, t("This setting could not be saved. Refresh and try again.")));
      setViewAsSettings(await response.json() as ViewAsSettings);
    } catch (error) {
      setActionFailure(error instanceof Error ? error.message : t("This setting could not be saved. Refresh and try again."));
    } finally {
      setIsSavingViewAsSetting(false);
    }
  };

  const [cancellingInvitation, setCancellingInvitation] = useState<WorkspaceInvitation | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [actionFailure, setActionFailure] = useState("");
  const [isResending, setIsResending] = useState(false);

  const exportRows = (selectedRows: DirectoryRow[]) => {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [
      [t("Name"), t("Email"), t("Access"), t("Team"), t("Status"), t("Added")].map(quote).join(","),
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
    if (!response.ok) throw new Error(await responseMessage(response, t("The invitation could not be created.")));
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
      setQuickFailure(t("Enter valid work email addresses separated by commas or spaces."));
      return;
    }
    if (emails.length > MAX_BULK_INVITATIONS) {
      setQuickFailure(t("Invite up to {count} people at a time.", { count: MAX_BULK_INVITATIONS }));
      return;
    }
    if (!quickAccess) {
      setQuickFailure(t("Choose a team or role."));
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
        setQuickFailure(t("None of the invitations could be created. Check for existing members or pending invitations."));
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
      setStatus(emailed
        ? (created.length === 1 ? t("1 invitation created; {emailed} emailed.", { emailed }) : t("{count} invitations created; {emailed} emailed.", { count: created.length, emailed }))
        : (created.length === 1 ? t("1 invitation created.") : t("{count} invitations created.", { count: created.length })));
      if (failedEmails.length) {
        setQuickFailure(failedEmails.length === 1 ? t("1 address could not be invited.") : t("{count} addresses could not be invited.", { count: failedEmails.length }));
      }
    } catch (error) {
      setQuickFailure(error instanceof Error ? error.message : t("The invitation could not be created."));
    } finally {
      setIsQuickInviting(false);
    }
  };

  const loadInvitationCsv = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setQuickFailure("");
    if (file.size > 1024 * 1024) {
      setQuickFailure(t("Choose a CSV file smaller than 1 MB."));
      return;
    }
    const emails = Array.from(new Set(
      (await file.text()).match(CSV_EMAIL_PATTERN)?.map((email) => email.toLowerCase()) ?? [],
    ));
    if (!emails.length) {
      setQuickFailure(t("No valid email addresses were found in that CSV file."));
      return;
    }
    if (emails.length > MAX_BULK_INVITATIONS) {
      setQuickFailure(t("The CSV contains {count} addresses. Invite up to {max} at a time.", { count: emails.length, max: MAX_BULK_INVITATIONS }));
      return;
    }
    setQuickEmail(emails.join(", "));
  };

  const createInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = [
      inviteName.trim().length < 2 ? t("Enter the member's full name.") : "",
      /^\S+@\S+\.\S+$/.test(inviteEmail) ? "" : t("Enter a valid work email address."),
      inviteRoles.size || inviteTeamIds.size ? "" : t("Choose a team or a direct role."),
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
        ? t("Invitation emailed to {email}.", { email: created.result.email })
        : t("Invitation created for {email}.", { email: created.result.email }));
    } catch (error) {
      setInviteFailure(error instanceof Error ? error.message : t("The invitation could not be created."));
    } finally {
      setIsInviting(false);
    }
  };

  const copyInvitation = async () => {
    if (!invitationResult) return;
    try {
      await navigator.clipboard.writeText(invitationResult.link);
      setCopyStatus(t("Activation link copied."));
    } catch {
      setCopyStatus(t("Copy failed. Select and copy the link manually."));
    }
  };

  const downloadBulkFallbackLinks = () => {
    if (!bulkInvitationResult) return;
    const fallbackLinks = bulkInvitationResult.created.filter((item) => item.deliveryStatus !== "sent");
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [
      [t("Email"), t("Activation link"), t("Email delivery")].map(quote).join(","),
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
      setEditFailure(t("Select a direct role or assign an active team role first."));
      return;
    }
    if (editingMember.userId === initialData.currentUserId && editStatus === "suspended") {
      setEditFailure(t("You cannot suspend your own active session here."));
      return;
    }
    if (sameRoles(editingMember.roles, editRoles) && editStatus === editingMember.status) {
      setEditFailure(t("No access changes to review."));
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
      if (!response.ok) throw new Error(await responseMessage(response, t("The member could not be updated.")));
      const updated = await response.json() as WorkspaceMember;
      setMembers((current) => current.map((member) => member.id === updated.id ? updated : member));
      setMemberReviewOpen(false);
      setEditingMember(null);
      setStatus(t("{name}'s access was updated.", { name: updated.displayName }));
    } catch (error) {
      setEditFailure(error instanceof Error ? error.message : t("The member could not be updated."));
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
      if (!response.ok) throw new Error(await responseMessage(response, t("The invitation could not be renewed.")));
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
        ? t("Invitation re-emailed to {email}.", { email: payload.email })
        : t("Invitation renewed for {email}.", { email: payload.email }));
    } catch (error) {
      setActionFailure(error instanceof Error ? error.message : t("The invitation could not be renewed."));
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
      if (!response.ok) throw new Error(await responseMessage(response, t("The invitation could not be cancelled.")));
      setInvitations((current) => current.map((item) => item.id === cancellingInvitation.id
        ? { ...item, status: "cancelled", cancelledAt: new Date().toISOString() }
        : item));
      setStatus(t("Invitation for {email} was cancelled.", { email: cancellingInvitation.email }));
      setCancellingInvitation(null);
    } catch (error) {
      setActionFailure(error instanceof Error ? error.message : t("The invitation could not be cancelled."));
      setCancellingInvitation(null);
    } finally {
      setIsCancelling(false);
    }
  };

  /** Invitations and members share one table and one set of columns. */
  const columns: GroupedTableColumn<DirectoryRow>[] = [
    {
      id: "person",
      label: t("Person"),
      mobileWidth: "14rem",
      render: (item) => {
        const name = item.kind === "member"
          ? item.member.displayName
          : item.invitation.displayName || inviteeFallback(item.invitation.email);
        const email = item.kind === "member" ? item.member.email : item.invitation.email;
        const isCurrentUser = item.kind === "member" && item.member.userId === initialData.currentUserId;
        return <span className={styles.identity}>{item.kind === "member" ? <Avatar name={name} preset={item.member.avatarPreset ?? "auto"} roles={[...item.member.roles, ...(item.member.inheritedRoles ?? [])]} seed={item.member.userId} src={item.member.photoUrl} /> : <Avatar name={name} />}<span className={styles.identityDetails}><strong>{isCurrentUser ? t("{name} (You)", { name }) : name}</strong><small><a aria-label={email} className={styles.emailLink} href={`mailto:${email}`}>{email.includes("@") ? <>{email.slice(0, email.indexOf("@") + 1)}<wbr />{email.slice(email.indexOf("@") + 1)}</> : email}</a></small></span></span>;
      },
    },
    {
      id: "date",
      label: t("Added"),
      mobileHidden: true,
      width: "8rem",
      render: (item) => dateLabel(item.kind === "member" ? item.member.joinedAt : item.invitation.createdAt, t, { locale, timeZone }),
    },
    {
      id: "role",
      label: t("Role"),
      mobileWidth: "9rem",
      width: "13rem",
      render: (item) => {
        const roleCodes = item.kind === "member" ? item.member.roles : item.invitation.roles;
        const inherited = item.kind === "member" ? item.member.inheritedRoles ?? [] : [];
        // The primary role first as a chip, then one more; the rest fold into "+N" with the names as a tooltip.
        const names = [...roleCodes, ...inherited].map((role) => readableRole(role, initialData.roles)).filter((role, index, all) => all.indexOf(role) === index);
        if (!names.length) return <span className={styles.roleText}>{t("Via team")}</span>;
        const rest = names.slice(2);
        return <span className={styles.roleChips}>{names.slice(0, 2).map((role) => <Badge key={role} tone="neutral">{role}</Badge>)}{rest.length ? <Badge title={rest.join(", ")} tone="neutral">{`+${rest.length}`}</Badge> : null}</span>;
      },
    },
    {
      id: "team",
      label: t("Team"),
      mobileHidden: true,
      width: "8rem",
      render: (item) => (item.kind === "member" ? item.member.teams : item.invitation.teams)?.map((team) => team.name).join(", ") || "—",
    },
    {
      id: "status",
      label: t("Status"),
      mobileWidth: "6rem",
      width: "6.5rem",
      render: (item) => {
        const value = item.kind === "member" ? item.member.status : item.invitation.status;
        const label = ({ pending: t("Pending"), active: t("Active"), suspended: t("Suspended"), expired: t("Expired"), accepted: t("Accepted"), cancelled: t("Cancelled") } as Record<string, string>)[value] ?? value[0].toUpperCase() + value.slice(1);
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
        if (item.kind === "member") {
          const memberActions = [
            ...(canEdit && canChangeAssignment([...item.member.roles, ...(item.member.inheritedRoles ?? [])], item.member.teams ?? []) ? [{ id: "edit", label: t("Edit access") }] : []),
            ...(canViewAsMember(item.member) ? [{ id: "view-as", label: t("View as") }] : []),
            // Someone leaving: their open work goes to a successor, then they're signed out and suspended (SP-4).
            ...(canEdit && item.member.status === "active" && item.member.userId !== initialData.currentUserId ? [{ id: "offboard", label: t("Offboard"), tone: "danger" as const }] : []),
          ];
          if (!memberActions.length) return null;
          return <IconMenuButton ariaLabel={t("Actions for {name}", { name: item.member.displayName })} items={memberActions}
            onAction={(action) => action === "view-as" ? setViewAsTarget({ kind: "person", membershipId: item.member.id, name: item.member.displayName })
              : action === "offboard" ? setOffboarding(item.member) : openMemberEditor(item.member)} />;
        }
        if (!canChangeAssignment(item.invitation.roles, item.invitation.teams ?? [])) return null;
        const actions = [
          ...(canInvite ? [{ id: "resend", label: item.invitation.status === "expired" ? t("Renew invitation") : t("Create a new link"), isDisabled: isResending }] : []),
          ...(canCancelInvitations ? [{ id: "cancel", label: t("Cancel invitation"), tone: "danger" as const }] : []),
        ];
        return actions.length ? <IconMenuButton ariaLabel={t("Actions for invitation to {email}", { email: item.invitation.email })} items={actions} onAction={(action) => action === "resend" ? void resendInvitation(item.invitation) : setCancellingInvitation(item.invitation)} /> : null;
      },
    },
  ];

  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  // One table: pending invitations first, then guests and members; a group row appears only when there is more than one group.
  const directorySections: GroupedTableSection<DirectoryRow>[] = [
    { id: "invited", label: t("Invited"), emptyMessage: "", rows: invitedRows },
    { id: "guests", label: t("Guest"), emptyMessage: t("No guests have access."), rows: guestRows },
    { id: "members", label: t("Member"), emptyMessage: t("No members have joined yet."), rows: memberRows },
  ].filter((section) => section.rows.length || section.id === "members");
  const bulkFallbackCount = bulkInvitationResult?.created
    .filter((item) => item.deliveryStatus !== "sent").length ?? 0;
  const hasInvitationOutcome = Boolean(invitationResult || bulkInvitationResult);

  if (initialData.canView === false) {
    return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
      <SettingsPage aria-label={t("People")} title={t("People")} width="wide">
        <Callout title={t("People access unavailable")} tone="warning">{t("Your role does not include permission to view or manage people. Ask a workspace administrator for access.")}</Callout>
      </SettingsPage>
    </DesignSystemProvider>;
  }

  return (
    <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
      <SettingsPage aria-label={t("People")} title={t("People")} width="wide">

        {canInvite && (assignableRoles.length > 0 || assignableTeams.length > 0) ? <section aria-label={t("Invite people")} className={styles.inviteComposer}>
          <Form className={styles.quickInviteForm} fieldMarkers="none" onSubmit={createQuickInvitation}>
            <TextInput autoComplete="off" label={t("Work emails")} onChange={setQuickEmail} placeholder={t("name@company.com")} value={quickEmail} />
            <SelectField
              items={[
                ...assignableTeams.map((team) => ({ id: `team:${team.id}`, label: t("{name} team", { name: team.name }) })),
                ...assignableRoles.map((role) => ({ id: `role:${role.code}`, label: t("{name} role", { name: role.name }) })),
              ]}
              label={t("Access")}
              onSelectionChange={(key) => key && setQuickAccess(String(key))}
              selectedKey={quickAccess}
            />
            <Button variant="primary" isDisabled={seatsFull} isLoading={isQuickInviting} type="submit">{quickInviteEmails.length ? t("Invite ({count})", { count: quickInviteEmails.length }) : t("Invite")}</Button>
          </Form>
          <div className={styles.inviteComposerFooter}>
            <div className={styles.inviteComposerActions}>
              <Button isDisabled={seatsFull} onPress={openInvite} size="compact" variant="quiet">{t("Invite with details")}</Button>
              {seatsFull ? null : <FileUploader accept=".csv,text/csv" appearance="button" label={t("Upload CSV")} multiple={false} onFiles={(files) => void loadInvitationCsv(files)} />}
            </div>
            {seats?.limit ? <span className={styles.seatMeter} data-full={seatsFull || undefined}>
              {seats.reserved ? t("{used} of {limit} seats · {reserved} reserved by invitations", { used: seats.used, limit: seats.limit, reserved: seats.reserved })
                : t("{used} of {limit} seats", { used: seats.used, limit: seats.limit })}
            </span> : <span>{t("Activation links expire automatically after 7 days.")}</span>}
          </div>
          {seatsFull ? <Callout title={t("Every seat is taken")} tone="warning">
            {t("Invitations wait for a free seat.")} <Link href="/workspace/billing">{t("Add seats in Billing")}</Link>
          </Callout> : null}
          {quickFailure ? <p className={styles.composerError} role="alert">{quickFailure}</p> : null}
        </section> : null}

        {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
        {actionFailure ? <Callout title={t("Member action failed")} tone="danger">{actionFailure}</Callout> : null}

        {selectedRows.length ? <div className={styles.selectionBar}>
          <span>{t("{count} selected", { count: selectedRows.length })}</span>
          <Button onPress={() => exportRows(selectedRows)} size="compact"><Download aria-hidden="true" size={14} />{t("Export selected")}</Button>
        </div> : null}

        <section aria-label={t("Members")} className={styles.tableSection}>
          <div className={styles.tableRegion}>
            <GroupedTable
              ariaLabel={t("Workspace members")}
              columns={columns}
              getRowId={(row) => row.id}
              getRowLabel={(row) => row.kind === "member" ? row.member.displayName : row.invitation.email}
              groupRows={directorySections.length > 1}
              onSelectionChange={setSelectedIds}
              sections={directorySections}
              selectedIds={selectedIds}
            />
          </div>
        </section>
        {!canInvite && !canEdit && !canCancelInvitations ? <p className={styles.permissionNote}>{t("Your access is read-only. Ask a workspace administrator to change people or invitations.")}</p> : null}
        {viewAs?.canViewAs && viewAsSettings ? <SettingsSection id="view-as" title={t("View as")}>
          <SettingsRow label={t("Tell people after someone viewed as them")}>
            <Switch aria-label={t("Tell people after someone viewed as them")} isDisabled={isSavingViewAsSetting} isSelected={viewAsSettings.notifySubject} onChange={(value) => void saveViewAsNotice(value)} />
          </SettingsRow>
        </SettingsSection> : null}
      </SettingsPage>

      <ViewAsDialog mfaEnabled={Boolean(viewAs?.mfaEnabled)} onClose={() => setViewAsTarget(null)} target={viewAsTarget} workspaceId={initialData.workspaceId} />

      <FormDialog
        description={invitationResult
          ? invitationResult.deliveryStatus === "sent"
            ? t("The invitation was emailed. The secure copy link is shown only now.")
            : t("Email was not delivered. Share this secure link with the invited member; it is shown only now.")
          : bulkInvitationResult
            ? t("Bulk invitation processing is complete.")
            : t("The member will receive access after activating the invitation.")}
        hideSubmit={hasInvitationOutcome}
        cancelLabel={hasInvitationOutcome ? t("Done") : undefined}
        isSubmitting={isInviting}
        isDirty={!hasInvitationOutcome && Boolean(inviteName.trim() || inviteEmail.trim())}
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSubmit={createInvitation}
        submitLabel={t("Create invitation")}
        title={invitationResult ? t("Invitation ready") : bulkInvitationResult ? t("Bulk invitations ready") : t("Invite a member")}
      >
        {invitationResult ? <div className={styles.invitationReady}>
          <Callout title={invitationResult.deliveryStatus === "sent" ? t("Invitation emailed to {email}", { email: invitationResult.email }) : t("Invitation created for {email}", { email: invitationResult.email })} tone="success">{t("The link expires {date}.", { date: dateLabel(invitationResult.expiresAt, t, { locale, timeZone }) })}</Callout>
          <div className={styles.linkField}><TextInput isReadOnly label={t("Activation link")} onFocus={(event) => event.currentTarget.select()} value={invitationResult.link} /><Button onPress={copyInvitation} size="compact"><Copy aria-hidden="true" size={14} />{t("Copy")}</Button></div>
          <p aria-live="polite">{copyStatus}</p>
        </div> : bulkInvitationResult ? <div className={styles.invitationReady}>
          <Callout title={bulkInvitationResult.created.length === 1 ? t("1 invitation created") : t("{count} invitations created", { count: bulkInvitationResult.created.length })} tone="success">
            {bulkInvitationResult.created.length - bulkFallbackCount === 1 ? t("1 email was accepted for delivery.") : t("{count} emails were accepted for delivery.", { count: bulkInvitationResult.created.length - bulkFallbackCount })}</Callout>
          {bulkFallbackCount ? <Callout title={bulkFallbackCount === 1 ? t("1 fallback link needs sharing") : t("{count} fallback links need sharing", { count: bulkFallbackCount })} tone="warning">
            {t("Email was not delivered for these invitations. Download their one-time activation links before closing.")}</Callout> : null}
          {bulkFallbackCount ? <Button onPress={downloadBulkFallbackLinks}><Download aria-hidden="true" size={14} />{t("Download fallback links")}</Button> : null}
          {bulkInvitationResult.failedEmails.length ? <Callout title={bulkInvitationResult.failedEmails.length === 1 ? t("1 invitation failed") : t("{count} invitations failed", { count: bulkInvitationResult.failedEmails.length })} tone="danger">
            {bulkInvitationResult.failedEmails.length > 5 ? t("{emails} and {count} more", { emails: bulkInvitationResult.failedEmails.slice(0, 5).join(", "), count: bulkInvitationResult.failedEmails.length - 5 }) : bulkInvitationResult.failedEmails.join(", ")}
          </Callout> : null}
        </div> : <>
          <ValidationSummary errors={inviteErrors} />
          {inviteFailure ? <Callout title={t("Could not create invitation")} tone="danger">{inviteFailure}</Callout> : null}
          <TextInput isRequired label={t("Full name")} onChange={setInviteName} placeholder={t("e.g. Maya Thomas")} value={inviteName} />
          <TextInput inputType="email" isRequired label={t("Work email")} onChange={setInviteEmail} placeholder={t("maya@company.com")} value={inviteEmail} />
          <MultiSelectField items={assignableTeams.map((team) => ({ id: team.id, label: team.name }))} label={t("Teams")} onSelectionChange={(keys) => setInviteTeamIds(new Set(Array.from(keys, String)))} selectedKeys={inviteTeamIds} />
          <RoleChoices onChange={setInviteRoles} roles={assignableRoles} selected={inviteRoles} />
        </>}
      </FormDialog>

      <FormDialog
        description={editingMember ? t("Update workspace access for {email}.", { email: editingMember.email }) : undefined}
        isSubmitting={isSavingMember}
        isOpen={Boolean(editingMember)}
        onClose={() => { setMemberReviewOpen(false); setEditingMember(null); }}
        onSubmit={reviewMember}
        submitLabel={t("Review changes")}
        title={t("Edit member access")}
      >
        {editingMember ? <>
          {editFailure ? <Callout title={t("Could not save member")} tone="danger">{editFailure}</Callout> : null}
          <div className={styles.memberPreview}><Avatar name={editingMember.displayName} preset={editingMember.avatarPreset ?? "auto"} roles={[...editingMember.roles, ...(editingMember.inheritedRoles ?? [])]} seed={editingMember.userId} size="lg" src={editingMember.photoUrl} /><span><strong>{editingMember.displayName}</strong><small>{editingMember.email}</small></span></div>
          <RoleChoices onChange={setEditRoles} roles={assignableRoles} selected={editRoles} />
          <SelectField
            accent="neutral"
            description={editingMember.userId === initialData.currentUserId ? t("You cannot suspend your own active session here.") : t("Suspended members cannot sign in to this workspace.")}
            isDisabled={editingMember.userId === initialData.currentUserId}
            items={[{ id: "active", label: t("Active") }, { id: "suspended", label: t("Suspended") }]}
            label={t("Member status")}
            onSelectionChange={(key) => key && setEditStatus(String(key) as "active" | "suspended")}
            selectedKey={editStatus}
          />
        </> : null}
      </FormDialog>

      <ConfirmationDialog
        body={editingMember ? <div className={styles.accessReview}>
          <p>{t("Confirm the effective access change for {name}.", { name: editingMember.displayName })}</p>
          <dl>
            {editStatus !== editingMember.status ? <div><dt>{t("Status")}</dt><dd><span>{editingMember.status === "active" ? t("Active") : t("Suspended")}</span><span aria-hidden="true">→</span><strong>{editStatus === "active" ? t("Active") : t("Suspended")}</strong></dd></div> : null}
            {!sameRoles(editingMember.roles, editRoles) ? <div><dt>{t("Direct roles")}</dt><dd><span>{editingMember.roles.map((role) => readableRole(role, initialData.roles)).join(", ") || t("None")}</span><span aria-hidden="true">→</span><strong>{Array.from(editRoles).map((role) => readableRole(role, initialData.roles)).join(", ") || t("None")}</strong></dd></div> : null}
            <div><dt>{t("Team access")}</dt><dd><strong>{editingMember.teams?.map((team) => team.name).join(", ") || t("No assigned teams")}</strong></dd></div>
          </dl>
          {editStatus === "suspended" && editingMember.status !== "suspended" ? <Callout title={t("This releases a licensed seat")} tone="warning">{t("The member will lose workspace access immediately. Their records remain available, and reactivation will require a free seat.")}</Callout> : null}
          {editingMember.inheritedRoles?.length ? <p className={styles.reviewNote}>{t("Team-inherited roles remain managed from Teams.")} <Link href="/workspace/teams">{t("Open Teams")}</Link></p> : null}
        </div> : null}
        confirmLabel={t("Apply access changes")}
        confirmVariant="primary"
        isConfirming={isSavingMember}
        isOpen={memberReviewOpen}
        onConfirm={() => void saveMember()}
        onOpenChange={(open) => { if (!isSavingMember) setMemberReviewOpen(open); }}
        title={t("Apply member access changes?")}
      />

      <ControlledModalDialog
        footer={<div className="wd-dialog-actions"><Button isDisabled={isCancelling} onPress={() => setCancellingInvitation(null)}>{t("Keep invitation")}</Button><Button isLoading={isCancelling} onPress={cancelInvitation} variant="danger">{t("Cancel invitation")}</Button></div>}
        isDismissable={!isCancelling}
        isOpen={Boolean(cancellingInvitation)}
        onOpenChange={(open) => { if (!open && !isCancelling) setCancellingInvitation(null); }}
        title={t("Cancel invitation?")}
      >
        {cancellingInvitation ? t("The activation link for {email} will stop working immediately.", { email: cancellingInvitation.email }) : null}
      </ControlledModalDialog>
      {offboarding ? <OffboardDialog workspaceId={initialData.workspaceId} membershipId={offboarding.id} name={offboarding.displayName} onClose={() => setOffboarding(null)}
        onDone={(message) => { setMembers((current) => current.map((member) => member.id === offboarding.id ? { ...member, status: "suspended" } : member)); setOffboarding(null); setStatus(message); }} /> : null}
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
  const t = useT();
  return <fieldset className={styles.roleChoices}><legend>{t("Direct roles")}</legend><div>{roles.map((role) => <Checkbox isSelected={selected.has(role.code)} key={role.id} onChange={(checked) => { const next = new Set(selected); if (checked) next.add(role.code); else next.delete(role.code); onChange(next); }}><span><strong>{role.name}</strong><small>{role.description}</small></span></Checkbox>)}</div></fieldset>;
}
