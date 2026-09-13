"use client";

import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Menu,
  Moon,
  Plus,
  Search,
  Sun,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { identityInitials, identityStyle } from "@/lib/brand/identity";
import type { ManagedTenant } from "@/lib/internal/types";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import styles from "./portal.module.css";

type NewClient = { name: string; ownerName: string; ownerEmail: string; slug: string };
type BillingDraft = {
  amount: string;
  billingCycle: string;
  note: string;
  planCode: string;
  projectLimit: string;
  renewsAt: string;
  seatLimit: string;
  subscriptionStatus: string;
  workspaceStatus: string;
};

const blankClient: NewClient = { name: "", ownerName: "", ownerEmail: "", slug: "" };
const planLabel: Record<string, string> = { starter: "Starter", pro: "Pro", enterprise: "Enterprise" };
const statusLabel: Record<string, string> = { trial: "Trial", active: "Active", past_due: "Past due", cancelled: "Cancelled", suspended: "Suspended" };

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function legalCode(value: string) {
  const initials = value.trim().split(/\s+/).map((part) => part[0]).join("").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return (initials.length >= 2 ? initials : `${initials}HQ`).slice(0, 24);
}

function dateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function draftFor(client: ManagedTenant): BillingDraft {
  return {
    amount: String(client.subscription.amount),
    billingCycle: client.subscription.billingCycle,
    note: client.subscription.note ?? "",
    planCode: client.subscription.planCode,
    projectLimit: String(client.subscription.projectLimit),
    renewsAt: dateInput(client.subscription.renewsAt),
    seatLimit: String(client.subscription.seatLimit),
    subscriptionStatus: client.subscription.status,
    workspaceStatus: client.workspace.status,
  };
}

async function payload(response: Response) {
  const data = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(data?.message ?? "The request could not be completed.");
  return data;
}

