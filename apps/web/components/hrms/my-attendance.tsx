"use client";
/* eslint-disable @next/next/no-img-element -- camera previews are local blobs, not remote image assets. */
import { useEffect, useRef, useState } from "react";
import type {
  AttendanceAction,
  AttendanceHistory,
  AttendanceSession,
  CapturePosition,
  HrmsBootstrap,
  WorkContext,
  WorkLocation,
  WorkMode,
} from "@wodana/contracts";
import { Button, SelectField, TextArea } from "./controls";
import {
  HrmsError,
  hrmsRequest,
  localDay,
  minutesLabel,
  statusLabel,
  timeLabel,
} from "@/lib/hrms/client";
import {
  clearPending,
  readPending,
  writePending,
  type PendingCapture,
} from "@/lib/hrms/pending";
import { Empty, Modal, Notice, useHrms } from "./shared";
import styles from "./hrms.module.css";
type Props = {
  workspaceId: string;
  boot: HrmsBootstrap;
  revision: number;
  onSaved: () => void;
};
export function MyAttendance(props: Props) {
  if (!props.boot.employee?.enabled)
    return (
      <Empty title="Attendance is not enabled yet">
        {props.boot.permissions.manage
          ? "Set up a work calendar in Calendar & policy, then enable attendance for members in People."
          : "Ask your workspace administrator to enable your employee attendance."}
      </Empty>
    );
  return <Attendance {...props} />;
}
function Attendance({ workspaceId, boot, revision, onSaved }: Props) {
  const {
    data: current,
    error,
    loading,
  } = useHrms<AttendanceSession>(workspaceId, "attendance/current", revision);
  const { data: locations, error: locationsError } = useHrms<WorkLocation[]>(
    workspaceId,
    "locations",
    revision,
    "projects",
  );
  const { data: contexts, error: contextsError } = useHrms<WorkContext[]>(
    workspaceId,
    "",
    revision,
    "projects",
  );
  const today = localDay(boot.employee!.calendar.timezone);
  const {
    data: history,
    error: historyError,
    fetchedAt,
  } = useHrms<AttendanceHistory>(
    workspaceId,
    `attendance/history?from=${today}&to=${today}`,
    revision,
  );
  const [kind, setKind] = useState<AttendanceAction["kind"] | null>(null),
    [pending, setPending] = useState<PendingCapture | null>(null),
    [message, setMessage] = useState(""),
    [rejectedStatus, setRejectedStatus] = useState<number | null>(null),
    [retryReason, setRetryReason] = useState(""),
    [busy, setBusy] = useState(false),
    [storageReady, setStorageReady] = useState(false),
    [tick, setTick] = useState(() => Date.now());
  const key = `${workspaceId}:${boot.membershipId}`;
  useEffect(() => {
    readPending(key)
      .then((row) => {
        setPending(row ?? null);
        setStorageReady(true);
      })
      .catch(() =>
        setMessage(
          "Browser storage is unavailable. Enable storage before recording attendance.",
        ),
      );
  }, [key, revision]);
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const active = current?.segments.find((s) => !s.endedAt);
  const day = history?.days[0];
  const sending = useRef(false);
  async function send(saved: PendingCapture) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    setRejectedStatus(null);
    try {
      await writePending(saved);
    } catch (error) {
      sending.current = false;
      setBusy(false);
      setMessage(
        "The capture could not be saved in this browser. Keep the form open and retry.",
      );
      throw error;
    }
    try {
      setPending(saved);
      await hrmsRequest(workspaceId, "captures", "POST", {
        id: saved.input.captureId,
      });
      if (saved.photo) {
        const form = new FormData();
        form.append("photo", saved.photo, "camera.jpg");
        await hrmsRequest(
          workspaceId,
          `captures/${saved.input.captureId}/photo`,
          "PUT",
          form,
        );
      }
      await hrmsRequest(workspaceId, "attendance/actions", "POST", saved.input);
      await clearPending(key);
      setPending(null);
      setKind(null);
      setMessage("Attendance recorded.");
      onSaved();
    } catch (e) {
      if (
        e instanceof HrmsError &&
        [400, 404, 409, 413, 422].includes(e.status)
      ) {
        setRejectedStatus(e.status);
        setRetryReason(saved.input.exceptionReason);
        setKind(null);
        setMessage([e.message, ...e.issues].join(" "));
        onSaved();
      } else {
        setMessage(
          "Pending sync. Your capture is saved on this device. Retry to confirm it with the server.",
        );
        setKind(null);
      }
      throw e;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const elapsed = day?.elapsedMinutes ?? 0;
  const extra =
    current && active && !day?.stale && fetchedAt
      ? Math.max(0, Math.floor((tick - fetchedAt) / 60000))
      : 0;
  return (
    <>
      <div className={styles.attendanceHero}>
        <div>
          <span className={styles.eyebrow}>
            {new Intl.DateTimeFormat(undefined, {
              timeZone: boot.employee!.calendar.timezone,
              weekday: "long",
              month: "long",
              day: "numeric",
            }).format(new Date())}
          </span>
          <h2>
            {current
              ? "Your workday is in progress"
              : "Ready for your workday?"}
          </h2>
          <p>
            {current
              ? `${active?.context.location?.name ?? statusLabel(active?.mode ?? "field")} · ${active?.context.name ?? "General work"}`
              : "Check in at the office, on a site, or while working in the field."}
          </p>
          <div className={styles.actions}>
            <Button
              size="lg"
              disabled={
                !storageReady ||
                loading ||
                busy ||
                Boolean(pending) ||
                Boolean(error)
              }
              onClick={() => setKind(current ? "check_out" : "check_in")}
            >
              {current ? "Check out" : "Check in"}
            </Button>
            {current ? (
              <Button
                variant="secondary"
                disabled={!storageReady || busy || Boolean(pending)}
                onClick={() => setKind("switch")}
              >
                Change work location
              </Button>
            ) : null}
          </div>
          {current?.pendingReviewCount ? (
            <small>
              {current.pendingReviewCount} attendance exception(s) awaiting
              review
            </small>
          ) : null}
        </div>
        <div className={styles.timeMetric}>
          <strong>{minutesLabel(elapsed + extra)}</strong>
          <span>Recorded today{current ? " · in progress" : ""}</span>
          <small>{boot.employee!.calendar.timezone}</small>
        </div>
      </div>
      {error || historyError || locationsError || contextsError ? (
        <Notice error>
          {error || historyError || locationsError || contextsError}
        </Notice>
      ) : null}
      {message ? <Notice>{message}</Notice> : null}
      {pending ? (
        <div className={styles.pending}>
          <div>
            <strong>Pending sync</strong>
            <p>
              Your {statusLabel(pending.input.kind).toLowerCase()} has not been
              confirmed. Retry this capture before starting another.
            </p>
          </div>
          {rejectedStatus === 400 ? (
            <TextArea
              id="retry-reason"
              label="Reason for review"
              value={retryReason}
              maxLength={2000}
              onChange={(e) => setRetryReason(e.target.value)}
              hint="Explain missing evidence or a delayed connection. The original capture is kept."
            />
          ) : null}
          <Button
            loading={busy}
            onClick={() =>
              void send(
                rejectedStatus === 400 && retryReason.trim().length >= 3
                  ? {
                      ...pending,
                      input: { ...pending.input, exceptionReason: retryReason },
                    }
                  : pending,
              ).catch(() => {})
            }
          >
            Retry capture
          </Button>
          {rejectedStatus ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                try {
                  await clearPending(key);
                  setPending(null);
                  setRejectedStatus(null);
                  setMessage(
                    "Rejected capture discarded. You can record a new capture.",
                  );
                  onSaved();
                } catch {
                  setMessage(
                    "Could not remove the saved capture. Please retry.",
                  );
                }
              }}
            >
              Discard rejected capture
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className={styles.sectionHeading}>
        <h2>Today’s timeline</h2>
        <span>
          {day?.workedMinutes
            ? `${minutesLabel(day.workedMinutes)} in completed segments`
            : "Your check-ins and work locations appear here."}
        </span>
      </div>
      {history?.segments.length ? (
        <ol className={styles.timeline}>
          {history.segments.map((segment) => (
            <li key={segment.id}>
              <div>
                <strong>
                  {segment.context.location?.name ?? statusLabel(segment.mode)}
                </strong>
                <p>
                  {segment.context.name} · {statusLabel(segment.mode)}
                </p>
              </div>
              <span>
                {timeLabel(segment.startedAt, boot.employee!.calendar.timezone)}{" "}
                – {timeLabel(segment.endedAt, boot.employee!.calendar.timezone)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <Empty title="A fresh start">
          Your attendance timeline begins with your first check-in.
        </Empty>
      )}
      {kind ? (
        <CaptureDialog
          workspaceId={workspaceId}
          boot={boot}
          current={current}
          kind={kind}
          locations={locations ?? []}
          contexts={contexts ?? []}
          busy={busy}
          onClose={() => setKind(null)}
          onSubmit={(input, photo) =>
            send({ key, input, photo, createdAt: Date.now() })
          }
        />
      ) : null}
    </>
  );
}
function CaptureDialog({
  boot,
  current,
  kind,
  locations,
  contexts,
  busy,
  onClose,
  onSubmit,
}: {
  workspaceId: string;
  boot: HrmsBootstrap;
  current: AttendanceSession | null;
  kind: AttendanceAction["kind"];
  locations: WorkLocation[];
  contexts: WorkContext[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: AttendanceAction, photo: Blob | null) => Promise<void>;
}) {
  const active = current?.segments.find((s) => !s.endedAt);
  const [mode, setMode] = useState<WorkMode>(active?.mode ?? "office"),
    [locationId, setLocationId] = useState(active?.locationId ?? ""),
    [contextId, setContextId] = useState(
      active?.projectId ?? active?.caseId ?? "",
    );
  const [note, setNote] = useState(""),
    [reason, setReason] = useState(""),
    [photo, setPhoto] = useState<Blob | null>(null),
    [preview, setPreview] = useState(""),
    [position, setPosition] = useState<CapturePosition | null>(null),
    [captureTime, setCaptureTime] = useState(new Date().toISOString()),
    [error, setError] = useState(""),
    [camera, setCamera] = useState(false),
    [locating, setLocating] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null);
  useEffect(
    () => () => stream.current?.getTracks().forEach((t) => t.stop()),
    [],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  async function locate() {
    setLocating(true);
    try {
      if (!navigator.geolocation) throw new Error("Location is not supported.");
      const fix = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }),
      );
      setPosition({
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracyM: fix.coords.accuracy,
        capturedAt: new Date(fix.timestamp).toISOString(),
        mock: false,
      });
    } catch {
      setError(
        "Location could not be captured. Retry or explain the exception below.",
      );
    } finally {
      setLocating(false);
    }
  }
  async function startCamera() {
    try {
      setError("");
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1200 } },
        audio: false,
      });
      setCamera(true);
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play();
      }
    } catch {
      setError(
        "Camera access is unavailable. Allow camera permission, or explain the exception below.",
      );
    }
  }
  async function takePhoto() {
    if (!video.current?.videoWidth) return;
    const canvas = document.createElement("canvas");
    const width = Math.min(1200, video.current.videoWidth);
    canvas.width = width;
    canvas.height = Math.round(
      (video.current.videoHeight * width) / video.current.videoWidth,
    );
    canvas
      .getContext("2d")
      ?.drawImage(video.current, 0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
    setPhoto(image);
    setPreview(image ? URL.createObjectURL(image) : "");
    setCaptureTime(new Date().toISOString());
    setCamera(false);
    stream.current?.getTracks().forEach((t) => t.stop());
    await locate();
  }
  const selectedLocation = locations.find((l) => l.id === locationId);
  const context = contexts.find((c) => c.id === contextId);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if ((!photo || !position) && reason.trim().length < 3) {
      setError("Capture your photo and location, or explain the exception.");
      return;
    }
    const projectId =
      mode === "site"
        ? selectedLocation?.projectId
        : context?.kind === "project"
          ? context.id
          : null;
    const caseId =
      mode === "site"
        ? selectedLocation?.caseId
        : context?.kind === "pre_project"
          ? context.id
          : null;
    try {
      await onSubmit(
        {
          actionId: crypto.randomUUID(),
          captureId: crypto.randomUUID(),
          kind,
          mode,
          locationId:
            mode === "office" || mode === "site" ? locationId || null : null,
          projectId: projectId ?? null,
          caseId: caseId ?? null,
          ...(current
            ? {
                expectedSessionId: current.id,
                expectedVersion: current.version,
              }
            : {}),
          deviceAt: captureTime,
          position,
          note,
          exceptionReason: reason,
        },
        photo,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The capture could not be submitted.",
      );
    }
  }
  return (
    <Modal
      title={kind === "switch" ? "Change work location" : statusLabel(kind)}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className={styles.formGrid}>
          {kind !== "check_out" ? (
            <>
              <SelectField
                id="capture-mode"
                label="Where are you working?"
                value={mode}
                onChange={(e) => {
                  setMode(e as WorkMode);
                  setLocationId("");
                }}
              >
                <option value="office">Office</option>
                <option value="site">Project site</option>
                <option value="field">Field / travel</option>
                {boot.employee?.remoteAllowed ? (
                  <option value="remote">Remote</option>
                ) : null}
              </SelectField>
              {mode === "office" || mode === "site" ? (
                <SelectField
                  id="capture-site"
                  label={mode === "site" ? "Project site" : "Office location"}
                  value={locationId}
                  required={mode === "site"}
                  onChange={(e) => setLocationId(e)}
                >
                  <option value="">
                    {mode === "site"
                      ? "Choose an assigned site"
                      : "Choose office"}
                  </option>
                  {locations
                    .filter(
                      (l) =>
                        l.active &&
                        l.kind === (mode === "site" ? "site" : "office"),
                    )
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </SelectField>
              ) : null}
              {mode !== "site" ? (
                <SelectField
                  id="capture-project"
                  label="Work context"
                  value={contextId}
                  onChange={(e) => setContextId(e)}
                >
                  <option value="">General work · no project</option>
                  {contexts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.kind === "pre_project" ? " · planning" : ""}
                    </option>
                  ))}
                </SelectField>
              ) : null}
            </>
          ) : (
            <p>
              Finishing at{" "}
              {active?.context.location?.name ??
                statusLabel(active?.mode ?? "field")}
              . Your location will be checked against this workplace.
            </p>
          )}
          <div className={styles.camera}>
            <video
              ref={video}
              muted
              playsInline
              hidden={!camera}
              aria-label="Live camera preview"
            />
            {preview && !camera ? (
              <img alt="Your attendance photo" src={preview} />
            ) : null}
            {!camera && !preview ? (
              <div className={styles.cameraPlaceholder}>
                A fresh photo for this attendance record
              </div>
            ) : null}
            <div className={styles.actions}>
              <Button variant="secondary" onClick={startCamera} disabled={busy}>
                {photo ? "Retake photo" : "Open camera"}
              </Button>
              {camera ? <Button onClick={takePhoto}>Take photo</Button> : null}
            </div>
          </div>
          <div className={styles.locationLine}>
            <span>
              {position
                ? `Location captured · accuracy ±${Math.round(position.accuracyM)} m`
                : "Location not captured"}
            </span>
            <Button variant="ghost" loading={locating} onClick={locate}>
              Refresh location
            </Button>
          </div>
          {selectedLocation ? (
            <p className={styles.muted}>
              Site boundary: {selectedLocation.radiusM} m. Location is verified
              when you submit.
            </p>
          ) : null}
          <TextArea
            id="capture-note"
            label="Work note"
            optional
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <TextArea
            id="capture-reason"
            label="Exception reason"
            optional
            hint="Required if a photo or location is unavailable, or you have left the site. Your manager will review it."
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {error ? <Notice error>{error}</Notice> : null}
        <footer className={styles.actions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {reason.trim()
              ? "Submit attendance for review"
              : kind === "switch"
                ? "Change location"
                : statusLabel(kind)}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
