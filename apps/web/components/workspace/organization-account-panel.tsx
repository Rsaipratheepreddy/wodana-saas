"use client";

import { Building2, CheckCircle2, Plus, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Callout, ConfirmationDialog, ControlledModalDialog, TextInput } from "@/design-system";
import type { CompanyProfileData } from "@/lib/workspace/company-profile";
import type { CustomerAccount, OrganizationRequest } from "@/lib/workspace/customer-account";
import styles from "./company-profile.module.css";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

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

const STATUS_LABELS: Record<string, MessageKey> = {
  active: tKey("Active"), suspended: tKey("Suspended"), pending: tKey("Pending"), approved: tKey("Approved"), rejected: tKey("Rejected"), cancelled: tKey("Cancelled"),
};

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
  const t = useT();
  const statusLabel = (status: string) => STATUS_LABELS[status] ? t(STATUS_LABELS[status]) : status;
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
    return account.organizationLimit === 1
      ? t("{count} of {limit} company", { count: account.organizationCount, limit: account.organizationLimit })
      : t("{count} of {limit} companies", { count: account.organizationCount, limit: account.organizationLimit });
  }, [account, t]);

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
    if (name.length < 2) { setError(t("Enter a company name.")); return; }
    if (registeredName.length < 2) { setError(t("Enter the registered company name.")); return; }
    if (!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(entityCode)) { setError(t("Entity code must be 2–24 letters, numbers, hyphens, or underscores.")); return; }
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
      if (!response.ok || !payload?.id) throw new Error(payload?.message ?? t("The organization request could not be sent."));
      setRequests((current) => [payload, ...current.filter((item) => item.id !== payload.id)]);
      setDialogOpen(false); setRequestKey(null); setNotice(t("{name} was sent to Wodana for review.", { name: payload.name }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("The organization request could not be sent."));
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
      if (!response.ok || !payload?.id) throw new Error(payload?.message ?? t("The organization request could not be cancelled."));
      setRequests((current) => current.map((item) => item.id === payload.id ? payload : item));
      setNotice(t("{name} request cancelled.", { name: payload.name })); setCancelTarget(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("The organization request could not be cancelled."));
      setCancelTarget(null);
    } finally { setCancelling(false); }
  };

  if (!canManage || (!account && !unavailable)) return null;

  return <>
    <section aria-label={standalone ? t("Manage workspaces") : undefined} aria-labelledby={standalone ? undefined : "organizations-heading"} className={`${styles.detailSection} ${styles.organizationAccountSection}`}>
      <header>
        <div>{standalone ? <p className={styles.standaloneSectionHint}>{t("Each workspace is a separate company with its own people, data, client portal and integrations.")}</p> : <><h2 id="organizations-heading">{t("Other workspaces")}</h2><p className={styles.sectionHint}>{t("Each workspace is a separate company with its own people, data and settings.")}</p></>}</div>
        {account?.canRequestOrganization ? <Button onPress={openRequest} size="compact" variant="secondary"><Plus aria-hidden="true" size={15} />{t("Add workspace")}</Button> : null}
      </header>
      {notice ? <p aria-live="polite" className={styles.organizationNotice}><CheckCircle2 aria-hidden="true" size={14} />{notice}</p> : null}
      {error && !dialogOpen ? <Callout title={t("Workspace request could not be updated")} tone="danger">{error}</Callout> : null}
      {unavailable ? <Callout title={t("Organization account unavailable")} tone="warning">{t("Your current workspace is still available. Refresh this page to try loading organization requests again.")}</Callout> : null}
      {account ? <>
        <div className={styles.organizationSummary}><div><strong>{accountSummary}</strong><small>{account.availableOrganizationSlots > 0 ? t("{count} available in your current account limit.", { count: account.availableOrganizationSlots }) : t("Additional companies require Wodana approval.")}</small></div><Badge tone="neutral">{statusLabel(account.status)}</Badge></div>
        <ul aria-label={t("Workspaces in this account")} className={styles.organizationList}>
          {account.organizations.map((organization) => <li key={organization.id}><span className={styles.organizationIcon}><Building2 aria-hidden="true" size={15} /></span><span><strong>{organization.name}</strong><small>{organization.isDefault ? t("{slug} · Main company", { slug: organization.slug }) : organization.slug}</small></span><Badge tone={organization.status === "active" ? "success" : "neutral"}>{statusLabel(organization.status)}</Badge></li>)}
        </ul>
      </> : null}
      {requests.length ? <div className={styles.requestList}><h3>{t("Requests")}</h3>{requests.map((item) => <div className={styles.requestRow} key={item.id}><div><strong>{item.name}</strong><small>{item.reason || t("Additional independent organization")}</small>{item.decisionReason ? <small>{item.decisionReason}</small> : null}</div><div className={styles.requestActions}><Badge tone={requestStatusTone(item.status)}>{statusLabel(item.status)}</Badge>{item.status === "pending" ? <Button aria-label={t("Cancel {name} request", { name: item.name })} onPress={() => setCancelTarget(item)} size="compact" variant="quiet"><X aria-hidden="true" size={14} />{t("Cancel")}</Button> : null}</div></div>)}</div> : null}
    </section>

    <ControlledModalDialog description={t("This creates a request only. Wodana reviews it before the new workspace is provisioned.")} footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={() => setDialogOpen(false)}>{t("Cancel")}</Button><Button form="organization-request-form" isLoading={saving} type="submit" variant="primary">{t("Send request")}</Button></div>} isOpen={dialogOpen} onOpenChange={(open) => { if (!saving) setDialogOpen(open); }} title={t("Add a workspace")}>
      <form className={styles.organizationRequestForm} id="organization-request-form" noValidate onSubmit={submit}>
        {error ? <Callout title={t("Could not send request")} tone="danger">{error}</Callout> : null}
        <TextInput isRequired label={t("Company name")} onChange={updateName} value={draft.name} />
        <TextInput isRequired label={t("Registered company name")} onChange={(registeredName) => { setDraft((current) => ({ ...current, registeredName })); setError(""); }} value={draft.registeredName} />
        <TextInput description={t("Used on official documents. You can set it before approval.")} isRequired label={t("Entity code")} onChange={(entityCode) => { setDraft((current) => ({ ...current, entityCode: entityCode.toUpperCase() })); setError(""); }} value={draft.entityCode} />
        <TextInput description={t("Regional settings will start from {name} and can be changed after approval.", { name: profile.workspace.name })} label={t("Reason (optional)")} onChange={(reason) => { setDraft((current) => ({ ...current, reason })); setError(""); }} value={draft.reason} />
      </form>
    </ControlledModalDialog>

    <ConfirmationDialog body={cancelTarget ? t("Cancel the request for {name}? It will not create an organization.", { name: cancelTarget.name }) : null} confirmLabel={cancelling ? t("Cancelling…") : t("Cancel request")} isOpen={Boolean(cancelTarget)} onConfirm={() => void cancelRequest()} onOpenChange={(open) => { if (!open && !cancelling) setCancelTarget(null); }} title={t("Cancel organization request?")} />
  </>;
}
