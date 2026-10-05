"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Copy, Download } from "lucide-react";
import { Button, ControlledModalDialog, FormSection, InlineNotice, SelectField, TextAreaField, TextInput } from "@/design-system";
import { iframeSnippet, popupSnippet, shareUrl, type BookingTypeRecord, type BookingTypesData } from "@/lib/booking/booking";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./booking.module.css";

/** One sheet for every place a booking page goes: a link per placement, its QR code, an inline embed and a popup button. */
export function BookingShareSheet({ type, publicSlug, options, onClose, origin: givenOrigin }: {
  type: BookingTypeRecord; publicSlug: string; options: BookingTypesData["options"]; onClose: () => void; origin?: string;
}) {
  const t = useT();
  const [source, setSource] = useState("");
  const [channel, setChannel] = useState("");
  const [placement, setPlacement] = useState("");
  const [qr, setQr] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const origin = givenOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const placementSlug = placement.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const url = shareUrl(origin, publicSlug, type.slug, { ...(source && channel ? { source, channel } : {}), placement: placementSlug || undefined });
  const embed = iframeSnippet(url, type.name);
  const popup = popupSnippet(origin, url, t("Book a meeting"));

  useEffect(() => {
    let mounted = true;
    import("qrcode").then((module) => module.toDataURL(url, { width: 600, margin: 4, errorCorrectionLevel: "M" }))
      .then((png) => { if (mounted) setQr(png); })
      .catch(() => { if (mounted) setMessage({ tone: "error", text: t("QR code could not be generated.") }); });
    return () => { mounted = false; };
  }, [url, t]);
  const copy = (text: string, done: string) => {
    void navigator.clipboard.writeText(text).then(() => setMessage({ tone: "success", text: done })).catch(() => setMessage({ tone: "error", text: t("Select and copy the text manually.") }));
  };

  return <ControlledModalDialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={t("Share {name}", { name: type.name })} size="lg">
    <div className={styles.share}>
      {message ? <InlineNotice tone={message.tone === "error" ? "error" : "success"} message={message.text} /> : null}
      <FormSection title={t("Where it's shared")}>
        <SelectField label={t("Source")} selectedKey={source || "type"} onSelectionChange={(key) => { setSource(key === "type" ? "" : String(key)); setChannel(""); }}
          items={[{ id: "type", label: t("Booking type default") }, ...options.sources.filter((item) => !["returning_customer", "referral"].includes(item.id))]} />
        {source ? <SelectField label={t("Channel")} isRequired selectedKey={channel || null} items={options.channels[source] ?? []} onSelectionChange={(key) => setChannel(String(key ?? ""))} /> : null}
        <TextInput label={t("Placement")} description={t("For example: showroom door, magazine, event stand.")} value={placement} onChange={setPlacement} maxLength={60} />
      </FormSection>
      <div className={styles.copyRow}><TextInput label={t("Booking link")} value={url} isReadOnly /><Button onPress={() => copy(url, t("Link copied."))}><Copy size={14} aria-hidden="true" />{t("Copy link")}</Button></div>
      <div className={styles.copyRow}><TextAreaField label={t("Embed on a page")} value={embed} isReadOnly /><Button onPress={() => copy(embed, t("Embed code copied."))}><Copy size={14} aria-hidden="true" />{t("Copy code")}</Button></div>
      <div className={styles.copyRow}><TextAreaField label={t("Popup button")} value={popup} isReadOnly /><Button onPress={() => copy(popup, t("Embed code copied."))}><Copy size={14} aria-hidden="true" />{t("Copy code")}</Button></div>
      {qr ? <div className={styles.qrBlock}>
        <Image unoptimized src={qr} alt={t("QR code for this booking page")} width={160} height={160} />
        <a className={styles.linkButton} href={qr} download={`booking-${type.slug}${placementSlug ? `-${placementSlug}` : ""}.png`}><Download size={14} aria-hidden="true" />{t("Download PNG")}</a>
      </div> : null}
    </div>
  </ControlledModalDialog>;
}
