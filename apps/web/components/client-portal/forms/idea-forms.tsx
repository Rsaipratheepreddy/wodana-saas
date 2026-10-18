"use client";

import { ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import { Button, Form, InlineNotice, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalMoodboard, PortalProject } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../portal.module.css";
import { AttachFiles } from "./attach-files";
import { CommentBox, Comments, Reactions } from "./board-feedback";

type Board = PortalMoodboard["boards"][number];
type Pin = PortalMoodboard["pins"][number];

/** A board the design team shared, large, with the client's reaction and the conversation about it. */
export function BoardDetail({ board, caseId, api, format, onChanged }: { board: Board; caseId: string; api: PortalApi; format: PortalFormat; onChanged: () => void }) {
  const t = useT();
  const target = { caseId, targetKind: "design" as const, targetId: board.id };
  return <div className={styles.sheet}>
    {board.hasImage
      // eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route
      ? <img alt={`${board.title} · V${board.number}`} className={styles.preview} src={api.file("design", board.id)} />
      : <a className={styles.fileName} href={api.file("design", board.id)} rel="noreferrer" target="_blank"><FileText aria-hidden="true" size={16} /> {t("Open the file")}</a>}
    <Reactions target={target} reaction={board.reaction} api={api} onChanged={onChanged} name={board.title} />
    <Comments comments={board.comments} format={format} />
    <CommentBox target={target} api={api} onSent={onChanged} />
  </div>;
}

/** An idea on the moodboard: its photos, link and note, the reaction and the conversation; the client can remove their own. */
export function PinDetail({ pin, caseId, api, format, onChanged, onRemoved }: { pin: Pin; caseId: string; api: PortalApi; format: PortalFormat; onChanged: () => void; onRemoved: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const target = { caseId, targetKind: "pin" as const, targetId: pin.id };
  const remove = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "remove_inspiration", caseId, pinId: pin.id }); onRemoved(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <div className={styles.sheet}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {pin.photos.length ? <div className={styles.photos}>{pin.photos.map((photo) => <a className={styles.photo} href={api.file("asset", photo.id)} key={photo.id} rel="noreferrer" target="_blank">
      {/* eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route */}
      <img alt={pin.title} loading="lazy" src={api.file("asset", photo.id, true)} />
    </a>)}</div> : null}
    {pin.note ? <p className={styles.body} dir="auto">{pin.note}</p> : null}
    {pin.link ? <a className={styles.fileName} href={pin.link} rel="noreferrer noopener" target="_blank" dir="ltr"><ExternalLink aria-hidden="true" size={16} />{pin.link}</a> : null}
    <Reactions target={target} reaction={pin.reaction} api={api} onChanged={onChanged} name={pin.title} />
    <Comments comments={pin.comments} format={format} />
    <CommentBox target={target} api={api} onSent={onChanged} />
    {pin.mine ? <div className={styles.choices}><Button variant="quiet" isLoading={busy} onPress={() => void remove()}>{t("Remove this idea")}</Button></div> : null}
  </div>;
}

/** The client adds an idea: photos, a link (Instagram, Pinterest, any site) or a note, and the room it's for. */
export function IdeaForm({ project, api, onDone }: { project: PortalProject; api: PortalApi; onDone: () => void }) {
  const t = useT();
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const empty = !uploads.length && !link.trim() && !note.trim();
  const send = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "add_inspiration", caseId: project.id, uploadIds: uploads, link: link.trim(), note: note.trim(), roomId: roomId || undefined }); onDone(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <AttachFiles caseId={project.id} api={api} onChange={setUploads} onBusy={setUploading} photosOnly max={10} />
    <TextInput label={t("Link")} placeholder="https://" inputType="url" value={link} onChange={setLink} maxLength={2000} />
    <TextAreaField label={t("What do you like about it?")} value={note} onChange={setNote} maxLength={3000} />
    {project.rooms.length ? <SelectField label={t("Room")} placeholder={t("Anywhere")} selectedKey={roomId || null} onSelectionChange={(key) => setRoomId(key ? String(key) : "")}
      items={project.rooms.map((room) => ({ id: room.id, label: room.name }))} /> : null}
    <div className={styles.choices}><Button type="submit" variant="primary" isLoading={busy} isDisabled={empty || uploading}>{t("Add to moodboard")}</Button></div>
  </Form>;
}
