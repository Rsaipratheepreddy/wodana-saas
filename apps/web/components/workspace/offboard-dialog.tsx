"use client";

import { useEffect, useState } from "react";
import { Button, Callout, FormDialog, InlineNotice, SelectField, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import styles from "./members-page.module.css";

type Counts = Record<"enquiries" | "opportunities" | "followUps" | "chats" | "clients" | "planning" | "tasks" | "projects", number>;
type Preview = { member: { id: string; name: string; status: string; version: number }; counts: Counts; successors: Array<{ id: string; name: string }> };

/** What each area is called in the list of what moves. */
const AREAS: Array<[keyof Counts, MessageKey]> = [
  ["enquiries", tKey("Enquiries")], ["opportunities", tKey("Opportunities")], ["followUps", tKey("Follow-ups")], ["chats", tKey("Chats")],
  ["clients", tKey("Clients")], ["planning", tKey("Planning cases")], ["tasks", tKey("Project tasks")], ["projects", tKey("Projects")],
];

/**
 * Offboarding a person (SP-4): everything they hold, by module; one successor takes it all over; then they are
 * signed out of their phones and suspended, which frees the seat. Audited on the server.
 */
export function OffboardDialog({ workspaceId, membershipId, name, onClose, onDone }: {
  workspaceId: string; membershipId: string; name: string; onClose: () => void; onDone: (message: string) => void;
}) {
  const t = useT();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [successor, setSuccessor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/workspace/members/${membershipId}/offboarding?${new URLSearchParams({ workspaceId })}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : t("Could not load what this person holds."));
        if (alive) { setPreview(data as Preview); setError(""); }
      })
      .catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId, membershipId, attempt, t]);

  /** Hands everything over; a refusal keeps the dialog open with the server's reason. */
  const offboard = async () => {
    if (!preview || !successor) return;
    const response = await fetch(`/api/workspace/members/${membershipId}/offboarding`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, successorMembershipId: successor, version: preview.member.version }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : t("Could not offboard this person."));
    const taker = preview.successors.find((person) => person.id === successor)?.name ?? "";
    onDone(t("{name} is offboarded. {successor} has their work.", { name, successor: taker }));
  };

  const moving = preview ? AREAS.filter(([key]) => preview.counts[key] > 0) : [];
  return <FormDialog title={t("Offboard {name}", { name })} onClose={onClose} onSubmit={offboard} submitLabel={t("Offboard")} submitVariant="danger"
    isDirty={Boolean(successor)} isSubmitDisabled={!preview || !successor}
    lead={<>
      {!preview && !error ? <Skeleton lines={4} /> : null}
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {error && !preview ? <Button size="compact" onPress={() => setAttempt((value) => value + 1)}>{t("Retry")}</Button> : null}
    </>}>
    {preview ? <div className={styles.offboard}>
      {moving.length ? <ul className={styles.offboardCounts} aria-label={t("What moves")}>{moving.map(([key, label]) => <li key={key}><strong>{preview.counts[key]}</strong> {t(label)}</li>)}</ul>
        : <p>{t("Nothing is open in their name.")}</p>}
      {preview.successors.length ? <SelectField label={t("Who takes over")} isRequired placeholder={t("Choose someone")} selectedKey={successor}
        onSelectionChange={(key) => setSuccessor(key ? String(key) : null)} items={preview.successors.map((person) => ({ id: person.id, label: person.name }))} />
        : <InlineNotice tone="error" message={t("Nobody else is active to take over.")} />}
      <Callout title={t("Then they lose access")} tone="warning">{t("Their phones stop getting notices, they are signed out, and their seat is freed. Their records stay.")}</Callout>
    </div> : null}
  </FormDialog>;
}
