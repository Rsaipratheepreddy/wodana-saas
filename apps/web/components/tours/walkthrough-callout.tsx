"use client";

import { useEffect, useState, type RefObject } from "react";
import { Popover } from "react-aria-components";
import { Button, Woddy, useDesignSystem, usePortalThemeAttributes } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { useTours } from "./tour-provider";

/** Remembered once the person has seen the highlight (started the walkthrough, chose "Not now" or closed it). */
export const WALKTHROUGH_KEY = "wodana.walkthroughHighlighted";
/** The walkthrough the highlight starts. */
export const WALKTHROUGH_TOUR = "full-journey";

export function walkthroughKey(userId: string) {
  return userId ? `${WALKTHROUGH_KEY}:${userId}` : WALKTHROUGH_KEY;
}

function highlighted(userId: string) {
  // Storage blocked: nothing can be remembered, so the highlight isn't shown at all rather than on every visit.
  try { return window.localStorage.getItem(walkthroughKey(userId)) === "true"; } catch { return true; }
}

function remember(userId: string) {
  try { window.localStorage.setItem(walkthroughKey(userId), "true"); } catch { /* Nothing to remember on this device. */ }
}

/** How long the page settles before the highlight appears, so it never flashes during loading. */
const SETTLE_MS = 700;

/**
 * The first time someone lands in the workspace (desktop and tablet), a calm callout on the Ask Woddy button
 * offers the full walkthrough: one click starts it. It shows once per person and device.
 */
export function WalkthroughCallout({ triggerRef }: { triggerRef: RefObject<HTMLElement | null> }) {
  const t = useT();
  const tours = useTours();
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const [open, setOpen] = useState(false);
  const userId = tours?.userId ?? "";
  const available = Boolean(tours?.available);
  const active = Boolean(tours?.active);
  useEffect(() => {
    if (!available || active || highlighted(userId)) return;
    const timer = window.setTimeout(() => setOpen(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [available, active, userId]);
  // Never over a running tour, and never on a phone.
  if (!open || !tours || !available || active) return null;
  const dismiss = () => { remember(userId); setOpen(false); };
  const start = () => { remember(userId); setOpen(false); tours.start(WALKTHROUGH_TOUR); };
  return <Popover {...portalTheme} className="wd-popover wd-walkthrough" dir={direction} isNonModal isOpen offset={10} onOpenChange={(next) => { if (!next) dismiss(); }}
    placement="bottom end" triggerRef={triggerRef}>
    <section aria-label={t("Woddy")} className="wd-walkthrough-body" data-tour="walkthrough-callout">
      <Woddy className="wd-walkthrough-woddy" decorative pose="hello" size={48} />
      <div className="wd-walkthrough-copy">
        <p className="wd-walkthrough-text">{t("Here's Woddy. He'll walk you through Wodana.")}</p>
        <div className="wd-walkthrough-actions">
          <Button size="compact" variant="quiet" onPress={dismiss}>{t("Not now")}</Button>
          <Button size="compact" variant="primary" onPress={start}>{t("Start the walkthrough")}</Button>
        </div>
      </div>
    </section>
  </Popover>;
}
