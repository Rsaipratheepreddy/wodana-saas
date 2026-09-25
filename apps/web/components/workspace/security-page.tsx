"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  ConfirmationDialog,
  ControlledModalDialog,
  DataGrid,
  DesignSystemProvider,
  formatDate,
  OtpInput,
  TextInput,
  type DataGridColumn,
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
  const t = useT();
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

  const copySecurityText = async (text: string, success: string, fallback: string) => {
    setFailure("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setStatus(success);
    } catch {
      setFailure(fallback);
    }
  };

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
      setStatus("Two-step verification is now on.");
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
        setSessions((current) => current.filter((session) => session.current));
        setStatus("Two-step verification was turned off. Other sessions were signed out.");
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

  const mfaDialogTitle = mfaDialog === "setup" ? "Set up two-step verification"
    : mfaDialog === "regenerate" ? "Get new recovery codes"
      : mfaDialog === "disable" ? "Turn off two-step verification"
        : "Save your recovery codes";
  const sessionColumns: DataGridColumn<SecuritySession>[] = [
    { id: "device", accessorFn: sessionLabel, header: "Device", size: 240, meta: { primary: true }, cell: ({ row }) => { const details = deviceDetails(row.original.userAgent); return <span className={styles.device}><strong>{details.browser}</strong><small>{details.device}</small></span>; } },
    { accessorKey: "ipAddress", header: "IP address", size: 145, cell: ({ row }) => row.original.ipAddress ?? "—" },
    { id: "lastActive", accessorFn: (session) => session.lastActiveAt, header: "Last active", size: 185, cell: ({ row }) => <time dateTime={row.original.lastActiveAt}>{formatDate(row.original.lastActiveAt, DUBAI_FORMAT, { dateStyle: "medium", timeStyle: "short" })}</time> },
    { id: "action", header: "Status / action", size: 145, enableSorting: false, cell: ({ row }) => row.original.current ? <Badge tone="success">{t("This device")}</Badge> : <Button aria-label={`Sign out ${sessionLabel(row.original)}`} isDisabled={working} onPress={() => setSelectedSession(row.original)} size="compact" variant="quiet">{t("Sign out")}</Button> },
  ];

  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-label={t("Account security")} className={styles.page}>
      {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
      {failure && !mfaDialog ? <Callout title={t("Security action failed")} tone="danger">{failure}</Callout> : null}
      <section aria-labelledby="mfa-heading" className={styles.mfaCard}>
        <div className={styles.mfaIcon}><ShieldCheck aria-hidden="true" size={20} /></div>
        <div className={styles.mfaSummary}>
          <div className={styles.mfaTitleRow}>
            <h2 id="mfa-heading">{t("Two-step verification")}</h2>
            <Badge tone={mfa.enabled ? "success" : "warning"}>{mfa.enabled ? "On" : "Off"}</Badge>
          </div>
          <p>{mfa.enabled
            ? "Your password and an authenticator-app code are required when you sign in."
            : "Add an authenticator-app code after your password for stronger sign-in protection."}</p>
          {mfa.enabled ? <div className={styles.mfaFacts}>
            <span><strong>{mfa.recoveryCodesRemaining}</strong> {t("recovery codes remaining")}</span>
            {mfa.confirmedAt ? <span>{t("Turned on")}{" "}{formatDate(mfa.confirmedAt, DUBAI_FORMAT, { dateStyle: "medium" })}</span> : null}
            {mfa.required ? <span>{t("Required by account policy")}</span> : null}
          </div> : mfa.required && mfa.enrollmentDeadline ? <p className={styles.deadline}>
            {t("Turn this on by")}{" "}{formatDate(mfa.enrollmentDeadline, DUBAI_FORMAT, { dateStyle: "medium" })}.
          </p> : null}
        </div>
        <div className={styles.mfaActions}>
          {mfa.enabled ? <>
            <Button isDisabled={working} onPress={() => { setFailure(""); setMfaCode(""); setMfaDialog("regenerate"); }} size="compact" variant="quiet"><KeyRound size={14} />{t("Recovery codes")}</Button>
            {!mfa.required ? <Button isDisabled={working} onPress={() => { setFailure(""); setMfaCode(""); setMfaDialog("disable"); }} size="compact" variant="quiet">{t("Turn off")}</Button> : null}
          </> : <Button isDisabled={working} isLoading={working} onPress={() => void startMfaSetup()} size="compact" variant="primary">{t("Set up two-step verification")}</Button>}
        </div>
      </section>

      <header className={styles.sessionsHeader}><h2>{t("Active sessions")}</h2><p>{t("Browsers and devices currently signed in to your account.")}</p></header>
      <DataGrid ariaLabel="Active sessions" gridLines columns={sessionColumns} data={sessions} getRowId={(session) => session.familyId} selectable={false} rowNumbers={false} showToolbar={false} pageSize={25} emptyTitle="No active sessions" emptyDescription="Signed-in browsers and devices will appear here." />
    </section>

    <ControlledModalDialog
      description={mfaDialog === "setup" ? "Scan the QR code with your authenticator app, then enter its current six-digit code."
        : mfaDialog === "codes" ? "Each code works once if your authenticator is unavailable."
          : mfaDialog === "disable" ? "Confirm with a current code. Other signed-in devices will be signed out."
            : "Confirm with a current code. All previous recovery codes will stop working."}
      footer={mfaDialog === "codes" ? <>
        <Button isDisabled={working} onPress={() => void copySecurityText(recoveryCodes.join("\n"), "Recovery codes copied.", "Select and copy the codes manually.")} variant="quiet"><Copy size={14} />{t("Copy all")}</Button>
        <Button isDisabled={!recoveryCodesSaved} onPress={closeMfaDialog} variant="primary">{t("Done")}</Button>
      </> : <>
        <Button isDisabled={working} onPress={closeMfaDialog}>{t("Cancel")}</Button>
        <Button isDisabled={working} isLoading={working} onPress={() => void (mfaDialog === "setup" ? confirmMfaSetup() : runSensitiveMfaAction(mfaDialog === "disable" ? "disable" : "recovery"))} variant={mfaDialog === "disable" ? "danger" : "primary"}>
          {mfaDialog === "setup" ? "Turn on verification" : mfaDialog === "disable" ? "Turn off verification" : "Generate codes"}
        </Button>
      </>}
      isDismissable={!working && (mfaDialog !== "codes" || recoveryCodesSaved)}
      isOpen={Boolean(mfaDialog)}
      onOpenChange={(open) => { if (!open && (mfaDialog !== "codes" || recoveryCodesSaved)) closeMfaDialog(); }}
      title={mfaDialogTitle}
    >
      <div className={styles.mfaDialogBody}>
        {failure ? <Callout title={t("Could not continue")} tone="danger">{failure}</Callout> : null}
        {mfaDialog === "setup" && mfaSetup ? <>
          <div className={styles.qrPanel}>{mfaQrCode ? <Image alt="Authenticator setup QR code" height={200} src={mfaQrCode} unoptimized width={200} /> : <span role="status">{t("Preparing QR code…")}</span>}</div>
          <div className={styles.manualKey}><span>{t("Manual setup key")}</span><code>{mfaSetup.secret}</code><Button onPress={() => void copySecurityText(mfaSetup.secret, "Setup key copied.", "Select and copy the key manually.")} size="compact" variant="quiet"><Copy size={13} />{t("Copy")}</Button></div>
        </> : null}
        {mfaDialog === "setup" ? <label className={styles.otpField}>
          <span>{t("Six-digit authenticator code")}</span>
          <OtpInput onChange={(value) => { setMfaCode(value); setFailure(""); }} value={mfaCode} />
        </label> : null}
        {mfaDialog === "regenerate" || mfaDialog === "disable" ? <TextInput
          autoComplete="one-time-code"
          isRequired
          label={t("Authenticator or recovery code")}
          onChange={(value) => { setMfaCode(value); setFailure(""); }}
          placeholder={t("Six digits or a recovery code")}
          value={mfaCode}
        /> : null}
        {mfaDialog === "codes" ? <>
          <ol aria-label={t("Recovery codes")} className={styles.recoveryCodes}>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
          <Checkbox isSelected={recoveryCodesSaved} onChange={setRecoveryCodesSaved}>{t("I saved these recovery codes")}</Checkbox>
        </> : null}
      </div>
    </ControlledModalDialog>

    <ConfirmationDialog
      body={selectedSession ? <>{t("Sign out")}{" "}<strong>{sessionLabel(selectedSession)}</strong>{t("? That browser will need to sign in again.")}</> : null}
      confirmLabel={working ? "Signing out…" : "Sign out session"}
      isOpen={Boolean(selectedSession)}
      onConfirm={() => void revokeSession()}
      onOpenChange={(open) => { if (!open && !working) setSelectedSession(null); }}
      title={t("Sign out this session?")}
    />
  </DesignSystemProvider>;
}
