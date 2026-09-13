"use client";

import { useEffect } from "react";

// Server authorization ends immediately. Check open tabs so an idle device also leaves the workspace.
export function SessionMonitor() {
  useEffect(() => {
    let stopped = false;
    let checking = false;
    const check = async () => {
      if (stopped || checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!stopped && response.status === 401) {
          stopped = true;
          window.location.replace(`/login?reason=session-ended&next=${encodeURIComponent(window.location.pathname)}`);
        } else if (!stopped && response.status === 409) {
          // Let the existing page proxy rotate an expired access token once for this browser.
          stopped = true;
          window.location.reload();
        }
      } catch {
        // A temporary network failure is not a logout.
      } finally {
        checking = false;
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 10_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return null;
}
