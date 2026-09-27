"use client";

import { useState } from "react";
import { Button, Form, InlineNotice, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import styles from "./portal.module.css";

/** The first time they sign in, the client checks the name the team has for them. */
export function ConfirmName({ api, name, onDone }: { api: PortalApi; name: string; onDone: () => void }) {
  const t = useT();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const save = async () => {
    if (value.trim().length < 2) return setError(t("Enter your name."));
    setBusy(true); setError("");
    try { await api.command(id, { action: "confirm_name", name: value.trim() }); onDone(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <section className={styles.signIn} aria-labelledby="portal-name">
    <div className={styles.intro}>
      <h1 className={styles.title} id="portal-name">{t("Is this your name?")}</h1>
      <p className={styles.lead}>{t("It's how your project team will see your decisions.")}</p>
    </div>
    <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextInput label={t("Your name")} value={value} onChange={setValue} autoComplete="name" maxLength={160} isRequired autoFocus />
      <div className={styles.formActions}><Button type="submit" variant="primary" size="large" isLoading={busy}>{t("Continue")}</Button></div>
    </Form>
  </section>;
}
