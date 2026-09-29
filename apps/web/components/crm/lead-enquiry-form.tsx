"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, FillWithWoddy, FormDialog, FormRow, MoreDetails, SelectField, TextInput, TextAreaField, useFormDraft } from "@/design-system";
import { salesOwnerChoices, type LeadsPageData } from "@/lib/crm/leads";
import { sourceAllowedFor, type EnquiryDetails, type LeadContact, type LeadOptions } from "@/lib/crm/lead-options";
import { countryForPhone, phoneCountry, phoneProblem, toE164 } from "@/lib/crm/phone";
import { findContactMatches, type ClientMatch } from "@/lib/crm/client-match";
import { CrmPhoneField } from "./crm-phone-field";
import { ClientMatchList } from "./client-match-list";
import { administrativeAreaLabel, countryFromLocale } from "@/lib/workspace/region-labels";
import { enquiryFields, isShown } from "@/lib/crm/enquiry-fields";
import { changedValues, EnquiryCustomInputs, saveLeadFields, type CustomValues } from "./enquiry-custom-inputs";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { useAiReady } from "@/lib/workspace/ai-settings";
import { fillWithWoddy, imageForWoddy } from "@/lib/woddy/form-fill";
import styles from "./leads-page.module.css";

export type EditableEnquiry = {
  id: string; version: number; reference?: string; title?: string; summary?: string;
  serviceType?: string; details?: EnquiryDetails; party: LeadContact; source?: string; channel?: string;
  referral?: { kind?: string; name?: string | null; contact?: string | null; membershipId?: string | null; option?: string | null } | null;
  /** The workspace's own enquiry fields, by field id. */
  customFields?: CustomValues | null;
};

/** The system sets this source for a known client; nobody picks it by hand. */
const RETURNING_SOURCE = "returning_customer";
const ROUTING = "automatic";
const UNASSIGNED = "unassigned";
const EMAIL = /^\S+@\S+\.\S+$/;
const quiet = { tooShort: () => "x", tooLong: () => "x", invalid: () => "x", notMobile: () => "x", chooseCountry: "x" };

type Identity = { kind: "existing"; partyId: string; name: string } | { kind: "new" } | null;

/**
 * LF-1: the staff enquiry form. The mobile comes first and is matched as it is typed, so an existing
 * client is recognised while they are on the phone. The required fields come next; everything
 * else waits under More details. Also edits an enquiry's details.
 */
