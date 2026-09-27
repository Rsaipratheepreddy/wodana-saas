"use client";

import { useEffect, useRef, useState } from "react";
import { TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import type { BuilderState } from "@/lib/quotation/types";
import styles from "./quote-builder.module.css";

/** The quote's terms and exclusions, saved as you type; they print in the client document. */
export function QuoteTerms({ state, api, onSaved, onError }: { state: BuilderState; api: ReturnType<typeof quoteApi>; onSaved: (proposal: { terms: string; exclusions: string }) => void; onError: (message: string) => void }) {
  const t = useT();
  // The same terms and exclusions the proposal prints and the client sees.
  const [doc, setDoc] = useState(() => ({ terms: state.proposal?.terms ?? "", exclusions: state.proposal?.exclusions ?? "" }));
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const pending = useRef<{ terms?: string; exclusions?: string }>({});
  const timer = useRef<number | undefined>(undefined);
  const readOnly = !state.canEdit;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const change = (patch: { terms?: string; exclusions?: string }) => {
    pending.current = { ...pending.current, ...patch };
    setSaved("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const body = pending.current; pending.current = {};
      try { const result = await api.proposal(body); onSaved({ terms: result.quote.terms ?? "", exclusions: result.quote.exclusions ?? "" }); setSaved("saved"); } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); setSaved("idle"); }
    }, 600);
  };
  return <section className={styles.terms} aria-label={t("Terms")}>
    <TextAreaField label={t("Terms and conditions")} isReadOnly={readOnly} value={doc.terms} onChange={(value) => { setDoc((current) => ({ ...current, terms: value })); change({ terms: value }); }} />
    <TextAreaField label={t("Exclusions")} isReadOnly={readOnly} value={doc.exclusions} onChange={(value) => { setDoc((current) => ({ ...current, exclusions: value })); change({ exclusions: value }); }} />
    <span className={styles.saving} aria-live="polite">{saved === "saving" ? t("Saving…") : saved === "saved" ? t("Saved") : null}</span>
  </section>;
}
