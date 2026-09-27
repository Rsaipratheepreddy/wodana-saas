"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Badge, Breadcrumbs, Button, Callout, ErrorState, Fieldset, Form, InlineNotice, NumericInput, PageHeader, PageSkeleton,
  SelectField, TextInput, ValidationSummary,
} from "@/design-system";
import { useLanguage, useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, type SlugAvailability } from "@/lib/internal/console";
import {
  defaultSelections, emptyTenantDetails, planSeats, selectedProfile, tenantDraftPayload, tenantSlug,
  type NewTenantDetails, type SetupProfile,
} from "@/lib/internal/provisioning";
import { useConsoleLabels } from "./labels";
import styles from "./control-plane.module.css";

type Draft = { id: string; externalTenantId: string; status: "draft" | "provisioning" | "provisioned" | "failed" | "expired"; version: number };
type Tenant = {
  externalTenantId: string;
  account: { id: string; displayName: string };
  workspace: { name: string; slug: string };
  ownerInvitation: { email: string; status: string; deliveryStatus: string; invitationToken: string | null };
};
type Stage = "details" | "review" | "ready";

async function json<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(data?.message ?? "");
  return data as T;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create tenant (§6.1): account, organization, login address, country, plan and seats, owner invitation. Idempotent. */
export function CreateTenantPage() {
  const t = useT();
  const { language } = useLanguage();
  const router = useRouter();
  const labels = useConsoleLabels();
  const [profiles, setProfiles] = useState<SetupProfile[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [details, setDetails] = useState<NewTenantDetails>(emptyTenantDetails);
  const [stage, setStage] = useState<Stage>("details");
  const [errors, setErrors] = useState<string[]>([]);
  const [requestError, setRequestError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState<SlugAvailability | null>(null);
  const [keys] = useState(() => ({ draft: crypto.randomUUID(), provision: crypto.randomUUID() }));
  const [sendKey, setSendKey] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [link, setLink] = useState("");

  const load = useCallback(async () => {
    try {
      const loaded = await json<SetupProfile[]>(await fetch("/api/internal/provisioning/profiles", { cache: "no-store" }));
      setProfiles(loaded);
      setDetails((current) => ({ ...current, ...defaultSelections(loaded) }));
      setLoadError("");
    } catch (cause) { setLoadError((cause as Error).message || t("Setup options didn't load.")); }
  }, [t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  useEffect(() => {
    if (!details.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(details.slug)) return;
    let live = true;
    const timer = window.setTimeout(() => {
      consoleApi.slug(details.slug).then((result) => { if (live) setSlug(result); }).catch(() => { if (live) setSlug(null); });
    }, 350);
    return () => { live = false; window.clearTimeout(timer); };
  }, [details.slug]);
  const slugState = slug?.slug === details.slug ? slug : null;

  const regionNames = useMemo(() => {
    try { return new Intl.DisplayNames([language], { type: "region" }); } catch { return null; }
  }, [language]);
  const options = (kind: SetupProfile["kind"]) => (profiles ?? [])
    .filter((profile) => profile.kind === kind && selectedProfile(profiles ?? [], kind, profile.code)?.version === profile.version)
    .map((profile) => ({
      id: profile.code,
      label: kind === "region"
        ? regionNames?.of(String(profile.configuration.countryCode ?? profile.code)) ?? String(profile.configuration.name ?? profile.code)
        : String(profile.configuration.label ?? profile.code).replaceAll("_", " "),
    }));
  const plan = profiles ? selectedProfile(profiles, "plan", details.planCode) : null;
  const seats = details.seatLimit ?? planSeats(plan);

  const update = <K extends keyof NewTenantDetails>(key: K, value: NewTenantDetails[K]) => {
    setDetails((current) => ({ ...current, [key]: value }));
    setErrors([]);
  };
  const nameChanged = (value: string) => setDetails((current) => {
    const organizationName = !current.organizationName || current.organizationName === current.accountName ? value : current.organizationName;
    return { ...current, accountName: value, organizationName,
      slug: !current.slug || current.slug === tenantSlug(current.organizationName) ? tenantSlug(organizationName) : current.slug };
  });

  const validate = () => {
    const found: string[] = [];
    if (details.accountName.trim().length < 2) found.push(t("Enter the account name."));
    if (details.organizationName.trim().length < 2) found.push(t("Enter the organization name."));
    if (details.contactName.trim().length < 2) found.push(t("Enter the contract contact."));
    if (!EMAIL.test(details.contactEmail.trim())) found.push(t("Enter a valid contact email."));
    if (details.ownerName.trim().length < 2) found.push(t("Enter the owner's name."));
    if (!EMAIL.test(details.ownerEmail.trim())) found.push(t("Enter a valid owner email."));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(details.slug)) found.push(t("Choose a valid login address."));
    else if (slugState && !slugState.available) found.push(t("That login address is taken."));
    if (!details.regionCode || !details.firmKitCode || !details.planCode) found.push(t("Choose a country, setup and plan."));
    if (seats !== null && (!Number.isInteger(seats) || seats < 1)) found.push(t("Seats must be a whole number of at least 1."));
    return found;
  };

  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (!found.length) setStage("review");
  };

  const create = async () => {
    if (!profiles) return;
    setBusy(true); setRequestError("");
    try {
      let current = draft;
      if (!current) {
        current = await json<Draft>(await fetch("/api/internal/provisioning/drafts", {
          method: "POST", headers: { "content-type": "application/json", "idempotency-key": keys.draft },
          body: JSON.stringify(tenantDraftPayload({ ...details, seatLimit: seats }, profiles, keys.draft)),
        }));
        setDraft(current);
      }
      const provisioned = await json<{ draft: Draft; tenant: Tenant }>(await fetch(`/api/internal/provisioning/drafts/${current.id}/provision`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": keys.provision },
        body: JSON.stringify({ expectedVersion: current.version }),
      }));
      setDraft(provisioned.draft);
      setTenant(provisioned.tenant);
      setStage("ready");
      await send(provisioned.tenant);
    } catch (cause) { setRequestError((cause as Error).message || t("The tenant could not be created.")); }
    finally { setBusy(false); }
  };

  const send = async (target: Tenant) => {
    setBusy(true); setRequestError("");
    try {
      const sent = await consoleApi.sendOwnerInvitation(target.externalTenantId, sendKey);
      setTenant((value) => value ? { ...value, ownerInvitation: { ...value.ownerInvitation, ...sent } } : value);
      setLink(sent.deliveryStatus !== "sent" && sent.invitationToken
        ? `${window.location.origin}/login?tenant=${encodeURIComponent(target.workspace.slug)}&invitation=${encodeURIComponent(sent.invitationToken)}` : "");
      if (sent.deliveryStatus !== "sent") setSendKey(crypto.randomUUID());
    } catch (cause) { setRequestError((cause as Error).message || t("The owner email could not be sent.")); }
    finally { setBusy(false); }
  };

  const crumbs = <Breadcrumbs items={[{ href: "/internal", label: t("Accounts") }]} />;
  if (loadError && !profiles) return <div className={styles.page}>{crumbs}<PageHeader title={t("Create tenant")} /><ErrorState description={loadError} onRetry={() => void load()} /></div>;
  if (!profiles) return <div className={styles.page}><PageSkeleton variant="form" /></div>;
  const region = selectedProfile(profiles, "region", details.regionCode);
  const kit = selectedProfile(profiles, "firm_kit", details.firmKitCode);
  const invitation = tenant ? labels.invitation(tenant.ownerInvitation.status, tenant.ownerInvitation.deliveryStatus) : null;

  return <div className={styles.page}>
    {crumbs}
    <PageHeader title={t("Create tenant")} />
    {stage === "details" ? <Form className={styles.form} onSubmit={review}>
      <Fieldset legend={t("Account")}>
        <div className={styles.pair}>
          <TextInput autoFocus isRequired label={t("Account name")} value={details.accountName} onChange={nameChanged} />
          <TextInput isRequired label={t("Organization name")} value={details.organizationName} onChange={(value) => setDetails((current) => ({
            ...current, organizationName: value, slug: current.slug === tenantSlug(current.organizationName) ? tenantSlug(value) : current.slug }))} />
        </div>
        <div className={styles.pair}>
          <TextInput isRequired label={t("Contract contact")} value={details.contactName} onChange={(value) => update("contactName", value)} />
          <TextInput isRequired inputType="email" label={t("Contact email")} value={details.contactEmail} onChange={(value) => update("contactEmail", value)} />
        </div>
      </Fieldset>
      <Fieldset legend={t("Organization")}>
        <div className={styles.pair}>
          <TextInput isRequired label={t("Login address")} value={details.slug} onChange={(value) => update("slug", tenantSlug(value))}
            isInvalid={Boolean(slugState && !slugState.available)}
            errorMessage={slugState && !slugState.available ? t("Taken") : undefined}
            description={slugState?.available ? t("{address} is free", { address: slugState.address }) : undefined} />
          <TextInput label={t("Registered name")} value={details.registeredName} onChange={(value) => update("registeredName", value)} />
        </div>
        {slugState && !slugState.available && slugState.suggestion
          ? <div><Button size="compact" onPress={() => update("slug", slugState.suggestion!)}>{t("Use {slug}", { slug: slugState.suggestion })}</Button></div> : null}
        <div className={styles.pair}>
          <SelectField isRequired accent="neutral" label={t("Country")} items={options("region")} selectedKey={details.regionCode || null}
            onSelectionChange={(key) => { if (key) update("regionCode", String(key)); }} />
          <SelectField isRequired accent="neutral" label={t("Firm setup")} items={options("firm_kit")} selectedKey={details.firmKitCode || null}
            onSelectionChange={(key) => { if (key) update("firmKitCode", String(key)); }} />
        </div>
        <div className={styles.pair}>
          <SelectField isRequired accent="neutral" label={t("Plan")} items={options("plan")} selectedKey={details.planCode || null}
            onSelectionChange={(key) => { if (key) setDetails((current) => ({ ...current, planCode: String(key), seatLimit: null })); }} />
          <NumericInput isRequired label={t("Seats")} minValue={1} value={seats ?? undefined} onChange={(value) => update("seatLimit", Number.isFinite(value) ? value : null)} />
        </div>
      </Fieldset>
      <Fieldset legend={t("Owner")}>
        <div className={styles.pair}>
          <TextInput isRequired label={t("Owner name")} value={details.ownerName} onChange={(value) => update("ownerName", value)} />
          <TextInput isRequired inputType="email" label={t("Owner email")} value={details.ownerEmail} onChange={(value) => update("ownerEmail", value)} />
        </div>
      </Fieldset>
      <ValidationSummary errors={errors} />
      <div className={styles.actions}><Button variant="primary" type="submit">{t("Review")}</Button></div>
    </Form> : null}

    {stage === "review" ? <div className={styles.form}>
      <dl className={styles.properties}>
        <div><dt>{t("Account")}</dt><dd>{details.accountName}</dd></div>
        <div><dt>{t("Contact")}</dt><dd>{details.contactName} · <span dir="ltr">{details.contactEmail}</span></dd></div>
        <div><dt>{t("Organization")}</dt><dd>{details.organizationName}</dd></div>
        <div><dt>{t("Login address")}</dt><dd dir="ltr">{slugState?.address ?? details.slug}</dd></div>
        <div><dt>{t("Country")}</dt><dd>{options("region").find((item) => item.id === details.regionCode)?.label}
          <span className={styles.muted}>{String(region?.configuration.currency ?? "")}</span></dd></div>
        <div><dt>{t("Firm setup")}</dt><dd>{String(kit?.configuration.label ?? details.firmKitCode)}</dd></div>
        <div><dt>{t("Plan")}</dt><dd>{details.planCode}</dd></div>
        <div><dt>{t("Seats")}</dt><dd className={styles.number}>{seats}</dd></div>
        <div><dt>{t("Owner")}</dt><dd>{details.ownerName} · <span dir="ltr">{details.ownerEmail}</span></dd></div>
      </dl>
      {requestError ? <InlineNotice tone="error" message={requestError} /> : null}
      <div className={styles.actions}>
        <Button isDisabled={busy || Boolean(draft)} onPress={() => setStage("details")}>{t("Edit")}</Button>
        <Button variant="primary" isLoading={busy} onPress={() => void create()}>{draft ? t("Try again") : t("Create tenant")}</Button>
      </div>
    </div> : null}

    {stage === "ready" && tenant && invitation ? <div className={styles.form}>
      <Callout tone="success" title={t("Tenant created")}>{tenant.workspace.name} · <span dir="ltr">{slugState?.address ?? tenant.workspace.slug}</span></Callout>
      <dl className={styles.properties}>
        <div><dt>{t("Owner")}</dt><dd><span dir="ltr">{tenant.ownerInvitation.email}</span><Badge tone={invitation.tone}>{invitation.label}</Badge></dd></div>
      </dl>
      {link ? <div className={styles.link}>
        <InlineNotice tone="info" message={t("Email isn't delivered. Share this one-time link with the owner only.")} />
        <code>{link}</code>
        <div><Button size="compact" onPress={() => void navigator.clipboard.writeText(link)}><Copy aria-hidden="true" size={14} />{t("Copy link")}</Button></div>
      </div> : null}
      {requestError ? <InlineNotice tone="error" message={requestError} /> : null}
      <div className={styles.actions}>
        {tenant.ownerInvitation.deliveryStatus !== "sent" ? <Button isLoading={busy} onPress={() => void send(tenant)}>{t("Send new link")}</Button> : null}
        <Button variant="primary" onPress={() => router.push(`/internal/accounts/${tenant.account.id}`)}>{t("Open account")}</Button>
      </div>
    </div> : null}
  </div>;
}
