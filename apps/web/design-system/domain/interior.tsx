"use client";

/* eslint-disable @next/next/no-img-element */
import { CheckCircle2, Flag, Image as ImageIcon, Package, Ruler, Sparkles, Wrench } from "lucide-react";
import { Button } from "../components/actions";
import { Avatar } from "../components/avatar";
import { Badge, Progress } from "../components/status";
import { StageTracker } from "../patterns/workflow";

export type InteriorProjectStage = "brief" | "design" | "boq" | "payment" | "technical" | "production" | "installation" | "snagging" | "handover";
const stages: Array<[InteriorProjectStage, string]> = [["brief", "Client brief"], ["design", "Design approval"], ["boq", "BOQ approval"], ["payment", "Payment"], ["technical", "Technical drawings"], ["production", "Production"], ["installation", "Installation"], ["snagging", "Snagging"], ["handover", "Handover"]];
export function InteriorProjectFlow({ blocked, current }: { blocked?: InteriorProjectStage; current: InteriorProjectStage }) { const currentIndex = stages.findIndex(([id]) => id === current); return <StageTracker stages={stages.map(([id, label], index) => ({ id, label, state: blocked === id ? "blocked" : index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming" }))} />; }

export type SpaceRecord = { id: string; name: string; requirements: number; measurements: number; designStatus: "not-started" | "review" | "approved"; owner?: string };
export function SpaceList({ onOpen, spaces }: { onOpen?: (space: SpaceRecord) => void; spaces: SpaceRecord[] }) { return <div className="wd-space-list"><header><span>Space</span><span>Requirements</span><span>Measurements</span><span>Design</span><span>Owner</span></header>{spaces.map((space) => <button key={space.id} onClick={() => onOpen?.(space)} type="button"><strong>{space.name}</strong><span>{space.requirements}</span><span>{space.measurements}</span><Badge tone={space.designStatus === "approved" ? "success" : space.designStatus === "review" ? "warning" : "neutral"}>{space.designStatus}</Badge><span>{space.owner ? <Avatar name={space.owner} size="sm" /> : "—"}</span></button>)}</div>; }

export type MaterialSelection = { id: string; material: string; category: string; space: string; imageUrl?: string; status: "proposed" | "sampled" | "approved" | "rejected" };
export function MaterialSelections({ items, onSelect }: { items: MaterialSelection[]; onSelect?: (item: MaterialSelection) => void }) { return <div className="wd-material-selections">{items.map((item) => <button key={item.id} onClick={() => onSelect?.(item)} type="button"><span>{item.imageUrl ? <img alt="" src={item.imageUrl} /> : <ImageIcon aria-hidden="true" size={20} />}</span><div><strong>{item.material}</strong><small>{item.category} · {item.space}</small></div><Badge tone={item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : item.status === "sampled" ? "info" : "neutral"}>{item.status}</Badge></button>)}</div>; }

export type ProductionItem = { id: string; item: string; vendor: string; progress: number; due: string; status: "queued" | "in-production" | "quality-check" | "ready" };
export function ProductionTracker({ items, onUpdate }: { items: ProductionItem[]; onUpdate?: (item: ProductionItem) => void }) { return <div className="wd-production-tracker"><header><span>Item</span><span>Vendor</span><span>Progress</span><span>Due</span><span>Status</span></header>{items.map((item) => <button key={item.id} onClick={() => onUpdate?.(item)} type="button"><span><Package size={15} /><strong>{item.item}</strong></span><span>{item.vendor}</span><span><Progress label={`${item.item} production`} value={item.progress} /><small>{item.progress}%</small></span><span>{item.due}</span><Badge tone={item.status === "ready" ? "success" : item.status === "quality-check" ? "warning" : "info"}>{item.status}</Badge></button>)}</div>; }

export type SnagItem = { id: string; area: string; issue: string; assignee?: string; status: "open" | "fixed" | "verified"; due?: string };
export function SnagList({ items, onOpen }: { items: SnagItem[]; onOpen?: (item: SnagItem) => void }) { return <div className="wd-snag-list">{items.map((item) => <button key={item.id} onClick={() => onOpen?.(item)} type="button">{item.status === "verified" ? <CheckCircle2 size={15} /> : item.status === "fixed" ? <Wrench size={15} /> : <Flag size={15} />}<span><strong>{item.issue}</strong><small>{item.area}{item.due ? ` · Due ${item.due}` : ""}</small></span>{item.assignee ? <Avatar name={item.assignee} size="sm" /> : null}<Badge tone={item.status === "verified" ? "success" : item.status === "fixed" ? "info" : "warning"}>{item.status}</Badge></button>)}</div>; }

export function MeasurementSummary({ depth, height, label, unit = "mm", width }: { depth: number; height: number; label: string; unit?: string; width: number }) { return <div className="wd-measurement-summary"><Ruler size={16} /><span><strong>{label}</strong><small>W {width} · H {height} · D {depth} {unit}</small></span></div>; }

export function HandoverChecklist({ complete, total, onOpen }: { complete: number; total: number; onOpen?: () => void }) { return <div className="wd-handover"><Sparkles size={18} /><div><strong>Handover readiness</strong><span><Progress label="Handover readiness" max={total} value={complete} />{complete}/{total} complete</span></div><Button onPress={onOpen}>Review handover</Button></div>; }
