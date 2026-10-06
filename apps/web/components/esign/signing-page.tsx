"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { EmptyState, ErrorState, InlineNotice, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { signingApi, type SigningView } from "@/lib/proposals/client";
import { SignDocument } from "./sign-document";
import styles from "./esign.module.css";

/**
 * The signing page a client opens from the email (R8): no account. They read the exact PDF, confirm who they
 * are and sign; a used link shows the signed copy, an expired or withdrawn one says so.
 */
export function SigningPage({ token, initial }: { token: string; initial?: SigningView }) {
  const t = useT();
  const api = signingApi(token);
  const [view, setView] = useState<SigningView | null>(initial ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try { setView(await signingApi(token).view()); } catch (cause) { setError(cause instanceof Error ? cause.message : t("This signing link isn't valid.")); }
  }, [token, t]);
  useEffect(() => { if (!initial) void load(); }, [initial, load]);

  if (error && !view) return <main className={styles.page}><ErrorState title={t("This link can't be opened")} description={error} onRetry={() => void load()} /></main>;
  if (!view) return <main className={styles.page}><Skeleton lines={8} shape="form" /></main>;

  const money = view.document.amount && view.document.currency
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: view.document.currency }).format(Number(view.document.amount)) : null;
  return <main className={styles.page}>
    <header className={styles.brand}>
      {view.brand.logo ? <img src={view.brand.logo} alt={view.brand.name} className={styles.logo} /> : <strong>{view.brand.name}</strong>}
    </header>
    <h1 className={styles.title}>{view.state === "signed" ? t("Signed") : t("Sign {reference}", { reference: view.document.reference || view.document.title })}</h1>
    <section className={styles.document} aria-label={t("Document")}>
      <FileText aria-hidden="true" size={20} />
      <div className={styles.documentText}>
        <strong>{view.document.title}</strong>
        <span>{[view.document.reference, money].filter(Boolean).join(" · ")}</span>
        <code className={styles.fingerprint} dir="ltr" title={t("Document fingerprint (SHA-256)")}>{view.document.sha256}</code>
      </div>
      <a className="wd-button" data-size="compact" data-variant={view.state === "signed" ? "primary" : "secondary"} href={api.documentUrl(view.state === "signed")} target="_blank" rel="noreferrer">
        <Download aria-hidden="true" size={14} />{view.state === "signed" ? t("Download your signed copy") : t("Read the document")}
      </a>
    </section>
    {view.state === "open" ? <>
      <iframe className={styles.viewer} src={api.documentUrl(false)} title={view.document.title} />
      <SignDocument signer={view.signer} busy={busy} onSign={async (input) => {
        setBusy(true);
        try {
          await api.sign({ ...input, email: input.email || undefined, phone: input.phone || undefined, documentSha256: view.document.sha256 });
          await load();
        } finally { setBusy(false); }
      }} />
    </> : view.state === "signed" && view.signed ? <InlineNotice tone="success" message={t("{name} signed on {date}. A copy was sent by email.", {
      name: view.signed.name, date: new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(new Date(view.signed.at)) })} />
      : <EmptyState illustration="error" title={view.state === "expired" ? t("This signing link has expired") : t("This signing link was withdrawn")}
        description={t("Ask {name} for a new link.", { name: view.brand.name })} />}
  </main>;
}
