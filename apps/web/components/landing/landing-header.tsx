"use client";

import { useCallback, useEffect, useId, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { WodanaLogo } from "@/components/brand";
import { useT } from "@/lib/i18n/i18n-provider";
import { MARKETING_GROUPS, type MarketingGroup, type MarketingLink } from "./marketing-links";
import styles from "./landing-header.module.css";

type GroupId = MarketingGroup["id"];

/** Moves focus between the links of an open menu with the arrow keys, Home and End. */
function moveFocus(container: HTMLElement, key: string) {
  const links = [...container.querySelectorAll<HTMLAnchorElement>("a[href]")];
  if (!links.length) return false;
  const current = links.indexOf(document.activeElement as HTMLAnchorElement);
  const next = key === "Home" ? 0 : key === "End" ? links.length - 1
    : key === "ArrowDown" ? (current + 1) % links.length
      : key === "ArrowUp" ? (current - 1 + links.length) % links.length : -1;
  if (next < 0) return false;
  links[next]?.focus();
  return true;
}

function LinkArt({ link }: { link: MarketingLink }) {
  if (link.avatar) {
    // eslint-disable-next-line @next/next/no-img-element -- a small static brand avatar from /public
    return <img alt="" aria-hidden="true" className={styles.avatar} decoding="async" height={40} loading="lazy" src={link.avatar} width={40} />;
  }
  const Icon = link.icon;
  return Icon ? <span aria-hidden="true" className={styles.icon}><Icon size={18} strokeWidth={1.75} /></span> : null;
}

/**
 * The public site's top bar: logo, the Product, Solutions and Company menus, Sign in and Contact sales. It sticks
 * to the top and turns translucent with a hairline once the page scrolls. On a phone the menus fold into one
 * sheet. Menus open on click, on hover with a mouse, and from the keyboard (↓ opens and focuses the first link,
 * the arrows move, Esc closes and returns focus).
 */
export function LandingHeader({ onLanding = true }: { onLanding?: boolean }) {
  const t = useT();
  const baseId = useId();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState<GroupId | null>(null);
  const [sheet, setSheet] = useState(false);
  const [sheetGroup, setSheetGroup] = useState<GroupId | null>("product");
  const navRef = useRef<HTMLElement>(null);
  const sheetButton = useRef<HTMLButtonElement>(null);
  const triggers = useRef(new Map<GroupId, HTMLButtonElement>());
  const panels = useRef(new Map<GroupId, HTMLDivElement>());
  const closeTimer = useRef<number | undefined>(undefined);
  const focusFirst = useRef<GroupId | null>(null);
  const hoveredAt = useRef(0);
  const contactHref = onLanding ? "#contact" : "/contact-sales";

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const close = useCallback((focusTrigger = false) => {
    setOpen((current) => {
      if (focusTrigger && current) triggers.current.get(current)?.focus();
      return null;
    });
  }, []);

  // A click anywhere outside the menus closes them.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!navRef.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(true); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, close]);

  // The phone sheet: Esc closes it, the page behind it does not scroll, and it closes if the window widens.
  useEffect(() => {
    if (!sheet) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setSheet(false); sheetButton.current?.focus(); } };
    const wide = window.matchMedia("(min-width: 60.0625rem)");
    const widen = () => { if (wide.matches) setSheet(false); };
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    document.addEventListener("keydown", escape);
    wide.addEventListener?.("change", widen);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener("keydown", escape);
      wide.removeEventListener?.("change", widen);
    };
  }, [sheet]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const hoverOpen = (id: GroupId) => (event: ReactPointerEvent) => {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(closeTimer.current);
    if (open !== id) hoveredAt.current = event.timeStamp;
    setOpen(id);
  };
  // A click right after the pointer opened the menu keeps it open instead of closing it again.
  const toggle = (id: GroupId, event: ReactMouseEvent) => {
    const justHovered = event.timeStamp - hoveredAt.current < 400;
    setOpen((current) => current === id && !justHovered ? null : id);
  };
  const hoverClose = (event: ReactPointerEvent) => {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(null), 180);
  };

  const onTriggerKey = (id: GroupId) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    focusFirst.current = id;
    setOpen(id);
  };

  // A menu opened from the keyboard hands focus to its first link once it is shown.
  useEffect(() => {
    if (!open || focusFirst.current !== open) return;
    focusFirst.current = null;
    panels.current.get(open)?.querySelector<HTMLAnchorElement>("a[href]")?.focus();
  }, [open]);

  const onPanelKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (moveFocus(event.currentTarget, event.key)) event.preventDefault();
  };

  // Focus leaving a menu (Tab past its last link) closes it.
  const onGroupBlur = (id: GroupId) => (event: ReactFocusEvent<HTMLLIElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen((current) => current === id ? null : current);
  };

  const panelId = (id: GroupId) => `${baseId}-${id}`;

  return <header className={styles.header} data-scrolled={scrolled || sheet || undefined}>
    <div className={styles.bar}>
      <Link aria-label={t("Wodana home")} className={styles.brand} href="/"><WodanaLogo /></Link>
      <nav aria-label={t("Main")} className={styles.nav} ref={navRef}>
        <ul className={styles.groups}>
          {MARKETING_GROUPS.map((group) => {
            const expanded = open === group.id;
            return <li className={styles.group} key={group.id} onBlur={onGroupBlur(group.id)} onPointerEnter={hoverOpen(group.id)} onPointerLeave={hoverClose}>
              <button aria-controls={panelId(group.id)} aria-expanded={expanded} className={styles.trigger}
                onClick={(event) => toggle(group.id, event)} onKeyDown={onTriggerKey(group.id)}
                ref={(node) => { if (node) triggers.current.set(group.id, node); else triggers.current.delete(group.id); }} type="button">
                {t(group.label)}<ChevronDown aria-hidden="true" className={styles.chevron} size={16} />
              </button>
              <div className={styles.panel} data-group={group.id} hidden={!expanded} id={panelId(group.id)} onKeyDown={onPanelKey}
                ref={(node) => { if (node) panels.current.set(group.id, node); else panels.current.delete(group.id); }}>
                <ul className={styles.panelList}>
                  {group.links.map((link) => <li key={link.id}>
                    <a className={styles.panelLink} href={link.href} onClick={() => setOpen(null)}>
                      <LinkArt link={link} />
                      <span className={styles.panelText}>
                        <span className={styles.panelLabel}>{t(link.label)}</span>
                        <span className={styles.panelDescription}>{t(link.description)}</span>
                      </span>
                    </a>
                  </li>)}
                </ul>
                {group.id === "product" ? <div className={styles.panelFoot}>
                  {/* A plain link: on the landing page a hash change opens the section; elsewhere it loads the page. */}
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a href="/#woddy" onClick={() => setOpen(null)}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a small static brand image */}
                    <img alt="" aria-hidden="true" decoding="async" height={28} loading="lazy" src="/brand/woddy/hello.webp" width={28} />
                    {t("Woddy, your AI teammate")}<ArrowRight aria-hidden="true" size={16} />
                  </a>
                </div> : null}
              </div>
            </li>;
          })}
        </ul>
      </nav>
      <div className={styles.actions}>
        <Link className={styles.signIn} href="/login">{t("Sign in")}</Link>
        <a className={styles.cta} href={contactHref}>{t("Contact sales")}</a>
        <button aria-controls="landing-menu" aria-expanded={sheet} aria-label={sheet ? t("Close menu") : t("Open menu")}
          className={styles.menuButton} onClick={() => setSheet((value) => !value)} ref={sheetButton} type="button">
          {sheet ? <X aria-hidden="true" size={22} /> : <Menu aria-hidden="true" size={22} />}
        </button>
      </div>
    </div>
    {sheet ? <nav aria-label={t("Menu")} className={styles.sheet} id="landing-menu">
      {MARKETING_GROUPS.map((group) => {
        const expanded = sheetGroup === group.id;
        return <section className={styles.sheetGroup} key={group.id}>
          <h2 className={styles.sheetHeading}>
            <button aria-controls={`${panelId(group.id)}-sheet`} aria-expanded={expanded} className={styles.sheetTrigger}
              onClick={() => setSheetGroup(expanded ? null : group.id)} type="button">
              {t(group.label)}<ChevronDown aria-hidden="true" className={styles.chevron} size={18} />
            </button>
          </h2>
          <ul className={styles.sheetList} hidden={!expanded} id={`${panelId(group.id)}-sheet`}>
            {group.links.map((link) => <li key={link.id}>
              <a className={styles.sheetLink} href={link.href} onClick={() => setSheet(false)}>
                <LinkArt link={link} />{t(link.label)}
              </a>
            </li>)}
          </ul>
        </section>;
      })}
      <div className={styles.sheetActions}>
        <a className={styles.cta} data-size="large" href={contactHref} onClick={() => setSheet(false)}>{t("Contact sales")}</a>
        <Link className={styles.sheetSignIn} href="/login" onClick={() => setSheet(false)}>{t("Sign in")}</Link>
      </div>
    </nav> : null}
  </header>;
}
