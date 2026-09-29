"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Copy, Download, MessageCircle, Printer } from "lucide-react";
import { Button, ControlledModalDialog, FormSection, SegmentedControl, SelectField, TextAreaField, TextInput } from "@/design-system";
import type { LeadsPageData } from "@/lib/crm/leads";
import type { LeadFormRecord } from "@/lib/crm/lead-forms";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./lead-forms.module.css";

/**
 * One sheet for every place a form goes: a link tagged with its source, channel and placement (PLM-036 /
 * PLM-028, re-checked by the server), the one-question-per-screen layout, a WhatsApp message, an embed
 * snippet, and the QR code as PNG, SVG or a printed A4 poster for showrooms and site boards.
 */
export function LeadFormShareSheet({ form, options, brandName, logoUrl, onClose, onNotice, onError }: {
  form: LeadFormRecord; options: LeadsPageData["leadOptions"]; brandName?: string; logoUrl?: string | null;
  onClose: () => void; onNotice: (message: string) => void; onError: (message: string) => void;
}) {
  const t = useT();
  const [source, setSource] = useState("");
  const [channel, setChannel] = useState("");
  const [placement, setPlacement] = useState("");
  const [layout, setLayout] = useState("classic");
  const [qr, setQr] = useState({ png: "", svg: "" });
  const placementSlug = placement.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const params = new URLSearchParams({ ...(source && channel ? { source, channel } : {}), ...(placementSlug ? { placement: placementSlug } : {}), ...(layout === "steps" ? { layout: "steps" } : {}) }).toString();
  const url = typeof window !== "undefined" ? `${window.location.origin}/enquiry/${form.token}${params ? `?${params}` : ""}` : "";
  const title = form.published?.title ?? form.draft.title;
  const message = t("{title}: share a few details and we will get back to you. {url}", { title, url });
  const embed = `<iframe src="${url}" title="${title.replace(/"/g, "&quot;")}" width="100%" height="900" loading="lazy" style="border:0"></iframe>`;
  const fileName = `enquiry-form-qr${placementSlug ? `-${placementSlug}` : channel ? `-${channel}` : ""}`;

  useEffect(() => {
    if (!url) return;
    let mounted = true;
    import("qrcode").then(async module => {
      const [png, svg] = await Promise.all([module.toDataURL(url, { width: 600, margin: 4, errorCorrectionLevel: "M" }), module.toString(url, { type: "svg", margin: 4, errorCorrectionLevel: "M" })]);
      if (mounted) setQr({ png, svg: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
    }).catch(() => onError(t("QR code could not be generated.")));
    return () => { mounted = false; };
  }, [url]);
  const copy = (text: string, done: string) => { void navigator.clipboard.writeText(text).then(() => onNotice(done)).catch(() => onError(t("Select and copy the text manually."))); };

  return <ControlledModalDialog isOpen onOpenChange={open => { if (!open) onClose(); }} title={t("Share enquiry form")} size="lg">
    <div className={styles.share}>
      <FormSection title={t("Where it's shared")}>
        <div className={styles.shareFields}>
          <SelectField label={t("Source")} selectedKey={source || "form"} items={[{ id: "form", label: t("Form default") }, ...(options?.sources ?? []).filter(item => !item.allowedRoles?.length && !["returning_customer", "referral"].includes(item.id)).map(item => ({ id: item.id, label: item.label }))]} onSelectionChange={key => { setSource(key === "form" ? "" : String(key)); setChannel(""); }} />
          {source ? <SelectField label={t("Channel")} isRequired selectedKey={channel || null} items={(options?.channels[source] ?? []).map(item => ({ id: item.id, label: item.label }))} onSelectionChange={key => setChannel(String(key ?? ""))} /> : null}
          <TextInput label={t("Placement")} description={t("For example: showroom door, magazine, event stand.")} value={placement} onChange={setPlacement} maxLength={60} />
        </div>
        <SegmentedControl label={t("Layout")} value={layout} onChange={setLayout} options={[{ id: "classic", label: t("All questions") }, { id: "steps", label: t("One question per screen") }]} />
      </FormSection>
      <div className={styles.copyRow}><TextInput label={t("Form link")} value={url} isReadOnly /><Button onPress={() => copy(url, t("Form link copied."))}><Copy size={14} aria-hidden="true" />{t("Copy link")}</Button></div>
      <div className={styles.copyRow}>
        <TextAreaField label={t("WhatsApp message")} value={message} isReadOnly />
        <div className={styles.copyActions}>
          <Button onPress={() => copy(message, t("Message copied."))}><Copy size={14} aria-hidden="true" />{t("Copy message")}</Button>
          <a className={styles.linkButton} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><MessageCircle size={14} aria-hidden="true" />{t("Open WhatsApp")}</a>
        </div>
      </div>
      <div className={styles.copyRow}><TextInput label={t("Embed code")} value={embed} isReadOnly /><Button onPress={() => copy(embed, t("Embed code copied."))}><Copy size={14} aria-hidden="true" />{t("Copy code")}</Button></div>
      {qr.png && <div className={styles.qrBlock}>
        <Image unoptimized src={qr.png} alt={t("QR code for this enquiry form")} width={200} height={200} />
        <div className={styles.copyActions}>
          <a className={styles.linkButton} href={qr.png} download={`${fileName}.png`}><Download size={14} aria-hidden="true" />{t("Download PNG")}</a>
          <a className={styles.linkButton} href={qr.svg} download={`${fileName}.svg`}><Download size={14} aria-hidden="true" />{t("Download SVG")}</a>
          <Button onPress={() => window.print()}><Printer size={14} aria-hidden="true" />{t("Print poster")}</Button>
        </div>
      </div>}
      {/* The A4 poster: only printed, never shown on screen. */}
      {qr.png && <div className={styles.poster} aria-hidden="true">
        {logoUrl ? <Image unoptimized src={logoUrl} alt="" width={220} height={88} /> : brandName ? <strong>{brandName}</strong> : null}
        <h1>{title}</h1>
        <Image unoptimized src={qr.png} alt="" width={420} height={420} />
        <p>{t("Scan to enquire")}</p>
        <small>{url}</small>
      </div>}
    </div>
  </ControlledModalDialog>;
}
