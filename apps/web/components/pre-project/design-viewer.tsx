"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Check, Download, Maximize2, MessageSquarePlus, Minimize2, Minus, PanelRightClose, PanelRightOpen, Plus, RotateCcw, Send, X } from "lucide-react";
import { Avatar, Badge, Button, Checkbox, ConfirmationDialog, IconButton, InlineNotice, PillTabs, ReviewFiles, SegmentedControl, useDesignSystem, useModalPortal, usePortalThemeAttributes } from "@/design-system";
import { evidenceFiles } from "@/lib/evidence/evidence";
import { useT } from "@/lib/i18n/i18n-provider";
import { isTypingTarget } from "@/lib/keyboard/typing-target";
import { caseApi, caseRequest, type CaseContent, type CaseDesign, type DesignOptions, type DesignThread } from "@/lib/pre-project/content";
import { DESIGN_STATUS_LABEL, designStatusTone } from "@/lib/pre-project/design-workspace";
import { ClientFeedback, feedbackFor, useClientBoard } from "@/components/client-activity/client-feedback";
import { FileCover } from "./design-file-preview";
import styles from "./design-viewer.module.css";

type Point = { x: number; y: number };
type Member = { id: string; name: string };

/**
 * The drawing, full size, with comments pinned where they belong (like Figma): click a pin to read
 * and reply beside it; press C, click the drawing and write. The side panel holds the review steps
 * and every comment; full screen hides everything but the drawing.
 */
