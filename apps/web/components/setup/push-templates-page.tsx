"use client";

import { Bell, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, ErrorState, InlineNotice, SaveBar, SelectField, SettingsPage, SettingsSection, Skeleton, Switch, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown, tKey, type MessageKey } from "@/lib/i18n/keys";
import { BODY_LIMIT, fillPush, loadPushTemplates, savePushTemplates, TITLE_LIMIT, type PushAction, type PushTemplate, type PushTemplates } from "@/lib/setup/push";
import { useWorkspaceIdentity } from "../workspace/workspace-identity";
import styles from "./setup.module.css";

const ACTION_LABEL: Record<PushAction, MessageKey> = { open: tKey("Open"), review: tKey("Review"), reply: tKey("Reply"), pay: tKey("Pay now") };
/** The second button some actions show on the phone. */
const SECOND_BUTTON: Partial<Record<PushAction, MessageKey>> = { review: tKey("Later") };
const MOMENT_LABELS = [tKey("A job moves to its next step"), tKey("A step is late"), tKey("Someone mentions you in a job's chat"), tKey("The client's project moves on"),
  tKey("Something waits for the client")] as const;
void MOMENT_LABELS;

type Editable = Pick<PushTemplate, "key" | "title" | "body" | "action" | "enabled">;

/**
 * §0.3, Settings → Push notifications, like a delivery app's: each moment of a job has its push, worded by the firm
 * (title, a line of text with the moment's facts in {braces}, one button). The team's pushes go to the staff app, the
 * client's to their app in their words. The phone beside it shows the chosen moment as it will look.
 */
export function PushTemplatesPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const identity = useWorkspaceIdentity();
  const [saved, setSaved] = useState<PushTemplates | null>(null);
  const [rows, setRows] = useState<Editable[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const pick = (list: PushTemplate[]) => list.map(({ key, title, body, action, enabled }) => ({ key, title, body, action, enabled }));
  const load = useCallback(() => {
    setFailure("");
    loadPushTemplates(workspaceId).then((next) => { setSaved(next); setRows(pick(next.templates)); setSelected((current) => current || next.templates[0]?.key || ""); })
      .catch((error: Error) => setFailure(error.message));
  }, [workspaceId]);
  useEffect(() => { queueMicrotask(load); }, [load]);
  const meta = useMemo(() => new Map((saved?.templates ?? []).map((template) => [template.key, template])), [saved]);
  if (failure && !saved) return <SettingsPage title={t("Push notifications")}><ErrorState description={failure} onRetry={load} /></SettingsPage>;
  if (!saved) return <SettingsPage title={t("Push notifications")}><Skeleton lines={6} shape="form" /></SettingsPage>;
  const dirty = JSON.stringify(rows) !== JSON.stringify(pick(saved.templates));
  const edit = (key: string, patch: Partial<Editable>) => { setJustSaved(false); setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row))); };
  const save = async () => {
    setBusy(true); setFailure("");
    try {
      const next = await savePushTemplates(workspaceId, saved.version, rows);
      setSaved({ version: next.version, templates: saved.templates.map((template) => ({ ...template, ...rows.find((row) => row.key === template.key)! })) });
      setJustSaved(true);
    } catch (error) { setFailure((error as Error).message); }
    setBusy(false);
  };
  const current = rows.find((row) => row.key === selected) ?? rows[0];
  const brand = identity?.name || t("Your studio");

  // The moment's push on a phone's lock screen, as the chosen wording will show it.
  const phone = (row: Editable, about: PushTemplate) => <section className={styles.phone} aria-label={t("Preview")}>
    <span className={styles.phoneTime}>9:41</span>
    <div className={styles.notice} data-off={row.enabled ? undefined : ""}>
      <div className={styles.noticeHead}>
        <span className={styles.appIcon} aria-hidden="true">{brand.slice(0, 1).toUpperCase() || <Bell size={12} />}</span>
        <span className={styles.appName}>{about.audience === "client" ? brand : t("Team app")}</span>
        <span className={styles.noticeWhen}>{t("now")}</span>
      </div>
      <strong className={styles.noticeTitle}>{fillPush(row.title, about.sample, TITLE_LIMIT) || t("Title")}</strong>
      <p className={styles.noticeText}>{fillPush(row.body, about.sample, BODY_LIMIT)}</p>
      <div className={styles.noticeButtons}>
        <span>{t(ACTION_LABEL[row.action])}</span>
        {SECOND_BUTTON[row.action] ? <span>{t(SECOND_BUTTON[row.action]!)}</span> : null}
      </div>
    </div>
    {row.enabled ? null : <Badge tone="neutral">{t("Not sent: switched off")}</Badge>}
  </section>;

  const moment = (row: Editable) => {
    const about = meta.get(row.key)!;
    const open = row.key === current?.key;
    return <li key={row.key} className={styles.pushMoment} data-open={open || undefined}>
      <div className={styles.pushHead}>
        <button type="button" className={styles.pushPick} aria-expanded={open} onClick={() => setSelected(row.key)}>
          <span className={styles.pushLabel}>{translateKnown(t, about.label)}</span>
          <span className={styles.chips}>
            <Badge>{t(ACTION_LABEL[row.action])}</Badge>
            {row.enabled ? null : <Badge tone="neutral">{t("Off")}</Badge>}
          </span>
        </button>
        <Switch aria-label={t("Send {name}", { name: translateKnown(t, about.label) })} isSelected={row.enabled} onChange={(enabled) => edit(row.key, { enabled })} />
      </div>
      {open ? <div className={styles.pushEditor}>
        <TextInput label={t("Title")} maxLength={TITLE_LIMIT} value={row.title} onChange={(title) => edit(row.key, { title })} />
        <TextAreaField label={t("Text")} maxLength={BODY_LIMIT} value={row.body} onChange={(body) => edit(row.key, { body })} />
        <div className={styles.pushFacts} aria-label={t("Facts you can use")}>
          {about.variables.map((name) => <button type="button" key={name} className={styles.pushFact} onClick={() => edit(row.key, { body: `${row.body}${row.body.endsWith(" ") ? "" : " "}{${name}}` })}>{`{${name}}`}</button>)}
        </div>
        <div className={styles.pushRow}>
          <SelectField label={t("Button")} items={about.actions.map((action) => ({ id: action, label: t(ACTION_LABEL[action]) }))} selectedKey={row.action}
            onSelectionChange={(key) => edit(row.key, { action: String(key) as PushAction })} />
          {row.title !== about.kit.title || row.body !== about.kit.body || row.action !== about.kit.action
            ? <Button size="compact" variant="quiet" onPress={() => edit(row.key, { title: about.kit.title, body: about.kit.body, action: about.kit.action })}><RotateCcw aria-hidden="true" size={14} />{t("Use the standard wording")}</Button> : null}
        </div>
        {phone(row, about)}
      </div> : null}
    </li>;
  };

  return <SettingsPage title={t("Push notifications")} width="wide">
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    <div className={styles.pushPage}>
        <SettingsSection id="push-team" title={t("Team app")}><ul className={styles.pushList}>{rows.filter((row) => meta.get(row.key)?.audience === "team").map(moment)}</ul></SettingsSection>
        <SettingsSection id="push-client" title={t("Client app")}><ul className={styles.pushList}>{rows.filter((row) => meta.get(row.key)?.audience === "client").map(moment)}</ul></SettingsSection>

    </div>
    <SaveBar isDirty={dirty} isSaving={busy} saved={justSaved} onSave={() => void save()} onDiscard={() => setRows(pick(saved.templates))} />
  </SettingsPage>;
}
