"use client";

import { useCallback, useEffect, useState } from "react";
import { DesignLinkCard, isCanvaUrl, useLinkCard } from "@/components/catalog/design-link-card";
import { linkCardImageUrl } from "@/lib/workspace/product-sourcing";
import { ExternalLink, ImageIcon, Plus, Trash2 } from "lucide-react";
import {
  Badge, Button, Card, EmptyState, ErrorState, FormDialog, IconButton, InlineNotice, SegmentedControl, SelectField, Skeleton, TextAreaField, TextInput, useDesignSystem,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseApi, caseRequest, type CaseDesign } from "@/lib/pre-project/content";
import { DECISION_SOURCES, PRESENTATION_STATUS_LABEL, revisionDetail, SOURCE_LABEL, type Presentation, type PresentationsView } from "@/lib/pre-project/design-decisions";
import styles from "./design-decisions.module.css";

type OptionDraft = { id: string; title: string; mode: "link" | "file"; linkUrl: string; designId: string | null };
const newOption = (): OptionDraft => ({ id: crypto.randomUUID(), title: "", mode: "link", linkUrl: "", designId: null });

/**
 * PLM-049/051/052: a stage's presentations to the client. Each round shows options as cards (a Canva link or an
 * uploaded design); the client picks one in their portal (or staff record the decision with where it was made).
 * The revision counter runs from the package's included revisions; the next one is chargeable and Sales hear it.
 */