export function DesignViewer({ data, design, options, onClose, onUpdate, actions }: {
  data: CaseContent; design: CaseDesign; options: DesignOptions; onClose: () => void; onUpdate: (design: CaseDesign) => void; actions?: ReactNode;
}) {
  const t = useT();
  const { direction, locale, timeZone } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const modalPortal = useModalPortal();
  const [revisionId, setRevisionId] = useState(design.versions[0]?.id);
  const revision = design.versions.find((item) => item.id === revisionId) ?? design.versions[0];
  const latest = design.versions[0];
  const writable = data.canEdit && !design.archivedAt && revision?.id === latest?.id;
  const members: Member[] = options.members ?? options.reviewers;
  const asset = revision?.asset;
  const pinnable = Boolean(asset && (asset.mimeType.startsWith("image/") || asset.hasPreview));

  const [zoom, setZoom] = useState(1);
  const [fitSize, setFitSize] = useState({ width: 0, height: 0 });
  const [panel, setPanel] = useState(true);
  const [fullScreen, setFullScreen] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [draft, setDraft] = useState<Point | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "resolved">("open");
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);

  const threads = (design.threads ?? []).filter((thread) => thread.versionId === revision?.id);
  const listed = threads.filter((thread) => filter === "resolved" ? thread.status === "resolved" : thread.status !== "resolved");
  const resolvedCount = threads.filter((thread) => thread.status === "resolved").length;
  const legacy = design.activity.filter((item) => item.action === "comment" && item.versionId === revision?.id && item.note.trim());
  const decision = [...design.activity].reverse().find((item) => item.versionId === revision?.id && item.decisionSource && (item.action === "approved" || item.action === "changes_requested"));
  const status = latest?.status ?? "draft";

  const fit = useCallback(() => {
    const img = image.current, box = canvas.current;
    if (!img?.naturalWidth || !box) return;
    const ratio = Math.min((box.clientWidth - 64) / img.naturalWidth, (box.clientHeight - 64) / img.naturalHeight, 2);
    setFitSize({ width: img.naturalWidth * ratio, height: img.naturalHeight * ratio });
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(fit);
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [fit, revision?.id]);
  useEffect(() => {
    const sync = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => { document.removeEventListener("fullscreenchange", sync); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
  }, []);
  const toggleFullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  const close = () => { if (dirty) setConfirmClose(true); else onClose(); };
  const pickRevision = (id: string) => { if (dirty) return; setRevisionId(id); setDraft(null); setOpenThread(null); setCommenting(false); setZoom(1); };
  const showThread = (thread: DesignThread) => {
    setDraft(null); setCommenting(false);
    setOpenThread(thread.id);
    if (thread.status === "resolved" && filter !== "resolved") setFilter("resolved");
    requestAnimationFrame(() => document.getElementById(`pin-${thread.id}`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }));
  };

  // Keys: C starts a comment, + and − zoom, 0 fits, Escape closes the open comment first, then the viewer.
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const typing = isTypingTarget(event.target);
    if (event.key === "Escape") {
      event.preventDefault();
      if (draft || openThread || commenting) { if (!dirty) { setDraft(null); setOpenThread(null); setCommenting(false); } return; }
      if (!document.fullscreenElement) close();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() === "c" && writable && pinnable) { event.preventDefault(); setCommenting((value) => !value); setOpenThread(null); }
    else if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(4, value + 0.25));
    else if (event.key === "-") setZoom((value) => Math.max(0.25, value - 0.25));
    else if (event.key === "0") setZoom(1);
  };

  const date = (value: string) => new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  const title = design.title;

  // In the page's portal, so the review's reviewer list, checkboxes and confirmations open beside it and stay usable.
  return <ModalOverlay key={modalPortal.key} UNSTABLE_portalContainer={modalPortal.container} {...portalTheme} dir={direction} className={`wd-modal-overlay ${styles.overlay}`} isOpen isDismissable={false} isKeyboardDismissDisabled onOpenChange={(open) => { if (!open) close(); }}>
    <Modal className={styles.shell} data-full={fullScreen || undefined}>
      <Dialog className={styles.dialog} aria-label={title}>
        <div className={styles.frame} onKeyDown={onKeyDown}>
          <header className={styles.bar}>
            <div className={styles.titleBlock}>
              <h2>{title}</h2>
              <Badge tone={designStatusTone(status)}>{t((DESIGN_STATUS_LABEL[status] ?? status) as never)}</Badge>
            </div>
            {design.versions.length > 1 ? <PillTabs ariaLabel={t("Revision")} selectedKey={revision?.id ?? ""} onSelectionChange={pickRevision}
              items={[...design.versions].reverse().map((item) => ({ id: item.id, label: t("R{number}", { number: item.number }) }))} /> : null}
            <span className={styles.spacer} />
            {pinnable ? <div className={styles.zoom} role="group" aria-label={t("Zoom")}>
              <IconButton aria-label={t("Zoom out")} size="compact" variant="quiet" isDisabled={zoom <= 0.25} onPress={() => setZoom((value) => Math.max(0.25, value - 0.25))}><Minus aria-hidden="true" size={15} /></IconButton>
              <button type="button" className={styles.zoomValue} aria-label={t("Fit to screen")} onClick={() => { setZoom(1); fit(); }}>{Math.round(zoom * 100)}%</button>
              <IconButton aria-label={t("Zoom in")} size="compact" variant="quiet" isDisabled={zoom >= 4} onPress={() => setZoom((value) => Math.min(4, value + 0.25))}><Plus aria-hidden="true" size={15} /></IconButton>
            </div> : null}
            {writable && pinnable ? <Button size="compact" variant={commenting ? "primary" : "secondary"} aria-pressed={commenting} aria-keyshortcuts="C"
              onPress={() => { setCommenting((value) => !value); setOpenThread(null); }}><MessageSquarePlus aria-hidden="true" size={15} />{t("Comment")}</Button> : null}
            {asset ? <a className={styles.iconLink} href={caseApi(data.workspaceId, data.caseId, `assets/${asset.id}`)} download aria-label={t("Download")} title={t("Download")}><Download aria-hidden="true" size={16} /></a> : null}
            <IconButton aria-label={fullScreen ? t("Exit full screen") : t("Full screen")} size="compact" variant="quiet" onPress={toggleFullScreen}>{fullScreen ? <Minimize2 aria-hidden="true" size={16} /> : <Maximize2 aria-hidden="true" size={16} />}</IconButton>
            <IconButton aria-label={panel ? t("Hide panel") : t("Show panel")} size="compact" variant="quiet" onPress={() => setPanel((value) => !value)}>{panel ? <PanelRightClose aria-hidden="true" data-directional="true" size={16} /> : <PanelRightOpen aria-hidden="true" data-directional="true" size={16} />}</IconButton>
            <IconButton aria-label={t("Close")} size="compact" variant="quiet" onPress={close}><X aria-hidden="true" size={16} /></IconButton>
          </header>

          <div className={styles.body} data-panel={panel || undefined}>
            <div className={styles.canvas} ref={canvas} data-commenting={commenting || undefined}>
              <div className={styles.stage}>
                {pinnable && asset ? <div className={styles.drawing} dir="ltr" style={fitSize.width ? { inlineSize: fitSize.width * zoom, blockSize: fitSize.height * zoom } : undefined}>
                  {/* Authenticated same-origin file; pin positions are fractions of the image itself. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img ref={image} key={asset.id} alt={asset.name} onLoad={fit} src={caseApi(data.workspaceId, data.caseId, `assets/${asset.id}${asset.hasPreview && !asset.mimeType.startsWith("image/") ? "?preview=1" : "?view=1"}`)} />
                  {commenting ? <button type="button" className={styles.placeSurface} aria-label={t("Place a comment on the drawing")}
                    onClick={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      const point = event.detail === 0 ? { x: 0.5, y: 0.5 } : { x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height) };
                      setDraft(point); setCommenting(false); setOpenThread(null);
                    }} /> : null}
                  {threads.filter((thread) => thread.anchor && (thread.status !== "resolved" || filter === "resolved" || openThread === thread.id)).map((thread) =>
                    <Pin key={thread.id} id={`pin-${thread.id}`} point={thread.anchor!} name={thread.createdByName} active={openThread === thread.id} resolved={thread.status === "resolved"}
                      label={t("Comment by {name}", { name: thread.createdByName })} onPress={() => setOpenThread((current) => current === thread.id ? null : thread.id)} />)}
                  {draft ? <Pin point={draft} name={members.find((member) => member.id === options.actorId)?.name ?? t("You")} active label={t("New comment")} /> : null}
                  {draft && revision ? <Bubble point={draft}>
                    <NewComment data={data} design={design} versionId={revision.id} point={draft} members={members} allowBlocking={revision.status !== "approved"} locked={!writable}
                      onDirty={setDirty} onCancel={() => { setDraft(null); setDirty(false); }} onPosted={(next, id) => { onUpdate(next); setDraft(null); setDirty(false); setOpenThread(id); }} />
                  </Bubble> : null}
                  {(() => {
                    const thread = threads.find((item) => item.id === openThread && item.anchor);
                    return thread ? <Bubble point={thread.anchor!}>
                      <ThreadCard data={data} design={design} thread={thread} options={options} reviewerId={revision?.reviewerId ?? null} writable={writable} date={date}
                        onDirty={setDirty} onClose={() => { setOpenThread(null); setDirty(false); }} onUpdate={onUpdate} />
                    </Bubble> : null;
                  })()}
                </div> : <div className={styles.document}><FileCover data={data} design={{ ...design, versions: revision ? [revision] : [] }} full /></div>}
              </div>
              {commenting ? <p className={styles.hint} role="status">{t("Click where the comment belongs · Esc to cancel")}</p> : null}
              {revision?.id !== latest?.id ? <p className={styles.hint}>{t("Earlier revision · read-only")}</p> : null}
            </div>

            {panel ? <aside className={styles.panel} aria-label={t("Review")}>
              {actions ? <div className={styles.panelActions}>{actions}</div> : null}
              {revision ? <BoardFeedback data={data} versionId={revision.id} /> : null}
              {/* §0.3 P0: the client's decision staff took down for this revision, with what it came in. */}
              {decision ? <div className={styles.decision}>
                <span className={styles.decisionHead}><Badge tone={decision.action === "approved" ? "success" : "warning"}>{decision.action === "approved" ? t("Approved by the client") : t("Changes asked by the client")}</Badge>
                  <small>{[decision.decisionBy, decision.decisionAt ? date(decision.decisionAt) : null].filter(Boolean).join(" · ")}</small></span>
                {decision.note ? <p dir="auto">{decision.note}</p> : null}
                <ReviewFiles files={evidenceFiles(data.workspaceId, decision.files)} />
              </div> : null}
              <div className={styles.panelHead}>
                <h3>{t("Comments")}</h3>
                {resolvedCount ? <PillTabs ariaLabel={t("Comments")} selectedKey={filter} onSelectionChange={(key) => { setFilter(key as "open" | "resolved"); setOpenThread(null); }}
                  items={[{ id: "open", label: t("Open") }, { id: "resolved", label: t("Resolved · {count}", { count: resolvedCount }) }]} /> : null}
              </div>
              {listed.length || (filter === "open" && legacy.length) ? <ul className={styles.list}>
                {listed.map((thread) => <li key={thread.id}>
                  <button type="button" className={styles.listItem} data-active={openThread === thread.id || undefined} onClick={() => showThread(thread)}>
                    <Avatar name={thread.createdByName} size="sm" />
                    <span className={styles.listText}>
                      <span className={styles.listMeta}><strong>{thread.createdByName}</strong><time dateTime={thread.createdAt}>{date(thread.createdAt)}</time></span>
                      <span className={styles.listBody}>{thread.messages[0]?.body ?? thread.title}</span>
                      <span className={styles.listFoot}>
                        {thread.blocking && thread.status !== "resolved" ? <Badge tone="danger">{t("Must fix")}</Badge> : null}
                        {thread.messages.length > 1 ? <span>{thread.messages.length === 2 ? t("1 reply") : t("{count} replies", { count: thread.messages.length - 1 })}</span> : null}
                        {!thread.anchor ? <span>{t("Not pinned")}</span> : null}
                      </span>
                    </span>
                  </button>
                  {openThread === thread.id && !thread.anchor ? <div className={styles.inlineThread}>
                    <ThreadCard data={data} design={design} thread={thread} options={options} reviewerId={revision?.reviewerId ?? null} writable={writable} date={date}
                      onDirty={setDirty} onClose={() => { setOpenThread(null); setDirty(false); }} onUpdate={onUpdate} />
                  </div> : null}
                </li>)}
                {filter === "open" ? legacy.map((item) => <li key={item.id} className={styles.listItem} data-static>
                  <Avatar name={item.createdByName} size="sm" />
                  <span className={styles.listText}><span className={styles.listMeta}><strong>{item.createdByName}</strong><time dateTime={item.createdAt}>{date(item.createdAt)}</time></span><span className={styles.listBody}>{item.note}</span></span>
                </li>) : null}
              </ul> : <p className={styles.empty}>{filter === "resolved" ? t("No resolved comments.") : writable && pinnable ? t("No comments yet. Press C to add one.") : t("No comments yet.")}</p>}
            </aside> : null}
          </div>
        </div>
        <ConfirmationDialog isOpen={confirmClose} onOpenChange={setConfirmClose} title={t("Discard your comment?")} body={t("It hasn't been posted.")} confirmLabel={t("Discard")} cancelLabel={t("Keep editing")}
          onConfirm={() => { setConfirmClose(false); setDirty(false); onClose(); }} />
      </Dialog>
    </Modal>
  </ModalOverlay>;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** When this revision is a board shared in the client's portal: their likes, dislikes and comments, and the team's reply. */
