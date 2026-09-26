"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { DropIndicator, GridList, GridListItem, useDragAndDrop, type DropItem } from "react-aria-components";
import { AlignLeft, ArrowDown, ArrowUp, CalendarDays, CheckSquare, ChevronDown, CircleDot, Copy, GripVertical, Hash, LockKeyhole, Mail, Phone, Plus, Trash2, Type } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { createCustomField, customEnquiryField, customFieldRef, fieldQuestion, type CustomEnquiryField, type EnquiryField, type EnquiryFieldType } from "@/lib/crm/enquiry-fields";
import { CustomFieldSheet } from "./enquiry-fields-settings";
import { Button, Checkbox, IconButton, SelectField, TextInput } from "@/design-system";
import { formQuestionTypes, type LeadFormQuestion, type LeadFormSchema } from "@/lib/crm/lead-forms";
import styles from "./lead-forms.module.css";

const FIELD_TYPE = "application/x-wodana-form-field";
const QUESTION_ID = "application/x-wodana-form-question";
const requiredFields = new Set(["displayName", "mobile", "emirate", "serviceType"]);
const choiceTypes = new Set(["radio", "dropdown", "checkboxes"]);
const fieldIcons = { text: Type, paragraph: AlignLeft, radio: CircleDot, checkboxes: CheckSquare, dropdown: ChevronDown, email: Mail, tel: Phone, number: Hash, date: CalendarDays, phone: Phone, select: ChevronDown, multi_select: CheckSquare };

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
 * Add a field from the list, or create a new one (it becomes an enquiry column too).
 */
