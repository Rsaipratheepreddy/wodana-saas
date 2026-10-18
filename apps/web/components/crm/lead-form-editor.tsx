"use client";

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { DropIndicator, GridList, GridListItem, useDragAndDrop, type DropItem } from "react-aria-components";
import { AlignLeft, ArrowDown, ArrowUp, CalendarDays, CheckSquare, ChevronDown, CircleDot, Copy, GripVertical, Hash, LockKeyhole, Mail, Phone, Plus, Trash2, Type, X } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { createCustomField, customEnquiryField, customFieldRef, fieldQuestion, FIELD_TYPE_LABELS, NEW_FIELD_TYPES, type CustomEnquiryField, type EnquiryField, type EnquiryFieldType } from "@/lib/crm/enquiry-fields";
import { CustomFieldSheet } from "./enquiry-fields-settings";
import { Badge, Button, Form, IconButton, SelectField, Switch, TextAreaField, TextInput } from "@/design-system";
import { formQuestionTypes, type LeadFormQuestion, type LeadFormSchema } from "@/lib/crm/lead-forms";
import styles from "./lead-forms.module.css";

const FIELD_TYPE = "application/x-wodana-form-field";
const QUESTION_ID = "application/x-wodana-form-question";
/** Every enquiry needs these: they stay on the form and stay required, but their wording can change. */
export const SYSTEM_FIELDS = new Set(["displayName", "mobile", "emirate", "serviceType"]);
const choiceTypes = new Set(["radio", "dropdown", "checkboxes"]);
const fieldIcons = { text: Type, paragraph: AlignLeft, radio: CircleDot, checkboxes: CheckSquare, dropdown: ChevronDown, email: Mail, tel: Phone, number: Hash, date: CalendarDays, phone: Phone, select: ChevronDown, multi_select: CheckSquare };
const iconFor = (type: string) => fieldIcons[type as keyof typeof fieldIcons] ?? Type;
/** The question type names shown in the editor, by `formQuestionTypes` id. */
const questionTypeLabels: Record<string, MessageKey> = { text: tKey("Short answer"), paragraph: tKey("Paragraph"), radio: tKey("Multiple choice"), checkboxes: tKey("Checkboxes"), dropdown: tKey("Dropdown"), email: tKey("Email"), tel: tKey("Phone number"), number: tKey("Number"), date: tKey("Date") };
const noSubmit = (event: { preventDefault: () => void }) => event.preventDefault();

export function reorderQuestions(questions: LeadFormQuestion[], keys: Set<string>, target: string, position: "before" | "after") {
  if (keys.has(target) || !questions.some(question => question.id === target)) return questions;
  const moving = questions.filter(question => keys.has(question.id));
  const remaining = questions.filter(question => !keys.has(question.id));
  const index = remaining.findIndex(question => question.id === target) + (position === "after" ? 1 : 0);
  remaining.splice(index, 0, ...moving);
  return remaining;
}

/**
 * Form questions are enquiry fields: each question fills one field on the enquiry it creates.
 * Questions are one-line cards; one opens at a time to edit. "Add question" opens the field palette:
 * the workspace's enquiry fields, or a new field of any type (it becomes an enquiry column too).
 */
