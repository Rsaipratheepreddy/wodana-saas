"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, FileUploader, InlineNotice, ReviewFiles } from "@/design-system";
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
      // A local copy to open (and, for a photo, to show) while it uploads.
      const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
      if (url) urls.current.push(url);
      return { key: commandId(), id: commandId(), file, url, status: "uploading", error: "" };
    });
    setItems((current) => [...current, ...next]);
    for (const item of next) void send(item);
  };
  const full = items.length >= max;
  const text = label ?? (photosOnly ? t("Add photos") : t("Add photos or PDFs"));
  const adding = items.some((item) => item.status === "uploading");
  return <div className={styles.attach}>
    {items.length ? <ReviewFiles label={text} empty={null}
      files={items.map((item) => ({ id: item.key, name: item.file.name, href: item.url ?? "#", previewHref: item.url && item.file.type.startsWith("image/") ? item.url : null }))}
      onRemove={(key) => setItems((current) => current.filter((entry) => entry.key !== key || entry.status === "uploading"))} /> : null}
    {adding ? <InlineNotice tone="info" message={t("Adding…")} /> : null}
    {items.filter((item) => item.status === "failed").map((item) => <InlineNotice key={item.key} tone="error" title={item.file.name} message={item.error}
      action={<Button size="compact" variant="quiet" onPress={() => void send(item)}><RotateCcw aria-hidden="true" size={14} />{t("Try {name} again", { name: item.file.name })}</Button>} />)}
    {full ? null : <FileUploader appearance="button" accept={photosOnly ? "image/*" : "image/*,application/pdf"} label={text} onFiles={add} />}
  </div>;
}

/** Files someone on the client's side added, as small pictures (or a named PDF) that open in full. */
export function FileStrip({ files, api, kind = "asset" }: { files: Array<Pick<PortalFile, "id" | "name" | "hasPreview">>; api: PortalApi;
  /** Where the files come from: the client's own uploads, or a meeting's shared notes (PLM-153). */
  kind?: "asset" | "minutes" }) {
  const t = useT();
  if (!files.length) return null;
  return <ReviewFiles label={t("Photos and files")} files={files.map((file) => ({ id: file.id, name: file.name, href: api.file(kind, file.id), previewHref: file.hasPreview ? api.file(kind, file.id, true) : null }))} />;
}
