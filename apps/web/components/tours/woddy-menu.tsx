"use client";

import { CircleHelp } from "lucide-react";
import { useRef, type Key } from "react";
import { Button as AriaButton, Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover } from "react-aria-components";
import { Woddy, useDesignSystem, usePortalThemeAttributes } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { useTours } from "./tour-provider";
import { WalkthroughCallout } from "./walkthrough-callout";

type WoddyMenuProps = {
  /** Opens the Woddy chat, when this workspace has it. */
  onChat?: () => void;
  className?: string;
  avatarClassName?: string;
  labelClassName?: string;
  /** §0.3 P11: a plain Help button (no assistant face, no first-visit pop-up): AI lives inside each step, as one-click suggestions. */
  plain?: boolean;
};

/**
 * The top-bar Woddy button. On desktop and tablet it opens a menu: explain this screen (on a screen with a tour), the tours with their
 * length, and the chat; the first time someone arrives it also highlights the full walkthrough. On a phone
 * there are no tours, so it opens the chat directly.
 */
export function WoddyMenu({ onChat, className, avatarClassName, labelClassName, plain = false }: WoddyMenuProps) {
  const t = useT();
  const tours = useTours();
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const button = useRef<HTMLButtonElement>(null);
  const face = plain ? <CircleHelp aria-hidden="true" size={18} />
    : <><Woddy className={avatarClassName} decorative motion="idle" pose="idle" size={34} /><span className={labelClassName}>{t("Ask Woddy")}</span></>;
  const name = plain ? t("Help") : t("Ask Woddy");
  if (!tours?.available) return onChat ? <AriaButton aria-haspopup="dialog" aria-label={name} className={className} onPress={onChat}>{face}</AriaButton> : null;
  const onAction = (key: Key) => {
    const id = String(key);
    if (id === "chat") onChat?.();
    else if (id === "explain" && tours.current) tours.start(tours.current.id);
    else if (id.startsWith("tour:")) tours.start(id.slice(5));
  };
  return <>
    <MenuTrigger>
      <AriaButton aria-label={name} className={className} data-tour="woddy-menu" ref={button}>{face}</AriaButton>
      <Popover {...portalTheme} className="wd-popover" dir={direction} placement="bottom end">
        <Menu aria-label={name} className="wd-menu wd-tour-menu" onAction={onAction}>
          {/* Only on a screen that has its own tour: a greyed-out choice is noise. */}
          {tours.current ? <MenuItem className="wd-menu-item" id="explain">{t("Explain this screen")}</MenuItem> : null}
          {onChat ? <MenuItem className="wd-menu-item" id="chat">{t("Ask a question")}</MenuItem> : null}
          <MenuSection className="wd-tour-menu-section">
            <Header className="wd-tour-menu-heading">{t("Tours")}</Header>
            {tours.tours.map((tour) => <MenuItem className="wd-menu-item wd-tour-menu-item" id={`tour:${tour.id}`} key={tour.id} textValue={t(tour.title)}>
              <span>{t(tour.title)}</span>
              <small>{t("{count} min", { count: tours.minutes(tour) })}</small>
            </MenuItem>)}
          </MenuSection>
        </Menu>
      </Popover>
    </MenuTrigger>
    {plain ? null : <WalkthroughCallout triggerRef={button} />}
  </>;
}
