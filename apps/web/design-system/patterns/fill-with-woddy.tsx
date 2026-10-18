"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { Button, IconButton } from "../components/actions";
import { FormFieldContext } from "../components/form-context";
import { Checkbox, TextAreaField } from "../components/forms";
import { Woddy } from "../components/woddy";

export type FillField = { key: string; label: string };
type Step = "closed" | "reading" | "review";

/**
 * "Fill with Woddy" at the top of a create form: paste a WhatsApp message, an email or a business card's text
 * (or add its photo) and Woddy proposes the fields it can read. The person ticks what to use; the values go
 * into the form and nothing is saved until they save it. Show it only while AI is on for the workspace.
 */
export function FillWithWoddy({ fields, onApply, onExtract }: {
  fields: FillField[];
  onExtract: (input: { text: string; image: File | null }) => Promise<Record<string, string>>;
  onApply: (values: Record<string, string>) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>("closed");
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [proposal, setProposal] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [filled, setFilled] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  const region = useId();

  const read = async () => {
    if (busy || (!text.trim() && !image)) return;
    setBusy(true); setProblem("");
    try {
      const found = await onExtract({ text: text.trim(), image });
      const known = Object.fromEntries(fields.filter((field) => found[field.key]).map((field) => [field.key, found[field.key]]));
      if (!Object.keys(known).length) { setProblem(t("Woddy found nothing to fill. Check the text, or fill it in yourself.")); return; }
      setProposal(known); setChosen(new Set(Object.keys(known))); setStep("review");
    } catch (cause) {
      setProblem(cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("Woddy couldn't read that. Try again, or fill it in yourself."));
    } finally { setBusy(false); }
  };
  const apply = () => {
    const values = Object.fromEntries(Object.entries(proposal).filter(([key]) => chosen.has(key)));
    onApply(values);
    setFilled(Object.keys(values).length);
    setStep("closed"); setText(""); setImage(null); setProposal({});
  };
  const close = () => { setStep("closed"); setProblem(""); setProposal({}); };
  // ⌘/Ctrl+Enter here reads the text; it doesn't submit the form around it.
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && step === "reading") { event.preventDefault(); void read(); }
    if (event.key === "Escape" && step !== "closed") { event.preventDefault(); event.stopPropagation(); close(); }
  };

  if (step === "closed") return <div className="wd-fill-woddy" data-step="closed">
    <Button aria-controls={region} aria-expanded={false} className="wd-fill-woddy-open" onPress={() => { setFilled(0); setStep("reading"); }} size="compact" variant="quiet">
      <Woddy decorative pose="idle" size={18} />{t("Fill with Woddy")}
    </Button>
    {filled ? <span className="wd-fill-woddy-done" role="status">{filled === 1 ? t("Filled 1 field. Check it before saving.") : t("Filled {count} fields. Check them before saving.", { count: filled })}</span> : null}
  </div>;

  return <div aria-label={t("Fill with Woddy")} className="wd-fill-woddy" data-step={step} data-wd-own-enter="" id={region} onKeyDown={keys} role="group">
    <header><Woddy decorative pose={busy ? "thinking" : step === "review" ? "celebrating" : "hello"} size={28} /><strong>{t("Fill with Woddy")}</strong>
      <IconButton aria-label={t("Close")} onPress={close} size="compact"><X aria-hidden="true" size={14} /></IconButton></header>
    {step === "reading" ? <FormFieldContext.Provider value={null}>
      <TextAreaField autoFocus label={t("Paste a message, email or card")} onChange={setText} value={text} />
      <div className="wd-fill-woddy-actions">
        {image ? <span className="wd-fill-woddy-file"><ImagePlus aria-hidden="true" size={14} />{image.name}
          <IconButton aria-label={t("Remove {name}", { name: image.name })} onPress={() => setImage(null)} size="compact"><X aria-hidden="true" size={12} /></IconButton></span>
          : <Button onPress={() => picker.current?.click()} size="compact" variant="quiet"><ImagePlus aria-hidden="true" size={14} />{t("Add a photo")}</Button>}
        <input accept="image/png,image/jpeg,image/webp" aria-label={t("Add a photo")} className="wd-visually-hidden" onChange={(event) => { setImage(event.target.files?.[0] ?? null); event.target.value = ""; }} ref={picker} tabIndex={-1} type="file" />
        <Button intent="read" isDisabled={!text.trim() && !image} isLoading={busy} onPress={() => void read()} size="compact">{busy ? t("Woddy is reading…") : t("Read it")}</Button>
      </div>
      {problem ? <p className="wd-fill-woddy-problem" role="alert">{problem}</p> : null}
    </FormFieldContext.Provider> : <>
      <ul aria-label={t("What Woddy found")} className="wd-fill-woddy-found">{fields.filter((field) => proposal[field.key]).map((field) => <li key={field.key}>
        <Checkbox isSelected={chosen.has(field.key)} onChange={(on) => setChosen((current) => { const next = new Set(current); if (on) next.add(field.key); else next.delete(field.key); return next; })}>
          <span className="wd-fill-woddy-label">{field.label}</span><span className="wd-fill-woddy-value" dir="auto">{proposal[field.key]}</span>
        </Checkbox>
      </li>)}</ul>
      <div className="wd-fill-woddy-actions">
        <Button onPress={close} size="compact" variant="quiet">{t("Discard")}</Button>
        <Button intent="read" isDisabled={!chosen.size} onPress={apply} size="compact">{chosen.size === 1 ? t("Use 1 value") : t("Use {count} values", { count: chosen.size })}</Button>
      </div>
    </>}
  </div>;
}
