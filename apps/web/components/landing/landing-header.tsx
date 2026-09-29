"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { WodanaLogo } from "@/components/brand";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./landing.module.css";

/** The top bar: logo, a few anchors, Sign in and the one primary action. A hairline appears once the page scrolls. */
export function LandingHeader({ onLanding = true }: { onLanding?: boolean }) {
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  // On /contact-sales the anchors lead back to the landing page's sections.
  const base = onLanding ? "" : "/";
  const anchors = [
    { href: `${base}#product`, label: t("Product") },
    { href: `${base}#mobile`, label: t("Mobile app") },
    { href: `${base}#fit`, label: t("Who it's for") },
  ];
  return <header className={styles.header} data-scrolled={scrolled || open || undefined}>
    <div className={styles.headerInner}>
      <Link aria-label={t("Wodana home")} className={styles.brand} href="/"><WodanaLogo /></Link>
      <nav aria-label={t("Main")} className={styles.anchors}>
        {anchors.map((anchor) => <a href={anchor.href} key={anchor.href}>{anchor.label}</a>)}
      </nav>
      <div className={styles.headerActions}>
        <Link className={styles.signIn} href="/login">{t("Sign in")}</Link>
        <a className={styles.pillPrimary} data-size="small" href="#contact">{t("Contact sales")}</a>
        <button aria-controls="landing-menu" aria-expanded={open} aria-label={open ? t("Close menu") : t("Open menu")}
          className={styles.menuButton} onClick={() => setOpen((value) => !value)} type="button">
          {open ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
        </button>
      </div>
    </div>
    {open ? <nav aria-label={t("Menu")} className={styles.menu} id="landing-menu">
      {anchors.map((anchor) => <a href={anchor.href} key={anchor.href} onClick={() => setOpen(false)}>{anchor.label}</a>)}
      <Link href="/login" onClick={() => setOpen(false)}>{t("Sign in")}</Link>
    </nav> : null}
  </header>;
}
