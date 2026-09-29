"use client";

import { FileText, ImagePlus, Paperclip, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalFile } from "@/lib/client-portal/types";
import styles from "../portal.module.css";

type Item = { key: string; id: string; file: File; url: string | null; status: "uploading" | "done" | "failed"; error: string };

/**
 * Photos (and, where they make sense, PDFs) the client adds to what they send: each is uploaded as soon as it's
 * picked, under its own id, so a retry sends the same file. `onChange` gets the ids that are up; `onBusy` says
 * while any is still going, so the form waits for them.
 */
export function AttachFiles({ caseId, api, onChange, onBusy, photosOnly = false, max = 10, label }: {
  caseId: string; api: PortalApi; onChange: (ids: string[]) => void; onBusy?: (busy: boolean) => void; photosOnly?: boolean; max?: number; label?: string;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const report = useRef({ onChange, onBusy });
  report.current = { onChange, onBusy };
  useEffect(() => {
    report.current.onChange(items.filter((item) => item.status === "done").map((item) => item.id));
    report.current.onBusy?.(items.some((item) => item.status === "uploading"));
  }, [items]);
  // Free the local previews when the form goes away.
  const urls = useRef<string[]>([]);
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);

  const send = async (item: Item) => {
    setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, status: "uploading", error: "" } : entry)));
    try {
      await api.upload(caseId, item.id, item.file);
      setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, status: "done" } : entry)));
    } catch (cause) {
      setItems((current) => current.map((entry) => (entry.key === item.key ? { ...entry, status: "failed", error: (cause as Error).message } : entry)));
    }
  };
  const add = (files: File[]) => {
    const room = Math.max(0, max - items.length);
    const next = files.slice(0, room).map((file): Item => {
      const url = file.type.startsWith("image/") && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
      if (url) urls.current.push(url);
      return { key: commandId(), id: commandId(), file, url, status: "uploading", error: "" };
    });
    setItems((current) => [...current, ...next]);
    for (const item of next) void send(item);
  };
  const full = items.length >= max;
  const text = label ?? (photosOnly ? t("Add photos") : t("Add photos or PDFs"));
  return <div className={styles.attach}>
    <input accept={photosOnly ? "image/*" : "image/*,application/pdf"} aria-label={text} className="wd-visually-hidden" multiple ref={input} type="file"
      onChange={(event) => { add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    {items.length ? <ul className={styles.attachList}>{items.map((item) => <li className={styles.attachItem} data-status={item.status} key={item.key}>
      {item.url
        // eslint-disable-next-line @next/next/no-img-element -- a local preview of the file being added
        ? <img alt="" className={styles.attachThumb} src={item.url} />
        : <span className={styles.attachThumb}><FileText aria-hidden="true" size={18} /></span>}
      <span className={styles.itemText}>
        <span className={styles.attachName} dir="auto">{item.file.name}</span>
        <span className={styles.itemMeta} role={item.status === "failed" ? "alert" : undefined}>
          {item.status === "uploading" ? t("Adding…") : item.status === "failed" ? item.error : t("Added")}</span>
      </span>
      {item.status === "failed" ? <IconButton aria-label={t("Try {name} again", { name: item.file.name })} onPress={() => void send(item)}><RotateCcw aria-hidden="true" size={16} /></IconButton> : null}
      <IconButton aria-label={t("Remove {name}", { name: item.file.name })} isDisabled={item.status === "uploading"}
        onPress={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}><X aria-hidden="true" size={16} /></IconButton>
    </li>)}</ul> : null}
    {full ? null : <div><Button size="compact" variant="secondary" onPress={() => input.current?.click()}>
      {photosOnly ? <ImagePlus aria-hidden="true" size={16} /> : <Paperclip aria-hidden="true" size={16} />}{text}</Button></div>}
  </div>;
}

/** Files someone on the client's side added, as small pictures (or a named PDF) that open in full. */
export function FileStrip({ files, api }: { files: PortalFile[]; api: PortalApi }) {
  const t = useT();
  if (!files.length) return null;
  return <ul className={styles.fileStrip}>{files.map((file) => <li key={file.id}>
    <a className={styles.fileTile} href={api.file("asset", file.id)} rel="noreferrer" target="_blank" title={file.name}>
      {file.hasPreview
        // eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the signed-in portal route
        ? <img alt={t("Photo: {name}", { name: file.name })} loading="lazy" src={api.file("asset", file.id, true)} />
        : <><FileText aria-hidden="true" size={18} /><span dir="auto">{file.name}</span></>}
    </a>
  </li>)}</ul>;
}
