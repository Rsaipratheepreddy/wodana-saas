"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FileText, RefreshCw } from "lucide-react";
import {
  commercialPath,
  jsonRequest,
  money,
  paymentIsVerified,
  statusLabel,
} from "@/lib/commercial/client";
import type { CommercialState } from "@/lib/commercial/types";
import { PaymentInvoice } from "../commercial/payment-invoice";
import s from "./project-workspace.module.css";
import f from "./project-flow.module.css";
export function ProjectAccounting({
  workspaceId,
  caseId,
}: {
  workspaceId: string;
  caseId: string;
}) {
  const [state, setState] = useState<CommercialState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const path = commercialPath(workspaceId, `cases/${caseId}`);
  useEffect(() => {
    let active = true;
    jsonRequest<CommercialState>(path)
      .then((s) => {
        if (active) setState(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path]);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setState(await jsonRequest<CommercialState>(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function run(action: string, body: Record<string, unknown>) {
    if (action !== "invoice") return false;
    setBusy(true);
    setError("");
    try {
      await jsonRequest(
        commercialPath(workspaceId, `cases/${caseId}/invoice`),
        "POST",
        body,
      );
      setState(await jsonRequest<CommercialState>(path));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={f.flowWorkspace}>
      <div className={f.flowIntro}>
        <FileText size={22} />
        <div>
          <h2>Client payments & accounting</h2>
          <p>
            The accepted quotation’s milestones, linked to invoices in
            QuickBooks or Zoho Books.
          </p>
        </div>
        <button
          className={s.button}
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
        <Link className={s.button} href="/workspace/integrations">
          Connections <ArrowUpRight size={14} />
        </Link>
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {!state && !error && (
        <p role="status">Loading the connected payment schedule…</p>
      )}
      {state && (
        <>
          {state.data.payments.length ? (
            <div className={f.jobGrid}>
              {state.data.payments.map((payment) => (
                <article key={payment.id} className={f.jobCard}>
                  <header>
                    <strong>{payment.title}</strong>
                    <span
                      className={s.status}
                      data-state={
                        paymentIsVerified(payment) ? "approved" : "planned"
                      }
                    >
                      {paymentIsVerified(payment)
                        ? "Verified paid"
                        : (statusLabel[payment.status] ?? payment.status)}
                    </span>
                  </header>
                  <div className={f.orderFacts}>
                    <div>
                      <small>Milestone amount</small>
                      <strong>{money(payment.amount, state.currency)}</strong>
                    </div>
                    <div>
                      <small>Due condition</small>
                      <strong>{payment.trigger || "See agreement"}</strong>
                    </div>
                  </div>
                  <PaymentInvoice
                    workspaceId={workspaceId}
                    payment={payment}
                    busy={busy}
                    canVerifyFinance={state.canVerifyFinance}
                    run={run}
                    currency={state.currency}
                    customerName={state.customerName}
                  />
                </article>
              ))}
            </div>
          ) : (
            <div className={s.empty}>
              <FileText size={28} />
              <h2>No client payment milestones yet</h2>
              <p>
                Review the accepted quotation’s payment schedule in Agreement &
                payments.
              </p>
              <Link
                className={s.primary}
                href={`/workspace/pre-projects/cases/${caseId}/contracts`}
              >
                Open agreement & payments <ArrowUpRight size={14} />
              </Link>
            </div>
          )}
          <Link
            className={s.link}
            href={`/workspace/pre-projects/cases/${caseId}/contracts`}
          >
            Agreement, client receipt evidence & payment history{" "}
            <ArrowUpRight size={14} />
          </Link>
        </>
      )}
    </div>
  );
}
