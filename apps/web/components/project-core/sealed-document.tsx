"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button, ErrorState, PillTabs, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { SealedLine, SealedScope } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import styles from "./project-core.module.css";

type View = "items" | "requests" | "payments" | "terms";
const METHOD: Record<string, string> = { signed_document: "Signed copy", email: "Email", in_person: "In person", phone: "Phone", message: "Message", portal: "Client portal" };

/**
 * A sealed document exactly as the client accepted it (the baseline or a variation): fingerprinted
 * when sealed and checked again every time it's opened. It never changes.
 */
export function SealedDocument({ workspaceId, projectId, sealId, onBack }: { workspaceId: string; projectId: string; sealId: string; onBack: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [scope, setScope] = useState<SealedScope | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("items");
  useEffect(() => {
    let alive = true;
    projectApi(workspaceId).seal(projectId, sealId).then((next) => { if (alive) setScope(next); }).catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId, projectId, sealId]);
  const groups = useMemo(() => {
    if (!scope) return [];
    const names = new Map(scope.snapshot.areas.map((area) => [area.id, area.name]));
    const byArea = new Map<string, SealedLine[]>();
    for (const line of [...scope.snapshot.lines].sort((a, b) => a.position - b.position)) byArea.set(line.areaId ?? "", [...(byArea.get(line.areaId ?? "") ?? []), line]);
    return [...byArea.entries()].map(([key, lines]) => ({ key, name: names.get(key) ?? t("General"), lines }))
      .sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.name.localeCompare(b.name)));
  }, [scope, t]);

  if (error) return <ErrorState description={error} />;
  if (!scope) return <Skeleton lines={6} shape="facts" />;
  const { snapshot } = scope;
  const money = (value: string | number) => format.money(value, snapshot.quote.currency);
  const acceptance = snapshot.acceptance;
  return <div className={styles.scope}>
    <div><Button size="compact" variant="quiet" onPress={onBack}><ArrowLeft aria-hidden="true" size={14} data-directional="true" />{t("All sealed documents")}</Button></div>
    <p className={styles.sealLine} data-intact={scope.intact || undefined}>
      {scope.intact ? <ShieldCheck aria-hidden="true" size={16} /> : <ShieldAlert aria-hidden="true" size={16} />}
      <span>{t("Sealed {revision} · accepted by {name} on {date}", { revision: snapshot.revisionLabel, name: acceptance.decidedBy, date: format.when(acceptance.decidedAt) })}
        {METHOD[acceptance.method] ? ` · ${t(METHOD[acceptance.method] as never)}` : ""}
        {snapshot.agreement ? ` · ${t("Agreement {reference}", { reference: snapshot.agreement.reference })}` : ""}</span>
      <strong>{scope.intact ? t("Unchanged") : t("Changed since it was sealed")}</strong>
    </p>
    <PillTabs ariaLabel={t("Scope")} selectedKey={view} onSelectionChange={(key) => setView(key as View)}
      items={[{ id: "items", label: t("Items") }, ...(snapshot.requirements?.length ? [{ id: "requests", label: t("Requests") }] : []), { id: "payments", label: t("Payments") }, { id: "terms", label: t("Terms") }]} />

    {view === "items" ? <table className={styles.scopeTable}>
      <thead><tr><th>{t("Item")}</th><th>{t("Qty")}</th><th>{t("Rate")}</th><th>{t("Amount")}</th></tr></thead>
      {groups.map((group) => <tbody key={group.key}>
        <tr className={styles.groupRow}><th colSpan={3} scope="rowgroup">{group.name}</th><td>{money(snapshot.pricing.areas.find((area) => area.key === (group.key || "general"))?.net ?? "0")}</td></tr>
        {group.lines.map((line) => <tr key={line.id}>
          <td><span className={styles.itemTitle}>{line.title}</span>{line.description ? <small>{line.description}</small> : null}</td>
          <td>{Number(line.quantity).toLocaleString()} {line.unit}</td>
          <td>{money(line.rate)}</td>
          <td>{money(line.net)}</td>
        </tr>)}
      </tbody>)}
      {snapshot.declinedOptions.length ? <tbody className={styles.declined}>
        <tr className={styles.groupRow}><th colSpan={4} scope="rowgroup">{t("Options the client didn't choose")}</th></tr>
        {snapshot.declinedOptions.map((line) => <tr key={line.id}><td colSpan={3}>{line.title}</td><td>{money(line.total)}</td></tr>)}
      </tbody> : null}
      <tfoot>
        <tr><th colSpan={3}>{t("Subtotal")}</th><td>{money(snapshot.pricing.subtotal)}</td></tr>
        {Number(snapshot.pricing.discounts) ? <tr><th colSpan={3}>{t("Discount")}</th><td>−{money(snapshot.pricing.discounts)}</td></tr> : null}
        {Number(snapshot.pricing.tax) ? <tr><th colSpan={3}>{t("Tax")}</th><td>{money(snapshot.pricing.tax)}</td></tr> : null}
        <tr className={styles.totalRow}><th colSpan={3}>{t("Total")}</th><td>{money(snapshot.pricing.total)}</td></tr>
      </tfoot>
    </table> : null}

    {view === "requests" && snapshot.requirements ? <div className={styles.requests}>
      {(["included", "later", "excluded", "not_possible"] as const).map((status) => {
        const items = snapshot.requirements!.filter((item) => item.status === status);
        if (!items.length) return null;
        const title = { included: t("Included"), later: t("A later phase"), excluded: t("Not included"), not_possible: t("Not possible") }[status];
        return <section key={status} aria-label={title}>
          <h3>{title} <span className={styles.muted}>{items.length}</span></h3>
          <ul>{items.map((item) => <li key={item.id}>
            <span className={styles.lineCell}><span>{item.title}{item.roomName ? <span className={styles.muted}> · {item.roomName}</span> : null}</span>
              {status === "included"
                ? item.lineIds.length ? <small>{t("Covered by {items}", { items: item.lineIds.map((id) => snapshot.lines.find((line) => line.id === id)?.title).filter(Boolean).join(", ") })}</small> : null
                : item.note ? <small>{item.note}</small> : null}</span>
            {item.source === "client" ? <span className={styles.muted}>{t("Asked by the client")}</span> : null}
          </li>)}</ul>
        </section>;
      })}
    </div> : null}

    {view === "payments" ? snapshot.paymentTerms.length ? <ol className={styles.milestones}>
      {splitByPercent(snapshot.pricing.total, snapshot.paymentTerms.map((term) => term.percent), snapshot.quote.decimals).map((amount, index) => {
        const term = snapshot.paymentTerms[index];
        return <li key={term.id}>
          <span><strong>{term.title}</strong><small>{term.trigger}</small></span>
          <span>{term.percent}%</span>
          <span>{money(amount)}</span>
        </li>;
      })}
    </ol> : <p className={styles.muted}>{t("No payment milestones.")}</p> : null}

    {view === "terms" ? <div className={styles.prose}>
      {snapshot.terms ? <><h3>{t("Terms and conditions")}</h3>{snapshot.terms.split(/\n+/).map((line, index) => <p key={index}>{line}</p>)}</> : null}
      {snapshot.exclusions ? <><h3>{t("Exclusions")}</h3>{snapshot.exclusions.split(/\n+/).map((line, index) => <p key={index}>{line}</p>)}</> : null}
      {!snapshot.terms && !snapshot.exclusions ? <p className={styles.muted}>{t("No terms or exclusions were written on this quotation.")}</p> : null}
    </div> : null}
  </div>;
}

/** Shares of a total by percent, in whole minor units; the last share takes the remainder so they always add up. */
export function splitByPercent(total: string, percents: number[], decimals: number) {
  const scale = 10 ** decimals;
  const whole = Math.round(Number(total) * scale);
  let allocated = 0;
  return percents.map((percent, index) => {
    const share = index === percents.length - 1 ? whole - allocated : Math.round((whole * percent) / 100);
    allocated += share;
    return (share / scale).toFixed(decimals);
  });
}
