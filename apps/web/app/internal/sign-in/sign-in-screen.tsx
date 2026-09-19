"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import {
  Button, Callout, Code, Container, DesignSystemProvider, EmailInput, Form,
  Heading, IconButton, Inline, PasswordInput, Stack, Text, TextInput,
} from "@/design-system";
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
  if (!response.ok) throw new Error(typeof payload?.message === "string"
    ? payload.message : "Sign-in could not be completed.");
  return payload ?? {};
}

export function OperatorSignIn() {
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
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sign-in could not be completed."); }
    finally { setBusy(false); }
  }

  function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      if (!email.trim() || !password) throw new Error("Enter your email and password.");
      const result = await submit("login", { email: email.trim(), password }) as LoginResponse;
      setPassword("");
      setChallengeToken(result.challengeToken);
      setStage(result.purpose === "enroll" ? "enroll" : "verify");
    });
  }

  function onFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      if (!code.trim()) throw new Error("Enter your authenticator or recovery code.");
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
    <DesignSystemProvider className={styles.page} theme={theme === "dark" ? "dark" : "light"}>
      <Container as="main" size="form">
        <Stack gap={8}>
          <Inline>
            <Heading as="h1" size="md">Wodana Control</Heading>
            <IconButton aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"} onPress={toggleTheme}>
              {theme === "dark" ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
            </IconButton>
          </Inline>
          {stage === "password" ? (
            <Stack gap={4}>
              <Text tone="muted">Sign in with your Wodana operator account.</Text>
              <Form onSubmit={onPassword}>
                <EmailInput autoComplete="username" isRequired label="Work email" onChange={setEmail} value={email} />
                <PasswordInput autoComplete="current-password" isRequired label="Password" onChange={setPassword} value={password} />
                {error ? <Callout title="Sign-in failed" tone="danger">{error}</Callout> : null}
                <Button isLoading={busy} type="submit" variant="primary">Continue</Button>
              </Form>
            </Stack>
          ) : null}
          {stage === "enroll" ? (
            <Stack gap={4}>
              <Heading as="h2" size="sm">Set up your authenticator</Heading>
              <Text tone="muted">Operator access requires an authenticator code.</Text>
              {!setup ? <Button isLoading={busy} onPress={startSetup} variant="primary">Start setup</Button> : (
                <>
                  <Text>Add this key in your authenticator app:</Text>
                  <Code>{setup.secret}</Code>
                  <Form onSubmit={onFactor}>
                    <TextInput autoComplete="one-time-code" isRequired label="6-digit code" onChange={setCode} value={code} />
                    {error ? <Callout title="Verification failed" tone="danger">{error}</Callout> : null}
                    <Button isLoading={busy} type="submit" variant="primary">Verify and sign in</Button>
                  </Form>
                </>
              )}
              <Button onPress={restart} variant="quiet">Back to sign in</Button>
            </Stack>
          ) : null}
          {stage === "verify" ? (
            <Stack gap={4}>
              <Heading as="h2" size="sm">Verify it&apos;s you</Heading>
              <Form onSubmit={onFactor}>
                <TextInput autoComplete="one-time-code" isRequired label={recoveryMode ? "Recovery code" : "Authenticator code"} onChange={setCode} value={code} />
                {error ? <Callout title="Verification failed" tone="danger">{error}</Callout> : null}
                <Button isLoading={busy} type="submit" variant="primary">Verify and sign in</Button>
              </Form>
              <Inline>
                <Button onPress={() => { setRecoveryMode((value) => !value); setCode(""); }} variant="quiet">
                  {recoveryMode ? "Use authenticator" : "Use a recovery code"}
                </Button>
                <Button onPress={restart} variant="quiet">Back</Button>
              </Inline>
            </Stack>
          ) : null}
          {stage === "recovery" ? (
            <Stack gap={4}>
              <Heading as="h2" size="sm">Save your recovery codes</Heading>
              <Text tone="muted">These are shown only once. Store them somewhere secure.</Text>
              <Code>{recoveryCodes.join("  ·  ")}</Code>
              <Button onPress={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}>Copy codes</Button>
              <Button onPress={() => router.replace("/internal")} variant="primary">Continue to Wodana Control</Button>
            </Stack>
          ) : null}
        </Stack>
      </Container>
    </DesignSystemProvider>
  );
}
