"use client";

import { useEffect, useMemo } from "react";
import { FileUploader, ReviewFiles } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ReceiptPhoto } from "@/lib/purchasing/types";
import styles from "./purchasing.module.css";

/** Photos already saved with a delivery: small previews that open the full photo. */
export function SavedPhotos({ photos, url }: { photos: ReceiptPhoto[]; url: (photoId: string, preview?: boolean) => string }) {
  const t = useT();
  if (!photos.length) return null;
  return <ul className={styles.photos} aria-label={t("Photos")}>{photos.map((photo) => <li key={photo.id}>
    <a href={url(photo.id, false)} target="_blank" rel="noreferrer" aria-label={t("Open {name}", { name: photo.name })}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a private, authenticated delivery photo */}
      <img src={url(photo.id)} alt={photo.name} loading="lazy" />
    </a>
  </li>)}</ul>;
}

/** Photos chosen on this device and not saved yet, with a way to add more (the camera on a phone) or drop one. */
export function PhotoPicker({ files, onChange, label }: { files: File[]; onChange: (files: File[]) => void; label?: string }) {
  const t = useT();
  const previews = useMemo(() => files.map((file, index) => ({ id: String(index), name: file.name, href: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.href)), [previews]);
  return <div className={styles.stack}>
    {previews.length ? <ReviewFiles label={t("Photos to add")} files={previews.map((preview) => ({ ...preview, previewHref: preview.href }))}
      onRemove={(id) => onChange(files.filter((_, item) => String(item) !== id))} /> : null}
    <FileUploader appearance="button" accept="image/*" label={label ?? t("Add photos")} onFiles={(added) => onChange([...files, ...added.filter((file) => file.type.startsWith("image/"))].slice(0, 10))} />
  </div>;
}