export function LeadFormEditor({ draft, setDraft, busy, fields, workspaceId, onFieldCreated, preview }: { draft: LeadFormSchema; setDraft: Dispatch<SetStateAction<LeadFormSchema | undefined>>; busy: boolean; fields: EnquiryField[]; workspaceId: string; onFieldCreated: (field: CustomEnquiryField) => void; /** The live public form, shown beside the questions on a wide screen. */ preview?: ReactNode }) {
  const t = useT();
  const questionTypes = formQuestionTypes.map(type => ({ ...type, label: questionTypeLabels[type.id] ? t(questionTypeLabels[type.id]) : type.label }));
  const typeLabel = (type: string) => questionTypes.find(item => item.id === type)?.label ?? type;
  const [creating, setCreating] = useState<EnquiryFieldType | null>(null);
  const [adding, setAdding] = useState(false);
  const available = fields.filter(field => field.visible && field.formField && !draft.questions.some(question => question.field === field.formField));
  const [linking, setLinking] = useState<string | null>(null);
  const [linkError, setLinkError] = useState("");
  const [open, setOpen] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [fresh, setFresh] = useState("");
  const [removed, setRemoved] = useState<{ question: LeadFormQuestion; index: number } | null>(null);
  const atLimit = draft.questions.length >= 50;
  const updateQuestion = (id: string, changes: Partial<LeadFormQuestion>) => setDraft(previous => previous && ({ ...previous, questions: previous.questions.map(question => question.id === id ? { ...question, ...changes } : question) }));

  // A new question slides in and comes into view, open for editing.
  useEffect(() => {
    if (!fresh) return;
    const card = document.querySelector(`[data-question="${fresh}"]`);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    card?.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [fresh]);
  useEffect(() => { if (!removed) return; const timer = window.setTimeout(() => setRemoved(null), 10_000); return () => window.clearTimeout(timer); }, [removed]);

  /** An older free question becomes one of the workspace's own enquiry fields, keeping its wording and choices. */
  const makeField = async (question: LeadFormQuestion) => {
    const type: EnquiryFieldType = question.type === "paragraph" ? "paragraph" : question.type === "number" ? "number" : question.type === "date" ? "date" : ["dropdown", "radio"].includes(question.type) ? "select" : question.type === "checkboxes" ? "multi_select" : "text";
    const options = [...new Set(question.options.map(option => option.label.trim()).filter(Boolean))];
    setLinking(question.id); setLinkError("");
    try {
      const saved = await createCustomField(workspaceId, { label: question.title.trim() || t("Untitled field"), type, options, position: fields.filter(field => field.custom).length + 1 });
      onFieldCreated(saved);
      const shaped = fieldQuestion(customEnquiryField(saved));
      updateQuestion(question.id, { field: customFieldRef(saved.id), type: shaped.type, options: shaped.options });
    } catch (cause) { setLinkError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setLinking(null); }
  };
  /** Points a question at another enquiry field: its answer type and choices follow the field; the wording stays. */
  const relink = (question: LeadFormQuestion, key: string) => {
    const field = fields.find(item => item.formField === key);
    if (!field) return;
    const shaped = fieldQuestion(field);
    updateQuestion(question.id, { field: shaped.field, type: shaped.type, options: shaped.options });
  };
  const add = (key: string, target?: { id: string; position: string }, copy?: LeadFormQuestion, created?: EnquiryField) => {
    const field = created ?? fields.find(item => item.key === key);
    if (busy || atLimit || (!copy && !field?.formField)) return;
    const question: LeadFormQuestion = copy
      ? { ...structuredClone(copy), id: crypto.randomUUID(), field: "custom", title: t("{title} (copy)", { title: copy.title }), required: false }
      : fieldQuestion(field!);
    setDraft(previous => {
      if (!previous || previous.questions.length >= 50) return previous;
      const questions = [...previous.questions];
      const index = target ? questions.findIndex(item => item.id === target.id) : -1;
      questions.splice(index < 0 ? questions.length : index + (target?.position === "after" ? 1 : 0), 0, question);
      return { ...previous, questions };
    });
    setOpen(question.id); setFresh(question.id);
    setAnnouncement(t("{name} added.", { name: question.title }));
  };
  const insert = async (items: DropItem[], target?: { id: string; position: string }) => {
    const item = items.find(item => item.kind === "text" && item.types.has(FIELD_TYPE));
    if (item?.kind === "text") add(await item.getText(FIELD_TYPE), target);
  };
  const { dragAndDropHooks: paletteDrag } = useDragAndDrop<EnquiryField>({
    isDisabled: busy || atLimit,
    getItems: (_keys, items) => items.map(item => ({ [FIELD_TYPE]: item.key, "text/plain": item.label })),
    getAllowedDropOperations: () => ["copy"],
  });
  const { dragAndDropHooks: questionDrag } = useDragAndDrop<LeadFormQuestion>({
    isDisabled: busy,
    getItems: (_keys, items) => items.map(item => ({ [QUESTION_ID]: item.id, "text/plain": item.title })),
    getAllowedDropOperations: () => ["move"],
    acceptedDragTypes: [FIELD_TYPE, QUESTION_ID],
    getDropOperation: (_target, types) => types.has(FIELD_TYPE) ? atLimit ? "cancel" : "copy" : "move",
    onInsert: event => { void insert(event.items, { id: String(event.target.key), position: event.target.dropPosition }); },
    onRootDrop: event => { void insert(event.items); },
    onReorder: event => {
      if (event.target.dropPosition === "on") return;
      const position = event.target.dropPosition;
      setDraft(previous => previous && ({ ...previous, questions: reorderQuestions(previous.questions, new Set([...event.keys].map(String)), String(event.target.key), position) }));
      setAnnouncement(t("Field order updated."));
    },
    renderDropIndicator: target => <DropIndicator target={target} className={styles.dropIndicator} />,
    renderDragPreview: items => <div className={styles.dragPreview}><GripVertical size={16} />{String(items[0]?.["text/plain"] ?? t("Field"))}</div>,
  });
  const move = (question: LeadFormQuestion, direction: number) => {
    const index = draft.questions.findIndex(item => item.id === question.id);
    const target = draft.questions[index + direction];
    if (!target || busy) return;
    setDraft(previous => previous && ({ ...previous, questions: reorderQuestions(previous.questions, new Set([question.id]), target.id, direction < 0 ? "before" : "after") }));
    setAnnouncement(direction < 0 ? t("{name} moved up.", { name: question.title }) : t("{name} moved down.", { name: question.title }));
  };
  const remove = (question: LeadFormQuestion, index: number) => {
    if (busy || SYSTEM_FIELDS.has(question.field ?? "")) return;
    setDraft(previous => previous && ({ ...previous, questions: previous.questions.filter(item => item.id !== question.id) }));
    if (open === question.id) setOpen("");
    setRemoved({ question, index });
    setAnnouncement(question.title ? t("{name} deleted.", { name: question.title }) : t("Field deleted."));
  };
  const undo = () => {
    if (!removed) return;
    setDraft(previous => {
      if (!previous || previous.questions.some(item => item.id === removed.question.id || (removed.question.field && removed.question.field !== "custom" && item.field === removed.question.field))) return previous;
      const questions = [...previous.questions]; questions.splice(Math.min(removed.index, questions.length), 0, removed.question);
      return { ...previous, questions };
    });
    setAnnouncement(t("{name} restored.", { name: removed.question.title || t("Field") }));
    setRemoved(null);
  };

  return <div className={styles.builder} data-preview={preview ? "" : undefined}>
    <section className={styles.canvas} aria-label={t("Form fields")}>
      <Form className={styles.intro} fieldMarkers="optional" errorSummary={false} onSubmit={noSubmit}>
        <TextInput label={t("Form title")} isRequired value={draft.title} maxLength={160} isDisabled={busy} onChange={title => setDraft(previous => previous && ({ ...previous, title }))} />
        <TextAreaField label={t("Form description")} value={draft.description} maxLength={2000} isDisabled={busy} onChange={description => setDraft(previous => previous && ({ ...previous, description }))} />
      </Form>
      <GridList aria-label={t("Reorder form fields")} className={styles.questionList} items={draft.questions} dragAndDropHooks={questionDrag} dependencies={[open, busy, fresh, draft.questions, linking, linkError, available]} keyboardNavigationBehavior="tab" renderEmptyState={() => <p className={styles.hint}>{t("Drop an enquiry field here.")}</p>}>
        {question => {
          const index = draft.questions.findIndex(item => item.id === question.id);
          const system = SYSTEM_FIELDS.has(question.field ?? "");
          const linked = Boolean(question.field && question.field !== "custom");
          const isOpen = open === question.id;
          const Icon = iconFor(question.type);
          const name = question.title || t("Untitled field");
          const current = fields.find(field => field.formField === question.field);
          const targets = [...(current ? [current] : []), ...available].map(field => ({ id: field.formField!, label: field.label }));
          return <GridListItem id={question.id} textValue={name} className={styles.card} data-open={isOpen || undefined} data-fresh={fresh === question.id || undefined}>
            <div className={styles.cardRow} data-question={question.id}>
              <IconButton slot="drag" className={styles.dragHandle} aria-label={question.title ? t("Drag {name} to reorder", { name: question.title }) : t("Drag field to reorder")} isDisabled={busy} size="compact"><GripVertical size={16} /></IconButton>
              <Button variant="quiet" className={styles.cardSummary} isDisabled={busy} aria-expanded={isOpen} onPress={() => setOpen(isOpen ? "" : question.id)}>
                <span className={styles.typeIcon} aria-hidden="true"><Icon size={15} /></span>
                <span className={styles.cardLabel}>{name}</span>
                <Badge className={styles.typeChip}>{typeLabel(question.type)}</Badge>
                {question.required ? <Badge tone="info">{t("Required")}</Badge> : null}
              </Button>
              {system && <span className={styles.lock} title={t("Always on this form")}><LockKeyhole size={14} aria-hidden="true" /><span className="wd-visually-hidden">{t("Always on this form")}</span></span>}
              <IconButton aria-label={question.title ? t("Move {name} up", { name: question.title }) : t("Move field up")} size="compact" isDisabled={index === 0 || busy} onPress={() => move(question, -1)}><ArrowUp size={14} /></IconButton>
              <IconButton aria-label={question.title ? t("Move {name} down", { name: question.title }) : t("Move field down")} size="compact" isDisabled={index === draft.questions.length - 1 || busy} onPress={() => move(question, 1)}><ArrowDown size={14} /></IconButton>
              {!system && <IconButton className={styles.deleteField} aria-label={question.title ? t("Delete {name}", { name: question.title }) : t("Delete field")} size="compact" isDisabled={busy} onPress={() => remove(question, index)}><Trash2 size={14} /></IconButton>}
            </div>
            {isOpen && <Form className={styles.cardEditor} fieldMarkers="optional" errorSummary={false} onSubmit={noSubmit}>
              <TextInput label={t("Field label")} isRequired value={question.title} maxLength={240} autoFocus={fresh === question.id} isDisabled={busy} isInvalid={!question.title.trim()} errorMessage={t("Give this question a label before publishing.")} onChange={title => updateQuestion(question.id, { title })} />
                <SelectField label={t("Answer type")} isDisabled={linked || busy} items={questionTypes} selectedKey={question.type} onSelectionChange={key => { const type = String(key); updateQuestion(question.id, { type, options: choiceTypes.has(type) ? question.options.length ? question.options : [1, 2].map(number => ({ id: crypto.randomUUID(), label: t("Option {number}", { number }) })) : [] }); }} />
              <TextInput label={t("Help text")} value={question.description} maxLength={1000} isDisabled={busy} onChange={description => updateQuestion(question.id, { description })} />
              {choiceTypes.has(question.type) && (linked
                ? <p className={styles.choiceSummary}><strong>{t("Choices")}</strong> {question.options.map(option => option.label).join(" · ") || t("Choices come from Settings → Fields.")}</p>
                : <fieldset className={styles.optionList}><legend>{t("Choices")}</legend>
                  {question.options.map((option, optionIndex) => <div className={styles.optionRow} key={option.id}><TextInput label={t("Option {number}", { number: optionIndex + 1 })} isRequired value={option.label} maxLength={160} isInvalid={!option.label.trim()} onChange={label => updateQuestion(question.id, { options: question.options.map(item => item.id === option.id ? { ...item, label } : item) })} /><IconButton aria-label={t("Remove option {number}", { number: optionIndex + 1 })} onPress={() => updateQuestion(question.id, { options: question.options.filter(item => item.id !== option.id) })}><X size={14} /></IconButton></div>)}
                  <Button size="compact" variant="quiet" isDisabled={question.options.length >= 50} onPress={() => updateQuestion(question.id, { options: [...question.options, { id: crypto.randomUUID(), label: t("Option {number}", { number: question.options.length + 1 }) }] })}><Plus size={14} />{t("Add option")}</Button>
                </fieldset>)}
              <div className={styles.savesTo}>
                <SelectField label={t("Saves to")} isRequired placeholder={t("Not saved to the enquiry yet")} isDisabled={system || busy} items={targets} selectedKey={linked ? question.field : null} isInvalid={!linked} errorMessage={t("Choose the enquiry field this answer fills.")} onSelectionChange={key => { if (key) relink(question, String(key)); }} />
                {!linked && <Button size="compact" isLoading={linking === question.id} isDisabled={busy || (choiceTypes.has(question.type) && !question.options.some(option => option.label.trim()))} onPress={() => void makeField(question)}>{t("Make it a field")}</Button>}
              </div>
              {linkError && linking === null ? <p role="alert" className={styles.error}>{linkError}</p> : null}
              <footer className={styles.cardFooter}>
                <Switch isSelected={question.required} isDisabled={system || busy} onChange={required => updateQuestion(question.id, { required })}>{t("Required")}</Switch>
                {!linked && <Button size="compact" variant="quiet" isDisabled={atLimit || busy} onPress={() => add(question.type, { id: question.id, position: "after" }, question)}><Copy size={14} />{t("Duplicate")}</Button>}
              </footer>
            </Form>}
          </GridListItem>;
        }}
      </GridList>
      {removed && <div className={styles.undo} role="status"><span>{removed.question.title ? t("{name} deleted.", { name: removed.question.title }) : t("Field deleted.")}</span><Button size="compact" variant="quiet" onPress={undo}>{t("Undo")}</Button></div>}
      <Button className={styles.addQuestion} isDisabled={busy} aria-expanded={adding} onPress={() => setAdding(value => !value)}>{adding ? <X size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}{adding ? t("Close") : t("Add question")}</Button>
      {adding && <aside className={styles.palette} aria-label={t("Enquiry fields")}>
        <h3>{t("Enquiry fields")}</h3>
        <GridList aria-label={t("Enquiry fields")} className={styles.paletteGrid} items={available} dragAndDropHooks={paletteDrag} dependencies={[busy, atLimit, available]} layout="grid" keyboardNavigationBehavior="tab" renderEmptyState={() => <p className={styles.hint}>{t("Every field is on this form.")}</p>}>
          {item => {
            const Icon = iconFor(item.type);
            return <GridListItem id={item.key} textValue={item.label} className={styles.paletteItem}>
              <Button variant="quiet" className={styles.paletteTile} aria-label={t("Add {name}", { name: item.label })} isDisabled={busy || atLimit} onPress={() => add(item.key)}><span className={styles.typeIcon} aria-hidden="true"><Icon size={15} /></span><span>{item.label}</span></Button>
            </GridListItem>;
          }}
        </GridList>
        <h3>{t("New field")}</h3>
        <div className={styles.paletteGrid} role="group" aria-label={t("New field")}>
          {NEW_FIELD_TYPES.map(type => { const Icon = iconFor(type); return <Button key={type} variant="quiet" className={styles.paletteTile} isDisabled={busy || atLimit} onPress={() => setCreating(type)}><span className={styles.typeIcon} aria-hidden="true"><Icon size={15} /></span><span>{t(FIELD_TYPE_LABELS[type])}</span></Button>; })}
        </div>
        {atLimit && <p role="status" className={styles.hint}>{t("50-field limit reached.")}</p>}
      </aside>}
      <p role="status" className="wd-visually-hidden">{announcement}</p>
    </section>
    {preview ? <aside className={styles.livePreview} aria-label={t("Live preview")}>{preview}</aside> : null}
    {creating ? <CustomFieldSheet workspaceId={workspaceId} type={creating} position={fields.filter(field => field.custom).length + 1} onClose={() => setCreating(null)}
      onSaved={saved => { onFieldCreated(saved); setCreating(null); add("", undefined, undefined, customEnquiryField(saved)); }} /> : null}
  </div>;
}
