import type { ReactNode } from "react";

/**
 * Settings pages, Notion style: one small title, then quiet sections of
 * rows with the label and hint on one side and the value or control on the other.
 */
export function SettingsPage({ title, actions, children, width = "narrow", "aria-label": ariaLabel }: { title: ReactNode; actions?: ReactNode; children: ReactNode; width?: "narrow" | "wide"; "aria-label"?: string }) {
  return <section aria-label={ariaLabel} className="wd-settings-page" data-width={width}>
    <header className="wd-settings-page-header"><h1>{title}</h1>{actions ? <div className="wd-settings-actions">{actions}</div> : null}</header>
    {children}
  </section>;
}

export function SettingsSection({ id, title, actions, children }: { id?: string; title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const headingId = id ? `${id}-heading` : undefined;
  return <section aria-labelledby={headingId} className="wd-settings-section" id={id}>
    <header><h2 id={headingId}>{title}</h2>{actions ? <div className="wd-settings-actions">{actions}</div> : null}</header>
    <div className="wd-settings-rows">{children}</div>
  </section>;
}

export function SettingsRow({ label, hint, children, align = "center" }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; align?: "center" | "start" }) {
  return <div className="wd-settings-row" data-align={align}>
    <div className="wd-settings-label"><span>{label}</span>{hint ? <small>{hint}</small> : null}</div>
    <div className="wd-settings-value">{children}</div>
  </div>;
}
