"use client";

import { createContext, useCallback, useContext, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { Button, IconButton } from "./actions";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export function Badge({ children, className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  return <span {...props} className={["wd-badge", className].filter(Boolean).join(" ")} data-tone={tone}>{children}</span>;
}

export function Tag({ children, onRemove, tone = "neutral" }: { children: ReactNode; onRemove?: () => void; tone?: StatusTone }) {
  return <span className="wd-tag" data-tone={tone}>{children}{onRemove ? <IconButton aria-label={`Remove ${String(children)}`} onPress={onRemove}><X size={13} /></IconButton> : null}</span>;
}

const icons = { neutral: Info, info: Info, success: CheckCircle2, warning: TriangleAlert, danger: AlertCircle };

export function Callout({ actions, children, title, tone = "info" }: { actions?: ReactNode; children: ReactNode; title: string; tone?: StatusTone }) {
  const Icon = icons[tone];
  return <div className="wd-callout" data-tone={tone} role={tone === "danger" ? "alert" : "status"}><Icon aria-hidden="true" size={18} /><div><strong>{title}</strong><div>{children}</div></div>{actions ? <div className="wd-callout-actions">{actions}</div> : null}</div>;
}

export function EmptyState({ action, description, icon, title }: { action?: ReactNode; description: ReactNode; icon?: ReactNode; title: string }) {
  return <div className="wd-empty-state">{icon ? <div className="wd-empty-icon">{icon}</div> : null}<strong>{title}</strong><p>{description}</p>{action}</div>;
}

export function Progress({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return <div className="wd-progress" role="progressbar" aria-label={label} aria-valuemax={max} aria-valuemin={0} aria-valuenow={value}><span style={{ inlineSize: `${percent}%` }} /></div>;
}

export function Spinner({ label = "Loading" }: { label?: string }) { return <LoaderCircle aria-label={label} className="wd-spin" role="status" size={18} />; }
export function Skeleton({ lines = 1 }: { lines?: number }) { return <div aria-hidden="true" className="wd-skeleton-stack">{Array.from({ length: lines }, (_, index) => <span className="wd-skeleton" key={index} />)}</div>; }

type ToastRecord = { id: number; message: string; tone: StatusTone; title: string };
type ToastApi = { push: (toast: Omit<ToastRecord, "id">) => void };
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const push = useCallback((toast: Omit<ToastRecord, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return <ToastContext.Provider value={value}>{children}<div aria-live="polite" className="wd-toast-region">{toasts.map((toast) => <div className="wd-toast" data-tone={toast.tone} key={toast.id}><strong>{toast.title}</strong><span>{toast.message}</span><IconButton aria-label="Dismiss notification" onPress={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X size={14} /></IconButton></div>)}</div></ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

export function ErrorState({ onRetry, title = "Something went wrong" }: { onRetry?: () => void; title?: string }) { return <EmptyState action={onRetry ? <Button onPress={onRetry}>Try again</Button> : null} description="The requested data could not be loaded." icon={<AlertCircle size={20} />} title={title} />; }
export function OfflineState() { return <Callout title="You are offline" tone="warning">Changes will resume syncing when the connection returns.</Callout>; }
