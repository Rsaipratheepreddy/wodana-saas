"use client";

import {
  Check,
  Copy,
  LogOut,
  Moon,
  Plus,
  Sun,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, Avatar, Badge, Button, Callout, ConfirmationDialog, Container, DataGrid, DesignSystemProvider, Form, Heading, IconButton, InspectorSheet, SelectField, Skeleton, Surface, TextInput, type DataGridColumn } from "@/design-system";
import { identityInitials, identityStyle } from "@/lib/brand/identity";
import type { OperatorPermission } from "@/lib/internal/auth";
import type { ManagedDomain, ManagedTenant, ManagedTenantAccess, ManagedTenantStatus } from "@/lib/internal/types";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import styles from "./portal.module.css";

type PortalUser = {
  email: string;
  name: string;
  role?: string;
  permissions?: OperatorPermission[];
};

const compatibilityPermissions: OperatorPermission[] = [
  "tenants.read", "tenants.provision", "invitations.send", "billing.manage",
  "lifecycle.manage",
  "domains.manage", "entitlements.manage", "support.request", "support.approve",
  "data.manage", "operators.manage",
];

const planLabel: Record<string, string> = { starter: "Starter", pro: "Pro", enterprise: "Enterprise" };
export const tenantColumns: DataGridColumn<ManagedTenant>[] = [
  { accessorKey: "workspace.name", header: "Organization", size: 280, meta: { primary: true }, cell: ({ row }) => <span className={styles.tenantIdentity}><Avatar name={row.original.workspace.name} size="sm" /><span><strong>{row.original.workspace.name}</strong><small>{row.original.owner?.email ?? row.original.workspace.slug}</small></span></span> },
  { id: "account", accessorFn: (tenant) => tenant.account?.displayName ?? "", header: "Account", size: 200, cell: ({ row }) => row.original.account?.displayName ?? "Not linked" },
  { id: "plan", accessorFn: (tenant) => tenant.subscription.planCode, header: "Plan", size: 120, cell: ({ row }) => planLabel[row.original.subscription.planCode] ?? row.original.subscription.planCode },
  { id: "seats", accessorFn: (tenant) => tenant.usage.reservedSeats, header: "Seats", size: 130, meta: { align: "end" }, cell: ({ row }) => <span>{row.original.usage.reservedSeats} / {row.original.subscription.seatLimit}</span> },
  { id: "setup", accessorFn: (tenant) => tenant.onboarding.status, header: "Setup", size: 145, cell: ({ row }) => <Badge tone={row.original.onboarding.status === "completed" ? "success" : "warning"}>{row.original.onboarding.status === "completed" ? "Complete" : "In progress"}</Badge> },
  { id: "status", accessorFn: (tenant) => tenant.workspace.status, header: "Access", size: 110, cell: ({ row }) => <Badge tone={row.original.workspace.status === "active" ? "success" : "warning"}>{row.original.workspace.status}</Badge> },
];

const accessColumns: DataGridColumn<ManagedTenantAccess["members"][number]>[] = [
  {
    id: "member",
    accessorFn: (member) => `${member.displayName} ${member.email}`,
    header: "Member",
    size: 210,
    meta: { primary: true },
    cell: ({ row }) => <span className={styles.accessIdentity}><Avatar name={row.original.displayName} size="sm"/><span><strong>{row.original.displayName}</strong><small>{row.original.email}</small></span></span>,
  },
  {
    id: "source",
    accessorFn: (member) => [
      ...member.access.directRoles.map((role) => role.name),
      ...member.access.inheritedRoles.map((role) => `${role.teamName} ${role.roleName}`),
    ].join(" "),
    header: "Why access",
    size: 240,
    cell: ({ row }) => <span className={styles.accessSource}>
      {row.original.access.directRoles.length ? <span>Direct · {row.original.access.directRoles.map((role) => role.name).join(", ")}</span> : null}
      {row.original.access.inheritedRoles.length ? <span>Team · {row.original.access.inheritedRoles.map((role) => `${role.teamName} → ${role.roleName}`).join(", ")}</span> : null}
      {!row.original.access.directRoles.length && !row.original.access.inheritedRoles.length ? <span>No role source</span> : null}
    </span>,
  },
  {
    id: "modules",
    accessorFn: (member) => member.access.effectiveModules.join(" "),
    header: "Effective modules",
    size: 170,
    cell: ({ row }) => row.original.access.effectiveModules.length ? row.original.access.effectiveModules.join(" · ") : "None",
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 100,
    cell: ({ row }) => <Badge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status}</Badge>,
  },
];

