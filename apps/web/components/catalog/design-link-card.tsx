"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Image as ImageIcon, Link2 } from "lucide-react";
import { Button, Callout, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { linkCardImageUrl, sourcingApi, type LinkCard } from "@/lib/workspace/product-sourcing";
import styles from "./product-sourcing.module.css";

/** A link's stored card (title and thumbnail copied into our storage); `failed` when it can't be read. */
export function useLinkCard(workspaceId: string, url: string | null) {
  const [state, setState] = useState<{ url: string | null; card: LinkCard | null; failed: boolean }>({ url: null, card: null, failed: false });
  useEffect(() => {
    let live = true;
    if (!url) return;
    sourcingApi<LinkCard>(workspaceId, "link-previews", { body: { url } }).then((card) => { if (live) setState({ url, card, failed: false }); })
      .catch(() => { if (live) setState({ url, card: null, failed: true }); });
    return () => { live = false; };
  }, [workspaceId, url]);
  return state.url === url ? { card: state.card, failed: state.failed } : { card: null, failed: false };
}

/** True for a Canva design or share link (the card says "Open in Canva"). */
export const isCanvaUrl = (url: string) => {
  try { const host = new URL(url).hostname.toLowerCase(); return ["canva.com", "www.canva.com", "canva.link"].includes(host) || host.endsWith(".canva.site"); } catch { return false; }
};

/**
 * A design link as a card (plan §6.25, §6.7a): the stored thumbnail and title from Canva (Connect API when configured,
 * otherwise the share page's preview), and Open. Used on design boards and concept options.
 */
export function DesignLinkCard({ workspaceId, url, title: fallbackTitle, actions }: { workspaceId: string; url: string; title?: string; actions?: React.ReactNode }) {
  const t = useT();
  const { card, failed } = useLinkCard(workspaceId, url);
  const canva = isCanvaUrl(url);
  let host = "";
  try { host = new URL(url).hostname; } catch { /* shown without a host */ }
  if (!card && !failed) return <div className={styles.card}><Skeleton lines={2} /></div>;
  return <div className={styles.card}>
    {card?.hasImage
      // eslint-disable-next-line @next/next/no-img-element -- the thumbnail copied into our storage, streamed through the signed-in route
      ? <img alt="" className={styles.thumb} loading="lazy" src={linkCardImageUrl(workspaceId, card.id)} />
      : <span aria-hidden="true" className={styles.thumb} data-empty=""><ImageIcon size={20} /></span>}
    <span className={styles.cardText}>
      <strong dir="auto">{fallbackTitle || card?.title || (canva ? t("Canva design") : host)}</strong>
      <small dir="ltr">{card?.host ?? host}</small>
    </span>
    <span className={styles.actions}>
      {actions}
      <Button onPress={() => window.open(url, "_blank", "noopener,noreferrer")} size="compact"><ExternalLink aria-hidden="true" data-directional="true" size={14} />{canva ? t("Open in Canva") : t("Open")}</Button>
    </span>
  </div>;
}

/** Attach a Canva design: paste its share link, see the card, then attach it. */
export function AttachDesignLink({ workspaceId, onAttach }: { workspaceId: string; onAttach: (link: { url: string; title: string | null }) => Promise<void> | void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [card, setCard] = useState<LinkCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = async () => {
    setBusy(true); setError("");
    try { setCard(await sourcingApi<LinkCard>(workspaceId, "link-previews", { body: { url: url.trim() } })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setBusy(false); }
  };
  const attach = async () => {
    if (!card) return;
    setBusy(true); setError("");
    try { await onAttach({ url: card.url, title: card.title }); setUrl(""); setCard(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setBusy(false); }
  };
  return <div className={styles.panel}>
    {error ? <Callout title={t("Could not attach the design")} tone="danger">{error}</Callout> : null}
    <form className={styles.attach} onSubmit={(event) => { event.preventDefault(); if (url.trim()) void preview(); }}>
      <TextInput dir="ltr" inputType="url" label={t("Canva link")} onChange={(value) => { setUrl(value); setCard(null); }} placeholder="https://www.canva.com/design/…" prefix={<Link2 aria-hidden="true" size={14} />} value={url} />
      {card ? null : <Button isDisabled={!url.trim()} isLoading={busy} type="submit">{t("Preview")}</Button>}
    </form>
    {card ? <DesignLinkCard url={card.url} workspaceId={workspaceId} actions={<Button isLoading={busy} onPress={() => void attach()} size="compact" variant="primary">{t("Attach design")}</Button>} /> : null}
  </div>;
}
