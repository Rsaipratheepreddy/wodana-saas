"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Share2 } from "lucide-react";
import {
  Badge, Button, DataGrid, EmptyState, ErrorState, InlineNotice, ListTabs, PageShell, RecordName, Skeleton, useDesignSystem, type DataGridColumn,
} from "@/design-system";
import type { BookingStatus, BookingTypeRecord, BookingTypesData, StaffBooking } from "@/lib/booking/booking";
import { formatTime } from "@/lib/booking/booking";
import { bookingRequest, BookingRequestError } from "@/lib/booking/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { BookingShareSheet } from "./booking-share-sheet";
import { BookingTypeDialog } from "./booking-type-dialog";
import { OverrideDialog, type OverrideRecord } from "./override-dialog";
import styles from "./booking.module.css";

type Tab = "types" | "bookings" | "availability";

/**
 * Calendar › Booking pages: the types people can book (each with its share sheet), the bookings
 * themselves (confirm, decline, complete, no-show) and each person's extra or blocked hours.
 */
export function BookingTypesPage({ workspaceId, initialData }: { workspaceId: string; initialData?: BookingTypesData }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [tab, setTab] = useState<Tab>("types");
  const [data, setData] = useState<BookingTypesData | null>(initialData ?? null);
  const [failed, setFailed] = useState("");
  const [editing, setEditing] = useState<BookingTypeRecord | "new" | null>(null);
  const [sharing, setSharing] = useState<BookingTypeRecord | null>(null);
  const [bookings, setBookings] = useState<StaffBooking[] | null>(null);
  const [overrides, setOverrides] = useState<OverrideRecord[] | null>(null);
  const [addingOverride, setAddingOverride] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed("");
    try { setData(await bookingRequest<BookingTypesData>(workspaceId, "types")); }
    catch (error) { setFailed(error instanceof Error ? error.message : t("Please try again.")); }
  }, [workspaceId, t]);
  const loadBookings = useCallback(async () => {
    try { setBookings((await bookingRequest<{ data: StaffBooking[] }>(workspaceId, `bookings?from=${encodeURIComponent(new Date(Date.now() - 7 * 86_400_000).toISOString())}`)).data); }
    catch (error) { setNotice({ tone: "error", message: error instanceof Error ? translateKnown(t, error.message) : t("Please try again.") }); setBookings([]); }
  }, [workspaceId, t]);
  const loadOverrides = useCallback(async () => {
    try { setOverrides((await bookingRequest<{ data: OverrideRecord[] }>(workspaceId, "overrides")).data); }
    catch { setOverrides([]); }
  }, [workspaceId]);
  useEffect(() => { if (!initialData) void load(); }, [initialData, load]);
  useEffect(() => { if (tab === "bookings" && !bookings) void loadBookings(); if (tab === "availability" && !overrides) void loadOverrides(); }, [tab, bookings, overrides, loadBookings, loadOverrides]);

  const act = async (booking: StaffBooking, action: "confirm" | "decline" | "complete" | "no-show") => {
    setBusy(`${booking.id}:${action}`); setNotice(null);
    try {
      const result = await bookingRequest<{ status: BookingStatus; version: number }>(workspaceId, `bookings/${booking.id}/${action}`, "POST", { version: booking.version });
      setBookings((current) => current?.map((row) => row.id === booking.id ? { ...row, status: result.status, version: result.version } : row) ?? null);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? translateKnown(t, error.message) : t("Please try again.") });
      if (error instanceof BookingRequestError && error.status === 409) void loadBookings();
    } finally { setBusy(null); }
  };

  const memberName = useMemo(() => new Map((data?.members ?? []).map((member) => [member.membershipId, member.name])), [data]);
  const where = (row: BookingTypeRecord) => row.locationKind === "video" ? t("Video call") : row.locationKind === "phone" ? t("Phone call") : row.locationKind === "client_address" ? t("At the client's address") : row.locationDetail || t("At our studio");
  const statusLabels: Record<BookingStatus, string> = { pending: t("Waiting for you"), confirmed: t("Confirmed"), cancelled: t("Cancelled"), completed: t("Completed"), no_show: t("No-show") };
  const statusTone: Record<BookingStatus, "neutral" | "success" | "warning" | "danger" | "info"> = { pending: "warning", confirmed: "info", cancelled: "neutral", completed: "success", no_show: "danger" };

  const typeColumns: DataGridColumn<BookingTypeRecord>[] = [
    { id: "name", header: t("Booking type"), size: 260, accessorFn: (row) => row.name, meta: { primary: true, renderCell: (row) => <span className={styles.typeName}>
      <span><span className={styles.swatch} data-color={row.color} aria-hidden="true" />{row.name}</span><small>{t("{minutes} min", { minutes: row.durationMinutes })} · {where(row)}</small></span> } },
    { id: "hosts", header: t("Hosts"), size: 200, accessorFn: (row) => row.hosts.map((host) => host.name ?? memberName.get(host.membershipId) ?? "").join(", "), meta: { renderCell: (row) => row.hosts.map((host) => host.name ?? memberName.get(host.membershipId)).filter(Boolean).join(", ") || t("No host yet") } },
    { id: "confirmation", header: t("Confirmation"), size: 150, accessorFn: (row) => row.confirmation, meta: { mobileHidden: true, renderCell: (row) => row.confirmation === "approval" ? t("You confirm each") : t("Automatic") } },
    { id: "upcoming", header: t("Upcoming"), size: 110, accessorFn: (row) => row.upcoming ?? 0, meta: { align: "end", priority: "medium" } },
    { id: "status", header: t("Status"), size: 110, accessorFn: (row) => row.active, meta: { renderCell: (row) => <Badge tone={row.active ? "success" : "neutral"}>{row.active ? t("Live") : t("Off")}</Badge> } },
    { id: "share", header: "", size: 120, enableSorting: false, meta: { interactive: true, renderCell: (row) => <Button size="compact" isDisabled={!row.active || !data?.publicSlug} onPress={() => setSharing(row)}><Share2 size={14} aria-hidden="true" />{t("Share")}</Button> } },
  ];
  const bookingColumns: DataGridColumn<StaffBooking>[] = [
    { id: "when", header: t("When"), size: 200, accessorFn: (row) => row.startsAt, meta: { primary: true, renderCell: (row) => <RecordName title={new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short" }).format(new Date(row.startsAt))}
      detail={`${formatTime(row.startsAt, timeZone, locale)} – ${formatTime(row.endsAt, timeZone, locale)}`} /> } },
    { id: "client", header: t("Client"), size: 200, accessorFn: (row) => row.visitorName, meta: { renderCell: (row) => <RecordName title={row.visitorName} detail={row.enquiryReference} /> } },
    { id: "type", header: t("Booking type"), size: 180, accessorFn: (row) => row.typeName, meta: { mobileHidden: true } },
    { id: "host", header: t("Host"), size: 160, accessorFn: (row) => row.hostName, meta: { priority: "medium" } },
    { id: "status", header: t("Status"), size: 130, accessorFn: (row) => row.status, meta: { renderCell: (row) => <Badge tone={statusTone[row.status]}>{statusLabels[row.status]}</Badge> } },
    { id: "actions", header: "", size: 220, enableSorting: false, meta: { interactive: true, renderCell: (row) => {
      const started = Date.parse(row.startsAt) <= Date.now();
      return <span className={styles.rowActions}>
        {row.status === "pending" ? <><Button size="compact" variant="primary" isLoading={busy === `${row.id}:confirm`} onPress={() => void act(row, "confirm")}>{t("Confirm")}</Button>
          <Button size="compact" isLoading={busy === `${row.id}:decline`} onPress={() => void act(row, "decline")}>{t("Decline")}</Button></> : null}
        {row.status === "confirmed" && started ? <><Button size="compact" isLoading={busy === `${row.id}:complete`} onPress={() => void act(row, "complete")}>{t("Complete")}</Button>
          <Button size="compact" isLoading={busy === `${row.id}:no-show`} onPress={() => void act(row, "no-show")}>{t("No-show")}</Button></> : null}
      </span>;
    } } },
  ];
  const overrideColumns: DataGridColumn<OverrideRecord>[] = [
    { id: "member", header: t("Person"), size: 200, accessorFn: (row) => row.memberName, meta: { primary: true } },
    { id: "dates", header: t("Dates"), size: 200, accessorFn: (row) => row.startsOn, meta: { renderCell: (row) => row.startsOn === row.endsOn ? row.startsOn : `${row.startsOn} – ${row.endsOn}` } },
    { id: "kind", header: t("Hours"), size: 220, accessorFn: (row) => row.kind, meta: { renderCell: (row) => `${row.kind === "extra" ? t("Extra hours") : t("Blocked")}${row.startTime ? ` · ${row.startTime}–${row.endTime}` : ` · ${t("All day")}`}` } },
    { id: "reason", header: t("Reason"), size: 200, accessorFn: (row) => row.reason ?? "", meta: { priority: "low" } },
    { id: "remove", header: "", size: 110, enableSorting: false, meta: { interactive: true, renderCell: (row) => <Button size="compact" variant="quiet" onPress={() => void bookingRequest(workspaceId, `overrides/${row.id}?version=${row.version}`, "DELETE").then(loadOverrides).catch((error: Error) => setNotice({ tone: "error", message: translateKnown(t, error.message) }))}>{t("Remove")}</Button> } },
  ];

  const action = tab === "types" ? <Button variant="primary" onPress={() => setEditing("new")}><Plus size={15} aria-hidden="true" />{t("New booking type")}</Button>
    : tab === "availability" ? <Button variant="primary" onPress={() => setAddingOverride(true)}><Plus size={15} aria-hidden="true" />{t("Add hours")}</Button> : undefined;

  return <PageShell title={t("Booking pages")} action={action}
    tabs={<ListTabs label={t("Booking pages")} value={tab} onChange={setTab} items={[{ id: "types", label: t("Booking types") }, { id: "bookings", label: t("Bookings"), count: bookings?.filter((row) => row.status === "pending").length }, { id: "availability", label: t("Availability") }]} />}>
    {notice ? <InlineNotice tone={notice.tone === "error" ? "error" : "success"} message={notice.message} /> : null}
    {failed ? <ErrorState description={translateKnown(t, failed)} onRetry={() => void load()} /> : !data ? <Skeleton shape="rows" lines={4} /> : tab === "types" ? (
      data.data.length ? <DataGrid rowNumbers={false} ariaLabel={t("Booking types")} data={data.data} columns={typeColumns} getRowId={(row) => row.id} onRowAction={(row) => setEditing(row)} showFooter={false} selectable={false} wrapText compactToolbar />
        : <EmptyState title={t("No booking types yet")} description={t("Let clients pick a free time for a consultation, a showroom visit or a site visit.")} action={<Button variant="primary" onPress={() => setEditing("new")}>{t("New booking type")}</Button>} />
    ) : tab === "bookings" ? (
      !bookings ? <Skeleton shape="rows" lines={4} /> : bookings.length ? <DataGrid rowNumbers={false} ariaLabel={t("Bookings")} data={bookings} columns={bookingColumns} getRowId={(row) => row.id} showFooter={false} selectable={false} wrapText compactToolbar />
        : <EmptyState title={t("No bookings yet")} description={t("Share a booking page to start receiving bookings.")} action={<Button onPress={() => setTab("types")}>{t("Booking types")}</Button>} />
    ) : (
      !overrides ? <Skeleton shape="rows" lines={3} /> : overrides.length ? <DataGrid rowNumbers={false} ariaLabel={t("Availability")} data={overrides} columns={overrideColumns} getRowId={(row) => row.id} showFooter={false} selectable={false} compactToolbar />
        : <EmptyState title={t("Everyone works their usual hours")} description={t("Add extra hours or block time for one person. Leave and holidays are already taken into account.")} action={<Button variant="primary" onPress={() => setAddingOverride(true)}>{t("Add hours")}</Button>} />
    )}
    {editing && data ? <BookingTypeDialog workspaceId={workspaceId} data={data} record={editing === "new" ? null : editing} onClose={() => setEditing(null)}
      onSaved={(saved) => { setEditing(null); setData((current) => current ? { ...current, data: current.data.some((row) => row.id === saved.id) ? current.data.map((row) => row.id === saved.id ? { ...saved, upcoming: row.upcoming } : row) : [...current.data, { ...saved, upcoming: 0 }] } : current); }}
      onReload={load} /> : null}
    {sharing && data?.publicSlug ? <BookingShareSheet type={sharing} publicSlug={data.publicSlug} options={data.options} onClose={() => setSharing(null)} /> : null}
    {addingOverride && data ? <OverrideDialog workspaceId={workspaceId} members={data.members} onClose={() => setAddingOverride(false)} onSaved={() => { setAddingOverride(false); void loadOverrides(); }} /> : null}
  </PageShell>;
}
