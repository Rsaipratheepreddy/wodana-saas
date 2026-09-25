"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Eye, EyeOff, Monitor, ShieldCheck } from "lucide-react";
import { WodanaLogo } from "@/components/brand";
import {
  Button,
  Checkbox,
  ControlledModalDialog,
  DesignSystemProvider,
  InlineNotice,
  InputAction,
  OtpInput,
  TextInput,
} from "@/design-system";
import type { SecuritySession } from "@/lib/workspace/security";
import { authRequest, confirmBrowserSession, openAuthenticatedWorkspace } from "@/lib/auth/client";
import { deviceDetails } from "@/lib/auth/device-details";
import styles from "./login.module.css";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";

type TenantBranding = {
  displayName: string;
  loginSlug: string;
  logoUrl: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  headingFont?: string | null;
  bodyFont?: string | null;
};
type MfaStage = "credentials" | "challenge" | "enrollment" | "recovery";
type MfaSetup = { secret: string; otpauthUri: string; setupExpiresInSeconds: number };

export function LoginScreen({
  invitationToken,
  passwordResetToken,
  nextPath,
  initialStatus,
  initialStatusTone = "error",
  tenant,
}: {
  invitationToken?: string;
  passwordResetToken?: string;
  nextPath: string;
  initialStatus?: string;
  initialStatusTone?: "error" | "info";
  tenant: TenantBranding;
}) {
  const router = useRouter();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const settingPassword = Boolean(invitationToken || passwordResetToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [status, setStatusText] = useState(initialStatus ?? "");
  const [statusTone, setStatusTone] = useState<"error" | "info">(initialStatusTone);
  function setStatus(message: string, tone: "error" | "info" = "error") {
    setStatusText(message);
    setStatusTone(tone);
  }
  const [deviceFailure, setDeviceFailure] = useState("");
  const [limitedSessions, setLimitedSessions] = useState<SecuritySession[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [mfaStage, setMfaStage] = useState<MfaStage>("credentials");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRecoveryMode, setMfaRecoveryMode] = useState(false);
  const [mfaWorkspaceId, setMfaWorkspaceId] = useState("");
  const [mfaEnrollmentDeadline, setMfaEnrollmentDeadline] = useState<string | null>(null);
  const [canDeferMfaEnrollment, setCanDeferMfaEnrollment] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [mfaQrCode, setMfaQrCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);
  const [authenticatedDestination, setAuthenticatedDestination] = useState(nextPath);
  const requestInFlight = useRef(false);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (navigationTimer.current) clearTimeout(navigationTimer.current); }, []);
  useEffect(() => {
    if (!mfaSetup?.otpauthUri) return;
    let mounted = true;
    import("qrcode")
      .then((module) => module.toDataURL(mfaSetup.otpauthUri, { width: 240, margin: 2, errorCorrectionLevel: "M" }))
      .then((value) => { if (mounted) setMfaQrCode(value); })
      .catch(() => { if (mounted) setStatus("The QR code could not be displayed. Enter the setup key manually."); });
    return () => { mounted = false; };
  }, [mfaSetup]);

  const openWorkspace = (path: string) => {
    setIsOpening(true);
    setIsSubmitting(true);
    setLimitedSessions(null);
    setStatus("Signed in. Opening your workspace…", "info");
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    navigationTimer.current = setTimeout(() => {
      requestInFlight.current = false;
      setIsSubmitting(false);
      setStatus("You are signed in. Select Open workspace to continue.", "info");
    }, 12_000);
    openAuthenticatedWorkspace(path);
  };

  const finishAuthenticatedSignIn = async (payload: Record<string, unknown>, path: string) => {
    const destination = payload.nextAction === "start_onboarding" || payload.nextAction === "resume_onboarding"
      ? "/onboarding"
      : path;
    setAuthenticatedDestination(destination);
    if (payload.mfaEnrollmentRequired === true && typeof payload.selectedWorkspaceId === "string") {
      const enrollmentDeadline = typeof payload.mfaEnrollmentDeadline === "string"
        ? payload.mfaEnrollmentDeadline
        : null;
      setMfaWorkspaceId(payload.selectedWorkspaceId);
      setMfaEnrollmentDeadline(enrollmentDeadline);
      setCanDeferMfaEnrollment(Boolean(
        enrollmentDeadline && new Date(enrollmentDeadline).getTime() > Date.now(),
      ));
      setMfaStage("enrollment");
      setMfaCode("");
      setPassword("");
      setStatus("");
      return false;
    }
    setStatus("Confirming your browser session…", "info");
    await confirmBrowserSession();
    setPassword("");
    openWorkspace(destination);
    return true;
  };

  const resetMfaFlow = () => {
    setMfaStage("credentials");
    setMfaCode("");
    setMfaRecoveryMode(false);
    setMfaWorkspaceId("");
    setMfaEnrollmentDeadline(null);
    setCanDeferMfaEnrollment(false);
    setMfaSetup(null);
    setMfaQrCode("");
    setRecoveryCodes([]);
    setRecoveryCodesSaved(false);
    setStatus("");
  };

  const backFromMfa = async () => {
    if (isSubmitting) return;
    if (mfaSetup) {
      setMfaSetup(null);
      setMfaQrCode("");
      setMfaCode("");
      setStatus("");
      return;
    }
    setIsSubmitting(true);
    try {
      const { ok, payload } = await authRequest("/api/auth/logout", { method: "POST" });
      if (!ok) {
        setStatus(typeof payload.message === "string" ? payload.message : "Could not return to sign in. Please try again.");
        return;
      }
      resetMfaFlow();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not return to sign in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyMfaChallenge = async () => {
    if (mfaCode.trim().length < 6) {
      setStatus(mfaRecoveryMode ? "Enter one of your recovery codes." : "Enter the six-digit code from your authenticator app.");
      return;
    }
    requestInFlight.current = true;
    setIsSubmitting(true);
    setStatus("Verifying your code…", "info");
    let navigating = false;
    try {
      const { ok, payload } = await authRequest("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: mfaCode }),
      });
      if (!ok) {
        if (payload.code === "DEVICE_LIMIT_REACHED" && Array.isArray(payload.sessions) && payload.sessions.length) {
          setMfaStage("credentials");
          setMfaCode("");
          setLimitedSessions(payload.sessions as SecuritySession[]);
        }
        setStatus(typeof payload.message === "string" ? payload.message : "The verification code could not be accepted.");
        return;
      }
      if (payload.authenticated !== true) throw new Error("Sign-in could not be completed. Please try again.");
      navigating = await finishAuthenticatedSignIn(payload, nextPath);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The verification code could not be accepted.");
    } finally {
      if (!navigating) {
        requestInFlight.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const startMfaEnrollment = async () => {
    if (!mfaWorkspaceId) {
      setStatus("Your workspace could not be identified. Sign in again.");
      return;
    }
    requestInFlight.current = true;
    setIsSubmitting(true);
    setStatus("Creating your authenticator setup…", "info");
    try {
      const { ok, payload } = await authRequest("/api/auth/mfa/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: mfaWorkspaceId }),
      });
      if (!ok || typeof payload.secret !== "string" || typeof payload.otpauthUri !== "string") {
        setStatus(typeof payload.message === "string" ? payload.message : "Authenticator setup could not be started.");
        return;
      }
      setMfaSetup({
        secret: payload.secret,
        otpauthUri: payload.otpauthUri,
        setupExpiresInSeconds: Number(payload.setupExpiresInSeconds),
      });
      setMfaQrCode("");
      setMfaCode("");
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authenticator setup could not be started.");
    } finally {
      requestInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const confirmMfaEnrollment = async () => {
    if (!/^\d{6}$/.test(mfaCode)) {
      setStatus("Enter the six-digit code from your authenticator app.");
      return;
    }
    requestInFlight.current = true;
    setIsSubmitting(true);
    setStatus("Confirming your authenticator…", "info");
    try {
      const { ok, payload } = await authRequest("/api/auth/mfa/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: mfaWorkspaceId, code: mfaCode }),
      });
      if (!ok || !Array.isArray(payload.recoveryCodes)
        || !payload.recoveryCodes.every((code) => typeof code === "string")) {
        setStatus(typeof payload.message === "string" ? payload.message : "Authenticator setup could not be confirmed.");
        return;
      }
      setRecoveryCodes(payload.recoveryCodes as string[]);
      setRecoveryCodesSaved(false);
      setMfaStage("recovery");
      setMfaQrCode("");
      setMfaCode("");
      setStatus("Your authenticator is active. Save these recovery codes now.", "info");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authenticator setup could not be confirmed.");
    } finally {
      requestInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const skipMfaEnrollment = async () => {
    if (!mfaEnrollmentDeadline || new Date(mfaEnrollmentDeadline).getTime() <= Date.now()) return;
    requestInFlight.current = true;
    setIsSubmitting(true);
    try {
      setStatus("Confirming your browser session…", "info");
      await confirmBrowserSession();
      openWorkspace(authenticatedDestination);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Your session could not be confirmed.");
      requestInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const continueAfterRecovery = async () => {
    if (!recoveryCodesSaved) {
      setStatus("Confirm that you saved the recovery codes before continuing.");
      return;
    }
    requestInFlight.current = true;
    setIsSubmitting(true);
    try {
      setStatus("Confirming your secure session…", "info");
      await confirmBrowserSession();
      openWorkspace(authenticatedDestination);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Your session could not be confirmed.");
      requestInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isOpening) { openWorkspace(nextPath); return; }
    if (requestInFlight.current) return;
    if (mfaStage === "challenge") { await verifyMfaChallenge(); return; }
    if (mfaStage === "enrollment") {
      if (mfaSetup) await confirmMfaEnrollment();
      else await startMfaEnrollment();
      return;
    }
    if (mfaStage === "recovery") { await continueAfterRecovery(); return; }
    if (settingPassword) {
      const nextPasswordError = password.length >= 10
        && /[a-z]/.test(password)
        && /[A-Z]/.test(password)
        && /[0-9]/.test(password)
        && /[^A-Za-z0-9]/.test(password)
        ? ""
        : "Use 10+ characters with uppercase, lowercase, a number, and a symbol.";
      const nextConfirmError = password === confirmPassword ? "" : "Passwords do not match.";
      setPasswordError(nextPasswordError);
      setConfirmPasswordError(nextConfirmError);
      if (nextPasswordError || nextConfirmError) {
        setStatus("");
        (event.currentTarget.elements.namedItem(nextPasswordError ? "password" : "confirm-password") as HTMLInputElement | null)?.focus();
        return;
      }
      requestInFlight.current = true;
      let navigating = false;
      setIsSubmitting(true);
      setStatus(passwordResetToken ? "Saving your new password…" : "Activating your account…", "info");
      try {
        const { ok, payload } = await authRequest(passwordResetToken ? "/api/auth/reset-password" : "/api/auth/invitations/activate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(passwordResetToken ? { resetToken: passwordResetToken, password } : { invitationToken, password, tenantSlug: tenant.loginSlug }),
        });
        if (!ok) {
          setStatus(typeof payload.message === "string" ? payload.message : (passwordResetToken ? "Unable to reset this password." : "Unable to activate this invitation."));
          return;
        }
        if (passwordResetToken) {
          setPassword("");
          setConfirmPassword("");
          setStatus("Password updated. Sign in with your new password.", "info");
          router.replace(`/login?tenant=${encodeURIComponent(tenant.loginSlug)}&reason=password-reset`);
        } else {
          if (payload.authenticated !== true) throw new Error("Sign-in could not be completed. Please try again.");
          navigating = await finishAuthenticatedSignIn(payload, "/workspace");
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to sign in. Please try again.");
      } finally {
        if (!navigating) { requestInFlight.current = false; setIsSubmitting(false); }
      }
      return;
    }
    const nextEmailError = /^\S+@\S+\.\S+$/.test(email)
      ? ""
      : email.trim() ? "This doesn’t look like a valid email address." : "Enter your email address.";
    const nextPasswordError = password.length >= 8
      ? ""
      : password ? "Use at least 8 characters." : "Enter your password.";

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) {
      setStatus("");
      (event.currentTarget.elements.namedItem(nextEmailError ? "email" : "password") as HTMLInputElement | null)?.focus();
      return;
    }

    await signIn();
  };

  const signIn = async (revokeFamilyId?: string) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    let navigating = false;
    setDeviceFailure("");
    setIsSubmitting(true);
    setStatus(revokeFamilyId ? "Logging out the selected device…" : "Signing you in…", "info");
    try {
      const { ok, status: responseStatus, payload } = await authRequest("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, tenantSlug: tenant.loginSlug, revokeFamilyId }),
      });
      if (!ok) {
        const message = typeof payload.message === "string" ? payload.message : "Unable to sign in. Check your details and try again.";
        if (payload.code === "DEVICE_LIMIT_REACHED" && Array.isArray(payload.sessions) && payload.sessions.length) {
          setLimitedSessions(payload.sessions as SecuritySession[]);
        } else if (limitedSessions && responseStatus !== 401) {
          setDeviceFailure(message);
          return;
        } else setLimitedSessions(null);
        setStatus(message);
        return;
      }
      if (payload.mfaRequired === true) {
        setMfaStage("challenge");
        setMfaCode("");
        setMfaRecoveryMode(false);
        setLimitedSessions(null);
        setStatus("Enter the code from your authenticator app.", "info");
        return;
      }
      if (payload.authenticated !== true) throw new Error("Sign-in could not be completed. Please try again.");
      // A reclaimed device slot can continue into onboarding or MFA enrollment
      // without navigating away. Clear the old limit dialog before that state
      // transition so it cannot retry with the password we intentionally erase.
      setLimitedSessions(null);
      setDeviceFailure("");
      navigating = await finishAuthenticatedSignIn(payload, nextPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign in. Please try again.";
      if (limitedSessions) setDeviceFailure(message);
      else setStatus(message);
    } finally {
      if (!navigating) { requestInFlight.current = false; setIsSubmitting(false); }
    }
  };

  const startRecovery = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setEmailError("Enter your work email to reset the password.");
      return;
    }
    setStatus("Sending password recovery instructions…", "info");
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, tenantSlug: tenant.loginSlug }),
    }).catch(() => null);
    setStatus(response?.ok
      ? "If this account exists, password recovery instructions are ready."
      : "Password recovery is unavailable. Please try again.", response?.ok ? "info" : "error");
  };

  const canSkipEnrollment = canDeferMfaEnrollment;
  const heading = mfaStage === "challenge"
    ? "Verify it’s you"
    : mfaStage === "enrollment"
      ? mfaSetup ? "Connect your authenticator" : "Protect your account"
      : mfaStage === "recovery"
        ? "Save your recovery codes"
        : passwordResetToken
          ? "Reset your password"
          : invitationToken
            ? "Create your password"
            : "Welcome back";
  const intro = mfaStage === "challenge"
    ? "Use your authenticator app or one of your saved recovery codes."
    : mfaStage === "enrollment"
      ? mfaSetup
        ? "Scan this code with your authenticator app, then confirm the six-digit code."
        : "Use an authenticator app for an extra sign-in check."
      : mfaStage === "recovery"
        ? "Each code works once if you lose access to your authenticator app."
        : passwordResetToken
          ? "Choose a new password to secure your account."
          : invitationToken
            ? `Activate your invitation to ${tenant.displayName}.`
            : `Sign in to continue to your ${tenant.displayName} workspace.`;
  const submitLabel = isOpening
    ? "Open workspace"
    : isSubmitting
      ? mfaStage === "challenge"
        ? "Verifying"
        : mfaStage === "enrollment"
          ? mfaSetup ? "Confirming" : "Preparing"
          : mfaStage === "recovery"
            ? "Opening workspace"
            : passwordResetToken ? "Saving password" : invitationToken ? "Activating" : "Signing in"
      : mfaStage === "challenge"
        ? "Verify and sign in"
        : mfaStage === "enrollment"
          ? mfaSetup ? "Confirm authenticator" : "Set up authenticator"
          : mfaStage === "recovery"
            ? "Continue to workspace"
            : passwordResetToken ? "Save new password" : invitationToken ? "Activate invitation" : "Sign in";

  return (
    <DesignSystemProvider className={styles.loginRoot} data-tenant-slug={tenant.loginSlug} locale="en-AE" portalContainer={portalContainer} ref={setPortalContainer} style={workspacePrimaryColorStyle(tenant)}>
      <main className={styles.loginLayout}>
        <div aria-hidden="true" className={styles.brandPanel} />

        <section aria-labelledby="login-heading" className={styles.loginPanel}>
          <div className={styles.loginCard}>
            <header className={styles.tenantBrand} aria-label={`${tenant.displayName} workspace`}>
              {tenant.logoUrl ? (
                <span className={styles.tenantLogo}>
                  <Image alt={tenant.displayName} fill preload sizes="88px" src={tenant.logoUrl} />
                </span>
              ) : null}
              <div className={styles.brandIdentity}><strong className={styles.tenantName}>{tenant.displayName}</strong><span>Internal workspace</span></div>
            </header>
            <div className={styles.formArea} data-security={mfaStage !== "credentials"}>
            <div className={styles.formIntro}>
              {mfaStage === "enrollment" || mfaStage === "challenge" ? <Button className={styles.backButton} isDisabled={isSubmitting} onPress={() => void backFromMfa()} size="compact" type="button" variant="secondary"><ArrowLeft aria-hidden="true" size={14} />{mfaSetup ? "Back" : "Back to sign in"}</Button> : null}
              <h1 id="login-heading">{heading}</h1>
              <p>{intro}</p>
            </div>

            <form className={styles.loginForm} noValidate onSubmit={submit}>
              {mfaStage === "credentials" ? <>
                {!settingPassword ? <TextInput
                  autoComplete="username"
                  errorMessage={emailError}
                  inputType="email"
                  isInvalid={Boolean(emailError)}
                  isRequired
                  label="Email"
                  name="email"
                  onChange={(value) => {
                    setEmail(value);
                    setLimitedSessions(null);
                    if (emailError) setEmailError("");
                  }}
                  placeholder="Email"
                  value={email}
                /> : null}

                <div className={styles.passwordField}>
                <TextInput
                  autoComplete={settingPassword ? "new-password" : "current-password"}
                  errorMessage={passwordError}
                  inputType={showPassword ? "text" : "password"}
                  isInvalid={Boolean(passwordError)}
                  isRequired
                  label={settingPassword ? "New password" : "Password"}
                  name="password"
                  onChange={(value) => {
                    setPassword(value);
                    setLimitedSessions(null);
                    if (passwordError) setPasswordError("");
                  }}
                  placeholder={settingPassword ? "Create a password" : "Password"}
                  suffix={
                    <InputAction
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className={styles.passwordToggle}
                      onPress={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
                    </InputAction>
                  }
                  value={password}
                />

                </div>

                {!settingPassword ? <div className={styles.formOptions}>
                  <button
                    className={styles.textButton}
                    disabled={isSubmitting} onClick={startRecovery}
                    type="button"
                  >
                    Forgot password?
                  </button>
                </div> : <p className={styles.passwordHint}>Use 10 or more characters with uppercase, lowercase, a number and a symbol.</p>}

                {settingPassword ? <TextInput
                  errorMessage={confirmPasswordError}
                  inputType={showPassword ? "text" : "password"}
                  isInvalid={Boolean(confirmPasswordError)}
                  isRequired
                  label="Confirm password"
                  name="confirm-password"
                  onChange={(value) => {
                    setConfirmPassword(value);
                    if (confirmPasswordError) setConfirmPasswordError("");
                  }}
                  placeholder="Enter the password again"
                  value={confirmPassword}
                /> : null}


              </> : null}

              {mfaStage === "challenge" ? <div className={styles.mfaForm}>
                <span className={styles.securityMark}><ShieldCheck aria-hidden="true" size={20} /></span>
                {mfaRecoveryMode ? <TextInput
                  autoComplete="one-time-code"
                  isRequired
                  label="Recovery code"
                  onChange={(value) => { setMfaCode(value.toUpperCase()); setStatus(""); }}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  value={mfaCode}
                /> : <div className={styles.otpField}>
                  <span>Authenticator code <i aria-hidden="true">*</i></span>
                  <OtpInput onChange={(value) => { setMfaCode(value); setStatus(""); }} value={mfaCode} />
                </div>}
                <div className={styles.mfaLinks}>
                  <button className={styles.textButton} disabled={isSubmitting} onClick={() => { setMfaRecoveryMode((value) => !value); setMfaCode(""); setStatus(""); }} type="button">
                    {mfaRecoveryMode ? "Use authenticator code" : "Use a recovery code"}
                  </button>
                </div>
              </div> : null}

              {mfaStage === "enrollment" ? <div className={styles.mfaForm}>
                {!mfaSetup ? <>
                  {mfaEnrollmentDeadline ? <p className={styles.deadlineNotice}>
                    {canSkipEnrollment
                      ? `Set up by ${new Date(mfaEnrollmentDeadline).toLocaleDateString()}.`
                      : "Required before entering the workspace."}
                  </p> : null}
                </> : <>
                  <div className={styles.qrPanel}>
                    {mfaQrCode ? <Image alt="Authenticator setup QR code" height={200} src={mfaQrCode} unoptimized width={200} /> : <span role="status">Preparing QR code…</span>}
                  </div>
                  <div aria-label="Authenticator setup key" className={styles.manualKey}>
                    <span>Setup key</span>
                    <code title={mfaSetup.secret}>{mfaSetup.secret}</code>
                    <button aria-label="Copy setup key" className={styles.copySetupKey} onClick={() => {
                      if (!navigator.clipboard?.writeText) {
                        setStatus("Select and copy the setup key manually.");
                        return;
                      }
                      void navigator.clipboard.writeText(mfaSetup.secret)
                        .then(() => setStatus("Setup key copied.", "info"))
                        .catch(() => setStatus("Select and copy the setup key manually."));
                    }} title="Copy setup key" type="button"><Copy aria-hidden="true" size={14} /></button>
                  </div>
                  <div className={styles.otpField}>
                    <span>Six-digit code <i aria-hidden="true">*</i></span>
                    <OtpInput onChange={(value) => { setMfaCode(value); setStatus(""); }} value={mfaCode} />
                  </div>
                </>}

              </div> : null}

              {mfaStage === "recovery" ? <div className={styles.mfaForm}>
                <div className={styles.recoveryHeader}><ShieldCheck aria-hidden="true" size={18} /><span>Store these somewhere safe. They will not be shown again.</span></div>
                <ol aria-label="Recovery codes" className={styles.recoveryCodes}>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
                <Button className={styles.copyCodes} onPress={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n")).then(() => setStatus("Recovery codes copied.", "info")).catch(() => setStatus("Select and copy the recovery codes manually."))} size="compact" variant="quiet"><Copy size={14} />Copy all codes</Button>
                <Checkbox isSelected={recoveryCodesSaved} onChange={setRecoveryCodesSaved}>I saved these recovery codes</Checkbox>
              </div> : null}

              <Button className={styles.submitButton} isLoading={isSubmitting} size="large" type="submit" variant="primary">
                {submitLabel}

              </Button>
              {mfaStage === "enrollment" && !mfaSetup && canSkipEnrollment ? <Button className={styles.skipSetup} isDisabled={isSubmitting} onPress={() => void skipMfaEnrollment()} size="compact" type="button" variant="secondary">Set up later</Button> : null}
            </form>

            {status && !limitedSessions ? <InlineNotice className={styles.statusMessage} message={status} title={statusTone === "error" ? "Sign-in needs attention" : undefined} tone={statusTone} /> : null}

            {isOpening ? <a className={styles.continueLink} href={authenticatedDestination}>{authenticatedDestination === "/onboarding" ? "Continue setup" : "Open workspace"}</a> : null}

            {mfaStage === "credentials" ? <p className={styles.supportCopy}>
              {settingPassword ? (
                <button onClick={() => router.replace(`/login?tenant=${encodeURIComponent(tenant.loginSlug)}`)} type="button">Back to sign in</button>
              ) : (
                <>Need access? Ask your administrator for an invitation.</>
              )}
            </p> : null}
            </div>
            <footer aria-label="Powered by Wodana" className={styles.poweredBy}>
              <span>Powered by</span>
              <WodanaLogo size="small" className={styles.poweredLogo} />
            </footer>
          </div>
        </section>
      </main>
      <ControlledModalDialog
        title="Device limit reached"
        description="Log out a device to continue signing in."
        isOpen={Boolean(limitedSessions)}
        isDismissable={!isSubmitting}
        onOpenChange={(open) => { if (!open && !isSubmitting) { setLimitedSessions(null); setStatus(""); } }}
        footer={<Button className={styles.deviceCancelButton} isDisabled={isSubmitting} onPress={() => { setLimitedSessions(null); setStatus(""); }}>Back to sign in</Button>}
      >
        <section className={styles.deviceLimit} aria-label="Logged-in devices">
          <p aria-live="polite">{limitedSessions?.length ?? 0} of 2 devices in use. Choose a session to log out.</p>
          {deviceFailure ? <p role="alert" className={styles.deviceFailure}>{deviceFailure}</p> : null}
          <ul>{limitedSessions?.map((session) => {
            const device = deviceDetails(session.userAgent);
            return <li key={session.familyId}>
              <span className={styles.deviceIcon}><Monitor aria-hidden="true" size={21} strokeWidth={1.5} /></span>
              <div><strong>{device.browser === "Unknown browser" && device.device === "Unknown device" ? "Unrecognized device" : `${device.browser} on ${device.device}`}</strong>
                <small>{session.ipAddress ?? "IP not recorded"}</small>
                <small>Last active {new Date(session.lastActiveAt).toLocaleString()}</small>
              </div>
              <Button isDisabled={isSubmitting} onPress={() => void signIn(session.familyId)} className={styles.deviceLogoutButton}>Log out device</Button>
            </li>;
          })}</ul>
          <p>The selected device will be signed out immediately. You’ll continue signing in here.</p>
          {isSubmitting ? <p role="status">Logging out device…</p> : null}
        </section>
      </ControlledModalDialog>
    </DesignSystemProvider>
  );
}
