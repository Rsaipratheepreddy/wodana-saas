"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { InlineNotice, Switch } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { loadAiSettings, type AiSettings } from "@/lib/workspace/ai-settings";
import styles from "./company-profile.module.css";

/** Workspace switch for AI assistance. AI only suggests; nothing changes until a person accepts. */
export function AiAssistanceSetting({ workspaceId, canManage, bare = false }: { workspaceId: string; canManage: boolean; /** Inside a settings row: just the switch. */ bare?: boolean }) {
  const t = useT();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void loadAiSettings(workspaceId).then(setSettings); }, [workspaceId]);
  if (!settings) return null;
  const change = async (enabled: boolean) => {
    setError("");
    const response = await fetch("/api/workspace/ai-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, enabled, version: settings.version }) });
    const payload = await response.json().catch(() => null) as AiSettings & { message?: string } | null;
    if (!response.ok || !payload) { setError(payload?.message ?? t("AI settings could not be saved.")); return; }
    setSettings(payload);
  };
  if (bare) return <>
    <Switch aria-label={t("AI assistance")} isDisabled={!canManage || !settings.available} isSelected={settings.enabled} onChange={(value) => void change(value)} />
    {error ? <InlineNotice message={error} tone="error" /> : null}
  </>;
  return <div className={styles.aiSetting}>
    <Sparkles aria-hidden="true" size={16} />
    <div>
      <Switch isDisabled={!canManage || !settings.available} isSelected={settings.enabled} onChange={(value) => void change(value)}>{t("AI assistance")}</Switch>
      <small>{settings.available ? t("AI suggests; nothing changes until someone accepts.") : t("Not set up yet.")}</small>
    </div>
    {error ? <InlineNotice message={error} tone="error" /> : null}
  </div>;
}
