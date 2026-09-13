"use client";

import { useState } from "react";
import {
  Button,
  Callout,
  ConfirmationDialog,
  DesignSystemProvider,
  formatDate,
} from "@/design-system";
import type { SecurityPageData, SecuritySession } from "@/lib/workspace/security";
import { deviceDetails } from "@/lib/auth/device-details";
import styles from "./security-page.module.css";

const DUBAI_FORMAT = { locale: "en-GB", timeZone: "Asia/Dubai" };

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

function sessionLabel(session: SecuritySession) {
  const details = deviceDetails(session.userAgent);
  return `${details.browser} on ${details.device}`;
}

export function SecurityPage({ initialData }: { initialData: SecurityPageData }) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [sessions, setSessions] = useState(initialData.sessions);
  const [selectedSession, setSelectedSession] = useState<SecuritySession | null>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");

  const revokeSession = async () => {
    if (!selectedSession) return;
    setWorking(true);
    setFailure("");
    try {
      const response = await fetch(`/api/workspace/security/sessions/${selectedSession.familyId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: initialData.workspaceId }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The session could not be signed out."));
      setSessions((current) => current.filter((session) => session.familyId !== selectedSession.familyId));
      setStatus(`${sessionLabel(selectedSession)} was signed out.`);
      setSelectedSession(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The session could not be signed out.");
      setSelectedSession(null);
    } finally {
      setWorking(false);
    }
  };

  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-label="Active sessions" className={styles.page}>
      {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
      {failure ? <Callout title="Sign out failed" tone="danger">{failure}</Callout> : null}
      <div aria-label="Active sessions table" className={styles.tableScroll} role="region" tabIndex={0}>
        <table data-record-table="" aria-label="Active sessions" className={styles.sessionTable}>
          <thead><tr><th scope="col">Device</th><th scope="col">IP address</th><th scope="col">Last active</th><th scope="col">Status / action</th></tr></thead>
          <tbody>{sessions.map((session) => {
            const details = deviceDetails(session.userAgent);
            return <tr key={session.familyId}>
              <td><span className={styles.device}><strong>{details.browser}</strong><small>{details.device}</small></span></td>
              <td>{session.ipAddress ?? "—"}</td>
              <td><time dateTime={session.lastActiveAt}>{formatDate(session.lastActiveAt, DUBAI_FORMAT, { dateStyle: "medium", timeStyle: "short" })}</time></td>
              <td>{session.current ? <span className={styles.current}>This device</span> : <Button aria-label={`Sign out ${sessionLabel(session)}`} isDisabled={working} onPress={() => setSelectedSession(session)} size="compact" variant="quiet">Sign out</Button>}</td>
            </tr>;
          })}
          {!sessions.length ? <tr><td colSpan={4}>No active sessions.</td></tr> : null}</tbody>
        </table>
      </div>
    </section>

    <ConfirmationDialog
      body={selectedSession ? <>Sign out <strong>{sessionLabel(selectedSession)}</strong>? That browser will need to sign in again.</> : null}
      confirmLabel={working ? "Signing out…" : "Sign out session"}
      isOpen={Boolean(selectedSession)}
      onConfirm={() => void revokeSession()}
      onOpenChange={(open) => { if (!open && !working) setSelectedSession(null); }}
      title="Sign out this session?"
    />
  </DesignSystemProvider>;
}
