"use client";

import { ArrowLeft, Copy, Mail, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AppShell, Badge, Button, Callout, Container, DesignSystemProvider, FieldStack,
  Form, Heading, SelectField, Skeleton, TextInput, ValidationSummary,
} from "@/design-system";
import {
  emptyTenantDetails, selectedProfile, tenantDraftPayload, tenantSlug,
  validateTenantDetails, type NewTenantDetails, type SetupProfile,
} from "@/lib/internal/provisioning";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import styles from "./provisioning-page.module.css";

type Draft = {
  id: string;
  externalTenantId: string;
  account: { displayName: string; contactName: string; contactEmail: string };
  organization: { name: string; slug: string; firstLegalEntity: { registeredName: string } };
  owner: { displayName: string; email: string };
  defaults: { region: { code: string }; firmKit: { code: string }; plan: { code: string } };
  status: "draft" | "provisioning" | "provisioned" | "failed" | "expired";
  version: number;
};
type TenantResult = {
  externalTenantId: string;
  account: { displayName: string };
  workspace: { name: string; slug: string };
  ownerInvitation: { email: string; status: string; deliveryStatus: string; invitationToken: string | null };
  onboarding: { status: string };
};
type Provisioned = { draft: Draft; tenant: TenantResult };
type Stage = "details" | "review" | "ready";

async function result<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(data?.message || "The request could not be completed.");
  return data as T;
}

function inviteLabel(status: string) {
  if (status === "sent") return "Accepted by email provider";
  if (status === "failed") return "Email delivery failed";
  if (status === "not_configured") return "Email is not configured";
  if (status === "pending") return "Email pending";
  return "Not sent";
}

