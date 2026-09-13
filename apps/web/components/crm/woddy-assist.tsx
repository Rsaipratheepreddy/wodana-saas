"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/design-system";
import { useWoddy } from "./woddy-chat";
import styles from "./crm-workbench.module.css";
export function WoddyAssist({ workspaceId, leadId }: { workspaceId: string; leadId: string }) {
  const woddy = useWoddy();
  const [result, setResult] = useState<{ summary: string; checks: string[]; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <section className={styles.assistant} aria-label="Woddy lead assistance"><div className={styles.toolbar}><h3><Sparkles size={15} aria-hidden="true" />Woddy</h3><Button size="compact" onPress={woddy?.open}>Chat with Woddy</Button><Button size="compact" isLoading={busy} onPress={async () => { setBusy(true); setError(""); try { const response = await fetch("/api/workspace/crm/assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, leadId }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.message ?? "Could not review the lead."); setResult(payload); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}>Review lead</Button></div>{result ? <><p className={styles.message}>{result.summary}</p><ul>{result.checks.map((check) => <li key={check}>{check}</li>)}</ul><small>{result.note}</small></> : <p>A quick summary, missing information, and suggested next steps.</p>}{error ? <p role="alert">{error}</p> : null}</section>;
}
