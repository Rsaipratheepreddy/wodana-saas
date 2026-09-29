"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import {
  Button, Callout, Code, Container, DesignSystemProvider, EmailInput, Form,
  Heading, IconButton, Inline, PasswordInput, Stack, Text, TextInput,
} from "@/design-system";
import { useLanguage, useT } from "@/lib/i18n/i18n-provider";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import styles from "./sign-in.module.css";

type Stage = "password" | "enroll" | "verify" | "recovery";
type LoginResponse = { challengeToken: string; purpose: "login" | "enroll" };
type SetupResponse = { secret: string; otpauthUri: string };
type VerifyResponse = { recoveryCodes?: string[] };

async function submit(action: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/internal/auth/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "");
  return payload ?? {};
}

/** Operator sign-in: password, then a mandatory authenticator code (set up on first sign-in). */
export function OperatorSignIn() {
  const t = useT();
  const { language, direction } = useLanguage();
  const router = useRouter();
  const { theme, toggleTheme } = useWorkspaceTheme();
  const [stage, setStage] = useState<Stage>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await work(); }
    catch (reason) { setError((reason instanceof Error && reason.message) || t("Sign-in could not be completed.")); }
    finally { setBusy(false); }
  }

  function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      if (!email.trim() || !password) throw new Error(t("Enter your email and password."));
      const result = await submit("login", { email: email.trim(), password }) as LoginResponse;
      setPassword("");
      setChallengeToken(result.challengeToken);
      setStage(result.purpose === "enroll" ? "enroll" : "verify");
    });
  }

  function onFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      if (!code.trim()) throw new Error(t("Enter your authenticator or recovery code."));
      const action = stage === "enroll" ? "confirm" : "verify";
      const result = await submit(action, { challengeToken, code: code.trim() }) as VerifyResponse;
      setCode("");
      if (result.recoveryCodes?.length) {
        setRecoveryCodes(result.recoveryCodes);
        setStage("recovery");
      } else {
        router.replace("/internal");
      }
    });
  }

  function startSetup() {
    void run(async () => setSetup(await submit("setup", { challengeToken }) as SetupResponse));
  }

  function restart() {
    setStage("password");
    setChallengeToken("");
    setSetup(null);
    setCode("");
    setError("");
  }

  return (
    <DesignSystemProvider className={styles.page} locale={language} direction={direction}>
      <Container as="main" size="form">
        <Stack gap={8}>
          <Inline>
            <Heading as="h1" size="md">{t("Wodana Control")}</Heading>
            <IconButton aria-label={theme === "dark" ? t("Use light mode") : t("Use dark mode")} onPress={toggleTheme}>
              {theme === "dark" ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
            </IconButton>
          </Inline>
          {stage === "password" ? (
            <Form onSubmit={onPassword}>
              <EmailInput autoComplete="username" isRequired label={t("Work email")} onChange={setEmail} value={email} />
              <PasswordInput autoComplete="current-password" isRequired label={t("Password")} onChange={setPassword} value={password} />
              {error ? <Callout title={t("Sign-in failed")} tone="danger">{error}</Callout> : null}
              <Button isLoading={busy} type="submit" variant="primary">{t("Continue")}</Button>
            </Form>
          ) : null}
          {stage === "enroll" ? (
            <Stack gap={4}>
              <Heading as="h2" size="sm">{t("Set up your authenticator")}</Heading>
              {!setup ? <Button isLoading={busy} onPress={startSetup} variant="primary">{t("Start setup")}</Button> : (
                <>
                  <Text>{t("Add this key in your authenticator app:")}</Text>
                  <Code>{setup.secret}</Code>
                  <Form onSubmit={onFactor}>
                    <TextInput autoComplete="one-time-code" isRequired label={t("6-digit code")} onChange={setCode} value={code} />
                    {error ? <Callout title={t("Verification failed")} tone="danger">{error}</Callout> : null}
                    <Button isLoading={busy} type="submit" variant="primary">{t("Verify and sign in")}</Button>
                  </Form>
                </>
              )}
              <Button onPress={restart} variant="quiet">{t("Back to sign in")}</Button>
            </Stack>
          ) : null}
          {stage === "verify" ? (
            <Stack gap={4}>
              <Heading as="h2" size="sm">{t("Verify it's you")}</Heading>
              <Form onSubmit={onFactor}>
                <TextInput autoComplete="one-time-code" isRequired label={recoveryMode ? t("Recovery code") : t("Authenticator code")} onChange={setCode} value={code} />
                {error ? <Callout title={t("Verification failed")} tone="danger">{error}</Callout> : null}
                <Button isLoading={busy} type="submit" variant="primary">{t("Verify and sign in")}</Button>
              </Form>
              <Inline>
                <Button onPress={() => { setRecoveryMode((value) => !value); setCode(""); }} variant="quiet">
                  {recoveryMode ? t("Use authenticator") : t("Use a recovery code")}
                </Button>
                <Button onPress={restart} variant="quiet">{t("Back")}</Button>
              </Inline>
            </Stack>
          ) : null}
          {stage === "recovery" ? (
            <Stack gap={4}>
              <Heading as="h2" size="sm">{t("Save your recovery codes")}</Heading>
              <Text tone="muted">{t("They're shown only once.")}</Text>
              <Code>{recoveryCodes.join("  ·  ")}</Code>
              <Button onPress={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}>{t("Copy codes")}</Button>
              <Button onPress={() => router.replace("/internal")} variant="primary">{t("Continue")}</Button>
            </Stack>
          ) : null}
        </Stack>
      </Container>
    </DesignSystemProvider>
  );
}
