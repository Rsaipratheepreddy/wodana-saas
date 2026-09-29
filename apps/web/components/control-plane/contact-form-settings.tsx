"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button, Callout, ErrorState, IconButton, InlineNotice, PageSkeleton, SettingsPage, SettingsRow, SettingsSection, Switch, TagsField, TextAreaField, TextInput, useToast,
} from "@/design-system";
import { ContactSalesForm } from "@/components/sales/contact-sales-form";
import { useT } from "@/lib/i18n/i18n-provider";
import { ConsoleRequestError } from "@/lib/internal/console";
import { salesApi, type SalesContactFormSettings } from "@/lib/internal/sales";
import {
  ALWAYS_REQUIRED, DEFAULT_CONSENT, DEFAULT_THANK_YOU_MESSAGE, DEFAULT_THANK_YOU_TITLE, FIELD_LABELS, SALES_FORM_FIELDS,
  type PublicSalesForm, type SalesFieldSetting, type SalesFormConfiguration, type SalesFormField, type TeamSizeOption,
} from "@/lib/sales/contact-form";
import { useConsoleFormat } from "./labels";
import shell from "./control-plane.module.css";
import styles from "./sales.module.css";

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
const MAX_RECIPIENTS = 10;
const MAX_TEAM_SIZES = 12;

/** The draft keeps existing option ids; a new option has none until the server derives one. */
type Draft = Omit<SalesFormConfiguration, "teamSizes"> & { teamSizes: Array<{ id?: string; label: string }> };
const clone = (configuration: SalesFormConfiguration): Draft => JSON.parse(JSON.stringify(configuration)) as Draft;
const hidden = (label: string) => <span className="wd-visually-hidden">{label}</span>;

