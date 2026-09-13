"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { DropIndicator, GridList, GridListItem, useDragAndDrop, type DropItem } from "react-aria-components";
import { AlignLeft, ArrowDown, ArrowUp, CalendarDays, CheckSquare, ChevronDown, CircleDot, Copy, GripVertical, Hash, LockKeyhole, Mail, Phone, Plus, Trash2, Type } from "lucide-react";
import { Button, Checkbox, IconButton, SelectField, TextAreaField, TextInput } from "@/design-system";
import { formQuestionTypes, type LeadFormQuestion, type LeadFormSchema } from "@/lib/crm/lead-forms";
import { PublicEnquiryFormView } from "./public-enquiry-form";
import styles from "./lead-forms.module.css";

const FIELD_TYPE = "application/x-wodana-form-field";
const QUESTION_ID = "application/x-wodana-form-question";
const requiredFields = new Set(["displayName", "email", "mobile", "location"]);
const choiceTypes = new Set(["radio", "dropdown", "checkboxes"]);
const fieldIcons = { text: Type, paragraph: AlignLeft, radio: CircleDot, checkboxes: CheckSquare, dropdown: ChevronDown, email: Mail, tel: Phone, number: Hash, date: CalendarDays };
const linkedNames: Record<string, string> = { displayName: "Customer name", mobile: "Mobile number", email: "Email", location: "Property location", serviceType: "Enquiry type", budgetRange: "Budget", summary: "Project summary" };

export function reorderQuestions(questions: LeadFormQuestion[], keys: Set<string>, target: string, position: "before" | "after") {
  if (keys.has(target) || !questions.some(question => question.id === target)) return questions;
  const moving = questions.filter(question => keys.has(question.id));
  const remaining = questions.filter(question => !keys.has(question.id));
  const index = remaining.findIndex(question => question.id === target) + (position === "after" ? 1 : 0);
  remaining.splice(index, 0, ...moving);
  return remaining;
}

