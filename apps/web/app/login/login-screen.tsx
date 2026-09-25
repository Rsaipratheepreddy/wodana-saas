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
import { languageDirection, type AppLanguage } from "@/lib/i18n/languages";
import { translator } from "@/lib/i18n/messages";
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
type WorkspaceChoice = { name: string; loginSlug: string; logoUrl: string | null };
const MOBILE_NUMBER = /^\+?[\d\s()-]{8,20}$/;

export function LoginScreen({
  invitationToken,
  passwordResetToken,
  nextPath,
  initialStatus,
  initialStatusTone = "error",
  tenant,
  language = "en",
}: {
  invitationToken?: string;
  passwordResetToken?: string;
  nextPath: string;
  initialStatus?: string;
  initialStatusTone?: "error" | "info";
  tenant: TenantBranding;
  language?: AppLanguage;
}) {
  const t = translator(language);
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
  // Email first: identify, then the flow for that person (staff password; mobile → WhatsApp code).
  const [credentialStep, setCredentialStep] = useState<"identify" | "password">("identify");
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
  const [workspaceChoices, setWorkspaceChoices] = useState<WorkspaceChoice[] | null>(null);
  // Email-first sign-in keeps the chosen workspace for retries such as the device-limit prompt.
  const chosenWorkspaceSlug = useRef<string | null>(null);
  const requestInFlight = useRef(false);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (navigationTimer.current) clearTimeout(navigationTimer.current); }, []);
  useEffect(() => {
    if (!mfaSetup?.otpauthUri) return;
    let mounted = true;
    import("qrcode")
      .then((module) => module.toDataURL(mfaSetup.otpauthUri, { width: 240, margin: 2, errorCorrectionLevel: "M" }))
      .then((value) => { if (mounted) setMfaQrCode(value); })
      .catch(() => { if (mounted) setStatus(t("The QR code could not be displayed. Enter the setup key manually.")); });
    return () => { mounted = false; };
  }, [mfaSetup]);

  const openWorkspace = (path: string) => {
    setIsOpening(true);
    setIsSubmitting(true);
    setLimitedSessions(null);
    setStatus(t("Signed in. Opening your workspace…"), "info");
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    navigationTimer.current = setTimeout(() => {
      requestInFlight.current = false;
      setIsSubmitting(false);
      setStatus(t("You are signed in. Select Open workspace to continue."), "info");
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
    setStatus(t("Confirming your browser session…"), "info");
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
        setStatus(typeof payload.message === "string" ? payload.message : t("Could not return to sign in. Please try again."));
        return;
      }
      resetMfaFlow();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("Could not return to sign in. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyMfaChallenge = async () => {
    if (mfaCode.trim().length < 6) {
      setStatus(mfaRecoveryMode ? t("Enter one of your recovery codes.") : t("Enter the six-digit code from your authenticator app."));
      return;
    }
    requestInFlight.current = true;
    setIsSubmitting(true);
    setStatus(t("Verifying your code…"), "info");
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
        setStatus(typeof payload.message === "string" ? payload.message : t("The verification code could not be accepted."));
        return;
      }
      if (payload.authenticated !== true) throw new Error(t("Sign-in could not be completed. Please try again."));
      navigating = await finishAuthenticatedSignIn(payload, nextPath);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("The verification code could not be accepted."));
    } finally {
      if (!navigating) {
        requestInFlight.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const startMfaEnrollment = async () => {
    if (!mfaWorkspaceId) {
      setStatus(t("Your workspace could not be identified. Sign in again."));
      return;
    }
    requestInFlight.current = true;
    setIsSubmitting(true);
    setStatus(t("Creating your authenticator setup…"), "info");
    try {
      const { ok, payload } = await authRequest("/api/auth/mfa/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: mfaWorkspaceId }),
      });
      if (!ok || typeof payload.secret !== "string" || typeof payload.otpauthUri !== "string") {
        setStatus(typeof payload.message === "string" ? payload.message : t("Authenticator setup could not be started."));
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
      setStatus(error instanceof Error ? error.message : t("Authenticator setup could not be started."));
    } finally {
      requestInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const confirmMfaEnrollment = async () => {
    if (!/^\d{6}$/.test(mfaCode)) {
      setStatus(t("Enter the six-digit code from your authenticator app."));
      return;
    }
    requestInFlight.current = true;
    setIsSubmitting(true);
    setStatus(t("Confirming your authenticator…"), "info");
    try {
      const { ok, payload } = await authRequest("/api/auth/mfa/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: mfaWorkspaceId, code: mfaCode }),
      });
      if (!ok || !Array.isArray(payload.recoveryCodes)
        || !payload.recoveryCodes.every((code) => typeof code === "string")) {
        setStatus(typeof payload.message === "string" ? payload.message : t("Authenticator setup could not be confirmed."));
        return;
      }
      setRecoveryCodes(payload.recoveryCodes as string[]);
      setRecoveryCodesSaved(false);
      setMfaStage("recovery");
      setMfaQrCode("");
      setMfaCode("");
      setStatus(t("Your authenticator is active. Save these recovery codes now."), "info");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("Authenticator setup could not be confirmed."));
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
      setStatus(t("Confirming your browser session…"), "info");
      await confirmBrowserSession();
      openWorkspace(authenticatedDestination);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("Your session could not be confirmed."));
      requestInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const continueAfterRecovery = async () => {
    if (!recoveryCodesSaved) {
      setStatus(t("Confirm that you saved the recovery codes before continuing."));
      return;
    }
    requestInFlight.current = true;
    setIsSubmitting(true);
    try {
      setStatus(t("Confirming your secure session…"), "info");
      await confirmBrowserSession();
      openWorkspace(authenticatedDestination);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("Your session could not be confirmed."));
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
        : t("Use 10+ characters with uppercase, lowercase, a number, and a symbol.");
      const nextConfirmError = password === confirmPassword ? "" : t("Passwords do not match.");
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
      setStatus(passwordResetToken ? t("Saving your new password…") : t("Activating your account…"), "info");
      try {
        const { ok, payload } = await authRequest(passwordResetToken ? "/api/auth/reset-password" : "/api/auth/invitations/activate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(passwordResetToken ? { resetToken: passwordResetToken, password } : { invitationToken, password, tenantSlug: tenant.loginSlug }),
        });
        if (!ok) {
          setStatus(typeof payload.message === "string" ? payload.message : (passwordResetToken ? t("Unable to reset this password.") : t("Unable to activate this invitation.")));
          return;
        }
        if (passwordResetToken) {
          setPassword("");
          setConfirmPassword("");
          setStatus(t("Password updated. Sign in with your new password."), "info");
          router.replace(`/login?tenant=${encodeURIComponent(tenant.loginSlug)}&reason=password-reset`);
        } else {
          if (payload.authenticated !== true) throw new Error(t("Sign-in could not be completed. Please try again."));
          navigating = await finishAuthenticatedSignIn(payload, "/workspace");
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t("Unable to sign in. Please try again."));
      } finally {
        if (!navigating) { requestInFlight.current = false; setIsSubmitting(false); }
      }
      return;
    }
    if (tenant.loginSlug && MOBILE_NUMBER.test(email.trim())) {
      // Clients sign in to their portal with a mobile number and a WhatsApp code.
      router.push(`/portal/${encodeURIComponent(tenant.loginSlug)}`);
      return;
    }
    const nextEmailError = /^\S+@\S+\.\S+$/.test(email)
      ? ""
      : email.trim() ? t("This doesn’t look like a valid email address.") : t("Enter your email address.");
    if (credentialStep === "identify") {
      setEmailError(nextEmailError);
      if (nextEmailError) { (event.currentTarget.elements.namedItem("email") as HTMLInputElement | null)?.focus(); return; }
      setStatus("");
      setCredentialStep("password");
      return;
    }
    const nextPasswordError = password.length >= 8
      ? ""
      : password ? t("Use at least 8 characters.") : t("Enter your password.");

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) {
      setStatus("");
      (event.currentTarget.elements.namedItem(nextEmailError ? "email" : "password") as HTMLInputElement | null)?.focus();
      return;
    }

    await signIn();
  };

  const signIn = async (revokeFamilyId?: string, workspaceSlug?: string) => {
    if (requestInFlight.current) return;
    if (workspaceSlug) chosenWorkspaceSlug.current = workspaceSlug;
    const tenantSlug = chosenWorkspaceSlug.current ?? tenant.loginSlug;
    requestInFlight.current = true;
    let navigating = false;
    setDeviceFailure("");
    setIsSubmitting(true);
    setStatus(revokeFamilyId ? t("Logging out the selected device…") : t("Signing you in…"), "info");
    try {
      const { ok, status: responseStatus, payload } = await authRequest("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, tenantSlug, revokeFamilyId }),
      });
      if (!ok) {
        const message = typeof payload.message === "string" ? payload.message : t("Unable to sign in. Check your details and try again.");
        if (payload.code === "DEVICE_LIMIT_REACHED" && Array.isArray(payload.sessions) && payload.sessions.length) {
          setLimitedSessions(payload.sessions as SecuritySession[]);
        } else if (limitedSessions && responseStatus !== 401) {
          setDeviceFailure(message);
          return;
        } else setLimitedSessions(null);
        setStatus(message);
        return;
      }
      if (payload.workspaceSelectionRequired === true && Array.isArray(payload.workspaces)) {
        setWorkspaceChoices(payload.workspaces as WorkspaceChoice[]);
        setStatus("");
        return;
      }
      setWorkspaceChoices(null);
      if (payload.mfaRequired === true) {
        setMfaStage("challenge");
        setMfaCode("");
        setMfaRecoveryMode(false);
        setLimitedSessions(null);
        setStatus(t("Enter the code from your authenticator app."), "info");
        return;
      }
      if (payload.authenticated !== true) throw new Error(t("Sign-in could not be completed. Please try again."));
      // A reclaimed device slot can continue into onboarding or MFA enrollment
      // without navigating away. Clear the old limit dialog before that state
      // transition so it cannot retry with the password we intentionally erase.
      setLimitedSessions(null);
      setDeviceFailure("");
      navigating = await finishAuthenticatedSignIn(payload, nextPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("Unable to sign in. Please try again.");
      if (limitedSessions) setDeviceFailure(message);
      else setStatus(message);
    } finally {
      if (!navigating) { requestInFlight.current = false; setIsSubmitting(false); }
    }
  };

  const startRecovery = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setEmailError(t("Enter your work email to reset the password."));
      return;
    }
    setStatus(t("Sending password recovery instructions…"), "info");
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, tenantSlug: tenant.loginSlug }),
    }).catch(() => null);
    setStatus(response?.ok
      ? t("If this account exists, password recovery instructions are ready.")
      : t("Password recovery is unavailable. Please try again."), response?.ok ? "info" : "error");
  };

  const canSkipEnrollment = canDeferMfaEnrollment;
  const choosingWorkspace = mfaStage === "credentials" && Boolean(workspaceChoices);
  const heading = choosingWorkspace ? t("Choose a workspace") : mfaStage === "challenge"
    ? t("Verify it’s you")
    : mfaStage === "enrollment"
      ? mfaSetup ? t("Connect your authenticator") : t("Protect your account")
      : mfaStage === "recovery"
        ? t("Save your recovery codes")
        : passwordResetToken
          ? t("Reset your password")
          : invitationToken
            ? t("Create your password")
            : t("Welcome back");
  const intro = choosingWorkspace ? t("Your account has access to more than one workspace.") : mfaStage === "challenge"
    ? t("Use your authenticator app or one of your saved recovery codes.")
    : mfaStage === "enrollment"
      ? mfaSetup
        ? t("Scan this code with your authenticator app, then confirm the six-digit code.")
        : t("Use an authenticator app for an extra sign-in check.")
      : mfaStage === "recovery"
        ? t("Each code works once if you lose access to your authenticator app.")
        : passwordResetToken
          ? t("Choose a new password to secure your account.")
          : invitationToken
            ? t("Activate your invitation to {name}.", { name: tenant.displayName })
            : t("Sign in to continue to your {name} workspace.", { name: tenant.displayName });
  const submitLabel = isOpening
    ? t("Open workspace")
    : isSubmitting
      ? mfaStage === "challenge"
        ? t("Verifying")
        : mfaStage === "enrollment"
          ? mfaSetup ? t("Confirming") : t("Preparing")
          : mfaStage === "recovery"
            ? t("Opening workspace")
            : passwordResetToken ? t("Saving password") : invitationToken ? t("Activating") : t("Signing in")
      : mfaStage === "challenge"
        ? t("Verify and sign in")
        : mfaStage === "enrollment"
          ? mfaSetup ? t("Confirm authenticator") : t("Set up authenticator")
          : mfaStage === "recovery"
            ? t("Continue to workspace")
            : passwordResetToken ? t("Save new password") : invitationToken ? t("Activate invitation") : credentialStep === "identify" ? t("Continue") : t("Sign in");

  return (
    <DesignSystemProvider className={styles.loginRoot} data-tenant-slug={tenant.loginSlug} direction={languageDirection(language)} locale={language === "en" ? "en-AE" : language} portalContainer={portalContainer} ref={setPortalContainer} style={workspacePrimaryColorStyle(tenant)}>
      <main className={styles.loginLayout}>
        <div aria-hidden="true" className={styles.brandPanel} />

        <section aria-labelledby="login-heading" className={styles.loginPanel}>
          <div className={styles.loginCard}>
            <header className={styles.tenantBrand} aria-label={t("{name} workspace", { name: tenant.displayName })}>
              {tenant.logoUrl ? (
                <span className={styles.tenantLogo}>
                  <Image alt={tenant.displayName} fill preload sizes="88px" src={tenant.logoUrl} />
                </span>
              ) : null}
              <strong className={styles.tenantName}>{tenant.displayName}</strong>
            </header>
            <div className={styles.formArea} data-security={mfaStage !== "credentials"}>
            <div className={styles.formIntro}>
              {choosingWorkspace ? <Button className={styles.backButton} isDisabled={isSubmitting} onPress={() => { setWorkspaceChoices(null); chosenWorkspaceSlug.current = null; setStatus(""); }} size="compact" type="button" variant="quiet"><ArrowLeft data-directional="true" aria-hidden="true" size={14} />{t("Back")}</Button> : null}
              {mfaStage === "enrollment" || mfaStage === "challenge" ? <Button className={styles.backButton} isDisabled={isSubmitting} onPress={() => void backFromMfa()} size="compact" type="button" variant="quiet"><ArrowLeft data-directional="true" aria-hidden="true" size={14} />{mfaSetup ? t("Back") : t("Back to sign in")}</Button> : null}
              <h1 id="login-heading">{heading}</h1>
              <p>{intro}</p>
            </div>

            {choosingWorkspace ? <ul aria-label={t("Workspaces")} className={styles.workspaceList}>
              {workspaceChoices!.map((workspace) => <li key={workspace.loginSlug}>
                <Button className={styles.workspaceChoice} isDisabled={isSubmitting} onPress={() => void signIn(undefined, workspace.loginSlug)} type="button" variant="secondary">
                  <span aria-hidden="true" className={styles.workspaceInitial}>{workspace.name.trim().charAt(0).toUpperCase()}</span>
                  <span>{workspace.name}</span>
                </Button>
              </li>)}
            </ul> : null}

            <form className={styles.loginForm} hidden={choosingWorkspace} noValidate onSubmit={submit}>
              {mfaStage === "credentials" ? <>
                {!settingPassword && credentialStep === "password" ? <div className={styles.identityChip}>
                  <span dir="ltr">{email}</span>
                  <button className={styles.textButton} disabled={isSubmitting} onClick={() => { setCredentialStep("identify"); setPassword(""); setPasswordError(""); setStatus(""); }} type="button">{t("Change")}</button>
                </div> : null}
                {!settingPassword && credentialStep === "identify" ? <TextInput
                  autoComplete="username"
                  autoFocus
                  errorMessage={emailError}
                  inputType={tenant.loginSlug ? "text" : "email"}
                  isInvalid={Boolean(emailError)}
                  isRequired
                  label={tenant.loginSlug ? t("Email or mobile") : t("Email")}
                  name="email"
                  onChange={(value) => {
                    setEmail(value);
                    setLimitedSessions(null);
                    if (emailError) setEmailError("");
                  }}
                  placeholder="you@company.com"
                  value={email}
                /> : null}

                {settingPassword || credentialStep === "password" ? <div className={styles.passwordField}>
                <TextInput
                  autoFocus={!settingPassword}
                  autoComplete={settingPassword ? "new-password" : "current-password"}
                  errorMessage={passwordError}
                  inputType={showPassword ? "text" : "password"}
                  isInvalid={Boolean(passwordError)}
                  isRequired
                  label={settingPassword ? t("New password") : t("Password")}
                  name="password"
                  onChange={(value) => {
                    setPassword(value);
                    setLimitedSessions(null);
                    if (passwordError) setPasswordError("");
                  }}
                  placeholder={settingPassword ? t("Create a password") : undefined}
                  suffix={
                    <InputAction
                      aria-label={showPassword ? t("Hide password") : t("Show password")}
                      className={styles.passwordToggle}
                      onPress={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
                    </InputAction>
                  }
                  value={password}
                />

                </div> : null}

                {!settingPassword && credentialStep === "password" ? <div className={styles.formOptions}>
                  <button
                    className={styles.textButton}
                    disabled={isSubmitting} onClick={startRecovery}
                    type="button"
                  >
                    {t("Forgot password?")}
                  </button>
                </div> : settingPassword ? <p className={styles.passwordHint}>{t("Use 10 or more characters with uppercase, lowercase, a number and a symbol.")}</p> : null}

                {settingPassword ? <TextInput
                  errorMessage={confirmPasswordError}
                  inputType={showPassword ? "text" : "password"}
                  isInvalid={Boolean(confirmPasswordError)}
                  isRequired
                  label={t("Confirm password")}
                  name="confirm-password"
                  onChange={(value) => {
                    setConfirmPassword(value);
                    if (confirmPasswordError) setConfirmPasswordError("");
                  }}
                  placeholder={t("Enter the password again")}
                  value={confirmPassword}
                /> : null}


              </> : null}

              {mfaStage === "challenge" ? <div className={styles.mfaForm}>
                <span className={styles.securityMark}><ShieldCheck aria-hidden="true" size={20} /></span>
                {mfaRecoveryMode ? <TextInput
                  autoComplete="one-time-code"
                  isRequired
                  label={t("Recovery code")}
                  onChange={(value) => { setMfaCode(value.toUpperCase()); setStatus(""); }}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  value={mfaCode}
                /> : <div className={styles.otpField}>
                  <span>{t("Authenticator code")} <i aria-hidden="true">*</i></span>
                  <OtpInput onChange={(value) => { setMfaCode(value); setStatus(""); }} value={mfaCode} />
                </div>}
                <div className={styles.mfaLinks}>
                  <button className={styles.textButton} disabled={isSubmitting} onClick={() => { setMfaRecoveryMode((value) => !value); setMfaCode(""); setStatus(""); }} type="button">
                    {mfaRecoveryMode ? t("Use authenticator code") : t("Use a recovery code")}
                  </button>
                </div>
              </div> : null}

              {mfaStage === "enrollment" ? <div className={styles.mfaForm}>
                {!mfaSetup ? <>
                  {mfaEnrollmentDeadline ? <p className={styles.deadlineNotice}>
                    {canSkipEnrollment
                      ? t("Set up by {date}.", { date: new Date(mfaEnrollmentDeadline).toLocaleDateString(language) })
                      : t("Required before entering the workspace.")}
                  </p> : null}
                </> : <>
                  <div className={styles.qrPanel}>
                    {mfaQrCode ? <Image alt={t("Authenticator setup QR code")} height={200} src={mfaQrCode} unoptimized width={200} /> : <span role="status">{t("Preparing QR code…")}</span>}
                  </div>
                  <div aria-label={t("Authenticator setup key")} className={styles.manualKey}>
                    <span>{t("Setup key")}</span>
                    <code title={mfaSetup.secret}>{mfaSetup.secret}</code>
                    <button aria-label={t("Copy setup key")} className={styles.copySetupKey} onClick={() => {
                      if (!navigator.clipboard?.writeText) {
                        setStatus(t("Select and copy the setup key manually."));
                        return;
                      }
                      void navigator.clipboard.writeText(mfaSetup.secret)
                        .then(() => setStatus(t("Setup key copied."), "info"))
                        .catch(() => setStatus(t("Select and copy the setup key manually.")));
                    }} title={t("Copy setup key")} type="button"><Copy aria-hidden="true" size={14} /></button>
                  </div>
                  <div className={styles.otpField}>
                    <span>{t("Six-digit code")} <i aria-hidden="true">*</i></span>
                    <OtpInput onChange={(value) => { setMfaCode(value); setStatus(""); }} value={mfaCode} />
                  </div>
                </>}

              </div> : null}

              {mfaStage === "recovery" ? <div className={styles.mfaForm}>
                <div className={styles.recoveryHeader}><ShieldCheck aria-hidden="true" size={18} /><span>{t("Store these somewhere safe. They will not be shown again.")}</span></div>
                <ol aria-label={t("Recovery codes")} className={styles.recoveryCodes}>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
                <Button className={styles.copyCodes} onPress={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n")).then(() => setStatus(t("Recovery codes copied."), "info")).catch(() => setStatus(t("Select and copy the recovery codes manually.")))} size="compact" variant="quiet"><Copy size={14} />{t("Copy all codes")}</Button>
                <Checkbox isSelected={recoveryCodesSaved} onChange={setRecoveryCodesSaved}>{t("I saved these recovery codes")}</Checkbox>
              </div> : null}

              <Button className={styles.submitButton} isLoading={isSubmitting} size="large" type="submit" variant="primary">
                {submitLabel}

              </Button>
              {mfaStage === "enrollment" && !mfaSetup && canSkipEnrollment ? <Button className={styles.skipSetup} isDisabled={isSubmitting} onPress={() => void skipMfaEnrollment()} size="large" type="button" variant="secondary">{t("Set up later")}</Button> : null}
            </form>

            {status && !limitedSessions ? <InlineNotice className={styles.statusMessage} message={status} title={statusTone === "error" ? t("Sign-in needs attention") : undefined} tone={statusTone} /> : null}

            {isOpening ? <a className={styles.continueLink} href={authenticatedDestination}>{authenticatedDestination === "/onboarding" ? t("Continue setup") : t("Open workspace")}</a> : null}

            {mfaStage === "credentials" ? <p className={styles.supportCopy}>
              {settingPassword ? (
                <button onClick={() => router.replace(`/login?tenant=${encodeURIComponent(tenant.loginSlug)}`)} type="button">{t("Back to sign in")}</button>
              ) : (
                <>{t("Need access? Ask your administrator for an invitation.")}</>
              )}
            </p> : null}
            </div>
            <footer aria-label={t("Powered by Wodana")} className={styles.poweredBy}>
              <span>{t("Powered by")}</span>
              <WodanaLogo size="small" className={styles.poweredLogo} />
            </footer>
          </div>
        </section>
      </main>
      <ControlledModalDialog
        title={t("Device limit reached")}
        description={t("Log out a device to continue signing in.")}
        isOpen={Boolean(limitedSessions)}
        isDismissable={!isSubmitting}
        onOpenChange={(open) => { if (!open && !isSubmitting) { setLimitedSessions(null); setStatus(""); } }}
        footer={<Button className={styles.deviceCancelButton} isDisabled={isSubmitting} onPress={() => { setLimitedSessions(null); setStatus(""); }}>{t("Back to sign in")}</Button>}
      >
        <section className={styles.deviceLimit} aria-label={t("Logged-in devices")}>
          <p aria-live="polite">{t("{count} of {limit} devices in use. Choose a session to log out.", { count: limitedSessions?.length ?? 0, limit: 2 })}</p>
          {deviceFailure ? <p role="alert" className={styles.deviceFailure}>{deviceFailure}</p> : null}
          <ul>{limitedSessions?.map((session) => {
            const device = deviceDetails(session.userAgent);
            return <li key={session.familyId}>
              <span className={styles.deviceIcon}><Monitor aria-hidden="true" size={21} strokeWidth={1.5} /></span>
              <div><strong>{device.browser === "Unknown browser" && device.device === "Unknown device" ? t("Unrecognized device") : t("{browser} on {device}", { browser: device.browser, device: device.device })}</strong>
                <small>{session.ipAddress ?? t("IP not recorded")}</small>
                <small>{t("Last active {time}", { time: new Date(session.lastActiveAt).toLocaleString(language) })}</small>
              </div>
              <Button isDisabled={isSubmitting} onPress={() => void signIn(session.familyId)} className={styles.deviceLogoutButton}>{t("Log out device")}</Button>
            </li>;
          })}</ul>
          <p>{t("The selected device will be signed out immediately. You’ll continue signing in here.")}</p>
          {isSubmitting ? <p role="status">{t("Logging out device…")}</p> : null}
        </section>
      </ControlledModalDialog>
    </DesignSystemProvider>
  );
}
