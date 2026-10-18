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

/** Bold (**…**) inside a line, with its citations. */
function inline(text: string, sources: WoddySource[], key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    return bold ? <strong key={`${key}-${index}`}>{withCitations(bold[1], sources)}</strong> : <Fragment key={`${key}-${index}`}>{withCitations(part, sources)}</Fragment>;
  });
}

/** The answer as Woddy wrote it: paragraphs, headings, bulleted and numbered lists, bold. */
function richText(text: string, sources: WoddySource[]): ReactNode[] {
  const out: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flushParagraph = () => { if (paragraph.length) { const key = `p${out.length}`; out.push(<p key={key}>{inline(paragraph.join(" "), sources, key)}</p>); paragraph = []; } };
  const flushList = () => {
    if (!list) return;
    const key = `l${out.length}`;
    out.push(list.ordered ? <ol key={key}>{list.items}</ol> : <ul key={key}>{list.items}</ul>);
    list = null;
  };
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\s+$/, "");
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = /^\s*#{1,4}\s+(.*)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); out.push(<p key={`h${index}`}><strong>{inline(heading[1], sources, `h${index}`)}</strong></p>); continue; }
    const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      const body = bullet ? bullet[2] : numbered![1];
      list.items.push(<li key={`i${index}`} data-nested={bullet && bullet[1].length >= 2 ? "" : undefined}>{inline(body, sources, `i${index}`)}</li>);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return out;
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
    {text ? <div className={styles.answerText}>{richText(text, answer.sources)}</div> : null}
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
