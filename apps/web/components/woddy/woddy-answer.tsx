"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { citedSources, type WoddyAnswer, type WoddySource } from "@/lib/woddy/agent";
import { WoddyActionCard } from "./woddy-action-card";
import styles from "./woddy.module.css";

function SourceLink({ source }: { source: WoddySource }) {
  return source.href ? <Link className={styles.citation} href={source.href}>{source.label}</Link> : <span className={styles.citation}>{source.label}</span>;
}

/** The answer's words with each cited source ([S1]) as a link to the record it came from (W-4). */
function withCitations(text: string, sources: WoddySource[]): ReactNode[] {
  return text.split(/(\[S\d+\])/g).map((part, index) => {
    const source = /^\[(S\d+)\]$/.exec(part) ? sources.find((item) => `[${item.key}]` === part) : undefined;
    return source ? <Fragment key={index}>(<SourceLink source={source} />)</Fragment> : part ? <Fragment key={index}>{part}</Fragment> : null;
  });
}

/**
 * One Woddy answer: its words, where each fact came from, what it prepared (cards to confirm or cancel), a
 * reply it drafted (for the chat's reply box) and, when it stopped early, why.
 */
export function WoddyAnswerView({ workspaceId, answer, onUseDraft, draftPlaced = false }: {
  workspaceId: string; answer: WoddyAnswer;
  /** Puts a drafted reply into the chat's reply box (the chat is open). */
  onUseDraft?: (text: string) => void;
  /** The draft is already in the reply box. */
  draftPlaced?: boolean;
}) {
  const t = useT();
  const sources = citedSources(answer);
  const text = answer.answer.trim() || (answer.proposals.length ? t("I prepared this for you. Nothing changes until you confirm.") : answer.draft ? "" : t("I couldn't find an answer to that."));
  return <div className={styles.answer}>
    {text ? <p className={styles.answerText}>{withCitations(text, answer.sources)}</p> : null}
    {answer.proposals.map((card) => <WoddyActionCard key={card.id} workspaceId={workspaceId} card={card} />)}
    {answer.draft ? <>
      <blockquote className={styles.quote}>{answer.draft.text}</blockquote>
      {draftPlaced ? <p className={styles.notice}>{t("The draft is in your reply box. Edit it and press Send when it's right.")}</p>
        : onUseDraft ? <div className={styles.cardActions}><p>{t("Nothing is sent until you press Send.")}</p><Button size="compact" variant="primary" onPress={() => onUseDraft(answer.draft!.text)}>{t("Use in reply")}</Button></div>
        : <p className={styles.notice}>{t("Open the chat to use this draft. Nothing was sent.")}</p>}
    </> : null}
    {answer.stopped ? <p className={styles.notice}>{t("I stopped there to keep AI credits in check. Ask again to continue.")}</p> : null}
    {sources.length ? <p className={styles.sources}><span>{t("From")}</span>{sources.map((source, index) => <Fragment key={source.key}>{index ? <span aria-hidden="true">·</span> : null}<SourceLink source={source} /></Fragment>)}</p> : null}
  </div>;
}
