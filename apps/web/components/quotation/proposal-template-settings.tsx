"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Lock, Trash2 } from "lucide-react";
import { Badge, Button, FileUploader, IconButton, InlineNotice, SettingsRow, SettingsSection, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { proposalTemplateApi, type ProposalTemplate } from "@/lib/proposals/client";
import styles from "./quotation-settings.module.css";

const PAGES = [1, 2, 3, 4, 5] as const;
const ACCEPT = "application/pdf,image/png,image/jpeg";

/**
 * PLM-085: the firm's five-page proposal. Pages 1–3 and 5 are its own designed pages (a PDF or a picture each),
 * locked: only whoever manages settings replaces them, and every change is a new version (sent proposals keep
 * theirs). Page 4 is always the live quotation, made from each quote.
 */
export function ProposalTemplateSettings({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const api = proposalTemplateApi(workspaceId);
  const [template, setTemplate] = useState<ProposalTemplate | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      const next = await proposalTemplateApi(workspaceId).get();
      if (!next || !Array.isArray(next.pages)) throw new Error(t("Could not load the settings."));
      setTemplate(next); setError("");
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the settings.")); }
  }, [workspaceId, t]);
  useEffect(() => { void load(); }, [load]);

  const label = (page: number) => page === 4 ? t("Page 4 · The quotation") : t("Page {number}", { number: page });
  const run = async (page: number, work: () => Promise<ProposalTemplate>) => {
    setBusy(page); setError("");
    try { setTemplate(await work()); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); await load(); }
    finally { setBusy(null); }
  };

  return <SettingsSection id="proposal-pages" title={t("Proposal pages")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {!template ? (error ? <Button size="compact" onPress={() => void load()}>{t("Retry")}</Button> : <Skeleton lines={5} shape="form" />)
      : PAGES.map((page) => {
        if (page === 4) return <SettingsRow key={page} label={label(page)} hint={t("Made from each quote: its items, totals and payment plan.")}>
          <Badge tone="info">{t("From the quote")}</Badge>
        </SettingsRow>;
        const current = template.pages.find((item) => item.slot === page);
        return <SettingsRow key={page} label={label(page)} hint={current ? (current.pageCount === 1 ? t("{name} · 1 page", { name: current.fileName }) : t("{name} · {pages} pages", { name: current.fileName, pages: current.pageCount })) : t("Not added; the proposal leaves it out.")}>
          <div className={styles.pageSlot}>
            {current ? <a className="wd-button" data-size="compact" data-variant="quiet" href={api.fileUrl(page)} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" size={14} />{t("View")}</a> : null}
            {template.canManage ? <>
              <FileUploader accept={ACCEPT} appearance="button" multiple={false} label={current ? t("Replace") : t("Upload")}
                onFiles={(files) => files[0] && void run(page, () => api.set(page, files[0], template.version))} />
              {current ? <IconButton aria-label={t("Remove page {number}", { number: page })} size="compact" variant="quiet" isDisabled={busy === page}
                onPress={() => void run(page, () => api.remove(page, template.version))}><Trash2 aria-hidden="true" size={14} /></IconButton> : null}
            </> : current ? <Lock aria-label={t("Locked")} size={14} /> : null}
          </div>
        </SettingsRow>;
      })}
  </SettingsSection>;
}
