"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { AlertCircle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { Button, IconButton } from "../components/actions";
import { Badge } from "../components/status";
import { SelectField, type SelectItem } from "../components/forms";

export type IntegrationState = "connected" | "syncing" | "attention" | "disconnected";
const integrationStateLabels = { connected: tKey("Connected"), syncing: tKey("Syncing"), attention: tKey("Needs attention"), disconnected: tKey("Disconnected") } as const;
const syncStatusLabels = { success: tKey("Succeeded"), error: tKey("Failed"), running: tKey("Running") } as const;
export function IntegrationConnectionRow({ account, icon, lastSync, name, onConnect, onManage, state }: { account?: string; icon?: React.ReactNode; lastSync?: string; name: string; onConnect?: () => void; onManage?: () => void; state: IntegrationState }) { const t = useT(); return <div className="wd-integration-row"><span className="wd-integration-icon">{icon}</span><div><strong>{name}</strong><small>{account ?? t("No account connected")}{lastSync ? ` · ${t("Synced {date}", { date: lastSync })}` : ""}</small></div><Badge tone={state === "connected" ? "success" : state === "attention" ? "danger" : state === "syncing" ? "info" : "neutral"}>{t(integrationStateLabels[state])}</Badge><Button onPress={state === "disconnected" ? onConnect : onManage} size="compact">{state === "disconnected" ? t("Connect") : t("Manage")}<ExternalLink size={13} /></Button></div>; }

export type FieldMap = { id: string; source: string; target?: string };
export function FieldMapping({ maps, onChange, targets }: { maps: FieldMap[]; onChange?: (maps: FieldMap[]) => void; targets: SelectItem[] }) {
  const t = useT(); return <div className="wd-field-mapping"><header><strong>{t("Source field")}</strong><strong>{t("Wodana field")}</strong></header>{maps.map((map) => <div key={map.id}><span>{map.source}</span><SelectField aria-label={t("Map {field}", { field: map.source })} items={targets} label={<span className="wd-visually-hidden">{t("Wodana field")}</span>} onSelectionChange={(key) => onChange?.(maps.map((entry) => entry.id === map.id ? { ...entry, target: String(key) } : entry))} selectedKey={map.target} /></div>)}</div>; }

export type SyncLogEntry = { id: string; occurredAt: string; status: "success" | "error" | "running"; summary: string; detail?: string };
export function SyncLog({ entries, onRetry }: { entries: SyncLogEntry[]; onRetry?: (entry: SyncLogEntry) => void }) {
  const t = useT(); return <div className="wd-sync-log">{entries.map((entry) => <div key={entry.id}>{entry.status === "success" ? <CheckCircle2 size={15} /> : entry.status === "error" ? <AlertCircle size={15} /> : <RefreshCw className="wd-spin" size={15} />}<span><strong>{entry.summary}</strong><small>{entry.occurredAt}{entry.detail ? ` · ${entry.detail}` : ""}</small></span><Badge tone={entry.status === "success" ? "success" : entry.status === "error" ? "danger" : "info"}>{t(syncStatusLabels[entry.status])}</Badge>{entry.status === "error" ? <IconButton aria-label={t("Retry sync")} onPress={() => onRetry?.(entry)}><RefreshCw size={14} /></IconButton> : null}</div>)}</div>; }

export function ConflictResolution({ localValue, onChoose, remoteValue }: { localValue: React.ReactNode; onChoose?: (source: "local" | "remote") => void; remoteValue: React.ReactNode }) {
  const t = useT(); return <div className="wd-conflict"><strong>{t("Choose which value to keep")}</strong><button onClick={() => onChoose?.("local")} type="button"><small>Wodana</small>{localValue}</button><button onClick={() => onChoose?.("remote")} type="button"><small>{t("Connected app")}</small>{remoteValue}</button></div>; }