export function ProvisioningPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useWorkspaceTheme();
  const [profiles, setProfiles] = useState<SetupProfile[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [details, setDetails] = useState<NewTenantDetails>(emptyTenantDetails);
  const [stage, setStage] = useState<Stage>("details");
  const [errors, setErrors] = useState<string[]>([]);
  const [requestError, setRequestError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftKey, setDraftKey] = useState(() => crypto.randomUUID());
  const [provisionKey, setProvisionKey] = useState(() => crypto.randomUUID());
  const [sendKey, setSendKey] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tenant, setTenant] = useState<TenantResult | null>(null);
  const [activationLink, setActivationLink] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/internal/provisioning/profiles", { cache: "no-store" })
      .then((response) => result<SetupProfile[]>(response))
      .then((value) => { if (active) setProfiles(value); })
      .catch((reason) => { if (active) setProfileError((reason as Error).message); })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const draftId = new URLSearchParams(window.location.search).get("draft");
    if (!draftId || !/^[0-9a-f-]{36}$/i.test(draftId)) return;
    let active = true;
    void fetch(`/api/internal/provisioning/drafts/${draftId}`, { cache: "no-store" })
      .then((response) => result<Draft>(response))
      .then(async (saved) => {
        if (!active) return;
        setDraft(saved);
        setDetails({
          accountName: saved.account.displayName, contactName: saved.account.contactName,
          contactEmail: saved.account.contactEmail, organizationName: saved.organization.name,
          slug: saved.organization.slug, registeredName: saved.organization.firstLegalEntity.registeredName,
          ownerName: saved.owner.displayName, ownerEmail: saved.owner.email,
          regionCode: saved.defaults.region.code, firmKitCode: saved.defaults.firmKit.code,
          planCode: saved.defaults.plan.code,
        });
        const storedKey = sessionStorage.getItem(`wodana-provision:${saved.id}`);
        if (storedKey) setProvisionKey(storedKey);
        if (saved.status === "provisioned") {
          const response = await fetch(`/api/internal/tenants/${encodeURIComponent(saved.externalTenantId)}`);
          const existing = await result<TenantResult>(response);
          if (active) { setTenant(existing); setStage("ready"); }
        } else setStage("review");
      })
      .catch((reason) => { if (active) setRequestError((reason as Error).message); });
    return () => { active = false; };
  }, []);

  function update<K extends keyof NewTenantDetails>(key: K, value: NewTenantDetails[K]) {
    setDetails((current) => ({ ...current, [key]: value }));
    setErrors([]);
  }

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateTenantDetails(details, profiles);
    setErrors(found);
    if (!found.length) setStage("review");
  }

  async function create() {
    setBusy(true); setRequestError("");
    try {
      let currentDraft = draft;
      if (!currentDraft) {
        const body = tenantDraftPayload(details, profiles, draftKey);
        currentDraft = await result<Draft>(await fetch("/api/internal/provisioning/drafts", {
          method: "POST", headers: { "content-type": "application/json", "idempotency-key": draftKey },
          body: JSON.stringify(body),
        }));
        setDraft(currentDraft);
        sessionStorage.setItem(`wodana-provision:${currentDraft.id}`, provisionKey);
        window.history.replaceState(null, "", `/internal/new?draft=${currentDraft.id}`);
      } else {
        currentDraft = await result<Draft>(await fetch(`/api/internal/provisioning/drafts/${currentDraft.id}`, { cache: "no-store" }));
        setDraft(currentDraft);
        if (currentDraft.status === "expired") throw new Error("The login address reservation expired. Start again to choose a new address.");
        if (currentDraft.status === "provisioned") {
          const existing = await result<TenantResult>(await fetch(`/api/internal/tenants/${encodeURIComponent(currentDraft.externalTenantId)}`));
          setTenant(existing); setStage("ready");
          return;
        }
      }
      const provisioned = await result<Provisioned>(await fetch(`/api/internal/provisioning/drafts/${currentDraft.id}/provision`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": provisionKey },
        body: JSON.stringify({ expectedVersion: currentDraft.version }),
      }));
      setDraft(provisioned.draft);
      setTenant(provisioned.tenant);
      if (provisioned.tenant.ownerInvitation.invitationToken) {
        setActivationLink(`${window.location.origin}/login?tenant=${encodeURIComponent(provisioned.tenant.workspace.slug)}&invitation=${encodeURIComponent(provisioned.tenant.ownerInvitation.invitationToken)}`);
      }
      setStage("ready");
    } catch (reason) { setRequestError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function sendInvitation() {
    if (!tenant) return;
    setBusy(true); setRequestError("");
    try {
      const invitation = await result<TenantResult["ownerInvitation"]>(await fetch(
        `/api/internal/tenants/${encodeURIComponent(tenant.externalTenantId)}/owner-invitation/send`,
        { method: "POST", headers: { "idempotency-key": sendKey } },
      ));
      setTenant((current) => current ? { ...current, ownerInvitation: { ...current.ownerInvitation, ...invitation } } : current);
      setActivationLink(invitation.deliveryStatus === "sent" || !invitation.invitationToken ? ""
        : `${window.location.origin}/login?tenant=${encodeURIComponent(tenant.workspace.slug)}&invitation=${encodeURIComponent(invitation.invitationToken)}`);
      if (invitation.deliveryStatus !== "sent") setSendKey(crypto.randomUUID());
    } catch (reason) { setRequestError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function startAgain() {
    setDraft(null); setTenant(null); setStage("details"); setRequestError(""); setActivationLink("");
    setDetails(emptyTenantDetails);
    setDraftKey(crypto.randomUUID()); setProvisionKey(crypto.randomUUID()); setSendKey(crypto.randomUUID());
    window.history.replaceState(null, "", "/internal/new");
  }

  const region = selectedProfile(profiles, "region", details.regionCode);
  const plan = selectedProfile(profiles, "plan", details.planCode);
  const kit = selectedProfile(profiles, "firm_kit", details.firmKitCode);
  const options = (kind: SetupProfile["kind"]) => profiles.filter((profile) => profile.kind === kind && selectedProfile(profiles, kind, profile.code)?.version === profile.version)
    .map((profile) => ({ id: profile.code, label: String(profile.configuration.label ?? profile.code).replaceAll("_", " "),
      description: kind === "plan" ? `${profile.configuration.seatLimit ?? "?"} seats · ${profile.configuration.projectLimit ?? "?"} projects` : undefined }));

  return <DesignSystemProvider theme={theme === "dark" ? "dark" : "light"} locale="en-AE" currency="AED" timeZone="Asia/Dubai">
    <AppShell title="Wodana Control" topActions={<Button variant="quiet" onPress={toggleTheme}>Use {theme === "light" ? "dark" : "light"} mode</Button>}>
      <Container as="main" size="wide" className={styles.page}>
        <Button variant="quiet" onPress={() => router.push("/internal")}><ArrowLeft size={16} />Tenants</Button>
        <div className={styles.heading}><Heading as="h1" size="lg">Add customer</Heading><p>Set up one account and its first organization.</p></div>
        <div className={styles.steps} aria-label="Setup progress"><span aria-current={stage === "details" ? "step" : undefined}>1 Details</span><span aria-current={stage === "review" ? "step" : undefined}>2 Review</span><span aria-current={stage === "ready" ? "step" : undefined}>3 Ready</span></div>
        {profileLoading ? <Skeleton lines={6} /> : profileError ? <Callout title="Setup options unavailable" tone="danger">{profileError}</Callout> : profiles.length === 0 ? <Callout title="No setup options" tone="warning">Publish region, firm kit and plan profiles before adding a customer.</Callout> : <>
          {stage === "details" ? <Form onSubmit={review}><FieldStack>
            <div className={styles.grid}><TextInput autoFocus isRequired label="Customer account" description="Contract and billing relationship" value={details.accountName} onChange={(value) => { setDetails((current) => {
              const organizationName = !current.organizationName || current.organizationName === current.accountName ? value : current.organizationName;
              return { ...current, accountName: value, organizationName,
                slug: !current.slug || current.slug === tenantSlug(current.organizationName) ? tenantSlug(organizationName) : current.slug };
            }); setErrors([]); }} /><TextInput isRequired label="Organization" description="The team's private workspace" value={details.organizationName} onChange={(value) => { setDetails((current) => ({ ...current, organizationName: value, slug: current.slug === tenantSlug(current.organizationName) ? tenantSlug(value) : current.slug })); setErrors([]); }} /></div>
            <div className={styles.grid}><TextInput isRequired label="Contract contact" value={details.contactName} onChange={(value) => update("contactName", value)} /><TextInput isRequired inputType="email" label="Contact email" value={details.contactEmail} onChange={(value) => update("contactEmail", value)} /></div>
            <div className={styles.grid}><TextInput isRequired label="Owner name" value={details.ownerName} onChange={(value) => update("ownerName", value)} /><TextInput isRequired inputType="email" label="Owner email" value={details.ownerEmail} onChange={(value) => update("ownerEmail", value)} /></div>
            <div className={styles.grid}><TextInput isRequired label="Login address" description={`${details.slug || "organization"}.wodana.ai`} value={details.slug} onChange={(value) => update("slug", tenantSlug(value))} /><TextInput label="Registered company name" description="Leave blank if same as the organization" value={details.registeredName} onChange={(value) => update("registeredName", value)} /></div>
            <div className={styles.gridThree}><SelectField isRequired accent="neutral" label="Region" items={options("region")} selectedKey={details.regionCode} onSelectionChange={(key) => { if (key) update("regionCode", String(key)); }} /><SelectField isRequired accent="neutral" label="Firm setup" items={options("firm_kit")} selectedKey={details.firmKitCode} onSelectionChange={(key) => { if (key) update("firmKitCode", String(key)); }} /><SelectField isRequired accent="neutral" label="Trial plan" items={options("plan")} selectedKey={details.planCode} onSelectionChange={(key) => { if (key) update("planCode", String(key)); }} /></div>
            <ValidationSummary errors={errors} />
            <div className={styles.actions}><Button type="submit" variant="primary">Review setup</Button></div>
          </FieldStack></Form> : null}
          {stage === "review" ? <div className={styles.review}>
            <div className={styles.facts}><div><small>Customer account</small><strong>{details.accountName}</strong><span>{details.contactName} · {details.contactEmail}</span></div><div><small>First organization</small><strong>{details.organizationName}</strong><span>{details.slug}.wodana.ai</span></div><div><small>Registered business</small><strong>{details.registeredName || details.organizationName}</strong><span>{String(region?.configuration.countryCode ?? details.regionCode)}</span></div><div><small>Owner</small><strong>{details.ownerName}</strong><span>{details.ownerEmail}</span></div><div><small>Setup</small><strong>{String(kit?.configuration.label ?? details.firmKitCode)} · {String(plan?.configuration.label ?? details.planCode)}</strong><span>{String(region?.configuration.currency ?? "")} · {String(region?.configuration.timezone ?? "")} · {String(plan?.configuration.seatLimit ?? "?")} seats · {String(plan?.configuration.projectLimit ?? "?")} projects</span></div></div>
            {requestError ? <Callout title="Setup needs attention" tone="danger">{requestError}</Callout> : null}
            <div className={styles.actions}><Button isDisabled={busy || !!draft} onPress={() => setStage("details")}>Edit details</Button>{draft?.status === "expired" ? <Button onPress={startAgain}>Start again</Button> : <Button isLoading={busy} variant="primary" onPress={() => void create()}>{draft ? "Retry setup" : "Create customer"}</Button>}</div>
          </div> : null}
          {stage === "ready" && tenant ? <div className={styles.ready}>
            <Callout title="Customer and organization created" tone="success">{tenant.account.displayName} · {tenant.workspace.name}</Callout>
            <div className={styles.facts}><div><small>Workspace</small><strong>{tenant.workspace.slug}.wodana.ai</strong><span><Badge tone="success">Ready</Badge></span></div><div><small>Owner invitation</small><strong>{inviteLabel(tenant.ownerInvitation.deliveryStatus)}</strong><span>{tenant.ownerInvitation.email}</span></div><div><small>Owner onboarding</small><strong>{tenant.onboarding.status === "completed" ? "Complete" : "Waiting for owner"}</strong><span>Activation and MFA are completed by the owner.</span></div></div>
            {tenant.ownerInvitation.deliveryStatus !== "sent" && tenant.ownerInvitation.status !== "accepted" ? <div><Button isLoading={busy} onPress={() => void sendInvitation()}><Mail size={16} />{tenant.ownerInvitation.deliveryStatus === "not_requested" ? "Send owner email" : "Retry owner email"}</Button></div> : null}
            {activationLink ? <Callout title="Manual activation link" tone="warning">Email is not confirmed. This link is shown once; share it only with the owner. <Button size="compact" onPress={() => void navigator.clipboard.writeText(activationLink)}><Copy size={14} />Copy link</Button></Callout> : null}
            {tenant.ownerInvitation.deliveryStatus === "failed" || tenant.ownerInvitation.deliveryStatus === "not_configured" ? <p className={styles.hint}>Retrying email replaces the current activation link.</p> : null}
            {requestError ? <Callout title="Invitation needs attention" tone="danger">{requestError}</Callout> : null}
            <div className={styles.actions}><Button onPress={() => router.push("/internal")}>View tenants</Button><Button variant="quiet" onPress={startAgain}><RotateCw size={15} />Add another</Button></div>
          </div> : null}
        </>}
      </Container>
    </AppShell>
  </DesignSystemProvider>;
}
