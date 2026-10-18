"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { EmptyState, FileUploader, IconButton, InlineNotice, Spinner } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { catalogImageUrl } from "@/lib/quotation/client";
import styles from "./catalog-page.module.css";

type Image = { id: string; name: string; hasPreview: boolean };

/** An item's pictures. The first one shows in quotes, the gallery and the catalog grid. */
export function CatalogItemImages({ workspaceId, itemId, canManage }: { workspaceId: string; itemId: string; canManage: boolean }) {
  const t = useT();
  const [images, setImages] = useState<Image[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = (path: string) => `/api/catalog-images/${path}?${new URLSearchParams({ workspaceId })}`;
  const load = () => fetch(url(`items/${itemId}`), { cache: "no-store" }).then((response) => response.json()).then((data: { images?: Image[] }) => setImages(data.images ?? [])).catch(() => setError(t("Pictures didn't load.")));
  useEffect(() => {
    let alive = true;
    fetch(url(`items/${itemId}`), { cache: "no-store" }).then((response) => response.json()).then((data: { images?: Image[] }) => { if (alive) setImages(data.images ?? []); }).catch(() => { if (alive) setError(t("Pictures didn't load.")); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, itemId]);
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true); setError("");
    for (const file of files.slice(0, 12)) {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(url(`items/${itemId}/${crypto.randomUUID()}`), { method: "POST", body });
      if (!response.ok) { const data = await response.json().catch(() => null); setError(data?.message ?? t("Could not upload the picture.")); break; }
    }
    await load(); setBusy(false);
  };
  const remove = async (id: string) => {
    const response = await fetch(url(id), { method: "DELETE" });
    if (!response.ok) setError(t("Could not remove the picture."));
    await load();
  };
  return <div className={styles.images}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {images?.length ? <ul>{images.map((image, index) => <li key={image.id}>
      {/* Authenticated same-origin image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={catalogImageUrl(workspaceId, image.id, image.hasPreview)} alt={image.name} />
      {index === 0 ? <small>{t("Main picture")}</small> : null}
      {canManage ? <span className={styles.remove}><IconButton aria-label={t("Remove {name}", { name: image.name })} size="compact" variant="quiet" onPress={() => void remove(image.id)}><Trash2 aria-hidden="true" size={14} /></IconButton></span> : null}
    </li>)}</ul> : images ? <EmptyState illustration={null} title={t("No pictures yet.")} /> : null}
    {canManage ? busy ? <Spinner label={t("Uploading…")} />
      : <FileUploader accept="image/*" appearance="button" label={t("Add pictures")} onFiles={(files) => void upload(files)} /> : null}
  </div>;
}
