"use client";

import { Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, IconButton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";

type Suggestion = { id: string; kind: string; title: string; text: string; source: string; confidence: number; version: number; action: { type: "thread_message" | "copy"; body: string } };

/**
 * §0.3 P11: the step now's suggestions, one line each: what, where it comes from and how sure, then Use (one click) or
 * dismiss. Optional: with AI off, or nothing to suggest, nothing shows and the step works the same.
 */
export function JobSuggestions({ workspaceId, jobId, onUsed }: { workspaceId: string; jobId: string; onUsed?: () => void }) {
  const t = useT();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const url = (id = "") => `/api/workspace/jobs/${jobId}/suggestions${id ? `/${id}` : ""}?workspaceId=${encodeURIComponent(workspaceId)}`;
  const load = useCallback(async () => {
    const response = await fetch(url(), { cache: "no-store" }).catch(() => null);
    const data = response?.ok ? await response.json().catch(() => null) : null;
    setItems(Array.isArray(data?.items) ? data.items : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the url depends only on the ids
  }, [workspaceId, jobId]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const decide = async (item: Suggestion, action: "use" | "dismiss") => {
    setBusy(item.id);
    if (action === "use" && item.action.type === "copy") await navigator.clipboard?.writeText(item.action.body).catch(() => undefined);
    const response = await fetch(url(item.id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, version: item.version }) }).catch(() => null);
    setBusy(null);
    if (response?.ok) {
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      if (action === "use") { setDone(item.action.type === "copy" ? t("Copied. Paste it into WhatsApp or email.") : t("Sent to the job chat.")); onUsed?.(); }
    } else void load();
  };
  if (!items.length && !done) return null;
  return <ul className="wd-job-suggestions" aria-label={t("Suggestions")}>
    {items.map((item) => <li key={item.id}>
      <Sparkles aria-hidden="true" size={14} className="wd-job-suggestion-icon" />
      <span className="wd-job-suggestion-text"><strong>{item.title}</strong><span>{item.text}</span></span>
      <span className="wd-job-suggestion-chips" title={item.source}>
        <Badge hue={2}>{t("Suggested")}</Badge>
        <Badge>{t("{percent}% sure", { percent: Math.round(item.confidence * 100) })}</Badge>
      </span>
      <Button size="compact" variant="secondary" isLoading={busy === item.id} onPress={() => void decide(item, "use")}>{item.action.type === "copy" ? t("Copy") : t("Use")}</Button>
      <IconButton aria-label={t("Dismiss {name}", { name: item.title })} size="compact" variant="quiet" onPress={() => void decide(item, "dismiss")}><X size={14} /></IconButton>
    </li>)}
    {done ? <li className="wd-job-suggestion-done" role="status">{done}</li> : null}
  </ul>;
}
