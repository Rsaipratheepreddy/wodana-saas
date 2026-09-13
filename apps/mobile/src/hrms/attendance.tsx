import { useEffect, useRef, useState } from "react";
import { AppState, Image, Linking, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { randomUUID } from "expo-crypto";
import { Text, useTheme } from "../design-system";
import { Icon } from "../components/icon";
import { ApiError } from "../auth/client";
import { useAuth } from "../auth/provider";
import {
  duration,
  localDay,
  statusLabel,
  timeLabel,
  useHrms,
  type AttendanceAction,
  type AttendanceHistory,
  type AttendanceSession,
  type CapturePosition,
  type HrmsBootstrap,
  type WorkContext,
  type WorkLocation,
  type WorkMode,
} from "./api";
import { Button, TextField, Card, Choice, EmptyState, Notice, Sheet } from "./ui";
import { clearPending, photoForm, readPending, savePending } from "./pending";
import { syncCapture, type PendingCapture } from "./capture-queue";
export function Attendance({
  workspaceId,
  boot,
  revision,
  onSaved,
}: {
  workspaceId: string;
  boot: HrmsBootstrap;
  revision: number;
  onSaved: () => void;
}) {
  if (!boot.employee?.enabled)
    return (
      <EmptyState icon="clock" title="Set up your workday"
        description="Ask your administrator to enable your employee profile and work calendar in web HRMS. Then you can check in with a photo and site location." />
    );
  return (
    <EmployeeAttendance
      workspaceId={workspaceId}
      boot={boot}
      revision={revision}
      onSaved={onSaved}
    />
  );
}
function EmployeeAttendance({
  workspaceId,
  boot,
  revision,
  onSaved,
}: {
  workspaceId: string;
  boot: HrmsBootstrap;
  revision: number;
  onSaved: () => void;
}) {
  const { client } = useAuth(),
    { colors } = useTheme();
  const current = useHrms<AttendanceSession | null>(
      workspaceId,
      "attendance/current",
      revision,
    ),
    locations = useHrms<WorkLocation[]>(
      workspaceId,
      "locations",
      revision,
      "projects",
    ),
    contexts = useHrms<WorkContext[]>(workspaceId, "", revision, "projects");
  const today = localDay(boot.employee!.calendar.timezone),
    history = useHrms<AttendanceHistory>(
      workspaceId,
      `attendance/history?from=${today}&to=${today}`,
      revision,
    );
  const [kind, setKind] = useState<AttendanceAction["kind"] | null>(null),
    [pending, setPending] = useState<PendingCapture | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [rejectedStatus, setRejectedStatus] = useState<number | null>(null),
    [retryReason, setRetryReason] = useState(""),
    [storageReady, setStorageReady] = useState(false);
  const key = `${workspaceId}:${boot.membershipId}`;
  useEffect(() => {
    let active = true;
    readPending(key)
      .then((row) => {
        if (active) {
          setPending(row);
          setStorageReady(true);
        }
      })
      .catch(() => {
        if (active)
          setMessage(
            "Device storage is unavailable. Attendance cannot be safely submitted.",
          );
      });
    return () => {
      active = false;
    };
  }, [key]);
  const active = current.data?.segments.find((s) => !s.endedAt),
    day = history.data?.days[0];
  const sending = useRef(false);
  async function send(row: PendingCapture) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    setRejectedStatus(null);
    let saved: PendingCapture;
    try {
      saved = await savePending(row);
    } catch (error) {
      sending.current = false;
      setBusy(false);
      setMessage(
        "The capture could not be saved on this device. Please keep this form open and retry.",
      );
      throw error;
    }
    try {
      setPending(saved);
      await syncCapture(saved, {
        request: (path, method, body) =>
          client.api(`/workspaces/${workspaceId}/hrms/${path}`, method, body),
        photo: async (capture) =>
          client.api(
            `/workspaces/${workspaceId}/hrms/captures/${capture.input.captureId}/photo`,
            "PUT",
            await photoForm(capture),
          ),
      });
      await clearPending(saved);
      setPending(null);
      setKind(null);
      setMessage("Attendance recorded.");
      onSaved();
    } catch (error) {
      if (
        error instanceof ApiError &&
        [400, 404, 409, 413, 422].includes(error.status)
      ) {
        setRejectedStatus(error.status);
        setRetryReason(saved.input.exceptionReason);
        setKind(null);
        setMessage([error.message, ...error.issues].join(" "));
        onSaved();
      } else {
        setMessage(
          "Pending sync. Retry this capture when your connection is available.",
        );
        setKind(null);
      }
      throw error;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Card tinted>
        <Text size="xs" tone="textTertiary">
          {new Intl.DateTimeFormat(undefined, {
            timeZone: boot.employee!.calendar.timezone,
            dateStyle: "full",
          }).format(new Date())}
        </Text>
        <Text accessibilityRole="header" size="xl" weight="semibold">
          {current.data
            ? "Your workday is in progress"
            : "Ready for your workday?"}
        </Text>
        <Text tone="textSecondary">
          {current.data
            ? `${active?.context.location?.name ?? statusLabel(active?.mode ?? "field")} · ${active?.context.name ?? "General work"}`
            : "Office, project site, field, or remote."}
        </Text>
        <View
          style={{
            padding: 18,
            borderRadius: 16,
            backgroundColor: colors.actionPrimarySubtle,
            gap: 6,
          }}
        >
          <Text style={{ fontSize: 32, lineHeight: 40, letterSpacing: -1 }} weight="medium">
            {duration(day?.elapsedMinutes ?? 0)}
          </Text>
          <Text size="xs">
            Recorded today{day?.open ? " · in progress" : ""}
          </Text>
        </View>
        <Button
          label={current.data ? "Check out" : "Check in"}
          startIcon={<Icon name="camera" size={18} />}
          loading={busy}
          disabled={
            !storageReady ||
            current.loading ||
            Boolean(current.error) ||
            Boolean(pending)
          }
          onPress={() => setKind(current.data ? "check_out" : "check_in")}
        />
        {current.data ? (
          <Button
            variant="secondary"
            label="Change work location"
            disabled={
              !storageReady || current.loading || busy || Boolean(pending)
            }
            onPress={() => setKind("switch")}
          />
        ) : null}
      </Card>
      {current.error || history.error || locations.error || contexts.error ? (
        <Notice error>
          {current.error || history.error || locations.error || contexts.error}
        </Notice>
      ) : null}
      {message ? <Notice>{message}</Notice> : null}
      {pending ? (
        <Card>
          <Text weight="semibold">Pending sync</Text>
          <Text size="sm">
            Your {statusLabel(pending.input.kind).toLowerCase()} is saved on
            this device. Confirm it before starting another.
          </Text>
          {rejectedStatus === 400 ? (
            <TextField
              label="Reason for review"
              value={retryReason}
              maxLength={2000}
              onChangeText={setRetryReason}
              hint="Explain missing evidence or a delayed connection. The original capture is kept."
              multiline
            />
          ) : null}
          <Button
            label="Retry capture"
            loading={busy}
            onPress={() =>
              void send(
                rejectedStatus === 400 && retryReason.trim().length >= 3
                  ? {
                      ...pending,
                      input: { ...pending.input, exceptionReason: retryReason },
                    }
                  : pending,
              ).catch(() => {})
            }
          />
          {rejectedStatus ? (
            <Button
              variant="ghost"
              label="Discard rejected capture"
              disabled={busy}
              onPress={async () => {
                try {
                  await clearPending(pending);
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
            />
          ) : null}
        </Card>
      ) : null}
      <Card>
        <Text accessibilityRole="header" size="lg" weight="semibold">
          Today’s timeline
        </Text>
        {history.data?.segments.length ? (
          history.data.segments.map((s) => (
            <View
              key={s.id}
              style={{
                gap: 5,
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text weight="medium">
                {s.context.location?.name ?? statusLabel(s.mode)}
              </Text>
              <Text size="sm" tone="textSecondary">
                {s.context.name} ·{" "}
                {timeLabel(s.startedAt, boot.employee!.calendar.timezone)} –{" "}
                {timeLabel(s.endedAt, boot.employee!.calendar.timezone)}
              </Text>
            </View>
          ))
        ) : (
          <Text size="sm" tone="textSecondary">
            Your timeline starts with your first check-in.
          </Text>
        )}
      </Card>
      {kind ? (
        <CaptureSheet
          kind={kind}
          boot={boot}
          current={current.data}
          locations={locations.data ?? []}
          contexts={contexts.data ?? []}
          busy={busy}
          onClose={() => setKind(null)}
          onSubmit={(input, photoUri) =>
            send({ key, input, photoUri, createdAt: Date.now() })
          }
        />
      ) : null}
    </>
  );
}
function CaptureSheet({
  kind,
  boot,
  current,
  locations,
  contexts,
  busy,
  onClose,
  onSubmit,
}: {
  kind: AttendanceAction["kind"];
  boot: HrmsBootstrap;
  current: AttendanceSession | null;
  locations: WorkLocation[];
  contexts: WorkContext[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: AttendanceAction, uri: string | null) => Promise<void>;
}) {
  const active = current?.segments.find((s) => !s.endedAt),
    [mode, setMode] = useState<WorkMode>(active?.mode ?? "office"),
    [locationId, setLocation] = useState(active?.locationId ?? ""),
    [contextId, setContext] = useState(
      active?.projectId ?? active?.caseId ?? "",
    ),
    [note, setNote] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  const [photo, setPhoto] = useState<string | null>(null),
    [deviceAt, setDeviceAt] = useState(() => new Date().toISOString()),
    [position, setPosition] = useState<CapturePosition | null>(null),
    [locating, setLocating] = useState(false),
    [cameraOpen, setCameraOpen] = useState(false),
    [ready, setReady] = useState(false),
    [taking, setTaking] = useState(false),
    [foreground, setForeground] = useState(true),
    [pictureSize, setPictureSize] = useState<string>();
  const [permission, requestPermission] = useCameraPermissions(),
    camera = useRef<CameraView>(null);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (s) => {
      setForeground(s === "active");
      setReady(false);
    });
    return () => listener.remove();
  }, []);
  async function locate() {
    setLocating(true);
    setError("");
    try {
      const granted = await Location.requestForegroundPermissionsAsync();
      if (!granted.granted)
        throw new Error("Allow location access or explain the exception.");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Location timed out. Retry or explain the exception.",
                ),
              ),
            15000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      setPosition({
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracyM: fix.coords.accuracy ?? 100000,
        capturedAt: new Date(fix.timestamp).toISOString(),
        mock: fix.mocked ?? false,
      });
    } catch (e) {
      setPosition(null);
      setError((e as Error).message);
    } finally {
      setLocating(false);
    }
  }
  async function openCamera() {
    setError("");
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError(
          "Allow camera access in device settings, or explain the exception.",
        );
        return;
      }
    }
    setReady(false);
    setCameraOpen(true);
  }
  async function take() {
    if (!ready || taking || !camera.current) return;
    setTaking(true);
    try {
      const result = await camera.current.takePictureAsync({
        quality: 0.55,
        exif: false,
      });
      if (!result?.uri) throw new Error("The camera did not return a photo.");
      setPhoto(result.uri);
      setDeviceAt(new Date().toISOString());
      setCameraOpen(false);
      await locate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTaking(false);
    }
  }
  const location = locations.find((l) => l.id === locationId),
    context = contexts.find((c) => c.id === contextId);
  async function submit() {
    if ((!photo || !position) && reason.trim().length < 3) {
      setError("Take a photo and capture location, or explain the exception.");
      return;
    }
    if (mode === "site" && kind !== "check_out" && !location) {
      setError("Choose an assigned site.");
      return;
    }
    try {
      await onSubmit(
        {
          actionId: randomUUID(),
          captureId: randomUUID(),
          kind,
          mode,
          locationId:
            mode === "site" || mode === "office" ? locationId || null : null,
          projectId:
            mode === "site"
              ? (location?.projectId ?? null)
              : context?.kind === "project"
                ? context.id
                : null,
          caseId:
            mode === "site"
              ? (location?.caseId ?? null)
              : context?.kind === "pre_project"
                ? context.id
                : null,
          ...(current
            ? {
                expectedSessionId: current.id,
                expectedVersion: current.version,
              }
            : {}),
          deviceAt,
          position,
          note,
          exceptionReason: reason,
        },
        photo,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Sheet
      title={kind === "switch" ? "Change work location" : statusLabel(kind)}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {kind !== "check_out" ? (
        <>
          <Choice
            label="Workplace"
            value={mode}
            options={[
              { value: "office", label: "Office" },
              { value: "site", label: "Project site" },
              { value: "field", label: "Field / travel" },
              ...(boot.employee?.remoteAllowed
                ? [{ value: "remote", label: "Remote" }]
                : []),
            ]}
            onChange={(value) => {
              setMode(value as WorkMode);
              setLocation("");
            }}
          />
          {mode === "site" || mode === "office" ? (
            <Choice
              label={mode === "site" ? "Assigned site" : "Office location"}
              value={locationId}
              options={[
                { value: "", label: "Choose workplace" },
                ...locations
                  .filter((l) => l.active && l.kind === mode)
                  .map((l) => ({ value: l.id, label: l.name })),
              ]}
              onChange={setLocation}
            />
          ) : null}
          {mode !== "site" ? (
            <Choice
              label="Work context"
              value={contextId}
              options={[
                { value: "", label: "General work · no project" },
                ...contexts.map((c) => ({
                  value: c.id,
                  label: `${c.name}${c.kind === "pre_project" ? " · pre-project" : ""}`,
                })),
              ]}
              onChange={setContext}
            />
          ) : null}
        </>
      ) : (
        <Text>
          Finishing at{" "}
          {active?.context.location?.name ??
            statusLabel(active?.mode ?? "field")}
          .
        </Text>
      )}
      {location ? (
        <Button
          variant="ghost"
          label="View workplace on map"
          onPress={() =>
            void Linking.openURL(
              `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=18/${location.latitude}/${location.longitude}`,
            )
          }
        />
      ) : null}
      {cameraOpen && foreground ? (
        <View style={{ gap: 12 }}>
          <CameraView
            ref={camera}
            facing="front"
            mode="picture"
            pictureSize={pictureSize}
            style={{ height: 300, borderRadius: 16 }}
            onCameraReady={async () => {
              setReady(true);
              const sizes =
                await camera.current?.getAvailablePictureSizesAsync();
              const target = sizes
                ?.filter((s) => /^\d+x\d+$/.test(s))
                .map((s) => ({
                  s,
                  area: s
                    .split("x")
                    .map(Number)
                    .reduce((a, b) => a * b),
                }))
                .filter((s) => s.area <= 2000000)
                .sort((a, b) => b.area - a.area)[0];
              if (target) setPictureSize(target.s);
            }}
            onMountError={(e) => {
              setError(e.message);
              setCameraOpen(false);
            }}
          />
          <Button
            label="Take photo"
            disabled={!ready}
            loading={taking}
            onPress={() => void take()}
          />
        </View>
      ) : photo ? (
        <Image
          source={{ uri: photo }}
          accessibilityLabel="Attendance photo preview"
          style={{ height: 260, width: "100%", borderRadius: 16 }}
          resizeMode="contain"
        />
      ) : null}
      <Button
        variant="secondary"
        label={photo ? "Retake photo" : "Open camera"}
        disabled={busy || taking}
        onPress={() => void openCamera()}
      />
      <Text size="sm" tone="textSecondary">
        {position
          ? `Location captured · ±${Math.round(position.accuracyM)} m`
          : "Location not captured"}
      </Text>
      <Button
        variant="ghost"
        label="Refresh location"
        loading={locating}
        onPress={() => void locate()}
      />
      <TextField
        label="Work note"
        value={note}
        onChangeText={setNote}
        maxLength={2000}
        multiline
      />
      <TextField
        label="Exception reason"
        value={reason}
        onChangeText={setReason}
        maxLength={2000}
        multiline
        hint="Required when evidence is missing or you are outside the site. Your manager reviews it."
      />
      {error ? <Notice error>{error}</Notice> : null}
      <Button
        label={
          reason.trim() ? "Submit attendance for review" : statusLabel(kind)
        }
        loading={busy}
        disabled={taking || locating}
        onPress={() => void submit()}
      />
    </Sheet>
  );
}