export function LeadFormEditor({ draft, setDraft, busy }: { draft: LeadFormSchema; setDraft: Dispatch<SetStateAction<LeadFormSchema | undefined>>; busy: boolean }) {
  const [selected, setSelected] = useState(draft.questions[0]?.id ?? "");
  const [announcement, setAnnouncement] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [previewVersion, setPreviewVersion] = useState(0);
  const previewScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = previewScroll.current;
    const field = container?.querySelector<HTMLElement>(`[data-question-id="${CSS.escape(selected)}"]`);
    if (!container || !field) return;
    const bounds = container.getBoundingClientRect(), target = field.getBoundingClientRect();
    if (target.bottom > bounds.bottom) container.scrollTop += target.bottom - bounds.bottom + 12;
    else if (target.top < bounds.top) container.scrollTop += target.top - bounds.top - 12;
  }, [selected]);
  const atLimit = draft.questions.length >= 50;
  const select = (id: string) => {
    setSelected(id);
    setNewQuestion(id);
  };
  const add = (type: string, target?: { id: string; position: string }, copy?: LeadFormQuestion) => {
    if (busy || atLimit || !formQuestionTypes.some(item => item.id === type)) return;
    const question: LeadFormQuestion = copy
      ? { ...structuredClone(copy), id: crypto.randomUUID(), field: "custom", title: `${copy.title} (copy)`, required: false }
      : { id: crypto.randomUUID(), field: "custom", title: formQuestionTypes.find(item => item.id === type)!.label, type, description: "", required: false, options: choiceTypes.has(type) ? [1, 2].map(number => ({ id: crypto.randomUUID(), label: `Option ${number}` })) : [] };
    setDraft(previous => {
      if (!previous || previous.questions.length >= 50) return previous;
      const questions = [...previous.questions];
      const index = target ? questions.findIndex(item => item.id === target.id) : -1;
      questions.splice(index < 0 ? questions.length : index + (target?.position === "after" ? 1 : 0), 0, question);
      return { ...previous, questions };
    });
    select(question.id);
    setAnnouncement(`${question.title} added. Edit its label below.`);
  };
  const insert = async (items: DropItem[], target?: { id: string; position: string }) => {
    const item = items.find(item => item.kind === "text" && item.types.has(FIELD_TYPE));
    if (item?.kind === "text") add(await item.getText(FIELD_TYPE), target);
  };
  const { dragAndDropHooks: paletteDrag } = useDragAndDrop<(typeof formQuestionTypes)[number]>({
    isDisabled: busy || atLimit,
    getItems: (_keys, items) => items.map(item => ({ [FIELD_TYPE]: item.id, "text/plain": item.label })),
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
  return <div className={styles.editorLayout}>
    <aside className={styles.fieldPalette} aria-label="Add fields">
      <h3>Add fields</h3><p className={styles.hint}>Drag into your form, or click + to add.</p>
      <GridList aria-label="Field types" className={styles.paletteList} items={formQuestionTypes} dragAndDropHooks={paletteDrag} dependencies={[busy, atLimit]} keyboardNavigationBehavior="tab">
        {item => {
          const Icon = fieldIcons[item.id as keyof typeof fieldIcons];
          return <GridListItem id={item.id} textValue={item.label} className={styles.paletteItem}>
            <IconButton slot="drag" aria-label={`Drag ${item.label.toLowerCase()} into form`} isDisabled={busy || atLimit} className={styles.dragHandle}><GripVertical size={15} /></IconButton>
            <Button variant="quiet" className={styles.paletteAdd} aria-label={`Add ${item.label.toLowerCase()}`} isDisabled={busy || atLimit} onPress={() => add(item.id)}><Icon size={16} /><span>{item.label}</span><Plus size={14} /></Button>
          </GridListItem>;
        }}
      </GridList>
      <p className={styles.hint}>Name, mobile, email and location stay linked to each lead.</p>
      {atLimit && <p role="status" className={styles.hint}>50-field limit reached.</p>}
    </aside>
    <section className={styles.formCanvas} aria-label="Form fields">
      <div className={styles.sectionHeading}><h3>Your form</h3><span>{draft.questions.length} / 50 fields</span></div>
      <p className={styles.hint}>Click a field to edit. Drag to reorder, or use the arrows.</p>
      <div className={styles.formIntro}>
        <TextInput label="Form title" value={draft.title} maxLength={160} isDisabled={busy} onChange={title => setDraft(previous => previous && ({ ...previous, title }))} />
        <TextAreaField label="Form description" value={draft.description} maxLength={2000} isDisabled={busy} onChange={description => setDraft(previous => previous && ({ ...previous, description }))} />
      </div>
      <GridList aria-label="Reorder form fields" className={styles.questionList} items={draft.questions} dragAndDropHooks={questionDrag} dependencies={[selected, busy, newQuestion, draft.questions]} keyboardNavigationBehavior="tab" renderEmptyState={() => <p>Drop a field here or choose one from Add fields.</p>}>
        {question => {
          const index = draft.questions.findIndex(item => item.id === question.id);
          const linked = Boolean(linkedNames[question.field ?? ""]);
          const required = requiredFields.has(question.field ?? "");
          return <GridListItem id={question.id} textValue={question.title || "Untitled field"} className={styles.questionCard} data-editing={selected === question.id || undefined}>
            <div className={styles.questionTop}>
              <IconButton slot="drag" className={styles.dragHandle} aria-label={`Drag ${question.title || "field"} to reorder`} isDisabled={busy}><GripVertical size={17} /></IconButton>
              <button type="button" className={styles.questionSelect} disabled={busy} onClick={() => setSelected(question.id)} aria-expanded={selected === question.id}>
                <span className={styles.fieldNumber}>{index + 1}</span><span>{question.title || "Untitled field"}{question.required ? " *" : ""}<small>{formQuestionTypes.find(type => type.id === question.type)?.label}</small></span>
              </button>
              {required && <span title="Required lead detail" className={styles.lockedField}><LockKeyhole size={13} /><span className="wd-visually-hidden">Required lead detail</span></span>}
              <IconButton aria-label={`Move ${question.title || "field"} up`} size="compact" isDisabled={index === 0 || busy} onPress={() => move(question, -1)}><ArrowUp size={14} /></IconButton>
              <IconButton aria-label={`Move ${question.title || "field"} down`} size="compact" isDisabled={index === draft.questions.length - 1 || busy} onPress={() => move(question, 1)}><ArrowDown size={14} /></IconButton>
            </div>
            {selected === question.id && <fieldset disabled={busy} className={styles.questionEditor}>
              <div className={styles.questionFields}>
                <TextInput label="Field label" value={question.title} maxLength={240} autoFocus={newQuestion === question.id} onChange={title => updateQuestion(question.id, { title })} />
                {linked ? <div className={styles.linkedType}><span>Field type</span><strong>{formQuestionTypes.find(type => type.id === question.type)?.label}</strong></div> : <SelectField label="Field type" items={formQuestionTypes} selectedKey={question.type} onSelectionChange={key => { const type = String(key); updateQuestion(question.id, { type, options: choiceTypes.has(type) ? question.options.length ? question.options : [1, 2].map(number => ({ id: crypto.randomUUID(), label: `Option ${number}` })) : [] }); }} />}
              </div>
              <TextInput label="Help text · optional" value={question.description} maxLength={1000} onChange={description => updateQuestion(question.id, { description })} />
              {choiceTypes.has(question.type) && <div className={styles.optionList}>
                {linked ? <><p className={styles.hint}>Choices come from Leads → Field options.</p><p className={styles.choiceSummary}>{question.options.map(option => option.label).join(" · ") || "No choices configured yet."}</p></> : <>
                  {question.options.map((option, optionIndex) => <div className={styles.optionRow} key={option.id}><TextInput label={`Option ${optionIndex + 1}`} value={option.label} maxLength={160} onChange={label => updateQuestion(question.id, { options: question.options.map(item => item.id === option.id ? { ...item, label } : item) })} /><IconButton aria-label={`Remove option ${optionIndex + 1}`} onPress={() => updateQuestion(question.id, { options: question.options.filter(item => item.id !== option.id) })}><Trash2 size={14} /></IconButton></div>)}
                  <Button size="compact" variant="quiet" isDisabled={question.options.length >= 50} onPress={() => updateQuestion(question.id, { options: [...question.options, { id: crypto.randomUUID(), label: `Option ${question.options.length + 1}` }] })}><Plus size={14} />Add option</Button>
                </>}
              </div>}
              {linked && <p className={styles.hint}>{required ? "Required for new leads" : "Linked to lead details"} · {linkedNames[question.field!]}. You can change the label and position.</p>}
              <footer className={styles.questionFooter}>
                <Checkbox isSelected={question.required} isDisabled={required || busy} onChange={value => updateQuestion(question.id, { required: value })}>Required</Checkbox>
                <div className={styles.actions}><Button size="compact" variant="quiet" isDisabled={atLimit || busy} onPress={() => add(question.type, { id: question.id, position: "after" }, question)}><Copy size={14} />Duplicate</Button>
                  {!required && <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => { setDraft(previous => previous && ({ ...previous, questions: previous.questions.filter(item => item.id !== question.id) })); setSelected(draft.questions[index - 1]?.id ?? draft.questions[index + 1]?.id ?? ""); setAnnouncement(`${question.title} deleted.`); }}><Trash2 size={14} />Delete</Button>}
                </div>
              </footer>
            </fieldset>}
          </GridListItem>;
        }}
      </GridList>
      <Button className={styles.addQuestion} variant="quiet" isDisabled={busy || atLimit} onPress={() => add("text")}><Plus size={16} />Add field</Button>
      <p role="status" className="wd-visually-hidden">{announcement}</p>
    </section>
    <aside className={styles.livePreview} aria-label="Live form preview">
      <div className={styles.sectionHeading}><h3>Live preview</h3><Button size="compact" variant="quiet" onPress={() => setPreviewVersion(version => version + 1)}>Reset answers</Button></div>
      <p className={styles.hint}>This is what your customer will see.</p>
      <div className={styles.previewScroll} ref={previewScroll}><PublicEnquiryFormView key={previewVersion} preview form={{ ...draft, revision: "preview" }} /></div>
    </aside>
  </div>;
}