function BoardFeedback({ data, versionId }: { data: CaseContent; versionId: string }) {
  const client = useClientBoard(data.workspaceId, data.caseId);
  const board = client.board;
  if (!board) return null;
  const shared = board.boards.some((item) => item.id === versionId);
  const { likes, dislikes, comments } = feedbackFor(board, "design", versionId);
  if (!shared && !likes.length && !dislikes.length && !comments.length) return null;
  return <div className={styles.clientFeedback}><ClientFeedback board={board} kind="design" id={versionId} canReply={board.canEdit && shared} onReply={client.reply} /></div>;
}

/** An avatar pin whose point touches the spot the comment is about. */
function Pin({ id, point, name, label, active, resolved, onPress }: { id?: string; point: Point; name: string; label: string; active?: boolean; resolved?: boolean; onPress?: () => void }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join("") || "·";
  const style = { "--x": point.x, "--y": point.y } as CSSProperties;
  if (!onPress) return <span className={styles.pin} data-active style={style} aria-hidden="true">{initials}</span>;
  return <button id={id} type="button" className={styles.pin} data-active={active || undefined} data-resolved={resolved || undefined} style={style} aria-label={label} aria-expanded={active} onClick={onPress}>{resolved ? <Check aria-hidden="true" size={12} strokeWidth={3} /> : initials}</button>;
}

