"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, ComboboxField, DateField, FillWithWoddy, FormDialog, FormNotSaved, FormSection, MoreDetails, PersonNameField, personNameError, readSaveProblems, SelectField, TextInput, TextAreaField, useFormDraft, type SaveProblem } from "@/design-system";
import { parseDate } from "@internationalized/date";
import { normalizePersonName } from "@wodana/contracts/person-name";
import { salesOwnerChoices, type LeadsPageData } from "@/lib/crm/leads";
import { floorPlanReady, sourceAllowedFor, TEAM_NOT_APPLICABLE, teamRoleChoices, type EnquiryDetails, type LeadContact, type LeadOptions, type LeadTeamEntry } from "@/lib/crm/lead-options";
import { problemText, requiredBy, teamRoleLabel } from "@/lib/crm/enquiry-requirements";
import { countryForPhone, phoneCountry, phoneProblem, phoneProblemText, toE164 } from "@/lib/crm/phone";
import { findContactMatches, type ClientMatch } from "@/lib/crm/client-match";
import { CrmPhoneField } from "./crm-phone-field";
import { ClientMatchList } from "./client-match-list";
import { EnquiryFloorPlanField } from "./enquiry-floor-plan-field";
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
  /** PLM-100: the team tagged on the enquiry (a member per role, or Not applicable). */
  team?: LeadTeamEntry[] | null;
  /** PLM-024: false when this person can't read the internal notes (the field is left out). */
  notesVisible?: boolean;
  isConverted?: boolean;
};

/** The system sets this source for a known client; nobody picks it by hand. */
const RETURNING_SOURCE = "returning_customer";
const ROUTING = "automatic";
const UNASSIGNED = "unassigned";
const EMAIL = /^\S+@\S+\.\S+$/;
/** Fields that sit under More details. */
const IN_MORE_DETAILS = new Set(["email", "budgetRange", "floorPlan", "summary", "phone", "address", "company", "jobPosition", "website", "campaign", "targetCompletion"]);
const quiet = { mobile: () => "x", phone: () => "x", chooseCountry: "x" };

type Identity = { kind: "existing"; partyId: string; name: string } | { kind: "new" } | null;

/**
 * LF-1: the staff enquiry form. The mobile comes first and is matched as it is typed, so an existing
 * client is recognised while they are on the phone. The required fields come next; everything
 * else waits under More details. Also edits an enquiry's details.
 */
