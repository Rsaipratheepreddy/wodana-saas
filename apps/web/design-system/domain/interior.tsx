"use client";

/* eslint-disable @next/next/no-img-element */
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { CheckCircle2, Flag, Image as ImageIcon, Package, Ruler, Sparkles, Wrench } from "lucide-react";
import { Button } from "../components/actions";
import { Avatar } from "../components/avatar";
import { Badge, Progress } from "../components/status";
import { StageTracker } from "../patterns/workflow";

export type InteriorProjectStage = "brief" | "design" | "boq" | "payment" | "technical" | "production" | "installation" | "snagging" | "handover";
const stages: Array<[InteriorProjectStage, string]> = [["brief", tKey("Client brief")], ["design", tKey("Design approval")], ["boq", tKey("BOQ approval")], ["payment", tKey("Payment")], ["technical", tKey("Technical drawings")], ["production", tKey("Production")], ["installation", tKey("Installation")], ["snagging", tKey("Snagging")], ["handover", tKey("Handover")]];
const designStatusLabels = { "not-started": tKey("Not started"), review: tKey("In review"), approved: tKey("Approved") } as const;
const materialStatusLabels = { proposed: tKey("Proposed"), sampled: tKey("Sampled"), approved: tKey("Approved"), rejected: tKey("Rejected") } as const;
const productionStatusLabels = { queued: tKey("Queued"), "in-production": tKey("In production"), "quality-check": tKey("Quality check"), ready: tKey("Ready") } as const;
const snagStatusLabels = { open: tKey("Open"), fixed: tKey("Fixed"), verified: tKey("Verified") } as const;
export function InteriorProjectFlow({ blocked, current }: { blocked?: InteriorProjectStage; current: InteriorProjectStage }) { const t = useT(); const currentIndex = stages.findIndex(([id]) => id === current); return <StageTracker stages={stages.map(([id, label], index) => ({ id, label: t(label as never), state: blocked === id ? "blocked" : index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming" }))} />; }

export type SpaceRecord = { id: string; name: string; requirements: number; measurements: number; designStatus: "not-started" | "review" | "approved"; owner?: string };
export function SpaceList({ onOpen, spaces }: { onOpen?: (space: SpaceRecord) => void; spaces: SpaceRecord[] }) {
  const t = useT(); return <div className="wd-space-list"><header><span>{t("Space")}</span><span>{t("Requirements")}</span><span>{t("Measurements")}</span><span>{t("Design")}</span><span>{t("Owner")}</span></header>{spaces.map((space) => <button key={space.id} onClick={() => onOpen?.(space)} type="button"><strong>{space.name}</strong><span>{space.requirements}</span><span>{space.measurements}</span><Badge tone={space.designStatus === "approved" ? "success" : space.designStatus === "review" ? "warning" : "neutral"}>{t(designStatusLabels[space.designStatus])}</Badge><span>{space.owner ? <Avatar name={space.owner} size="sm" /> : "—"}</span></button>)}</div>; }

export type MaterialSelection = { id: string; material: string; category: string; space: string; imageUrl?: string; status: "proposed" | "sampled" | "approved" | "rejected" };
export function MaterialSelections({ items, onSelect }: { items: MaterialSelection[]; onSelect?: (item: MaterialSelection) => void }) { const t = useT(); return <div className="wd-material-selections">{items.map((item) => <button key={item.id} onClick={() => onSelect?.(item)} type="button"><span>{item.imageUrl ? <img alt="" src={item.imageUrl} /> : <ImageIcon aria-hidden="true" size={20} />}</span><div><strong>{item.material}</strong><small>{item.category} · {item.space}</small></div><Badge tone={item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : item.status === "sampled" ? "info" : "neutral"}>{t(materialStatusLabels[item.status])}</Badge></button>)}</div>; }

export type ProductionItem = { id: string; item: string; vendor: string; progress: number; due: string; status: "queued" | "in-production" | "quality-check" | "ready" };
export function ProductionTracker({ items, onUpdate }: { items: ProductionItem[]; onUpdate?: (item: ProductionItem) => void }) {
  const t = useT(); return <div className="wd-production-tracker"><header><span>{t("Item")}</span><span>{t("Vendor")}</span><span>{t("Progress")}</span><span>{t("Due")}</span><span>{t("Status")}</span></header>{items.map((item) => <button key={item.id} onClick={() => onUpdate?.(item)} type="button"><span><Package size={15} /><strong>{item.item}</strong></span><span>{item.vendor}</span><span><Progress label={t("{item} production", { item: item.item })} value={item.progress} /><small>{item.progress}%</small></span><span>{item.due}</span><Badge tone={item.status === "ready" ? "success" : item.status === "quality-check" ? "warning" : "info"}>{t(productionStatusLabels[item.status])}</Badge></button>)}</div>; }

export type SnagItem = { id: string; area: string; issue: string; assignee?: string; status: "open" | "fixed" | "verified"; due?: string };
export function SnagList({ items, onOpen }: { items: SnagItem[]; onOpen?: (item: SnagItem) => void }) { const t = useT(); return <div className="wd-snag-list">{items.map((item) => <button key={item.id} onClick={() => onOpen?.(item)} type="button">{item.status === "verified" ? <CheckCircle2 size={15} /> : item.status === "fixed" ? <Wrench size={15} /> : <Flag size={15} />}<span><strong>{item.issue}</strong><small>{item.area}{item.due ? ` · ${t("Due {date}", { date: item.due })}` : ""}</small></span>{item.assignee ? <Avatar name={item.assignee} size="sm" /> : null}<Badge tone={item.status === "verified" ? "success" : item.status === "fixed" ? "info" : "warning"}>{t(snagStatusLabels[item.status])}</Badge></button>)}</div>; }

export function MeasurementSummary({ depth, height, label, unit = "mm", width }: { depth: number; height: number; label: string; unit?: string; width: number }) { const t = useT(); return <div className="wd-measurement-summary"><Ruler size={16} /><span><strong>{label}</strong><small>{t("W {width} · H {height} · D {depth} {unit}", { width, height, depth, unit })}</small></span></div>; }

export function HandoverChecklist({ complete, total, onOpen }: { complete: number; total: number; onOpen?: () => void }) {
  const t = useT(); return <div className="wd-handover"><Sparkles size={18} /><div><strong>{t("Handover readiness")}</strong><span><Progress label={t("Handover readiness")} max={total} value={complete} />{t("{complete}/{total} complete", { complete, total })}</span></div><Button onPress={onOpen}>{t("Review handover")}</Button></div>; }