/** A card beside a pin; it opens towards the side with more room. */
function Bubble({ point, children }: { point: Point; children: ReactNode }) {
  const { direction } = useDesignSystem();
  // Placed in the drawing's own (left-to-right) coordinates; the card inside follows the page direction.
  return <div className={styles.bubble} data-flip-x={point.x > 0.6 || undefined} data-flip-y={point.y > 0.6 || undefined}
    style={{ "--x": point.x, "--y": point.y } as CSSProperties} onClick={(event) => event.stopPropagation()}><div dir={direction}>{children}</div></div>;
}

function useMentions(members: Member[]) {
  const [query, setQuery] = useState<{ start: number; end: number; text: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const suggestions = query ? members.filter((member) => member.name.toLocaleLowerCase().includes(query.text.toLocaleLowerCase())).slice(0, 6) : [];
  const detect = (text: string, caret: number) => {
    const match = text.slice(0, caret).match(/(?:^|\s)@([^@\n]*)$/);
    setQuery(match ? { start: caret - match[1].length - 1, end: caret, text: match[1] } : null);
    setHighlight(0);
  };
  const insert = (body: string, member: Member) => {
    if (!query) return { body, caret: body.length };
    setPicked((current) => current.includes(member.id) ? current : [...current, member.id].slice(0, 20));
    setQuery(null);
    return { body: `${body.slice(0, query.start)}@${member.name} ${body.slice(query.end)}`, caret: query.start + member.name.length + 2 };
  };
  const inBody = (body: string) => picked.filter((id) => body.includes(`@${members.find((member) => member.id === id)?.name}`));
  const reset = () => { setPicked([]); setQuery(null); };
  return { query, suggestions, highlight, setHighlight, detect, insert, inBody, reset, close: () => setQuery(null) };
}

/** A textarea that sends on Enter (Shift+Enter for a new line) and suggests people after @. */
function Composer({ members, placeholder, busy, locked = false, autoFocus, onSend, onDirty, children }: {
  members: Member[]; placeholder: string; busy: boolean; locked?: boolean; autoFocus?: boolean; onSend: (body: string, mentions: string[]) => Promise<boolean>; onDirty: (dirty: boolean) => void; children?: ReactNode;
}) {
  const t = useT();
  const [body, setBody] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentions(members);
  const update = (value: string) => { setBody(value); onDirty(Boolean(value.trim())); };
  const choose = (member: Member) => {
    const next = mentions.insert(body, member);
    update(next.body);
    requestAnimationFrame(() => { field.current?.focus(); field.current?.setSelectionRange(next.caret, next.caret); });
  };
  const send = async () => {
    if (!body.trim() || busy || locked) return;
    if (await onSend(body.trim(), mentions.inBody(body))) { update(""); mentions.reset(); }
  };
  return <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <textarea ref={field} autoFocus={autoFocus} rows={2} aria-label={placeholder} placeholder={placeholder} value={body} maxLength={5000} disabled={busy}
      onChange={(event) => { update(event.target.value); mentions.detect(event.target.value, event.target.selectionStart); }}
      onKeyDown={(event) => {
        if (mentions.query && mentions.suggestions.length) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); mentions.setHighlight((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + mentions.suggestions.length) % mentions.suggestions.length); return; }
          if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); choose(mentions.suggestions[mentions.highlight]); return; }
        }
        if (event.key === "Escape" && mentions.query) { event.preventDefault(); event.stopPropagation(); mentions.close(); return; }
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
      }} />
    {mentions.query ? <div role="listbox" aria-label={t("Mention someone")} className={styles.mentions}>
      {mentions.suggestions.length ? mentions.suggestions.map((member, index) => <button type="button" role="option" aria-label={member.name} aria-selected={index === mentions.highlight} key={member.id}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(member)}><Avatar name={member.name} size="sm" /><span>{member.name}</span></button>)
        : <small>{t("No one matches")}</small>}
    </div> : null}
    <div className={styles.composerFoot}>
      {children}
      <span className={styles.spacer} />
      <IconButton type="submit" aria-label={t("Post")} size="compact" variant="primary" isDisabled={!body.trim() || busy || locked} isLoading={busy}><Send aria-hidden="true" data-directional="true" size={14} /></IconButton>
    </div>
  </form>;
}

