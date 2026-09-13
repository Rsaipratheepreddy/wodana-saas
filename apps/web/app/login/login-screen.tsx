"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Eye, EyeOff } from "lucide-react";
import { WodanaLogo } from "@/components/brand";
import {
  Button,
  ControlledModalDialog,
  DesignSystemProvider,
  InputAction,
  TextInput,
} from "@/design-system";
import type { SecuritySession } from "@/lib/workspace/security";
import { authRequest, confirmBrowserSession, openAuthenticatedWorkspace } from "@/lib/auth/client";
import { deviceDetails } from "@/lib/auth/device-details";
import styles from "./login.module.css";

type TenantBranding = { displayName: string; loginSlug: string; logoUrl: string | null };

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
  const requestInFlight = useRef(false);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (navigationTimer.current) clearTimeout(navigationTimer.current); }, []);

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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isOpening) { openWorkspace(nextPath); return; }
    if (requestInFlight.current) return;
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
          setStatus("Confirming your browser session…");
          await confirmBrowserSession();
          navigating = true;
          openWorkspace("/workspace");
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
      if (payload.authenticated !== true) throw new Error("Sign-in could not be completed. Please try again.");
      setStatus("Confirming your browser session…");
      await confirmBrowserSession();
      setPassword("");
      navigating = true;
      openWorkspace(nextPath);
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
              <h1 id="login-heading">{passwordResetToken ? "Reset your password" : invitationToken ? "Create your password" : "Welcome back"}</h1>
              <p>{passwordResetToken ? "Choose a new password to secure your account." : invitationToken ? `Activate your invitation to ${tenant.displayName}.` : "Sign in to continue to your Wodana workspace."}</p>
            </div>

            <form className={styles.loginForm} noValidate onSubmit={submit}>
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

              <Button className={styles.submitButton} isLoading={isSubmitting} size="large" type="submit">
                {isOpening ? "Open workspace" : isSubmitting ? (passwordResetToken ? "Saving password" : invitationToken ? "Activating" : "Signing in") : (passwordResetToken ? "Save new password" : invitationToken ? "Activate invitation" : "Sign in")}
                <ArrowUpRight aria-hidden="true" size={15} />
              </Button>
            </form>

            <p role={isSubmitting || isOpening ? "status" : "alert"} aria-live="polite" className={styles.statusMessage} data-visible={Boolean(status) && !limitedSessions}>
              {limitedSessions ? "" : status || "Ready"}
            </p>

            {isOpening ? <a className={styles.continueLink} href={nextPath}>Open workspace</a> : null}

            <p className={styles.supportCopy}>
              {settingPassword ? (
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
