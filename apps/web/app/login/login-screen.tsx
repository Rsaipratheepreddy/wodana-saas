"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Copy, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { WodanaLogo } from "@/components/brand";
import {
  Button,
  Checkbox,
  ControlledModalDialog,
  DesignSystemProvider,
  InputAction,
  OtpInput,
  TextInput,
} from "@/design-system";
import type { SecuritySession } from "@/lib/workspace/security";
import { authRequest, confirmBrowserSession, openAuthenticatedWorkspace } from "@/lib/auth/client";
import { deviceDetails } from "@/lib/auth/device-details";
import styles from "./login.module.css";

type TenantBranding = { displayName: string; loginSlug: string; logoUrl: string | null };
type MfaStage = "credentials" | "challenge" | "enrollment" | "recovery";
type MfaSetup = { secret: string; otpauthUri: string; setupExpiresInSeconds: number };

export function LoginScreen({
  demoCredentials,
  invitationToken,
  passwordResetToken,
  nextPath,
  initialStatus,
  tenant,
}: {
  demoCredentials?: { email: string; password: string };
  invitationToken?: string;
  passwordResetToken?: string;
  nextPath: string;
  initialStatus?: string;
  tenant: TenantBranding;
}) {
  const router = useRouter();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const settingPassword = Boolean(invitationToken || passwordResetToken);
  const [email, setEmail] = useState(demoCredentials?.email ?? "");
  const [password, setPassword] = useState(settingPassword ? "" : demoCredentials?.password ?? "");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "");
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
    setStatus("Signed in. Opening your workspace…");
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    navigationTimer.current = setTimeout(() => {
      requestInFlight.current = false;
      setIsSubmitting(false);
      setStatus("You are signed in. Select Open workspace to continue.");
    }, 12_000);
    openAuthenticatedWorkspace(path);
  };

  const finishAuthenticatedSignIn = async (payload: Record<string, unknown>, path: string) => {
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
      setStatus("Secure your account with an authenticator app.");
      return false;
    }
    setStatus("Confirming your browser session…");
    await confirmBrowserSession();
    setPassword("");
    openWorkspace(path);
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

  const verifyMfaChallenge = async () => {
    if (mfaCode.trim().length < 6) {
      setStatus(mfaRecoveryMode ? "Enter one of your recovery codes." : "Enter the six-digit code from your authenticator app.");
      return;
    }
    requestInFlight.current = true;
    setIsSubmitting(true);
    setStatus("Verifying your code…");
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
    setStatus("Creating your authenticator setup…");
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
      setStatus("Scan the QR code, then enter the six-digit code from your app.");
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
    setStatus("Confirming your authenticator…");
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
      setStatus("Your authenticator is active. Save these recovery codes now.");
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
      setStatus("Confirming your browser session…");
      await confirmBrowserSession();
      openWorkspace(nextPath);
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
      setStatus("Confirming your secure session…");
      await confirmBrowserSession();
      openWorkspace(nextPath);
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
        setStatus("Check the highlighted fields and try again.");
        return;
      }
      requestInFlight.current = true;
      let navigating = false;
      setIsSubmitting(true);
      setStatus(passwordResetToken ? "Saving your new password…" : "Activating your account…");
      try {
        const { ok, payload } = await authRequest(passwordResetToken ? "/api/auth/reset-password" : "/api/auth/invitations/activate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(passwordResetToken ? { resetToken: passwordResetToken, password } : { invitationToken, password }),
        });
        if (!ok) {
          setStatus(typeof payload.message === "string" ? payload.message : (passwordResetToken ? "Unable to reset this password." : "Unable to activate this invitation."));
          return;
        }
        if (passwordResetToken) {
          setPassword("");
          setConfirmPassword("");
          setStatus("Password updated. Sign in with your new password.");
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
      : "Enter a valid work email address.";
    const nextPasswordError = password.length >= 8
      ? ""
      : "Password must contain at least 8 characters.";

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) {
      setStatus("Check the highlighted fields and try again.");
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
    setStatus(revokeFamilyId ? "Logging out the selected device…" : "Signing you in…");
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
        setStatus("Enter the code from your authenticator app.");
        return;
      }
      if (payload.authenticated !== true) throw new Error("Sign-in could not be completed. Please try again.");
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
    setStatus("Sending password recovery instructions…");
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, tenantSlug: tenant.loginSlug }),
    }).catch(() => null);
    setStatus(response?.ok
      ? "If this account exists, password recovery instructions are ready."
      : "Password recovery is unavailable. Please try again.");
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
        : "Add a second verification step so a password alone cannot access your work."
      : mfaStage === "recovery"
        ? "Each code works once if you lose access to your authenticator app."
        : passwordResetToken
          ? "Choose a new password to secure your account."
          : invitationToken
            ? `Activate your invitation to ${tenant.displayName}.`
            : "Sign in to continue to your Wodana workspace.";
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
    <DesignSystemProvider className={styles.loginRoot} locale="en-AE" portalContainer={portalContainer} ref={setPortalContainer}>
      <main className={styles.loginLayout}>
        <section aria-labelledby="welcome-heading" className={styles.brandPanel}>
          <div className={styles.brandStory}>
            <div aria-label={`Wodana and ${tenant.displayName}`} className={styles.coBrand}>
              <WodanaLogo className={styles.brandLogo} size="large" />
              <span aria-hidden="true" className={styles.brandTimes}>×</span>
              {tenant.logoUrl ? (
                <span className={styles.tenantLogo}>
                  <Image alt={tenant.displayName} fill sizes="144px" src={tenant.logoUrl} />
                </span>
              ) : (
                <strong className={styles.tenantName}>{tenant.displayName}</strong>
              )}
            </div>
            <h2 id="welcome-heading">Hey, hello!</h2>
            <p className={styles.brandLead}>
              One workspace for the whole customer journey.
            </p>
            <p className={styles.brandDescription}>
              Bring your team, CRM, pre-execution planning, and delivery into one clear operating view.
            </p>
          </div>
        </section>

        <section aria-labelledby="login-heading" className={styles.loginPanel}>
          <div className={styles.formArea}>
            <div className={styles.formIntro}>
              <div aria-label={`Wodana and ${tenant.displayName}`} className={styles.mobileLogo}>
                <WodanaLogo size="large" />
                <span aria-hidden="true">×</span>
                <strong>{tenant.displayName}</strong>
              </div>
              <h1 id="login-heading">{heading}</h1>
              <p>{intro}</p>
            </div>

            <form className={styles.loginForm} noValidate onSubmit={submit}>
              {mfaStage === "credentials" ? <>
                {!settingPassword ? <TextInput
                  errorMessage={emailError}
                  inputType="email"
                  isInvalid={Boolean(emailError)}
                  isRequired
                  label="Work email"
                  name="email"
                  onChange={(value) => {
                    setEmail(value);
                    setLimitedSessions(null);
                    if (emailError) setEmailError("");
                  }}
                  placeholder="you@company.com"
                  value={email}
                /> : null}

                <TextInput
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
                  placeholder="Enter your password"
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

                {!settingPassword ? <div className={styles.formOptions}>
                  <button
                    className={styles.textButton}
                    disabled={isSubmitting} onClick={startRecovery}
                    type="button"
                  >
                    Forgot password?
                  </button>
                </div> : null}
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
                  <button className={styles.textButton} disabled={isSubmitting} onClick={resetMfaFlow} type="button"><ArrowLeft size={13} />Back to sign in</button>
                </div>
              </div> : null}

              {mfaStage === "enrollment" ? <div className={styles.mfaForm}>
                {!mfaSetup ? <>
                  <span className={styles.securityMark}><ShieldCheck aria-hidden="true" size={22} /></span>
                  <ul className={styles.securityBenefits}>
                    <li>Use any standard authenticator app.</li>
                    <li>Recovery codes keep access available if your phone is lost.</li>
                    <li>Your projects and client information get an extra sign-in check.</li>
                  </ul>
                  {mfaEnrollmentDeadline ? <p className={styles.deadlineNotice}>
                    {canSkipEnrollment
                      ? `Complete setup by ${new Date(mfaEnrollmentDeadline).toLocaleDateString()}.`
                      : "Setup is required before you can enter the workspace."}
                  </p> : null}
                </> : <>
                  <div className={styles.qrPanel}>
                    {mfaQrCode ? <Image alt="Authenticator setup QR code" height={200} src={mfaQrCode} unoptimized width={200} /> : <span role="status">Preparing QR code…</span>}
                  </div>
                  <div className={styles.manualKey}>
                    <span>Can’t scan it? Enter this setup key</span>
                    <code>{mfaSetup.secret}</code>
                    <button className={styles.textButton} onClick={() => void navigator.clipboard?.writeText(mfaSetup.secret).then(() => setStatus("Setup key copied.")).catch(() => setStatus("Select and copy the setup key manually."))} type="button"><Copy size={13} />Copy key</button>
                  </div>
                  <div className={styles.otpField}>
                    <span>Six-digit code <i aria-hidden="true">*</i></span>
                    <OtpInput onChange={(value) => { setMfaCode(value); setStatus(""); }} value={mfaCode} />
                  </div>
                </>}
                {!mfaSetup && canSkipEnrollment ? <button className={styles.textButton} disabled={isSubmitting} onClick={() => void skipMfaEnrollment()} type="button">Set up later</button> : null}
              </div> : null}

              {mfaStage === "recovery" ? <div className={styles.mfaForm}>
                <div className={styles.recoveryHeader}><ShieldCheck aria-hidden="true" size={18} /><span>Store these somewhere safe. They will not be shown again.</span></div>
                <ol aria-label="Recovery codes" className={styles.recoveryCodes}>{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ol>
                <Button className={styles.copyCodes} onPress={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n")).then(() => setStatus("Recovery codes copied.")).catch(() => setStatus("Select and copy the recovery codes manually."))} size="compact" variant="quiet"><Copy size={14} />Copy all codes</Button>
                <Checkbox isSelected={recoveryCodesSaved} onChange={setRecoveryCodesSaved}>I saved these recovery codes</Checkbox>
              </div> : null}

              <Button className={styles.submitButton} isLoading={isSubmitting} size="large" type="submit">
                {submitLabel}
                <ArrowUpRight aria-hidden="true" size={15} />
              </Button>
            </form>

            <p role={isSubmitting || isOpening ? "status" : "alert"} aria-live="polite" className={styles.statusMessage} data-visible={Boolean(status) && !limitedSessions}>
              {limitedSessions ? "" : status || "Ready"}
            </p>

            {isOpening ? <a className={styles.continueLink} href={nextPath}>Open workspace</a> : null}

            <p className={styles.supportCopy}>
              {mfaStage !== "credentials" ? null : settingPassword ? (
                <button onClick={() => router.replace(`/login?tenant=${encodeURIComponent(tenant.loginSlug)}`)} type="button">Back to sign in</button>
              ) : demoCredentials ? (
                <>Demo tenant: <strong>{tenant.displayName}</strong></>
              ) : (
                <>New to Wodana? Ask your administrator for an invitation.</>
              )}
            </p>
          </div>
        </section>
      </main>
      <ControlledModalDialog
        title="Device limit reached"
        description="Log out a device to continue signing in."
        isOpen={Boolean(limitedSessions)}
        isDismissable={!isSubmitting}
        onOpenChange={(open) => { if (!open && !isSubmitting) { setLimitedSessions(null); setStatus(""); } }}
        footer={<Button className={styles.deviceLogoutButton} isDisabled={isSubmitting} onPress={() => { setLimitedSessions(null); setStatus(""); }}>Back to sign in</Button>}
      >
        <section className={styles.deviceLimit} aria-label="Logged-in devices">
          <p aria-live="polite">You are signed in on {limitedSessions?.length ?? 0} devices. Your account allows a maximum of 2 devices.</p>
          {deviceFailure ? <p role="alert" className={styles.deviceFailure}>{deviceFailure}</p> : null}
          <ul>{limitedSessions?.map((session) => {
            const device = deviceDetails(session.userAgent);
            return <li key={session.familyId}>
              <div><strong>{device.browser} on {device.device}</strong>
                <small>{session.ipAddress ?? "IP not recorded"}</small>
                <small>Last active {new Date(session.lastActiveAt).toLocaleString()}</small>
              </div>
              <Button isDisabled={isSubmitting} onPress={() => void signIn(session.familyId)} className={styles.deviceLogoutButton}>Log out device</Button>
            </li>;
          })}</ul>
          <p>Logging out expires that device’s session immediately. You will continue here once a slot is free.</p>
          {isSubmitting ? <p role="status">Logging out device…</p> : null}
        </section>
      </ControlledModalDialog>
    </DesignSystemProvider>
  );
}
