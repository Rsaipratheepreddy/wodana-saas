"use client";
/* eslint-disable @next/next/no-img-element */

import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { useState, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, File, FileImage, FileText, Folder, History, Stamp } from "lucide-react";
import { Button } from "../components/actions";
import { Badge } from "../components/status";
import { Tabs } from "../components/navigation";

export type DocumentRecord = { id: string; name: string; kind: "folder" | "image" | "pdf" | "file"; url?: string; updatedAt: string; size?: string; version?: number; status?: "draft" | "review" | "approved" };
const fileIcons = { folder: Folder, image: FileImage, pdf: FileText, file: File };
const documentStatusLabels = { draft: tKey("Draft"), review: tKey("In review"), approved: tKey("Approved") } as const;

export function FileBrowser({ items, onOpen }: { items: DocumentRecord[]; onOpen?: (item: DocumentRecord) => void }) {
  const t = useT();
  return <ul className="wd-file-browser">{items.map((item) => { const Icon = fileIcons[item.kind]; return <li key={item.id}><button onClick={() => onOpen?.(item)} type="button"><Icon aria-hidden="true" size={17} /><span><strong>{item.name}</strong><small>{item.updatedAt}{item.size ? ` · ${item.size}` : ""}</small></span>{item.status ? <Badge tone={item.status === "approved" ? "success" : item.status === "review" ? "warning" : "neutral"}>{t(documentStatusLabels[item.status])}</Badge> : null}<ChevronRight aria-hidden="true" data-directional="true" size={14} /></button></li>; })}</ul>;
}

export function DocumentViewer({ document, metadata, onApprove, versions = [] }: { document: DocumentRecord; metadata?: ReactNode; onApprove?: () => void; versions?: DocumentRecord[] }) {
  const t = useT();
  const [tab, setTab] = useState("preview");
  return <div className="wd-document-viewer"><header><div><strong>{document.name}</strong><small>{t("Version {number}", { number: document.version ?? 1 })} · {document.updatedAt}</small></div><div>{document.status ? <Badge tone={document.status === "approved" ? "success" : "warning"}>{t(documentStatusLabels[document.status])}</Badge> : null}{onApprove ? <Button onPress={onApprove} size="compact" variant="primary"><Stamp size={14} />{t("Approve")}</Button> : null}</div></header><Tabs onSelectionChange={setTab} selectedKey={tab} items={[{ id: "preview", label: t("Preview"), panel: <div className="wd-document-preview">{document.kind === "image" && document.url ? <img alt={document.name} src={document.url} /> : document.url ? <iframe src={document.url} title={document.name} /> : <FileText size={30} />}</div> }, { id: "details", label: t("Details"), panel: <div className="wd-document-metadata">{metadata ?? t("No additional metadata")}</div> }, { id: "versions", label: t("Versions ({count})", { count: versions.length }), panel: <VersionHistory currentId={document.id} versions={versions} /> }]} /></div>;
}

export function VersionHistory({ currentId, versions }: { currentId: string; versions: DocumentRecord[] }) {
  const t = useT(); return <ol className="wd-version-history">{versions.map((version) => <li key={version.id}><History size={14} /><span><strong>{t("Version {number}", { number: version.version ?? 1 })}</strong><small>{version.updatedAt}</small></span>{version.id === currentId ? <Badge tone="info">{t("Current")}</Badge> : null}</li>)}</ol>; }

export function ApprovalStamp({ approvedBy, date }: { approvedBy: string; date: string }) {
  const t = useT(); return <span className="wd-approval-stamp"><CheckCircle2 size={17} /><span><strong>{t("Approved")}</strong><small>{approvedBy} · {date}</small></span></span>; }
