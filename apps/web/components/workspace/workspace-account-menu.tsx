"use client";

import { ListChecks, LogOut, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Avatar, ControlledModalDialog, DesignSystemProvider, useDesignSystem } from "@/design-system";
import { LanguageSelect } from "@/components/i18n/language-select";
import { useT } from "@/lib/i18n/i18n-provider";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import type { WorkspaceUser } from "./workspace-navigation";
import { useWorkspaceSetupSteps, WorkspaceSetupChecklist, type ReadinessData } from "./workspace-readiness";
import styles from "./workspace.module.css";

/** Given only to people who can set the workspace up; the menu then shows setup progress around the avatar. */
export type WorkspaceSetupSource = { workspaceId: string; modules: string[] };

export function WorkspaceAccountMenu({ user, setup }: { user: WorkspaceUser; setup?: WorkspaceSetupSource }) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [readiness, setReadiness] = useState<ReadinessData | undefined>();
  const [readinessReload, setReadinessReload] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const t = useT();
  const { direction: _direction, ...inherited } = useDesignSystem();
  const { theme } = useWorkspaceTheme();
  const { completed, total } = useWorkspaceSetupSteps(readiness, setup?.modules ?? []);
  // Progress shows once it is known; nothing to do once every step is done.
  const pending = Boolean(setup && readiness) && completed < total;
  const workspaceId = setup?.workspaceId;

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    fetch(`/api/workspace/setup-readiness?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => (response.ok ? await response.json() as ReadinessData : null))
      .then((data) => { if (data && !controller.signal.aborted) setReadiness(data); })
      .catch(() => {});
    return () => controller.abort();
  }, [workspaceId, readinessReload]);

  const signOut = async (close: () => void) => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSignOutError("");
    const response = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setSignOutError(t("Unable to sign out this device. Please try again."));
      setIsSigningOut(false);
      return;
    }
    close();
    router.replace("/login");
    router.refresh();
  };

  const menuLabel = t("Account menu for {name}", { name: user.name });
  return (
    <div className={styles.accountMenu}>
      <DialogTrigger onOpenChange={(open) => { if (open && workspaceId) setReadinessReload((value) => value + 1); }}>
        <AriaButton
          aria-label={pending ? `${menuLabel}. ${t("Setup {completed} of {total} done", { completed, total })}` : menuLabel}
          className={styles.accountButton}
          data-setup={pending || undefined}
        >
          <span aria-hidden="true" className={styles.avatar}><Avatar name={user.name} preset={user.avatarPreset} seed={user.id} src={user.avatarUrl} /></span>
          {pending ? <span aria-hidden="true" className={styles.setupRing}>
            <svg viewBox="0 0 36 36"><circle className={styles.setupTrack} cx="18" cy="18" r="16.5" /><circle className={styles.setupValue} cx="18" cy="18" r="16.5" pathLength="100" strokeDasharray={`${Math.round((completed / total) * 100)} 100`} /></svg>
            <i className={styles.setupDot} />
          </span> : null}
        </AriaButton>
        <Popover className={styles.userPopover} offset={8} placement="bottom end">
          <Dialog aria-label={t("Account menu")} className={styles.accountDialog}>
            {({ close }) => (
              <>
                <div className={styles.accountSummary}>
                  <span aria-hidden="true" className={styles.avatar}><Avatar name={user.name} preset={user.avatarPreset} seed={user.id} src={user.avatarUrl} /></span>
                  <span>
                    <strong>{user.name}</strong>
                    <small dir="ltr">{user.email}</small>
                  </span>
                </div>
                {pending ? <button className={`${styles.accountAction} ${styles.setupItem}`} onClick={() => { close(); setSetupOpen(true); }} type="button">
                  <ListChecks aria-hidden="true" size={16} /> {t("Set up your workspace")}{" · "}<small>{t("{completed} of {total}", { completed, total })}</small>
                </button> : null}
                <Link href="/workspace/settings/profile" onClick={close}>
                  <UserRound aria-hidden="true" size={16} /> {t("Profile")}
                </Link>
                <Link href="/workspace/settings/security" onClick={close}>
                  <ShieldCheck aria-hidden="true" size={16} /> {t("Sign-in security")}
                </Link>
                <LanguageSelect className={styles.accountLanguage} compact label={null} />
                <button
                  className={styles.accountAction}
                  disabled={isSigningOut}
                  onClick={() => void signOut(close)}
                  type="button"
                >
                  <LogOut aria-hidden="true" size={16} /> {isSigningOut ? t("Signing out…") : t("Sign out")}
                </button>
                {signOutError ? <p className={styles.accountError} role="alert">{signOutError}</p> : null}
              </>
            )}
          </Dialog>
        </Popover>
      </DialogTrigger>
      {setup ? <DesignSystemProvider {...inherited} className={styles.setupDialogHost} theme={inherited.theme === "high-contrast" ? inherited.theme : theme === "dark" ? "dark" : "light"}>
        <ControlledModalDialog isOpen={setupOpen} onOpenChange={setSetupOpen} title={t("Set up your workspace")} description={t("{completed} of {total} complete", { completed, total })} size="lg">
          <WorkspaceSetupChecklist modules={setup.modules} readiness={readiness} />
        </ControlledModalDialog>
      </DesignSystemProvider> : null}
    </div>
  );
}
