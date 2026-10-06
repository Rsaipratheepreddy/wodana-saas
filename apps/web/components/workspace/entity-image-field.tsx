"use client";

import { useState } from "react";
import { Button, Callout, FileUploader, Spinner } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./entity-image-field.module.css";

type Kind = "logo" | "letterhead";
type Uploaded = { kind: Kind; assetId: string | null; url: string | null; version: number };
type Session = { assetId: string; uploadMode: "signed" | "application"; uploadUrl: string | null; uploadHeaders: Record<string, string> };

async function message(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  return payload?.message ?? fallback;
}

/**
 * A business's logo or letterhead header (PLM-112): the image as documents print it, replaced by choosing
 * another (checked and stored the way the company logo is) or removed. Changes save straight away.
 */
export function EntityImageField({ workspaceId, entityId, kind, label, url, onChange }: {
  workspaceId: string; entityId: string; kind: Kind; label: string; url: string | null; onChange: (result: Uploaded) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/workspace/legal-entities/${entityId}/images/${kind}`;
  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError(t("Choose a PNG, JPEG, or WebP image.")); return; }
    if (file.size > 5 * 1024 * 1024) { setError(t("The image must be 5 MB or smaller.")); return; }
    setBusy(true); setError("");
    try {
      const started = await fetch(base, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, filename: file.name, mimeType: file.type, byteSize: file.size }) });
      if (!started.ok) throw new Error(await message(started, t("The image upload could not be started.")));
      const session = await started.json() as Session;
      const target = session.uploadMode === "signed" && session.uploadUrl ? session.uploadUrl : `${base}/${session.assetId}/content?${new URLSearchParams({ workspaceId })}`;
      const sent = await fetch(target, { method: "PUT", headers: session.uploadHeaders, body: file });
      if (!sent.ok) throw new Error(await message(sent, t("The image could not be uploaded.")));
      const done = await fetch(`${base}/${session.assetId}/complete?${new URLSearchParams({ workspaceId })}`, { method: "POST" });
      if (!done.ok) throw new Error(await message(done, t("The image could not be verified.")));
      onChange(await done.json() as Uploaded);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The image could not be uploaded.")); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${base}?${new URLSearchParams({ workspaceId })}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await message(response, t("The image could not be removed.")));
      onChange(await response.json() as Uploaded);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("The image could not be removed.")); }
    finally { setBusy(false); }
  };
  return <div className={styles.field} data-kind={kind}>
    <span className="wd-field-label">{label}</span>
    {/* eslint-disable-next-line @next/next/no-img-element -- the business's own image, as documents print it */}
    {url ? <img alt={label} className={styles.preview} src={url} /> : null}
    <div className={styles.actions}>
      {busy ? <Spinner /> : <FileUploader accept="image/png,image/jpeg,image/webp" appearance="button" label={url ? t("Replace") : t("Upload")} multiple={false} onFiles={(files) => void upload(files[0])} />}
      {url && !busy ? <Button onPress={() => void remove()} size="compact" variant="quiet">{t("Remove")}</Button> : null}
    </div>
    {error ? <Callout title={t("Could not update {name}", { name: label })} tone="danger">{error}</Callout> : null}
  </div>;
}
