"use client";

import { ArrowDown, ArrowUp, Asterisk, CircleDot, History, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Badge, Button, ControlledModalDialog, DataGrid, ErrorState, FormDialog, IconButton, InlineNotice, MultiSelectField, ReviewDialog, SelectField, SettingsPage, SettingsSection, Skeleton, Switch,
  TagsField, TextInput, formatDate, useDesignSystem, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown, type MessageKey } from "@/lib/i18n/keys";
import {
  loadQuestionnaire, publishQuestionnaire, QUESTION_KIND_LABEL, restoreQuestionnaire, saveQuestionnaireDraft,
  type Question, type QuestionKind, type Questionnaire, type QuestionnairePurpose,
} from "@/lib/setup/questionnaires";
import styles from "./setup.module.css";

const KINDS: QuestionKind[] = ["text", "long_text", "number", "yes_no", "choice", "multi_choice", "date"];
const hasChoices = (kind: QuestionKind) => kind === "choice" || kind === "multi_choice";

/**
 * §0.3 P3: one questionnaire in Setup. Each change is saved to the draft at once; nothing reaches a job until the firm
 * publishes, after the health check, in a review that says what changes. Older versions can be made the draft again.
 */
export function QuestionnaireEditor({ workspaceId, purpose }: { workspaceId: string; purpose: QuestionnairePurpose }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [view, setView] = useState<Questionnaire | null>(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<{ index: number | null; question: Question } | null>(null);
  const [dialog, setDialog] = useState<"publish" | "versions" | null>(null);
  const load = useCallback(() => { setFailure(""); loadQuestionnaire(workspaceId, purpose).then(setView).catch((error: Error) => setFailure(error.message)); }, [workspaceId, purpose]);
  useEffect(() => { queueMicrotask(load); }, [load]);
  const label = (text: string) => translateKnown(t, text as MessageKey);

  const saveDraft = async (questions: Question[], message: string) => {
    if (!view) return;
    try {
      setView(await saveQuestionnaireDraft(workspaceId, purpose, view.revision, questions));
      setNotice(message);
    } catch (error) { setNotice(""); setFailure((error as Error).message); }
  };
  if (failure && !view) return <SettingsPage title={t("Questionnaires")}><ErrorState description={failure} onRetry={load} /></SettingsPage>;
  if (!view) return <SettingsPage title={t("Questionnaires")}><Skeleton lines={6} shape="rows" /></SettingsPage>;

  const questions = view.draft;
  const jobTypeName = (id: string) => view.jobTypes.find((type) => type.id === id)?.label ?? id;
  const move = (index: number, by: number) => {
    const next = [...questions];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    void saveDraft(next, t("Order saved to the draft."));
  };
  const columns: DataGridColumn<Question & { index: number }>[] = [
    { accessorKey: "label", header: t("Question"), size: 320, enableSorting: false, cell: ({ row: { original: question } }) => <span className={styles.nameCell}>
      <strong>{question.label}</strong>{question.help ? <small>{question.help}</small> : null}</span> },
    { id: "kind", header: t("Answer"), size: 150, enableSorting: false, cell: ({ row: { original: question } }) => <span className={styles.chips}>
      <Badge hue="auto">{translateKnown(t, QUESTION_KIND_LABEL[question.kind])}</Badge>
      {question.options?.length ? <span className={styles.muted}>{question.options.join(" · ")}</span> : null}</span> },
    { id: "rules", header: t("Asked"), size: 200, enableSorting: false, cell: ({ row: { original: question } }) => <span className={styles.chips}>
      {question.required ? <Badge tone="info">{t("Required")}</Badge> : <Badge tone="neutral">{t("Optional")}</Badge>}
      {question.jobTypes?.length ? question.jobTypes.map((type) => <Badge key={type} hue="auto">{jobTypeName(type)}</Badge>) : <span className={styles.muted}>{t("Every job")}</span>}</span> },
    { id: "actions", header: "", size: 150, enableSorting: false, cell: ({ row: { original: question } }) => <span className={styles.rowActions}>
      <IconButton aria-label={t("Move {name} up", { name: question.label })} isDisabled={question.index === 0} size="compact" variant="quiet" onPress={() => move(question.index, -1)}><ArrowUp aria-hidden="true" size={14} /></IconButton>
      <IconButton aria-label={t("Move {name} down", { name: question.label })} isDisabled={question.index === questions.length - 1} size="compact" variant="quiet" onPress={() => move(question.index, 1)}><ArrowDown aria-hidden="true" size={14} /></IconButton>
      <IconButton aria-label={t("Edit {name}", { name: question.label })} size="compact" variant="quiet" onPress={() => setEditing({ index: question.index, question })}><Pencil aria-hidden="true" size={14} /></IconButton>
      <IconButton aria-label={t("Remove {name}", { name: question.label })} size="compact" variant="quiet"
        onPress={() => void saveDraft(questions.filter((_, index) => index !== question.index), t("Question removed from the draft."))}><Trash2 aria-hidden="true" size={14} /></IconButton>
    </span> },
  ];
  const next = view.version + 1;
  return <SettingsPage title={label(view.name)} width="wide" actions={<>
    <Button size="compact" variant="secondary" onPress={() => setDialog("versions")}><History aria-hidden="true" size={14} />{t("Versions")}</Button>
    <Button size="compact" variant="primary" isDisabled={!view.draftChanged && view.version > 0} onPress={() => setDialog("publish")}>{t("Publish")}</Button>
  </>}>
    <div className={styles.status}>
      <Badge tone={view.version ? "success" : "neutral"}>{view.version ? t("Version {number} is live", { number: view.version }) : t("Kit questions are live")}</Badge>
      {view.draftChanged ? <Badge tone="warning">{t("Unpublished changes")}</Badge> : null}
      <span className={styles.muted}>{label(view.step)}</span>
    </div>
    {failure ? <InlineNotice tone="error" message={failure} /> : notice ? <InlineNotice tone="success" message={notice} /> : null}
    <SettingsSection id="questionnaire-questions" title={t("Questions")}
      actions={<Button size="compact" onPress={() => setEditing({ index: null, question: { key: "", label: "", kind: "text", required: false } })}><Plus aria-hidden="true" size={14} />{t("Add question")}</Button>}>
      <div data-sales-grid><DataGrid ariaLabel={t("Questions")} columns={columns} data={questions.map((question, index) => ({ ...question, index }))} getRowId={(question) => question.key || String(question.index)}
        rowNumbers={false} selectable={false} showToolbar={false} emptyTitle={t("No questions yet")} emptyDescription={t("Add the first question the team should ask.")}
        onRowAction={(question) => setEditing({ index: question.index, question })} /></div>
    </SettingsSection>

    {editing ? <QuestionDialog question={editing.question} jobTypes={view.jobTypes} onClose={() => setEditing(null)} onSave={async (question) => {
      const list = editing.index === null ? [...questions, question] : questions.map((item, index) => index === editing.index ? question : item);
      await saveDraft(list, editing.index === null ? t("Question added to the draft.") : t("Question saved to the draft."));
      setEditing(null);
    }} /> : null}

    {dialog === "publish" ? <ReviewDialog title={t("Publish version {number}", { number: next })}
      description={t("New jobs answer this version. Jobs that already answered keep theirs.")}
      facts={[{ icon: <ListChecks />, label: t("Questions"), value: t("{count} questions", { count: questions.length }) },
        { icon: <Asterisk />, label: t("Required"), value: String(questions.filter((question) => question.required).length) },
        { icon: <CircleDot />, label: t("Live now"), value: view.version ? t("Version {number}", { number: view.version }) : t("Kit questions") }]}
      checks={{ label: t("Health check"), items: view.problems.length ? view.problems.map((problem, index) => ({ id: String(index), label: problem, done: false }))
        : [{ id: "ok", label: t("Every question is ready"), done: true }] }}
      confirmLabel={t("Publish")}
      onClose={() => setDialog(null)}
      onConfirm={async (note) => {
        setView(await publishQuestionnaire(workspaceId, purpose, view.revision, note));
        setNotice(t("Version {number} is live.", { number: next }));
        setDialog(null);
      }} /> : null}

    {dialog === "versions" ? <ControlledModalDialog isOpen size="md" title={t("Versions")} onOpenChange={(open) => { if (!open) setDialog(null); }}>
      <ul className={styles.versions}>
        {view.versions.map((version) => <li key={version.number}>
          <span className={styles.versionText}><strong>{t("Version {number}", { number: version.number })}{version.number === view.version ? ` · ${t("Live")}` : ""}</strong>
            <small>{[formatDate(version.publishedAt, { locale, timeZone }), version.by, t("{count} questions", { count: version.questions }), version.note].filter(Boolean).join(" · ")}</small></span>
          <Button size="compact" variant="secondary" onPress={async () => {
            setView(await restoreQuestionnaire(workspaceId, purpose, view.revision, version.number));
            setNotice(t("Version {number} is now the draft. Publish it to make it live.", { number: version.number }));
            setDialog(null);
          }}>{t("Use as draft")}</Button>
        </li>)}
        <li>
          <span className={styles.versionText}><strong>{t("Kit questions")}</strong><small>{t("{count} questions", { count: view.kit.length })}</small></span>
          <Button size="compact" variant="secondary" onPress={async () => {
            setView(await restoreQuestionnaire(workspaceId, purpose, view.revision, 0));
            setNotice(t("The kit questions are now the draft. Publish them to make them live."));
            setDialog(null);
          }}>{t("Use as draft")}</Button>
        </li>
      </ul>
    </ControlledModalDialog> : null}
  </SettingsPage>;
}

function QuestionDialog({ question, jobTypes, onClose, onSave }: { question: Question; jobTypes: Array<{ id: string; label: string }>; onClose: () => void; onSave: (question: Question) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState<Question>(question);
  const set = <K extends keyof Question>(key: K) => (next: Question[K]) => setValue((current) => ({ ...current, [key]: next }));
  const save = async () => {
    if (!value.label.trim()) throw new Error(t("Write the question."));
    if (hasChoices(value.kind) && (value.options?.length ?? 0) < 2) throw new Error(t("Give at least two choices."));
    await onSave({ ...value, label: value.label.trim(), options: hasChoices(value.kind) ? value.options : undefined, jobTypes: value.jobTypes?.length ? value.jobTypes : undefined,
      help: value.help?.trim() || undefined });
  };
  return <FormDialog title={question.label ? t("Edit question") : t("New question")} isDirty={JSON.stringify(value) !== JSON.stringify(question)} onClose={onClose} onSubmit={save} submitLabel={t("Save")}>
    <TextInput isRequired label={t("Question")} maxLength={300} value={value.label} onChange={set("label")} />
    <div className={styles.row}>
      <SelectField isRequired label={t("Answer")} accent="neutral" selectedKey={value.kind} items={KINDS.map((kind) => ({ id: kind, label: translateKnown(t, QUESTION_KIND_LABEL[kind]) }))}
        onSelectionChange={(kind) => set("kind")(String(kind) as QuestionKind)} />
      {jobTypes.length ? <MultiSelectField label={t("Asked on")} items={jobTypes} selectedKeys={new Set(value.jobTypes ?? [])}
        onSelectionChange={(keys) => set("jobTypes")([...keys].map(String))} /> : null}
    </div>
    {hasChoices(value.kind) ? <TagsField label={t("Choices")} values={value.options ?? []} onChange={set("options")} placeholder={t("Type a choice and press Enter")} /> : null}
    <TextInput label={t("Help text")} maxLength={300} value={value.help ?? ""} onChange={set("help")} />
    <Switch isSelected={value.required} onChange={set("required")}>{t("Required before the step completes")}</Switch>
  </FormDialog>;
}
