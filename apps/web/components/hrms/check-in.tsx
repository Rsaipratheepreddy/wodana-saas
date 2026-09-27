"use client";
/* eslint-disable @next/next/no-img-element -- camera previews are local blobs, not remote image assets. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, CameraOff, MapPin } from "lucide-react";
import type { AttendanceAction, AttendanceSession, CapturePosition, HrmsBootstrap, HrmsEmployee, WorkContext, WorkLocation, WorkMode } from "@wodana/contracts";
import { Button, Callout, ControlledModalDialog, InlineNotice, SegmentedControl, SelectField, Skeleton, TextAreaField, TextInput, emitHapticFeedback } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import { HrmsError } from "@/lib/hrms/client";
import { clearPending, readPending, writePending, type PendingCapture } from "@/lib/hrms/pending";
import { useHrmsFormat } from "./hrms-format";
import { useHrmsLabels } from "./hrms-labels";
import styles from "./hrms.module.css";

export type CaptureKind = AttendanceAction["kind"];
export type SendOutcome =
  | { kind: "sent" }
  | { kind: "needs_reason"; issues: string[] }
  | { kind: "rejected" }
  | { kind: "offline" }
  | { kind: "unsaved"; message: string; conflict: boolean }
  | { kind: "busy" };
type Problem = { status: number; message: string; issues: string[] };

const REJECTED = [400, 404, 409, 413, 422];
const MIN_REASON = 3;

/**
 * My attendance right now: the open session, and a capture kept on this device until the server confirms it.
 * A capture is written to the device first, then its photo and action are sent; offline, it waits for a retry
 * with the same action, so it is never recorded twice. When the server finds its evidence short, it asks for a
 * reason and the same action is sent again with it.
 */
