"use client";

import type { CSSProperties } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import { useTours } from "./tour-provider";

/** In the header while a tour runs: whose view the demo is showing ("Viewing as Finance"). Presentation only. */
export function TourPersonaBadge() {
  const t = useT();
  const view = useTours()?.personaView;
  if (!view) return null;
  return <span aria-live="polite" className="wd-tour-persona-badge" data-tour="tour-persona" role="status" style={{ "--wd-tour-actor": view.color } as CSSProperties}>
    {/* eslint-disable-next-line @next/next/no-img-element -- static brand avatar from /public */}
    <img alt="" decoding="async" draggable={false} height={24} src={view.avatar} width={24} />
    <span className="wd-tour-persona-label">{t("Viewing as {role}", { role: view.label })}</span>
  </span>;
}
