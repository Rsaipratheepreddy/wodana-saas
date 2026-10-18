"use client";

import { useState, type MouseEvent } from "react";
import { Download, FileText, MapPin, X } from "lucide-react";
import { Avatar, Badge, Button, Form, IconButton, InlineNotice, SegmentedControl, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalFolderDesign } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../portal.module.css";
import { useDesignStatus } from "../sections/designs-section";

/**
 * PLM-153 / §0.3: one design in the client's Designs, opened inside the portal (never a new tab): the picture full width
 * with its numbered pins, a PDF in the portal's own viewer (pinned on its page preview), its earlier rounds, and the
 * conversation on the round shown. "Add a pin" then a tap places a comment on the spot; the team sees the same pin.
 * A file waiting for the client's decision says where to give it.
 */
export function DesignFile({ design, fileId, caseId, api, format, onCommented, onDecide }: {
  design: PortalFolderDesign; fileId?: string; caseId: string; api: PortalApi; format: PortalFormat; onCommented: () => void;
  /** Opens the decision on a file in review (under Decisions), when the client can give it there. */
  onDecide?: (fileId: string) => void;
}) {
  const t = useT();
  const status = useDesignStatus();
  const [shown, setShown] = useState(() => design.files.find((file) => file.id === fileId)?.id ?? design.files[0].id);
  const file = design.files.find((item) => item.id === shown) ?? design.files[0];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A retried send is the same command and the same comment (never two).
  const [ids, setIds] = useState(() => ({ command: commandId(), comment: commandId() }));
  // Pinning: "Add a pin", tap the design, then write; the pin goes with the comment.
  const [pinning, setPinning] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const pdf = file.mimeType === "application/pdf";
  const [view, setView] = useState<"file" | "page">("file");
  // The picture's proportions (width ÷ height): the frame grows to the space it has and stays exactly on the picture.
  const [ratio, setRatio] = useState<number | null>(null);
  const pictured = !pdf ? file.hasPreview : view === "page" && file.hasPreview;
  const send = async () => {
    setBusy(true); setError("");
    try {
      await api.command(ids.command, { action: "design_file_comment", caseId, versionId: file.id, commentId: ids.comment, text: text.trim(), ...(point ? { anchor: point } : {}) });
      setText(""); setPoint(null); setPinning(false); setIds({ command: commandId(), comment: commandId() }); onCommented();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const place = (event: MouseEvent<HTMLDivElement>) => {
    if (!pinning || !file.canComment) return;
    const box = event.currentTarget.getBoundingClientRect();
    setPoint({ x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) });
  };
  const [label, tone] = status[file.status];
  const sender = (comment: PortalFolderDesign["files"][number]["comments"][number]) =>
    (!comment.fromClient ? t("Your design team") : comment.mine ? t("You") : comment.author || t("Your household"));
  // Pins are numbered in the order they were placed; a comment shows its pin's number.
  const pins = file.comments.filter((comment) => comment.anchor);
  const pinNumber = (comment: PortalFolderDesign["files"][number]["comments"][number]) => {
    const index = pins.findIndex((item) => item.threadId === comment.threadId);
    return index >= 0 ? index + 1 : null;
  };
  const name = t("{name}, version {number}", { name: design.title, number: file.number });
  return <div className={styles.chat}>
    <div className={styles.viewerBar}>
      {design.files.length > 1 ? <SegmentedControl label={t("Round")} value={file.id} onChange={(next) => { setShown(next); setPoint(null); setView("file"); }}
        options={design.files.map((item) => ({ id: item.id, label: `V${item.number}` }))} /> : null}
      <Badge tone={tone}>{label}</Badge>
      <span className={styles.muted}>{format.date(file.sharedAt)}</span>
      <span className={styles.viewerTools}>
        {pdf && file.hasPreview ? <SegmentedControl label={t("View")} value={view} onChange={(next) => setView(next === "page" ? "page" : "file")}
          options={[{ id: "file", label: t("Document") }, { id: "page", label: t("Pin on page") }]} /> : null}
        {file.canComment && pictured ? <Button size="compact" variant={pinning ? "primary" : "secondary"} onPress={() => { setPinning((value) => !value); if (pinning) setPoint(null); }}>
          <MapPin aria-hidden="true" size={14} />{t("Add a pin")}</Button> : null}
        <a className="wd-button wd-icon-button" data-size="compact" data-variant="quiet" href={api.file("design", file.id)} download aria-label={t("Download")}><Download aria-hidden="true" size={15} /></a>
      </span>
    </div>
    {pictured ? <div className={styles.stage} data-pinning={pinning || undefined} dir="ltr" onClick={place}
      style={ratio ? { inlineSize: `min(100%, calc(70dvh * ${ratio.toFixed(4)}))` } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route */}
      <img className={styles.stageImage} alt={name} src={api.file("design", file.id, !file.mimeType.startsWith("image/") || undefined)} draggable={false}
        onLoad={(event) => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight); }} />
      {pins.map((comment, index) => <button key={comment.id} type="button" className={styles.pin} data-active={focused === comment.threadId || undefined}
        style={{ insetInlineStart: `${comment.anchor!.x * 100}%`, insetBlockStart: `${comment.anchor!.y * 100}%` }}
        aria-label={t("Pin {number}: {text}", { number: index + 1, text: comment.text })}
        onClick={(event) => { event.stopPropagation(); setFocused(comment.threadId ?? null); document.getElementById(`comment-${comment.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }}>
        {index + 1}</button>)}
      {point ? <span className={styles.pin} data-draft="" style={{ insetInlineStart: `${point.x * 100}%`, insetBlockStart: `${point.y * 100}%` }} aria-hidden="true">{pins.length + 1}</span> : null}
    </div> : pdf ? <iframe className={styles.stageFrame} src={api.file("design", file.id)} title={name} />
      : <div className={styles.stageFile}><FileText aria-hidden="true" size={28} /><span>{name}</span>
        <a className="wd-button" data-size="compact" data-variant="secondary" href={api.file("design", file.id)} download><Download aria-hidden="true" size={14} />{t("Download")}</a></div>}
    {pinning && !point ? <p className={styles.muted}>{t("Tap the design where your comment belongs.")}</p> : null}
    {file.status === "client_review" && onDecide ? <div><Button variant="primary" onPress={() => onDecide(file.id)}>{t("Give your decision")}</Button></div> : null}
    {file.comments.length ? <ol className={styles.chatLog} role="log" aria-label={t("Comments")} tabIndex={0}>
      {file.comments.map((comment) => {
        const number = pinNumber(comment);
        return <li key={comment.id} id={`comment-${comment.id}`} className={styles.bubble} data-mine={comment.fromClient} data-focused={(number && focused === comment.threadId) || undefined}
          aria-label={sender(comment)} onClick={() => setFocused(comment.threadId ?? null)}>
          <span className={styles.bubbleSender}><Avatar name={sender(comment)} size="sm" />{sender(comment)}{number && comment.anchor ? <span className={styles.pinTag}><MapPin aria-hidden="true" size={11} />{number}</span> : null}</span>
          <p className={styles.body} dir="auto">{comment.text}</p>
          <span className={styles.bubbleMeta}><time dateTime={comment.at}>{format.date(comment.at)} {format.time(comment.at)}</time></span>
        </li>;
      })}
    </ol> : null}
    {file.canComment ? <Form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {point ? <span className={styles.pinTag} data-draft=""><MapPin aria-hidden="true" size={11} />{t("Pinned")}
        <IconButton aria-label={t("Remove the pin")} size="compact" variant="quiet" onPress={() => setPoint(null)}><X aria-hidden="true" size={12} /></IconButton></span> : null}
      <TextAreaField isRequired label={t("Comment")} value={text} onChange={setText} maxLength={5000} />
      <div className={styles.composerActions}>
        <Button type="submit" variant={file.status === "client_review" && onDecide ? "secondary" : "primary"} isLoading={busy} isDisabled={!text.trim()}>{t("Send")}</Button>
      </div>
    </Form> : null}
  </div>;
}
