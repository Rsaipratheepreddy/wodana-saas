"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button, InlineNotice, SettingsRow, SettingsSection, Skeleton, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProposalKit } from "@/lib/commercial/types";
import { proposalKitApi } from "@/lib/quotation/client";
import styles from "./quotation-settings.module.css";

type Words = Pick<ProposalKit, "introduction" | "letterNote" | "defaultTerms" | "defaultExclusions" | "contactDetails" | "website">;
type Slot = "introductionImage" | "closingImage" | "monogramImage" | "termsImages";
const WORDS: (keyof Words)[] = ["introduction", "letterNote", "defaultTerms", "defaultExclusions", "contactDetails", "website"];
/** Pictures are embedded in each issued proposal, so they are shrunk to stay under ~300 KB each. */
const MAX_PICTURE_CHARS = 390_000;

/** Reads a picture, scales it down and re-encodes it until it fits (WebP where the browser can, else JPEG). */
export async function shrinkPicture(file: File, longestSide: number): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPEG or WebP picture.");
  const bitmap = await createImageBitmap(file);
  let side = Math.min(longestSide, Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = side / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't prepare pictures.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.76, 0.66]) {
      let data = canvas.toDataURL("image/webp", quality);
      if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= MAX_PICTURE_CHARS) return data;
    }
    side = Math.round(side * 0.75);
  }
  throw new Error("This picture is too large even after shrinking. Try a smaller one.");
}

/**
 * Settings → Quotations → Proposal: the firm's words, contact block and pictures for its client
 * proposals. The layout, type and colours are Wodana's; the brand colour and logo come from the
 * company's branding. Words save together; each picture saves as soon as it's chosen.
 */
