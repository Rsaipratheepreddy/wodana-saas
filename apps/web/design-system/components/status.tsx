"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { Illustration, type IllustrationName } from "./illustration";
import { createContext, useCallback, useContext, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, LoaderCircle, Lock, TriangleAlert, X } from "lucide-react";
import { Button, IconButton } from "./actions";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export function Badge({ children, className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  return <span {...props} className={["wd-badge", className].filter(Boolean).join(" ")} data-tone={tone}>{children}</span>;
}

/** A colour for a key the firm can recolour (an enquiry type's dot): the same key always gets the same hue. */
export type TypeHue = 1 | 2 | 3 | 4 | 5 | 6;
export function typeHue(key: string): TypeHue {
  let hash = 0;
  for (const char of key.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ((hash % 6) + 1) as TypeHue;
}
/**
 * A record's type or category ("Warranty claim", "Plywood") as a neutral chip (UX-008): colour is for states (late,
 * at risk, done), so a category never looks like an alert.
 */
export function TypeChip({ children }: { children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return <span className="wd-badge wd-type-chip" data-tone="neutral">{children}</span>;
}

export function Tag({ children, onRemove, tone = "neutral" }: { children: ReactNode; onRemove?: () => void; tone?: StatusTone }) {
  const t = useT();
  return <span className="wd-tag" data-tone={tone}>{children}{onRemove ? <IconButton aria-label={t("Remove {name}", { name: String(children) })} onPress={onRemove}><X size={13} /></IconButton> : null}</span>;
}

const icons = { neutral: Info, info: Info, success: CheckCircle2, warning: TriangleAlert, danger: AlertCircle };

export function Callout({ actions, children, title, tone = "info" }: { actions?: ReactNode; children: ReactNode; title: string; tone?: StatusTone }) {
  const Icon = icons[tone];
  return <div className="wd-callout" data-tone={tone} role={tone === "danger" ? "alert" : "status"}><Icon aria-hidden="true" size={18} /><div><strong>{title}</strong><div>{children}</div></div>{actions ? <div className="wd-callout-actions">{actions}</div> : null}</div>;
}

/** Compact feedback for form submission and service states. */
export function InlineNotice({ className, message, title, tone = "info" }: { className?: string; message: ReactNode; title?: string; tone?: "error" | "info" | "success" }) {
  const Icon = tone === "error" ? AlertCircle : tone === "success" ? CheckCircle2 : Info;
  return <div aria-atomic="true" aria-live={tone === "error" ? "assertive" : "polite"} className={["wd-inline-notice", className].filter(Boolean).join(" ")} data-tone={tone} data-visible="true" role={tone === "error" ? "alert" : "status"}>
    <Icon aria-hidden="true" size={16} />
    <span>{title ? <strong>{title}</strong> : null}<span>{message}</span></span>
  </div>;
}

/** Empty, no-results, locked or done states: an illustration, a short title, one line and the next action. */
export function EmptyState({ action, description, icon, illustration = "empty", title }: { action?: ReactNode; description?: ReactNode; icon?: ReactNode; illustration?: IllustrationName | null; title: string }) {
  return <div className="wd-empty-state">{icon ? <div className="wd-empty-icon">{icon}</div> : illustration ? <Illustration name={illustration} /> : null}<strong>{title}</strong>{description ? <p>{description}</p> : null}{action}</div>;
}

export function Progress({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return <div className="wd-progress" role="progressbar" aria-label={label} aria-valuemax={max} aria-valuemin={0} aria-valuenow={value}><span style={{ inlineSize: `${percent}%` }} /></div>;
}

export function Spinner({ label }: { label?: string }) { const t = useT(); return <LoaderCircle aria-label={label ?? t("Loading")} className="wd-spin" role="status" size={18} />; }

type ToastRecord = { id: number; message: string; tone: StatusTone; title: string };
type ToastApi = { push: (toast: Omit<ToastRecord, "id">) => void };
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const push = useCallback((toast: Omit<ToastRecord, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return <ToastContext.Provider value={value}>{children}<div aria-live="polite" className="wd-toast-region">{toasts.map((toast) => <div className="wd-toast" data-tone={toast.tone} key={toast.id}><strong>{toast.title}</strong><span>{toast.message}</span><IconButton aria-label={t("Dismiss notification")} onPress={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X size={14} /></IconButton></div>)}</div></ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

export function ErrorState({ onRetry, title, description }: { onRetry?: () => void; title?: string; description?: ReactNode }) {
  const t = useT();
  return <EmptyState action={onRetry ? <Button onPress={onRetry}>{t("Try again")}</Button> : null} description={description ?? t("This could not be loaded. Check your connection and try again.")} illustration="error" title={title ?? t("Something went wrong")} />;
}
export function NoResultsState({ onClear }: { onClear?: () => void }) {
  const t = useT();
  return <EmptyState action={onClear ? <Button onPress={onClear} variant="quiet">{t("Clear filters")}</Button> : null} description={t("Try a different word or clear the filters.")} illustration="search" title={t("No matches")} />;
}
/** A page (or a whole tab) the person's role can't use. No Retry: asking for access is the only next step. */
export function NoAccessState({ area }: { area?: string }) {
  const t = useT();
  return <EmptyState description={t("Ask your workspace admin for access.")} illustration="locked" title={area ? t("You don't have access to {area}", { area }) : t("You don't have access to this")} />;
}

/** The inline form for one part of a page (a panel, or one of several sources), next to content the person can use. */
export function NoAccessNotice({ area, className }: { area: string; className?: string }) {
  const t = useT();
  return <div className={["wd-inline-notice", className].filter(Boolean).join(" ")} data-tone="neutral" data-visible="true" role="status">
    <Lock aria-hidden="true" size={16} />
    <span><strong>{t("You don't have access to {area}", { area })}</strong><span>{t("Ask your workspace admin for access.")}</span></span>
  </div>;
}
export function OfflineState() {
  const t = useT();
  return <Callout title={t("You are offline")} tone="warning">{t("Changes will resume syncing when the connection returns.")}</Callout>;
}