function nextAction(status: ManagedTenantStatus) {
  if (status.onboarding.status === "completed") return "Next: review team access before inviting staff.";
  if (status.ownerInvitation?.status === "accepted") return "Next: complete owner onboarding.";
  return "Next: create and share an owner activation link.";
}

async function payload(response: Response) {
  const data = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(data?.message ?? "The request could not be completed.");
  return data;
}

export function InternalPortal({ initialTenants, user }: { initialTenants: ManagedTenant[]; user: PortalUser }) {
  const router = useRouter();
  const [tenants, setTenants] = useState(initialTenants);
  const [selectedId, setSelectedId] = useState("");
  const [tenantStatus, setTenantStatus] = useState<ManagedTenantStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [statusRevision, setStatusRevision] = useState(0);
  const [tenantAccess, setTenantAccess] = useState<ManagedTenantAccess | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [accessRevision, setAccessRevision] = useState(0);
  const [domains, setDomains] = useState<ManagedDomain[]>([]);
  const [domainLoading, setDomainLoading] = useState(false);
  const [domainError, setDomainError] = useState("");
  const [domainNotice, setDomainNotice] = useState("");
  const [domainBusy, setDomainBusy] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [domainRequestKey, setDomainRequestKey] = useState("");
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [showDomainForm, setShowDomainForm] = useState(false);
  const [removeDomainTarget, setRemoveDomainTarget] = useState<ManagedDomain | null>(null);
  const [domainRevision, setDomainRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activationLink, setActivationLink] = useState("");
  const { theme, toggleTheme } = useWorkspaceTheme();
  const selected = tenants.find((tenant) => tenant.externalTenantId === selectedId) ?? null;
  const selectedDomain = domains.find((domain) => domain.id === selectedDomainId) ?? domains[0] ?? null;
  const activeCount = tenants.filter((tenant) => tenant.workspace.status === "active").length;
  const setupCount = tenants.filter((tenant) => tenant.onboarding.status !== "completed").length;
  const operatorPermissions = user.permissions ?? compatibilityPermissions;
  const can = (permission: OperatorPermission) => operatorPermissions.includes(permission);

  useEffect(() => {
    if (!selectedId) return;
    const abort = new AbortController();
    void fetch(`/api/internal/tenants/${encodeURIComponent(selectedId)}/status`, { signal: abort.signal })
      .then(async (response) => await payload(response) as ManagedTenantStatus)
      .then((status) => setTenantStatus(status))
      .catch((reason) => { if (!abort.signal.aborted) setStatusError(reason instanceof Error ? reason.message : "Status could not be loaded."); })
      .finally(() => { if (!abort.signal.aborted) setStatusLoading(false); });
    return () => abort.abort();
  }, [selectedId, statusRevision]);

  useEffect(() => {
    if (!selectedId) return;
    const abort = new AbortController();
    void fetch(`/api/internal/tenants/${encodeURIComponent(selectedId)}/access`, { signal: abort.signal })
      .then(async (response) => await payload(response) as ManagedTenantAccess)
      .then((access) => {
        if (!Array.isArray(access.members) || !Array.isArray(access.invitations)) {
          throw new Error("Access details were invalid.");
        }
        setTenantAccess(access);
      })
      .catch((reason) => { if (!abort.signal.aborted) setAccessError(reason instanceof Error ? reason.message : "Access details could not be loaded."); })
      .finally(() => { if (!abort.signal.aborted) setAccessLoading(false); });
    return () => abort.abort();
  }, [selectedId, accessRevision]);

  useEffect(() => {
    if (!selectedId) return;
    const abort = new AbortController();
    void fetch(`/api/internal/tenants/${encodeURIComponent(selectedId)}/domains`, { signal: abort.signal })
      .then(async (response) => await payload(response) as { domains: ManagedDomain[] })
      .then((result) => { if (!Array.isArray(result.domains)) throw new Error("Domain status was invalid."); setDomains(result.domains); })
      .catch((reason) => { if (!abort.signal.aborted) setDomainError(reason instanceof Error ? reason.message : "Domains could not be loaded."); })
      .finally(() => { if (!abort.signal.aborted) setDomainLoading(false); });
    return () => abort.abort();
  }, [selectedId, domainRevision]);

  function select(tenant: ManagedTenant) {
    setSelectedId(tenant.externalTenantId);
    setTenantStatus(null);
    setStatusError("");
    setStatusLoading(true);
    setTenantAccess(null);
    setAccessError("");
    setAccessLoading(true);
    setDomains([]);
    setDomainLoading(true);
    setDomainError("");
    setDomainNotice("");
    setDomainInput("");
    setDomainRequestKey("");
    setSelectedDomainId("");
    setShowDomainForm(false);
    setRemoveDomainTarget(null);
    setError("");
    setNotice("");
  }

  function retryStatus() {
    setTenantStatus(null);
    setStatusError("");
    setStatusLoading(true);
    setStatusRevision((revision) => revision + 1);
  }

  function retryAccess() {
    setTenantAccess(null);
    setAccessError("");
    setAccessLoading(true);
    setAccessRevision((revision) => revision + 1);
  }

  function closeDetails() {
    setSelectedId("");
    setTenantStatus(null);
    setStatusLoading(false);
    setTenantAccess(null);
    setAccessLoading(false);
    setAccessError("");
    setDomains([]);
    setDomainLoading(false);
    setDomainError("");
    setDomainNotice("");
    setSelectedDomainId("");
    setShowDomainForm(false);
    setRemoveDomainTarget(null);
    setError("");
  }

  async function refreshInvitation() {
    if (!selected) return;
    setBusy(true); setError(""); setActivationLink("");
    try {
      const response = await fetch(`/api/internal/tenants/${encodeURIComponent(selected.externalTenantId)}/owner-invitation`, { method: "POST" });
      const invitation = await payload(response) as { invitationToken: string | null };
      if (invitation.invitationToken) {
        setActivationLink(`${location.origin}/login?tenant=${encodeURIComponent(selected.workspace.slug)}&invitation=${encodeURIComponent(invitation.invitationToken)}`);
        setNotice("A fresh owner activation link is ready.");
      }
      retryStatus();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function refreshDomains() {
    setDomainLoading(true);
    setDomainError("");
    setDomainRevision((revision) => revision + 1);
  }

  async function requestDomain() {
    if (!selected) return;
    const hostname = domainInput.trim();
    if (!hostname) { setDomainError("Enter the custom domain first."); return; }
    const key = domainRequestKey || crypto.randomUUID();
    setDomainRequestKey(key);
    setDomainBusy(true); setDomainError(""); setDomainNotice("");
    try {
      const response = await fetch(`/api/internal/tenants/${encodeURIComponent(selected.externalTenantId)}/domains`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ hostname }),
      });
      const created = await payload(response) as { id: string };
      setSelectedDomainId(created.id);
      setDomainNotice("Domain reserved. Add the TXT record, then verify ownership.");
      setDomainInput(""); setDomainRequestKey("");
      setShowDomainForm(false);
      refreshDomains(); retryStatus();
    } catch (reason) { setDomainError((reason as Error).message); }
    finally { setDomainBusy(false); }
  }

  async function updateDomain(domain: ManagedDomain, action: "verify" | "recheck" | "rotate-challenge" | "remove") {
    if (!selected) return;
    setDomainBusy(true); setDomainError(""); setDomainNotice("");
    try {
      const response = await fetch(`/api/internal/tenants/${encodeURIComponent(selected.externalTenantId)}/domains/${domain.id}/${action}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: domain.version }),
      });
      await payload(response);
      setDomainNotice(action === "verify" ? "DNS ownership verified. TLS setup is still required."
        : action === "recheck" ? "DNS ownership check finished. Review the current domain state."
        : action === "remove" ? "Domain request removed; the Wodana address remains available."
          : "New TXT challenge created. The previous value no longer works.");
      refreshDomains(); retryStatus();
    } catch (reason) { setDomainError((reason as Error).message); }
    finally { setDomainBusy(false); }
  }

  return <DesignSystemProvider theme={theme === "dark" ? "dark" : "light"} locale="en-AE" currency="AED" timeZone="Asia/Dubai">
    <AppShell
      title="Wodana Control"
      topActions={<div className={styles.topActions}><div className={styles.user}><span style={identityStyle(user.email)}>{identityInitials(user.name)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div><IconButton aria-label={theme === "light" ? "Use dark mode" : "Use light mode"} onPress={toggleTheme}>{theme === "light" ? <Moon size={16}/> : <Sun size={16}/>}</IconButton><IconButton aria-label="Sign out" onPress={() => { void fetch("/api/internal/auth/logout", { method: "POST" }).then((response) => { if (!response.ok) throw new Error("Sign out failed."); router.replace("/internal/sign-in"); }).catch(() => setError("Sign out failed. Try again.")); }}><LogOut size={16}/></IconButton></div>}
    >
      <Container as="main" className={styles.content} id="tenants" size="full">
        <div className={styles.pageHeader}><div><Heading as="h1" size="lg">Tenants</Heading><p>Customer accounts and their organizations.</p></div>
          {can("tenants.provision") ? <Button variant="primary" onPress={() => router.push("/internal/new")}><Plus size={16}/>Add customer</Button> : null}
        </div>
        <Surface className={styles.metrics} aria-label="Tenant summary">
          <div><strong>{tenants.length}</strong><span>Total tenants</span></div>
          <div><strong>{activeCount}</strong><span>Active workspaces</span></div>
          <div><strong>{setupCount}</strong><span>Setup in progress</span></div>
        </Surface>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status"><Check size={15}/>{notice}</p> : null}
        {activationLink ? <div className={styles.activation}><div><strong>Owner activation link</strong><small>This one-time link contains a secret. Share it only with the tenant owner.</small></div><Button size="compact" onPress={() => void navigator.clipboard.writeText(activationLink)}><Copy size={15}/>Copy link</Button></div> : null}
        <DataGrid
          ariaLabel="Customer organizations"
          columns={tenantColumns}
          data={tenants}
          emptyTitle="No organizations yet"
          emptyDescription="Add the first customer account to provision its organization."
          getRowId={(tenant) => tenant.externalTenantId}
          onRowAction={select}
          pageSize={25}
          persistKey="internal-organizations"
          rowNumbers={false}
          searchLabel="Search tenants"
          selectable={false}
        />
        {selected ? <InspectorSheet isOpen title={selected.workspace.name} size="md" onOpenChange={(open) => { if (!open) closeDetails(); }}><div className={styles.detailContent}>
            <div className={styles.detailToolbar}><span>{selected.workspace.slug}</span><Button size="compact" onPress={() => router.push(`/internal/tenants/${encodeURIComponent(selected.externalTenantId)}/operations`)}>Tenant operations</Button></div>
            <div className={styles.owner}><span><Users size={16}/></span><div><small>Tenant owner</small><strong>{selected.owner?.name ?? "Owner invitation pending"}</strong><p>{selected.owner?.email ?? "No owner email"}</p></div></div>
            {selected.account ? <section className={styles.detailSection}><div className={styles.sectionHeading}><h3>Customer account</h3><span>{selected.account.status}</span></div>
              <div className={styles.accountFacts}><div><small>Account</small><strong>{selected.account.displayName}</strong></div><div><small>Organizations</small><strong>{selected.account.organizationCount} of {selected.account.organizationLimit}</strong></div><div><small>This workspace</small><strong>{selected.account.isDefaultOrganization ? "Default organization" : "Additional organization"}</strong></div></div>
            </section> : null}
            <section className={styles.detailSection} aria-label="Current organization status">
              <div className={styles.sectionHeading}><h3>Current status</h3><span>Live read</span></div>
              {statusLoading ? <div role="status" aria-label="Loading organization status"><Skeleton lines={4} /></div> : statusError ? <Callout title="Status unavailable" tone="warning" actions={<Button size="compact" onPress={retryStatus}>Retry</Button>}>{statusError}</Callout> : tenantStatus && tenantStatus.organization.id === selected.workspace.id ? <>
                <div className={styles.statusFacts}>
                  <div><small>Seats reserved</small><strong>{tenantStatus.seats.reserved} / {tenantStatus.seats.limit ?? "Unknown"}</strong><span>{tenantStatus.seats.activeMembers} active · {tenantStatus.seats.invitedMembers ?? 0} invited · {tenantStatus.seats.pendingInvitations} pending · {tenantStatus.seats.available ?? "Unknown"} available</span></div>
                  <div><small>Owner setup</small><strong>{tenantStatus.onboarding.status === "completed" ? "Complete" : "In progress"}</strong><span>{tenantStatus.ownerInvitation ? `Invitation ${tenantStatus.ownerInvitation.status} · delivery ${tenantStatus.ownerInvitation.deliveryStatus}` : "No invitation recorded"}</span></div>
                  <div><small>Modules</small><strong>{tenantStatus.commercialEntitlements.status.replaceAll("_", " ")}</strong><span>{tenantStatus.commercialEntitlements.modules?.length ? tenantStatus.commercialEntitlements.modules.join(" · ") : "Commercial allocation has not been configured."}</span></div>
                  <div><small>Login address</small><strong>{tenantStatus.domain.platformSlug}.wodana.ai</strong><span>{selectedDomain ? `${selectedDomain.hostname} · ${selectedDomain.routing.status === "active" ? selectedDomain.isUsable ? "active" : "needs attention" : selectedDomain.dns.status === "verified" ? "verified, not live" : "requested"}` : tenantStatus.domain.hostname ? `${tenantStatus.domain.hostname} · ${tenantStatus.domain.customDomainStatus.replaceAll("_", " ")}` : "Custom domain not configured"}</span></div>
                </div>
                <p className={styles.nextAction}>{nextAction(tenantStatus)}</p>
              </> : <Callout title="Status mismatch" tone="danger">Refresh this organization before making changes.</Callout>}
            </section>
            <section className={styles.detailSection} aria-label="Team access and seats">
              <div className={styles.sectionHeading}><h3>Team access &amp; seats</h3><span>Read-only explanation</span></div>
              {accessLoading ? <div role="status" aria-label="Loading team access"><Skeleton lines={4}/></div>
                : accessError ? <Callout title="Access explanation unavailable" tone="warning" actions={<Button size="compact" onPress={retryAccess}>Retry</Button>}>{accessError}</Callout>
                  : tenantAccess && tenantAccess.organization.id === selected.workspace.id ? <>
                    <div className={styles.seatFacts} aria-label="Seat capacity">
                      <div><small>Used</small><strong>{tenantAccess.seats.used}</strong><span>Active + invited</span></div>
                      <div><small>Reserved</small><strong>{tenantAccess.seats.reserved}</strong><span>Includes {tenantAccess.seats.pendingInvitations} pending</span></div>
                      <div><small>Available</small><strong>{tenantAccess.seats.available ?? "Unknown"}</strong><span>Limit {tenantAccess.seats.limit ?? "not configured"}</span></div>
                    </div>
                    <DataGrid
                      appearance="flush"
                      ariaLabel="Tenant member access"
                      columns={accessColumns}
                      data={tenantAccess.members}
                      emptyTitle="No members yet"
                      emptyDescription="Accepted tenant members will appear here with their access source."
                      getRowId={(member) => member.id}
                      pageSize={10}
                      rowNumbers={false}
                      selectable={false}
                      showFooter={false}
                      showToolbar={false}
                    />
                    {tenantAccess.invitations.length ? <p className={styles.invitationSummary}>{tenantAccess.invitations.filter((invitation) => invitation.reservesSeat).length} live invitation reservation{tenantAccess.invitations.filter((invitation) => invitation.reservesSeat).length === 1 ? "" : "s"}. Roles and teams become effective only after acceptance.</p> : null}
                    <Callout title="Tenant-owned access" tone="neutral">Wodana operators can inspect why access exists, but tenant administrators manage team membership, roles and member offboarding.</Callout>
                  </> : <Callout title="Access mismatch" tone="danger">Refresh this organization before reviewing access.</Callout>}
            </section>
            <section className={styles.detailSection} aria-label="Custom domains">
              <div className={styles.sectionHeading}><h3>Custom domain</h3><span>Wodana address remains the fallback</span></div>
              {domainLoading ? <div role="status" aria-label="Loading custom domains"><Skeleton lines={2}/></div> : null}
              {domainError ? <Callout title="Domain action unavailable" tone="warning" actions={<Button size="compact" onPress={refreshDomains}>Retry</Button>}>{domainError}</Callout> : null}
              {domainNotice ? <p className={styles.domainNotice} role="status">{domainNotice}</p> : null}
              {!domainLoading && !domainError && !selectedDomain ? <p className={styles.domainHint}>No custom domain requested.</p> : null}
              {domains.length > 1 ? <SelectField label="Domain" accent="neutral" items={domains.map((domain) => ({ id: domain.id, label: domain.hostname }))} selectedKey={selectedDomain?.id} onSelectionChange={(key) => { if (key) setSelectedDomainId(String(key)); }} /> : null}
              {selectedDomain ? <div className={styles.domainDetails}>
                <div className={styles.domainTitle}><strong>{selectedDomain.hostname}</strong><Badge tone={selectedDomain.isUsable ? "success" : selectedDomain.dns.status === "failed" || selectedDomain.rollback.status === "pending" || selectedDomain.dns.status === "verified" ? "warning" : "neutral"}>{selectedDomain.isUsable ? "Active" : selectedDomain.dns.status === "failed" || selectedDomain.rollback.status === "pending" ? "Needs attention" : selectedDomain.dns.status === "verified" ? "TLS setup required" : "DNS pending"}</Badge></div>
                <div className={styles.domainStates}><span>DNS: {selectedDomain.dns.status}</span><span>Certificate: {selectedDomain.certificate.status.replaceAll("_", " ")}</span><span>Routing: {selectedDomain.routing.status.replaceAll("_", " ")}</span></div>
                {selectedDomain.issues?.length ? <Callout title="Custom sign-in is not ready" tone="warning">{selectedDomain.issues.join(" · ")}. Use the Wodana address in the meantime.</Callout> : null}
                {selectedDomain.dns.status !== "verified" ? <>
                  <p className={styles.domainHint}>{selectedDomain.dns.status === "failed" ? selectedDomain.rollback.status === "pending" || selectedDomain.rollback.status === "failed" ? "Ownership was lost. Routing and certificate rollback must finish before a new DNS code." : "Ownership was lost. Create a new DNS code to verify again." : "Add this TXT record at your DNS provider, then verify."}</p>
                  <div className={styles.dnsRecord}><small>TXT name</small><code>{selectedDomain.dns.record.name}</code><small>TXT value</small><code>{selectedDomain.dns.record.value}</code></div>
                  <div className={styles.domainActions}><Button size="compact" isDisabled={domainBusy} onPress={() => void navigator.clipboard.writeText(`${selectedDomain.dns.record.name}\n${selectedDomain.dns.record.value}`).catch(() => setDomainError("Could not copy the DNS record."))}><Copy size={14}/>Copy record</Button>{can("domains.manage") && selectedDomain.dns.status === "pending" ? <Button size="compact" variant="primary" isLoading={domainBusy} onPress={() => void updateDomain(selectedDomain, "verify")}>Verify DNS</Button> : null}{can("domains.manage") ? <Button size="compact" isDisabled={domainBusy || selectedDomain.rollback.status === "pending" || selectedDomain.rollback.status === "failed" || selectedDomain.certificate.status === "issued" || selectedDomain.certificate.status === "pending"} onPress={() => void updateDomain(selectedDomain, "rotate-challenge")}>New code</Button> : null}</div>
                </> : selectedDomain.routing.status !== "active" ? <p className={styles.domainHint}>Ownership is verified. Certificate and routing are not connected yet; keep using the Wodana address.</p> : null}
                {can("domains.manage") && selectedDomain.dns.status === "verified" ? <div className={styles.domainActions}><Button size="compact" isLoading={domainBusy} onPress={() => void updateDomain(selectedDomain, "recheck")}>Recheck DNS</Button></div> : null}
                {can("domains.manage") && selectedDomain.routing.status !== "active" && selectedDomain.routing.status !== "pending" && selectedDomain.certificate.status !== "pending" && selectedDomain.certificate.status !== "issued" && selectedDomain.rollback.status !== "pending" && selectedDomain.rollback.status !== "failed" ? <div className={styles.domainActions}><Button size="compact" variant="quiet" isDisabled={domainBusy} onPress={() => setRemoveDomainTarget(selectedDomain)}>Remove request</Button></div> : null}
              </div> : null}
              {can("domains.manage") && selectedDomain && !showDomainForm ? <div className={styles.domainActions}><Button size="compact" onPress={() => setShowDomainForm(true)}>Add another domain</Button></div> : null}
              {can("domains.manage") && (!selectedDomain || showDomainForm) ? <Form onSubmit={(event) => { event.preventDefault(); void requestDomain(); }}><div className={styles.domainForm}><TextInput label="Domain" description="For example, portal.yourcompany.com" value={domainInput} onChange={(value) => { setDomainInput(value); setDomainRequestKey(""); }} isRequired/><div className={styles.domainActions}><Button type="submit" size="compact" variant="primary" isLoading={domainBusy}>Request domain</Button>{selectedDomain ? <Button size="compact" onPress={() => setShowDomainForm(false)}>Cancel</Button> : null}</div></div></Form> : null}
            </section>
            <section className={styles.detailSection}><div className={styles.sectionHeading}><h3>Access</h3><span>{selected.onboarding.status === "completed" ? "Onboarding complete" : "Setup in progress"}</span></div>
              <p className={styles.readOnlyValue}>Workspace access · {selected.workspace.status}</p>
              {can("lifecycle.manage") ? <Button size="compact" onPress={() => router.push(`/internal/tenants/${encodeURIComponent(selected.externalTenantId)}/operations`)}>Manage lifecycle</Button> : null}
              {can("invitations.send") && selected.ownerInvitation?.status !== "accepted" ? <Button isDisabled={busy} onPress={() => void refreshInvitation()}>Create owner activation link</Button> : null}
            </section>
            <section className={styles.detailSection}><div className={styles.sectionHeading}><h3>Billing</h3><span>Account-controlled</span></div>
              <Callout title="One billing authority" tone="neutral">Plan, seats, usage and collection state are managed in Billing and usage. This legacy workspace subscription is read-only.</Callout>
              <Button size="compact" onPress={() => router.push(`/internal/tenants/${encodeURIComponent(selected.externalTenantId)}/operations`)}>Open Billing and usage</Button>
            </section>
            <ConfirmationDialog isOpen={Boolean(removeDomainTarget)} onOpenChange={(open) => { if (!open && !domainBusy) setRemoveDomainTarget(null); }} title="Remove domain request?" body={removeDomainTarget ? <>Release <strong>{removeDomainTarget.hostname}</strong>? The Wodana login address stays available, but this DNS code will stop working.</> : null} confirmLabel="Remove request" onConfirm={() => { const target = removeDomainTarget; setRemoveDomainTarget(null); if (target) void updateDomain(target, "remove"); }} />
          </div></InspectorSheet> : null}
      </Container>
    </AppShell>
  </DesignSystemProvider>;
}