export function ProposalKitSettings({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = proposalKitApi(workspaceId);
  const [kit, setKit] = useState<ProposalKit | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [words, setWords] = useState<Words | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const target = useRef<{ slot: Slot; index?: number } | null>(null);

  useEffect(() => {
    let alive = true;
    proposalKitApi(workspaceId).get()
      .then((result) => { if (!alive) return; setKit(result.kit); setCanManage(result.canManage); setWords(pick(result.kit)); setError(""); })
      .catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId, attempt]);

  if (!kit || !words) return error
    ? <div className={styles.actions}><InlineNotice tone="error" message={error} /><Button size="compact" onPress={() => setAttempt((value) => value + 1)}>{t("Retry")}</Button></div>
    : <Skeleton lines={4} shape="form" />;
  const readOnly = !canManage;
  const changed = WORDS.filter((key) => words[key] !== kit[key]);

  const send = async (change: Partial<Omit<ProposalKit, "version">>, label: string) => {
    setBusy(label); setError(""); setSaved(false);
    // A picture save leaves any unsaved words as they are; saving the words takes the server's cleaned values.
    try { const next = await api.change({ ...change, version: kit.version }); setKit(next); if (label === "words") setWords(pick(next)); setSaved(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(null); }
  };
  const choose = (slot: Slot, index?: number) => { target.current = { slot, index }; file.current?.click(); };
  const picked = async (chosen: File | undefined) => {
    const place = target.current; target.current = null;
    if (!chosen || !place) return;
    try {
      const picture = await shrinkPicture(chosen, place.slot === "monogramImage" ? 400 : 1600);
      if (place.slot === "termsImages") {
        const list = [...kit.termsImages];
        if (place.index !== undefined && place.index < list.length) list[place.index] = picture; else list.push(picture);
        await send({ termsImages: list.slice(0, 3) }, place.slot);
      } else await send({ [place.slot]: picture }, place.slot);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };
  const remove = (slot: Slot, index?: number) => void send(slot === "termsImages" ? { termsImages: kit.termsImages.filter((_, at) => at !== index) } : { [slot]: null }, slot);

  const picture = (slot: Exclude<Slot, "termsImages">, label: string, hint: string) => (
    <SettingsRow label={label} hint={hint} align="start">
      <PictureSlot src={kit[slot]} label={label} readOnly={readOnly} busy={busy === slot} onChoose={() => choose(slot)} onRemove={() => remove(slot)} />
    </SettingsRow>
  );

  return <SettingsSection id="proposal" title={t("Proposal")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <SettingsRow label={t("Introduction")} hint={t("A short paragraph about your firm. Leave empty to skip the introduction page.")} align="start">
      <div className={styles.wide}><TextAreaField aria-label={t("Introduction")} label={null} isReadOnly={readOnly} value={words.introduction} onChange={(value) => setWords({ ...words, introduction: value })} /></div>
    </SettingsRow>
    <SettingsRow label={t("Letter note")} hint={t("An extra line in the cover letter, such as your usual lead time.")} align="start">
      <div className={styles.wide}><TextAreaField aria-label={t("Letter note")} label={null} isReadOnly={readOnly} value={words.letterNote} onChange={(value) => setWords({ ...words, letterNote: value })} /></div>
    </SettingsRow>
    <SettingsRow label={t("Terms and conditions")} hint={t("New quotes start with these terms. Each quote can still be edited.")} align="start">
      <div className={styles.wide}><TextAreaField aria-label={t("Terms and conditions")} label={null} isReadOnly={readOnly} value={words.defaultTerms} onChange={(value) => setWords({ ...words, defaultTerms: value })} /></div>
    </SettingsRow>
    <SettingsRow label={t("Exclusions")} hint={t("New quotes start with these exclusions.")} align="start">
      <div className={styles.wide}><TextAreaField aria-label={t("Exclusions")} label={null} isReadOnly={readOnly} value={words.defaultExclusions} onChange={(value) => setWords({ ...words, defaultExclusions: value })} /></div>
    </SettingsRow>
    <SettingsRow label={t("Contact details")} hint={t("Shown on the closing page: phone, email, address, social handles.")} align="start">
      <div className={styles.wide}><TextAreaField aria-label={t("Contact details")} label={null} isReadOnly={readOnly} value={words.contactDetails} onChange={(value) => setWords({ ...words, contactDetails: value })} /></div>
    </SettingsRow>
    <SettingsRow label={t("Website")}>
      <div className={styles.wide}><TextInput aria-label={t("Website")} label={null} isReadOnly={readOnly} inputMode="url" placeholder="example.com" value={words.website} onChange={(value) => setWords({ ...words, website: value })} /></div>
    </SettingsRow>
    {readOnly ? null : <div className={styles.actions}>{saved && !changed.length ? <span className={styles.saved}>{t("Saved")}</span> : null}
      <Button size="compact" variant="primary" isLoading={busy === "words"} isDisabled={!changed.length || Boolean(busy)} onPress={() => void send(Object.fromEntries(changed.map((key) => [key, words[key]])), "words")}>{t("Save")}</Button></div>}

    {picture("introductionImage", t("Introduction picture"), t("Shown above your introduction."))}
    <SettingsRow label={t("Terms pictures")} hint={t("Up to three pictures above your terms.")} align="start">
      <div className={styles.pictures}>
        {kit.termsImages.map((src, index) => <PictureSlot key={index} src={src} label={t("Terms picture {number}", { number: index + 1 })} readOnly={readOnly} busy={busy === "termsImages"} onChoose={() => choose("termsImages", index)} onRemove={() => remove("termsImages", index)} />)}
        {kit.termsImages.length < 3 && !readOnly ? <PictureSlot src={null} label={t("Add a terms picture")} readOnly={readOnly} busy={busy === "termsImages"} onChoose={() => choose("termsImages")} onRemove={() => undefined} /> : null}
      </div>
    </SettingsRow>
    {picture("closingImage", t("Closing picture"), t("Shown above your contact details on the last page."))}
    {picture("monogramImage", t("Monogram"), t("A small mark in the page corners. Use a simple, square picture."))}
    <input ref={file} className={styles.fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t("Choose a picture")} tabIndex={-1}
      onChange={(event) => { void picked(event.target.files?.[0]); event.target.value = ""; }} />
  </SettingsSection>;
}

function PictureSlot({ src, label, readOnly, busy, onChoose, onRemove }: { src: string | null; label: string; readOnly: boolean; busy: boolean; onChoose: () => void; onRemove: () => void }) {
  const t = useT();
  return <div className={styles.picture}>
    {src ? <img src={src} alt={label} /> : <span className={styles.pictureEmpty}>{t("No picture")}</span>}
    {readOnly ? null : <div className={styles.pictureActions}>
      <Button size="compact" variant="quiet" isLoading={busy} onPress={onChoose}><ImagePlus aria-hidden="true" size={14} />{src ? t("Replace") : t("Upload")}</Button>
      {src ? <Button size="compact" variant="quiet" isDisabled={busy} onPress={onRemove}><Trash2 aria-hidden="true" size={14} />{t("Remove")}</Button> : null}
    </div>}
  </div>;
}

function pick(kit: ProposalKit): Words {
  return { introduction: kit.introduction, letterNote: kit.letterNote, defaultTerms: kit.defaultTerms, defaultExclusions: kit.defaultExclusions, contactDetails: kit.contactDetails, website: kit.website };
}