export function LeadFormEditor({ draft, setDraft, busy, fields, workspaceId, onFieldCreated }: { draft: LeadFormSchema; setDraft: Dispatch<SetStateAction<LeadFormSchema | undefined>>; busy: boolean; fields: EnquiryField[]; workspaceId: string; onFieldCreated: (field: CustomEnquiryField) => void }) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const available = fields.filter(field => field.visible && field.formField && !draft.questions.some(question => question.field === field.formField));
  const linkedName = (field?: string) => fields.find(item => item.formField === field)?.label;
  const [linking, setLinking] = useState<string | null>(null);
  const [linkError, setLinkError] = useState("");
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
  const [selected, setSelected] = useState(draft.questions[0]?.id ?? "");
  const [announcement, setAnnouncement] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const atLimit = draft.questions.length >= 50;
  const select = (id: string) => {
    setSelected(id);
    setNewQuestion(id);
  };
  const add = (key: string, target?: { id: string; position: string }, copy?: LeadFormQuestion, created?: EnquiryField) => {
    const field = created ?? fields.find(item => item.key === key);
    if (busy || atLimit || (!copy && !field?.formField)) return;
    const question: LeadFormQuestion = copy
      ? { ...structuredClone(copy), id: crypto.randomUUID(), field: "custom", title: `${copy.title} (copy)`, required: false }
      : fieldQuestion(field!);
    setDraft(previous => {
      if (!previous || previous.questions.length >= 50) return previous;
      const questions = [...previous.questions];
      const index = target ? questions.findIndex(item => item.id === target.id) : -1;
      questions.splice(index < 0 ? questions.length : index + (target?.position === "after" ? 1 : 0), 0, question);
      return { ...previous, questions };
    });
    select(question.id);
    setAnnouncement(`${question.title} added. Edit its label in Field settings.`);
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
      setAnnouncement("Field order updated.");
    },
    renderDropIndicator: target => <DropIndicator target={target} className={styles.dropIndicator} />,
    renderDragPreview: items => <div className={styles.dragPreview}><GripVertical size={16} />{String(items[0]?.["text/plain"] ?? "Field")}</div>,
  });
  const updateQuestion = (id: string, changes: Partial<LeadFormQuestion>) => setDraft(previous => previous && ({ ...previous, questions: previous.questions.map(question => question.id === id ? { ...question, ...changes } : question) }));
  const move = (question: LeadFormQuestion, direction: number) => {
    const index = draft.questions.findIndex(item => item.id === question.id);
    const target = draft.questions[index + direction];
    if (!target || busy) return;
    setDraft(previous => previous && ({ ...previous, questions: reorderQuestions(previous.questions, new Set([question.id]), target.id, direction < 0 ? "before" : "after") }));
    setAnnouncement(`${question.title} moved ${direction < 0 ? "up" : "down"}.`);
  };
  const remove = (question: LeadFormQuestion, index: number) => {
    if (busy || requiredFields.has(question.field ?? "")) return;
    setDraft(previous => previous && ({ ...previous, questions: previous.questions.filter(item => item.id !== question.id) }));
    if (selected === question.id) setSelected(draft.questions[index - 1]?.id ?? draft.questions[index + 1]?.id ?? "");
    setAnnouncement(`${question.title || "Field"} deleted.`);
  };
  return <div className={styles.editorLayout}>
    <aside className={styles.fieldPalette} aria-label={t("Enquiry fields")}>
      <h3>{t("Enquiry fields")}</h3>
      <GridList aria-label={t("Enquiry fields")} className={styles.paletteList} items={available} dragAndDropHooks={paletteDrag} dependencies={[busy, atLimit, available]} keyboardNavigationBehavior="tab" renderEmptyState={() => <p className={styles.hint}>{t("Every field is on this form.")}</p>}>
        {item => {
          const Icon = fieldIcons[item.type as keyof typeof fieldIcons] ?? Type;
          return <GridListItem id={item.key} textValue={item.label} className={styles.paletteItem}>
            <IconButton slot="drag" aria-label={t("Drag {name} into form", { name: item.label })} isDisabled={busy || atLimit} className={styles.dragHandle}><GripVertical size={15} /></IconButton>
            <Button variant="quiet" className={styles.paletteAdd} aria-label={t("Add {name}", { name: item.label })} isDisabled={busy || atLimit} onPress={() => add(item.key)}><Icon size={16} /><span>{item.label}</span><Plus size={14} /></Button>
          </GridListItem>;
        }}
      </GridList>
      <Button size="compact" isDisabled={busy || atLimit} onPress={() => setCreating(true)}><Plus aria-hidden="true" size={14} />{t("New field")}</Button>
      {atLimit && <p role="status" className={styles.hint}>50-field limit reached.</p>}
    </aside>
    <section className={styles.formCanvas} aria-label="Form fields">
      <div className={styles.formIntro}>
        <input className={styles.formTitle} aria-label="Form title" placeholder="Add a form title" value={draft.title} maxLength={160} disabled={busy} onChange={event => { const title = event.target.value; setDraft(previous => previous && ({ ...previous, title })); }} />
        <textarea className={styles.formDescription} aria-label="Form description" placeholder="Add a description or instructions for your form" rows={2} value={draft.description} maxLength={2000} disabled={busy} onChange={event => { const description = event.target.value; setDraft(previous => previous && ({ ...previous, description })); }} />
      </div>
      <GridList aria-label="Reorder form fields" className={styles.questionList} items={draft.questions} dragAndDropHooks={questionDrag} dependencies={[selected, busy, newQuestion, draft.questions]} keyboardNavigationBehavior="tab" renderEmptyState={() => <p>{t("Drop an enquiry field here.")}</p>}>
        {question => {
          const index = draft.questions.findIndex(item => item.id === question.id);
          const required = requiredFields.has(question.field ?? "");
          const linked = Boolean(question.field && question.field !== "custom");
          return <GridListItem id={question.id} textValue={question.title || "Untitled field"} className={styles.questionCard} data-editing={selected === question.id || undefined}>
            <div className={styles.questionTop}>
              <IconButton slot="drag" className={styles.dragHandle} aria-label={`Drag ${question.title || "field"} to reorder`} isDisabled={busy}><GripVertical size={17} /></IconButton>
              <Button variant="quiet" className={styles.questionSelect} isDisabled={busy} onPress={() => setSelected(question.id)} aria-expanded={selected === question.id}>
                <span className={styles.fieldNumber}>{index + 1}</span><span>{question.title || "Untitled field"}{question.required ? " *" : ""}<small>{formQuestionTypes.find(type => type.id === question.type)?.label}</small></span>
              </Button>
              {required && <span title="Required enquiry detail" className={styles.lockedField}><LockKeyhole size={13} /><span className="wd-visually-hidden">Required enquiry detail</span></span>}
              <IconButton aria-label={`Move ${question.title || "field"} up`} size="compact" isDisabled={index === 0 || busy} onPress={() => move(question, -1)}><ArrowUp size={14} /></IconButton>
              <IconButton aria-label={`Move ${question.title || "field"} down`} size="compact" isDisabled={index === draft.questions.length - 1 || busy} onPress={() => move(question, 1)}><ArrowDown size={14} /></IconButton>
              {!required && <Button size="compact" variant="quiet" className={styles.deleteField} aria-label={`Delete ${question.title || "field"}`} isDisabled={busy} onPress={() => remove(question, index)}><Trash2 size={15} /><span>Delete</span></Button>}
            </div>
            <div className={styles.fieldExample} aria-hidden="true">
              <p>{question.description || "Add help text for this field"}</p>
              <div data-type={question.type}>{choiceTypes.has(question.type) ? question.options.map(option => option.label).join(" · ") || "Select an option" : question.type === "date" ? "Select a date" : "Answer will be written here"}{question.type === "dropdown" && <ChevronDown size={14} />}</div>
            </div>
            {selected === question.id && <fieldset disabled={busy} className={styles.inlineQuestionEditor}>
              <div className={styles.questionFields}>
                <TextInput label="Field label" value={question.title} maxLength={240} autoFocus={newQuestion === question.id} onChange={title => updateQuestion(question.id, { title })} />
                {linked ? <div className={styles.linkedType}><span>Field type</span><strong>{formQuestionTypes.find(type => type.id === question.type)?.label}</strong></div> : <SelectField label="Field type" items={formQuestionTypes} selectedKey={question.type} onSelectionChange={key => { const type = String(key); updateQuestion(question.id, { type, options: choiceTypes.has(type) ? question.options.length ? question.options : [1, 2].map(number => ({ id: crypto.randomUUID(), label: `Option ${number}` })) : [] }); }} />}
              </div>
              <TextInput label="Help text · optional" value={question.description} maxLength={1000} onChange={description => updateQuestion(question.id, { description })} />
              {choiceTypes.has(question.type) && <div className={styles.optionList}>
                {linked ? <><p className={styles.hint}>{t("Choices come from Settings → Fields.")}</p><p className={styles.choiceSummary}>{question.options.map(option => option.label).join(" · ") || "No choices configured yet."}</p></> : <>
                  {question.options.map((option, optionIndex) => <div className={styles.optionRow} key={option.id}><TextInput label={`Option ${optionIndex + 1}`} value={option.label} maxLength={160} onChange={label => updateQuestion(question.id, { options: question.options.map(item => item.id === option.id ? { ...item, label } : item) })} /><IconButton aria-label={`Remove option ${optionIndex + 1}`} onPress={() => updateQuestion(question.id, { options: question.options.filter(item => item.id !== option.id) })}><Trash2 size={14} /></IconButton></div>)}
                  <Button size="compact" variant="quiet" isDisabled={question.options.length >= 50} onPress={() => updateQuestion(question.id, { options: [...question.options, { id: crypto.randomUUID(), label: `Option ${question.options.length + 1}` }] })}><Plus size={14} />Add option</Button>
                </>}
              </div>}
              {linked ? <p className={styles.hint}>{t("Saves to")} · {linkedName(question.field) ?? t("A removed field")}{required ? ` · ${t("Required")}` : ""}</p> : <div className={styles.hint}>{t("Not saved to the enquiry yet.")} <Button size="compact" isLoading={linking === question.id} isDisabled={busy || (choiceTypes.has(question.type) && !question.options.some(option => option.label.trim()))} onPress={() => void makeField(question)}>{t("Make it a field")}</Button>{linkError && linking === null ? <span role="alert"> {linkError}</span> : null}</div>}
              <footer className={styles.questionFooter}>
                <Checkbox isSelected={question.required} isDisabled={required || busy} onChange={value => updateQuestion(question.id, { required: value })}>Required</Checkbox>
                {!linked && <Button size="compact" variant="quiet" isDisabled={atLimit || busy} onPress={() => add(question.type, { id: question.id, position: "after" }, question)}><Copy size={14} />Duplicate</Button>}
              </footer>
            </fieldset>}
          </GridListItem>;
        }}
      </GridList>
      <p role="status" className="wd-visually-hidden">{announcement}</p>
    </section>
    {creating ? <CustomFieldSheet workspaceId={workspaceId} position={fields.filter(field => field.custom).length + 1} onClose={() => setCreating(false)}
      onSaved={saved => { onFieldCreated(saved); setCreating(false); add("", undefined, undefined, customEnquiryField(saved)); }} /> : null}
  </div>;
}
