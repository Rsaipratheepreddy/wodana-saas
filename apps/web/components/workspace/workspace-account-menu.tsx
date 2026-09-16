"use client";

import { Building2, CircleUserRound, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { identityInitials, identityStyle } from "@/lib/brand/identity";
import type { WorkspaceUser } from "./workspace-navigation";
import styles from "./workspace.module.css";

export function WorkspaceAccountMenu({ user }: { user: WorkspaceUser }) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const userVisual = identityStyle(user.name, user.avatarUrl);

  const signOut = async (close: () => void) => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSignOutError("");
    const response = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setSignOutError("Unable to sign out this device. Please try again.");
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
          aria-label={`Account menu for ${user.name}`}
          className={styles.accountButton}
        >
          <span
            aria-hidden="true"
            className={styles.avatar}
            data-has-image={user.avatarUrl ? true : undefined}
            style={userVisual}
          >
            {user.avatarUrl ? null : identityInitials(user.name)}
          </span>
        </AriaButton>
        <Popover className={styles.userPopover} offset={8} placement="bottom end">
          <Dialog aria-label="Account menu" className={styles.accountDialog}>
            {({ close }) => (
              <>
                <div className={styles.accountSummary}>
                  <span
                    aria-hidden="true"
                    className={styles.avatar}
                    data-has-image={user.avatarUrl ? true : undefined}
                    style={userVisual}
                  >
                    {user.avatarUrl ? null : identityInitials(user.name)}
                  </span>
                  <span>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </span>
                </div>
                <Link href="/workspace/settings" onClick={close}>
                  <CircleUserRound aria-hidden="true" size={16} /> User settings
                </Link>
                {user.platformRole === "administrator" ? (
                  <Link href="/internal" onClick={close}>
                    <Building2 aria-hidden="true" size={16} /> Internal portal
                  </Link>
                ) : null}
                <button
                  className={styles.accountAction}
                  disabled={isSigningOut}
                  onClick={() => void signOut(close)}
                  type="button"
                >
                  <LogOut aria-hidden="true" size={16} /> {isSigningOut ? "Signing out…" : "Sign out"}
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
