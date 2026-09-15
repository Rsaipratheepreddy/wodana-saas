"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import {
  Button,
  Callout,
  Checkbox,
  ConfirmationDialog,
  ControlledModalDialog,
  DesignSystemProvider,
  formatDate,
  OtpInput,
  TextInput,
} from "@/design-system";
import type { MfaSecurityStatus, SecurityPageData, SecuritySession } from "@/lib/workspace/security";
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

type MfaDialog = "setup" | "regenerate" | "disable" | "codes";
type MfaSetup = { secret: string; otpauthUri: string };

async function mfaRequest(action: string, workspaceId: string, code?: string) {
  const response = await fetch(`/api/auth/mfa/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, ...(code ? { code } : {}) }),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(
    typeof payload?.message === "string" ? payload.message : "The security request could not be completed.",
  );
  return payload ?? {};
}

export function SecurityPage({ initialData }: { initialData: SecurityPageData }) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [sessions, setSessions] = useState(initialData.sessions);
  const [selectedSession, setSelectedSession] = useState<SecuritySession | null>(null);
  const [mfa, setMfa] = useState<MfaSecurityStatus>(initialData.mfa);
  const [mfaDialog, setMfaDialog] = useState<MfaDialog | null>(null);
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [mfaQrCode, setMfaQrCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    if (!mfaSetup?.otpauthUri) return;
    let mounted = true;
    import("qrcode")
      .then((module) => module.toDataURL(mfaSetup.otpauthUri, { width: 220, margin: 2, errorCorrectionLevel: "M" }))
      .then((value) => { if (mounted) setMfaQrCode(value); })
      .catch(() => { if (mounted) setFailure("The QR code could not be displayed. Use the setup key instead."); });
    return () => { mounted = false; };
  }, [mfaSetup]);

  const closeMfaDialog = () => {
    if (working) return;
    setMfaDialog(null);
    setMfaSetup(null);
    setMfaQrCode("");
    setMfaCode("");
    setRecoveryCodes([]);
    setRecoveryCodesSaved(false);
  };

  const startMfaSetup = async () => {
    setWorking(true);
    setFailure("");
    setStatus("Preparing authenticator setup…");
    try {
      const payload = await mfaRequest("setup", initialData.workspaceId);
      if (typeof payload.secret !== "string" || typeof payload.otpauthUri !== "string") {
        throw new Error("The authenticator setup response was incomplete. Try again.");
      }
      setMfaSetup({ secret: payload.secret, otpauthUri: payload.otpauthUri });
      setMfaQrCode("");
      setMfaCode("");
      setMfaDialog("setup");
      setStatus("");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Authenticator setup could not be started.");
      setStatus("");
    } finally {
      setWorking(false);
    }
  };

  const showRecoveryCodes = (codes: unknown) => {
    if (!Array.isArray(codes) || !codes.length || !codes.every((code) => typeof code === "string")) {
      throw new Error("Recovery codes were not returned. Contact support before closing this page.");
    }
    setRecoveryCodes(codes as string[]);
    setRecoveryCodesSaved(false);
    setMfaDialog("codes");
  };

  const confirmMfaSetup = async () => {
    if (!/^\d{6}$/.test(mfaCode)) {
      setFailure("Enter the six-digit code from your authenticator app.");
      return;
    }
    setWorking(true);
    setFailure("");
    try {
      const payload = await mfaRequest("confirm", initialData.workspaceId, mfaCode);
      showRecoveryCodes(payload.recoveryCodes);
      setMfa((current) => ({
        ...current,
        enabled: true,
        setupPending: false,
        confirmedAt: new Date().toISOString(),
        enrollmentDeadline: null,
        recoveryCodesRemaining: Array.isArray(payload.recoveryCodes) ? payload.recoveryCodes.length : 0,
      }));
      setMfaSetup(null);
      setMfaQrCode("");
      setMfaCode("");
      setStatus("Authenticator verification is now enabled.");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Authenticator setup could not be confirmed.");
    } finally {
      setWorking(false);
    }
  };

  const runSensitiveMfaAction = async (action: "recovery" | "disable") => {
    if (mfaCode.trim().length < 6) {
      setFailure("Enter an authenticator or recovery code.");
      return;
    }
    setWorking(true);
    setFailure("");
    try {
      await mfaRequest("step-up", initialData.workspaceId, mfaCode.trim());
      const payload = await mfaRequest(action, initialData.workspaceId);
      if (action === "recovery") {
        showRecoveryCodes(payload.recoveryCodes);
        setMfa((current) => ({
          ...current,
          recoveryCodesRemaining: Array.isArray(payload.recoveryCodes) ? payload.recoveryCodes.length : current.recoveryCodesRemaining,
        }));
        setStatus("New recovery codes were generated. Your previous codes no longer work.");
      } else {
        setMfa((current) => ({ ...current, enabled: false, confirmedAt: null, recoveryCodesRemaining: 0 }));
        setStatus("Authenticator verification was disabled. Other sessions were signed out.");
        setMfaDialog(null);
        setMfaSetup(null);
        setMfaQrCode("");
        setRecoveryCodes([]);
        setRecoveryCodesSaved(false);
      }
      setMfaCode("");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The security request could not be completed.");
    } finally {
      setWorking(false);
    }
  };

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

  const mfaDialogTitle = mfaDialog === "setup" ? "Connect an authenticator"
    : mfaDialog === "regenerate" ? "Generate new recovery codes"
      : mfaDialog === "disable" ? "Disable authenticator verification"
        : "Save your recovery codes";

  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-label="Account security" className={styles.page}>
      {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
      {failure && !mfaDialog ? <Callout title="Security action failed" tone="danger">{failure}</Callout> : null}
      <section aria-labelledby="mfa-heading" className={styles.mfaCard}>
        <div className={styles.mfaIcon}><ShieldCheck aria-hidden="true" size={20} /></div>
        <div className={styles.mfaSummary}>
          <div className={styles.mfaTitleRow}>
            <h2 id="mfa-heading">Authenticator verification</h2>
            <span className={mfa.enabled ? styles.enabled : styles.disabled}>{mfa.enabled ? "Enabled" : "Not enabled"}</span>
          </div>
          <p>{mfa.enabled
            ? "A password and a verification code are required when you sign in."
            : "Add a verification code to protect your account if your password is compromised."}</p>
          {mfa.enabled ? <div className={styles.mfaFacts}>
            <span><strong>{mfa.recoveryCodesRemaining}</strong> recovery codes remaining</span>
            {mfa.confirmedAt ? <span>Enabled {formatDate(mfa.confirmedAt, DUBAI_FORMAT, { dateStyle: "medium" })}</span> : null}
            {mfa.required ? <span>Required by account policy</span> : null}
          </div> : mfa.required && mfa.enrollmentDeadline ? <p className={styles.deadline}>
            Setup required by {formatDate(mfa.enrollmentDeadline, DUBAI_FORMAT, { dateStyle: "medium" })}.
          </p> : null}
        </div>
        <div className={styles.mfaActions}>
          {mfa.enabled ? <>
            <Button isDisabled={working} onPress={() => { setFailure(""); setMfaCode(""); setMfaDialog("regenerate"); }} size="compact" variant="quiet"><KeyRound size={14} />New recovery codes</Button>
            {!mfa.required ? <Button isDisabled={working} onPress={() => { setFailure(""); setMfaCode(""); setMfaDialog("disable"); }} size="compact" variant="quiet">Disable</Button> : null}
          </> : <Button isDisabled={working} isLoading={working} onPress={() => void startMfaSetup()} size="compact" variant="primary">Set up authenticator</Button>}
        </div>
      </section>

      <header className={styles.sessionsHeader}><h2>Active sessions</h2><p>Browsers and devices currently signed in to your account.</p></header>
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

    <ControlledModalDialog
      description={mfaDialog === "setup" ? "Scan the QR code, then enter the current six-digit code."
        : mfaDialog === "codes" ? "Each code works once if your authenticator is unavailable."
          : mfaDialog === "disable" ? "Confirm with a current code. Other signed-in devices will be logged out."
            : "Confirm with a current code. All previous recovery codes will stop working."}
      footer={mfaDialog === "codes" ? <>
        <Button isDisabled={working} onPress={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n")).then(() => setStatus("Recovery codes copied.")).catch(() => setFailure("Select and copy the codes manually."))} variant="quiet"><Copy size={14} />Copy all</Button>
        <Button isDisabled={!recoveryCodesSaved} onPress={closeMfaDialog} variant="primary">Done</Button>
      </> : <>
        <Button isDisabled={working} onPress={closeMfaDialog}>Cancel</Button>
        <Button isDisabled={working} isLoading={working} onPress={() => void (mfaDialog === "setup" ? confirmMfaSetup() : runSensitiveMfaAction(mfaDialog === "disable" ? "disable" : "recovery"))} variant={mfaDialog === "disable" ? "danger" : "primary"}>
          {mfaDialog === "setup" ? "Confirm authenticator" : mfaDialog === "disable" ? "Disable verification" : "Generate new codes"}
        </Button>
      </>}
      isDismissable={!working && (mfaDialog !== "codes" || recoveryCodesSaved)}
      isOpen={Boolean(mfaDialog)}
      onOpenChange={(open) => { if (!open && (mfaDialog !== "codes" || recoveryCodesSaved)) closeMfaDialog(); }}
      title={mfaDialogTitle}
    >
      <div className={styles.mfaDialogBody}>
        {failure ? <Callout title="Could not continue" tone="danger">{failure}</Callout> : null}
        {mfaDialog === "setup" && mfaSetup ? <>
          <div className={styles.qrPanel}>{mfaQrCode ? <Image alt="Authenticator setup QR code" height={200} src={mfaQrCode} unoptimized width={200} /> : <span role="status">Preparing QR code…</span>}</div>
          <div className={styles.manualKey}><span>Manual setup key</span><code>{mfaSetup.secret}</code><Button onPress={() => void navigator.clipboard?.writeText(mfaSetup.secret).then(() => setStatus("Setup key copied.")).catch(() => setFailure("Select and copy the key manually."))} size="compact" variant="quiet"><Copy size={13} />Copy</Button></div>
        </> : null}
        {mfaDialog === "setup" ? <label className={styles.otpField}>
          <span>Six-digit authenticator code</span>
          <OtpInput onChange={(value) => { setMfaCode(value); setFailure(""); }} value={mfaCode} />
        </label> : null}
        {mfaDialog === "regenerate" || mfaDialog === "disable" ? <TextInput
          autoComplete="one-time-code"
          isRequired
          label="Authenticator or recovery code"
          onChange={(value) => { setMfaCode(value); setFailure(""); }}
          placeholder="Six digits or a recovery code"
          value={mfaCode}
        /> : null}
        {mfaDialog === "codes" ? <>
          <ol aria-label="Recovery codes" className={styles.recoveryCodes}>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
          <Checkbox isSelected={recoveryCodesSaved} onChange={setRecoveryCodesSaved}>I saved these recovery codes</Checkbox>
        </> : null}
      </div>
    </ControlledModalDialog>

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