/** Settings for Wodana's "Contact sales" form: fields, team sizes, wording, who is told, and a live preview. */
export function ContactFormSettings({ canManage }: { canManage: boolean }) {
  const t = useT();
  const toast = useToast();
  const format = useConsoleFormat();
  const [settings, setSettings] = useState<SalesContactFormSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [outdated, setOutdated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const load = useCallback(async (keepDraft = false) => {
    try {
      const loaded = await salesApi.form();
      setSettings(loaded); setError(""); setOutdated(false);
      if (!keepDraft) setDraft(clone(loaded.configuration));
    } catch (cause) { setError((cause as Error).message || t("The contact form didn't load.")); }
  }, [t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const dirty = Boolean(settings && draft) && JSON.stringify(draft) !== JSON.stringify(settings?.configuration);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const problems = useMemo(() => {
    if (!draft) return { recipients: "", teamSizes: "" };
    const invalid = draft.recipients.find((email) => !EMAIL.test(email) || email.length > 254);
    const recipients = invalid ? t("{email} is not a valid email address.", { email: invalid })
      : draft.recipients.length > MAX_RECIPIENTS ? t("Add at most {count} recipients.", { count: MAX_RECIPIENTS }) : "";
    const names = draft.teamSizes.map((option) => option.label.trim().toLowerCase());
    const teamSizes = names.some((name) => !name) ? t("Every team size needs a label.")
      : new Set(names).size !== names.length ? t("Team sizes must be different.")
      : draft.fields.teamSize.enabled && !names.length ? t("Add at least one team size, or turn the field off.") : "";
    return { recipients, teamSizes };
  }, [draft, t]);
  const valid = !problems.recipients && !problems.teamSizes;

  const update = (patch: (current: Draft) => Draft) => setDraft((current) => (current ? patch(current) : current));
  const setField = (field: SalesFormField, patch: Partial<SalesFieldSetting>) =>
    update((current) => ({ ...current, fields: { ...current.fields, [field]: { ...current.fields[field], ...patch } } }));
  const setOption = (index: number, label: string) =>
    update((current) => ({ ...current, teamSizes: current.teamSizes.map((option, at) => (at === index ? { ...option, label } : option)) }));

  const save = async () => {
    if (!settings || !draft) return;
    setSaving(true); setSaveError("");
    try {
      // New options carry no id: the server derives one from the label.
      const teamSizes = draft.teamSizes.map((option) => ({ ...(option.id ? { id: option.id } : {}), label: option.label.trim() })) as TeamSizeOption[];
      const saved = await salesApi.saveForm({ expectedVersion: settings.version, configuration: { ...draft, teamSizes } }, key);
      setSettings(saved); setDraft(clone(saved.configuration)); setKey(crypto.randomUUID());
      toast.push({ title: t("Saved"), message: t("Version {version}", { version: saved.version }), tone: "success" });
    } catch (cause) {
      if (cause instanceof ConsoleRequestError && cause.status === 409) setOutdated(true);
      else setSaveError((cause as Error).message || t("The contact form could not be saved."));
    } finally { setSaving(false); }
  };

  if (error && !settings) return <div className={shell.page}><ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!settings || !draft) return <PageSkeleton page variant="form" />;
  const latest = settings.history[0];
  const preview: PublicSalesForm = {
    version: settings.version, fields: draft.fields, consentLabel: draft.consentLabel, thankYouTitle: draft.thankYouTitle, thankYouMessage: draft.thankYouMessage,
    teamSizes: draft.teamSizes.map((option, index) => ({ id: option.id ?? `new-${index}`, label: option.label })),
  };
  const saveAction = canManage
    ? <Button variant="primary" isDisabled={!dirty || !valid} isLoading={saving} onPress={() => void save()}>{t("Save")}</Button> : undefined;

  return <SettingsPage title={t("Contact form")} width="wide" actions={saveAction}>
    {outdated ? <Callout tone="warning" title={t("The form changed")} actions={<Button size="compact" onPress={() => void load(true)}>{t("Reload")}</Button>}>
      {t("Someone saved a newer version. Reload, then save your edits again.")}</Callout> : null}
    {saveError ? <InlineNotice tone="error" message={saveError} /> : null}
    <SettingsSection id="fields" title={t("Fields")}>
      {SALES_FORM_FIELDS.map((field) => {
        const always = ALWAYS_REQUIRED.includes(field);
        const setting = draft.fields[field];
        const name = t(FIELD_LABELS[field]);
        return <SettingsRow key={field} label={name} hint={always ? t("Always required") : undefined}>
          <div className={styles.fieldControls}>
            <Switch isSelected={setting.enabled} isDisabled={always || !canManage} onChange={(enabled) => setField(field, { enabled, required: enabled && setting.required })}>{t("Shown")}</Switch>
            <Switch isSelected={setting.required} isDisabled={always || !setting.enabled || !canManage} onChange={(required) => setField(field, { required })}>{t("Required")}</Switch>
            <TextInput label={hidden(t("Label for {field}", { field: name }))} placeholder={name} value={setting.label ?? ""} isDisabled={!canManage}
              onChange={(value) => setField(field, { label: value || null })} />
          </div>
        </SettingsRow>;
      })}
    </SettingsSection>
    <SettingsSection id="team-sizes" title={t("Team sizes")}>
      <SettingsRow label={t("Options")} hint={draft.fields.teamSize.enabled ? undefined : t("Field hidden")} align="start">
        <div className={styles.options}>
          {draft.teamSizes.map((option, index) => <div className={styles.option} key={option.id ?? `new-${index}`}>
            <TextInput label={hidden(t("Option {number}", { number: index + 1 }))} value={option.label} isDisabled={!canManage} isInvalid={!option.label.trim()}
              onChange={(label) => setOption(index, label)} />
            {canManage ? <IconButton aria-label={t("Remove {name}", { name: option.label || t("Option {number}", { number: index + 1 }) })}
              onPress={() => update((current) => ({ ...current, teamSizes: current.teamSizes.filter((_, at) => at !== index) }))}><X size={14} /></IconButton> : null}
          </div>)}
          {canManage ? <Button size="compact" isDisabled={draft.teamSizes.length >= MAX_TEAM_SIZES}
            onPress={() => update((current) => ({ ...current, teamSizes: [...current.teamSizes, { label: "" }] }))}>{t("Add option")}</Button> : null}
          {problems.teamSizes ? <InlineNotice tone="error" message={problems.teamSizes} /> : null}
        </div>
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="thank-you" title={t("Thank-you message")}>
      <SettingsRow label={t("Title")}><div className={styles.wide}>
        <TextInput label={hidden(t("Title"))} placeholder={t(DEFAULT_THANK_YOU_TITLE)} value={draft.thankYouTitle ?? ""} isDisabled={!canManage}
          onChange={(value) => update((current) => ({ ...current, thankYouTitle: value || null }))} />
      </div></SettingsRow>
      <SettingsRow label={t("Message")} align="start"><div className={styles.wide}>
        <TextAreaField label={hidden(t("Message"))} placeholder={t(DEFAULT_THANK_YOU_MESSAGE)} value={draft.thankYouMessage ?? ""} isDisabled={!canManage}
          onChange={(value) => update((current) => ({ ...current, thankYouMessage: value || null }))} />
      </div></SettingsRow>
    </SettingsSection>
    <SettingsSection id="consent" title={t("Consent")}>
      <SettingsRow label={t("Checkbox text")}><div className={styles.wide}>
        <TextInput label={hidden(t("Checkbox text"))} placeholder={t(DEFAULT_CONSENT)} value={draft.consentLabel ?? ""} isDisabled={!canManage}
          onChange={(value) => update((current) => ({ ...current, consentLabel: value || null }))} />
      </div></SettingsRow>
    </SettingsSection>
    <SettingsSection id="recipients" title={t("Recipients")}>
      <div className={styles.recipients}>
        <TagsField label={t("Email addresses")} values={draft.recipients} isReadOnly={!canManage} placeholder={t("Add an address…")}
          description={t("New enquiries are emailed to these addresses.")}
          onChange={(values) => update((current) => ({ ...current, recipients: [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))] }))} />
        {problems.recipients ? <InlineNotice tone="error" message={problems.recipients} /> : null}
      </div>
    </SettingsSection>
    <SettingsSection id="preview" title={t("Preview")}>
      <div className={styles.preview}><ContactSalesForm form={preview} source="preview" preview /></div>
    </SettingsSection>
    <p className={styles.version} title={latest ? format.dateTime(latest.createdAt) : undefined}>
      {!latest ? t("Version {version}", { version: settings.version })
        : latest.createdByName ? t("Version {version} · saved {when} by {name}", { version: settings.version, when: format.relative(latest.createdAt), name: latest.createdByName })
        : t("Version {version} · saved {when}", { version: settings.version, when: format.relative(latest.createdAt) })}
    </p>
  </SettingsPage>;
}
