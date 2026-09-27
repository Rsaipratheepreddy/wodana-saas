"use client";

import { useEffect, useRef, useState } from "react";
import { Switch, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import type { BuilderState, QuoteDocument } from "@/lib/quotation/types";
import styles from "./quote-builder.module.css";

/** The quote's terms and exclusions, saved as you type; they print in the client document. */
export function QuoteTerms({ state, api, onState, onError }: { state: BuilderState; api: ReturnType<typeof quoteApi>; onState: (state: BuilderState) => void; onError: (message: string) => void }) {
  const t = useT();
  const [doc, setDoc] = useState(() => ({ terms: state.document.terms, exclusions: state.document.exclusions, shown: state.document.sections.terms }));
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const pending = useRef<Partial<QuoteDocument>>({});
  const timer = useRef<number | undefined>(undefined);
  const readOnly = !state.canEdit;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const change = (patch: Partial<QuoteDocument>) => {
    pending.current = { ...pending.current, ...patch };
    setSaved("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const body = pending.current; pending.current = {};
      try { onState(await api.document(body)); setSaved("saved"); } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); setSaved("idle"); }
    }, 600);
  };
  return <section className={styles.terms} aria-label={t("Terms")}>
    <Switch isDisabled={readOnly} isSelected={doc.shown} onChange={(on) => { setDoc((current) => ({ ...current, shown: on })); change({ sections: { ...state.document.sections, terms: on } }); }}>{t("Show in the client document")}</Switch>
    <TextAreaField label={t("Terms and conditions")} isReadOnly={readOnly} value={doc.terms} onChange={(value) => { setDoc((current) => ({ ...current, terms: value })); change({ terms: value }); }} />
    <TextAreaField label={t("Exclusions")} isReadOnly={readOnly} value={doc.exclusions} onChange={(value) => { setDoc((current) => ({ ...current, exclusions: value })); change({ exclusions: value }); }} />
    <span className={styles.saving} aria-live="polite">{saved === "saving" ? t("Saving…") : saved === "saved" ? t("Saved") : null}</span>
  </section>;
}