function NewComment({ data, design, versionId, point, members, allowBlocking, locked, onDirty, onCancel, onPosted }: {
  data: CaseContent; design: CaseDesign; versionId: string; point: Point; members: Member[]; allowBlocking: boolean; locked: boolean;
  onDirty: (dirty: boolean) => void; onCancel: () => void; onPosted: (design: CaseDesign, threadId: string) => void;
}) {
  const t = useT();
  const [id] = useState(() => crypto.randomUUID());
  const [blocking, setBlocking] = useState(false);
  // The audience switch: team only (the default) or with the client, in their portal.
  const [audience, setAudience] = useState<"team" | "client">("team");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className={styles.card}>
    <div className={styles.cardHead}><strong>{t("New comment")}</strong><IconButton aria-label={t("Cancel")} size="compact" variant="quiet" onPress={onCancel}><X aria-hidden="true" size={14} /></IconButton></div>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {locked ? <InlineNotice tone="info" message={t("A newer revision was uploaded. Copy your comment and add it there.")} /> : null}
    <Composer autoFocus members={members} busy={busy} locked={locked} placeholder={t("Add a comment · @ to mention")} onDirty={onDirty}
      onSend={async (body, mentions) => {
        setBusy(true); setError("");
        try { onPosted(await caseRequest<CaseDesign>(data.workspaceId, data.caseId, `designs/${design.id}/threads`, "POST", { id, versionId, title: body.slice(0, 240), body, blocking, anchor: point, mentions, clientVisible: audience === "client" }), id); return true; }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not post the comment.")); return false; }
        finally { setBusy(false); }
      }}>
      <SegmentedControl label={t("Who sees it")} value={audience} onChange={(value) => setAudience(value as "team" | "client")} options={[{ id: "team", label: t("Team only") }, { id: "client", label: t("With client") }]} />
      {allowBlocking ? <Checkbox isSelected={blocking} onChange={setBlocking}>{t("Must fix before approval")}</Checkbox> : null}
    </Composer>
  </div>;
}

