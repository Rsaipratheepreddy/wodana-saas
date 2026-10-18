"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { useState } from "react";
import { Check, Download, MessageCircle, Send, X } from "lucide-react";
import { Button } from "../components/actions";
import { MoneyInput, QuantityInput, TextAreaField } from "../components/forms";
import { Badge } from "../components/status";

export type PortalApproval = { id: string; title: string; description: string; requestedAt: string; status: "pending" | "approved" | "changes-requested"; kind: "design" | "boq" | "drawing" | "variation" };
const approvalKindLabels = { design: tKey("Design"), boq: tKey("BOQ"), drawing: tKey("Drawing"), variation: tKey("Variation") } as const;
const approvalStatusLabels = { pending: tKey("Pending"), approved: tKey("Approved"), "changes-requested": tKey("Changes requested") } as const;
export function ApprovalInbox({ items, onOpen }: { items: PortalApproval[]; onOpen?: (item: PortalApproval) => void }) { const t = useT(); return <div className="wd-portal-inbox">{items.map((item) => <button key={item.id} onClick={() => onOpen?.(item)} type="button"><span><strong>{item.title}</strong><small>{item.description}</small></span><Badge>{t(approvalKindLabels[item.kind])}</Badge><time>{item.requestedAt}</time><Badge tone={item.status === "approved" ? "success" : item.status === "changes-requested" ? "danger" : "warning"}>{t(approvalStatusLabels[item.status])}</Badge></button>)}</div>; }

export function ApprovalDecision({ onApprove, onRequestChanges, title }: { onApprove?: () => void; onRequestChanges?: (comment: string) => void; title: string }) {
  const t = useT(); const [comment, setComment] = useState(""); return <div className="wd-portal-decision"><strong>{title}</strong><TextAreaField aria-label={t("Approval comment")} label={t("Comment")} onChange={setComment} placeholder={t("Optional approval note or describe the required changes")} value={comment} /><footer><Button onPress={() => onRequestChanges?.(comment)}><X size={14} />{t("Request changes")}</Button><Button onPress={onApprove} variant="primary"><Check size={14} />{t("Approve")}</Button></footer></div>; }

export type VendorQuoteLine = { id: string; item: string; requested: number; unit: string; rate?: number; available?: number; note?: string };
export function VendorQuotationResponse({ currency, lines, onSubmit }: { currency: string; lines: VendorQuoteLine[]; onSubmit?: (lines: VendorQuoteLine[]) => void }) {
  const t = useT(); const [draft, setDraft] = useState(lines); return <div className="wd-vendor-quote"><table className="wd-domain-table"><thead><tr><th>{t("Material / item")}</th><th>{t("Requested")}</th><th>{t("Available")}</th><th>{t("Unit rate")}</th><th>{t("Note")}</th></tr></thead><tbody>{draft.map((line) => <tr key={line.id}><td><strong>{line.item}</strong></td><td>{line.requested} {line.unit}</td><td><QuantityInput aria-label={t("Available quantity for {item}", { item: line.item })} label={<span className="wd-visually-hidden">{t("Available")}</span>} onChange={(value) => setDraft((items) => items.map((item) => item.id === line.id ? { ...item, available: value } : item))} unit={line.unit} value={line.available} /></td><td><MoneyInput aria-label={t("Rate for {item}", { item: line.item })} currency={currency} label={<span className="wd-visually-hidden">{t("Rate")}</span>} onChange={(value) => setDraft((items) => items.map((item) => item.id === line.id ? { ...item, rate: value } : item))} value={line.rate} /></td><td><TextAreaField aria-label={t("Note for {item}", { item: line.item })} label={<span className="wd-visually-hidden">{t("Note")}</span>} onChange={(value) => setDraft((items) => items.map((item) => item.id === line.id ? { ...item, note: value } : item))} value={line.note} /></td></tr>)}</tbody></table><footer><span>{t("All prices exclude tax unless stated otherwise.")}</span><Button onPress={() => onSubmit?.(draft)} variant="primary"><Send size={14} />{t("Submit quotation")}</Button></footer></div>; }

export function PortalDocumentRow({ name, onDownload, status }: { name: string; onDownload?: () => void; status?: string }) {
  const t = useT(); return <div className="wd-portal-document"><span><strong>{name}</strong>{status ? <Badge>{status}</Badge> : null}</span><Button onPress={onDownload} size="compact"><Download size={13} />{t("Download")}</Button></div>; }

export function ClarificationThread({ count, onOpen }: { count: number; onOpen?: () => void }) {
  const t = useT(); return <Button onPress={onOpen}><MessageCircle size={14} />{count === 1 ? t("1 clarification") : t("{count} clarifications", { count })}</Button>; }
