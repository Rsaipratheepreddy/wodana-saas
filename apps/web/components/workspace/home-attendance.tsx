"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { HrmsBootstrap } from "@wodana/contracts";
import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { hrmsApi } from "@/lib/hrms/api";
import { CheckInDialog, useAttendance, type CaptureKind } from "@/components/hrms/check-in";
import { useHrmsFormat } from "@/components/hrms/hrms-format";
import { DayStatus, useHrmsLabels } from "@/components/hrms/hrms-labels";
import s from "./workspace-home.module.css";

/** Home's attendance line: in or out, where and since when, and check in or out from here; the days are on People. */
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
  const status = error ? error
    : !boot ? t("Loading…")
    : !employee ? t("Attendance isn't on for you.")
    : attendance.pending ? t("A capture is waiting to be sent.")
    : attendance.storage === "unavailable" ? t("This browser can't keep captures.")
    : attendance.checkedIn && active ? [active.context.location?.name ?? labels.mode(active.mode), t("since {time}", { time: format.time(active.startedAt, employee.calendar.timezone) })].join(" · ")
    : "";
  return <section className={s.attendance} aria-label={t("My attendance")}>
    <div>
      <strong>{t("Attendance")}</strong>
      <p>{employee && attendance.current !== undefined && !attendance.pending ? <DayStatus state={attendance.checkedIn ? "checked_in" : "not_checked_in"} /> : null} {status}</p>
    </div>
    {error ? <Button onPress={() => void load()}>{t("Try again")}</Button>
      : employee && !attendance.pending ? <Button variant="primary" isDisabled={!ready} onPress={() => setCapturing(attendance.checkedIn ? "check_out" : "check_in")}>
        {attendance.checkedIn ? t("Check out") : t("Check in")}</Button> : null}
    <Link href="/workspace/hrms">{attendance.pending ? t("Open attendance") : t("My days")}</Link>
    {capturing && employee ? <CheckInDialog api={api} employee={employee} kind={capturing} attendance={attendance} onClose={() => setCapturing(null)} /> : null}
  </section>;
}