export function useAttendance(api: HrmsApi, workspaceId: string, boot: HrmsBootstrap | null) {
  const t = useT();
  const format = useHrmsFormat();
  const tracked = Boolean(boot?.employee?.enabled);
  const key = `${workspaceId}:${boot?.membershipId ?? ""}`;
  const [current, setCurrent] = useState<AttendanceSession | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingCapture | null>(null);
  const [storage, setStorage] = useState<"loading" | "ready" | "unavailable">("loading");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const sending = useRef(false);
  const reload = useCallback(async () => {
    if (!tracked) return;
    try { setCurrent(await api.current()); setError(""); } catch (cause) { setError(format.failure(cause, t("Attendance didn't load."))); }
  }, [api, tracked, format, t]);
  useEffect(() => { queueMicrotask(() => void reload()); }, [reload]);
  useEffect(() => {
    if (!tracked) return;
    let live = true;
    readPending(key).then((row) => { if (live) { setPending(row ?? null); setStorage("ready"); } }).catch(() => { if (live) setStorage("unavailable"); });
    return () => { live = false; };
  }, [key, tracked]);

  const send = useCallback(async (saved: PendingCapture): Promise<SendOutcome> => {
    if (sending.current) return { kind: "busy" };
    sending.current = true;
    setBusy(true);
    try {
      try {
        await writePending(saved);
      } catch {
        // Another tab or an earlier visit left a capture here: that one goes first.
        const stored = await readPending(key).catch(() => undefined);
        if (stored && stored.input.actionId !== saved.input.actionId) {
          setPending(stored);
          setProblem(null);
          return { kind: "unsaved", message: t("Another capture on this device is waiting to be sent."), conflict: true };
        }
        return { kind: "unsaved", message: t("This browser couldn't keep the capture. Try again."), conflict: false };
      }
      setPending(saved);
      setProblem(null);
      try {
        await api.startCapture(saved.input.captureId);
        if (saved.photo) await api.uploadPhoto(saved.input.captureId, saved.photo);
        const result = await api.act(saved.input);
        await clearPending(key).catch(() => undefined);
        setPending(null);
        if (result && result.current !== undefined) setCurrent(result.current);
        else void reload();
        setRevision((value) => value + 1);
        emitHapticFeedback("success");
        return { kind: "sent" };
      } catch (cause) {
        if (cause instanceof HrmsError && REJECTED.includes(cause.status)) {
          setProblem({ status: cause.status, message: cause.message, issues: cause.issues });
          void reload();
          return cause.status === 400 && cause.issues.length ? { kind: "needs_reason", issues: cause.issues } : { kind: "rejected" };
        }
        return { kind: "offline" };
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, [api, key, reload, t]);

  return {
    tracked,
    current,
    /** Checked in now. */
    checkedIn: Boolean(current && !current.endedAt),
    error,
    pending,
    storage,
    problem,
    busy,
    /** Bumped each time an action is recorded, so what shows the days reloads. */
    revision,
    reload,
    submit: (input: AttendanceAction, photo: Blob | null) => send({ key, input, photo, createdAt: Date.now() }),
    /** The waiting capture again, the same action, with a reason when the server asked for one. */
    retry: (reason?: string) => (pending ? send(reason ? { ...pending, input: { ...pending.input, exceptionReason: reason } } : pending) : Promise.resolve<SendOutcome>({ kind: "busy" })),
    discard: async () => {
      await clearPending(key).catch(() => undefined);
      setPending(null);
      setProblem(null);
      void reload();
    },
  };
}
export type Attendance = ReturnType<typeof useAttendance>;

/** A capture that the server hasn't confirmed: sent again as it is, with a reason when asked, or discarded when refused. */
export function PendingCaptureNotice({ attendance, timezone }: { attendance: Attendance; timezone: string }) {
  const t = useT();
  const labels = useHrmsLabels();
  const format = useHrmsFormat();
  const [reason, setReason] = useState("");
  const { pending, problem } = attendance;
  if (!pending || attendance.busy) return null;
  const what = `${labels.event(pending.input.kind)} · ${format.time(pending.input.deviceAt, timezone)}`;
  const discard = <Button variant="quiet" onPress={() => void attendance.discard()}>{t("Discard")}</Button>;
  if (problem?.status === 400 && problem.issues.length)
    return <Callout tone="warning" title={t("Needs a reason")} actions={<>{discard}
      <Button variant="primary" isDisabled={reason.trim().length < MIN_REASON} onPress={() => void attendance.retry(reason.trim())}>{t("Send")}</Button></>}>
      <div className={styles.stack}>
        <span>{what}</span>
        <ul className={styles.issues}>{problem.issues.map((issue) => <li key={issue}>{labels.issue(issue)}</li>)}</ul>
        <TextAreaField label={t("Reason for review")} isRequired value={reason} onChange={setReason} />
      </div>
    </Callout>;
  if (problem)
    return <Callout tone="danger" title={t("Not recorded")} actions={<>{discard}<Button onPress={() => void attendance.retry()}>{t("Try again")}</Button></>}>
      <span>{what}</span> <span>{problem.message}</span>
    </Callout>;
  return <Callout tone="warning" title={t("Not sent yet")} actions={<Button variant="primary" onPress={() => void attendance.retry()}>{t("Send now")}</Button>}>
    <span>{what}</span> <span>{t("It's saved on this device.")}</span>
  </Callout>;
}

export type Photo = { blob: Blob; takenAt: string };

/**
 * A camera — the front one for a selfie, the back one for a group photo: live, then a still taken from it
 * (a JPEG, at most 1200 px wide), or unavailable.
 */
export function CameraCapture({ onChange, children, facing = "user", photoLabel }: {
  onChange: (photo: Photo | null) => void; children?: ReactNode; facing?: "user" | "environment"; photoLabel?: string;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const run = useRef(0);
  const [state, setState] = useState<"starting" | "live" | "taken" | "unavailable">("starting");
  const [preview, setPreview] = useState("");
  const stop = () => { stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; };
  const start = useCallback(async () => {
    const attempt = ++run.current;
    stop();
    setState("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("No camera");
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1200 } }, audio: false });
      if (attempt !== run.current) { next.getTracks().forEach((track) => track.stop()); return; }
      stream.current = next;
      if (video.current) { video.current.srcObject = next; await video.current.play().catch(() => undefined); }
      setState("live");
    } catch {
      if (attempt === run.current) setState("unavailable");
    }
  }, [facing]);
  useEffect(() => {
    queueMicrotask(() => void start());
    return () => { run.current += 1; stop(); };
  }, [start]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const take = async () => {
    const element = video.current;
    if (!element?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1200, element.videoWidth);
    canvas.height = Math.round((element.videoHeight * canvas.width) / element.videoWidth);
    canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!image) return;
    run.current += 1;
    stop();
    setPreview(URL.createObjectURL(image));
    setState("taken");
    onChange({ blob: image, takenAt: new Date().toISOString() });
  };
  const retake = () => { setPreview(""); onChange(null); void start(); };
  return <>
    <div className={styles.camera}>
      <video ref={video} muted playsInline hidden={state !== "live"} aria-label={t("Camera preview")} />
      {state === "taken" && preview ? <img alt={photoLabel ?? t("Your photo")} src={preview} /> : null}
      {state === "starting" || state === "unavailable" ? <div className={styles.cameraEmpty}>
        {state === "starting" ? <Camera aria-hidden="true" size={20} /> : <CameraOff aria-hidden="true" size={20} />}
        <span>{state === "starting" ? t("Starting the camera…") : t("Camera unavailable")}</span>
      </div> : null}
    </div>
    <div className={styles.cameraActions}>
      {state === "live" ? <Button onPress={() => void take()}>{t("Take photo")}</Button> : null}
      {state === "taken" ? <Button variant="quiet" onPress={retake}>{t("Retake")}</Button> : null}
      {state === "unavailable" ? <Button variant="quiet" onPress={() => void start()}>{t("Try again")}</Button> : null}
      {children}
    </div>
  </>;
}

