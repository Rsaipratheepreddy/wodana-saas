"use client";
/* eslint-disable @next/next/no-img-element */

import { useState, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, File, FileImage, FileText, Folder, History, Stamp } from "lucide-react";
import { Button } from "../components/actions";
import { Badge } from "../components/status";
import { Tabs } from "../components/navigation";

export type DocumentRecord = { id: string; name: string; kind: "folder" | "image" | "pdf" | "file"; url?: string; updatedAt: string; size?: string; version?: number; status?: "draft" | "review" | "approved" };
const fileIcons = { folder: Folder, image: FileImage, pdf: FileText, file: File };

export function FileBrowser({ items, onOpen }: { items: DocumentRecord[]; onOpen?: (item: DocumentRecord) => void }) {
  return <ul className="wd-file-browser">{items.map((item) => { const Icon = fileIcons[item.kind]; return <li key={item.id}><button onClick={() => onOpen?.(item)} type="button"><Icon aria-hidden="true" size={17} /><span><strong>{item.name}</strong><small>{item.updatedAt}{item.size ? ` · ${item.size}` : ""}</small></span>{item.status ? <Badge tone={item.status === "approved" ? "success" : item.status === "review" ? "warning" : "neutral"}>{item.status}</Badge> : null}<ChevronRight aria-hidden="true" data-directional="true" size={14} /></button></li>; })}</ul>;
}

export function DocumentViewer({ document, metadata, onApprove, versions = [] }: { document: DocumentRecord; metadata?: ReactNode; onApprove?: () => void; versions?: DocumentRecord[] }) {
  const [tab, setTab] = useState("preview");
  return <div className="wd-document-viewer"><header><div><strong>{document.name}</strong><small>Version {document.version ?? 1} · {document.updatedAt}</small></div><div>{document.status ? <Badge tone={document.status === "approved" ? "success" : "warning"}>{document.status}</Badge> : null}{onApprove ? <Button onPress={onApprove} size="compact" variant="primary"><Stamp size={14} />Approve</Button> : null}</div></header><Tabs onSelectionChange={setTab} selectedKey={tab} items={[{ id: "preview", label: "Preview", panel: <div className="wd-document-preview">{document.kind === "image" && document.url ? <img alt={document.name} src={document.url} /> : document.url ? <iframe src={document.url} title={document.name} /> : <FileText size={30} />}</div> }, { id: "details", label: "Details", panel: <div className="wd-document-metadata">{metadata ?? "No additional metadata"}</div> }, { id: "versions", label: `Versions (${versions.length})`, panel: <VersionHistory currentId={document.id} versions={versions} /> }]} /></div>;
}

export function VersionHistory({ currentId, versions }: { currentId: string; versions: DocumentRecord[] }) { return <ol className="wd-version-history">{versions.map((version) => <li key={version.id}><History size={14} /><span><strong>Version {version.version}</strong><small>{version.updatedAt}</small></span>{version.id === currentId ? <Badge tone="info">Current</Badge> : null}</li>)}</ol>; }

export function ApprovalStamp({ approvedBy, date }: { approvedBy: string; date: string }) { return <span className="wd-approval-stamp"><CheckCircle2 size={17} /><span><strong>Approved</strong><small>{approvedBy} · {date}</small></span></span>; }
