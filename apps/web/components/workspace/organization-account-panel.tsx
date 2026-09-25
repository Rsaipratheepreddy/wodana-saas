"use client";

import { Building2, CheckCircle2, Plus, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Callout, ConfirmationDialog, ControlledModalDialog, TextInput } from "@/design-system";
import type { CompanyProfileData } from "@/lib/workspace/company-profile";
import type { CustomerAccount, OrganizationRequest } from "@/lib/workspace/customer-account";
import styles from "./company-profile.module.css";

type RequestDraft = {
  name: string;
  registeredName: string;
  entityCode: string;
  reason: string;
};

function derivedEntityCode(name: string) {
  const normalized = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  return normalized.length >= 2 ? normalized : "ORG";
}

function emptyDraft(): RequestDraft {
  return { name: "", registeredName: "", entityCode: "", reason: "" };
}

function requestStatusTone(status: OrganizationRequest["status"]) {
  if (status === "pending") return "warning" as const;
  if (status === "approved") return "success" as const;
  if (status === "rejected") return "danger" as const;
  return "neutral" as const;
}

export function OrganizationAccountPanel({
  canManage,
  profile,
  account,
  initialRequests,
  standalone = false,
  unavailable,
}: {
  canManage: boolean;
  profile: CompanyProfileData;
  account: CustomerAccount | null;
  initialRequests: OrganizationRequest[];
  standalone?: boolean;
  unavailable?: boolean;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<RequestDraft>(emptyDraft);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancelTarget, setCancelTarget] = useState<OrganizationRequest | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const entity = profile.legalEntities[0];
  const accountSummary = useMemo(() => {
    if (!account) return null;
    return `${account.organizationCount} of ${account.organizationLimit} ${account.organizationLimit === 1 ? "company" : "companies"}`;
  }, [account]);

  const openRequest = () => {
    setDraft(emptyDraft());
    setRequestKey(null);
    setError("");
    setDialogOpen(true);
  };

  const updateName = (name: string) => {
    setDraft((current) => ({
      ...current,
      name,
      registeredName: !current.registeredName || current.registeredName === current.name ? name : current.registeredName,
      entityCode: !current.entityCode || current.entityCode === derivedEntityCode(current.name) ? derivedEntityCode(name) : current.entityCode,
    }));
    setError("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!entity || saving) return;
    const name = draft.name.trim();
    const registeredName = draft.registeredName.trim();
    const entityCode = draft.entityCode.trim().toUpperCase();
    if (name.length < 2) { setError("Enter a company name."); return; }
    if (registeredName.length < 2) { setError("Enter the registered company name."); return; }
    if (!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(entityCode)) { setError("Entity code must be 2–24 letters, numbers, hyphens, or underscores."); return; }
    setSaving(true); setError(""); setNotice("");
    const idempotencyKey = requestKey ?? crypto.randomUUID();
    setRequestKey(idempotencyKey);
    try {
      const response = await fetch("/api/workspace/organization-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: profile.workspace.id,
          idempotencyKey,
          name,
          registeredName,
          entityCode,
          countryCode: entity.countryCode,
          defaultCurrency: profile.workspace.defaultCurrency,
          defaultLocale: profile.workspace.defaultLocale,
          defaultTimezone: profile.workspace.defaultTimezone,
          unitSystem: profile.workspace.unitSystem,
          weekStartsOn: profile.workspace.weekStartsOn,
          reason: draft.reason.trim(),
        }),
      });
      const payload = await response.json().catch(() => null) as OrganizationRequest & { message?: string } | null;
      if (!response.ok || !payload?.id) throw new Error(payload?.message ?? "The organization request could not be sent.");
      setRequests((current) => [payload, ...current.filter((item) => item.id !== payload.id)]);
      setDialogOpen(false); setRequestKey(null); setNotice(`${payload.name} was sent to Wodana for review.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The organization request could not be sent.");
    } finally { setSaving(false); }
  };

  const cancelRequest = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true); setError("");
    try {
      const response = await fetch(`/api/workspace/organization-requests/${cancelTarget.id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: profile.workspace.id, expectedVersion: cancelTarget.version }),
      });
      const payload = await response.json().catch(() => null) as OrganizationRequest & { message?: string } | null;
      if (!response.ok || !payload?.id) throw new Error(payload?.message ?? "The organization request could not be cancelled.");
      setRequests((current) => current.map((item) => item.id === payload.id ? payload : item));
      setNotice(`${payload.name} request cancelled.`); setCancelTarget(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The organization request could not be cancelled.");
      setCancelTarget(null);
    } finally { setCancelling(false); }
  };

  if (!canManage || (!account && !unavailable)) return null;

  return <>
    <section aria-label={standalone ? "Manage workspaces" : undefined} aria-labelledby={standalone ? undefined : "organizations-heading"} className={`${styles.detailSection} ${styles.organizationAccountSection}`}>
      <header>
        <div>{standalone ? <p className={styles.standaloneSectionHint}>Each workspace is a separate company with its own people, data, client portal and integrations.</p> : <><h2 id="organizations-heading">Other workspaces</h2><p className={styles.sectionHint}>Each workspace is a separate company with its own people, data and settings.</p></>}</div>
        {account?.canRequestOrganization ? <Button onPress={openRequest} size="compact" variant="secondary"><Plus aria-hidden="true" size={15} />Add workspace</Button> : null}
      </header>
      {notice ? <p aria-live="polite" className={styles.organizationNotice}><CheckCircle2 aria-hidden="true" size={14} />{notice}</p> : null}
      {error && !dialogOpen ? <Callout title="Workspace request could not be updated" tone="danger">{error}</Callout> : null}
      {unavailable ? <Callout title="Organization account unavailable" tone="warning">Your current workspace is still available. Refresh this page to try loading organization requests again.</Callout> : null}
      {account ? <>
        <div className={styles.organizationSummary}><div><strong>{accountSummary}</strong><small>{account.availableOrganizationSlots > 0 ? `${account.availableOrganizationSlots} available in your current account limit.` : "Additional companies require Wodana approval."}</small></div><Badge tone="neutral">{account.status}</Badge></div>
        <ul aria-label="Workspaces in this account" className={styles.organizationList}>
          {account.organizations.map((organization) => <li key={organization.id}><span className={styles.organizationIcon}><Building2 aria-hidden="true" size={15} /></span><span><strong>{organization.name}</strong><small>{organization.slug}{organization.isDefault ? " · Main company" : ""}</small></span><Badge tone={organization.status === "active" ? "success" : "neutral"}>{organization.status}</Badge></li>)}
        </ul>
      </> : null}
      {requests.length ? <div className={styles.requestList}><h3>Requests</h3>{requests.map((item) => <div className={styles.requestRow} key={item.id}><div><strong>{item.name}</strong><small>{item.reason || "Additional independent organization"}</small>{item.decisionReason ? <small>{item.decisionReason}</small> : null}</div><div className={styles.requestActions}><Badge tone={requestStatusTone(item.status)}>{item.status}</Badge>{item.status === "pending" ? <Button aria-label={`Cancel ${item.name} request`} onPress={() => setCancelTarget(item)} size="compact" variant="quiet"><X aria-hidden="true" size={14} />Cancel</Button> : null}</div></div>)}</div> : null}
    </section>

    <ControlledModalDialog description="This creates a request only. Wodana reviews it before the new workspace is provisioned." footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={() => setDialogOpen(false)}>Cancel</Button><Button form="organization-request-form" isLoading={saving} type="submit" variant="primary">Send request</Button></div>} isOpen={dialogOpen} onOpenChange={(open) => { if (!saving) setDialogOpen(open); }} title="Add a workspace">
      <form className={styles.organizationRequestForm} id="organization-request-form" noValidate onSubmit={submit}>
        {error ? <Callout title="Could not send request" tone="danger">{error}</Callout> : null}
        <TextInput isRequired label="Company name" onChange={updateName} value={draft.name} />
        <TextInput isRequired label="Registered company name" onChange={(registeredName) => { setDraft((current) => ({ ...current, registeredName })); setError(""); }} value={draft.registeredName} />
        <TextInput description="Used on official documents. You can set it before approval." isRequired label="Entity code" onChange={(entityCode) => { setDraft((current) => ({ ...current, entityCode: entityCode.toUpperCase() })); setError(""); }} value={draft.entityCode} />
        <TextInput description={`Regional settings will start from ${profile.workspace.name} and can be changed after approval.`} label="Reason (optional)" onChange={(reason) => { setDraft((current) => ({ ...current, reason })); setError(""); }} value={draft.reason} />
      </form>
    </ControlledModalDialog>

    <ConfirmationDialog body={cancelTarget ? <>Cancel the request for <strong>{cancelTarget.name}</strong>? It will not create an organization.</> : null} confirmLabel={cancelling ? "Cancelling…" : "Cancel request"} isOpen={Boolean(cancelTarget)} onConfirm={() => void cancelRequest()} onOpenChange={(open) => { if (!open && !cancelling) setCancelTarget(null); }} title="Cancel organization request?" />
  </>;
}
