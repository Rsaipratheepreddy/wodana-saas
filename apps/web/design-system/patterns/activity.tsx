"use client";

import { Bell, Check, Clock3, Eye, History, Link2, MessageCircle, UserPlus } from "lucide-react";
import { Button, IconButton } from "../components/actions";
import { Avatar, AvatarGroup } from "../components/avatar";
import { Badge, type StatusTone } from "../components/status";

export type ActivityItem = {
  id: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
  occurredAt: string;
  kind?: "comment" | "approval" | "change" | "assignment";
  meta?: string[];
  status?: { label: string; tone?: StatusTone };
};
const activityIcons = { comment: MessageCircle, approval: Check, change: History, assignment: UserPlus };
export function ActivityFeed({ items }: { items: ActivityItem[] }) { return <ol className="wd-activity-feed">{items.map((item) => { const Icon = activityIcons[item.kind ?? "change"]; return <li key={item.id}><span><Icon size={14} /></span><div><div className="wd-activity-heading"><p><strong>{item.actor}</strong> {item.action} {item.target ? <b>{item.target}</b> : null}</p>{item.status ? <Badge tone={item.status.tone}>{item.status.label}</Badge> : null}</div>{item.detail ? <p className="wd-activity-detail">{item.detail}</p> : null}<div className="wd-activity-meta"><time>{item.occurredAt}</time>{item.meta?.map((value) => <span key={value}>{value}</span>)}</div></div></li>; })}</ol>; }

export type AuditEntry = ActivityItem & { ip?: string; metadata?: string };
export function AuditHistory({ items }: { items: AuditEntry[] }) { return <table className="wd-domain-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Context</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.occurredAt}</td><td>{item.actor}</td><td>{item.action}</td><td>{item.target ?? "—"}</td><td>{item.metadata ?? item.ip ?? "—"}</td></tr>)}</tbody></table>; }

export type NotificationItem = { id: string; title: string; description: string; occurredAt: string; read: boolean; href?: string };
export function NotificationInbox({ items, onRead }: { items: NotificationItem[]; onRead?: (item: NotificationItem) => void }) { return <div className="wd-notification-inbox"><header><Bell size={15} /><strong>Notifications</strong><Badge tone="info">{items.filter((item) => !item.read).length} unread</Badge></header>{items.map((item) => <a data-read={item.read || undefined} href={item.href} key={item.id} onClick={() => onRead?.(item)}><span /><div><strong>{item.title}</strong><p>{item.description}</p><time>{item.occurredAt}</time></div></a>)}</div>; }

export function Watchers({ people, onManage }: { people: string[]; onManage?: () => void }) { return <div className="wd-watchers"><span><Eye size={14} />Watching</span><AvatarGroup>{people.map((person) => <Avatar key={person} name={person} size="sm" />)}</AvatarGroup><IconButton aria-label="Manage watchers" onPress={onManage} size="compact"><UserPlus size={14} /></IconButton></div>; }

export function SharingControls({ access = "workspace", onCopy, onInvite }: { access?: "private" | "workspace" | "public-link"; onCopy?: () => void; onInvite?: () => void }) { return <div className="wd-sharing"><div><strong>Share this record</strong><small>{access === "private" ? "Only invited people" : access === "workspace" ? "Everyone in this workspace" : "Anyone with the link"}</small></div><Button onPress={onInvite}>Invite</Button><Button onPress={onCopy}><Link2 size={14} />Copy link</Button></div>; }

export function PresenceBar({ people, updatedAt }: { people: string[]; updatedAt?: string }) { return <div className="wd-presence-bar"><AvatarGroup>{people.map((person) => <Avatar key={person} name={person} size="sm" />)}</AvatarGroup><span>{people.length} viewing</span>{updatedAt ? <span><Clock3 size={13} />Updated {updatedAt}</span> : null}</div>; }
