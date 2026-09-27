"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { HrmsBootstrap } from "@wodana/contracts";
import { Badge, Button, SkeletonBlock } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { hrmsApi } from "@/lib/hrms/api";
import { CheckInDialog, useAttendance, type CaptureKind } from "@/components/hrms/check-in";
import { useHrmsFormat } from "@/components/hrms/hrms-format";
import { DayStatus, useHrmsLabels } from "@/components/hrms/hrms-labels";
import s from "./workspace-home.module.css";

/**
 * Today's attendance as a chip in the Home header: in or out, where and since when, and check in or out
 * from here. Nothing shows for someone attendance isn't on for; the days themselves are on People.
 */
export function HomeAttendance({ workspaceId }: { workspaceId: string }) {
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

  if (failure) return <span className={s.attendance} role="group" aria-label={t("My attendance")}>
    <Badge tone="danger">{failure}</Badge><Button size="compact" variant="quiet" onPress={() => void load()}>{t("Try again")}</Button>
  </span>;
  if (boot && !employee) return null;
  if (!employee || (attendance.current === undefined && !attendance.pending && attendance.storage !== "unavailable")) {
    return <span className={s.attendance} role="status" aria-label={t("Loading")}><SkeletonBlock width={6} height={1.375} shape="pill" /></span>;
  }
  const since = attendance.checkedIn && active
    ? [active.context.location?.name ?? labels.mode(active.mode), t("since {time}", { time: format.time(active.startedAt, employee.calendar.timezone) })].join(" · ")
    : "";
  return <span className={s.attendance} role="group" aria-label={t("My attendance")}>
    {attendance.pending ? <><Badge tone="warning">{t("A capture is waiting to be sent.")}</Badge><Link href="/workspace/hrms">{t("Open attendance")}</Link></>
      : attendance.storage === "unavailable" ? <Badge tone="warning">{t("This browser can't keep captures.")}</Badge>
        : <>
          <DayStatus state={attendance.checkedIn ? "checked_in" : "not_checked_in"} />
          {since ? <small>{since}</small> : null}
          <Button size="compact" isDisabled={!ready} onPress={() => setCapturing(attendance.checkedIn ? "check_out" : "check_in")}>
            {attendance.checkedIn ? t("Check out") : t("Check in")}
          </Button>
        </>}
    {capturing ? <CheckInDialog api={api} employee={employee} kind={capturing} attendance={attendance} onClose={() => setCapturing(null)} /> : null}
  </span>;
}