function ThreadCard({ data, design, thread, options, reviewerId, writable, date, onDirty, onClose, onUpdate }: {
  data: CaseContent; design: CaseDesign; thread: DesignThread; options: DesignOptions; reviewerId: string | null; writable: boolean;
  date: (value: string) => string; onDirty: (dirty: boolean) => void; onClose: () => void; onUpdate: (design: CaseDesign) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replyId, setReplyId] = useState(() => crypto.randomUUID());
  const members: Member[] = options.members ?? options.reviewers;
  const resolved = thread.status === "resolved";
  const canResolve = writable && (thread.fromClient || thread.createdBy === options.actorId || reviewerId === options.actorId);
  const setAudience = async () => {
    setBusy(true); setError("");
    try { onUpdate(await caseRequest<CaseDesign>(data.workspaceId, data.caseId, `designs/${design.id}/threads/${thread.id}/audience`, "POST", { version: thread.version, clientVisible: !thread.clientVisible })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  const setStatus = async () => {
    setBusy(true); setError("");
    try { onUpdate(await caseRequest<CaseDesign>(data.workspaceId, data.caseId, `designs/${design.id}/threads/${thread.id}/status`, "POST", { version: thread.version, status: resolved ? "open" : "resolved" })); if (!resolved) onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  return <div className={styles.card}>
    <div className={styles.cardHead}>
      {thread.blocking && !resolved ? <Badge tone="danger">{t("Must fix")}</Badge> : resolved ? <Badge tone="success">{t("Resolved")}</Badge> : <span />}
      {thread.fromClient ? <Badge tone="info">{t("From client")}</Badge> : thread.clientVisible ? <Badge tone="info">{t("With client")}</Badge> : <Badge tone="neutral">{t("Team only")}</Badge>}
      <span className={styles.spacer} />
      {writable && !thread.fromClient && !thread.messages.some((message) => message.fromClient) ? <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void setAudience()}>{thread.clientVisible ? t("Make team only") : t("Share with client")}</Button> : null}
      {canResolve ? <IconButton aria-label={resolved ? t("Reopen") : t("Resolve")} size="compact" variant="quiet" isDisabled={busy} onPress={() => void setStatus()}>{resolved ? <RotateCcw aria-hidden="true" size={14} /> : <Check aria-hidden="true" size={14} />}</IconButton> : null}
      <IconButton aria-label={t("Close")} size="compact" variant="quiet" onPress={onClose}><X aria-hidden="true" size={14} /></IconButton>
    </div>
    <ol className={styles.messages}>
      {thread.messages.map((message) => <li key={message.id}>
        <Avatar name={message.createdByName} size="sm" />
        <div><span className={styles.listMeta}><strong>{message.createdByName}</strong><time dateTime={message.createdAt}>{date(message.createdAt)}</time></span><p>{message.body}</p></div>
      </li>)}
    </ol>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {writable && !resolved ? <Composer autoFocus key={replyId} members={members} busy={busy} placeholder={t("Reply")} onDirty={onDirty}
      onSend={async (body) => {
        setBusy(true); setError("");
        try { onUpdate(await caseRequest<CaseDesign>(data.workspaceId, data.caseId, `designs/${design.id}/threads/${thread.id}/replies`, "POST", { id: replyId, body })); setReplyId(crypto.randomUUID()); return true; }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not send the reply.")); return false; }
        finally { setBusy(false); }
      }} /> : null}
  </div>;
}
