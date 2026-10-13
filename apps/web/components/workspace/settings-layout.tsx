"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Bell, BellRing, Bot, Building2, Calculator, CalendarClock, CreditCard, Factory, FileText, FolderKanban, Globe, History, KeyRound, Landmark, Languages, MessagesSquare, Network, Palette, Plug, Send, ShieldCheck, ShoppingCart, Sparkles, Truck, UserRound, Users, Warehouse, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { SearchInput, SelectField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkspaceModuleDefinition } from "./workspace-navigation";
import styles from "./settings-layout.module.css";

const ICONS: Record<string, LucideIcon> = {
  profile: UserRound, security: ShieldCheck, company: Building2, "workspace-language": Languages, members: Users, roles: KeyRound,
  "business-records": Landmark, billing: CreditCard, "audit-log": History, integrations: Plug, "client-portal-settings": Globe, "design-packages": Palette, "reminder-settings": BellRing,
  "finish-settings": Palette, "attendance-settings": CalendarClock, teams: Network, "project-settings": FolderKanban, "purchasing-settings": ShoppingCart, "inventory-settings": Warehouse,
  "factory-settings": Factory, "fulfilment-settings": Truck, "accounting-settings": Calculator, "inbox-settings": MessagesSquare, "delivery-health": Send, "notification-settings": Bell,
  "ai-credits": Sparkles, "ai-apps": Bot,
};

/**
 * Settings: one short grouped list on the inline-start side (Account, Company, Modules, People & access,
 * Apps & delivery) with a search box on top, and the page beside it. The list comes from the module
 * navigation, already scoped to the person's access; People & access links into People.
 */
export function SettingsLayout({ module, pathname, children }: { module: WorkspaceModuleDefinition; pathname: string; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const labels: Record<string, string> = {
    "workspace-me": t("Account"), "workspace-company": t("Company"), "workspace-modules": t("Modules"), "workspace-people": t("People & access"), "workspace-connections": t("Apps & delivery"),
    profile: t("Profile"), security: t("Sign-in security"), company: t("Company profile"), "workspace-language": t("Workspace language"), members: t("People"), teams: t("Teams"), roles: t("Roles & permissions"),
    "business-records": t("Business records"), billing: t("Billing"), "audit-log": t("Audit history"), integrations: t("Connections"), "client-portal-settings": t("Client portal"), "design-packages": t("Design packages"), "reminder-settings": t("Reminders"),
    "attendance-settings": t("Attendance & leave"), "inbox-settings": t("Inbox"), "delivery-health": t("Delivery"), "notification-settings": t("Notifications"),
    "ai-credits": t("AI credits"), "ai-apps": t("AI apps"),
  };
  const [query, setQuery] = useState("");
  const label = (id: string, fallback: string) => labels[id] ?? t(fallback as never);
  const groups = module.navigation
    .map((group) => ({ ...group, items: group.items.filter((item) => item.showInSidebar !== false) }))
    .filter((group) => group.items.length);
  const items = groups.flatMap((group) => group.items);
  const active = [...items].sort((a, b) => b.href.length - a.href.length).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  // Search matches a page's name or its group's name ("modules" lists every module's settings).
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? groups.map((group) => label(group.id ?? "", group.label ?? "").toLocaleLowerCase().includes(needle)
    ? group
    : { ...group, items: group.items.filter((item) => label(item.id, item.label).toLocaleLowerCase().includes(needle)) }).filter((group) => group.items.length) : groups;

  return <div className={styles.layout}>
    <nav aria-label={t("Settings")} className={styles.nav}><div className={styles.navInner}>
      <p className={styles.title}>{t("Settings")}</p>
      <div className={styles.search}><SearchInput label={t("Search settings")} placeholder={t("Search settings")} value={query} onChange={setQuery} /></div>
      {!shown.length ? <p className={styles.noMatch} role="status">{t("No settings match")}</p> : null}
      {shown.map((group) => <section aria-label={label(group.id ?? "", group.label ?? "")} className={styles.group} key={group.id}>
        <p className={styles.groupLabel}>{label(group.id ?? "", group.label ?? "")}</p>
        <ul>{group.items.map((item) => <li key={item.id}>
          <Link aria-current={active?.id === item.id ? "page" : undefined} className={styles.link} href={item.href}>{(() => { const Icon = ICONS[item.id] ?? FileText; return <Icon aria-hidden="true" size={15} strokeWidth={1.8} />; })()}<span>{label(item.id, item.label)}</span></Link>
        </li>)}</ul>
      </section>)}
    </div></nav>
    <div className={styles.picker}>
      <SelectField accent="neutral" aria-label={t("Settings")} items={items.map((item) => ({ id: item.href, label: label(item.id, item.label) }))} label={t("Settings")} onSelectionChange={(key) => key && router.push(String(key))} selectedKey={active?.href ?? null} />
    </div>
    <div className={styles.content}>{children}</div>
  </div>;
}
