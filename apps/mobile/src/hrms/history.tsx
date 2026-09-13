import { useEffect, useState } from "react";
import { Image, Platform, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import { Text } from "../design-system";
import { useAuth } from "../auth/provider";
import {
  duration,
  localDay,
  statusLabel,
  timeLabel,
  useHrms,
  type AttendanceDay,
  type AttendanceEvent,
  type AttendanceHistory,
  type AttendanceReview,
  type HrmsBootstrap,
} from "./api";
import { Button, TextField, Card, Choice, EmptyState, Notice, Sheet, StatusBadge } from "./ui";
import { DateField } from "./date-field";
import { DecisionSheet, Leave } from "./leave";
type Props = {
  workspaceId: string;
  boot: HrmsBootstrap;
  revision: number;
  onSaved: () => void;
};
export function History(props: Props) {
  if (!props.boot.employee)
    return (
      <EmptyState icon="clock" title="Your time, in one place"
        description="Daily hours, site visits, and time corrections will appear here once your employee profile is enabled." />
    );
  return <EmployeeHistory {...props} />;
}
function EmployeeHistory({ workspaceId, boot, revision, onSaved }: Props) {
  const today = localDay(boot.employee!.calendar.timezone),
    [from, setFrom] = useState(today.slice(0, 8) + "01"),
    [to, setTo] = useState(today),
    [selected, setSelected] = useState<AttendanceDay | null>(null),
    history = useHrms<AttendanceHistory>(
      workspaceId,
      `attendance/history?from=${from}&to=${to}`,
      revision,
    );
  return (
    <>
      <Card>
        <Text accessibilityRole="header" size="lg" weight="semibold">
          Time summary
        </Text>
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
        <Text weight="medium">
          {duration(
            history.data?.days.reduce((sum, d) => sum + d.workedMinutes, 0) ??
              0,
          )}{" "}
          completed
        </Text>
      </Card>
      {history.error ? <Notice error>{history.error}</Notice> : null}
      {history.loading ? <Text>Loading attendance…</Text> : null}
      {history.data?.days.map((day) => (
        <Card key={day.date}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text weight="semibold" size="sm">{day.date}</Text>
            <StatusBadge status={day.status} label={statusLabel(day.status)} />
          </View>
          {day.breakdown.length || day.open ? <><Text size="lg" weight="semibold">
            {duration(day.workedMinutes)} completed
            {day.open ? " · in progress" : ""}
          </Text>
          <Text size="sm" tone="textSecondary">
            {day.breakdown
              .map((b) => `${b.name} · ${duration(b.minutes)}`)
              .join("\n") || "No attendance recorded"}
          </Text>
          <Button
            variant="ghost"
            label="View day"
            accessibilityHint="View attendance records and request a time correction"
            onPress={() => setSelected(day)}
          />
          </> : <Text size="sm" tone="textSecondary">No attendance recorded</Text>}
        </Card>
      ))}
      <Reviews
        workspaceId={workspaceId}
        boot={boot}
        revision={revision}
        onSaved={onSaved}
      />
      {selected && history.data ? (
        <DayDetail
          workspaceId={workspaceId}
          day={selected}
          data={history.data}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            onSaved();
          }}
        />
      ) : null}
    </>
  );
}
function DayDetail({
  workspaceId,
  day,
  data,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  day: AttendanceDay;
  data: AttendanceHistory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { client } = useAuth(),
    sessions = data.sessions.filter(
      (s) =>
        localDay(s.calendar.timezone, new Date(s.startedAt)) <= day.date &&
        (!s.endedAt ||
          localDay(s.calendar.timezone, new Date(s.endedAt)) >= day.date),
    );
  const events = data.events.filter((e) =>
      sessions.some((s) => s.id === e.sessionId),
    ),
    [correction, setCorrection] = useState<{
      sessionId: string;
      event?: AttendanceEvent;
    } | null>(null),
    [date, setDate] = useState(day.date),
    [time, setTime] = useState("18:00"),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [photo, setPhoto] = useState<string | null>(null);
  return (
    <Sheet title={`Attendance · ${day.date}`} onClose={onClose}>
      {events.map((event) => (
        <Card key={event.id}>
          <Text weight="medium">
            {statusLabel(event.kind)} ·{" "}
            {timeLabel(event.effectiveAt, day.timezone)}
          </Text>
          <Text size="sm" tone="textSecondary">
            {event.note}
            {event.originalAt !== event.effectiveAt
              ? ` · original ${timeLabel(event.originalAt, day.timezone)}`
              : ""}
          </Text>
          {event.evidence.photoCaptured && event.captureId ? (
            <Button
              label="View photo"
              variant="ghost"
              onPress={() => setPhoto(event.captureId)}
            />
          ) : null}
          <Button
            label="Request time correction"
            variant="secondary"
            onPress={() => setCorrection({ sessionId: event.sessionId, event })}
          />
        </Card>
      ))}
      {sessions
        .filter((s) => !s.endedAt)
        .map((s) => (
          <Button
            key={s.id}
            label="Report missing checkout"
            variant="secondary"
            onPress={() => setCorrection({ sessionId: s.id })}
          />
        ))}
      {correction ? (
        <Card>
          <Text weight="medium">
            {correction.event ? "Time correction" : "Missing checkout"}
          </Text>
          <DateField label="Requested date" value={date} onChange={setDate} />
          <DateField
            label="Requested time"
            value={time}
            onChange={setTime}
            mode="time"
          />
          <Text size="xs" tone="textSecondary">
            Enter time in your device timezone:{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </Text>
          <TextField
            label="Reason"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={2000}
          />
          {error ? <Notice error>{error}</Notice> : null}
          <Button
            label="Send for approval"
            loading={busy}
            onPress={async () => {
              if (reason.trim().length < 3) {
                setError("Add a short reason.");
                return;
              }
              setBusy(true);
              try {
                await client.api(
                  `/workspaces/${workspaceId}/hrms/reviews`,
                  "POST",
                  {
                    actionId: randomUUID(),
                    sessionId: correction.sessionId,
                    kind: correction.event ? "correction" : "missing_checkout",
                    ...(correction.event
                      ? { eventId: correction.event.id }
                      : {}),
                    requestedAt: new Date(`${date}T${time}:00`).toISOString(),
                    reason,
                  },
                );
                onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </Card>
      ) : null}
      {photo ? (
        <PhotoSheet
          workspaceId={workspaceId}
          captureId={photo}
          onClose={() => setPhoto(null)}
        />
      ) : null}
    </Sheet>
  );
}
export function Reviews({
  workspaceId,
  boot,
  revision,
  onSaved,
  team = false,
  initialView = "attendance",
}: Props & { team?: boolean; initialView?: "attendance" | "leave" }) {
  const { client } = useAuth(),
    reviews = useHrms<AttendanceReview[]>(
      workspaceId,
      `reviews?scope=${team ? "team" : "self"}`,
      revision,
    ),
    [selected, setSelected] = useState<AttendanceReview | null>(null),
    [view, setView] = useState<string>(initialView);
  if (team && view === "leave")
    return (
      <>
        <Choice
          label="Approvals"
          value={view}
          options={[
            { value: "attendance", label: "Attendance" },
            { value: "leave", label: "Leave" },
          ]}
          onChange={setView}
        />
        <Leave
          workspaceId={workspaceId}
          boot={boot}
          revision={revision}
          onSaved={onSaved}
          defaultTeam
        />
      </>
    );
  const description = (r: AttendanceReview) =>
    `${r.name ?? ""} · ${statusLabel(r.kind)}\n${r.reason}${r.requestedAt ? "\nRequested: " + new Date(r.requestedAt).toLocaleString() : ""}${r.originalAt ? "\nPrevious: " + new Date(r.originalAt).toLocaleString() : ""}\n${r.evidence?.issues?.map(statusLabel).join(" · ") ?? ""}`;
  return (
    <>
      {team ? (
        <Choice
          label="Approvals"
          value={view}
          options={[
            { value: "attendance", label: "Attendance" },
            { value: "leave", label: "Leave" },
          ]}
          onChange={setView}
        />
      ) : null}
      <Text accessibilityRole="header" size="lg" weight="semibold">
        {team ? "Attendance approvals" : "My attendance requests"}
      </Text>
      {reviews.error ? <Notice error>{reviews.error}</Notice> : null}
      {reviews.data?.length ? (
        reviews.data.map((r) => (
          <Card key={r.id}>
            <Text weight="medium">
              {team ? `${r.name} · ` : ""}
              {statusLabel(r.kind)}
            </Text>
            <Text size="sm">{r.reason}</Text>
            <StatusBadge status={r.status} label={statusLabel(r.status)} />
            {r.decisionReason ? <Text size="sm" tone="textSecondary">{r.decisionReason}</Text> : null}
            <Button
              label={r.canDecide ? "Review" : "Details"}
              variant="secondary"
              onPress={() => setSelected(r)}
            />
          </Card>
        ))
      ) : (
        reviews.loading ? <Text size="sm" tone="textSecondary">Loading requests…</Text> : !reviews.error ?
        <EmptyState icon="check" title={team ? "All caught up" : "No requests yet"}
          description={team ? "Attendance requests from your team will appear here for review." : "Track attendance corrections and missing checkouts here."} /> : null
      )}
      {selected?.canDecide ? (
        <DecisionSheet
          title="Review attendance"
          description={description(selected)}
          onClose={() => setSelected(null)}
          onSubmit={async (decision, reason) => {
            await client.api(
              `/workspaces/${workspaceId}/hrms/reviews/${selected.id}/decision`,
              "POST",
              { decision, reason },
            );
            onSaved();
          }}
        >
          {selected.evidence?.position ? (
            <Text size="sm">
              GPS {selected.evidence.position.latitude.toFixed(5)},{" "}
              {selected.evidence.position.longitude.toFixed(5)} · ±
              {Math.round(selected.evidence.position.accuracyM)} m
            </Text>
          ) : null}
          {boot.permissions.evidence &&
          selected.evidence?.photoCaptured &&
          selected.captureId ? (
            <PhotoButton workspaceId={workspaceId} captureId={selected.captureId}/>
          ) : null}
        </DecisionSheet>
      ) : selected ? (
        <Sheet title="Attendance request" onClose={() => setSelected(null)}>
          <Text>{description(selected)}</Text>
          <Text>
            {statusLabel(selected.status)} · {selected.decisionReason}
          </Text>
          {(!team || boot.permissions.evidence) &&
          selected.evidence?.photoCaptured &&
          selected.captureId ? (
            <PhotoButton workspaceId={workspaceId} captureId={selected.captureId}/>
          ) : null}
        </Sheet>
      ) : null}
    </>
  );
}
function PhotoSheet({
  workspaceId,
  captureId,
  onClose,
}: {
  workspaceId: string;
  captureId: string;
  onClose: () => void;
}) {
  const { client } = useAuth(),
    [uri, setUri] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let file: File | undefined;
    let url: string | undefined;
    client
      .api<ArrayBuffer>(
        `/workspaces/${workspaceId}/hrms/captures/${captureId}/photo`,
        "GET",
        undefined,
        true,
      )
      .then((bytes) => {
        if (!active) return;
        if (Platform.OS === "web") {
          url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
          setUri(url);
        } else {
          file = new File(Paths.cache, `attendance-view-${randomUUID()}.jpg`);
          file.write(new Uint8Array(bytes));
          setUri(file.uri);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
      if (file?.exists) file.delete();
    };
  }, [client, workspaceId, captureId]);
  return (
    <Sheet title="Attendance photo" onClose={onClose}>
      {error ? (
        <Notice error>{error}</Notice>
      ) : uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel="Private attendance evidence"
          style={{ width: "100%", height: 420 }}
          resizeMode="contain"
        />
      ) : (
        <Text>Loading photo…</Text>
      )}
    </Sheet>
  );
}

function PhotoButton({workspaceId,captureId}:{workspaceId:string;captureId:string}){const [open,setOpen]=useState(false);return <><Button label="View attendance photo" variant="secondary" onPress={()=>setOpen(true)}/>{open?<PhotoSheet workspaceId={workspaceId} captureId={captureId} onClose={()=>setOpen(false)}/>:null}</>;}
