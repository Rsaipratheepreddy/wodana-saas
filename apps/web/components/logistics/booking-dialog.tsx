"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { UserPlus } from "lucide-react";
import { Button, DateField, FormDialog, FormRow, InlineNotice, MoreDetails, MultiSelectField, PhoneField, SegmentedControl, SelectField, Skeleton, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { logisticsApi } from "@/lib/logistics/client";
import type { Booking, BookingSubject, Clash, LogisticsKind, LogisticsOptions, Worker } from "@/lib/logistics/types";
import { joinPhone, phoneCountry } from "@/lib/phone";
import styles from "./logistics.module.css";

export const KIND_LABEL: Record<LogisticsKind, MessageKey> = {
  delivery: tKey("Delivery"), installation: tKey("Installation"), factory_slot: tKey("Factory slot"), permit: tKey("Permit collection"), production: tKey("Production"),
};
/** The kinds booked from the calendar (a factory slot is booked under Production, without a work order). */
const BOOKABLE: LogisticsKind[] = ["delivery", "installation", "permit", "production"];
const SLOT = "factory-slot";

/** "Ali is also on the delivery of PRJ-2" — one line per double booking. */
export function clashText(clash: Clash, t: Translate) {
  return t("{name} is also on {what} · {project}", { name: clash.name, what: t(KIND_LABEL[clash.what]).toLowerCase(), project: clash.project });
}

/**
 * Books a delivery, an installation, a permit collection or production (a work order, or the project's factory slot):
 * the project (or, for a delivery, a deal with no project), the day, who goes (PLM-135: people by name from the saved
 * list, or typed as free text and saved; the lead first; a crew fills its people), and for a delivery the vehicle and
 * the driver. A person already booked that day warns; a vehicle already out can't be saved (the server refuses it). A
 * delivery or installation needing a building permit says so (PLM-136). Opened on a booking, it moves or restaffs it
 * (version-checked).
 */
export function LogisticsBookingDialog({ workspaceId, initial, fixedProject = false, onClose, onSaved }: {
  workspaceId: string;
  initial: Partial<BookingSubject> & { day?: string | null };
  /** From a project or a deal: the job (and kind, when given) stay as they are. */
  fixedProject?: boolean;
  onClose: () => void; onSaved: (booking: Booking & { warnings: Clash[] }) => void;
}) {
  const t = useT();
  const api = useMemo(() => logisticsApi(workspaceId), [workspaceId]);
  const [options, setOptions] = useState<LogisticsOptions | null>(null);
  const [failure, setFailure] = useState("");
  const [kind, setKind] = useState<LogisticsKind>(initial.kind ?? "delivery");
  // The job: "project:<id>" or "deal:<id>" (a deal books its delivery and permit collection).
  const [job, setJob] = useState(initial.projectId ? `project:${initial.projectId}` : initial.opportunityId ? `deal:${initial.opportunityId}` : "");
  const projectId = job.startsWith("project:") ? job.slice(8) : "";
  const opportunityId = job.startsWith("deal:") ? job.slice(5) : "";
  const [workOrderId, setWorkOrderId] = useState(initial.kind === "factory_slot" ? SLOT : initial.workOrderId ?? "");
  const [newPermitId] = useState(() => crypto.randomUUID());
  const [current, setCurrent] = useState<Booking | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [day, setDay] = useState<string | null>(initial.day ?? null);
  const [endDay, setEndDay] = useState<string | null>(null);
  const [people, setPeople] = useState<string[]>([]);
  const [lead, setLead] = useState("");
  const [crewId, setCrewId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [siteMemberId, setSiteMemberId] = useState("");
  const [note, setNote] = useState("");
  const [warnings, setWarnings] = useState<Clash[]>([]);
  const [adding, setAdding] = useState<null | "people" | "driver">(null);
  const editing = Boolean(initial.kind && (initial.projectId || initial.opportunityId));

  useEffect(() => {
    const controller = new AbortController();
    api.options(controller.signal).then(setOptions).catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [api]);

  const project = options?.projects.find((item) => item.id === projectId) ?? null;
  const deal = options?.deals.find((item) => item.id === opportunityId) ?? null;
  const effectiveKind: LogisticsKind = kind === "production" && workOrderId === SLOT ? "factory_slot" : kind;
  const permitId = effectiveKind === "permit" ? initial.permitId ?? project?.plannedPermitId ?? deal?.plannedPermitId ?? newPermitId : null;
  const dealKind = effectiveKind === "delivery" || effectiveKind === "permit";
  const subject: BookingSubject | null = (projectId || (opportunityId && dealKind)) && (effectiveKind !== "production" || workOrderId)
    ? { kind: effectiveKind, ...(projectId ? { projectId } : { opportunityId }), workOrderId: effectiveKind === "production" ? workOrderId : null, permitId } : null;
  const subjectKey = subject ? `${subject.kind}:${subject.projectId ?? ""}:${subject.opportunityId ?? ""}:${subject.workOrderId ?? ""}:${subject.permitId ?? ""}` : "";

  // What is booked already for this subject: its day and who goes, and the versions a save is checked against.
  useEffect(() => {
    if (!subject || (subject.kind === "permit" && subject.permitId === newPermitId && !initial.permitId)) { queueMicrotask(() => setCurrent(null)); return; }
    const controller = new AbortController();
    queueMicrotask(() => setLoadingCurrent(true));
    api.booking(subject, controller.signal).then((booking) => {
      if (controller.signal.aborted) return;
      setCurrent(booking); setLoadingCurrent(false);
      if (booking.start && !(initial.day && !editing)) setDay(booking.start);
      setEndDay(booking.end);
      setPeople(booking.people.map((person) => person.id));
      setLead(booking.people.find((person) => person.lead)?.id ?? "");
      setCrewId(booking.crew?.id ?? ""); setVehicleId(booking.vehicle?.id ?? ""); setDriverId(booking.driver?.id ?? ""); setNote(booking.note);
      setSiteMemberId(booking.siteMemberId ?? "");
    }).catch((cause: Error) => { if (!controller.signal.aborted) { setFailure(cause.message); setLoadingCurrent(false); } });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, subjectKey]);

  // Double bookings on the chosen day, checked as the booking takes shape.
  const clashKey = [subjectKey, day, endDay, people.join(","), driverId, vehicleId].join("|");
  useEffect(() => {
    if (!subject || !day) { queueMicrotask(() => setWarnings([])); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.conflicts({ ...subject, day, endDay: effectiveKind === "production" ? endDay : null, workerIds: people, driverWorkerId: driverId || null, vehicleId: vehicleId || null }, controller.signal)
        .then((result) => { if (!controller.signal.aborted) setWarnings(result.warnings); }).catch(() => undefined);
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, clashKey]);

  const workers = options?.workers ?? [];
  const workerItems = workers.map((worker) => ({ id: worker.id, label: worker.name, description: worker.trade }));
  const orders = (options?.workOrders ?? []).filter((order) => order.projectId === projectId);
  const permitMissing = (effectiveKind === "delivery" || effectiveKind === "installation") && Boolean(current?.permit.required) && Boolean(day)
    && !current?.permit.permits.some((permit) => permit.status === "collected" && permit.validFrom && permit.validTo && permit.validFrom <= day! && day! <= permit.validTo);
  // PLM-135: a name typed as free text is saved to the names list (no login) and goes on the booking.
  const addByName = async (name: string) => {
    try {
      const worker = await api.addPerson({ id: crypto.randomUUID(), name, phone: "", trade: effectiveKind === "delivery" ? t("Delivery crew") : t("Installer") });
      setOptions((value) => (value ? { ...value, workers: [...value.workers.filter((item) => item.id !== worker.id), worker].sort((a, b) => a.name.localeCompare(b.name)) } : value));
      setPeople((value) => [...new Set([...value, worker.id])]);
      setLead((value) => value || worker.id);
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : t("Could not save.")); }
  };
  const added = (worker: Worker) => {
    setOptions((value) => (value ? { ...value, workers: [...value.workers.filter((item) => item.id !== worker.id), worker].sort((a, b) => a.name.localeCompare(b.name)) } : value));
    if (adding === "driver") setDriverId(worker.id);
    else { setPeople((value) => [...new Set([...value, worker.id])]); if (!lead) setLead(worker.id); }
    setAdding(null);
  };
  const title = editing ? t("{what} · {project}", { what: t(KIND_LABEL[effectiveKind]), project: current?.project ?? project?.label ?? deal?.label ?? "" }) : t("Book");
  const canSubmit = Boolean(options?.canBook || current?.canBook) && Boolean(subject) && Boolean(day) && (effectiveKind !== "production" || !endDay || !day || endDay >= day);
  return <>
    <FormDialog size="md" title={title} submitLabel={t("Save")} error={failure || undefined} onClose={onClose} isDirty={Boolean(day || people.length || note)}
      isSubmitDisabled={!canSubmit || loadingCurrent}
      lead={!options && !failure ? <Skeleton lines={5} shape="form" /> : null}
      onSubmit={async () => {
        const result = await api.save({ ...subject!, day, ...(effectiveKind === "production" ? { endDay } : {}), was: { start: current?.start ?? null, end: current?.end ?? null },
          version: current?.version ?? 0, people: people.map((id) => ({ workerId: id, lead: id === lead })), crewId: crewId || null, note,
          ...(effectiveKind === "delivery" ? { vehicleId: vehicleId || null, driverWorkerId: driverId || null } : {}),
          ...((effectiveKind === "delivery" || effectiveKind === "installation") && siteMemberId ? { siteMemberId } : {}) });
        onSaved(result);
      }}>
      {options ? <>
        {!editing ? <SegmentedControl label={t("What")} value={kind} onChange={(value) => { setKind(value as LogisticsKind); setWorkOrderId(""); }}
          options={BOOKABLE.map((item) => ({ id: item, label: t(KIND_LABEL[item]) }))} /> : null}
        {!fixedProject && !editing ? <SelectField isRequired label={dealKind ? t("Project or deal") : t("Project")} selectedKey={job || null}
          onSelectionChange={(key) => { setJob(String(key ?? "")); setWorkOrderId(""); }}
          items={[...options.projects.map((item) => ({ id: `project:${item.id}`, label: item.label })),
            ...(dealKind ? options.deals.map((item) => ({ id: `deal:${item.id}`, label: item.label, description: t("Deal") })) : [])]} /> : null}
        {kind === "production" && !editing ? <SelectField isRequired label={t("Work order")} selectedKey={workOrderId || null} onSelectionChange={(key) => setWorkOrderId(String(key ?? ""))}
          items={[{ id: SLOT, label: t("Factory slot (whole project)") }, ...orders.map((order) => ({ id: order.id, label: order.label }))]} isDisabled={!projectId} /> : null}
        <FormRow>
          <DateField isRequired label={effectiveKind === "production" ? t("Starts") : t("Day")} value={day ? parseDate(day) : null} onChange={(value) => setDay(value ? value.toString() : null)} />
          {effectiveKind === "production" ? <DateField label={t("Finishes")} minValue={day ? parseDate(day) : undefined} value={endDay ? parseDate(endDay) : null}
            onChange={(value) => setEndDay(value ? value.toString() : null)} /> : null}
        </FormRow>
        {permitMissing ? <InlineNotice tone="error" message={t("No building permit covers this day. Record the permit first.")} /> : null}
        {options.crews.length ? <SelectField label={t("Crew")} selectedKey={crewId || "none"} onSelectionChange={(key) => {
          const id = key === "none" ? "" : String(key ?? "");
          setCrewId(id);
          const crew = options.crews.find((item) => item.id === id);
          if (crew) { setPeople((value) => [...new Set([...value, ...crew.workerIds])]); if (!lead && crew.workerIds[0]) setLead(crew.workerIds[0]); }
        }} items={[{ id: "none", label: t("No crew") }, ...options.crews.map((crew) => ({ id: crew.id, label: crew.name, description: crew.trade }))]} /> : null}
        <MultiSelectField label={effectiveKind === "delivery" ? t("Crew members") : t("People")} items={workerItems} selectedKeys={new Set(people)}
          onCreate={options.canAddPeople ? (name) => void addByName(name) : undefined}
          onSelectionChange={(keys) => { const next = workerItems.map((item) => item.id).filter((id) => keys.has(id)); setPeople(next); if (lead && !next.includes(lead)) setLead(next[0] ?? ""); }} />
        {options.canAddPeople ? <div><Button size="compact" variant="quiet" onPress={() => setAdding("people")}><UserPlus aria-hidden="true" size={14} />{t("Add person")}</Button></div> : null}
        {people.length > 1 ? <SelectField label={t("Lead")} selectedKey={lead || null} onSelectionChange={(key) => setLead(String(key ?? ""))}
          items={people.map((id) => ({ id, label: workers.find((worker) => worker.id === id)?.name ?? id }))} /> : null}
        {effectiveKind === "delivery" ? <>
          <FormRow>
            <SelectField label={t("Vehicle")} selectedKey={vehicleId || "none"} onSelectionChange={(key) => setVehicleId(key === "none" ? "" : String(key ?? ""))}
              items={[{ id: "none", label: t("No vehicle") }, ...options.vehicles.map((vehicle) => ({ id: vehicle.id, label: vehicle.name, description: [vehicle.kind, vehicle.capacityNote].filter(Boolean).join(" · ") || undefined }))]}
              description={options.vehicles.length ? undefined : t("Add vehicles in Settings → Factory.")} />
            <SelectField label={t("Driver")} selectedKey={driverId || "none"} onSelectionChange={(key) => setDriverId(key === "none" ? "" : String(key ?? ""))}
              items={[{ id: "none", label: t("No driver") }, ...workerItems]} />
          </FormRow>
          {options.canAddPeople ? <div><Button size="compact" variant="quiet" onPress={() => setAdding("driver")}><UserPlus aria-hidden="true" size={14} />{t("Add driver")}</Button></div> : null}
        </> : null}
        {(effectiveKind === "delivery" || effectiveKind === "installation") && projectId && options.members?.length
          ? <SelectField label={t("On site with a login")} selectedKey={siteMemberId || "manager"} onSelectionChange={(key) => setSiteMemberId(key === "manager" ? "" : String(key ?? ""))}
            items={[{ id: "manager", label: t("The project manager") }, ...options.members.map((member) => ({ id: member.id, label: member.name }))]} /> : null}
        {warnings.length ? <div className={styles.warnings} role="status" aria-live="polite">
          <strong>{t("Already booked that day")}</strong>
          <ul>{warnings.map((clash) => <li key={`${clash.kind}:${clash.id}:${clash.key}`}>{clashText(clash, t)}</li>)}</ul>
        </div> : null}
        <MoreDetails filled={note.trim() ? 1 : 0}><TextAreaField label={t("Note")} maxLength={500} value={note} onChange={setNote} /></MoreDetails>
      </> : null}
    </FormDialog>
    {adding ? <AddPersonDialog workspaceId={workspaceId} trade={adding === "driver" ? t("Driver") : t("Installer")} crews={options?.crews ?? []} onClose={() => setAdding(null)} onSaved={added} /> : null}
  </>;
}

/** Adds someone who isn't on the list by name and phone: a person without a Wodana login (HRMS). */
export function AddPersonDialog({ workspaceId, trade: initialTrade, crews, onClose, onSaved }: {
  workspaceId: string; trade: string; crews: LogisticsOptions["crews"]; onClose: () => void; onSaved: (worker: Worker) => void;
}) {
  const t = useT();
  const { regionLocale, locale } = useDesignSystem();
  const [id] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("");
  const [country, setCountry] = useState<string>(() => phoneCountry(null, regionLocale) ?? "");
  const [phone, setPhone] = useState("");
  const [trade, setTrade] = useState(initialTrade);
  const [crewId, setCrewId] = useState("none");
  return <FormDialog size="md" title={t("Add person")} submitLabel={t("Add")} onClose={onClose} isDirty={Boolean(name || phone)} isSubmitDisabled={!name.trim() || !trade.trim()}
    onSubmit={async () => onSaved(await logisticsApi(workspaceId).addPerson({ id, name: name.trim(), phone: phone.trim() ? joinPhone(country, phone) : "", trade: trade.trim(),
      crewId: crewId === "none" ? null : crewId }))}>
    <TextInput isRequired label={t("Name")} value={name} onChange={setName} maxLength={120} />
    <PhoneField label={t("Phone")} kind="any" locale={locale} value={phone} onChange={setPhone} countryCode={country} onCountryChange={setCountry} />
    <TextInput isRequired label={t("Trade")} value={trade} onChange={setTrade} maxLength={80} />
    {crews.length ? <SelectField label={t("Crew")} selectedKey={crewId} onSelectionChange={(key) => setCrewId(String(key ?? "none"))}
      items={[{ id: "none", label: t("No crew") }, ...crews.map((crew) => ({ id: crew.id, label: crew.name }))]} /> : null}
  </FormDialog>;
}
