"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { HrmsBootstrap } from "@wodana/contracts";
import { Badge, Button, SkeletonBlock } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { hrmsApi } from "@/lib/hrms/api";
import { CheckInDialog, useAttendance, type CaptureKind } from "@/components/hrms/check-in";
import { useHrmsFormat } from "@/components/hrms/hrms-format";
import { DayStatus, useHrmsLabels } from "@/components/hrms/hrms-labels";
import s from "./workspace.module.css";

/**
 * Today's attendance as a small chip in the person menu (UX-013): in or out, where and since when, and check in or out
 * from there. Nothing shows for someone attendance isn't on for; the days themselves are on People.
 *
 * In the menu the chip renders into `slot` (the open menu), while the capture dialog stays here, outside the menu, so
 * closing the menu (`onCapture`) never closes the capture.
 */
export function MyAttendance({ workspaceId, slot, onCapture }: { workspaceId: string; slot?: HTMLElement | null; onCapture?: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const api = useMemo(() => hrmsApi(workspaceId), [workspaceId]);
  const [boot, setBoot] = useState<HrmsBootstrap | null>(null);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState<CaptureKind | null>(null);
  const load = useCallback(async () => {
    try { setBoot(await api.bootstrap()); setError(""); } catch (cause) { setError(format.failure(cause, t("Attendance didn't load."))); }
  }, [api, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const attendance = useAttendance(api, workspaceId, boot);
  const employee = boot?.employee?.enabled ? boot.employee : null;
  const active = attendance.current?.segments.find((segment) => !segment.endedAt) ?? null;
  const ready = Boolean(employee) && attendance.current !== undefined && attendance.storage === "ready" && !attendance.busy;
  const failure = error || attendance.error;
  const place = (chip: ReactNode) => (slot === undefined ? chip : slot ? createPortal(chip, slot) : null);

  let chip: ReactNode = null;
  if (failure) chip = <span className={s.attendance} role="group" aria-label={t("My attendance")}>
    <Badge tone="danger">{failure}</Badge><Button size="compact" variant="quiet" onPress={() => void load()}>{t("Try again")}</Button>
  </span>;
  else if (boot && !employee) chip = null;
  else if (!employee || (attendance.current === undefined && !attendance.pending && attendance.storage !== "unavailable")) {
    chip = <span className={s.attendance} role="status" aria-label={t("Loading")}><SkeletonBlock width={6} height={1.375} shape="pill" /></span>;
  } else {
    const since = attendance.checkedIn && active
      ? [active.context.location?.name ?? labels.mode(active.mode), t("since {time}", { time: format.time(active.startedAt, employee.calendar.timezone) })].join(" · ")
      : "";
    chip = <span className={s.attendance} role="group" aria-label={t("My attendance")}>
      {attendance.pending ? <><Badge tone="warning">{t("A capture is waiting to be sent.")}</Badge><Link href="/workspace/hrms">{t("Open attendance")}</Link></>
        : attendance.storage === "unavailable" ? <Badge tone="warning">{t("This browser can't keep captures.")}</Badge>
          : <>
            <DayStatus state={attendance.checkedIn ? "checked_in" : "not_checked_in"} />
            {since ? <small>{since}</small> : null}
            <Button size="compact" isDisabled={!ready} onPress={() => { onCapture?.(); setCapturing(attendance.checkedIn ? "check_out" : "check_in"); }}>
              {attendance.checkedIn ? t("Check out") : t("Check in")}
            </Button>
          </>}
    </span>;
  }
  return <>
    {chip ? place(chip) : null}
    {capturing && employee ? <CheckInDialog api={api} employee={employee} kind={capturing} attendance={attendance} onClose={() => setCapturing(null)} /> : null}
  </>;
}