export function InternalPortal({ initialTenants, user }: { initialTenants: ManagedTenant[]; user: { email: string; name: string } }) {
  const [tenants, setTenants] = useState(initialTenants);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<BillingDraft | null>(null);
  const [newClient, setNewClient] = useState(blankClient);
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activationLink, setActivationLink] = useState("");
  const { theme, toggleTheme } = useWorkspaceTheme();
  const selected = tenants.find((tenant) => tenant.externalTenantId === selectedId) ?? null;
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return search ? tenants.filter((tenant) => [tenant.workspace.name, tenant.workspace.slug, tenant.owner?.email].some((value) => value?.toLowerCase().includes(search))) : tenants;
  }, [query, tenants]);
  const activeCount = tenants.filter((tenant) => tenant.workspace.status === "active").length;
  const connectedCount = tenants.reduce((total, tenant) => total + tenant.integrations.filter((item) => item.status === "connected").reduce((sum, item) => sum + item.count, 0), 0);

  function select(tenant: ManagedTenant) {
    setSelectedId(tenant.externalTenantId);
    setDraft(draftFor(tenant));
    setError("");
    setNotice("");
  }

  function closeDetails() {
    setSelectedId("");
    setDraft(null);
    setError("");
  }

  async function save() {
    if (!selected || !draft) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/internal/tenants/${encodeURIComponent(selected.externalTenantId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: Number(draft.amount),
          billingCycle: draft.billingCycle,
          expectedSubscriptionVersion: selected.subscription.version,
          expectedWorkspaceVersion: selected.workspace.version,
          note: draft.note || null,
          planCode: draft.planCode,
          projectLimit: Number(draft.projectLimit),
          renewsAt: draft.renewsAt ? new Date(`${draft.renewsAt}T12:00:00Z`).toISOString() : null,
          seatLimit: Number(draft.seatLimit),
          subscriptionStatus: draft.subscriptionStatus,
          workspaceStatus: draft.workspaceStatus,
        }),
      });
      const updated = await payload(response) as ManagedTenant;
      setTenants((items) => items.map((item) => item.externalTenantId === updated.externalTenantId ? updated : item));
      setDraft(draftFor(updated));
      setNotice("Tenant saved.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function createClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slug = newClient.slug || slugify(newClient.name);
    setBusy(true); setError(""); setActivationLink("");
    try {
      const response = await fetch("/api/internal/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          defaultCurrency: "INR",
          defaultLocale: "en-IN",
          defaultTimezone: "Asia/Kolkata",
          externalTenantId: `tenant-${slug}-${crypto.randomUUID().slice(0, 8)}`,
          firstLegalEntity: {
            baseCurrency: "INR",
            code: legalCode(newClient.name),
            countryCode: "IN",
            displayName: newClient.name,
            locale: "en-IN",
            registeredName: newClient.name,
            timezone: "Asia/Kolkata",
          },
          name: newClient.name,
          owner: { displayName: newClient.ownerName, email: newClient.ownerEmail },
          slug,
          unitSystem: "metric",
          weekStartsOn: 1,
        }),
      });
      const created = await payload(response) as { externalTenantId: string; ownerInvitation: { invitationToken: string | null }; workspace: { slug: string } };
      const detailsResponse = await fetch(`/api/internal/tenants/${encodeURIComponent(created.externalTenantId)}`);
      const details = await payload(detailsResponse) as ManagedTenant;
      setTenants((items) => [details, ...items]);
      select(details);
      if (created.ownerInvitation.invitationToken) {
        setActivationLink(`${location.origin}/login?tenant=${encodeURIComponent(created.workspace.slug)}&invitation=${encodeURIComponent(created.ownerInvitation.invitationToken)}`);
      }
      setNewClient(blankClient);
      setCreateOpen(false);
      setNotice("Tenant created. Share the activation link with the owner.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
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
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <div className={styles.shell}>
    <aside className={styles.sidebar} data-open={mobileNav || undefined}>
      <div className={styles.brand}><span>W</span><div><strong>Wodana</strong><small>Control</small></div></div>
      <nav aria-label="Internal portal"><a aria-current="page" href="#tenants"><Building2 size={17}/>Tenants</a></nav>
      <div className={styles.sidebarFooter}>
        <Link href="/workspace"><ArrowLeft size={16}/>Back to workspace</Link>
        <div className={styles.user}><span style={identityStyle(user.email)}>{identityInitials(user.name)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div>
      </div>
    </aside>
    {mobileNav ? <button aria-label="Close navigation" className={styles.scrim} onClick={() => setMobileNav(false)} /> : null}
    <main className={styles.main} id="tenants">
      <header className={styles.topbar}>
        <button aria-label="Open navigation" className={styles.menuButton} onClick={() => setMobileNav(true)}><Menu size={19}/></button>
        <div><strong>Tenant management</strong><small>Internal portal</small></div>
        <button aria-label={theme === "light" ? "Use dark mode" : "Use light mode"} className={styles.iconButton} onClick={toggleTheme}>{theme === "light" ? <Moon size={16}/> : <Sun size={16}/>}</button>
      </header>
      <section className={styles.content}>
        <div className={styles.pageHeader}><div><p className={styles.eyebrow}>Wodana control</p><h1>Tenants</h1><p>Provision workspaces and manage account access and billing.</p></div>
          <Button className={styles.primaryButton} onPress={() => { setCreateOpen(true); setError(""); setActivationLink(""); }}><Plus size={16}/>Add tenant</Button>
        </div>
        <div className={styles.metrics} aria-label="Tenant summary">
          <div><strong>{tenants.length}</strong><span>Total tenants</span></div>
          <div><strong>{activeCount}</strong><span>Active workspaces</span></div>
          <div><strong>{connectedCount}</strong><span>Connected channels</span></div>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status"><Check size={15}/>{notice}</p> : null}
        {activationLink ? <div className={styles.activation}><div><strong>Owner activation link</strong><small>This one-time link contains a secret. Share it only with the tenant owner.</small></div><button onClick={() => void navigator.clipboard.writeText(activationLink)}><Copy size={15}/>Copy link</button></div> : null}
        <div className={styles.workspace}>
          <section className={styles.clientList} aria-label="Tenants">
            <label className={styles.search}><Search size={16}/><span className={styles.visuallyHidden}>Search tenants</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Search tenants" type="search" value={query}/></label>
            <div className={styles.tableWrap}><table><thead><tr><th>Tenant</th><th>Plan</th><th>Usage</th><th>Integrations</th><th>Status</th></tr></thead><tbody>
              {filtered.map((tenant) => {
                const connected = tenant.integrations.filter((item) => item.status === "connected").reduce((sum, item) => sum + item.count, 0);
                return <tr data-selected={tenant.externalTenantId === selectedId || undefined} key={tenant.externalTenantId}>
                  <td><button aria-expanded={tenant.externalTenantId === selectedId} aria-label={`Manage ${tenant.workspace.name}`} className={styles.clientButton} onClick={() => select(tenant)}><span style={identityStyle(tenant.workspace.id)}>{identityInitials(tenant.workspace.name)}</span><span><strong>{tenant.workspace.name}</strong><small>{tenant.owner?.email ?? tenant.workspace.slug}</small></span><ChevronRight size={15}/></button></td>
                  <td><strong>{planLabel[tenant.subscription.planCode]}</strong><small>{statusLabel[tenant.subscription.status]}</small></td>
                  <td><strong>{tenant.usage.members}/{tenant.subscription.seatLimit} seats</strong><small>{tenant.usage.projects}/{tenant.subscription.projectLimit} projects</small></td>
                  <td><strong>{connected}</strong><small>connected</small></td>
                  <td><span className={styles.status} data-status={tenant.workspace.status}>{tenant.workspace.status}</span></td>
                </tr>;
              })}
            </tbody></table></div>
            {!filtered.length ? <p className={styles.empty}>No tenants match your search.</p> : null}
          </section>
        </div>
        {selected && draft ? <><button aria-label="Close tenant details" className={styles.drawerScrim} onClick={closeDetails}/><aside className={styles.detail} aria-label={`${selected.workspace.name} tenant details`}>
            <div className={styles.detailHeader}><div className={styles.clientTitle}><span style={identityStyle(selected.workspace.id)}>{identityInitials(selected.workspace.name)}</span><div><h2>{selected.workspace.name}</h2><p>{selected.workspace.slug}</p></div></div><div className={styles.detailActions}><a aria-label="Open tenant sign-in" href={`/login?tenant=${encodeURIComponent(selected.workspace.slug)}`} target="_blank"><ExternalLink size={16}/></a><button aria-label="Close tenant details" className={styles.iconButton} onClick={closeDetails}><X size={17}/></button></div></div>
            <div className={styles.owner}><span><Users size={16}/></span><div><small>Tenant owner</small><strong>{selected.owner?.name ?? "Owner invitation pending"}</strong><p>{selected.owner?.email ?? "No owner email"}</p></div></div>
            <section className={styles.detailSection}><div className={styles.sectionHeading}><h3>Access</h3><span>{selected.onboarding.status === "completed" ? "Onboarding complete" : "Setup in progress"}</span></div>
              <label>Workspace access<select value={draft.workspaceStatus} onChange={(event) => setDraft({ ...draft, workspaceStatus: event.target.value })}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
              {selected.ownerInvitation?.status !== "accepted" ? <button className={styles.secondaryButton} disabled={busy} onClick={() => void refreshInvitation()}>Create owner activation link</button> : null}
            </section>
            <section className={styles.detailSection}><div className={styles.sectionHeading}><h3>Billing</h3><span>Updated {formatDate(selected.subscription.updatedAt)}</span></div>
              <div className={styles.fieldGrid}><label>Plan<select value={draft.planCode} onChange={(event) => setDraft({ ...draft, planCode: event.target.value })}><option value="starter">Starter</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select></label><label>Subscription<select value={draft.subscriptionStatus} onChange={(event) => setDraft({ ...draft, subscriptionStatus: event.target.value })}><option value="trial">Trial</option><option value="active">Active</option><option value="past_due">Past due</option><option value="cancelled">Cancelled</option></select></label></div>
              <div className={styles.fieldGrid}><label>Billing cycle<select value={draft.billingCycle} onChange={(event) => setDraft({ ...draft, billingCycle: event.target.value })}><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="custom">Custom</option></select></label><label>Price · {selected.subscription.currency}<input min="0" onChange={(event) => setDraft({ ...draft, amount: event.target.value })} step="0.01" type="number" value={draft.amount}/></label></div>
              <label>Next renewal<input onChange={(event) => setDraft({ ...draft, renewsAt: event.target.value })} type="date" value={draft.renewsAt}/></label>
              <div className={styles.fieldGrid}><label>Seat limit<input min="1" onChange={(event) => setDraft({ ...draft, seatLimit: event.target.value })} type="number" value={draft.seatLimit}/></label><label>Project limit<input min="1" onChange={(event) => setDraft({ ...draft, projectLimit: event.target.value })} type="number" value={draft.projectLimit}/></label></div>
              <label>Internal note<textarea maxLength={500} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Contract or billing note" value={draft.note}/></label>
              <button className={styles.primaryButton} disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save tenant"}</button>
            </section>
          </aside></> : null}
      </section>
    </main>
    <ModalOverlay className={styles.modalOverlay} isDismissable={!busy} isOpen={createOpen} onOpenChange={setCreateOpen}><Modal className={styles.modal}><Dialog aria-label="Add tenant" className={styles.dialog}>
      <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>New workspace</p><Heading slot="title">Add tenant</Heading></div><Button aria-label="Close" className={styles.iconButton} isDisabled={busy} onPress={() => setCreateOpen(false)}><X size={17}/></Button></div>
      <form onSubmit={(event) => void createClient(event)}><label>Business name<input autoFocus required value={newClient.name} onChange={(event) => setNewClient({ ...newClient, name: event.target.value, slug: slugify(event.target.value) })}/></label><label>Workspace address<input pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={newClient.slug} onChange={(event) => setNewClient({ ...newClient, slug: slugify(event.target.value) })}/><small>{newClient.slug || "tenant"}.wodana.ai</small></label><div className={styles.fieldGrid}><label>Owner name<input required value={newClient.ownerName} onChange={(event) => setNewClient({ ...newClient, ownerName: event.target.value })}/></label><label>Owner email<input required type="email" value={newClient.ownerEmail} onChange={(event) => setNewClient({ ...newClient, ownerEmail: event.target.value })}/></label></div>{error ? <p className={styles.error} role="alert">{error}</p> : null}<div className={styles.dialogActions}><Button className={styles.secondaryButton} isDisabled={busy} onPress={() => setCreateOpen(false)}>Cancel</Button><button className={styles.primaryButton} disabled={busy} type="submit">{busy ? "Creating…" : "Create tenant"}</button></div></form>
    </Dialog></Modal></ModalOverlay>
  </div>;
}
