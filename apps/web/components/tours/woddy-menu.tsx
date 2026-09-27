"use client";

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
};

/**
 * The top-bar Woddy button. On desktop and tablet it opens a menu: explain this screen, the tours with their
 * length, and the chat; the first time someone arrives it also highlights the full walkthrough. On a phone
 * there are no tours, so it opens the chat directly.
 */
export function WoddyMenu({ onChat, className, avatarClassName, labelClassName }: WoddyMenuProps) {
  const t = useT();
  const tours = useTours();
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const button = useRef<HTMLButtonElement>(null);
  const face = <><Woddy className={avatarClassName} decorative motion="idle" pose="idle" size={34} /><span className={labelClassName}>{t("Ask Woddy")}</span></>;
  if (!tours?.available) return <AriaButton aria-haspopup="dialog" aria-label={t("Ask Woddy")} className={className} onPress={onChat}>{face}</AriaButton>;
  const onAction = (key: Key) => {
    const id = String(key);
    if (id === "chat") onChat?.();
    else if (id === "explain" && tours.current) tours.start(tours.current.id);
    else if (id.startsWith("tour:")) tours.start(id.slice(5));
  };
  return <>
    <MenuTrigger>
      <AriaButton aria-label={t("Ask Woddy")} className={className} data-tour="woddy-menu" ref={button}>{face}</AriaButton>
      <Popover {...portalTheme} className="wd-popover" dir={direction} placement="bottom end">
        <Menu aria-label={t("Ask Woddy")} className="wd-menu wd-tour-menu" onAction={onAction}>
          <MenuItem className="wd-menu-item" id="explain" isDisabled={!tours.current}>{t("Explain this screen")}</MenuItem>
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
    <WalkthroughCallout triggerRef={button} />
  </>;
}
