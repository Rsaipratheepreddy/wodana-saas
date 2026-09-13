"use client";
import { useEffect, useState } from "react";
import { Button, useDesignSystem } from "@/design-system";
import {
  caseRequest,
  type CaseContent,
  type CaseDesign,
  type DesignVersion,
} from "@/lib/pre-project/content";
import styles from "./case-content.module.css";
import view from "./designs.module.css";

const decisions: Record<string, string> = {
  internal_review: "Sent for internal review",
  internal_approved: "Internal review approved",
  client_review: "Sent to client",
  approved: "Client approved",
  changes_requested: "Changes requested",
};
export function DesignComments({
  data,
  design,
  revision,
  onUpdate,
  onDraftChange,
}: {
  data: CaseContent;
  design: CaseDesign;
  revision: DesignVersion;
  onUpdate: (design: CaseDesign) => void;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const { locale, timeZone } = useDesignSystem();
  const [note, setNote] = useState("");
  const [id, setId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    onDraftChange?.(Boolean(note.trim()) || busy);
    return () => onDraftChange?.(false);
  }, [note, busy, onDraftChange]);
  useEffect(() => {
    if (!note.trim() && !busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [note, busy]);
  const comments = [
    ...design.activity
      .filter(
        (a) => a.versionId === revision.id && (a.note || decisions[a.action]),
      )
      .map((a) => ({
        id: a.id,
        body: a.note,
        author: a.decisionBy || a.createdByName,
        at: a.createdAt,
        decision: decisions[a.action] ?? "",
      })),
    ...(design.threads ?? [])
      .filter((t) => t.versionId === revision.id)
      .flatMap((t) =>
        t.messages.map((m) => ({
          id: m.id,
          body: m.body,
          author: m.createdByName,
          at: m.createdAt,
          decision: "",
        })),
      ),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <section className={view.comments} aria-label="Comments">
      <h2>
        Comments <small>R{revision.number}</small>
      </h2>
      {data.canEdit && !design.archivedAt && (
        <form
          className={view.inlineComposer}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!note.trim() || busy) return;
            setBusy(true);
            setError("");
            try {
              onUpdate(
                await caseRequest<CaseDesign>(
                  data.workspaceId,
                  data.caseId,
                  "designs/" + design.id + "/activity",
                  "POST",
                  {
                    id,
                    version: design.version,
                    versionId: revision.id,
                    action: "comment",
                    note,
                    decisionBy: "",
                  },
                ),
              );
              setNote("");
              setId(crypto.randomUUID());
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not post. Your comment is still here.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="design-comment">Add a comment</label>
          <textarea
            id="design-comment"
            placeholder="Leave feedback about this revision…"
            rows={2}
            maxLength={5000}
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
          />
          <div>
            <Button
              size="compact"
              type="submit"
              isLoading={busy}
              isDisabled={!note.trim()}
            >
              Post comment
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={view.commentList}>
        {comments
          .slice()
          .reverse()
          .map((c) => (
            <article className={view.plainComment} key={c.id}>
              <div className={view.messageMeta}>
                <strong>{c.author}</strong>
                <time dateTime={c.at}>
                  {new Intl.DateTimeFormat(locale, {
                    timeZone,
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(c.at))}
                </time>
              </div>
              {c.decision && (
                <small className={view.decisionLabel}>{c.decision}</small>
              )}
              {c.body && <p>{c.body}</p>}
            </article>
          ))}
      </div>
      {!comments.length && <p className={styles.muted}>No comments yet.</p>}
    </section>
  );
}
