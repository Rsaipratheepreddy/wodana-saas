"use client";
import { useState, useRef, useEffect, type ReactNode } from "react";
import Link from "next/link";
import {
  Plus,
  RefreshCw,
  MessageSquare,
  ArrowUpRight,
  ClipboardCheck,
  FileText,
} from "lucide-react";
import { Button, Checkbox, ControlledModalDialog, DataGrid, Form, IconButton, MultiSelectField, NumericInput, SearchInput, SegmentedControl, SelectField, TextAreaField, TextInput, type DataGridColumn } from "@/design-system";
import { CatalogChoiceField } from "@/components/pre-project/case-controls";
import type { CatalogChoice } from "@/lib/pre-project/content";
import { ProjectSchedule, type Milestone } from "./project-schedule";
import { ProjectWarehouse } from "./project-warehouse";
import { ProjectControls, type ControlKind } from "./project-controls";
import { ProjectCalendar } from "./project-calendar";
import { VendorComparison } from "./vendor-comparison";
import { jsonRequest, money } from "@/lib/commercial/client";
import {
  projectTabs,
  projectPath,
  taskProgress,
  label,
  type ProjectState,
  type ProjectData,
  type Task,
  type DailyReport,
  type Order,
  type Material,
  type ProjectWorkPackage,
} from "@/lib/projects/execution";
import s from "./project-workspace.module.css";
import theme from "../crm/crm-workspace-colors.module.css";
import { quantityToSource } from "@/lib/projects/purchasing";
import { ProjectAccounting } from "./project-accounting";
import { ProjectProduction } from "./project-production";
import { ProjectOrderDetail } from "./project-order-detail";
import { ProjectBoq } from "./project-boq";
import { ProjectOverview } from "./project-overview";
import { ProjectInitiation } from "./project-initiation";
import { ProjectTaskBoard } from "./project-task-board";
import { ProjectControlStrip } from "./project-control-strip";
import { DailyReportView } from "./daily-report-view";
import { DailyProgress, DailyReportEditor } from "./project-daily-progress";
import { ProjectConnectedPlan } from "./project-connected-plan";
type Field = {
  key: string;
  label: string;
  type?: "text" | "textarea" | "date" | "number" | "select" | "multi" | "check";
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
};
type Editor = {
  title: string;
  action: string;
  wrapper?: string;
  fields: Field[];
  value: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

const opts = (values: string[]) =>
  values.map((value) => ({ value, label: label(value) }));
const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  required = false,
  options?: Field["options"],
): Field => ({ key, label, type, required, options });
const Badge = ({ state }: { state: string }) => (
  <span className={s.status} data-state={state}>
    {label(state)}
  </span>
);
function Meter({ value }: { value: number }) {
  return (
    <span className={s.progress}>
      <span className={s.track}>
        <span style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      {Math.round(value)}%
    </span>
  );
}
function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <ClipboardCheck size={26} />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function ProjectWorkspace({
  initial,
  section,
}: {
  initial: ProjectState;
  section: string;
}) {
  const [state, setState] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [search, setSearch] = useState(""),
    [view, setView] = useState(section === "plan-teams" ? "schedule" : "all"),
    [selected, setSelected] = useState(""),
    [detailTab, setDetailTab] = useState("details"),
    [editor, setEditor] = useState<Editor | null>(null),
    [form, setForm] = useState<Record<string, unknown>>({}),
    [report, setReport] = useState<DailyReport | null>(null),
    [viewingReportId, setViewingReportId] = useState(""),
    [dispatchDraft, setDispatchDraft] = useState<
      Record<string, unknown> | undefined
    >(),
    [comment, setComment] = useState(""),
    [replyTo, setReplyTo] = useState(""),
    [mentions, setMentions] = useState<string[]>([]),
    [vendorLink, setVendorLink] = useState<{
      url: string;
      expiresAt: string;
      orderId: string;
    } | null>(null);
  const today = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: state.timezone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    return ["year", "month", "day"]
      .map((type) => parts.find((part) => part.type === type)?.value)
      .join("-");
  };
  const draftKey = `wodana.project.${initial.workspaceId}.${initial.id}.${initial.memberId}.report`;
  useEffect(() => {
    if (
      report &&
      ["draft", "returned"].includes(report.status) &&
      report.authorId === state.memberId
    ) {
      try {
        localStorage.setItem(draftKey, JSON.stringify(report));
      } catch {}
    }
  }, [report, draftKey, state.memberId]);
  const retry = useRef<{ body: string; id: string } | null>(null);
  const d = state.data,
    pre = `/workspace/pre-projects/cases/${state.caseId}`,
    task = d.tasks.find((t) => t.id === selected);
  const memberOptions = state.members.map((m) => ({
      value: m.id,
      label: m.name,
    })),
    taskOptions = d.tasks.map((t) => ({
      value: t.id,
      label: `${t.area ? `${t.area} · ` : ""}${t.title}`,
    })),
    handoverPackageOptions = (d.workPackages ?? [])
      .filter((workPackage) => workPackage.status !== "cancelled")
      .map((workPackage) => ({
        value: workPackage.id,
        label: `${workPackage.area ? `${workPackage.area} · ` : ""}${workPackage.title}`,
      })),
    handoverAreaOptions = [...new Set(d.tasks.map((task) => task.area).filter(Boolean))]
      .sort()
      .map((area) => ({ value: area, label: area })),
    clientApproverOptions = (state.clientApprovers ?? []).map((contact) => ({
      value: contact.id,
      label: contact.name,
    }));
  const person = (id: string) =>
    state.members.find((m) => m.id === id)?.name ?? "Unassigned";
  const resource = (id: string) =>
    state.resources.find((r) => r.id === id)?.name ?? "No team";
  const resourceColumns: DataGridColumn<ProjectState["resources"][number]>[] = [
    { accessorKey: "name", header: "Resource", meta: { renderCell: (item) => <><strong>{item.name}</strong><span className={s.detail}>{item.active ? "Active" : "Inactive"}</span></> } },
    { accessorKey: "kind", header: "Type / people", meta: { renderCell: (item) => <>{label(item.kind)}<span className={s.detail}>{item.members.map(person).join(", ") || "Capacity slot"}</span></> } },
    { id: "bookings", header: "Current bookings", meta: { renderCell: (item) => {
      const bookings = state.bookings.filter((booking) => booking.resourceId === item.id);
      return bookings.length ? bookings.map((booking) => <div className={s.timeline} key={booking.id}><strong>{booking.projectName}</strong><small>{booking.start} → {booking.end} · {booking.taskTitle}</small></div>) : "Available to book";
    } } },
    { id: "nextWork", header: "Next work", meta: { renderCell: (item) => d.tasks.filter((task) => task.resourceId === item.id && !state.bookings.some((booking) => booking.projectId === state.id && booking.taskId === task.id)).map((task) => <div key={task.id}><Button onPress={() => { setSelected(task.id); setDetailTab("details"); }} size="compact" variant="quiet">{task.title}</Button><span className={s.detail}>Assignment only · not booked</span></div>) } },
  ];
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const query = new URLSearchParams(window.location.search),
        id = query.get("record"),
        requestedView = query.get("view");
      if (
        requestedView &&
        [
          "all",
          "mine",
          "attention",
          "completed",
          "schedule",
          "teams",
          "calendar",
          "submitted",
          "approved",
          "returned",
          "issues",
          "enquiries",
          "dispatch",
          "commissioning",
          "technical_query",
          "transmittal",
          "retention",
          "supplier_return",
          "accounting",
          "warehouse",
        ].includes(requestedView)
      )
        setView(requestedView);
      if (!id) return;
      const data = initial.data,
        report = data.reports.find((r) => r.id === id);
      if (report) {
        setViewingReportId(report.id);
        return;
      }
      if (data.milestones?.some((m) => m.id === id)) {
        setView("schedule");
        return;
      }
      const task = data.tasks.find((t) => t.id === id),
        known = [
          ...data.orders,
          ...data.documents,
          ...data.snags,
          ...data.handovers,
          ...(data.dispatches ?? []),
          ...(data.commissioning ?? []),
          ...(data.technicalQueries ?? []),
          ...(data.transmittals ?? []),
          ...(data.retentions ?? []),
          ...(data.supplierReturns ?? []),
        ].some((r) => r.id === id);
      if (task || known) {
        setSelected(id);
        setDetailTab(
          (task || data.orders.some((o) => o.id === id)) &&
            query.get("tab") !== "comments"
            ? "details"
            : "comments",
        );
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initial, section]);
  async function refresh() {
    try {
      setBusy(true);
      setState(
        await jsonRequest<ProjectState>(
          projectPath(state.workspaceId, `${state.id}/execution`),
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function run(action: string, input: Record<string, unknown> = {}) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setSuccess("");
    const body = JSON.stringify({
      action,
      revision: state.data.revision,
      ...input,
    });
    if (retry.current?.body !== body)
      retry.current = { body, id: crypto.randomUUID() };
    try {
      const result = await jsonRequest<{ data: ProjectData }>(
        projectPath(state.workspaceId, `${state.id}/execution`),
        "POST",
        { ...JSON.parse(body), requestId: retry.current.id },
      );
      setState((prev) => ({ ...prev, data: result.data }));
      retry.current = null;
      setSuccess("Saved");
      if (["report", "report_submit"].includes(action)) {
        try {
          localStorage.removeItem(draftKey);
        } catch {}
      }
      // Commands return the updated record data, while the decision pulse,
      // booking availability and permissions are calculated by the state read.
      // Always refresh them so the next action reflects the command just saved.
      try {
        const refreshed = await jsonRequest<ProjectState>(
          projectPath(state.workspaceId, `${state.id}/execution`),
        );
        if (refreshed.id === state.id && refreshed.pulse && refreshed.data) {
          setState(refreshed);
        } else {
          setSuccess("Saved. Refresh to update next actions.");
        }
      } catch {
        // The command succeeded. Never ask the user to repeat it solely because
        // the follow-up read failed; retain its returned revision for safe retry.
        setSuccess("Saved. Refresh to update next actions.");
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function vendorAccess(orderId: string) {
    setBusy(true);
    setError("");
    try {
      const result = await jsonRequest<{ token: string; expiresAt: string }>(
        projectPath(state.workspaceId, `${state.id}/vendor-access`),
        "POST",
        { orderId },
      );
      setVendorLink({
        url: `${window.location.origin}/vendor/order#token=${result.token}`,
        expiresAt: result.expiresAt,
        orderId,
      });
      setState(
        await jsonRequest<ProjectState>(
          projectPath(state.workspaceId, `${state.id}/execution`),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function open(e: Editor) {
    setError("");
    setForm(structuredClone(e.value));
    setEditor(e);
  }
  function decision(
    title: string,
    action: string,
    id: string,
    extra: Record<string, unknown> = {},
    fields: Field[] = [f("note", "Evidence / reason", "textarea", true)],
  ) {
    open({
      title,
      action,
      value: { note: "", ...extra },
      extra: { id },
      fields,
    });
  }
  function editTask(t?: Task, parentId = "") {
    const parent = d.tasks.find((t) => t.id === parentId);
    const value = t ?? {
      id: crypto.randomUUID(),
      parentId,
      package: parent?.package ?? "Interior fit-out",
      title: "",
      description: "",
      area: parent?.area ?? "",
      location: section === "production" ? "factory" : "site",
      ownerId: "",
      assigneeIds: [],
      resourceId: "",
      start: today(),
      end: today(),
      predecessors: [],
      quantity: 1,
      unit: "nos",
      weight: 1,
      priority: "normal",
      inspectionRequired: true,
      scopeIds: [],
      drawingId: "",
      readiness: { scope: false, access: false, materials: false },
    };
    open({
      title: t ? "Edit task" : parentId ? "Add subtask" : "Add task",
      action: "task",
      wrapper: "task",
      value: {
        ...value,
        scopeReady: value.readiness.scope,
        accessReady: value.readiness.access,
        materialsReady: value.readiness.materials,
      },
      fields: [
        f("title", "Task name", "text", true),
        f("description", "Description", "textarea"),
        f("package", "Work package", "text", true),
        f("area", "Room / area"),
        f(
          "parentId",
          "Parent task",
          "select",
          false,
          taskOptions.filter((x) => x.value !== t?.id),
        ),
        f(
          "location",
          "Work location",
          "select",
          true,
          opts(["site", "factory", "office"]),
        ),
        f("ownerId", "Accountable owner", "select", false, memberOptions),
        f("assigneeIds", "People assigned", "multi", false, memberOptions),
        f(
          "resourceId",
          "Crew / factory",
          "select",
          false,
          state.resources
            .filter((r) => r.active)
            .map((r) => ({ value: r.id, label: r.name })),
        ),
        f("start", "Planned start", "date", true),
        f("end", "Planned finish", "date", true),
        f("quantity", "Planned quantity", "number", true),
        f("unit", "Unit", "text", true),
        {
          ...f("weight", "Progress weight", "number", true),
          hint: "Relative weight within its parent. Frozen once progress is reported.",
        },
        f(
          "priority",
          "Priority",
          "select",
          true,
          opts(["normal", "high", "urgent"]),
        ),
        f(
          "predecessors",
          "Preceding tasks",
          "multi",
          false,
          taskOptions.filter((x) => x.value !== t?.id),
        ),
        f(
          "scopeIds",
          "Released BOQ lines",
          "multi",
          false,
          [
            ...(d.scope?.lines ?? []),
            ...(d.variations ?? [])
              .filter((v) => v.direction !== "deduction")
              .flatMap((v) => v.lines),
          ].map((l) => ({ value: l.id, label: `${l.room} · ${l.title}` })),
        ),
        f(
          "drawingId",
          "Approved drawing / specification",
          "select",
          false,
          d.documents
            .filter((x) => x.status === "approved")
            .map((x) => ({ value: x.id, label: `${x.title} · ${x.revision}` })),
        ),
        f("scopeReady", "Approved scope confirmed", "check"),
        f("accessReady", "Access / permits confirmed", "check"),
        f("materialsReady", "Materials ready", "check"),
        f(
          "inspectionRequired",
          "Requires inspection after completion",
          "check",
        ),
      ],
    });
  }
  function editMaterial() {
    open({
      title: "Material requirement",
      action: "material",
      wrapper: "material",
      value: {
        title: "",
        specification: "",
        catalogId: "",
        catalogVersion: 0,
        unit: "nos",
        required: 1,
        supply: "company",
        taskId: "",
        needBy: today(),
      },
      fields: [
        f("title", "Material", "text", true),
        f(
          "specification",
          "Material specification / catalog reference",
          "textarea",
          true,
        ),
        f("required", "Required quantity", "number", true),
        f("unit", "Unit", "text", true),
        f(
          "supply",
          "Supplied by",
          "select",
          true,
          opts(["company", "vendor", "client"]),
        ),
        f("taskId", "Required for task", "select", false, taskOptions),
        f("needBy", "Needed by", "date", true),
      ],
    });
  }
  function editOrder(
    current?: Order,
    enquiry = false,
    source?: Material | Task,
  ) {
    enquiry = enquiry || current?.status === "enquiry";
    open({
      title: enquiry
        ? "Vendor quotation enquiry"
        : current
          ? "Edit draft order"
          : "New purchase / subcontract order",
      action: enquiry ? "enquiry" : "order",
      wrapper: "order",
      value: current ? { ...current, leadTimeDays: current.leadTimeDays ?? 1 } : {
        title: source?.title ?? "",
        vendor: "",
        vendorContact: "",
        kind: source && "location" in source ? "factory" : "material",
        materialId: source && "supply" in source ? source.id : "",
        taskId: source ? ("supply" in source ? source.taskId : source.id) : "",
        quantity: source
          ? "required" in source
            ? source.required
            : source.quantity
          : 1,
        unit: source?.unit ?? "nos",
        unitCost: 0,
        leadTimeDays: 1,
        promisedDate: source
          ? "needBy" in source
            ? source.needBy
            : source.end
          : today(),
      },
      fields: [
        f("title", "Order scope", "text", true),
        f("vendor", "Vendor / subcontractor", "text", true),
        f("vendorContact", "Contact / quotation reference"),
        f(
          "kind",
          "Order type",
          "select",
          true,
          opts(["material", "subcontract", "factory"]),
        ),
        f(
          "materialId",
          "Material requirement",
          "select",
          false,
          d.materials
            .filter((m) => m.supply === "company")
            .map((m) => ({ value: m.id, label: m.title })),
        ),
        f("taskId", "Linked task", "select", false, taskOptions),
        f("quantity", "Quantity", "number", true),
        f("unit", "Unit", "text", true),
        f(
          "unitCost",
          `Unit cost (${d.scope?.currency ?? "AED"})`,
          "number",
          true,
        ),
        f("promisedDate", "Delivery / completion date", "date", true),
        f("leadTimeDays", "Supplier lead time (days)", "number", true),
      ],
    });
  }
  function advanceOrder(order: Order) {
    if (order.status === "enquiry") {
      setSelected("");
      setView("enquiries");
      return;
    }
    if (["draft", "submitted"].includes(order.status)) {
      void run("order_status", {
        id: order.id,
        status: order.status === "draft" ? "submitted" : "approved",
      });
      return;
    }
    if (order.status === "approved") {
      const latest = order.vendorUpdates
        ?.filter((u) => u.kind === "acknowledgement")
        .at(-1);
      decision(
        "Confirm vendor dates & scope",
        "order_status",
        order.id,
        {
          status: "acknowledged",
          promisedDate: latest?.date || order.promisedDate,
          note: latest?.note || "",
        },
        [
          f("promisedDate", "Confirmed delivery date", "date", true),
          f("note", "Vendor confirmation reference", "textarea", true),
        ],
      );
      return;
    }
    if (order.status === "acknowledged") {
      const remaining =
        order.quantity - order.receipts.reduce((n, r) => n + r.accepted, 0);
      if (remaining <= 0) {
        void run("order_status", { id: order.id, status: "closed" });
        return;
      }
      const delivery = order.vendorUpdates
        ?.filter((u) => u.kind === "delivery")
        .at(-1);
      decision(
        "Verify delivery / service receipt",
        "receipt",
        order.id,
        { accepted: 0, rejected: 0, note: delivery?.evidence || "" },
        [
          f(
            "accepted",
            `Accepted quantity · ${remaining} ${order.unit} outstanding`,
            "number",
            true,
          ),
          f("rejected", "Rejected quantity", "number", true),
          f("note", "Delivery / inspection evidence", "textarea", true),
        ],
      );
    }
  }
  function editDocument(replaces = "") {
    const old = d.documents.find((x) => x.id === replaces);
    open({
      title: old ? "New document revision" : "Add document",
      action: "document",
      wrapper: "document",
      value: {
        title: old?.title ?? "",
        kind: old?.kind ?? "drawing",
        revision: "",
        url: "",
        note: "",
        replaces,
      },
      fields: [
        f("title", "Document title", "text", true),
        f(
          "kind",
          "Document type",
          "select",
          true,
          opts([
            "drawing",
            "specification",
            "permit",
            "as_built",
            "manual",
            "warranty",
            "other",
          ]),
        ),
        f("revision", "Revision", "text", true),
        f("url", "Secure file link (HTTPS)"),
        f("note", "Controlled file reference / notes", "textarea"),
      ],
    });
  }
  function editSnag() {
    open({
      title: "Record a snag",
      action: "snag",
      wrapper: "snag",
      value: {
        title: "",
        taskId: "",
        area: "",
        ownerId: "",
        severity: "minor",
        dueDate: today(),
        evidence: "",
      },
      fields: [
        f("title", "Defect", "text", true),
        f("area", "Room / area", "text", true),
        f("taskId", "Related task", "select", false, taskOptions),
        f("ownerId", "Responsible person", "select", false, memberOptions),
        f(
          "severity",
          "Severity",
          "select",
          true,
          opts(["minor", "major", "critical"]),
        ),
        f("dueDate", "Fix by", "date", true),
        f(
          "evidence",
          "Photo / inspection reference and description",
          "textarea",
          true,
        ),
      ],
    });
  }
  function editHandover() {
    open({
      title: "Generate handover pack",
      action: "handover",
      wrapper: "handover",
      value: {
        area: "",
        sourcePackageId: "",
        warrantyUntil: "",
        clientReviewDueDate: "",
        clientApproverId: clientApproverOptions.length === 1 ? clientApproverOptions[0].value : "",
      },
      fields: [
        {
          ...f(
            "sourcePackageId",
            "Delivery package",
            "select",
            false,
            handoverPackageOptions,
          ),
          hint: "Best for a partial delivery. Scope, evidence and closeout documents are generated automatically.",
        },
        f(
          "area",
          "Or hand over a full room / area",
          "select",
          false,
          handoverAreaOptions,
        ),
        f("warrantyUntil", "Warranty until", "date"),
        f("clientReviewDueDate", "Client decision due", "date"),
        {
          ...f(
            "clientApproverId",
            "Client portal approver",
            "select",
            false,
            clientApproverOptions,
          ),
          hint: clientApproverOptions.length
            ? "Optional for a signed on-site handover. Choose the client contact when this pack should be approved in the portal."
            : "No active client portal approver is configured. A signed acceptance record can still be used.",
        },
      ],
    });
  }
  function editResource() {
    open({
      title: "Add shared resource",
      action: "resource",
      wrapper: "resource",
      value: { name: "", kind: "crew", members: [], active: true },
      fields: [
        f("name", "Team / factory name", "text", true),
        f(
          "kind",
          "Resource type",
          "select",
          true,
          opts(["crew", "person", "factory", "vendor"]),
        ),
        f("members", "Team members", "multi", false, memberOptions),
      ],
    });
  }
  function editMilestone(milestone?: Milestone) {
    open({
      title: milestone ? "Edit milestone" : "Add milestone",
      action: "milestone",
      wrapper: "milestone",
      value: milestone ?? {
        title: "",
        dueDate: today(),
        ownerId: "",
        taskIds: [],
        visibleToClient: false,
      },
      fields: [
        f("title", "Milestone", "text", true),
        f("dueDate", "Target date", "date", true),
        f("ownerId", "Accountable owner", "select", true, memberOptions),
        f("taskIds", "Required work", "multi", true, taskOptions),
        {
          ...f("visibleToClient", "Show in client portal", "check"),
          hint: "Publish this milestone date and progress to authorized client contacts.",
        },
      ],
    });
  }
  function editWorkPackage(workPackage: ProjectWorkPackage) {
    open({
      title: "Plan delivery package",
      action: "work_package",
      wrapper: "workPackage",
      value: {
        ...workPackage,
        predecessorPackageIds: workPackage.predecessorPackageIds ?? [],
        priority: workPackage.priority ?? "normal",
        risk: workPackage.risk ?? "on_track",
        nextAction: workPackage.nextAction ?? "",
        nextActionOwnerId: workPackage.nextActionOwnerId ?? "",
        nextActionDate: workPackage.nextActionDate ?? "",
        recoveryPlan: workPackage.recoveryPlan ?? "",
      },
      fields: [
        f("title", "Package name", "text", true),
        f("area", "Room / area"),
        f("deliveryRoute", "Delivery route", "select", true, opts(["mixed", "office", "factory", "vendor", "site"])),
        f("status", "Status", "select", true, opts(["planning", "ready", "in_progress", "on_hold", "blocked", "completed", "cancelled"])),
        f("ownerId", "Accountable owner", "select", false, memberOptions),
        f("plannedStart", "Planned start", "date"),
        f("plannedEnd", "Planned finish", "date"),
        f(
          "predecessorPackageIds",
          "Depends on packages",
          "multi",
          false,
          (d.workPackages ?? [])
            .filter((candidate) => candidate.id !== workPackage.id && candidate.status !== "cancelled")
            .map((candidate) => ({ value: candidate.id, label: candidate.title })),
        ),
        f("priority", "Priority", "select", true, opts(["normal", "high", "critical"])),
        f("risk", "Risk", "select", true, opts(["on_track", "watch", "blocked"])),
        f("nextAction", "Next action"),
        f("nextActionOwnerId", "Next action owner", "select", false, memberOptions),
        f("nextActionDate", "Next action due", "date"),
        f("recoveryPlan", "Recovery plan", "textarea"),
        f("blocker", "Hold / blocker reason", "textarea"),
      ],
    });
  }
  const schedule = (
    <>
      <ProjectConnectedPlan state={state} onEdit={editWorkPackage} />
      <ProjectSchedule
        state={state}
        run={run}
        busy={busy}
        onTask={(t) => {
          setSelected(t.id);
          setDetailTab("details");
        }}
        onMilestone={editMilestone}
        onAccept={(m) => decision("Accept milestone", "accept_milestone", m.id)}
      />
    </>
  );
  function newReport(t?: Task, prior?: DailyReport) {
    setViewingReportId("");
    setError("");
    if (!t && !prior) {
      try {
        const cached = JSON.parse(
          localStorage.getItem(draftKey) ?? "null",
        ) as DailyReport | null;
        if (
          cached &&
          cached.authorId === state.memberId &&
          cached.id &&
          Array.isArray(cached.entries)
        ) {
          setReport(cached);
          setSuccess("Restored unsent draft from this device");
          return;
        }
      } catch {}
    }
    setReport(
      prior
        ? {
            ...structuredClone(prior),
            id: crypto.randomUUID(),
            status: "draft",
            supersedes: prior.id,
            publishedAt: undefined,
            clientFileIds: [],
            reviewedAt: undefined,
            reviewedBy: undefined,
          }
        : {
            id: crypto.randomUUID(),
            date: today(),
            shift: "Day shift",
            location:
              t?.location === "factory" || section === "production"
                ? "factory"
                : "site",
            authorId: state.memberId,
            author: person(state.memberId),
            status: "draft",
            entries: t ? [{ taskId: t.id, quantity: 0 }] : [],
            hours: 8,
            people: 1,
            materials: "",
            issues: "",
            tomorrow: "",
            evidence: "",
            note: "",
          },
    );
  }
  const primary =
    section === "plan-teams" ||
    section === "site-work" ||
    section === "production"
      ? { label: "Add task", fn: () => editTask(), allowed: state.canManage }
      : section === "daily-progress"
        ? {
            label: "Add daily update",
            fn: () => newReport(),
            allowed: state.canReport,
          }
        : section === "material-planning"
          ? {
              label: "Add requirement",
              fn: editMaterial,
              allowed: state.canManage,
            }
          : section === "procurement"
            ? {
                label: "New order",
                fn: () => editOrder(),
                allowed: state.canBuy,
              }
            : section === "documents"
              ? {
                  label: "Add document",
                  fn: () => editDocument(),
                  allowed: state.canManage,
                }
              : section === "snagging"
                ? {
                    label: "Record snag",
                    fn: editSnag,
                    allowed: state.canReport,
                  }
                : section === "handover"
                  ? {
                      label: "Prepare handover",
                      fn: editHandover,
                      allowed: state.canManage,
                    }
                  : null;
  const filtered = (text: string) =>
    text.toLowerCase().includes(search.toLowerCase());
  const taskView = ["plan-teams", "site-work", "production"].includes(section),
    tasks = d.tasks.filter(
      (t) =>
        t.status !== "cancelled" &&
        (section !== "production" || t.location === "factory") &&
        (section !== "site-work" || t.location === "site") &&
        (view === "all" ||
          view === "schedule" ||
          view === "teams" ||
          (view === "mine" &&
            (t.ownerId === state.memberId ||
              t.assigneeIds.includes(state.memberId))) ||
          (view === "attention" &&
            (t.status === "blocked" ||
              (!["completed", "cancelled"].includes(t.status) &&
                t.end < today()))) ||
          (view === "completed" && t.status === "completed")) &&
        filtered(`${t.title} ${t.area} ${t.package}`),
    );
  const record = [
    ...d.tasks,
    ...d.reports,
    ...d.orders,
    ...d.documents,
    ...d.snags,
    ...d.handovers,
    ...(d.dispatches ?? []),
    ...(d.commissioning ?? []),
    ...(d.technicalQueries ?? []),
    ...(d.transmittals ?? []),
    ...(d.retentions ?? []),
    ...(d.supplierReturns ?? []),
  ].find((r) => r.id === selected);
  const comments = d.comments.filter((c) => c.recordId === selected);
  function conversation(id: string) {
    setReplyTo("");
    setMentions([]);
    setComment("");
    setSelected(id);
    setDetailTab("comments");
  }
  const taskBoard = (
    <ProjectTaskBoard
      state={state}
      tasks={tasks}
      busy={busy}
      showEmptyLanes={["all", "mine", "schedule", "teams"].includes(view)}
      onOpen={(task) => {
        setSelected(task.id);
        setDetailTab("details");
      }}
      onComments={(task) => conversation(task.id)}
      onMove={(task, status) => {
        if (status === "blocked") {
          decision("Block task", "task_status", task.id, { status }, [
            f("note", "Reason", "textarea", true),
          ]);
          return;
        }
        void run("task_status", { id: task.id, status });
      }}
    />
  );
  return (
    <section
      className={`${theme.theme} ${s.page}`}
      aria-label={`${projectTabs.find(([id]) => id === section)?.[1]} workspace`}
    >
      <header className={s.header} data-compact={section !== "overview" || undefined}>
        <div className={s.projectIdentity}>
          <div className={s.heading}><h1>{state.name}</h1><Badge state={d.phase} /></div>
          <p>{state.customer}</p>
        </div>
        <div className={s.actions}>
          <span role="status" className={s.muted}>
            {busy ? "Saving…" : success}
          </span>
          <IconButton
            aria-label="Refresh project"
            isDisabled={busy}
            onPress={() => void refresh()}
          >
            <RefreshCw size={16} />
          </IconButton>
          {primary?.allowed &&
            ![
              "dispatch",
              "commissioning",
              "technical_query",
              "transmittal",
              "retention",
              "supplier_return",
              "warehouse",
              "calendar",
              "legacy",
            ].includes(view) && (
              <Button isDisabled={busy} onPress={primary.fn} size="compact" variant="primary">
                <Plus size={16} />
                {primary.label}
              </Button>
            )}
        </div>
      </header>
      <ProjectControlStrip state={state} busy={busy} run={run} compact={section !== "overview"} />
      {error && !editor && !report && (
        <div className={s.error} role="alert">
          {error}{" "}
          <Button onPress={() => void refresh()} size="compact" variant="quiet">
            Refresh project
          </Button>
        </div>
      )}
      {!state.commercialReady && (
        <div className={s.notice}>
          <strong>Execution not released.</strong> A quotation, agreement or required payment approval is still pending.{" "}
          <Link href={`${pre}/execution-release`}>Review release →</Link>
        </div>
      )}
      {!["overview", "boq"].includes(section) && (
        <div className={s.toolbar}>
          <div className={s.tabs}>
            <SegmentedControl label="Views" options={(taskView
              ? [
                  [
                    "all",
                    section === "production" ? "Manufacturing jobs" : "Tasks",
                  ],
                  ["mine", "My work"],
                  ["attention", "Needs attention"],
                  ["completed", "Completed"],
                  ...(section === "production"
                    ? [["dispatch", "Dispatch"]]
                    : section === "site-work"
                      ? [
                          ["commissioning", "Commissioning"],
                          ["technical_query", "Technical queries"],
                        ]
                      : []),
                  ...(section === "plan-teams"
                    ? [
                        ["schedule", "Schedule & milestones"],
                        ["teams", "Teams & bookings"],
                        ["calendar", "Work calendars"],
                      ]
                    : []),
                ]
              : section === "daily-progress"
                ? [
                    ["all", "All updates"],
                    ["draft", "Drafts"],
                    ["submitted", "To review"],
                    ["approved", "Approved"],
                    ["returned", "Returned"],
                    ["issues", "Issues & blockers"],
                  ]
                : section === "procurement"
                  ? [
                      ["all", "Orders"],
                      ["enquiries", "Enquiries & comparison"],
                      ["supplier_return", "Returns & credits"],
                    ]
                  : section === "material-planning" &&
                      (state.canBuy || state.canManage)
                    ? [
                        ["all", "Requirements & stock"],
                        ["warehouse", "Warehouse & transfers"],
                      ]
                    : section === "documents"
                      ? [
                          ["all", "Documents"],
                          ["technical_query", "Technical queries"],
                          ["transmittal", "Transmittals"],
                        ]
                      : section === "commercial"
                        ? [
                            ["all", "Financial plan"],
                            ["accounting", "Payments & Books"],
                            ["retention", "Retention"],
                          ]
                : [["all", "All records"]]
            ).map(([id, title]) => ({ id, label: title }))} value={view} onChange={setView} />
          </div>
          <div className={s.search}><SearchInput label="Search project records" placeholder="Search this view…" value={search} onChange={setSearch} /></div>
        </div>
      )}
      {view === "warehouse" ? (
        <ProjectWarehouse state={state} onRefresh={refresh} />
      ) : [
          "dispatch",
          "commissioning",
          "technical_query",
          "transmittal",
          "retention",
          "supplier_return",
        ].includes(view) ? (
        <ProjectControls
          key={view}
          state={state}
          kind={view as ControlKind}
          run={run}
          busy={busy}
          search={search}
          onOpenRecord={conversation}
          serverError={error}
          initialValues={view === "dispatch" ? dispatchDraft : undefined}
        />
      ) : view === "calendar" ? (
        <ProjectCalendar state={state} run={run} busy={busy} />
      ) : section === "boq" ? (
        <ProjectBoq state={state} />
      ) : section === "overview" ? (
        <><ProjectInitiation state={state} busy={busy} run={run} /><ProjectOverview
          state={state}
          today={today()}
          open={(id) => {
            const r = d.reports.find((r) => r.id === id);
            if (r) setViewingReportId(r.id);
            else {
              setSelected(id);
              setDetailTab("details");
            }
          }}
          conversation={conversation}
        /></>
      ) : taskView ? (
        section === "production" &&
        ["all", "mine", "attention", "completed"].includes(view) ? (
          <ProjectProduction
            state={state}
            tasks={tasks}
            busy={busy}
            onOpen={(t) => {
              setSelected(t.id);
              setDetailTab("details");
            }}
            onStart={(t) =>
              void run("task_status", { id: t.id, status: "in_progress" })
            }
            onReport={(t) => newReport(t)}
            onDispatch={(t) => {
              const receivingTasks = d.tasks.filter(
                (candidate) =>
                  candidate.location === "site" &&
                  !["completed", "cancelled"].includes(candidate.status) &&
                  candidate.predecessors.includes(t.id),
              );
              const receivingTask =
                receivingTasks.length === 1 ? receivingTasks[0] : undefined;
              setDispatchDraft({
                title: `${t.title} · delivery`,
                taskId: t.id,
                receivingTaskId: receivingTask?.id ?? "",
                quantity: Math.max(
                  0,
                  t.approved -
                    (d.dispatches ?? [])
                      .filter(
                        (x) =>
                          x.taskId === t.id &&
                          ["ready", "dispatched", "received"].includes(x.status),
                      )
                      .reduce((n, x) => n + x.quantity - x.rejected, 0),
                ),
                dueDate: t.end,
                destination: receivingTask?.area
                  ? `${state.name} · ${receivingTask.area}`
                  : state.name,
              });
              setView("dispatch");
            }}
            onOrder={(t) => editOrder(undefined, true, t)}
          />
        ) : view === "schedule" ? (
          schedule
        ) : view === "teams" ? (
          <>
            <div className={s.row}>
              <p className={s.muted}>
                Shared capacity across projects. Team members and approved leave
                are checked when confirming a booking.
              </p>
              {state.canManage && <Button onPress={editResource} size="compact"><Plus size={14} />Add resource</Button>}
            </div>
            <div className={s.scroll}>
              <DataGrid appearance="flush" ariaLabel="Project resources" columns={resourceColumns} data={state.resources.filter((item) => filtered(item.name))} emptyTitle="No resources yet" emptyDescription="Add a team or factory slot, then confirm bookings from the work plan." getRowId={(item) => item.id} rowNumbers={false} selectable={false} showToolbar={false} />
            </div>
          </>
        ) : (
          taskBoard
        )
      ) : section === "daily-progress" ? (
        <DailyProgress
          state={state}
          today={today()}
          view={view}
          search={search}
          busy={busy}
          run={run}
          onOpen={(r) => setViewingReportId(r.id)}
          onComments={conversation}
          onPublish={(r) =>
            decision("Publish reviewed update", "publish_report", r.id, {}, [
              f(
                "fileIds",
                "Photos and files to share with the client",
                "multi",
                true,
                (d.files ?? [])
                  .filter((file) => file.recordId === r.id)
                  .map((file) => ({ value: file.id, label: file.name })),
              ),
            ])
          }
          onReturn={(r) =>
            decision("Return daily update", "return_report", r.id)
          }
        />
      ) : section === "material-planning" ? (
        <>
          <div className={s.scroll}>
            <table data-record-table="" className={s.table}>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Used for</th>
                  <th>Demand</th>
                  <th>Stock position</th>
                  <th>Needed by</th>
                  <th>Next step</th>
                </tr>
              </thead>
              <tbody>
                {d.materials
                  .filter((m) => filtered(`${m.title} ${m.specification}`))
                  .map((m) => {
                    const stock = m.movements.reduce(
                        (n, x) =>
                          n +
                          (["receive", "return"].includes(x.kind)
                            ? x.quantity
                            : -x.quantity),
                        0,
                      ),
                      received = m.movements
                        .filter((x) => x.kind === "receive")
                        .reduce((n, x) => n + x.quantity, 0);
                    return (
                      <tr key={m.id}>
                        <td>
                          <strong>{m.title}</strong>
                          <span className={s.detail}>{m.specification}</span>
                        </td>
                        <td>
                          {label(m.supply)}
                          <span className={s.detail}>
                            {d.tasks.find((t) => t.id === m.taskId)?.title}
                          </span>
                        </td>
                        <td>
                          {m.required} {m.unit}
                          <span className={s.detail}>
                            {Math.max(0, m.required - received)} remaining to
                            receive
                          </span>
                        </td>
                        <td>
                          {stock} {m.unit}
                          <span className={s.detail}>
                            {(m.reservations ?? []).reduce(
                              (n, r) => n + r.quantity,
                              0,
                            )}{" "}
                            reserved ·{" "}
                            {stock -
                              (m.reservations ?? []).reduce(
                                (n, r) => n + r.quantity,
                                0,
                              )}{" "}
                            available
                          </span>
                          {m.reservations
                            ?.filter((r) => r.quantity > 0)
                            .map((r) => (
                              <span className={s.detail} key={r.taskId}>
                                {r.quantity} →{" "}
                                {d.tasks.find((t) => t.id === r.taskId)?.title}
                              </span>
                            ))}
                        </td>
                        <td>{m.needBy}</td>
                        <td>
                          {state.canBuy && m.supply === "company" && (quantityToSource(m,d.orders)>0 ? (
                            <button className={s.button} onClick={()=>editOrder(undefined,true,{...m,required:quantityToSource(m,d.orders)})}>Order {quantityToSource(m,d.orders)} {m.unit}</button>
                          ): <span className={s.detail}>Covered by accepted stock and existing orders</span>)}
                          {state.canManage && (
                            <div className={s.actions}>
                              <button
                                className={s.button}
                                onClick={() =>
                                  decision(
                                    "Allocate stock to work",
                                    "reserve_material",
                                    m.id,
                                    { taskId: m.taskId, quantity: 0 },
                                    [
                                      f(
                                        "taskId",
                                        "Work that will use it",
                                        "select",
                                        true,
                                        taskOptions,
                                      ),
                                      {
                                        ...f(
                                          "quantity",
                                        "Quantity to allocate",
                                          "number",
                                          true,
                                        ),
                                        hint: "Enter 0 to remove the allocation from the selected work.",
                                      },
                                      f(
                                        "note",
                                        "Allocation note",
                                        "textarea",
                                        true,
                                      ),
                                    ],
                                  )
                                }
                              >
                                Allocate stock
                              </button>
                              <button
                                className={s.button}
                                onClick={() =>
                                  decision(
                                    "Update stock quantity",
                                    "material_move",
                                    m.id,
                                    {
                                      kind: "issue",
                                      quantity: 0,
                                      taskId: m.taskId,
                                    },
                                    [
                                      f(
                                        "kind",
                                        "What happened",
                                        "select",
                                        true,
                                        opts(
                                          m.supply === "company"
                                            ? ["issue", "return", "waste"]
                                            : [
                                                "receive",
                                                "issue",
                                                "return",
                                                "waste",
                                              ],
                                        ),
                                      ),
                                      f("quantity", "Quantity", "number", true),
                                      f(
                                        "taskId",
                                        "For task",
                                        "select",
                                        false,
                                        taskOptions,
                                      ),
                                      f(
                                        "note",
                                        "Delivery or stock evidence",
                                        "textarea",
                                        true,
                                      ),
                                    ],
                                  )
                                }
                              >
                                Update stock
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {!d.materials.length && (
              <Empty title="Plan materials against the actual work">
                Define the material and supply responsibility. Company orders
                create accepted stock through verified receipts.
              </Empty>
            )}
          </div>
          <p className={s.muted}>
            Allocate received stock to the work that will use it. Ordering demand is calculated from accepted receipts, current stock and existing orders.
          </p>
        </>
      ) : section === "procurement" ? (
        <>
          {state.canBuy && (
            <div className={s.row}>
              <p className={s.muted}>
                Source, compare, approve and receive against the same project
                requirements.
              </p>
              <button
                className={s.button}
                onClick={() => editOrder(undefined, true)}
              >
                New enquiry
              </button>
            </div>
          )}
          {view === "enquiries" ? (
            <VendorComparison
              state={state}
              onForm={(id) => void vendorAccess(id)}
              onEdit={(o) => editOrder(o)}
              onChoose={(o) => {
                const offer = o.vendorUpdates
                  ?.filter((u) => u.kind === "quotation")
                  .at(-1);
                decision(
                  "Select vendor offer",
                  "award_enquiry",
                  o.id,
                  {
                    unitCost: offer?.unitCost ?? o.unitCost,
                    promisedDate: offer?.date || o.promisedDate,
                  },
                  [
                    f("unitCost", "Agreed unit cost", "number", true),
                    f("promisedDate", "Agreed delivery date", "date", true),
                    f(
                      "note",
                      "Comparison, scope and selection evidence",
                      "textarea",
                      true,
                    ),
                  ],
                );
              }}
            />
          ) : (
            <>
              <div className={s.scroll}>
                <table data-record-table="" className={s.table}>
                  <thead>
                    <tr>
                      <th>Order / vendor</th>
                      <th>Value</th>
                      <th>Promised date</th>
                      <th>Accepted</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.orders
                      .filter(
                        (o) =>
                          o.status !== "enquiry" &&
                          filtered(`${o.title} ${o.vendor} ${o.number}`),
                      )
                      .map((o) => (
                        <tr key={o.id}>
                          <td>
                            <button
                              className={s.link}
                              onClick={() => {
                                setSelected(o.id);
                                setDetailTab("details");
                              }}
                            >
                              {o.number} · {o.title} <ArrowUpRight size={13} />
                            </button>
                            <span className={s.detail}>
                              {o.vendor} · {label(o.kind)}
                            </span>
                            {o.acknowledgement && (
                              <span className={s.detail}>
                                {o.acknowledgement}
                              </span>
                            )}
                            {o.vendorUpdates?.length ? (
                              <button
                                className={s.link}
                                onClick={() => conversation(o.id)}
                              >
                                {o.vendorUpdates.length} vendor updates
                              </button>
                            ) : null}
                          </td>
                          <td>{money(o.quantity * o.unitCost, o.currency)}</td>
                          <td>{o.promisedDate}</td>
                          <td>
                            {o.receipts.reduce((n, r) => n + r.accepted, 0)} /{" "}
                            {o.quantity} {o.unit}
                            <span className={s.detail}>
                              {o.receipts.reduce((n, r) => n + r.rejected, 0)}{" "}
                              rejected
                            </span>
                          </td>
                          <td>
                            <Badge state={o.status} />
                          </td>
                          <td>
                            <div className={s.actions}>
                              {state.canBuy &&
                                !["closed", "cancelled"].includes(o.status) && (
                                  <button
                                    className={s.button}
                                    disabled={busy}
                                    onClick={() => void vendorAccess(o.id)}
                                  >
                                    Vendor form
                                  </button>
                                )}
                              {state.canBuy && o.status === "draft" && (
                                <>
                                  <button
                                    className={s.button}
                                    onClick={() => editOrder(o)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className={s.button}
                                    disabled={busy}
                                    onClick={() =>
                                      void run("order_status", {
                                        id: o.id,
                                        status: "submitted",
                                      })
                                    }
                                  >
                                    Submit
                                  </button>
                                </>
                              )}
                              {state.canBuy &&
                                state.canReview &&
                                o.status === "submitted" && (
                                  <button
                                    className={s.button}
                                    disabled={busy}
                                    onClick={() =>
                                      void run("order_status", {
                                        id: o.id,
                                        status: "approved",
                                      })
                                    }
                                  >
                                    Approve order
                                  </button>
                                )}
                              {state.canBuy && o.status === "approved" && (
                                <button
                                  className={s.button}
                                  onClick={() =>
                                    decision(
                                      "Vendor acknowledgement",
                                      "order_status",
                                      o.id,
                                      { status: "acknowledged" },
                                    )
                                  }
                                >
                                  Record acknowledgement
                                </button>
                              )}
                              {state.canBuy && o.status === "acknowledged" && (
                                <>
                                  <button
                                    className={s.button}
                                    onClick={() =>
                                      decision(
                                        "Verify delivery / service receipt",
                                        "receipt",
                                        o.id,
                                        { accepted: 0, rejected: 0 },
                                        [
                                          f(
                                            "accepted",
                                            "Accepted quantity",
                                            "number",
                                            true,
                                          ),
                                          f(
                                            "rejected",
                                            "Rejected quantity",
                                            "number",
                                            true,
                                          ),
                                          f(
                                            "note",
                                            "Delivery / inspection evidence",
                                            "textarea",
                                            true,
                                          ),
                                        ],
                                      )
                                    }
                                  >
                                    Receive
                                  </button>
                                  <button
                                    className={s.button}
                                    disabled={busy}
                                    onClick={() =>
                                      void run("order_status", {
                                        id: o.id,
                                        status: "closed",
                                      })
                                    }
                                  >
                                    Close order
                                  </button>
                                </>
                              )}
                              <button
                                className={s.icon}
                                aria-label={`Comments on ${o.number}`}
                                onClick={() => conversation(o.id)}
                              >
                                <MessageSquare size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!d.orders.length && (
                  <Empty title="Buy against clear requirements">
                    Record the selected vendor offer, approve within budget,
                    confirm dates and verify partial deliveries.
                  </Empty>
                )}
              </div>
              <p className={s.muted}>
                Order approval records an internal commitment. It does not send
                a purchase order or create a vendor bill automatically.
              </p>
            </>
          )}
        </>
      ) : section === "documents" ? (
        <section className={s.documentWorkspace} aria-label="Scope and design records">
          <div className={s.scopeConnection}>
            <div><strong>Scope, design and delivery stay connected</strong><span>{d.scope?.lines.length ?? 0} approved BOQ items · {d.documents.filter((document) => document.status === "approved").length} approved files</span></div>
            <div><Link href={`/workspace/projects/${state.id}/boq`}>Open BOQ <ArrowUpRight size={13}/></Link><Link href={`/workspace/projects/${state.id}/material-planning`}>Plan materials <ArrowUpRight size={13}/></Link></div>
          </div>
          <div className={s.documentGrid}>
            {d.documents
              .filter((x) => filtered(`${x.title} ${x.kind}`))
              .map((x) => {
                const href = x.url || (x.sourceDesignAssetId ? `/api/project-files/${state.id}/${x.sourceDesignAssetId}?workspaceId=${state.workspaceId}` : "");
                const canPreview = Boolean(x.sourceDesignAssetId) || /\.(avif|gif|jpe?g|png|webp)(?:\?.*)?$/i.test(x.url);
                const linkedItems = x.scopeLineIds?.length ?? 0;
                return <article className={s.documentCard} key={x.id}>
                  {href ? <a className={s.documentPreview} href={href} target="_blank" rel="noreferrer" aria-label="Open preview" tabIndex={-1}>
                    <FileText size={28} aria-hidden="true"/>{canPreview ? <img alt="" loading="lazy" src={href}/> : null}
                  </a> : <div className={s.documentPreview}><FileText size={28} aria-hidden="true"/></div>}
                  <div className={s.documentBody}>
                    <div className={s.documentTitleRow}><div>{href ? <a className={s.link} href={href} target="_blank" rel="noreferrer">{x.title}</a> : <strong>{x.title}</strong>}<span>{label(x.kind)} · Revision {x.revision}</span></div><Badge state={x.status}/></div>
                    {x.note ? <p title={x.note}>{x.note}</p> : null}
                    <div className={s.documentMeta}><span>{x.published ? "Visible to client" : "Internal"}</span><span data-linked={linkedItems > 0 || undefined}>{linkedItems ? `Linked to ${linkedItems} BOQ ${linkedItems === 1 ? "item" : "items"}` : "Not linked to BOQ"}</span></div>
                  </div>
                  <footer className={s.documentActions}>
                        {state.canManage && x.status === "draft" && (
                          <button
                            className={s.button}
                            disabled={busy}
                            onClick={() =>
                              void run("document_status", {
                                id: x.id,
                                status: "review",
                              })
                            }
                          >
                            Submit
                          </button>
                        )}
                        {state.canReview && x.status === "review" && (
                          <button
                            className={s.button}
                            disabled={busy}
                            onClick={() =>
                              void run("document_status", {
                                id: x.id,
                                status: "approved",
                              })
                            }
                          >
                            Approve
                          </button>
                        )}
                        {x.status === "approved" && (
                          <>
                            {state.canManage && (
                              <button
                                className={s.button}
                                onClick={() => editDocument(x.id)}
                              >
                                New revision
                              </button>
                            )}
                            {state.canReview && (
                              <button
                                className={s.button}
                                disabled={busy}
                                onClick={() =>
                                  void run("publish_document", {
                                    id: x.id,
                                    published: !x.published,
                                  })
                                }
                              >
                                {x.published ? "Unpublish" : "Publish"}
                              </button>
                            )}
                          </>
                        )}
                        <button
                          className={s.icon}
                          aria-label={`Comments on ${x.title}`}
                          onClick={() => conversation(x.id)}
                        >
                          <MessageSquare size={15} />
                        </button>
                  </footer>
                </article>;
              })}
          </div>
          {!d.documents.length && (
            <Empty title="Keep the approved information close to the work">
              Add drawings, specifications, permits and closeout documents.
              Revisions preserve the information used for released work.
            </Empty>
          )}
        </section>
      ) : section === "snagging" ? (
        <div className={s.scroll}>
          <table data-record-table="" className={s.table}>
            <thead>
              <tr>
                <th>Defect / area</th>
                <th>Responsible</th>
                <th>Severity</th>
                <th>Due</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.snags
                .filter((x) => filtered(`${x.title} ${x.area}`))
                .map((x) => (
                  <tr key={x.id}>
                    <td>
                      <strong>{x.title}</strong>
                      <span className={s.detail}>
                        {x.area} · {x.evidence}
                      </span>
                      {x.resolution && (
                        <span className={s.detail}>{x.resolution}</span>
                      )}
                    </td>
                    <td>{person(x.ownerId)}</td>
                    <td>
                      <Badge state={x.severity} />
                    </td>
                    <td>{x.dueDate}</td>
                    <td>
                      <Badge state={x.status} />
                    </td>
                    <td>
                      <div className={s.actions}>
                        {(state.canManage || x.ownerId === state.memberId) &&
                          x.status === "open" && (
                            <button
                              className={s.button}
                              onClick={() =>
                                decision(
                                  "Submit snag correction",
                                  "snag_status",
                                  x.id,
                                  { status: "ready" },
                                )
                              }
                            >
                              Submit correction
                            </button>
                          )}
                        {state.canReview && x.status === "ready" && (
                          <button
                            className={s.button}
                            onClick={() =>
                              decision(
                                "Verify snag closure",
                                "snag_status",
                                x.id,
                                { status: "closed" },
                              )
                            }
                          >
                            Verify & close
                          </button>
                        )}
                        {state.canManage && x.status !== "open" && (
                          <button
                            className={s.button}
                            onClick={() =>
                              decision("Reopen snag", "snag_status", x.id, {
                                status: "open",
                              })
                            }
                          >
                            Reopen
                          </button>
                        )}
                        <button
                          className={s.icon}
                          aria-label="Snag comments"
                          onClick={() => conversation(x.id)}
                        >
                          <MessageSquare size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!d.snags.length && (
            <Empty title="Track every defect through verification">
              Assign the correction and review its evidence. Major and critical
              defects block area handover.
            </Empty>
          )}
        </div>
      ) : section === "handover" ? (
        <>
          <div className={s.scroll}>
            <table data-record-table="" className={s.table}>
              <thead>
                <tr>
                  <th>Handover / area</th>
                  <th>Scope & documents</th>
                  <th>Status</th>
                  <th>Warranty</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {d.handovers
                  .filter((x) => filtered(`${x.title} ${x.area}`))
                  .map((x) => (
                    <tr key={x.id}>
                      <td>
                        <strong>{x.title}</strong>
                        <span className={s.detail}>{x.area}</span>
                        {x.outstanding && (
                          <span className={s.detail}>
                            Outstanding: {x.outstanding}
                          </span>
                        )}
                      </td>
                      <td>
                        {x.taskIds.length} tasks · {x.documentIds.length}{" "}
                        documents
                      </td>
                      <td>
                        <Badge state={x.status} />
                        {x.acceptedBy && (
                          <span className={s.detail}>
                            {x.acceptedBy} · {x.acceptedAt.slice(0, 10)}
                          </span>
                        )}
                      </td>
                      <td>{x.warrantyUntil || "Not specified"}</td>
                      <td>
                        <div className={s.actions}>
                          {state.canReport && x.status === "accepted" && (
                            <button
                              className={s.button}
                              onClick={() =>
                                open({
                                  title: "Record warranty defect",
                                  action: "warranty_snag",
                                  wrapper: "snag",
                                  value: {
                                    handoverId: x.id,
                                    area: x.area,
                                    title: "",
                                    severity: "minor",
                                    ownerId: "",
                                    dueDate: today(),
                                    evidence: "",
                                  },
                                  fields: [
                                    f("title", "Defect", "text", true),
                                    f(
                                      "severity",
                                      "Severity",
                                      "select",
                                      true,
                                      opts(["minor", "major", "critical"]),
                                    ),
                                    f(
                                      "ownerId",
                                      "Responsible person",
                                      "select",
                                      true,
                                      memberOptions,
                                    ),
                                    f("dueDate", "Response due", "date", true),
                                    f(
                                      "evidence",
                                      "Photos / service request reference",
                                      "textarea",
                                      true,
                                    ),
                                  ],
                                })
                              }
                            >
                              Warranty defect
                            </button>
                          )}
                          {state.canReview && ["draft", "returned"].includes(x.status) && (
                            <button
                              className={s.button}
                              disabled={busy}
                              onClick={() =>
                                decision(
                                  x.status === "returned" ? "Prepare corrected handover pack" : "Review generated handover pack",
                                  "handover_status",
                                  x.id,
                                  { status: "ready", confirmed: false },
                                  [
                                    {
                                      ...f(
                                        "confirmed",
                                        "I reviewed the generated scope, inspections, passed commissioning, published closeout documents, accepted materials and affected defects",
                                        "check",
                                        true,
                                      ),
                                      hint: "The server regenerates the pack from live project records and rechecks every control before it becomes client-ready.",
                                    },
                                  ],
                                )
                              }
                            >
                              {x.status === "returned" ? "Prepare correction" : "Prepare client review"}
                            </button>
                          )}
                          {state.canReview && x.status === "ready" && (
                            <button
                              className={s.button}
                              onClick={() =>
                                decision(
                                  "Record client handover acceptance",
                                  "handover_status",
                                  x.id,
                                  { status: "accepted", acceptedBy: "" },
                                  [
                                    f(
                                      "signedRecord",
                                      "I have a signed client acceptance record to attach",
                                      "check",
                                      true,
                                    ),
                                    f(
                                      "acceptedBy",
                                      "Client signatory",
                                      "text",
                                      true,
                                    ),
                                    f(
                                      "note",
                                      "Signed acceptance reference / evidence",
                                      "textarea",
                                      true,
                                    ),
                                  ],
                                )
                              }
                            >
                              Record signed acceptance
                            </button>
                          )}
                          <button
                            className={s.icon}
                            aria-label="Handover comments"
                            onClick={() => conversation(x.id)}
                          >
                            <MessageSquare size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!d.handovers.length && (
              <Empty title="Hand over room by room">
                Link completed tasks and approved closeout documents. Record
                client acceptance and warranty obligations.
              </Empty>
            )}
          </div>
          <div className={s.row}>
            <p className={s.muted}>
              Physical handover and financial closure are separate. All work,
              defects and reconciliation must be complete before closing the
              project.
            </p>
            {state.canReview && (
              <button
                className={s.button}
                disabled={busy}
                onClick={() =>
                  d.phase === "completed"
                    ? decision("Reopen project", "reopen_project", state.id)
                    : void run("complete_project")
                }
              >
                {d.phase === "completed"
                  ? "Reopen project"
                  : "Complete project"}
              </button>
            )}
          </div>
        </>
      ) : section === "commercial" && view === "accounting" ? (
        <ProjectAccounting
          workspaceId={state.workspaceId}
          caseId={state.caseId}
        />
      ) : section === "commercial" ? (
        <>
          <div className={s.summaryGrid}>
            <div className={s.metric}>
              <span>Original contract</span>
              <strong style={{ fontSize: "1.3rem" }}>
                {money(d.scope?.value ?? 0, d.scope?.currency)}
              </strong>
              {d.variations?.length ? (
                <span>
                  With variations:{" "}
                  {money(
                    (d.scope?.value ?? 0) +
                      d.variations.reduce((n, v) => n + v.value, 0),
                    d.scope?.currency,
                  )}
                </span>
              ) : null}
            </div>
            <div className={s.metric}>
              <span>Approved budget</span>
              <strong style={{ fontSize: "1.3rem" }}>
                {money(d.budget, d.scope?.currency)}
              </strong>
            </div>
            <div className={s.metric}>
              <span>Committed orders</span>
              <strong style={{ fontSize: "1.3rem" }}>
                {money(
                  d.orders
                    .filter((o) =>
                      ["approved", "acknowledged", "closed"].includes(o.status),
                    )
                    .reduce((n, o) => n + o.quantity * o.unitCost, 0),
                  d.scope?.currency,
                )}
              </strong>
            </div>
            <div className={s.metric}>
              <span>Forecast at completion</span>
              <strong style={{ fontSize: "1.3rem" }}>
                {money(d.forecast, d.scope?.currency)}
              </strong>
            </div>
          </div>
          <div className={s.columns}>
            <div className={s.section}>
              <h2>Connected commercial records</h2>
              {state.canManage && (
                <Button
                  size="compact"
                  isDisabled={busy}
                  onPress={() => void run("sync_variations")}
                >
                  Refresh accepted changes
                </Button>
              )}
              {d.changeCases?.map((change) => (
                <div className={s.row} key={change.requestId}>
                  <span>
                    Change C{change.number} · {change.kind.replaceAll("_", " ")}
                  </span>
                  <strong>{change.quoteIds.length} accepted document{change.quoteIds.length === 1 ? "" : "s"}</strong>
                </div>
              ))}
              {d.variations?.map((v) => (
                <div className={s.row} key={v.quoteId}>
                  <span>
                    Variation V{v.number} · {v.lines.length} items
                  </span>
                  <strong>{money(v.value, d.scope?.currency)}</strong>
                </div>
              ))}
              {[
                ["quotations", "Approved quotations & variations"],
                ["contracts", "Agreement, milestones & receipts"],
                ["variations", "Change requests"],
                ["execution-release", "Release evidence"],
                ["client-portal", "Client access & portal"],
              ].map(([id, title]) => (
                <Link key={id} className={s.row} href={`${pre}/${id}`}>
                  <span>{title}</span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
              <Link className={s.row} href="/workspace/integrations">
                <span>Zoho Books / QuickBooks connections</span>
                <ArrowUpRight size={15} />
              </Link>
            </div>
            <div className={s.section}>
              <h2>Budget & reconciliation</h2>
              <p className={s.muted}>
                Approved orders consume the operational budget. Quotations and
                variations keep their original approval history in Pre-execution.
              </p>
              {state.canReview && (
                <button
                  className={s.primary}
                  onClick={() =>
                    decision(
                      "Update budget & financial reconciliation",
                      "commercial",
                      state.id,
                      {
                        budget: d.budget,
                        forecast: d.forecast,
                        financeClosed: d.financeClosed,
                        financeEvidence: d.financeEvidence,
                      },
                      [
                        f("budget", "Approved cost budget", "number", true),
                        f("forecast", "Forecast final cost", "number", true),
                        f(
                          "note",
                          "Budget / forecast approval reference",
                          "textarea",
                          true,
                        ),
                        f("financeClosed", "Final account reconciled", "check"),
                        f(
                          "financeEvidence",
                          "Accounting, retention and remaining obligations",
                          "textarea",
                        ),
                      ],
                    )
                  }
                >
                  Update financial plan
                </button>
              )}
              <div className={s.notice}>
                {d.financeClosed
                  ? "Final account reconciled"
                  : "Final account remains open"}
                {d.financeEvidence && <p>{d.financeEvidence}</p>}
              </div>
              <p className={s.muted}>
                Zoho Books or QuickBooks remains the source for invoices, bills
                and settlement. An internal approval or client receipt image
                does not confirm payment.
              </p>
            </div>
          </div>
        </>
      ) : null}
      {section === "overview" && Boolean(state.notifications?.length) && (
        <div className={s.form}>
          <h2>Updates for you</h2>
          {state.notifications?.map((n) => (
            <div className={s.row} key={n.id}>
              <div>
                <Link className={s.link} href={n.deepLink}>
                  {n.subject}
                </Link>
                <span className={s.detail}>{n.body}</span>
              </div>
              {!n.readAt && (
                <button
                  className={s.button}
                  disabled={busy}
                  onClick={() => void run("notification_read", { id: n.id })}
                >
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <ControlledModalDialog
        isOpen={Boolean(selected)}
        onOpenChange={(v) => !v && setSelected("")}
        title={
          task?.title ??
          ("title" in (record ?? {})
            ? String((record as { title: string }).title)
            : "Project record")
        }
      >
        <div className={s.form}>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.actions}>
            <button
              className={s.button}
              disabled={busy}
              onClick={() =>
                void run("follow", {
                  id: selected,
                  following: !d.followers?.some(
                    (f) =>
                      f.recordId === selected && f.memberId === state.memberId,
                  ),
                })
              }
            >
              {d.followers?.some(
                (f) => f.recordId === selected && f.memberId === state.memberId,
              )
                ? "Following · Unfollow"
                : "Follow updates"}
            </button>
          </div>
          <nav className={s.tabs}>
            {(task
              ? [
                  ["details", "Details"],
                  ["subtasks", "Subtasks"],
                  ["updates", "Updates"],
                  ["comments", `Comments (${comments.length})`],
                  ["files", "Files"],
                  ["history", "History"],
                ]
              : [
                  ...(d.orders.some((o) => o.id === selected)
                    ? [["details", "Order & next steps"]]
                    : []),
                  ["comments", `Comments (${comments.length})`],
                  ["files", "Files"],
                  ["history", "History"],
                ]
            ).map(([id, title]) => (
              <button
                key={id}
                aria-pressed={detailTab === id}
                onClick={() => setDetailTab(id)}
              >
                {title}
              </button>
            ))}
          </nav>
          {d.orders.some((o) => o.id === selected) &&
          detailTab === "details" ? (
            (() => {
              const order = d.orders.find((o) => o.id === selected)!;
              return (
                <ProjectOrderDetail
                  state={state}
                  order={order}
                  busy={busy}
                  onEdit={() => editOrder(order)}
                  onComments={() => setDetailTab("comments")}
                  onVendor={() => void vendorAccess(order.id)}
                  // ProjectOrderDetail calls this only from its button handler.
                  // eslint-disable-next-line react-hooks/refs
                  onStep={() => advanceOrder(order)}
                />
              );
            })()
          ) : task && detailTab === "details" ? (
            <>
              <Badge state={task.status} />
              <p>{task.description || task.title}</p>
              <div className={s.grid}>
                <div>
                  Owner
                  <strong className={s.detail}>{person(task.ownerId)}</strong>
                </div>
                <div>
                  Assigned people
                  <strong className={s.detail}>
                    {task.assigneeIds.map(person).join(", ") ||
                      "No additional people"}
                  </strong>
                </div>
                <div>
                  Schedule
                  <strong className={s.detail}>
                    {task.start} → {task.end}
                  </strong>
                </div>
                <div>
                  Team
                  <strong className={s.detail}>
                    {resource(task.resourceId)}
                  </strong>
                </div>
              </div>
              <Meter value={taskProgress(d, task)} />
              <p className={s.muted}>
                {task.approved} of {task.quantity} {task.unit} approved ·{" "}
                {task.area || "General"} · {label(task.location)}
              </p>
              <div className={s.grid}>
                {Object.entries(task.readiness).map(([k, v]) => (
                  <span key={k}>
                    {v ? "✓" : "○"} {label(k)} ready
                  </span>
                ))}
              </div>
              {task.predecessors.length > 0 && (
                <p className={s.muted}>
                  Preceding work:{" "}
                  {task.predecessors
                    .map((id) => d.tasks.find((t) => t.id === id)?.title)
                    .join(", ")}
                </p>
              )}
              {task.blocker && <div className={s.notice}>{task.blocker}</div>}
              {task.location!=="office"&&!["completed","cancelled"].includes(task.status)&&(!task.resourceId||!state.bookings.some(b=>b.taskId===task.id&&b.projectId===state.id&&b.status==="confirmed"))&&<p className={s.notice}>Assign a crew or factory and confirm its booking before starting work.</p>}
              <div className={s.actions}>
                {state.canManage && (
                  <>
                    <button className={s.button} onClick={() => editTask(task)}>
                      Edit task
                    </button>
                    <button
                      className={s.button}
                      disabled={d.reports.some((r) =>
                        r.entries.some((e) => e.taskId === task.id),
                      )}
                      onClick={() => editTask(undefined, task.id)}
                    >
                      Add subtask
                    </button>
                    {task.resourceId &&
                      (state.bookings.some(
                        (b) => b.projectId === state.id && b.taskId === task.id,
                      ) ? (
                        <button
                          className={s.button}
                          disabled={busy}
                          onClick={() =>
                            void run("cancel_booking", { taskId: task.id })
                          }
                        >
                          Release booking
                        </button>
                      ) : (
                        <button
                          className={s.button}
                          onClick={() =>
                            decision(
                              "Confirm resource booking",
                              "booking",
                              task.id,
                              { taskId: task.id },
                              [
                                {
                                  ...f(
                                    "startTime",
                                    "Shift start · HH:mm",
                                    "text",
                                  ),
                                  hint: "Optional. Defaults to the resource calendar.",
                                },
                                {
                                  ...f("endTime", "Shift end · HH:mm", "text"),
                                  hint: "Optional. Hours must fit the working shift.",
                                },
                                f(
                                  "calendarOverride",
                                  "Approved exception to employee working hours",
                                  "check",
                                ),
                                {
                                  ...f(
                                    "note",
                                    "Acknowledgement / approved calendar exception",
                                    "textarea",
                                  ),
                                  hint: "Required for an external vendor. Internal availability is checked on confirmation.",
                                },
                              ],
                            )
                          }
                        >
                          Confirm booking
                        </button>
                      ))}
                  </>
                )}
                {state.canReport &&
                  !d.tasks.some((c) => c.parentId === task.id) && (
                    <button
                      className={s.primary}
                      onClick={() => newReport(task)}
                    >
                      Add daily update
                    </button>
                  )}
                {state.canManage &&
                  ![
                    "completed",
                    "cancelled",
                    "in_progress",
                    "awaiting_inspection",
                  ].includes(task.status) && (
                    <button
                      className={s.button}
                      disabled={busy || !state.commercialReady}
                      title={!state.commercialReady ? "Complete the Pre-execution release checklist before starting work." : undefined}
                      onClick={() =>
                        void run("task_status", {
                          id: task.id,
                          status: "in_progress",
                        })
                      }
                    >
                      Start work
                    </button>
                  )}
                {state.canReview && task.status === "awaiting_inspection" && (
                  <>
                    <button
                      className={s.primary}
                      onClick={() =>
                        decision("Accept inspection", "inspect", task.id, {
                          passed: true,
                        })
                      }
                    >
                      Pass inspection
                    </button>
                    <button
                      className={s.button}
                      onClick={() =>
                        decision(
                          "Inspection requires correction",
                          "inspect",
                          task.id,
                          { passed: false },
                        )
                      }
                    >
                      Return for correction
                    </button>
                  </>
                )}
                {state.canManage && (
                  <button
                    className={s.button}
                    onClick={() =>
                      decision(
                        "Change task status",
                        "task_status",
                        task.id,
                        { status: "on_hold" },
                        [
                          f(
                            "status",
                            "Status",
                            "select",
                            true,
                            opts([
                              "planned",
                              "blocked",
                              "on_hold",
                              "cancelled",
                            ]),
                          ),
                          f("note", "Reason", "textarea", true),
                        ],
                      )
                    }
                  >
                    Hold / change status
                  </button>
                )}
              </div>
            </>
          ) : task && detailTab === "subtasks" ? (
            <>
              {d.tasks
                .filter((t) => t.parentId === task.id)
                .map((t) => (
                  <button
                    key={t.id}
                    className={s.row}
                    onClick={() => {
                      setSelected(t.id);
                      setDetailTab("details");
                    }}
                  >
                    <span>{t.title}</span>
                    <Badge state={t.status} />
                  </button>
                ))}
              {state.canManage && (
                <button
                  className={s.primary}
                  onClick={() => editTask(undefined, task.id)}
                >
                  <Plus size={15} />
                  Add subtask
                </button>
              )}
            </>
          ) : task && detailTab === "updates" ? (
            <ul className={s.history}>
              {d.reports
                .filter((r) => r.entries.some((e) => e.taskId === task.id))
                .map((r) => (
                  <li key={r.id}>
                    <button
                      className={s.link}
                      onClick={() => setViewingReportId(r.id)}
                    >
                      {r.date} · {r.author}
                    </button>
                    <Badge state={r.status} />
                    <p>
                      {r.entries.find((e) => e.taskId === task.id)?.quantity}{" "}
                      {task.unit} · {r.evidence}
                    </p>
                  </li>
                ))}
            </ul>
          ) : detailTab === "files" ? (
            <>
              <label>
                Attach a photo or PDF
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    setError("");
                    try {
                      const form = new FormData();
                      form.append("file", file);
                      const r = await fetch(
                        `/api/project-files/${state.id}/${crypto.randomUUID()}?workspaceId=${state.workspaceId}&recordId=${selected}`,
                        { method: "POST", body: form },
                      );
                      const result = await r.json();
                      if (!r.ok)
                        throw Error(
                          result.message ?? "Upload failed. Retry this file.",
                        );
                      setState((prev) => ({ ...prev, data: result.data }));
                      setSuccess("File uploaded");
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                      e.target.value = "";
                    }
                  }}
                />
              </label>
              <p className={s.muted}>
                Up to 10 MB. Files stay internal. Approved daily reports require
                a correction before adding evidence.
              </p>
              <ul className={s.history}>
                {d.files
                  ?.filter((f) => f.recordId === selected)
                  .map((f) => (
                    <li key={f.id}>
                      <a
                        className={s.link}
                        href={`/api/project-files/${state.id}/${f.id}?workspaceId=${state.workspaceId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {f.name} ↗
                      </a>
                      <span className={s.detail}>
                        {Math.ceil(f.bytes / 1024)} KB ·{" "}
                        {new Date(f.at).toLocaleString()}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          ) : detailTab === "comments" ? (
            <>
              {d.orders.find((o) => o.id === selected)?.vendorUpdates
                ?.length ? (
                <div>
                  <h3>Vendor submissions</h3>
                  <ul className={s.history}>
                    {d.orders
                      .find((o) => o.id === selected)!
                      .vendorUpdates!.map((u) => (
                        <li key={u.id}>
                          <strong>{label(u.kind)}</strong>
                          <p>{u.note}</p>
                          <p>
                            {u.quantity} units · {u.date}
                            {u.unitCost !== undefined
                              ? ` · Unit price ${money(u.unitCost, d.scope?.currency)}`
                              : ""}
                          </p>
                          <small>
                            {new Date(u.at).toLocaleString()} · Pending internal
                            review
                          </small>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
              <ul className={s.history}>
                {comments.map((c) => (
                  <li
                    key={c.id}
                    style={
                      c.parentId ? { marginInlineStart: "1.2rem" } : undefined
                    }
                  >
                    <strong>{c.author}</strong>
                    <small> · {new Date(c.at).toLocaleString()}</small>
                    {c.parentId && (
                      <span className={s.detail}>
                        Reply to{" "}
                        {comments.find((parent) => parent.id === c.parentId)
                          ?.author ?? "thread"}
                      </span>
                    )}
                    <p>{c.text}</p>
                    {c.mentions?.length ? (
                      <p className={s.muted}>
                        For {c.mentions.map(person).join(", ")}
                      </p>
                    ) : null}
                    {c.edits?.length ? (
                      <details>
                        <summary className={s.muted}>
                          Edited · view history
                        </summary>
                        {c.edits.map((edit, i) => (
                          <p key={i}>
                            {edit.text}
                            <small className={s.detail}>
                              {new Date(edit.at).toLocaleString()}
                            </small>
                          </p>
                        ))}
                      </details>
                    ) : null}
                    <div className={s.actions}>
                      {c.resolved ? (
                        <span className={s.status} data-state="completed">
                          Resolved
                        </span>
                      ) : (
                        <button
                          className={s.link}
                          onClick={() => setReplyTo(c.parentId || c.id)}
                        >
                          Reply
                        </button>
                      )}
                      {(c.authorId === state.memberId ||
                        state.canManage ||
                        state.canReview) && (
                        <button
                          className={s.link}
                          disabled={busy}
                          onClick={() =>
                            void run("comment_status", {
                              commentId: c.id,
                              resolved: !c.resolved,
                            })
                          }
                        >
                          {c.resolved ? "Reopen" : "Resolve"}
                        </button>
                      )}
                      {c.authorId === state.memberId && (
                        <button
                          className={s.link}
                          onClick={() =>
                            decision(
                              "Edit comment",
                              "edit_comment",
                              selected,
                              { commentId: c.id, text: c.text },
                              [f("text", "Comment", "textarea", true)],
                            )
                          }
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {replyTo && (
                <div className={s.row}>
                  <span>
                    Replying to {comments.find((c) => c.id === replyTo)?.author}
                  </span>
                  <button className={s.link} onClick={() => setReplyTo("")}>
                    Cancel reply
                  </button>
                </div>
              )}
              <label>
                Comment
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Discuss this record. Comments stay internal."
                />
              </label>
              <label>
                Notify project members
                <select
                  multiple
                  value={mentions}
                  onChange={(e) =>
                    setMentions(
                      Array.from(e.target.selectedOptions, (o) => o.value),
                    )
                  }
                >
                  {state.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <small className={s.muted}>
                  Mentioned members see this in their project updates. No
                  external message is sent.
                </small>
              </label>
              <button
                className={s.primary}
                disabled={busy || !comment.trim()}
                onClick={async () => {
                  if (
                    await run("comment", {
                      id: selected,
                      text: comment,
                      parentId: replyTo,
                      mentions,
                    })
                  ) {
                    setComment("");
                    setReplyTo("");
                    setMentions([]);
                  }
                }}
              >
                Add comment
              </button>
            </>
          ) : (
            <ul className={s.history}>
              {d.audit
                .filter((a) => a.recordId === selected)
                .slice()
                .reverse()
                .map((a) => (
                  <li key={a.id}>
                    <strong>{label(a.action)}</strong>
                    <p>{a.note}</p>
                    <small>
                      {a.author} · {new Date(a.at).toLocaleString()}
                    </small>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </ControlledModalDialog>
      <ControlledModalDialog
        isOpen={Boolean(vendorLink)}
        onOpenChange={(v) => !v && setVendorLink(null)}
        title="Restricted vendor order form"
      >
        <div className={s.form}>
          <p className={s.muted}>
            This private link opens only this vendor’s order. Share it with the
            intended vendor. It expires in seven days and replaces any older
            link.
          </p>
          <TextInput isReadOnly label="Order form link" value={vendorLink?.url ?? ""} />
          <div className={s.actions}>
            <a
              className={s.primary}
              href={vendorLink?.url}
              target="_blank"
              rel="noreferrer"
            >
              Preview vendor form ↗
            </a>
            <Button
              onPress={async () => {
                if (vendorLink) {
                  await navigator.clipboard.writeText(vendorLink.url);
                  setSuccess("Vendor link copied");
                }
              }}
            >
              Copy link
            </Button>
            <Button
              isDisabled={busy}
              onPress={async () => {
                if (vendorLink) {
                  await jsonRequest(
                    projectPath(state.workspaceId, `${state.id}/vendor-access`),
                    "POST",
                    { orderId: vendorLink.orderId, revoke: true },
                  );
                  setVendorLink(null);
                }
              }}
            >
              Revoke link
            </Button>
          </div>
        </div>
      </ControlledModalDialog>
      <ControlledModalDialog
        size="lg"
        isOpen={Boolean(editor)}
        onOpenChange={(v) => !v && setEditor(null)}
        title={editor?.title ?? "Edit record"}
      >
        <Form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!editor) return;
            let value = { ...form };
            if (editor.action === "task") {
              value = {
                ...value,
                readiness: {
                  scope: form.scopeReady === true,
                  access: form.accessReady === true,
                  materials: form.materialsReady === true,
                },
              };
              delete value.scopeReady;
              delete value.accessReady;
              delete value.materialsReady;
            }
            const payload = editor.wrapper
              ? { [editor.wrapper]: value, ...editor.extra }
              : { ...value, ...editor.extra };
            if (await run(editor.action, payload)) setEditor(null);
          }}
        >
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <fieldset disabled={busy}>
            {editor?.action === "material" && (
              <CatalogChoiceField
                workspaceId={state.workspaceId}
                caseId={state.caseId}
                kind="material"
                label="Choose material / SKU from your catalogs"
                value={(form.catalogSnapshot as CatalogChoice | null) ?? null}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    catalogId: value?.id ?? "",
                    catalogVersion: value?.version ?? 0,
                    catalogSnapshot: value,
                    ...(value
                      ? {
                          title: value.name,
                          specification: [
                            value.name,
                            value.code,
                            value.catalogName,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                        }
                      : {}),
                  }))
                }
              />
            )}
            <div className={s.grid}>
              {editor?.fields.map((field) => (
                <div key={field.key} className={["textarea", "multi"].includes(field.type ?? "") ? s.fullWidth : undefined}>
                  {field.type === "check" ? <Checkbox isSelected={form[field.key] === true} onChange={(value) => setForm((current) => ({ ...current, [field.key]: value }))}>{field.label}</Checkbox>
                    : field.type === "textarea" ? <TextAreaField description={field.hint} isRequired={field.required} label={field.label} onChange={(value) => setForm((current) => ({ ...current, [field.key]: value }))} value={String(form[field.key] ?? "")} />
                    : field.type === "multi" ? <MultiSelectField items={(field.options ?? []).map((option) => ({ id: option.value, label: option.label }))} label={field.label} onSelectionChange={(keys) => setForm((current) => ({ ...current, [field.key]: [...keys].map(String) }))} selectedKeys={new Set((form[field.key] as string[] | undefined) ?? [])} />
                    : field.type === "select" ? <SelectField description={field.hint} isRequired={field.required} items={(field.options ?? []).map((option) => ({ id: option.value, label: option.label }))} label={field.label} onSelectionChange={(key) => setForm((current) => ({ ...current, [field.key]: String(key ?? "") }))} selectedKey={String(form[field.key] ?? "") || null} />
                    : field.type === "number" ? <NumericInput description={field.hint} isRequired={field.required} label={field.label} minValue={0} onChange={(value) => setForm((current) => ({ ...current, [field.key]: value }))} value={typeof form[field.key] === "number" ? form[field.key] as number : NaN} />
                    : <TextInput description={field.hint} inputType={field.type === "date" ? "date" : "text"} isRequired={field.required} label={field.label} onChange={(value) => setForm((current) => ({ ...current, [field.key]: value }))} value={String(form[field.key] ?? "")} />}
                </div>
              ))}
            </div>
          </fieldset>
          <div className={s.actions}>
            <Button isDisabled={busy} type="submit" variant="primary">
              Save
            </Button>
            <Button onPress={() => setEditor(null)}>
              Cancel
            </Button>
          </div>
        </Form>
      </ControlledModalDialog>
      <ControlledModalDialog
        size="lg"
        isOpen={Boolean(viewingReportId)}
        onOpenChange={(open) => !open && setViewingReportId("")}
        title="Daily report"
      >
        {(() => {
          const current = d.reports.find((r) => r.id === viewingReportId);
          return current ? (
            <DailyReportView
              report={current}
              state={state}
              busy={busy}
              error={error}
              run={run}
              onEdit={() => {
                setViewingReportId("");
                setReport(structuredClone(current));
              }}
              onCorrection={() => newReport(undefined, current)}
              onComments={() => {
                setViewingReportId("");
                conversation(current.id);
              }}
              onReturn={() => {
                setViewingReportId("");
                decision("Return daily update", "return_report", current.id);
              }}
              onPublish={() => {
                setViewingReportId("");
                decision(
                  "Publish reviewed update",
                  "publish_report",
                  current.id,
                  {},
                  [
                    f(
                      "fileIds",
                      "Photos and files to share with the client",
                      "multi",
                      false,
                      (d.files ?? [])
                        .filter((file) => file.recordId === current.id)
                        .map((file) => ({ value: file.id, label: file.name })),
                    ),
                  ],
                );
              }}
            />
          ) : null;
        })()}
      </ControlledModalDialog>
      <ControlledModalDialog
        size="lg"
        isOpen={Boolean(report)}
        onOpenChange={(v) => !v && setReport(null)}
        title={
          report?.status === "draft"
            ? "Daily progress update"
            : `Daily update · ${report?.date ?? ""}`
        }
      >
        {report && (
          <DailyReportEditor
            report={report}
            setReport={setReport}
            state={state}
            today={today()}
            busy={busy}
            error={error}
            run={run}
            onClose={() => setReport(null)}
            onCorrection={() => newReport(undefined, report)}
            onUploaded={(data) => setState((prev) => ({ ...prev, data }))}
          />
        )}
      </ControlledModalDialog>
    </section>
  );
}
