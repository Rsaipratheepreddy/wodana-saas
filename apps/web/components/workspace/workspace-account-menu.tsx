"use client";

import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Avatar } from "@/design-system";
import { LanguageSelect } from "@/components/i18n/language-select";
import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkspaceUser } from "./workspace-navigation";
import styles from "./workspace.module.css";

export function WorkspaceAccountMenu({ user }: { user: WorkspaceUser }) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const t = useT();

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

  return (
    <div className={styles.accountMenu}>
      <DialogTrigger>
        <AriaButton
          aria-label={t("Account menu for {name}", { name: user.name })}
          className={styles.accountButton}
        >
          <span aria-hidden="true" className={styles.avatar}><Avatar name={user.name} preset={user.avatarPreset} roles={user.roles} seed={user.id} src={user.avatarUrl} /></span>
        </AriaButton>
        <Popover className={styles.userPopover} offset={8} placement="bottom end">
          <Dialog aria-label={t("Account menu")} className={styles.accountDialog}>
            {({ close }) => (
              <>
                <div className={styles.accountSummary}>
                  <span aria-hidden="true" className={styles.avatar}><Avatar name={user.name} preset={user.avatarPreset} roles={user.roles} seed={user.id} src={user.avatarUrl} /></span>
                  <span>
                    <strong>{user.name}</strong>
                    <small dir="ltr">{user.email}</small>
                  </span>
                </div>
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
    </div>
  );
}
