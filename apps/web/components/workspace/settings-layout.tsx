"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BellRing, Building2, CreditCard, FileText, Globe, History, KeyRound, Landmark, Languages, Palette, Plug, ShieldCheck, UserRound, Users, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { SelectField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkspaceModuleDefinition } from "./workspace-navigation";
import styles from "./settings-layout.module.css";

const ICONS: Record<string, LucideIcon> = {
  profile: UserRound, security: ShieldCheck, company: Building2, "workspace-language": Languages, members: Users, roles: KeyRound,
  "business-records": Landmark, billing: CreditCard, "audit-log": History, integrations: Plug, "client-portal-settings": Globe, "design-packages": Palette, "reminder-settings": BellRing,
};

/**
 * Settings: one grouped list on the inline-start side and the page beside it.
 * The list comes from the module navigation, already scoped to the person's access.
 */
export function SettingsLayout({ module, pathname, children }: { module: WorkspaceModuleDefinition; pathname: string; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const labels: Record<string, string> = {
    "workspace-me": t("Account"), "workspace-company": t("Company"), "workspace-people": t("Team & access"), "workspace-account": t("Records & billing"), "workspace-connections": t("Connections"),
    profile: t("Profile"), security: t("Sign-in security"), company: t("Company profile"), "workspace-language": t("Workspace language"), members: t("People"), roles: t("Roles & permissions"),
    "business-records": t("Business records"), billing: t("Billing"), "audit-log": t("Audit history"), integrations: t("Integrations"), "client-portal-settings": t("Client portal"), "design-packages": t("Design packages"), "reminder-settings": t("Reminders"),
  };
  const groups = module.navigation
    .map((group) => ({ ...group, items: group.items.filter((item) => item.showInSidebar !== false) }))
    .filter((group) => group.items.length);
  const items = groups.flatMap((group) => group.items);
  const active = [...items].sort((a, b) => b.href.length - a.href.length).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const label = (id: string, fallback: string) => labels[id] ?? fallback;

  return <div className={styles.layout}>
    <nav aria-label={t("Settings")} className={styles.nav}><div className={styles.navInner}>
      <p className={styles.title}>{t("Settings")}</p>
      {groups.map((group) => <section aria-label={label(group.id ?? "", group.label ?? "")} className={styles.group} key={group.id}>
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
