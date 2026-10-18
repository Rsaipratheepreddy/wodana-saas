"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseRequest } from "@/lib/pre-project/content";
import { extraRevisionDetail, extraRevisionHref, revisionDetail, type Revisions } from "@/lib/pre-project/design-decisions";
import styles from "./design-decisions.module.css";

/**
 * PLM-049/051: a design step's revisions as chips: the free ones used ("Revision 2 of 2 used") and, beyond them, the
 * extra revision's state with its change request. When the extra revision has no live change (never drafted, or the
 * client declined it), the team drafts one here.
 */
export function RevisionChips({ revisions, workspaceId, caseId, stage, canEdit = false, onChanged }: {
  revisions: Revisions | null | undefined; workspaceId: string; caseId: string; stage: string; canEdit?: boolean; onChanged?: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const free = revisionDetail(revisions);
  const extra = extraRevisionDetail(revisions);
  if (!free && !extra) return null;
  const href = extraRevisionHref(caseId, revisions?.extra);
  const draftable = canEdit && revisions?.extra && (!revisions.extra.changeRequestId || revisions.extra.state === "declined");
  const draft = async () => {
    setBusy(true); setError("");
    try { await caseRequest(workspaceId, caseId, "design-presentations/extra-revision", "POST", { stage }); onChanged?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  return <span className={styles.inline}>
    {free ? <Badge>{t(free.key, free.values)}</Badge> : null}
    {extra ? <Badge tone={extra.tone}>{t(extra.key)}</Badge> : null}
    {href && revisions?.extra?.reference ? <Link className={styles.link} href={href}>{revisions.extra.reference}</Link> : null}
    {draftable ? <Button size="compact" variant="quiet" isLoading={busy} onPress={() => void draft()}>{revisions?.extra?.state === "declined" ? t("Draft again") : t("Draft the change request")}</Button> : null}
    {error ? <Badge role="alert" tone="danger">{error}</Badge> : null}
  </span>;
}
