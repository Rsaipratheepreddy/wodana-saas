"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { DesignSystemProvider } from "@/design-system";
import { RefreshCw } from "lucide-react";
import workspaceColors from "@/components/crm/crm-workspace-colors.module.css";
import { Button } from "./controls";
import type { HrmsBootstrap } from "@wodana/contracts";
import type { HrmsSection } from "@/lib/hrms/navigation";
import { useHrms, Notice, Empty } from "./shared";
import { ProjectAttendancePanel } from "./project-attendance";
import { MyAttendance } from "./my-attendance";
import { AttendanceHistoryPanel } from "./time-summary";
import { LeavePanel } from "./leave-panel";
import { PeoplePanel, CalendarPanel, LeaveSettings } from "./settings-panel";
import { WorkplacesPanel } from "./workplaces-panel";
import styles from "./hrms.module.css";
function subscribeAppearance(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "dir", "lang"],
  });
  return () => observer.disconnect();
}
function appearanceSnapshot() {
  const root = document.documentElement;
  return `${root.dataset.theme ?? "light"}|${root.dir || "ltr"}`;
}
export function HrmsWorkspace({
  workspaceId,
  section = "attendance",
}: {
  workspaceId: string;
  section?: HrmsSection;
}) {
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    appearanceSnapshot,
    () => "light|ltr",
  );
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [revision, setRevision] = useState(0),
    {
      data: boot,
      error,
      loading,
    } = useHrms<HrmsBootstrap>(workspaceId, "bootstrap", revision),
    refresh = () => setRevision((v) => v + 1);
  const props = boot ? { workspaceId, boot, revision, onSaved: refresh } : null;
  const admin = ["people", "settings", "workplaces", "leave-settings"].includes(
      section,
    ),
    denied =
      boot &&
      ((admin && !boot.permissions.manage) ||
        (section === "team" && !boot.permissions.team));
  return (
    <DesignSystemProvider
      ref={setPortal}
      portalContainer={portal}
      theme={appearance.startsWith("dark") ? "dark" : "light"}
      direction={appearance.endsWith("rtl") ? "rtl" : "ltr"}
      className={`${workspaceColors.theme} ${styles.provider}`}
    >
      <section className={styles.page} aria-labelledby="hrms-title">
        <header className={styles.header}>
          <div>
            <h1 id="hrms-title">HRMS</h1>
            <p>People, attendance and time away.</p>
          </div>
          <Button variant="secondary" onClick={refresh}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </Button>
        </header>
        {loading && !boot ? (
          <Notice>Loading your attendance workspace…</Notice>
        ) : null}
        {error ? <Notice error>{error}</Notice> : null}
        {boot && props ? (
          denied ? (
            <Empty title="This view needs HRMS access">
              Ask your administrator for the appropriate role.
            </Empty>
          ) : (
            <>
              {!boot.settings &&
              boot.permissions.manage &&
              section === "attendance" ? (
                <Notice>
                  <Link href="/workspace/hrms/settings">
                    Set up your work calendar
                  </Link>{" "}
                  to enable employee attendance.
                </Notice>
              ) : null}
              {section === "attendance" ? (
                <MyAttendance {...props} />
              ) : section === "leave" ? (
                <LeavePanel {...props} />
              ) : section === "time-summary" ? (
                <AttendanceHistoryPanel {...props} />
              ) : section === "site-attendance" ? (
                <ProjectAttendancePanel {...props} />
              ) : section === "team" ? (
                <AttendanceHistoryPanel {...props} team />
              ) : section === "people" ? (
                <PeoplePanel {...props} />
              ) : section === "workplaces" ? (
                <WorkplacesPanel {...props} />
              ) : section === "leave-settings" ? (
                <LeaveSettings {...props} />
              ) : (
                <CalendarPanel {...props} />
              )}
            </>
          )
        ) : null}
      </section>
    </DesignSystemProvider>
  );
}
