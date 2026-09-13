import { useState, type ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { tokens } from "../design-system";
import { randomUUID } from "expo-crypto";
import { Text, useTheme } from "../design-system";
import { useAuth } from "../auth/provider";
import {
  localDay,
  statusLabel,
  useHrms,
  type HrmsBootstrap,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveType,
} from "./api";
import { Button, TextField, Card, Choice, EmptyState, Notice, Sheet, StatusBadge } from "./ui";
import { DateField } from "./date-field";
export function Leave({
  workspaceId,
  boot,
  revision,
  onSaved,
  defaultTeam = false,
}: {
  workspaceId: string;
  boot: HrmsBootstrap;
  revision: number;
  onSaved: () => void;
  defaultTeam?: boolean;
}) {
  const [team, setTeam] = useState(
      defaultTeam || (!boot.employee && boot.permissions.team),
    ),
    [year, setYear] = useState(localDay(boot.workspace.timezone).slice(0, 4)),
    [requesting, setRequesting] = useState(false),
    [selected, setSelected] = useState<LeaveRequest | null>(null),
    [cancel, setCancel] = useState<LeaveRequest | null>(null),
    { client } = useAuth();
  const { width, fontScale } = useWindowDimensions();
  const balanceWidth = Math.min(300, width - 96);
  const query = `scope=${team ? "team" : "self"}&year=${year}`,
    requests = useHrms<LeaveRequest[]>(
      workspaceId,
      `leave/requests?${query}`,
      revision,
    ),
    balances = useHrms<LeaveBalance[]>(
      workspaceId,
      `leave/balances?${query}`,
      revision,
    ),
    types = useHrms<LeaveType[]>(workspaceId, "leave/types", revision);
  return (
    <>
      {boot.employee?.enabled ? (
        <Button
          label="Request leave"
          disabled={!types.data?.some((t) => t.active)}
          onPress={() => setRequesting(true)}
        />
      ) : null}
      <Card>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      {boot.permissions.team ? (
        <View style={{ flex: 1 }}><Choice
          label="Leave view"
          value={team ? "team" : "self"}
          options={[
            { value: "self", label: "My leave" },
            { value: "team", label: "Team leave" },
          ]}
          onChange={(v) => setTeam(v === "team")}
        /></View>
      ) : <View style={{ flex: 1, gap: 5 }}><Text weight="semibold">My leave</Text><Text size="xs" tone="textSecondary">Your annual allowance</Text></View>}
      <View style={{ width: 82 }}><TextField
        label="Year"
        value={year}
        onChangeText={setYear}
        keyboardType="number-pad"
        maxLength={4}
      /></View>
      </View>
      </Card>
      {requests.error || balances.error || types.error ? (
        <Notice error>{requests.error || balances.error || types.error}</Notice>
      ) : null}
      {balances.data?.length ? <>
        <Text accessibilityRole="header" size="lg" weight="semibold">Leave balances</Text>
        <ScrollView horizontal={fontScale <= 1.3} showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 12 }}
          snapToInterval={fontScale <= 1.3 ? balanceWidth + 12 : undefined} decelerationRate="fast">
          {balances.data.map((b, index) => (
            <View key={`${b.membershipId}:${b.leaveTypeId}`} style={fontScale <= 1.3 ? { width: balanceWidth } : undefined}>
              <LeaveBalanceCard balance={b} team={team} index={index} />
            </View>
          ))}
        </ScrollView>
      </> : null}
      <Text accessibilityRole="header" weight="semibold" size="lg">
        {team ? "Team leave requests" : "Leave history"}
      </Text>
      {requests.loading ? <Text>Loading requests…</Text> : null}
      {requests.data?.length ? (
        requests.data.map((r) => (
          <Card key={r.id}>
            <Text weight="semibold">
              {team ? `${r.name} · ` : ""}
              {r.leaveTypeName}
            </Text>
            <Text size="sm">
              {r.startDate} – {r.endDate} · {r.days} day(s)
            </Text>
            <Text size="sm" tone="textSecondary">
              {r.reason}
            </Text>
            <StatusBadge status={r.status} label={statusLabel(r.status)} />
            {r.decisionReason ? <Text size="sm" tone="textSecondary">{r.decisionReason}</Text> : null}
            {r.canDecide ? (
              <Button
                label="Review request"
                variant="secondary"
                onPress={() => setSelected(r)}
              />
            ) : null}
            {r.membershipId === boot.membershipId &&
            ["pending", "approved"].includes(r.status) ? (
              <Button
                variant="ghost"
                label={
                  r.status === "pending" ? "Withdraw request" : "Cancel leave"
                }
                onPress={() => setCancel(r)}
              />
            ) : null}
          </Card>
        ))
      ) : !requests.loading ? (
        !requests.error ? <EmptyState icon="calendar" title="No leave requests yet"
          description={`Requests for ${year} will appear here, with their dates and approval status.`} /> : null
      ) : null}
      {requesting ? (
        <LeaveForm
          workspaceId={workspaceId}
          types={types.data ?? []}
          timezone={boot.employee?.calendar.timezone ?? boot.workspace.timezone}
          onClose={() => setRequesting(false)}
          onSaved={onSaved}
        />
      ) : null}
      {selected ? (
        <DecisionSheet
          title={
            selected.status === "cancellation_pending"
              ? "Review cancellation"
              : "Review leave"
          }
          description={`${selected.name} · ${selected.startDate} to ${selected.endDate}\n${selected.reason}\n${selected.cancellationReason ?? ""}`}
          onClose={() => setSelected(null)}
          onSubmit={async (decision, reason) => {
            await client.api(
              `/workspaces/${workspaceId}/hrms/leave/requests/${selected.id}/decision`,
              "POST",
              { decision, reason },
            );
            onSaved();
          }}
        />
      ) : null}
      {cancel ? (
        <ReasonSheet
          title={
            cancel.status === "pending"
              ? "Withdraw leave"
              : "Cancel approved leave"
          }
          label={
            cancel.status === "pending"
              ? "Withdraw request"
              : "Request cancellation"
          }
          onClose={() => setCancel(null)}
          onSubmit={async (reason) => {
            await client.api(
              `/workspaces/${workspaceId}/hrms/leave/requests/${cancel.id}/cancel`,
              "POST",
              { reason },
            );
            onSaved();
          }}
        />
      ) : null}
    </>
  );
}
function LeaveBalanceCard({ balance: b, team, index }: { balance: LeaveBalance; team: boolean; index: number }) {
  const { colors } = useTheme();
  const accent = [tokens.brand.lilac, tokens.brand.rose, tokens.brand.peach][index % 3];
  const circumference = 2 * Math.PI * 34;
  const used = Math.min(1, Math.max(0, b.allowance > 0 ? b.used / b.allowance : 0));
  const pending = Math.min(1 - used, Math.max(0, b.allowance > 0 ? b.pending / b.allowance : 0));
  return <Card>
    <View style={{ gap: 3 }}>
      <Text weight="semibold">{b.leaveTypeName}</Text>
      {team && <Text size="xs" tone="textSecondary">{b.name}</Text>}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
      <View style={{ width: 88, height: 88, justifyContent: 'center', alignItems: 'center' }}>
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute' }}>
          <Svg width={88} height={88} viewBox="0 0 88 88" aria-hidden focusable={false}>
            <Circle cx={44} cy={44} r={34} stroke={colors.surfaceMuted} strokeWidth={7} fill="none" />
            {used > 0 && <Circle cx={44} cy={44} r={34} stroke={accent} strokeWidth={7} fill="none"
              strokeDasharray={`${used * circumference} ${circumference}`} rotation={-90} origin="44, 44" />}
            {pending > 0 && <Circle cx={44} cy={44} r={34} stroke={colors.actionPrimary} strokeWidth={7} fill="none" opacity={0.55}
              strokeDasharray={`${pending * circumference} ${circumference}`} strokeDashoffset={-used * circumference} rotation={-90} origin="44, 44" />}
          </Svg>
        </View>
        <Text weight="semibold" size="xl">{b.available}</Text>
        <Text size="2xs" tone="textSecondary">available</Text>
      </View>
      <View style={{ gap: 7, flex: 1 }}>
        <Text size="sm" weight="medium">{b.allowance} days annually</Text>
        {[{ label: 'Used', value: b.used, color: accent }, { label: 'Pending', value: b.pending, color: colors.actionPrimary }].map(item =>
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: item.color }} />
            <Text size="xs" tone="textSecondary" style={{ flex: 1 }}>{item.label}</Text><Text size="sm" weight="medium">{item.value}</Text>
          </View>)}
      </View>
    </View>
  </Card>;
}