export function DesignPresentations({ workspaceId, caseId, stage, designs, canEdit, canRecordClient, clientName, onChanged }: {
  workspaceId: string; caseId: string; stage: Presentation["stage"]; designs: CaseDesign[]; canEdit: boolean; canRecordClient: boolean; clientName?: string; onChanged?: () => void;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [view, setView] = useState<PresentationsView | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<Presentation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // An empty answer is a failed load (error and Retry), never a reason to keep the skeleton up.
  const load = useCallback(() => caseRequest<PresentationsView | null>(workspaceId, caseId, "design-presentations").then((next) => {
    if (!next || typeof next !== "object") throw new Error(t("Presentations didn't load"));
    setView(next); setFailure("");
  }).catch((error: unknown) => setFailure(error instanceof Error && error.message ? error.message : t("Presentations didn't load"))), [workspaceId, caseId, t]);
  useEffect(() => { void load(); }, [load]);
  if (failure && !view) return <ErrorState title={t("Presentations didn't load")} description={failure} onRetry={() => void load()} />;
  if (!view) return <Skeleton lines={3} shape="rows" />;
  const rounds = (view.presentations ?? []).filter((item) => item.stage === stage && item.status !== "withdrawn");
  const open = rounds.find((item) => item.status === "draft" || item.status === "presented");
  const revision = revisionDetail(view.revisions?.[stage]);
  const day = (iso: string) => { try { return new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" }).format(new Date(iso)); } catch { return iso; } };
  const done = (message: string, next: PresentationsView) => { setView(next); setNotice(message); setFailure(""); onChanged?.(); };
  const act = async (round: Presentation, path: "present" | "withdraw") => {
    setBusy(round.id); setFailure("");
    try { done(path === "present" ? t("Shown to the client. They choose in their portal.") : t("Draft discarded."), await caseRequest<PresentationsView>(workspaceId, caseId, `design-presentations/${round.id}/${path}`, "POST", { version: round.version })); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("Could not save.")); }
    finally { setBusy(null); }
  };
  const stageDesigns = designs.filter((design) => !design.archivedAt && design.stage === stage && design.versions.length);

  return <section className={styles.section} aria-label={t("Presentations")}>
    <div className={styles.bar}>
      {revision ? <Badge tone={view.revisions?.[stage]?.chargeable ? "warning" : "neutral"}>{t(revision.key, revision.values)}</Badge> : null}
      <span className={styles.spacer} />
      {canEdit && !open ? <Button size="compact" variant="primary" onPress={() => setCreating(true)}><Plus aria-hidden="true" size={14} />{rounds.length ? t("New revision") : t("New presentation")}</Button> : null}
    </div>
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    {!rounds.length ? <EmptyState illustration="empty" title={t("Nothing presented yet")} description={t("Show the client the options to choose from: Canva links or uploaded boards.")}
      action={canEdit ? <Button variant="primary" onPress={() => setCreating(true)}><Plus aria-hidden="true" size={14} />{t("New presentation")}</Button> : undefined} /> : <div className={styles.rounds}>
      {rounds.map((round) => <Card key={round.id} title={round.round === 1 ? t("Presentation") : t("Revision {number}", { number: round.round - 1 })}
        chip={<span className={styles.inline}><Badge tone={round.status === "chosen" ? "success" : round.status === "presented" ? "info" : round.status === "changes_requested" ? "warning" : "neutral"}>{t(PRESENTATION_STATUS_LABEL[round.status])}</Badge>
          {round.chargeable ? <Badge tone="warning">{t("Chargeable")}</Badge> : null}</span>}
        action={round.status === "draft" && canEdit ? <span className={styles.inline}>
          <Button size="compact" variant="quiet" isLoading={busy === round.id} onPress={() => void act(round, "withdraw")}>{t("Discard")}</Button>
          <Button size="compact" variant="primary" isLoading={busy === round.id} onPress={() => void act(round, "present")}>{t("Present to client")}</Button>
        </span> : round.status === "presented" && canRecordClient ? <Button size="compact" onPress={() => setDeciding(round)}>{t("Record client's decision")}</Button> : undefined}
        footer={round.decidedAt ? <p className={styles.muted}>{[round.decidedByName, round.decisionSource ? t(SOURCE_LABEL[round.decisionSource] ?? round.decisionSource as never) : "", day(round.decidedAt), round.decisionNote].filter(Boolean).join(" · ")}</p>
          : round.presentedAt ? <p className={styles.muted}>{t("Presented {date}", { date: day(round.presentedAt) })}</p> : undefined}>
        <ul className={styles.cards}>{round.options.map((option) => <li className={styles.option} data-chosen={round.chosenOptionId === option.id || undefined} key={option.id}>
          <span className={styles.thumb} aria-hidden="true">{(() => {
            const asset = option.designId ? designs.find((design) => design.id === option.designId)?.versions[0]?.asset : undefined;
            // eslint-disable-next-line @next/next/no-img-element -- a private case file streamed through the signed-in route (case access checks apply)
            if (asset && (asset.hasPreview || asset.mimeType.startsWith("image/"))) return <img alt="" loading="lazy" src={caseApi(workspaceId, caseId, `assets/${asset.id}?preview=1`)} />;
            return option.linkUrl ? <LinkThumb workspaceId={workspaceId} url={option.linkUrl} /> : <ImageIcon size={20} />;
          })()}</span>
          <span className={styles.optionTitle}>{option.title}</span>
          {round.chosenOptionId === option.id ? <Badge tone="success">{t("Client's choice")}</Badge> : null}
          {option.linkUrl ? <a className={styles.link} href={option.linkUrl} rel="noreferrer" target="_blank">{isCanvaUrl(option.linkUrl) ? t("Open in Canva") : t("Open link")}<ExternalLink aria-hidden="true" size={12} data-directional="true" /></a>
            : option.designTitle ? <span className={styles.muted}>{option.designTitle}{option.versionNumber ? ` · V${option.versionNumber}` : ""}</span> : null}
        </li>)}</ul>
      </Card>)}
    </div>}
    {creating ? <PresentationForm workspaceId={workspaceId} stageDesigns={stageDesigns} onClose={() => setCreating(false)} onSubmit={async (options) => {
      done(t("Presentation ready. Present it when the reviewer is happy."), await caseRequest<PresentationsView>(workspaceId, caseId, "design-presentations", "POST", {
        id: crypto.randomUUID(), stage, options: options.map((option) => ({ id: option.id, title: option.title.trim(), linkUrl: option.mode === "link" ? option.linkUrl.trim() : null, designId: option.mode === "file" ? option.designId : null })),
      }));
      setCreating(false);
    }} /> : null}
    {deciding ? <RoundDecision round={deciding} clientName={clientName} onClose={() => setDeciding(null)} onSubmit={async (input) => {
      done(t("The client's decision is recorded."), await caseRequest<PresentationsView>(workspaceId, caseId, `design-presentations/${deciding.id}/decision`, "POST", { version: deciding.version, ...input }));
      setDeciding(null);
    }} /> : null}
  </section>;
}

function PresentationForm({ workspaceId, stageDesigns, onClose, onSubmit }: { workspaceId: string; stageDesigns: CaseDesign[]; onClose: () => void; onSubmit: (options: OptionDraft[]) => Promise<unknown> }) {
  const t = useT();
  const [options, setOptions] = useState<OptionDraft[]>(() => [newOption(), newOption()]);
  const patch = (id: string, value: Partial<OptionDraft>) => setOptions((items) => items.map((item) => item.id === id ? { ...item, ...value } : item));
  const valid = options.length > 0 && options.every((option) => option.title.trim() && (option.mode === "link" ? /^https:\/\/\S+$/.test(option.linkUrl.trim()) : Boolean(option.designId)));
  return <FormDialog title={t("New presentation")} onClose={onClose} isDirty submitLabel={t("Save")} isSubmitDisabled={!valid} onSubmit={() => onSubmit(options)}>
    {options.map((option, index) => <div className={styles.stack} key={option.id}>
      <div className={styles.optionRow}>
        <TextInput isRequired label={t("Option {number}", { number: index + 1 })} maxLength={240} value={option.title} onChange={(title) => patch(option.id, { title })} />
        {options.length > 1 ? <IconButton aria-label={t("Remove option {number}", { number: index + 1 })} variant="quiet" onPress={() => setOptions((items) => items.filter((item) => item.id !== option.id))}><Trash2 size={14} /></IconButton> : null}
      </div>
      <SegmentedControl label={t("Show as")} value={option.mode} onChange={(mode) => patch(option.id, { mode: mode as OptionDraft["mode"] })}
        options={[{ id: "link", label: t("Link") }, { id: "file", label: t("Uploaded design"), isDisabled: !stageDesigns.length }]} />
      {option.mode === "link" ? <><TextInput isRequired label={t("Link")} inputMode="url" placeholder="https://www.canva.com/design/…" maxLength={2000} value={option.linkUrl} onChange={(linkUrl) => patch(option.id, { linkUrl })} />
        <LinkPreview workspaceId={workspaceId} url={option.linkUrl} title={option.title} /></>
        : <SelectField isRequired label={t("Design")} items={stageDesigns.map((design) => ({ id: design.id, label: design.title }))} selectedKey={option.designId} onSelectionChange={(key) => patch(option.id, { designId: String(key) })} />}
    </div>)}
    {options.length < 12 ? <Button size="compact" variant="quiet" onPress={() => setOptions((items) => [...items, newOption()])}><Plus aria-hidden="true" size={14} />{t("Add option")}</Button> : null}
  </FormDialog>;
}

function RoundDecision({ round, clientName, onClose, onSubmit }: { round: Presentation; clientName?: string; onClose: () => void;
  onSubmit: (input: { decision: "chosen" | "changes_requested"; optionId: string | null; source: string; decidedBy: string; note: string | null }) => Promise<unknown> }) {
  const t = useT();
  const [decision, setDecision] = useState<"chosen" | "changes_requested">("chosen");
  const [optionId, setOptionId] = useState<string | null>(round.options[0]?.id ?? null);
  const [source, setSource] = useState<string>("meeting");
  const [decidedBy, setDecidedBy] = useState(clientName ?? "");
  const [note, setNote] = useState("");
  return <FormDialog title={t("Record client's decision")} onClose={onClose} isDirty submitLabel={t("Save")}
    isSubmitDisabled={!decidedBy.trim() || (decision === "chosen" ? !optionId : !note.trim())}
    onSubmit={() => onSubmit({ decision, optionId: decision === "chosen" ? optionId : null, source, decidedBy: decidedBy.trim(), note: note.trim() || null })}>
    <SegmentedControl label={t("Decision")} value={decision} onChange={(value) => setDecision(value as typeof decision)} options={[{ id: "chosen", label: t("Chose one") }, { id: "changes_requested", label: t("Wants changes") }]} />
    {decision === "chosen" ? <SelectField isRequired label={t("Option")} items={round.options.map((option) => ({ id: option.id, label: option.title }))} selectedKey={optionId} onSelectionChange={(key) => setOptionId(String(key))} /> : null}
    <SelectField isRequired label={t("Where")} items={DECISION_SOURCES.map((id) => ({ id, label: t(SOURCE_LABEL[id]) }))} selectedKey={source} onSelectionChange={(key) => setSource(String(key))} />
    <TextInput isRequired label={t("Who decided")} maxLength={200} value={decidedBy} onChange={setDecidedBy} />
    <TextAreaField isRequired={decision === "changes_requested"} label={decision === "changes_requested" ? t("What the client wants changed") : t("Note")} maxLength={2000} value={note} onChange={setNote} />
  </FormDialog>;
}

/** A link option's stored thumbnail (a Canva design's preview), or a link icon. */
function LinkThumb({ workspaceId, url }: { workspaceId: string; url: string }) {
  const { card } = useLinkCard(workspaceId, url);
  // eslint-disable-next-line @next/next/no-img-element -- the thumbnail copied into our storage, streamed through the signed-in route
  return card?.hasImage ? <img alt="" loading="lazy" src={linkCardImageUrl(workspaceId, card.id)} /> : <ExternalLink size={20} data-directional="true" />;
}

/** The option's link as a card once it's a full https link (after typing pauses). */
function LinkPreview({ workspaceId, url, title }: { workspaceId: string; url: string; title: string }) {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const next = url.trim();
    const timer = window.setTimeout(() => setSettled(/^https:\/\/[^\s/]+\.[^\s]+$/.test(next) ? next : ""), 600);
    return () => window.clearTimeout(timer);
  }, [url]);
  return settled ? <DesignLinkCard workspaceId={workspaceId} url={settled} title={title.trim() || undefined} /> : null;
}
