"use client";

import { LogOut, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell, Avatar, DesignSystemProvider, IconButton, ModuleNavigation, ToastProvider, useToast, type ModuleNavigationItem } from "@/design-system";
import type { OperatorPermission } from "@/lib/internal/auth";
import { salesApi } from "@/lib/internal/sales";
import { useLanguage, useT } from "@/lib/i18n/i18n-provider";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import { OperatorNotifications } from "./operator-notifications";
import { NEW_ENQUIRIES_EVENT } from "./sales-labels";
import styles from "./control-plane.module.css";

export type ConsoleOperator = { name: string; email: string; role: string; permissions: OperatorPermission[] };

/**
 * Wodana Control's frame. Operators work across tenants, so dates follow the operator's own language and
 * time zone, never a tenant's region.
 */
export function OperatorShell({ operator, children }: { operator: ConsoleOperator; children: ReactNode }) {
  const t = useT();
  const { language, direction } = useLanguage();
  const { theme, toggleTheme } = useWorkspaceTheme();
  const [timeZone, setTimeZone] = useState<string | undefined>(undefined);
  useEffect(() => {
    queueMicrotask(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, []);
  return <DesignSystemProvider locale={language} direction={direction} timeZone={timeZone}>
    <ToastProvider>
      <AppShell title={<Link className={styles.brand} href="/internal">{t("Wodana Control")}</Link>}
        topNavigation={<ShellNavigation canReadSales={operator.permissions.includes("sales.read")}
          canManagePlatform={operator.permissions.includes("platform.integrations.manage")} />}
        topActions={<ShellActions operator={operator} theme={theme} onToggleTheme={toggleTheme} />}>
        {children}
      </AppShell>
    </ToastProvider>
  </DesignSystemProvider>;
}

/** The portal's modules; the count on Sales enquiries is how many enquiries nobody has picked up yet. */
function ShellNavigation({ canReadSales, canManagePlatform }: { canReadSales: boolean; canManagePlatform: boolean }) {
  const t = useT();
  const pathname = usePathname() ?? "";
  const [newEnquiries, setNewEnquiries] = useState(0);
  useEffect(() => {
    if (!canReadSales) return;
    let live = true;
    salesApi.enquiries().then((list) => { if (live) setNewEnquiries(list.counts.new ?? 0); }).catch(() => undefined);
    const announced = (event: Event) => { if (live) setNewEnquiries((event as CustomEvent<number>).detail ?? 0); };
    window.addEventListener(NEW_ENQUIRIES_EVENT, announced);
    return () => { live = false; window.removeEventListener(NEW_ENQUIRIES_EVENT, announced); };
  }, [canReadSales]);
  const items: ModuleNavigationItem[] = [
    { id: "accounts", href: "/internal", label: t("Accounts") },
    { id: "ai-credits", href: "/internal/ai-credits", label: t("AI credits") },
    ...(canReadSales ? [
      { id: "sales", href: "/internal/sales-enquiries", label: t("Sales enquiries"), ...(newEnquiries > 0 ? { count: newEnquiries } : {}) },
      { id: "form", href: "/internal/contact-form", label: t("Contact form") },
    ] : []),
    ...(canManagePlatform ? [{ id: "platform", href: "/internal/platform-connections", label: t("Platform connections") }] : []),
  ];
  const activeId = pathname.startsWith("/internal/sales-enquiries") ? "sales" : pathname.startsWith("/internal/contact-form") ? "form"
    : pathname.startsWith("/internal/ai-credits") ? "ai-credits" : pathname.startsWith("/internal/platform-connections") ? "platform" : "accounts";
  return <ModuleNavigation activeId={activeId} items={items} />;
}

function ShellActions({ operator, theme, onToggleTheme }: { operator: ConsoleOperator; theme: string; onToggleTheme: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  return <div className={styles.shellActions}>
    <OperatorNotifications />
    <span className={styles.operator}><Avatar name={operator.name} size="sm" /><span><strong>{operator.name}</strong><small>{operator.email}</small></span></span>
    <IconButton aria-label={theme === "dark" ? t("Use light mode") : t("Use dark mode")} onPress={onToggleTheme}>
      {theme === "dark" ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
    </IconButton>
    <IconButton aria-label={t("Sign out")} onPress={() => {
      void fetch("/api/internal/auth/logout", { method: "POST" })
        .then((response) => { if (!response.ok) throw new Error(); router.replace("/internal/sign-in"); })
        .catch(() => toast.push({ title: t("Sign out failed"), message: t("Try again."), tone: "danger" }));
    }}><LogOut aria-hidden="true" data-directional="true" size={16} /></IconButton>
  </div>;
}