/** Where the device is, taken as the dialog opens and again with the photo. */
export function usePosition() {
  const [value, setValue] = useState<CapturePosition | null>(null);
  const [state, setState] = useState<"locating" | "found" | "unavailable">("locating");
  const alive = useRef(true);
  const found = useRef(false);
  const locate = useCallback(() => {
    if (!navigator.geolocation) { setState("unavailable"); return; }
    setState("locating");
    navigator.geolocation.getCurrentPosition((fix) => {
      if (!alive.current) return;
      found.current = true;
      setValue({ latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracyM: fix.coords.accuracy, capturedAt: new Date(fix.timestamp).toISOString(), mock: false });
      setState("found");
    }, () => { if (alive.current) setState(found.current ? "found" : "unavailable"); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }, []);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(locate);
    return () => { alive.current = false; };
  }, [locate]);
  return { value, state, locate };
}

/** How sure the device's location is, with a retry when it couldn't be found. */
export function PositionStatus({ position }: { position: ReturnType<typeof usePosition> }) {
  const t = useT();
  const format = useHrmsFormat();
  return <>
    <span className={styles.location}><MapPin aria-hidden="true" size={14} />
      {position.state === "locating" ? t("Finding your location…") : position.value ? t("Location ±{distance}", { distance: format.metres(position.value.accuracyM) }) : t("Location unavailable")}
    </span>
    {position.state === "unavailable" ? <Button size="compact" variant="quiet" onPress={position.locate}>{t("Try again")}</Button> : null}
  </>;
}

/** Where someone can work: offices, and the sites of the projects they are on. */
function usePlaces(api: HrmsApi, needed: boolean) {
  const [places, setPlaces] = useState<{ offices: WorkLocation[]; sites: { location: WorkLocation; context: WorkContext }[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!needed) return;
    let live = true;
    Promise.all([api.locations(), api.contexts()]).then(([locations, contexts]) => {
      if (!live) return;
      const active = locations.filter((location) => location.active);
      setPlaces({
        offices: active.filter((location) => location.kind === "office"),
        sites: active.filter((location) => location.kind === "site").flatMap((location) => {
          const context = contexts.find((item) => (item.kind === "project" ? item.id === location.projectId : item.id === location.caseId));
          return context ? [{ location, context }] : [];
        }),
      });
    }).catch((cause: unknown) => { if (live) setError(cause ?? new Error()); });
    return () => { live = false; };
  }, [api, needed]);
  return { places, error };
}

/**
 * Check in, check out or switch place: how and where I'm working, a fresh photo and the device's location, and a
 * note. Without a photo or a location, or when the server finds the evidence short, a reason goes with it for review.
 */