export function LeadEnquiryForm({ initialData, existing, prefill, onClose, onSaved, onOpenLead, initialProblems, focusField, highlightFields, gate }: {
  initialData: LeadsPageData; existing?: EditableEnquiry; onClose: () => void;
  /** What the enquiry still needs (before converting), listed when the form opens to complete it. */
  initialProblems?: SaveProblem[];
  /** When redirected from a blocked gate (e.g. intro booking): the field to focus and highlight. */
  focusField?: string;
  highlightFields?: string[];
  gate?: string;
  /**
   * A new enquiry started from somewhere else (a chat): the person, the channel and a summary. `partyId` is the chat's
   * own contact, already chosen as the client (the Sales Admin isn't asked "Existing client?" about the person writing).
   */
  prefill?: { party: LeadContact; channel?: string; summary?: string; partyId?: string;
    /** The chat's own contact, also while it is still named after its number: with no enquiries yet it is a first-time client, never a returning one. */
    contactPartyId?: string };
  onSaved: (leadId: string, reference?: string) => Promise<void>;
  /** Opens an existing enquiry instead of creating a new one. */
  onOpenLead?: (leadId: string) => void;
}) {
  const t = useT();
  // Editing an enquiry: the client's name and phones stay as they are unless this person may change them (Sales admins).
  const identityLocked = Boolean(existing) && initialData.canChangeIdentity === false;
  const identityHint = t("Only Sales admins can change the client's name or phone");
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
  // PLM-100: the team roles this enquiry type asks for come from its own steps; each is a member or Not applicable.
  const teamRoles = options?.teamRoles?.[serviceType] ?? [];
  const [team, setTeam] = useState<Record<string, string>>(() => Object.fromEntries((existing?.team ?? []).map(entry => [entry.role, entry.notApplicable ? TEAM_NOT_APPLICABLE : entry.membershipId ?? ""])));
  // Each role offers the people who can hold it (the designers for Designer), never the sales people as a stand-in.
  const directory = initialData.members.filter(member => member.status === "active").map(member => ({ id: member.id, label: member.displayName || member.email }));
  const teamItems = (role: string) => {
    const tagged = existing?.team?.find(entry => entry.role === role && entry.membershipId);
    return teamRoleChoices(options, role, directory, tagged ? { id: tagged.membershipId!, label: tagged.name ?? "" } : null, t("Not applicable"));
  };
  const teamBody = () => {
    const entries = teamRoles.filter(role => team[role] !== undefined && (team[role] || existing?.team?.some(entry => entry.role === role)))
      .map(role => ({ role, ...(team[role] === TEAM_NOT_APPLICABLE ? { notApplicable: true } : team[role] ? { membershipId: team[role] } : {}) }));
    return entries.length ? { team: entries } : {};
  };
  const effectiveGate: "create" | "convert" | "book_intro" =
    gate === "book_intro" || gate === "convert" || gate === "create"
      ? gate
      : existing?.isConverted ? "book_intro" : existing ? "convert" : "create";
  // PLM-096: what this enquiry type requires at this gate.
  const needed = (key: string) => {
    if (initialProblems?.some(item => item.key === key)) return true;
    if (highlightFields?.includes(key)) return true;
    return requiredBy(options, serviceType, key, effectiveGate);
  };
  const [summary, setSummary] = useState(existing?.summary ?? prefill?.summary ?? "");
  // Area / city takes any typed place and suggests the region's areas: the ones used here most first, then the listed ones.
  // An area from the workspace's own list is saved by its id, as before, and shows by its name.
  const listedAreas = (region?: string) => options?.areas?.[region ?? ""] ?? [];
  const [details, setDetails] = useState<EnquiryDetails>(() => existing?.details?.area
    ? { ...existing.details, area: listedAreas(existing.details.emirate).find(item => item.id === existing.details?.area)?.label ?? existing.details.area } : existing?.details ?? {});
  const areaItems = (options?.areaSuggestions?.[details.emirate ?? ""] ?? listedAreas(details.emirate).map(item => item.label)).map(name => ({ id: name, label: name }));
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
  const [more, setMore] = useState(() => Boolean(
    initialProblems?.length ||
    highlightFields?.some(key => IN_MORE_DETAILS.has(key)) ||
    (focusField && IN_MORE_DETAILS.has(focusField)) ||
    (existing && (existing.party.email || existing.party.company || existing.party.phone || existing.summary || existing.details?.budgetRange || existing.details?.campaign || existing.details?.internalNotes))
  ));

  useEffect(() => {
    const targetKey = focusField ?? highlightFields?.[0];
    if (!targetKey) return;
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-problem-key="${CSS.escape(targetKey)}"]`)
        ?? document.querySelector<HTMLElement>(`[name="${CSS.escape(targetKey)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const input = el.matches("input, select, textarea") ? el : el.querySelector<HTMLElement>("input, select, textarea, button");
        input?.focus();
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [focusField, highlightFields]);

  // Who already has this mobile or email (LF-1). Results belong to the query that found them.
  const [found, setFound] = useState<{ key: string; matches: ClientMatch[] }>({ key: "", matches: [] });
  const [checkingKey, setCheckingKey] = useState("");
  const [chosen, setIdentity] = useState<Identity>(() => !existing && prefill?.partyId && prefill.party.displayName?.trim()
    ? { kind: "existing", partyId: prefill.partyId, name: prefill.party.displayName.trim() } : null);
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
  // The chat's own contact with no enquiries yet is a first-time client: chosen already, it is used without asking
  // "Existing client?"; otherwise it is offered as "Use this contact", never as returning.
  const chatContact = prefill?.contactPartyId ?? prefill?.partyId;
  const firstTime = (match: ClientMatch) => Boolean(chatContact) && match.partyId === chatContact && !match.leadId;
  const askIdentity = !existing && matches.length > 0 && !(identity?.kind === "existing" && matches.every(firstTime));
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

  // Why a person matched, in one line, so the choice between them is quick (E1-1).
  const matchReason = (match: ClientMatch) => {
    if (!matchQuery) return null;
    const sameMobile = Boolean(matchQuery.mobile && match.mobile && (toE164(match.mobile, mobileCountry) ?? match.mobile) === matchQuery.mobile);
    const sameEmail = Boolean(matchQuery.email && match.email && match.email.trim().toLowerCase() === matchQuery.email.toLowerCase());
    if (!sameMobile && !sameEmail) return null;
    const base = sameMobile && sameEmail ? t("Same mobile and email") : sameMobile ? t("Same mobile") : t("Same email");
    const typed = contact.displayName.trim().toLowerCase();
    return typed && match.name.trim().toLowerCase() !== typed ? t("{reason}, different name spelling", { reason: base }) : base;
  };
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

  // PLM-092: every problem at once, each on its field. Own checks run on submit; the server's `missing` joins them.
  const [attempted, setAttempted] = useState(false);
  const syntheticProblems: SaveProblem[] = (highlightFields ?? []).map((key) => {
    if (key === "targetCompletion") return { key, label: t("Enter the client's target completion date") };
    if (key === "area") return { key, label: t("Enter the area") };
    if (key === "email") return { key, label: t("Enter the client's email") };
    if (key === "address") return { key, label: t("Enter the address") };
    if (key === "budgetRange") return { key, label: t("Choose the budget range") };
    if (key === "summary") return { key, label: t("Describe the project") };
    return { key, label: t("Complete the required enquiry field") };
  });
  const [serverProblems, setServerProblems] = useState<SaveProblem[]>(() => initialProblems?.length ? initialProblems : syntheticProblems);
  const regionWord = translateKnown(t, areaLabel);
  const phoneMessages = phoneProblemText(t);
  // The name is checked only when it is typed here: an existing client's name, or one that came from a channel and
  // is left as it is, is kept as it came.
  const nameAsItCame = existing?.party?.displayName ?? prefill?.party.displayName ?? "";
  const nameTyped = identity?.kind !== "existing" && normalizePersonName(name) !== normalizePersonName(nameAsItCame);
  const ownProblems = (): SaveProblem[] => {
    const found: SaveProblem[] = [];
    const add = (key: string, label: string) => { if (!found.some(item => item.key === key)) found.push({ key, label }); };
    if (!existing && matches.length && !identity) add("identity", t("Choose the existing client or Different person."));
    if (!name.trim()) add("displayName", t("Enter a customer name."));
    else if (nameTyped) { const wrong = personNameError(name, t); if (wrong) add("displayName", wrong); }
    if (!contact.mobile?.trim()) add("mobile", t("Enter a mobile number."));
    else { const wrong = phoneProblem(contact.mobile, mobileCountry, phoneMessages, { mobile: true, locale: initialData.defaultLocale }); if (wrong) add("mobile", wrong); }
    if (contact.phone?.trim()) { const wrong = phoneProblem(contact.phone, contact.phoneCountryCode ?? "", phoneMessages, { mobile: false, locale: initialData.defaultLocale }); if (wrong) add("phone", wrong); }
    if (!serviceType) add("serviceType", t("Select an enquiry type"));
    if (hasRegions && !details.emirate?.trim()) add("emirate", t("Select the {area}.", { area: regionWord.toLowerCase() }));
    if (!source) add("source", t("Choose where this enquiry came from."));
    else if (!channel) add("channel", t("Choose the channel for this source."));
    if (options?.customerTypes.length && shown("customerType") && !details.customerType) add("customerType", t("Choose the client type."));
    if (!existing && !owner) add("owner", t("Choose an owner, routing, or leave unassigned."));
    if (email && !EMAIL.test(email)) add("email", t("Enter a valid email."));
    // PLM-096: what this enquiry type requires from the start.
    if (needed("email") && shown("email") && !email) add("email", t("Enter the client's email"));
    if (needed("area") && shown("area") && !details.area?.trim()) add("area", t("Enter the area"));
    if (needed("address") && !contact.address?.trim()) add("address", t("Enter the address"));
    if (needed("budgetRange") && shown("budgetRange") && options?.budgetRanges.length && !details.budgetRange) add("budgetRange", t("Choose the budget range"));
    if (needed("projectType") && shown("projectType") && options?.projectTypes?.length && !details.projectType) add("projectType", t("Choose the project type"));
    if (needed("floorPlan") && shown("floorPlan") && !floorPlanReady(details.floorPlan)) add("floorPlan", t("Add the floor plan, give a size estimate, or mark it not required"));
    if (needed("summary") && shown("summary") && !summary.trim()) add("summary", t("Describe the project"));
    if (needed("targetCompletion") && !details.targetCompletion) add("targetCompletion", t("Enter the client's target completion date"));
    for (const role of teamRoles) if (needed(`team:${role}`) && !team[role]) add(`team:${role}`, t("Tag the {role}, or choose Not applicable", { role: teamRoleLabel(role, t).toLocaleLowerCase() }));
    return found;
  };
  // Fixed fields drop off the list as they are filled; the server's stay until the next save.
  const own = attempted ? ownProblems() : [];
  const problems = [...own, ...serverProblems.filter(item => !own.some(mine => mine.key === item.key) && !(attempted && fixedLocally(item.key)))];
  function fixedLocally(key: string) {
    if (key === "email") return Boolean(email);
    if (key === "address") return Boolean(contact.address?.trim());
    if (key === "area") return Boolean(details.area?.trim());
    if (key === "budgetRange") return Boolean(details.budgetRange);
    if (key === "customerType") return Boolean(details.customerType);
    if (key === "projectType") return Boolean(details.projectType);
    if (key === "floorPlan") return floorPlanReady(details.floorPlan);
    if (key === "summary") return Boolean(summary.trim());
    if (key === "targetCompletion") return Boolean(details.targetCompletion);
    if (key.startsWith("team:")) return Boolean(team[key.slice(5)]);
    return false;
  }
  const problem = (key: string) => { const found = problems.find(item => item.key === key); return found ? problemText(found, t, { regionLabel: regionWord }) : undefined; };
  const mark = (key: string) => ({ name: key, isInvalid: Boolean(problem(key)), errorMessage: problem(key) });

  const save = async () => {
    if (savedId) { await onSaved(savedId); return; }
    setAttempted(true); setServerProblems([]);
    const mine = ownProblems();
    // A problem in More details opens it, so its link in the box reaches the field.
    if (mine.some(item => IN_MORE_DETAILS.has(item.key))) setMore(true);
    if (mine.length) throw new FormNotSaved();
    const enquiryDetails: Record<string, unknown> = Object.fromEntries(["emirate", "area", "location", "customerType", "projectType", "budgetRange", "targetCompletion", "campaign", "internalNotes"].map(key => [key, details[key as keyof EnquiryDetails] ?? ""]));
    const typedArea = details.area?.trim() ?? "";
    enquiryDetails.area = listedAreas(details.emirate).find(item => item.label.toLocaleLowerCase() === typedArea.toLocaleLowerCase())?.id ?? typedArea;
    // The floor plan keeps only what its answer needs (a file when uploaded, the size when given).
    const plan = details.floorPlan;
    if (plan?.status) enquiryDetails.floorPlan = { status: plan.status, ...(plan.status === "uploaded" && plan.assetId ? { assetId: plan.assetId } : {}),
      ...(plan.status !== "not_required" && plan.builtUpArea?.trim() ? { builtUpArea: plan.builtUpArea.trim() } : {}),
      ...(plan.status !== "not_required" && plan.plotSize?.trim() ? { plotSize: plan.plotSize.trim() } : {}) };
    const referralChanged = Boolean(existing) && JSON.stringify(referralBody()) !== JSON.stringify(existing?.referral ? { ...(existing.referral.name ? { name: existing.referral.name } : {}), ...(existing.referral.contact ? { contact: existing.referral.contact } : {}), ...(existing.referral.membershipId ? { membershipId: existing.referral.membershipId } : {}), ...(existing.referral.option ? { option: existing.referral.option } : {}) } : undefined);
    const assignment = owner === ROUTING ? { mode: "automatic" } : owner === UNASSIGNED ? { mode: "unassigned" } : { mode: "manual", ownerMembershipId: owner, ...(queueId ? { queueId } : {}) };
    // A typed name is saved trimmed, with one space between words.
    const typedName = nameTyped ? normalizePersonName(name) : name;
    const body = existing ? { version: existing.version, serviceType, summary, party: { ...contact, displayName: typedName }, details: enquiryDetails, ...teamBody(), ...(sourceChanged ? { source, channel } : {}), ...(referralKind && (sourceChanged || referralChanged) ? { referral: referralBody() } : {}) }
      : { workspaceId: initialData.workspaceId, requestId, ...contact, displayName: typedName, ...(prefill && !nameTyped ? { nameFromChannel: true } : {}), serviceType, summary, source, channel, details: enquiryDetails, ...teamBody(), ...(referralKind ? { referral: referralBody() } : {}), assignment,
          ...(identity?.kind === "existing" ? { identity: "existing", partyId: identity.partyId } : identity?.kind === "new" ? { identity: "new" } : {}) };
    const response = await fetch(existing ? `/api/workspace/crm/data/leads/${existing.id}/details?workspaceId=${initialData.workspaceId}` : "/api/workspace/crm/leads", {
      method: existing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      // The server names every field it refused (PLM-092): they go on the fields and into the one box.
      const missing = readSaveProblems(result);
      if (missing.length) { setServerProblems(missing); setAttempted(false); if (missing.some(item => IN_MORE_DETAILS.has(item.key))) setMore(true); throw new FormNotSaved(); }
      throw Object.assign(new Error(Array.isArray(result.message) ? result.message.join(". ") : result.message ?? t("The enquiry could not be saved.")), { status: response.status });
    }
    const id = existing?.id ?? result.leadId;
    if (!id) throw new Error(t("The enquiry was received. Refresh the enquiries list to check its status."));
    setSavedId(id);
    await saveLeadFields(initialData.workspaceId, id, changedValues(existing?.customFields, customValues));
    await onSaved(id, !existing && typeof result.reference === "string" ? result.reference : undefined);
  };

  const ownerItems = [
    ...(routingConfigured ? [{ id: ROUTING, label: t("Use routing rules") }] : []),
    ...ownerChoices.map(member => ({ id: member.id, label: member.id === me ? t("Me · {name}", { name: member.displayName || member.email }) : member.displayName || member.email })),
    { id: UNASSIGNED, label: t("Leave unassigned") },
  ];
  const locked = Boolean(savedId);
  // An edit's unsaved work stays on this device per enquiry and version. A new enquiry always opens empty: closing it
  // (after asking, when something was typed) or creating it leaves nothing behind for the next one.
  const snapshot = { contact, serviceType, summary, details, source, channel, referral, owner, queueId, customValues, team };
  const [start] = useState(() => JSON.stringify(snapshot));
  const dirty = !savedId && JSON.stringify(snapshot) !== start;
  const draft = useFormDraft(savedId || !existing ? null : `${initialData.workspaceId}/crm/enquiry/${existing.id}@${existing.version}`, snapshot, {
    isDirty: dirty,
    restore: (saved) => {
      setContact(saved.contact); setServiceType(saved.serviceType); setSummary(saved.summary); setDetails(saved.details);
      setSource(saved.source); setChannel(saved.channel); setReferral(saved.referral); setOwnerChoice(saved.owner); setQueue(saved.queueId); setCustomValues(saved.customValues); setTeam(saved.team ?? {});
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
    if (found.area) setDetails((current) => ({ ...current, area: found.area }));
    if (found.email || found.phone || found.company || found.jobPosition || found.website || found.address || found.summary) setMore(true);
  };
  const moreFilled = [contact.email, details.budgetRange, details.floorPlan?.status, details.targetCompletion, summary, contact.company, contact.jobPosition, contact.phone, contact.website, contact.address, details.campaign, details.internalNotes].filter(Boolean).length;
  const notesShown = existing?.notesVisible !== false;
  return <FormDialog draft={existing ? draft : undefined} errorTitle={effectiveGate === "book_intro" ? t("Before booking the intro") : initialProblems?.length && !attempted ? t("Before converting") : t("Enquiry not saved")} isDirty={dirty} isSubmitDisabled={!options} onClose={onClose} onSubmit={save} validation="caller"
    problems={problems.map(item => ({ ...item, text: problemText(item, t, { regionLabel: regionWord }) }))}
    title={existing ? t("Edit enquiry") : t("New enquiry")} description={existing?.reference ?? undefined} formClassName={styles.leadForm} formId={formId}
    submitLabel={savedId ? t("Refresh enquiry") : existing ? t("Save changes") : t("Create enquiry")}
    lead={<>
      {!options && <Callout title={t("Enquiry options unavailable")} tone="warning">{t("Refresh Enquiries to load the current configuration.")}</Callout>}
      {aiReady && !locked ? <FillWithWoddy fields={fillFields} onApply={applyFill}
        onExtract={async ({ text, image }) => fillWithWoddy(initialData.workspaceId, "enquiry", { ...(text ? { text } : {}), ...(image ? { image: await imageForWoddy(image) } : {}) })} /> : null}
    </>}>
      <fieldset className={styles.enquiryFields} disabled={locked}>
        <FormSection title={t("Client")}>
        <div data-problem-key="mobile"><CrmPhoneField label={t("Mobile")} required value={contact.mobile ?? ""} onChange={set("mobile")} countryCode={contact.mobileCountryCode ?? ""} onCountryChange={set("mobileCountryCode")} locale={initialData.defaultLocale}
          isReadOnly={identityLocked && Boolean(existing?.party?.mobile)} errorMessage={problem("mobile")} description={identityLocked && existing?.party?.mobile ? identityHint : undefined} /></div>
        {askIdentity ? <section className={styles.clientMatch} aria-label={t("Existing client?")} aria-live="polite" data-problem-key="identity" tabIndex={-1}>
          <strong>{t("Existing client?")}</strong>
          <ClientMatchList label={t("Clients with this mobile or email")} matches={matches} reason={matchReason} actions={(match) => <>
            {match.open && match.leadId && onOpenLead ? <Button size="compact" isDisabled={locked} onPress={() => onOpenLead(match.leadId!)}>{t("Open it")}</Button> : null}
            <Button size="compact" variant={identity?.kind === "existing" && identity.partyId === match.partyId ? "primary" : "secondary"} isDisabled={locked}
              aria-pressed={identity?.kind === "existing" && identity.partyId === match.partyId}
              onPress={() => setIdentity({ kind: "existing", partyId: match.partyId, name: match.name })}>{firstTime(match) ? t("Use this contact") : match.open ? t("Add to this client") : t("Add as returning")}</Button>
          </>} />
          <div><Button size="compact" variant={identity?.kind === "new" ? "primary" : "quiet"} aria-pressed={identity?.kind === "new"} isDisabled={locked} onPress={() => setIdentity({ kind: "new" })}>{t("Different person")}</Button></div>
        </section> : checking ? <p className={styles.routingHint} aria-live="polite">{t("Checking for an existing client…")}</p> : null}
        <PersonNameField isRequired label={t("Customer name")} value={name} savedValue={nameAsItCame || undefined} isReadOnly={identity?.kind === "existing" || (identityLocked && Boolean(existing?.party?.displayName))} description={identityLocked && existing?.party?.displayName ? identityHint : undefined} onChange={set("displayName")} {...mark("displayName")} />
        </FormSection>
        <FormSection title={t("Enquiry")}>
        <SelectField label={t("Enquiry type")} isRequired placeholder={t("Choose enquiry type")} items={withExisting(options?.enquiryTypes, existing?.serviceType ?? "")} selectedKey={serviceType || null} onSelectionChange={key => key && setServiceType(String(key))} {...mark("serviceType")} />
        {teamRoles.map(role => <SelectField key={role} label={teamRoleLabel(role, t)} isRequired={needed(`team:${role}`)} placeholder={t("Not tagged")} items={teamItems(role)} selectedKey={team[role] || null} onSelectionChange={key => setTeam(current => ({ ...current, [role]: String(key ?? "") }))} {...mark(`team:${role}`)} />)}
        <SelectField label={t("Source")} isRequired placeholder={t("Choose source")} items={withExisting(sourceItems, existing?.source ?? "")} selectedKey={source || null} onSelectionChange={key => chooseSource(String(key ?? ""))} {...mark("source")} />
        <SelectField label={t("Channel")} isRequired isDisabled={!source} placeholder={t("Choose channel")} items={withExisting(channelItems, source === existing?.source ? existing?.channel ?? "" : "")} selectedKey={channel || null} onSelectionChange={key => setChannel(String(key ?? ""))} {...mark("channel")} />
        {referralKind === "external" ? <><TextInput isRequired label={t("Referred by")} value={referral.name} onChange={value => setReferral(current => ({ ...current, name: value }))} /><TextInput label={t("Referrer contact")} value={referral.contact} onChange={value => setReferral(current => ({ ...current, contact: value }))} /></>
          : referralKind === "internal" ? <SelectField isRequired label={t("Referred by")} placeholder={t("Choose referrer")} items={initialData.members.filter(member => member.status === "active").map(member => ({ id: member.id, label: member.displayName || member.email }))} selectedKey={referral.membershipId || null} onSelectionChange={key => setReferral(current => ({ ...current, membershipId: String(key ?? "") }))} />
          : referralKind ? <SelectField isRequired label={t("Referred by")} placeholder={t("Choose referrer")} items={withExisting(referralKind === "broker" ? options?.referralBrokers : options?.referralPartners, existing?.referral?.option ?? "")} selectedKey={referral.option || null} onSelectionChange={key => setReferral(current => ({ ...current, option: String(key ?? "") }))} />
          : null}
        {hasRegions ? <SelectField label={translateKnown(t, areaLabel)} isRequired placeholder={t("Choose {area}", { area: regionWord.toLocaleLowerCase() })} items={withExisting(options?.emirates, existing?.details?.emirate ?? "")} selectedKey={details.emirate || null} onSelectionChange={key => { setDetails(previous => ({ ...previous, emirate: String(key ?? ""), area: "" })); }} {...mark("emirate")} /> : null}
          {shown("area") ? <ComboboxField label={t("Area / city")} isRequired={needed("area")} allowsCustomValue items={areaItems} inputValue={details.area ?? ""} onInputChange={setDetail("area")} {...mark("area")} /> : null}
        {shown("customerType") && Boolean(options?.customerTypes.length || existing?.details?.customerType) && <SelectField label={t("Client type")} isRequired={Boolean(options?.customerTypes.length)} placeholder={t("Choose client type")} items={withExisting(options?.customerTypes, existing?.details?.customerType ?? "")} selectedKey={details.customerType || null} onSelectionChange={key => setDetail("customerType")(String(key ?? ""))} {...mark("customerType")} />}
        {shown("projectType") && Boolean(options?.projectTypes?.length || existing?.details?.projectType) && <SelectField label={t("Project type")} isRequired={needed("projectType")} placeholder={t("Choose project type")} items={withExisting(options?.projectTypes, existing?.details?.projectType ?? "")} selectedKey={details.projectType || null} onSelectionChange={key => setDetail("projectType")(String(key ?? ""))} {...mark("projectType")} />}
        {!existing ? <SelectField label={t("Owner")} isRequired placeholder={t("Choose owner")} items={ownerItems} selectedKey={owner || null} onSelectionChange={key => { ownerTouched.current = true; setOwnerChoice(String(key ?? "")); }} {...mark("owner")} /> : null}
        </FormSection>

        <MoreDetails filled={moreFilled} isOpen={more} onOpenChange={setMore}>
          {shown("email") ? <TextInput label={t("Email")} inputType="email" isRequired={needed("email")} value={contact.email ?? ""} onChange={set("email")} {...mark("email")} /> : null}
          {shown("budgetRange") ? <SelectField label={t("Budget range")} isRequired={needed("budgetRange")} items={[{ id: "", label: t("Not provided") }, ...withExisting(options?.budgetRanges, existing?.details?.budgetRange ?? "")]} selectedKey={details.budgetRange ?? ""} onSelectionChange={key => setDetail("budgetRange")(String(key ?? ""))} {...mark("budgetRange")} /> : null}
          {shown("floorPlan") ? <EnquiryFloorPlanField workspaceId={initialData.workspaceId} leadId={existing?.id} value={details.floorPlan} isRequired={needed("floorPlan")}
            allowNotNeeded={Boolean(options?.enquiryTypes.find((item) => item.id === serviceType)?.furniture)}
            errorMessage={problem("floorPlan")} onChange={(floorPlan) => setDetails(previous => ({ ...previous, floorPlan }))} /> : null}
          {shown("summary") ? <TextAreaField label={t("Project description")} isRequired={needed("summary")} value={summary} onChange={setSummary} placeholder={t("What would the customer like to do?")} {...mark("summary")} /> : null}
          {/* PLM-155: Sales collect the client's target date; the design team and Production say what is possible. */}
          <div data-problem-key="targetCompletion"><DateField label={t("Target completion")} isRequired={needed("targetCompletion")} value={/^\d{4}-\d{2}-\d{2}$/.test(details.targetCompletion ?? "") ? parseDate(details.targetCompletion!) : null}
            onChange={(value) => setDetail("targetCompletion")(value?.toString() ?? "")} errorMessage={problem("targetCompletion")} isInvalid={Boolean(problem("targetCompletion"))} /></div>
          <TextInput label={t("Company")} value={contact.company ?? ""} onChange={set("company")} />
          <TextInput label={t("Job position")} value={contact.jobPosition ?? ""} onChange={set("jobPosition")} />
          <div data-problem-key="phone"><CrmPhoneField label={t("Phone")} kind="any" value={contact.phone ?? ""} onChange={set("phone")} countryCode={contact.phoneCountryCode ?? ""} onCountryChange={set("phoneCountryCode")} locale={initialData.defaultLocale}
            isReadOnly={identityLocked && Boolean(existing?.party?.phone)} description={problem("phone") ?? (identityLocked && existing?.party?.phone ? identityHint : undefined)} /></div>
          <TextInput label={t("Website")} value={contact.website ?? ""} onChange={set("website")} />
          <TextInput label={t("Address")} isRequired={needed("address")} value={contact.address ?? ""} onChange={set("address")} {...mark("address")} />
          <TextInput label={t("Campaign")} value={details.campaign ?? ""} onChange={setDetail("campaign")} />
          {!existing && owner !== ROUTING && owner !== UNASSIGNED ? <SelectField label={t("Sales team")} items={[{ id: "", label: t("No team selected") }, ...initialData.queues.filter(q => q.status === "active").map(q => ({ id: q.id, label: q.name }))]} selectedKey={queueId} onSelectionChange={key => setQueue(String(key ?? ""))} /> : null}
          {notesShown ? <TextAreaField label={t("Internal notes")} description={t("Team only. Never shown to the client.")} value={details.internalNotes ?? ""} onChange={setDetail("internalNotes")} /> : null}
          <EnquiryCustomInputs className={styles.customInputs} fields={fields} values={customValues} onChange={(id, value) => setCustomValues(current => ({ ...current, [id]: value }))} />
        </MoreDetails>
      </fieldset>
  </FormDialog>;
}

function withExisting(options: LeadOptions["enquiryTypes"] | undefined, value: string) {
  return options?.some(item => item.id === value) || !value ? options ?? [] : [...(options ?? []), { id: value, label: value.replaceAll("_", " ") }];
}
