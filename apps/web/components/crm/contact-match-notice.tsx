"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { findContactMatches, type ClientMatch } from "@/lib/crm/client-match";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./crm-workbench.module.css";

const EMAIL = /^\S+@\S+\.\S+$/;

/**
 * While a phone or email is typed on a create form: who already has it (the server's own duplicate check),
 * right under the field. It warns; it doesn't block the save.
 */
export function ContactMatchNotice({ workspaceId, phone, email }: { workspaceId: string; phone?: string; email?: string }) {
  const t = useT();
  const mobile = phone && /^\+\d{7,15}$/.test(phone.replace(/[\s()-]/g, "")) ? phone.replace(/[\s()-]/g, "") : "";
  const address = email && EMAIL.test(email.trim()) ? email.trim() : "";
  const key = mobile || address ? JSON.stringify({ mobile, address }) : "";
  const [found, setFound] = useState<{ key: string; matches: ClientMatch[] }>({ key: "", matches: [] });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      findContactMatches(workspaceId, { mobile: mobile || undefined, email: address || undefined }, controller.signal)
        .then((result) => setFound({ key, matches: Array.isArray(result?.matches) ? result.matches : [] }))
        .catch(() => { if (!controller.signal.aborted) setFound({ key, matches: [] }); });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, workspaceId, mobile, address]);
  const matches = found.key === key ? found.matches : [];
  if (!key || !matches.length) return null;
  return <div aria-live="polite" className={styles.matchNotice} role="status">
    <CircleAlert aria-hidden="true" size={14} />
    <span>{matches.length === 1 ? t("Already a client:") : t("Already clients:")}{" "}
      {matches.slice(0, 3).map((match, index) => <span key={match.partyId}>{index ? ", " : ""}<Link href={`/workspace/crm/customers?record=${match.partyId}`}>{match.name}</Link></span>)}
    </span>
  </div>;
}