export function LeadEnquiryForm({ initialData, existing, prefill, onClose, onSaved, onOpenLead }: {
  initialData: LeadsPageData; existing?: EditableEnquiry; onClose: () => void;
  /** A new enquiry started from somewhere else (a chat): the person, the channel and a summary. */
  prefill?: { party: LeadContact; channel?: string; summary?: string };
  onSaved: (leadId: string, reference?: string) => Promise<void>;
  /** Opens an existing enquiry instead of creating a new one. */
  onOpenLead?: (leadId: string) => void;
}) {
  const t = useT();
  const areaLabel = administrativeAreaLabel(countryFromLocale(initialData.defaultLocale));
  const options = initialData.leadOptions;
  const fields = enquiryFields(initialData.enquiryFields, areaLabel);
  const shown = (key: string) => isShown(fields, key);
  const hasRegions = Boolean(options?.emirates.length);
  const [customValues, setCustomValues] = useState<CustomValues>(() => ({ ...(existing?.customFields ?? {}) }));
  const [requestId] = useState(() => crypto.randomUUID());
  const [contact, setContact] = useState<LeadContact>(() => {
    const saved = existing?.party ?? prefill?.party ?? { displayName: "" };
    const fallback = phoneCountry(undefined, initialData.defaultLocale) ?? "";
    return {
      ...saved,
      mobileCountryCode: saved.mobileCountryCode ?? countryForPhone(saved.mobile) ?? saved.phoneCountryCode ?? fallback,
      phoneCountryCode: saved.phoneCountryCode ?? countryForPhone(saved.phone) ?? fallback,
    };
  });
  const [serviceType, setServiceType] = useState(existing?.serviceType ?? options?.enquiryTypes.find(item => item.id === "not_sure")?.id ?? options?.enquiryTypes[0]?.id ?? "");
  const [summary, setSummary] = useState(existing?.summary ?? prefill?.summary ?? "");
  const [details, setDetails] = useState<EnquiryDetails>(existing?.details ?? {});
  const areaOptions = options?.areas?.[details.emirate ?? ""] ?? [];
  const [customAreaSelected, setCustomAreaSelected] = useState(() => Boolean(existing?.details?.area && !(options?.areas?.[existing.details.emirate ?? ""] ?? []).some(item => item.id === existing.details?.area)));
  const areaChoice = customAreaSelected ? "other" : details.area ?? "";
  // No silent default: the person says where it came from. A chat already says it (e.g. WhatsApp), so its enquiry starts there.
  const chatSource = prefill?.channel ? (options?.sources.find(s => s.id === "company" && options.channels[s.id]?.some(c => c.id === prefill.channel))
    ?? options?.sources.find(s => options.channels[s.id]?.some(c => c.id === prefill.channel)))?.id : undefined;
  const [source, setSource] = useState(existing?.source ?? chatSource ?? "");
  const [channel, setChannel] = useState(existing?.channel ?? (chatSource ? options?.channels[chatSource]?.find(c => c.id === prefill?.channel)?.id : undefined) ?? "");
  const channelItems = options?.channels[source] ?? [];
  // Only a real correction is sent, so an older source that is no longer offered stays as it was.
  const sourceChanged = Boolean(existing) && (source !== (existing?.source ?? "") || channel !== (existing?.channel ?? ""));
  const [referral, setReferral] = useState({ name: existing?.referral?.name ?? "", contact: existing?.referral?.contact ?? "", membershipId: existing?.referral?.membershipId ?? "", option: existing?.referral?.option ?? "" });
  const referralKind = source !== "referral" ? null : channel === "internal" || channel === "broker" || channel === "partner" ? channel : channel ? "external" : null;
  const referralBody = () => referralKind === "external" ? { name: referral.name, contact: referral.contact || undefined }
    : referralKind === "internal" ? { membershipId: referral.membershipId } : referralKind ? { option: referral.option } : undefined;
  const roles = initialData.currentRoles ?? [];
  const roleLimited = (id: string) => Boolean(options?.sources.find(item => item.id === id)?.allowedRoles?.length);
  // A source limited to roles is offered only to people holding one (owners and admins always).
  // In one role vocabulary: any case, a role or its team (sourceAllowedFor).
  const sourceItems = (options?.sources ?? []).filter((item) => item.id === existing?.source || (item.id !== RETURNING_SOURCE && sourceAllowedFor(item, roles)));

  // Owner: me for what I bring in myself, routing for the company's enquiries.
  const me = initialData.currentMembershipId;
  const ownerChoices = salesOwnerChoices(initialData).filter(member => initialData.canAssign !== false || member.id === me);
  const meCanOwn = ownerChoices.some(member => member.id === me);
  const routingConfigured = initialData.assignmentPolicies.some(policy => policy.status === "active") || initialData.queues.some(queue => queue.status === "active" && queue.isFallback);
  const defaultOwner = (forSource: string) => meCanOwn && (roleLimited(forSource) || !routingConfigured) ? me! : routingConfigured ? ROUTING : meCanOwn ? me! : UNASSIGNED;
  const [owner, setOwnerChoice] = useState(() => defaultOwner(existing?.source ?? ""));
  const ownerTouched = useRef(false);
  const [queueId, setQueue] = useState("");

  const [savedId, setSavedId] = useState<string>();
  const [more, setMore] = useState(() => Boolean(existing && (existing.party.email || existing.party.company || existing.party.phone || existing.summary || existing.details?.budgetRange || existing.details?.campaign || existing.details?.internalNotes)));

  // Who already has this mobile or email (LF-1). Results belong to the query that found them.
  const [found, setFound] = useState<{ key: string; matches: ClientMatch[] }>({ key: "", matches: [] });
  const [checkingKey, setCheckingKey] = useState("");
  const [chosen, setIdentity] = useState<Identity>(null);
  const mobileCountry = contact.mobileCountryCode ?? "";
  const mobile = contact.mobile?.trim() ?? "";
  const email = contact.email?.trim() ?? "";
  const matchQuery = useMemo(() => {
    if (existing) return null;
    const fullMobile = mobile && !phoneProblem(mobile, mobileCountry, quiet, { mobile: true }) ? toE164(mobile, mobileCountry) ?? "" : "";
    const validEmail = EMAIL.test(email) ? email : "";
    return fullMobile || validEmail ? { mobile: fullMobile || undefined, email: validEmail || undefined } : null;
  }, [existing, mobile, mobileCountry, email]);
  const matchKey = matchQuery ? JSON.stringify(matchQuery) : "";
  const matches = matchKey && found.key === matchKey ? found.matches : [];
  const checking = Boolean(matchKey) && checkingKey === matchKey;
  // A different set of people needs a fresh answer.
  const identity: Identity = chosen?.kind === "existing" ? (matches.some(match => match.partyId === chosen.partyId) ? chosen : null)
    : chosen?.kind === "new" && matches.length ? chosen : null;
  useEffect(() => {
    if (!matchKey) return;
    const query = JSON.parse(matchKey) as { mobile?: string; email?: string };
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCheckingKey(matchKey);
      findContactMatches(initialData.workspaceId, query, controller.signal)
        .then(result => setFound({ key: matchKey, matches: Array.isArray(result?.matches) ? result.matches : [] }))
        .catch(() => { if (!controller.signal.aborted) setFound({ key: matchKey, matches: [] }); })
        .finally(() => { if (!controller.signal.aborted) setCheckingKey(""); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [matchKey, initialData.workspaceId]);

  const set = (key: keyof LeadContact) => (value: string) => setContact(previous => ({ ...previous, [key]: value }));
  const setDetail = (key: keyof EnquiryDetails) => (value: string) => setDetails(previous => ({ ...previous, [key]: value }));
  const chooseSource = (value: string) => {
    setSource(value);
    const channels = options?.channels[value] ?? [];
    setChannel(channels.length === 1 ? channels[0].id : "");
    if (!existing && !ownerTouched.current) setOwnerChoice(defaultOwner(value));
  };
  const formId = existing ? `edit-enquiry-${existing.id}` : "create-crm-lead";
  const name = identity?.kind === "existing" ? identity.name : contact.displayName;

  const save = async () => {
    if (savedId) { await onSaved(savedId); return; }
    if (!existing && matches.length && !identity) throw new Error(t("Choose the existing client or Different person."));
    if (!name.trim()) throw new Error(t("Enter a customer name."));
    if (!contact.mobile?.trim()) throw new Error(t("Enter a mobile number."));
    if (hasRegions && !details.emirate?.trim()) throw new Error(t("Select the {area}.", { area: translateKnown(t, areaLabel).toLowerCase() }));
    if (details.emirate !== "other" && customAreaSelected && !details.area?.trim()) throw new Error(t("Enter the area name."));
    if (!source) throw new Error(t("Choose where this enquiry came from."));
    if (!channel) throw new Error(t("Choose the channel for this source."));
    if (options?.customerTypes.length && shown("customerType") && !details.customerType) throw new Error(t("Choose the client type."));
    if (!existing && !owner) throw new Error(t("Choose an owner, routing, or leave unassigned."));
    const enquiryDetails = Object.fromEntries(["emirate", "area", "location", "customerType", "budgetRange", "campaign", "internalNotes"].map(key => [key, details[key as keyof EnquiryDetails] ?? ""]));
    const referralChanged = Boolean(existing) && JSON.stringify(referralBody()) !== JSON.stringify(existing?.referral ? { ...(existing.referral.name ? { name: existing.referral.name } : {}), ...(existing.referral.contact ? { contact: existing.referral.contact } : {}), ...(existing.referral.membershipId ? { membershipId: existing.referral.membershipId } : {}), ...(existing.referral.option ? { option: existing.referral.option } : {}) } : undefined);
    const assignment = owner === ROUTING ? { mode: "automatic" } : owner === UNASSIGNED ? { mode: "unassigned" } : { mode: "manual", ownerMembershipId: owner, ...(queueId ? { queueId } : {}) };
    const body = existing ? { version: existing.version, serviceType, summary, party: contact, details: enquiryDetails, ...(sourceChanged ? { source, channel } : {}), ...(referralKind && (sourceChanged || referralChanged) ? { referral: referralBody() } : {}) }
      : { workspaceId: initialData.workspaceId, requestId, ...contact, displayName: name, serviceType, summary, source, channel, details: enquiryDetails, ...(referralKind ? { referral: referralBody() } : {}), assignment,
          ...(identity?.kind === "existing" ? { identity: "existing", partyId: identity.partyId } : identity?.kind === "new" ? { identity: "new" } : {}) };
    const response = await fetch(existing ? `/api/workspace/crm/data/leads/${existing.id}/details?workspaceId=${initialData.workspaceId}` : "/api/workspace/crm/leads", {
      method: existing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(Array.isArray(result.message) ? result.message.join(". ") : result.message ?? t("The enquiry could not be saved.")), { status: response.status });
    const id = existing?.id ?? result.leadId;
    if (!id) throw new Error(t("The enquiry was received. Refresh the enquiries list to check its status."));
    setSavedId(id);
    await saveLeadFields(initialData.workspaceId, id, changedValues(existing?.customFields, customValues));
    await onSaved(id, !existing && typeof result.reference === "string" ? result.reference : undefined);
  };

  const ownerItems = [
    ...(routingConfigured ? [{ id: ROUTING, label: t("Use routing rules") }] : []),
    ...ownerChoices.map(member => ({ id: member.id, label: member.id === me ? t("Me ({name})", { name: member.displayName || member.email }) : member.displayName || member.email })),
    { id: UNASSIGNED, label: t("Leave unassigned") },
  ];
  const locked = Boolean(savedId);
  // Unsaved work stays on this device: a new enquiry per workspace, an edit per enquiry and version.
  const snapshot = { contact, serviceType, summary, details, customAreaSelected, source, channel, referral, owner, queueId, customValues };
  const [start] = useState(() => JSON.stringify(snapshot));
  const dirty = !savedId && JSON.stringify(snapshot) !== start;
  const draft = useFormDraft(savedId ? null : existing ? `${initialData.workspaceId}/crm/enquiry/${existing.id}@${existing.version}` : `${initialData.workspaceId}/crm/enquiry/new`, snapshot, {
    isDirty: dirty,
    restore: (saved) => {
      setContact(saved.contact); setServiceType(saved.serviceType); setSummary(saved.summary); setDetails(saved.details); setCustomAreaSelected(saved.customAreaSelected);
      setSource(saved.source); setChannel(saved.channel); setReferral(saved.referral); setOwnerChoice(saved.owner); setQueue(saved.queueId); setCustomValues(saved.customValues);
      if (saved.owner !== snapshot.owner) ownerTouched.current = true;
    },
  });
  // A new enquiry can start from a pasted WhatsApp message, email or card: Woddy proposes, the person checks.
  const aiReady = useAiReady(existing ? null : initialData.workspaceId);
  const fillFields = [
    { key: "customerName", label: t("Customer name") }, { key: "mobile", label: t("Mobile") }, { key: "phone", label: t("Phone") }, { key: "email", label: t("Email") },
    { key: "company", label: t("Company") }, { key: "jobPosition", label: t("Job position") }, { key: "website", label: t("Website") }, { key: "address", label: t("Address") },
    { key: "area", label: t("Area / city") }, { key: "summary", label: t("Project description") },
  ];
  const applyFill = (found: Record<string, string>) => {
    setContact((current) => ({ ...current, ...(found.customerName ? { displayName: found.customerName } : {}), ...(found.mobile ? { mobile: found.mobile } : {}), ...(found.phone ? { phone: found.phone } : {}),
      ...(found.email ? { email: found.email } : {}), ...(found.company ? { company: found.company } : {}), ...(found.jobPosition ? { jobPosition: found.jobPosition } : {}),
      ...(found.website ? { website: found.website } : {}), ...(found.address ? { address: found.address } : {}) }));
    if (found.summary) setSummary(found.summary);
    if (found.area) {
      const option = areaOptions.find((item) => item.label.toLocaleLowerCase() === found.area.toLocaleLowerCase());
      if (option) setDetails((current) => ({ ...current, area: option.id }));
      else { setCustomAreaSelected(areaOptions.length > 0); setDetails((current) => ({ ...current, area: found.area })); }
    }
    if (found.email || found.phone || found.company || found.jobPosition || found.website || found.address || found.summary) setMore(true);
  };
  const moreFilled = [contact.email, details.budgetRange, summary, contact.company, contact.jobPosition, contact.phone, contact.website, contact.address, details.campaign, details.internalNotes].filter(Boolean).length;
  return <FormDialog draft={draft} errorTitle={t("Enquiry not saved")} isDirty={dirty} isSubmitDisabled={!options} onClose={onClose} onSubmit={save} size="lg"
    title={existing ? t("Edit enquiry") : t("New enquiry")} description={existing?.reference ?? undefined} formClassName={styles.leadForm} formId={formId}
    submitLabel={savedId ? t("Refresh enquiry") : existing ? t("Save changes") : t("Create enquiry")}
    lead={<>
      {!options && <Callout title={t("Enquiry options unavailable")} tone="warning">{t("Refresh Enquiries to load the current configuration.")}</Callout>}
      {aiReady && !locked ? <FillWithWoddy fields={fillFields} onApply={applyFill}
        onExtract={async ({ text, image }) => fillWithWoddy(initialData.workspaceId, "enquiry", { ...(text ? { text } : {}), ...(image ? { image: await imageForWoddy(image) } : {}) })} /> : null}
    </>}>
      <fieldset className={styles.enquiryFields} disabled={locked}>
        <CrmPhoneField label={t("Mobile")} required value={contact.mobile ?? ""} onChange={set("mobile")} countryCode={contact.mobileCountryCode ?? ""} onCountryChange={set("mobileCountryCode")} locale={initialData.defaultLocale} />
        {!existing && matches.length > 0 ? <section className={styles.clientMatch} aria-label={t("Existing client?")} aria-live="polite">
          <strong>{t("Existing client?")}</strong>
          <ClientMatchList label={t("Clients with this mobile or email")} matches={matches} actions={(match) => <>
            {match.open && match.leadId && onOpenLead ? <Button size="compact" isDisabled={locked} onPress={() => onOpenLead(match.leadId!)}>{t("Open it")}</Button> : null}
            <Button size="compact" variant={identity?.kind === "existing" && identity.partyId === match.partyId ? "primary" : "secondary"} isDisabled={locked}
              aria-pressed={identity?.kind === "existing" && identity.partyId === match.partyId}
              onPress={() => setIdentity({ kind: "existing", partyId: match.partyId, name: match.name })}>{match.open ? t("Add to this client") : t("Add as returning")}</Button>
          </>} />
          <div><Button size="compact" variant={identity?.kind === "new" ? "primary" : "quiet"} aria-pressed={identity?.kind === "new"} isDisabled={locked} onPress={() => setIdentity({ kind: "new" })}>{t("Different person")}</Button></div>
        </section> : checking ? <p className={styles.routingHint} aria-live="polite">{t("Checking for an existing client…")}</p> : null}
        <TextInput isRequired label={t("Customer name")} value={name} isReadOnly={identity?.kind === "existing"} onChange={set("displayName")} />
        <SelectField label={t("Enquiry type")} isRequired items={withExisting(options?.enquiryTypes, existing?.serviceType ?? "")} selectedKey={serviceType || null} onSelectionChange={key => key && setServiceType(String(key))} />
        <FormRow>
          <SelectField label={t("Source")} isRequired placeholder={t("Choose source")} items={withExisting(sourceItems, existing?.source ?? "")} selectedKey={source || null} onSelectionChange={key => chooseSource(String(key ?? ""))} />
          <SelectField label={t("Channel")} isRequired isDisabled={!source} placeholder={t("Choose channel")} items={withExisting(channelItems, source === existing?.source ? existing?.channel ?? "" : "")} selectedKey={channel || null} onSelectionChange={key => setChannel(String(key ?? ""))} />
        </FormRow>
        {referralKind === "external" ? <FormRow><TextInput isRequired label={t("Referred by")} value={referral.name} onChange={value => setReferral(current => ({ ...current, name: value }))} /><TextInput label={t("Referrer contact")} value={referral.contact} onChange={value => setReferral(current => ({ ...current, contact: value }))} /></FormRow>
          : referralKind === "internal" ? <SelectField isRequired label={t("Referred by")} items={initialData.members.filter(member => member.status === "active").map(member => ({ id: member.id, label: member.displayName || member.email }))} selectedKey={referral.membershipId || null} onSelectionChange={key => setReferral(current => ({ ...current, membershipId: String(key ?? "") }))} />
          : referralKind ? <SelectField isRequired label={t("Referred by")} items={withExisting(referralKind === "broker" ? options?.referralBrokers : options?.referralPartners, existing?.referral?.option ?? "")} selectedKey={referral.option || null} onSelectionChange={key => setReferral(current => ({ ...current, option: String(key ?? "") }))} />
          : null}
        {hasRegions || shown("area") ? <FormRow>
          {hasRegions ? <SelectField label={translateKnown(t, areaLabel)} isRequired items={withExisting(options?.emirates, existing?.details?.emirate ?? "")} selectedKey={details.emirate || null} onSelectionChange={key => { setCustomAreaSelected(false); setDetails(previous => ({ ...previous, emirate: String(key ?? ""), area: "" })); }} /> : null}
          {shown("area") ? details.emirate === "other" || !areaOptions.length
            ? <TextInput label={t("Area / city")} value={details.area ?? ""} onChange={setDetail("area")} />
            : <SelectField label={t("Area")} items={[{ id: "", label: t("Not specified") }, ...areaOptions, { id: "other", label: t("Other area") }]} selectedKey={areaChoice} onSelectionChange={key => { setCustomAreaSelected(key === "other"); setDetail("area")(key === "other" ? "" : String(key ?? "")); }} /> : null}
        </FormRow> : null}
        {customAreaSelected && shown("area") ? <TextInput isRequired label={t("Area name")} value={details.area ?? ""} onChange={setDetail("area")} /> : null}
        {shown("customerType") && Boolean(options?.customerTypes.length || existing?.details?.customerType) && <SelectField label={t("Client type")} isRequired={Boolean(options?.customerTypes.length)} items={withExisting(options?.customerTypes, existing?.details?.customerType ?? "")} selectedKey={details.customerType || null} onSelectionChange={key => setDetail("customerType")(String(key ?? ""))} />}
        {!existing ? <SelectField label={t("Owner")} isRequired items={ownerItems} selectedKey={owner || null} onSelectionChange={key => { ownerTouched.current = true; setOwnerChoice(String(key ?? "")); }} /> : null}

        <MoreDetails filled={moreFilled} isOpen={more} onOpenChange={setMore}>
          {shown("email") ? <TextInput label={t("Email")} inputType="email" value={contact.email ?? ""} onChange={set("email")} /> : null}
          {shown("budgetRange") ? <SelectField label={t("Budget range")} items={[{ id: "", label: t("Not provided") }, ...withExisting(options?.budgetRanges, existing?.details?.budgetRange ?? "")]} selectedKey={details.budgetRange ?? ""} onSelectionChange={key => setDetail("budgetRange")(String(key ?? ""))} /> : null}
          {shown("summary") ? <TextAreaField label={t("Project description")} value={summary} onChange={setSummary} placeholder={t("What would the customer like to do?")} /> : null}
          <FormRow><TextInput label={t("Company")} value={contact.company ?? ""} onChange={set("company")} /><TextInput label={t("Job position")} value={contact.jobPosition ?? ""} onChange={set("jobPosition")} /></FormRow>
          <FormRow><CrmPhoneField label={t("Phone")} kind="any" value={contact.phone ?? ""} onChange={set("phone")} countryCode={contact.phoneCountryCode ?? ""} onCountryChange={set("phoneCountryCode")} locale={initialData.defaultLocale} /><TextInput label={t("Website")} value={contact.website ?? ""} onChange={set("website")} /></FormRow>
          <TextInput label={t("Address")} value={contact.address ?? ""} onChange={set("address")} />
          <TextInput label={t("Campaign")} value={details.campaign ?? ""} onChange={setDetail("campaign")} />
          {!existing && owner !== ROUTING && owner !== UNASSIGNED ? <SelectField label={t("Sales team")} items={[{ id: "", label: t("No team selected") }, ...initialData.queues.filter(q => q.status === "active").map(q => ({ id: q.id, label: q.name }))]} selectedKey={queueId} onSelectionChange={key => setQueue(String(key ?? ""))} /> : null}
          <TextAreaField label={t("Internal notes")} value={details.internalNotes ?? ""} onChange={setDetail("internalNotes")} />
          <EnquiryCustomInputs className={styles.formColumns} fields={fields} values={customValues} onChange={(id, value) => setCustomValues(current => ({ ...current, [id]: value }))} />
        </MoreDetails>
      </fieldset>
  </FormDialog>;
}

function withExisting(options: LeadOptions["enquiryTypes"] | undefined, value: string) {
  return options?.some(item => item.id === value) || !value ? options ?? [] : [...(options ?? []), { id: value, label: value.replaceAll("_", " ") }];
}
