"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState, type ReactNode } from "react";
import { Bot, Check, ChevronRight, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "../components/actions";
import { Badge, Progress } from "../components/status";
import { Skeleton } from "../components/skeleton";

export type AICitation = { id: string; label: string; href?: string };
export type AIDiffLine = { id: string; kind: "add" | "remove" | "unchanged"; content: string };
export function AILabel({ children }: { children?: ReactNode }) { const t = useT(); return <Badge tone="info"><Sparkles size={12} />{children ?? t("AI assisted")}</Badge>; }

export function AIResult({ citations = [], confidence, diff, isStreaming = false, onAccept, onReject, onRevert, rationale, title, children }: { citations?: AICitation[]; confidence?: number; diff?: AIDiffLine[]; isStreaming?: boolean; onAccept?: () => void; onReject?: () => void; onRevert?: () => void; rationale?: ReactNode; title: string; children?: ReactNode }) {
  const t = useT();
  const [showWhy, setShowWhy] = useState(false);
  return <section className="wd-ai-result"><header><span><Bot size={17} /><strong>{title}</strong><AILabel /></span>{confidence != null ? <button onClick={() => setShowWhy((value) => !value)} type="button">{t("{percent}% confidence", { percent: Math.round(confidence * 100) })}<ChevronRight data-directional="true" size={13} /></button> : null}</header>{isStreaming ? <div className="wd-ai-stream"><Skeleton lines={4} /></div> : <div className="wd-ai-content">{children}{diff ? <AIDiff lines={diff} /> : null}</div>}{showWhy && rationale ? <div className="wd-ai-rationale"><strong>{t("Why Wodana suggested this")}</strong>{rationale}{confidence != null ? <Progress label={t("AI confidence")} max={1} value={confidence} /> : null}</div> : null}{citations.length ? <div className="wd-ai-citations"><span>{t("Sources")}</span>{citations.map((citation, index) => citation.href ? <a href={citation.href} key={citation.id} rel="noreferrer" target="_blank">{index + 1}. {citation.label}</a> : <span key={citation.id}>{index + 1}. {citation.label}</span>)}</div> : null}<footer>{onRevert ? <Button onPress={onRevert} size="compact"><RotateCcw size={13} />{t("Revert")}</Button> : <span />}{onReject ? <Button onPress={onReject} size="compact"><X size={13} />{t("Reject")}</Button> : null}{onAccept ? <Button onPress={onAccept} size="compact" variant="primary"><Check size={13} />{t("Accept")}</Button> : null}</footer></section>;
}

export function AIDiff({ lines }: { lines: AIDiffLine[] }) { return <pre className="wd-ai-diff">{lines.map((line) => <span data-kind={line.kind} key={line.id}>{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "} {line.content}</span>)}</pre>; }

export function AutomationPreview({ actions, onApprove, summary }: { actions: string[]; onApprove?: () => void; summary: string }) {
  const t = useT(); return <div className="wd-automation-preview"><header><Sparkles size={16} /><strong>{t("Review before Wodana acts")}</strong></header><p>{summary}</p><ol>{actions.map((action, index) => <li key={action}><span>{index + 1}</span>{action}</li>)}</ol><Button onPress={onApprove} variant="primary">{t("Approve and run")}</Button></div>; }

export function PromptComposer({ onSubmit, placeholder }: { onSubmit?: (prompt: string) => void; placeholder?: string }) {
  const t = useT(); const [value, setValue] = useState(""); return <div className="wd-prompt-composer"><textarea aria-label={t("Prompt")} onChange={(event) => setValue(event.target.value)} placeholder={placeholder ?? t("Ask Wodana to draft, check, or update…")} value={value} /><Button isDisabled={!value.trim()} onPress={() => { onSubmit?.(value.trim()); setValue(""); }} variant="primary"><Sparkles size={14} />{t("Ask Wodana")}</Button></div>; }
