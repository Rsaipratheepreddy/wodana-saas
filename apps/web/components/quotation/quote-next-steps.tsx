"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Circle, CircleDot } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import type { CommercialState } from "@/lib/commercial/types";
import { declinedSteps, nextSteps } from "@/lib/quotation/next-steps";
import styles from "./quote-builder.module.css";

/**
 * On an accepted quotation: what happens next, in order, with who holds each step. Whoever can act gets the
 * step's action; everyone else sees who to wait for. The project itself starts from the header's button.
 */
export function QuoteNextSteps({ workspaceId, caseId, quote, projectStarted }: {
  workspaceId: string; caseId: string; quote: { id: string; round?: string | null; status: string }; projectStarted: boolean;
}) {
  const t = useT();
  const [commercial, setCommercial] = useState<CommercialState | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/commercial/cases/${caseId}?${new URLSearchParams({ workspaceId })}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() as Promise<CommercialState> : null))
      .then((value) => { if (alive) setCommercial(value); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [workspaceId, caseId]);
  if (!commercial) return null;
  const steps = quote.status === "declined" ? declinedSteps(commercial) : nextSteps(commercial, quote, caseId, projectStarted);
  if (!steps.length) return null;
  return <section className={styles.nextSteps} aria-label={t("Next steps")}>
    <ol>{steps.map((step) => <li key={step.key} data-state={step.state}>
      <span className={styles.nextStepIcon} aria-hidden="true">{step.state === "done" ? <Check size={14} /> : step.state === "later" ? <Circle size={14} /> : <CircleDot size={14} />}</span>
      <span className={styles.nextStepCopy}>
        <strong>{t(step.label)}</strong>
        {step.state === "waiting" && step.holders.length ? <small>{t("Waiting for {names}", { names: step.holders.join(", ") })}</small> : null}
      </span>
      {step.action ? <Link className="wd-button" data-size="compact" data-variant={step.state === "current" ? "primary" : "quiet"} href={step.action.href}>{t(step.action.label)}</Link> : null}
    </li>)}</ol>
  </section>;
}
