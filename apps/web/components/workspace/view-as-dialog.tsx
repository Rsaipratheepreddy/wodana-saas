"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Callout, FormDialog, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { startViewAs, type ViewAsTarget } from "@/lib/workspace/view-as";

/**
 * Starts "View as {person}" or "Preview as {role}": the viewer confirms with an authenticator code (a recent
 * MFA step-up), then lands on Home as that person, read-only. Without two-step verification it points to
 * Security instead.
 */
export function ViewAsDialog({ mfaEnabled, onClose, target, workspaceId }: {
  mfaEnabled: boolean;
  onClose: () => void;
  target: ViewAsTarget | null;
  workspaceId: string;
}) {
  const t = useT();
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState("");
  const [working, setWorking] = useState(false);
  const [key, setKey] = useState("");
  // One idempotency key per opening: a double press starts one view.
  useEffect(() => {
    if (!target) return;
    setCode("");
    setFailure("");
    setKey(crypto.randomUUID());
  }, [target]);

  const start = async () => {
    if (!target || working) return;
    if (code.trim().length < 6) { setFailure(t("Enter a valid authenticator or recovery code.")); return; }
    setWorking(true);
    setFailure("");
    const result = await startViewAs({
      workspaceId, target, code: code.trim(), idempotencyKey: key,
      returnPath: `${window.location.pathname}${window.location.search}`,
      fallback: t("The view could not be started."),
    }).catch(() => ({ ok: false as const, message: t("The view could not be started.") }));
    if (result.ok) { window.location.assign("/workspace"); return; }
    setWorking(false);
    setFailure(translateKnown(t, result.message));
  };

  const title = target?.kind === "role" ? t("Preview as {role}", { role: target.name }) : t("View as {name}", { name: target?.name ?? "" });
  return <FormDialog
    description={target?.kind === "role" ? t("Read-only for {minutes} minutes.", { minutes: 15 }) : t("Read-only for {minutes} minutes.", { minutes: 30 })}
    hideSubmit={!mfaEnabled}
    isSubmitting={working}
    isOpen={Boolean(target)}
    onClose={onClose}
    onSubmit={() => start()}
    submitLabel={t("Start viewing")}
    title={title}
  >
    {failure ? <Callout title={t("Could not continue")} tone="danger">{failure}</Callout> : null}
    {mfaEnabled
      ? <TextInput autoComplete="one-time-code" autoFocus isRequired label={t("Authenticator or recovery code")} onChange={(value) => { setCode(value); setFailure(""); }} placeholder={t("Six digits or a recovery code")} value={code} />
      : <Callout title={t("Turn on two-step verification first")} tone="warning"><Link href="/workspace/settings/security">{t("Open Security")}</Link></Callout>}
  </FormDialog>;
}
