"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button, Callout, ControlledModalDialog, SelectField, TextInput, TextAreaField } from "@/design-system";
import { salesOwnerChoices, type LeadsPageData } from "@/lib/crm/leads";
import { sourceAllowedFor, type EnquiryDetails, type LeadContact, type LeadOptions } from "@/lib/crm/lead-options";
import { countryForPhone, phoneCountry } from "@/lib/crm/phone";
import { CrmPhoneField } from "./crm-phone-field";
import { administrativeAreaLabel, countryFromLocale } from "@/lib/workspace/region-labels";
import { enquiryFields, isShown } from "@/lib/crm/enquiry-fields";
import { changedValues, EnquiryCustomInputs, saveLeadFields, type CustomValues } from "./enquiry-custom-inputs";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import styles from "./leads-page.module.css";

export type EditableEnquiry = {
  id: string; version: number; reference?: string; title?: string; summary?: string;
  serviceType?: string; details?: EnquiryDetails; party: LeadContact; source?: string; channel?: string;
  referral?: { kind?: string; name?: string | null; contact?: string | null; membershipId?: string | null; option?: string | null } | null;
  /** The workspace's own enquiry fields, by field id. */
  customFields?: CustomValues | null;
};

export function LeadEnquiryForm({ initialData, existing, onClose, onSaved }: {
  initialData: LeadsPageData; existing?: EditableEnquiry; onClose: () => void;
  onSaved: (leadId: string) => Promise<void>;
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
    const saved = existing?.party ?? { displayName: "" };
    const fallback = phoneCountry(undefined, initialData.defaultLocale) ?? "";
    return {
      ...saved,
      mobileCountryCode: saved.mobileCountryCode ?? countryForPhone(saved.mobile) ?? saved.phoneCountryCode ?? fallback,
      phoneCountryCode: saved.phoneCountryCode ?? countryForPhone(saved.phone) ?? fallback,
    };
  });
  const [serviceType, setServiceType] = useState(existing?.serviceType ?? options?.enquiryTypes.find(item => item.id === "not_sure")?.id ?? options?.enquiryTypes[0]?.id ?? "");
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [details, setDetails] = useState<EnquiryDetails>(existing?.details ?? {});
  const areaOptions = options?.areas?.[details.emirate ?? ""] ?? [];
  const [customAreaSelected, setCustomAreaSelected] = useState(() => Boolean(existing?.details?.area && !(options?.areas?.[existing.details.emirate ?? ""] ?? []).some(item => item.id === existing.details?.area)));
  const areaChoice = customAreaSelected ? "other" : details.area ?? "";
  const [source, setSource] = useState(existing?.source ?? options?.sources.find(s => s.id === "company")?.id ?? options?.sources[0]?.id ?? "");
  const [channel, setChannel] = useState(existing?.channel ?? options?.channels[source]?.find(c => c.id === "call")?.id ?? options?.channels[source]?.[0]?.id ?? "");
  // Only a real correction is sent, so an older source that is no longer offered stays as it was.
  const sourceChanged = Boolean(existing) && (source !== (existing?.source ?? "") || channel !== (existing?.channel ?? ""));
  const [referral, setReferral] = useState({ name: existing?.referral?.name ?? "", contact: existing?.referral?.contact ?? "", membershipId: existing?.referral?.membershipId ?? "", option: existing?.referral?.option ?? "" });
  const referralKind = source !== "referral" ? null : channel === "internal" || channel === "broker" || channel === "partner" ? channel : "external";
  const referralBody = () => referralKind === "external" ? { name: referral.name, contact: referral.contact || undefined }
    : referralKind === "internal" ? { membershipId: referral.membershipId } : referralKind ? { option: referral.option } : undefined;
  const roles = initialData.currentRoles ?? [];
  // A source limited to roles is offered only to people holding one (owners and admins always), in one role vocabulary.
  const sourceItems = (options?.sources ?? []).filter((item) => item.id === existing?.source || sourceAllowedFor(item, roles));
  const [mode, setMode] = useState("manual");
  // A salesperson who can own enquiries starts as the owner of the one they create.
  const ownerChoices = salesOwnerChoices(initialData);
  const [ownerMembershipId, setOwner] = useState(() => ownerChoices.some(member => member.id === initialData.currentMembershipId) ? initialData.currentMembershipId! : "");
  const [queueId, setQueue] = useState("");
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const [savedId, setSavedId] = useState<string>();
  const [matches, setMatches] = useState<Array<{ id: string; partyId: string; partyName: string; version: number }>>([]);
  const [matchChoice, setMatchChoice] = useState("");
  const set = (key: keyof LeadContact) => (value: string) => setContact(previous => ({ ...previous, [key]: value }));
  const setDetail = (key: keyof EnquiryDetails) => (value: string) => setDetails(previous => ({ ...previous, [key]: value }));
  const formId = existing ? `edit-enquiry-${existing.id}` : "create-crm-lead";
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (inFlight.current) return; inFlight.current = true; setSaving(true); setFailure("");
    try {
      if (savedId) { await onSaved(savedId); return; }
      if (matches.length) {
        if (!matchChoice) throw new Error(t("Choose an existing client or a different person."));
        const candidate = matches.find(item => item.id === matchChoice) ?? matches[0];
        const response = await fetch(`/api/workspace/crm/data/duplicate-candidates/${candidate.id}/review?workspaceId=${initialData.workspaceId}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: candidate.version, decision: matchChoice === "new" ? "create_new" : "attach", ...(matchChoice !== "new" ? { partyId: candidate.partyId } : {}), reason: matchChoice === "new" ? "User confirmed a different client in the enquiry form." : "User confirmed the existing client in the enquiry form." }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? t("The client could not be linked. Please retry."));
        if (!result.leadId) throw new Error(t("The enquiry was received. Refresh the enquiries list to check its status."));
        setSavedId(result.leadId);
        await saveLeadFields(initialData.workspaceId, result.leadId, changedValues(undefined, customValues));
        await onSaved(result.leadId); return;
      }
      if (!contact.displayName.trim()) throw new Error(t("Enter a customer name."));
      if (!contact.mobile?.trim()) throw new Error(t("Enter a mobile number."));
      if (hasRegions && !details.emirate?.trim()) throw new Error(t("Select the {area}.", { area: translateKnown(t, areaLabel).toLowerCase() }));
      if (details.emirate !== "other" && customAreaSelected && !details.area?.trim()) throw new Error(t("Enter the area name."));
      if (!existing && mode === "manual" && !ownerMembershipId) throw new Error(t("Choose a salesperson, automatic routing, or leave unassigned."));
      const enquiryDetails = Object.fromEntries(["emirate", "area", "location", "customerType", "budgetRange", "campaign", "internalNotes"].map(key => [key, details[key as keyof EnquiryDetails] ?? ""]));
      if (!source) throw new Error(t("Choose where this enquiry came from."));
      if (!channel) throw new Error(t("Choose the channel for this source."));
      if (shown("customerType") && options?.customerTypes.length && !details.customerType) throw new Error(t("Choose the client type."));
      const referralChanged = Boolean(existing) && JSON.stringify(referralBody()) !== JSON.stringify(existing?.referral ? { ...(existing.referral.name ? { name: existing.referral.name } : {}), ...(existing.referral.contact ? { contact: existing.referral.contact } : {}), ...(existing.referral.membershipId ? { membershipId: existing.referral.membershipId } : {}), ...(existing.referral.option ? { option: existing.referral.option } : {}) } : undefined);
      const body = existing ? { version: existing.version, serviceType, summary, party: contact, details: enquiryDetails, ...(sourceChanged ? { source, channel } : {}), ...(referralKind && (sourceChanged || referralChanged) ? { referral: referralBody() } : {}) }
        : { workspaceId: initialData.workspaceId, requestId, ...contact, serviceType, summary, source, channel, details: enquiryDetails, ...(referralKind ? { referral: referralBody() } : {}),
            assignment: { mode, ...(mode === "manual" ? { ownerMembershipId, ...(queueId ? { queueId } : {}) } : {}) } };
      const response = await fetch(existing ? `/api/workspace/crm/data/leads/${existing.id}/details?workspaceId=${initialData.workspaceId}` : "/api/workspace/crm/leads", {
        method: existing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(". ") : result.message ?? t("The enquiry could not be saved."));
      if (result.status === "duplicate_candidate") {
        const response = await fetch(`/api/workspace/crm/data/intake-events/${result.intakeEventId}?workspaceId=${initialData.workspaceId}`);
        const intake = await response.json();
        if (!response.ok) throw new Error(t("Client matches could not be loaded. Try saving again."));
        const pending = (intake.candidates ?? []).filter((item: { status: string }) => item.status === "pending");
        if (!pending.length) throw new Error(t("This enquiry has already been reviewed. Refresh the enquiries list to check its status."));
        setMatches(pending); setMatchChoice(""); return;
      }
      const id = existing?.id ?? result.leadId;
      if (!id) throw new Error(t("The enquiry was received. Refresh the enquiries list to check its status."));
      setSavedId(id);
      await saveLeadFields(initialData.workspaceId, id, changedValues(existing?.customFields, customValues));
      await onSaved(id);
    } catch (error) { setFailure(error instanceof Error ? error.message : t("The enquiry could not be saved.")); }
    finally { inFlight.current = false; setSaving(false); }
  };
  return <ControlledModalDialog isOpen isDismissable={!saving} onOpenChange={open => { if (!open && !saving) onClose(); }} size="lg"
    title={existing ? t("Edit enquiry") : t("New enquiry")} description={existing?.reference ?? undefined}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose} isDisabled={saving}>{t("Cancel")}</Button><Button form={formId} type="submit" variant="primary" isDisabled={!options} isLoading={saving}>{savedId ? t("Refresh enquiry") : existing ? t("Save changes") : matches.length ? t("Save enquiry") : t("Create enquiry")}</Button></div>}>
    <form id={formId} className={styles.leadForm} onSubmit={save}>
      {failure && <Callout title={t("Enquiry not saved")} tone="danger">{failure}</Callout>}
      {!options && <Callout title={t("Enquiry options unavailable")} tone="warning">{t("Refresh Enquiries to load the current configuration.")}</Callout>}
      {matches.length > 0 && <section className={styles.clientMatch} aria-label={t("Choose client")}>
        <strong>{t("Is this an existing client?")}</strong>
        <p>{t("Your enquiry is saved as a draft. Choose who it belongs to; a matching name does not always mean the same person.")}</p>
        <SelectField label={t("Client for this enquiry")} items={[...matches.map(item => ({ id: item.id, label: item.partyName })), { id: "new", label: t("Different person — create a new client") }]} selectedKey={matchChoice || null} onSelectionChange={key => setMatchChoice(String(key ?? ""))} isDisabled={saving || Boolean(savedId)} />
      </section>}
      <fieldset className={styles.enquiryFields} disabled={saving || Boolean(savedId) || matches.length > 0}>
        <div className={styles.formColumns}><TextInput isRequired label={t("Customer name")} value={contact.displayName} onChange={set("displayName")} /><CrmPhoneField label={t("Mobile")} required value={contact.mobile ?? ""} onChange={set("mobile")} countryCode={contact.mobileCountryCode ?? ""} onCountryChange={set("mobileCountryCode")} locale={initialData.defaultLocale} /></div>
        {shown("email") || hasRegions ? <div className={styles.formColumns}>{shown("email") ? <TextInput label={t("Email")} inputType="email" value={contact.email ?? ""} onChange={set("email")} /> : null}{hasRegions ? <SelectField label={translateKnown(t, areaLabel)} isRequired items={withExisting(options?.emirates, existing?.details?.emirate ?? "")} selectedKey={details.emirate || null} onSelectionChange={key => { setCustomAreaSelected(false); setDetails(previous => ({ ...previous, emirate: String(key ?? ""), area: "" })); }} /> : null}</div> : null}
        {shown("area") ? <div className={styles.formColumns}>{details.emirate === "other" || !areaOptions.length
          ? <TextInput label={t("Area / city · optional")} value={details.area ?? ""} onChange={setDetail("area")} />
          : <><SelectField label={t("Area · optional")} items={[{ id: "", label: t("Not specified") }, ...areaOptions, { id: "other", label: t("Other area") }]} selectedKey={areaChoice} onSelectionChange={key => { setCustomAreaSelected(key === "other"); setDetail("area")(key === "other" ? "" : String(key ?? "")); }} />{customAreaSelected ? <TextInput isRequired label={t("Area name")} value={details.area ?? ""} onChange={setDetail("area")} /> : null}</>}</div> : null}
        <div className={styles.formColumns}><SelectField label={t("Enquiry type")} isRequired items={withExisting(options?.enquiryTypes, existing?.serviceType ?? "")} selectedKey={serviceType} onSelectionChange={key => key && setServiceType(String(key))} />{shown("budgetRange") ? <SelectField label={t("Budget range · optional")} items={[{ id: "", label: t("Not provided") }, ...withExisting(options?.budgetRanges, existing?.details?.budgetRange ?? "")]} selectedKey={details.budgetRange ?? ""} onSelectionChange={key => setDetail("budgetRange")(String(key ?? ""))} /> : null}</div>
        {shown("customerType") && Boolean(options?.customerTypes.length || existing?.details?.customerType) && <SelectField label={t("Client type")} isRequired={Boolean(options?.customerTypes.length)} items={withExisting(options?.customerTypes, existing?.details?.customerType ?? "")} selectedKey={details.customerType || null} onSelectionChange={key => setDetail("customerType")(String(key ?? ""))} />}
        {shown("summary") ? <TextAreaField label={t("Project description · optional")} value={summary} onChange={setSummary} placeholder={t("What would the customer like to do?")} /> : null}
        <EnquiryCustomInputs className={styles.formColumns} fields={fields} values={customValues} onChange={(id, value) => setCustomValues(current => ({ ...current, [id]: value }))} />
        <div className={styles.formColumns}><SelectField label={t("Source")} isRequired items={withExisting(sourceItems, existing?.source ?? "")} selectedKey={source} onSelectionChange={key => { const value = String(key); setSource(value); setChannel(options?.channels[value]?.[0]?.id ?? ""); }} /><SelectField label={t("Channel")} isRequired items={withExisting(options?.channels[source], source === existing?.source ? existing?.channel ?? "" : "")} selectedKey={channel} onSelectionChange={key => key && setChannel(String(key))} /></div>
        {referralKind === "external" ? <div className={styles.formColumns}><TextInput isRequired label={t("Referred by")} value={referral.name} onChange={value => setReferral(current => ({ ...current, name: value }))} /><TextInput label={t("Referrer contact · optional")} value={referral.contact} onChange={value => setReferral(current => ({ ...current, contact: value }))} /></div>
          : referralKind === "internal" ? <SelectField isRequired label={t("Referred by")} items={initialData.members.filter(member => member.status === "active").map(member => ({ id: member.id, label: member.displayName || member.email }))} selectedKey={referral.membershipId || null} onSelectionChange={key => setReferral(current => ({ ...current, membershipId: String(key ?? "") }))} />
          : referralKind ? <SelectField isRequired label={t("Referred by")} items={withExisting(referralKind === "broker" ? options?.referralBrokers : options?.referralPartners, existing?.referral?.option ?? "")} selectedKey={referral.option || null} onSelectionChange={key => setReferral(current => ({ ...current, option: String(key ?? "") }))} />
          : null}
        {!existing && <>
          <div className={styles.formColumns}><SelectField label={t("Assignment")} items={[{ id: "manual", label: t("Choose sales owner") }, { id: "automatic", label: t("Use routing rules") }, { id: "unassigned", label: t("Leave unassigned") }]} selectedKey={mode} onSelectionChange={key => key && setMode(String(key))} />
            {mode === "manual" ? <SelectField isRequired label={t("Sales owner")} items={ownerChoices.map(member => ({ id: member.id, label: member.displayName || member.email }))} selectedKey={ownerMembershipId || null} onSelectionChange={key => setOwner(String(key ?? ""))} /> : <p className={styles.routingHint}>{mode === "automatic" ? t("Uses the matching rule or default team and available capacity.") : t("The enquiry stays visible in Unassigned.")}</p>}
          </div>
        </>}
        <section className={styles.moreDetails} aria-label={t("Additional details")}>
          <h3>{t("Additional details")}</h3>
          <div className={styles.leadForm}>
            <TextInput label={t("Enquiry reference")} value={existing?.reference ?? t("Assigned after save")} isReadOnly description={t("The system assigns this ID. The enquiry title follows the customer name and property location.")} />
            <div className={styles.formColumns}><TextInput label={t("Company")} value={contact.company ?? ""} onChange={set("company")} /><TextInput label={t("Job position")} value={contact.jobPosition ?? ""} onChange={set("jobPosition")} /></div>
            <div className={styles.formColumns}><CrmPhoneField label={t("Phone")} value={contact.phone ?? ""} onChange={set("phone")} countryCode={contact.phoneCountryCode ?? ""} onCountryChange={set("phoneCountryCode")} locale={initialData.defaultLocale} /><TextInput label={t("Website")} value={contact.website ?? ""} onChange={set("website")} /></div>
            <TextInput label={t("Address")} value={contact.address ?? ""} onChange={set("address")} />
            <div className={styles.formColumns}><TextInput label={t("Campaign")} value={details.campaign ?? ""} onChange={setDetail("campaign")} /></div>
            {!existing && mode === "manual" && <SelectField label={t("Sales team · optional")} items={[{ id: "", label: t("No team selected") }, ...initialData.queues.filter(q => q.status === "active").map(q => ({ id: q.id, label: q.name }))]} selectedKey={queueId} onSelectionChange={key => setQueue(String(key ?? ""))} />}
            <TextAreaField label={t("Internal notes")} value={details.internalNotes ?? ""} onChange={setDetail("internalNotes")} />
          </div>
        </section>
        {!existing && <p className={styles.routingHint}>{t("The enquiry reference is assigned automatically.")}</p>}
      </fieldset>
    </form>
  </ControlledModalDialog>;
}

function withExisting(options: LeadOptions["enquiryTypes"] | undefined, value: string) {
  return options?.some(item => item.id === value) || !value ? options ?? [] : [...(options ?? []), { id: value, label: value.replaceAll("_", " ") }];
}