function LeaveForm({
  workspaceId,
  types,
  timezone,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  types: LeaveType[];
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { client } = useAuth(),
    today = localDay(timezone),
    [start, setStart] = useState(today),
    [end, setEnd] = useState(today),
    [type, setType] = useState(types.find((t) => t.active)?.id ?? ""),
    [part, setPart] = useState("full"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [actionId] = useState(randomUUID);
  async function submit() {
    if (reason.trim().length < 3) {
      setError("Add a short reason.");
      return;
    }
    setBusy(true);
    try {
      await client.api(
        `/workspaces/${workspaceId}/hrms/leave/requests`,
        "POST",
        {
          actionId,
          leaveTypeId: type,
          startDate: start,
          endDate: end,
          dayPart: part,
          reason,
        },
      );
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Request leave" onClose={onClose}>
      <Choice
        label="Leave type"
        value={type}
        options={types
          .filter((t) => t.active)
          .map((t) => ({ value: t.id, label: t.name }))}
        onChange={(v) => {
          setType(v);
          setPart("full");
        }}
      />
      <DateField
        label="First day"
        value={start}
        onChange={(v) => {
          setStart(v);
          if (v > end) setEnd(v);
          setPart("full");
        }}
      />
      <DateField
        label="Last day"
        value={end}
        onChange={(v) => {
          setEnd(v);
          setPart("full");
        }}
      />
      <Choice
        label="Day portion"
        value={part}
        options={[
          { value: "full", label: "Full day(s)" },
          ...(start === end && types.find((t) => t.id === type)?.allowHalfDay
            ? [
                { value: "first_half", label: "First half" },
                { value: "second_half", label: "Second half" },
              ]
            : []),
        ]}
        onChange={setPart}
      />
      <Text size="sm" tone="textSecondary">
        Working days and holidays follow your employee calendar.
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
        label="Submit leave request"
        loading={busy}
        onPress={() => void submit()}
      />
    </Sheet>
  );
}
export function DecisionSheet({
  title,
  description,
  children,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  onClose: () => void;
  onSubmit: (decision: "approve" | "reject", reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function decide(decision: "approve" | "reject") {
    if (reason.trim().length < 3) {
      setError("Add a short decision reason.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(decision, reason);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Text size="sm">{description}</Text>
      {children}
      <TextField
        label="Decision reason"
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={2000}
      />
      {error ? <Notice error>{error}</Notice> : null}
      <Button
        label="Approve"
        loading={busy}
        onPress={() => void decide("approve")}
      />
      <Button
        variant="secondary"
        label="Reject"
        disabled={busy}
        onPress={() => void decide("reject")}
      />
    </Sheet>
  );
}
export function ReasonSheet({
  title,
  label,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Sheet title={title} onClose={onClose}>
      <TextField
        label="Reason"
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={2000}
      />
      {error ? <Notice error>{error}</Notice> : null}
      <Button
        label={label}
        loading={busy}
        onPress={async () => {
          if (reason.trim().length < 3) {
            setError("Add a short reason.");
            return;
          }
          setBusy(true);
          try {
            await onSubmit(reason);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}