export function CheckInDialog({ api, employee, kind, attendance, onClose }: {
  api: HrmsApi; employee: HrmsEmployee; kind: CaptureKind; attendance: Attendance; onClose: () => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const current = attendance.current ?? null;
  const active = current?.segments.find((segment) => !segment.endedAt) ?? null;
  const choosing = kind !== "check_out";
  const { places, error: placesError } = usePlaces(api, choosing);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const position = usePosition();
  const [mode, setMode] = useState<WorkMode>(kind === "switch" && active ? active.mode : "office");
  const [chosen, setChosen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [issues, setIssues] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const options = mode === "office" ? places?.offices.map((location) => ({ id: location.id, label: location.name })) ?? []
    : mode === "site" ? places?.sites.map(({ location, context }) => ({ id: location.id, label: location.name, description: context.name })) ?? [] : [];
  // One office or one site needs no choosing.
  const locationId = mode === "office" || mode === "site" ? chosen ?? (options.length === 1 ? options[0].id : null) : null;
  const evidenceShort = !photo || !position.value;
  const needsReason = Boolean(issues) || evidenceShort;
  const noSite = mode === "site" && places !== null && !places.sites.length;
  const placeless = !choosing || mode === "field" || mode === "remote";
  const ready = !attendance.busy && (placeless || places !== null) && !noSite && (mode !== "site" || Boolean(locationId)) && (mode !== "office" || !options.length || Boolean(locationId))
    && (!needsReason || reason.trim().length >= MIN_REASON);
  const title = kind === "check_in" ? t("Check in") : kind === "check_out" ? t("Check out") : t("Switch place");
  const settle = (outcome: SendOutcome) => {
    if (outcome.kind === "needs_reason") { setIssues(outcome.issues); return; }
    if (outcome.kind === "unsaved" && !outcome.conflict) { setError(outcome.message); return; }
    if (outcome.kind !== "busy") onClose();
  };
  const submit = async () => {
    setError("");
    if (issues) { settle(await attendance.retry(reason.trim())); return; }
    const location = [...(places?.offices ?? []), ...(places?.sites.map((site) => site.location) ?? [])].find((item) => item.id === locationId);
    const input: AttendanceAction = {
      actionId: crypto.randomUUID(),
      captureId: crypto.randomUUID(),
      kind,
      mode: choosing ? mode : active?.mode ?? "field",
      locationId: choosing ? locationId : null,
      projectId: choosing && mode === "site" ? location?.projectId ?? null : null,
      caseId: choosing && mode === "site" ? location?.caseId ?? null : null,
      ...(current ? { expectedSessionId: current.id, expectedVersion: current.version } : {}),
      deviceAt: photo?.takenAt ?? new Date().toISOString(),
      position: position.value,
      note: note.trim(),
      exceptionReason: needsReason ? reason.trim() : "",
    };
    settle(await attendance.submit(input, photo?.blob ?? null));
  };
  return <ControlledModalDialog isOpen size="md" title={title} isDismissable={!attendance.busy} onOpenChange={(open) => { if (!open && !attendance.busy) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={attendance.busy} onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={attendance.busy} isDisabled={!ready} onPress={() => void submit()}>{issues ? t("Send for review") : title}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {choosing ? <>
        <SegmentedControl label={t("Where")} value={mode} onChange={(value) => { setMode(value as WorkMode); setChosen(null); }}
          options={(["office", "site", "field", ...(employee.remoteAllowed ? ["remote" as const] : [])] as WorkMode[]).map((id) => ({ id, label: labels.mode(id) }))} />
        {placesError && !placeless ? <InlineNotice tone="error" message={format.failure(placesError, t("Your workplaces didn't load."))} /> : null}
        {(mode === "office" || mode === "site") && !places && !placesError ? <Skeleton lines={1} /> : null}
        {noSite ? <InlineNotice tone="info" message={t("None of your projects has a site yet.")} /> : null}
        {options.length > 1 ? <SelectField label={mode === "site" ? t("Site") : t("Office")} isRequired placeholder={t("Choose")} selectedKey={locationId}
          onSelectionChange={(key) => setChosen(key ? String(key) : null)} items={options} /> : null}
        {options.length === 1 ? <p className={styles.muted}>{options[0].label}{"description" in options[0] && options[0].description ? ` · ${options[0].description}` : ""}</p> : null}
      </> : active ? <p className={styles.muted}>{[active.context.location?.name ?? labels.mode(active.mode), t("since {time}", { time: format.time(active.startedAt, employee.calendar.timezone) })].join(" · ")}</p> : null}
      <CameraCapture onChange={(next) => { setPhoto(next); if (next) position.locate(); }}>
        <PositionStatus position={position} />
      </CameraCapture>
      <TextInput label={t("Note")} value={note} onChange={setNote} />
      {issues ? <InlineNotice tone="info" title={t("Needs a reason")} message={<ul className={styles.issues}>{issues.map((issue) => <li key={issue}>{labels.issue(issue)}</li>)}</ul>} /> : null}
      {needsReason ? <TextAreaField label={t("Reason for review")} isRequired value={reason} onChange={setReason} /> : null}
    </div>
  </ControlledModalDialog>;
}
