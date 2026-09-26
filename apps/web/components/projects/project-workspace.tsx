"use client";
import { quoteBatchRemaining } from "../../../../services/business-core/src/projects/project-quote-allocation";
import { parseDate } from "@internationalized/date";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus, ArrowUpRight, Inbox } from "lucide-react";
import { Button, Callout, Checkbox, ControlledModalDialog, DateField, DataGrid, Form, InspectorSheet, MenuButton, MultiSelectField, NumericInput, SearchInput, SegmentedControl, SelectField, TextAreaField, TextInput, type DataGridColumn } from "@/design-system";
import { CatalogChoiceField } from "@/components/pre-project/case-controls";
import type { CatalogChoice } from "@/lib/pre-project/content";
import { ProjectSchedule, type Milestone } from "./project-schedule";
import { ProjectFinishedStock } from "./project-finished-stock";
import { projectInventory } from "../../../../services/business-core/src/projects/project-inventory";
import { ProjectWarehouse } from "./project-warehouse";
import { ProjectControls, type ControlKind } from "./project-controls";
import { ProjectCalendar } from "./project-calendar";
import { CloseoutReadiness } from "./project-closeout-readiness";
import { ProjectMaterialEditor } from "./project-material-editor";
import { ProjectHandoverScope, ProjectInspectionHistory } from "./project-handover-scope";
import { ProjectDecisionEvidence } from "./project-decision-evidence";
import { ProjectInstallationBatches } from "./project-installation-batches";
import { ProjectFactoryCapacity } from "./project-factory-capacity";
import { ProjectTeams } from "./project-teams";
import { ProjectFactoryBatches } from "./project-factory-batches";
import { installationMaterialCapacity } from "@/lib/projects/execution";
import { ProjectSuppliers, SupplierQuoteRequest, SupplierWhatsAppLink, loadSuppliers, type Supplier } from "./project-suppliers";
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
  type SupplierInvoice,
  type Material,
  type ProjectWorkPackage,
  type Snag,
  type Handover,
} from "@/lib/projects/execution";
import { DocumentsTable, ExpeditingTable, FactoryTable, HandoversTable, MaterialsTable, OrdersTable, RoomBudgetTable, orderBudgetRoom, ShortagesTable, SnagsTable, StageHeader, StateBadge, expediting, materialPosition, shortages, type DocumentAction, type FactoryAction, type HandoverAction, type MaterialAction, type OrderAction, type ProjectDocument, type ShortageAction, type SnagAction, type StageMetric } from "./project-stage";
import s from "./project-workspace.module.css";
import workspaceStyles from "../workspace/workspace.module.css";
import theme from "../crm/crm-workspace-colors.module.css";
import { acceptedOrderQuantity, orderReceivingPosition, procurementContext } from "@/lib/projects/procurement-context";
import { quantityToSource } from "@/lib/projects/purchasing";
import { ProcurementDeliveries, ProcurementTotals, SupplierInvoices, invoiceTotal, invoicePaid } from "./project-procurement-ledger";
import { ProjectAccounting } from "./project-accounting";
import { ProjectRequirementDetail } from "./project-requirement-detail";
import { ProjectOrderDetail } from "./project-order-detail";
import { activeReleasedScopeLines } from "../../../../services/business-core/src/projects/project-scope-lines";
import { ProjectApprovals } from "./project-approvals";
import { ProjectClientUpdates } from "./project-client-updates";
import { ProjectWorkOrders } from "./project-work-orders";
import { ProjectItemRegister } from "./project-item-register";
import { ProjectWorkPlanEditor } from "./project-work-plan-editor";
import { ProjectBoq } from "./project-boq";
import { ProjectInitiation } from "./project-initiation";
import { ProjectOverview } from "./project-overview";
import { ProjectCommentComposer } from "./project-comment-composer";
import { ProjectTaskBoard } from "./project-task-board";
import { ProjectHeader } from "./project-header";
import { ProjectWorkflowStrip } from "./project-workflow-strip";
import { DailyReportView } from "./daily-report-view";
import { DailyProgress, DailyReportEditor } from "./project-daily-progress";
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
const Badge = StateBadge;
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
export function ProjectWorkspace({
  initial,
  section,
  connected = false,
  onStateChange,
  recordOnly = false,
  initialRecordId = "",
  initialDetailTab = "details",
  onRecordClose,
}: {
  initial: ProjectState;
  section: string;
  connected?: boolean;
  onStateChange?: (state: ProjectState) => void;
  recordOnly?: boolean;
  initialRecordId?: string;
  initialDetailTab?: string;
  onRecordClose?: () => void;
}) {
  const navigation = useSearchParams();
  const packageId = navigation.get("package");
  const requestedView=navigation.get("view")??"all";
  const initialView=["all","summary","approvals","client-updates","tasks","mine","attention","completed","schedule","teams","calendar","capacity","batches","draft","submitted","approved","returned","issues","enquiries","deliveries","invoices","suppliers","dispatch","commissioning","technical_query","transmittal","retention","supplier_return","accounting","warehouse","packs","shortages"].includes(requestedView)?requestedView:"all";
  const [state, setState] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [search, setSearch] = useState(""),
    [view, setViewState] = useState(initialView),
    [selected, setSelected] = useState(initialRecordId),
    [detailTab, setDetailTab] = useState(initialDetailTab),
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
  function setView(value:string) {
    setViewState(value);
    const url=new URL(window.location.href);
    if(value==="all")url.searchParams.delete("view");else url.searchParams.set("view",value);
    window.history.replaceState(null,"",url);
  }
  const [workTab, setWorkTab] = useState("plan");
  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);
  const [dispatchTaskId,setDispatchTaskId]=useState("");
  const [stockMaterialId,setStockMaterialId]=useState("");
  const [returnWork, setReturnWork] = useState<ProjectWorkPackage | null>(null);
  const [planningWork, setPlanningWork] = useState<ProjectWorkPackage | null>(null);
  useEffect(() => { setViewState(initialView); }, [initialView, section]);
  useEffect(() => { const id = navigation.get("record"); if (!id || navigation.get("view") === "approvals") return; const work = state.data.workPackages?.find(item=>item.id===id); if(work) {setWorkTab("plan");setPlanningWork(work);} else setSelected(id); }, [navigation]);
  const focusedPackage = state.data.workPackages?.find(work=>work.id === packageId);
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
  const [returnTaskId,setReturnTaskId]=useState("");
  const [procurementLocation,setProcurementLocation]=useState("all");
  const [procurementSupply,setProcurementSupply]=useState("all");
  const matchesProcurement=(record:Order|Material)=>procurementLocation==="all" || procurementContext(state.data,record).location===procurementLocation;
  const procurementState:ProjectState={...state,data:{...state.data,
    materials:state.data.materials.filter(m=>matchesProcurement(m)&&(procurementSupply==="all"||m.supply===procurementSupply)),
    orders:state.data.orders.filter(matchesProcurement),
    supplierInvoices:(state.data.supplierInvoices??[]).filter(i=>{const order=state.data.orders.find(o=>o.id===i.orderId);return !!order&&matchesProcurement(order);})}};
  const procurementFilters=<div className={s.procurementFilters}>
    <SelectField label="Work location" selectedKey={procurementLocation} onSelectionChange={key=>setProcurementLocation(String(key))} items={[{id:"all",label:"All locations"},{id:"factory",label:"Factory"},{id:"site",label:"On-site"},{id:"office",label:"Office"},{id:"unassigned",label:"Unassigned"}]}/>
    {section==="material-planning" && <SelectField label="Supply responsibility" selectedKey={procurementSupply} onSelectionChange={key=>setProcurementSupply(String(key))} items={[{id:"all",label:"All requirements"},{id:"company",label:"Company to procure"},{id:"client",label:"Client supplied"},{id:"vendor",label:"Included by supplier"}]}/>}
  </div>;
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
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const query = new URLSearchParams(window.location.search),
        id = query.get("record"),
        requestedView = query.get("view");
      if (
        requestedView &&
        [
          "all",
          "summary",
          "approvals",
          "tasks",
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
        setViewState(requestedView);
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
        const requestedTab=query.get("tab");
        setDetailTab(task&&requestedTab==="updates"?"updates":requestedTab==="comments"?"comments":(task||data.orders.some(o=>o.id===id))?"details":"comments");
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
      if (!result?.data) throw new Error("The save response was incomplete. Refresh and try again.");
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
  const [supplierDirectory, setSupplierDirectory] = useState<Supplier[]>([]);
  const [materialEditor,setMaterialEditor]=useState<"add"|"quote"|null>(null);
  const [quoteRequest, setQuoteRequest] = useState<{source?:Material}|null>(null);
  useEffect(()=>{if(state.canBuy)void loadSuppliers(state.workspaceId).then(setSupplierDirectory).catch(()=>{/* Directory view displays access/loading errors. */});},[state.workspaceId,state.canBuy,view]);
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
  function confirmBooking(task: Task) {
    const resource = state.resources.find(item => item.id === task.resourceId);
    decision(`Confirm booking · ${task.start} → ${task.end}`, "booking", task.id, { taskId: task.id, units: 1 }, [
      ...(resource?.capacityMode === "pooled" ? [{ ...f("units", "Capacity units", "number", true), hint: `Resource capacity: ${resource.capacity}. Units reserve capacity; they are not finished item quantities.` }] : []),
      { ...f("startTime", "Shift start · HH:mm", "text"), hint: "Optional. Defaults to the resource calendar." },
      { ...f("endTime", "Shift end · HH:mm", "text"), hint: "Optional. Hours must fit the working shift." },
      f("calendarOverride", "Approved exception to employee working hours", "check"),
      { ...f("note", "Acknowledgement / approved calendar exception", "textarea"), hint: "Required for an external supplier. Availability is rechecked on confirmation." },
    ]);
  }
  function editTask(t?: Task, parentId = "") {
    const parent = d.tasks.find((t) => t.id === parentId);
    const value = t ?? {
      id: crypto.randomUUID(),
      parentId,
      packageId: parent?.packageId ?? focusedPackage?.id ?? "",
      package: parent?.package ?? focusedPackage?.title ?? "Interior fit-out",
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
        f("packageId", "Work order", "select", (d.workPackages ?? []).some(work=>work.status!=="cancelled"), (d.workPackages ?? []).filter(work=>work.status!=="cancelled").map(work=>({value:work.id,label:work.title}))),
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
        f("ownerId", "Assignee", "select", false, memberOptions),
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
  function editMaterial() { setMaterialEditor("add"); }
  const [budgetRoom,setBudgetRoom]=useState<string|null>(null);
  const [invoiceDetails, setInvoiceDetails] = useState<SupplierInvoice | null>(null);
  function editSupplierInvoice(invoice?: SupplierInvoice, order?: Order) {
    if (invoice?.status === "approved" || !state.canBuy) { if(invoice) setInvoiceDetails(invoice); return; }
    open({title: invoice ? "Review supplier invoice" : "Record supplier invoice", action:"supplier_invoice", value: invoice ? {...invoice} : {date:today(),dueDate:today(),orderId:order?.id,quantity:order ? Math.max(0,acceptedOrderQuantity(d,order)-(d.supplierInvoices??[]).filter(i=>i.orderId===order.id).reduce((n,i)=>n+i.quantity,0)) : 1,unitCost:order?.unitCost ?? 0,tax:0}, fields:[
      f("orderId","Purchase order","select",true,d.orders.filter(o=>["approved","acknowledged","closed"].includes(o.status)).map(o=>({value:o.id,label:`${o.number} · ${o.vendor} · ${o.title}`}))),
      f("number","Supplier invoice number","text",true),f("date","Invoice date","date",true),f("dueDate","Due date","date",true),f("quantity","Invoiced quantity","number",true),f("unitCost","Unit cost before tax","number",true),f("tax","Tax amount","number",true),f("evidence","Invoice document / reference","text",true),
    ]});
  }
  function editOrder(
    current?: Order,
    enquiry = false,
    source?: Material | Task,
  ) {
    enquiry = enquiry || current?.status === "enquiry";
    if (enquiry && !current) { setQuoteRequest({source:source && "supply" in source ? source : undefined}); return; }
    open({
      title: enquiry
        ? "Request supplier quote"
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
            ? quantityToSource(source, d.orders, state.stockTransfers, d.supplierReturns)
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
        ...(current && !current.vendorId ? [f("vendor", "Supplier name (existing record)", "text", true)] : [f("vendorId", "Supplier", "select", true, supplierDirectory.filter(s=>s.status==="active").map(s=>({value:s.id,label:`${s.displayName} · ${s.code}`})))]),
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
      ].filter(field=>!current?.selectedOffer || ["quantity","vendorContact","leadTimeDays"].includes(field.key)),
    });
  }
  function advanceOrder(order: Order) {
    if (order.status === "enquiry") {
      const offer=order.vendorUpdates?.filter(u=>u.kind==="quotation").at(-1);
      if (!offer) { setError("Record a supplier offer before selecting a quote."); return; }
      decision("Select supplier quote","award_enquiry",order.id,{offerId:offer.id,quantity:Math.min(offer.quantity,quoteBatchRemaining(d.orders,order))},[f("quantity","Order quantity","number",true),f("note","Selection reason","textarea",true)]);
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
        "Confirm supplier dates & scope",
        "order_status",
        order.id,
        {
          status: "acknowledged",
          promisedDate: latest?.date || order.promisedDate,
          note: latest?.note || "",
        },
        [
          f("promisedDate", "Confirmed delivery date", "date", true),
          f("note", "Supplier confirmation reference", "textarea", true),
        ],
      );
      return;
    }
    if (order.status === "acknowledged") {
      const {pendingInspection,remainingToArrive}=orderReceivingPosition(d,order);
      if (remainingToArrive <= 0 && pendingInspection > 0) {
        setSelected(order.id);
        setDetailTab("details");
        return;
      }
      if (remainingToArrive <= 0) {
        decision("Close supplier order", "order_status", order.id, {status:"closed",confirmed:false}, [
          {...f("confirmed", `I have checked ${order.quantity} ${order.unit} accepted against ${order.number}`, "check", true),hint:"Closing stops new receipts. It does not complete factory work, installation or settle invoices."},
          f("note", "Closure / inspection reference", "textarea", true),
        ]);
        return;
      }
      const delivery = order.vendorUpdates
        ?.filter((u) => u.kind === "delivery")
        .at(-1);
      decision(
        order.kind === "subcontract" ? "Accept measured service" : "Receive materials",
        "receipt",
        order.id,
        { received: 0, accepted: 0, rejected: 0, pending:0, receivedOn:today(), note: delivery?.evidence || "" },
        [
          f("receivedOn", order.kind === "subcontract" ? "Measurement date" : "Received date", "date", true),
          {...f("received", `${order.kind === "subcontract" ? "Work claimed this time" : "Arrived this delivery"} (${order.unit})`, "number", true),hint:order.kind === "subcontract" ? "Acceptance is limited to approved output from the linked task, including required inspection." : "Enter this delivery only, not the total ordered."},
          f(
            "accepted",
            `${order.kind === "subcontract" ? "Certified work" : "Accepted into stock"} (${order.unit})`,
            "number",
            true,
          ),
          f("rejected", `Rejected / damaged (${order.unit})`, "number", true),
          f("pending", `${order.kind === "subcontract" ? "Awaiting certification" : "Pending inspection"} (${order.unit})`, "number", true),
          f("note", order.kind === "subcontract" ? "Measurement / acceptance evidence" : "Delivery note reference / inspection notes", "textarea", true),
        ],
      );
    }
  }
  function editDocument(replaces = "", editing?: ProjectDocument) {
    const old = editing ?? d.documents.find((x) => x.id === replaces);
    open({
      title: editing ? "Edit document draft" : old ? "New document revision" : "Add document",
      action: "document",
      wrapper: "document",
      value: {
        title: old?.title ?? "",
        kind: old?.kind ?? "drawing",
        revision: "",
        url: "",
        note: "",
        replaces,
        scopeLineIds: old?.scopeLineIds ?? [],
        ...(editing ?? {}),
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
        f("scopeLineIds", "Released BOQ items", "multi", false, activeReleasedScopeLines(d).map(line=>({value:line.id,label:`${line.room} · ${line.title}`}))),
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
  function editHandover(sourcePackageId = "") {
    if(section === "handover") setView("packs");
    open({
      title: "Generate handover pack",
      action: "handover",
      wrapper: "handover",
      value: {
        area: "",
        sourcePackageId,
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
        {...f("installationBatchIds","Passed installation batches","multi",false,d.tasks.flatMap(task=>(task.installationBatches??[]).filter(batch=>batch.status==='passed'&&!d.handovers.some(h=>['ready','accepted'].includes(h.status)&&h.installationBatchIds?.includes(batch.id))).map(batch=>({value:batch.id,label:`${task.area} · ${batch.title} · ${batch.quantity} ${batch.unit}`})))),hint:"Optional: select batches for a partial handover. Leave empty for the full area/package."},
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
  function editWorkPackage(workPackage: ProjectWorkPackage, tab = "plan") {
    setWorkTab(tab);
    setError("");
    setPlanningWork(workPackage);
  }
  const schedule = (
    <>

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
  const weekAhead = new Date(Date.parse(`${today()}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const materialAction = (kind: MaterialAction, m: Material) => {
    if (kind === "open") { setSelected(m.id); setDetailTab("details"); }
    else if (kind === "order") editOrder(undefined, true, m);
    else if (kind === "allocate") {setSelected(m.id);setDetailTab("details");}
    else if (kind === "move") decision("Update stock quantity", "material_move", m.id, { kind: "issue", quantity: 0, taskId: m.taskId }, [
      f("kind", "What happened", "select", true, opts(m.supply === "company" ? ["issue", "return", "waste"] : ["receive", "issue", "return", "waste"])),
      f("quantity", "Quantity", "number", true),
      f("taskId", "For task", "select", false, taskOptions),
      f("note", "Delivery or stock evidence", "textarea", true),
    ]);
    else conversation(m.id);
  };
  const orderAction = (kind: OrderAction, o: Order) => {
    if (kind === "open") { setSelected(o.id); setDetailTab("details"); }
    else if (kind === "edit") editOrder(o);
    else if (kind === "step") advanceOrder(o);
    else if (kind === "vendor") void vendorAccess(o.id);
    else conversation(o.id);
  };
  const snagAction = (kind: SnagAction, x: Snag) => {
    if (kind === "submit") decision("Submit snag correction", "snag_status", x.id, { status: "ready" });
    else if (kind === "verify") decision("Verify snag closure", "snag_status", x.id, { status: "closed" });
    else if (kind === "reopen") decision("Reopen snag", "snag_status", x.id, { status: "open" });
    else conversation(x.id);
  };
  const handoverAction = (kind: HandoverAction, x: Handover) => {
    if (kind === "prepare") decision(
      x.status === "returned" ? "Prepare corrected handover pack" : "Review generated handover pack",
      "handover_status", x.id, { status: "ready", confirmed: false },
      [{ ...f("confirmed", "I reviewed the generated scope, inspections, passed commissioning, published closeout documents, accepted materials and affected defects", "check", true), hint: "The server regenerates the pack from live project records and rechecks every control before it becomes client-ready." }],
    );
    else if (kind === "accept") decision("Record client handover acceptance", "handover_status", x.id, { status: "accepted", acceptedBy: "" }, [
      f("signedRecord", "I have a signed client acceptance record to attach", "check", true),
      f("acceptedBy", "Client signatory", "text", true),
      f("note", "Signed acceptance reference / evidence", "textarea", true),
    ]);
    else if (kind === "warranty") open({
      title: "Record warranty defect", action: "warranty_snag", wrapper: "snag",
      value: { handoverId: x.id, area: x.area, title: "", severity: "minor", ownerId: "", dueDate: today(), evidence: "" },
      fields: [
        f("title", "Defect", "text", true),
        f("severity", "Severity", "select", true, opts(["minor", "major", "critical"])),
        f("ownerId", "Responsible person", "select", true, memberOptions),
        f("dueDate", "Response due", "date", true),
        f("evidence", "Photos / service request reference", "textarea", true),
      ],
    });
    else conversation(x.id);
  };
  const openOrders = d.orders.filter((o) => !["enquiry", "closed", "cancelled"].includes(o.status));
  const materialMetrics: StageMetric[] = [
    { label: "Requirements", value: d.materials.length },
    { label: "Shortfall", value: d.materials.filter((m) => m.supply === "company" && quantityToSource(m, d.orders, state.stockTransfers, d.supplierReturns) > 0).length, tone: "attention" },
    { label: "Needed this week", value: d.materials.filter((m) => m.needBy && m.needBy <= weekAhead && materialPosition(m).remaining > 0).length },
    { label: "Allocated units", value: d.materials.reduce((n, m) => n + materialPosition(m).reserved, 0) },
  ];
  const orderMetrics: StageMetric[] = [
    { label: "Open orders", value: openOrders.length },
    { label: "Awaiting approval", value: d.orders.filter((o) => o.status === "submitted").length, tone: "attention" },
    { label: "To expedite", value: expediting(state).length, tone: expediting(state).length ? "attention" : "neutral" },
    { label: "Overdue deliveries", value: openOrders.filter((o) => ["approved", "acknowledged"].includes(o.status) && o.promisedDate < today() && orderReceivingPosition(d,o).remainingToArrive>0).length, tone: "danger" },
    { label: "Committed", value: money(d.orders.filter((o) => ["approved", "acknowledged", "closed"].includes(o.status)).reduce((n, o) => n + o.quantity * o.unitCost, 0), d.scope?.currency) },
  ];
  const snagMetrics: StageMetric[] = [
    { label: "Open", value: d.snags.filter((x) => x.status === "open").length },
    { label: "Ready to verify", value: d.snags.filter((x) => x.status === "ready").length, tone: "attention" },
    { label: "Overdue", value: d.snags.filter((x) => x.status !== "closed" && x.dueDate < today()).length, tone: "danger" },
    { label: "Critical open", value: d.snags.filter((x) => x.status !== "closed" && x.severity === "critical").length, tone: "danger" },
  ];
  const handoverMetrics: StageMetric[] = [
    { label: "In preparation", value: d.handovers.filter((x) => ["draft", "returned"].includes(x.status)).length },
    { label: "With client", value: d.handovers.filter((x) => x.status === "ready").length, tone: "attention" },
    { label: "Accepted", value: d.handovers.filter((x) => x.status === "accepted").length, tone: "success" },
    { label: "Blocking items", value: d.handovers.reduce((n, x) => n + (x.outstandingItems ?? []).filter((item) => item.blocking && !["closed", "warranty"].includes(item.status)).length, 0), tone: "danger" },
  ];
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
                      fn: () => editHandover(),
                      allowed: state.canManage,
                    }
                  : null;
  const filtered = (text: string) =>
    text.toLowerCase().includes(search.toLowerCase());
  const taskView = ["plan-teams", "site-work", "production"].includes(section),
    tasks = d.tasks.filter(
      (t) =>
        t.status !== "cancelled" &&
        (!packageId || t.packageId === packageId) &&
        (section !== "production" || t.location === "factory") &&
        (section !== "site-work" || t.location === "site") &&
        (view === "all" || view === "tasks" ||
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
  const leafTasks = d.tasks.filter((t) => t.status !== "cancelled" && !d.tasks.some((c) => c.parentId === t.id && c.status !== "cancelled"));
  const taskMetrics = (scope: Task[]): StageMetric[] => [
    { label: "Tasks", value: scope.length },
    { label: "In progress", value: scope.filter((t) => t.status === "in_progress").length },
    { label: "Blocked", value: scope.filter((t) => ["blocked", "on_hold"].includes(t.status)).length, tone: "danger" },
    { label: "Awaiting inspection", value: scope.filter((t) => t.status === "awaiting_inspection").length, tone: "attention" },
    { label: "Complete", value: scope.filter((t) => t.status === "completed").length, tone: "success" },
  ];
  const planMetrics: StageMetric[] = [
    { label: "Tasks", value: leafTasks.length },
    { label: "Complete", value: leafTasks.filter((t) => t.status === "completed").length, tone: "success" },
    { label: "Overdue", value: leafTasks.filter((t) => t.status !== "completed" && t.end && t.end < today()).length, tone: "danger" },
    { label: "Milestones accepted", value: `${(d.milestones ?? []).filter((m) => m.acceptedAt).length} / ${(d.milestones ?? []).length}` },
  ];
  const reportMetrics: StageMetric[] = [
    { label: "Drafts", value: d.reports.filter((r) => r.status === "draft").length },
    { label: "To review", value: d.reports.filter((r) => r.status === "submitted").length, tone: "attention" },
    { label: "Returned", value: d.reports.filter((r) => r.status === "returned").length, tone: "danger" },
    { label: "Approved", value: d.reports.filter((r) => r.status === "approved").length, tone: "success" },
  ];
  const approvedDrawing = (id: string) => d.documents.some((x) => x.id === id && x.status === "approved");
  const linkableDesigns = d.tasks.filter((t) =>
    !["cancelled", "completed"].includes(t.status) && t.location !== "office" && !approvedDrawing(t.drawingId) &&
    d.documents.some((x) => x.status === "approved" && x.scopeLineIds?.some((id) => t.scopeIds.includes(id))),
  ).length;
  const documentMetrics: StageMetric[] = [
    { label: "Documents", value: d.documents.length },
    { label: "Awaiting approval", value: d.documents.filter((x) => x.status === "review").length, tone: "attention" },
    { label: "Approved", value: d.documents.filter((x) => x.status === "approved").length, tone: "success" },
    { label: "Shared with client", value: d.documents.filter((x) => x.published).length },
    ...(linkableDesigns ? [{ label: "Tasks without drawing", value: linkableDesigns, tone: "attention" as const }] : []),
  ];
  const contractValue = (d.scope?.value ?? 0) + (d.variations ?? []).reduce((n, v) => n + v.value, 0);
  const committed = d.orders.filter((o) => ["approved", "acknowledged", "closed"].includes(o.status)).reduce((n, o) => n + o.quantity * o.unitCost, 0);
  const commercialMetrics: StageMetric[] = [
    { label: d.variations?.length ? "Contract incl. variations" : "Contract value", value: money(contractValue, d.scope?.currency) },
    { label: "Approved budget", value: d.budget > 0 ? money(d.budget, d.scope?.currency) : "Not set" },
    { label: "Committed orders", value: money(committed, d.scope?.currency), tone: d.budget > 0 && committed > d.budget ? "danger" : "neutral" },
    { label: "Forecast at completion", value: d.forecast > 0 ? money(d.forecast, d.scope?.currency) : "Not set", tone: d.budget > 0 && d.forecast > d.budget ? "attention" : "neutral" },
  ];
  const scopeLines = [...(d.scope?.lines ?? []), ...(d.variations ?? []).flatMap((v) => v.lines)].filter((line) => !line.deductsLineId);
  const unplannedScope = scopeLines.filter((line) => !d.materials.some((m) => m.scopeLineId === line.id)).length;
  const toOrder = shortages(state).length;
  const stages: Record<string, { title: string; description: string; metrics: StageMetric[]; readOnly: boolean }> = {
    "plan-teams": { title: "Execution", description: "Plan, assign and track the same work from preparation to completion. Use Timeline to organize dates and dependencies.", metrics: planMetrics, readOnly: !state.canManage },
    production: { title: "Factory", description: "Workshop jobs made in-house or by an outside factory. Start when drawings, materials and approvals are ready; dispatch once output is approved.", metrics: taskMetrics(leafTasks.filter((t) => t.location === "factory")), readOnly: !state.canManage && !state.canReport },
    "site-work": { title: "Site", description: "Installation, commissioning and technical queries on site. Progress is proven through daily updates and inspections.", metrics: taskMetrics(leafTasks.filter((t) => t.location === "site")), readOnly: !state.canManage && !state.canReport },
    "daily-progress": { title: "Daily progress", description: "Field updates with quantities, photos and blockers. A reviewer approves each update before task progress changes.", metrics: reportMetrics, readOnly: !state.canReport && !state.canReview },
    "material-planning": { title: "Materials", description: "What each task needs, what is in stock and what still has to be ordered. Requirements come from the released quotation scope; stock changes only through recorded receipts, issues and returns.", metrics: [...(scopeLines.length ? [{ label: "Scope items planned", value: `${scopeLines.length - unplannedScope} / ${scopeLines.length}`, tone: unplannedScope ? "attention" as const : "success" as const }] : []), ...materialMetrics], readOnly: !state.canManage && !state.canBuy },
    procurement: { title: "Procurement", description: "Compare offers, approve orders and receive deliveries against the same project requirements.", metrics: [{ label: "To order", value: toOrder, tone: toOrder ? "attention" : "neutral" }, ...orderMetrics], readOnly: !state.canBuy },
    documents: { title: "Project files", description: "Approved drawings released from Planning plus specifications, permits and closeout records. Revisions keep the information used for released work.", metrics: documentMetrics, readOnly: !state.canManage && !state.canReview },
    snagging: { title: "Snags & warranty", description: "Every defect is assigned, corrected with evidence and verified by a different reviewer. Major and critical defects block area handover.", metrics: snagMetrics, readOnly: !state.canManage && !state.canReview && !state.canReport },
    handover: { title: "Handover", description: "Hand over by package or area. Packs are generated from live records and accepted by the client in the portal or with a signed record.", metrics: handoverMetrics, readOnly: !state.canReview && !state.canReport },
    commercial: { title: "Budget & payments", description: "Contract value, approved budget, committed orders and forecast, connected to the agreement and accounting records.", metrics: commercialMetrics, readOnly: !state.canReview },
  };
  const stage = stages[section];
  const views: [string, string][] =
    section === "overview" ? [["all", "Items"], ["summary", "Overview"], ["approvals", "Approvals"], ["client-updates", "Client updates"]]
    : section === "plan-teams" ? [["all", "Tasks"], ["teams", "Teams & bookings"]]
    : section === "site-work" ? [["all", "Site tasks"], ["mine", "My work"], ["attention", "Needs attention"], ["commissioning", "Commissioning"], ["technical_query", "Technical queries"]]
    : section === "production" ? [["all", "Factory tasks"], ["mine", "My work"], ["attention", "Needs attention"], ["capacity", "Capacity"], ["batches", "Batches"], ["dispatch", "Dispatch"]]
    : section === "daily-progress" ? [["all", "All updates"], ["draft", "Drafts"], ["submitted", "To review"], ["approved", "Approved"], ["returned", "Returned"], ["issues", "Issues & blockers"]]
    : section === "procurement" ? []
    : section === "material-planning" && (state.canBuy || state.canManage) ? [["all", "Requirements & stock"], ["warehouse", "Warehouse & transfers"]]
    : section === "documents" ? [["all", "Documents"], ["technical_query", "Technical queries"], ["transmittal", "Transmittals"]]
    : section === "commercial" ? [["all", "Budget"], ["invoices", "Supplier invoices"], ["accounting", "Client payments"], ["retention", "Retention"]]
    : [];
  const recordViews = ["capacity", "batches", "dispatch", "commissioning", "technical_query", "transmittal", "retention", "supplier_return", "warehouse", "calendar", "legacy"];
  const primaryButton =
    section === "procurement" && view === "invoices" ? (state.canBuy ? <Button size="compact" variant="primary" onPress={()=>editSupplierInvoice()}><Plus size={16}/>Record invoice</Button> : null) : section === "procurement" && view === "deliveries" ? null :
    section === "procurement" && view === "enquiries" && state.canBuy ? (
      <Button isDisabled={busy} onPress={() => editOrder(undefined, true)} size="compact" variant="primary"><Plus size={16} />Request supplier quotes</Button>
    ) : primary?.allowed && !recordViews.includes(view) ? (
      <Button isDisabled={busy} onPress={primary.fn} size="compact" variant="primary"><Plus size={16} />{primary.label}</Button>
    ) : null;
  function editCostPlan() {
    decision("Set project cost budget", "commercial", state.id,
      {budget:d.budget,forecast:d.forecast,financeClosed:d.financeClosed,financeEvidence:d.financeEvidence},
      [f("budget","Approved cost budget","number",true),f("forecast","Forecast final cost","number",true),f("note","Budget / forecast approval reference","textarea",true)]);
  }
  function reconcileAccount() {
    decision("Reconcile final account", "commercial", state.id,
      {budget:d.budget,forecast:d.forecast,financeClosed:d.financeClosed,financeEvidence:d.financeEvidence},
      [f("financeClosed","Final account reconciled","check"),f("financeEvidence","Reconciliation evidence","textarea",true),f("note","Review note","textarea",true)]);
  }
  const stageAction = (
    <>
      {["documents", "production", "site-work", "plan-teams"].includes(section) && state.canManage && linkableDesigns > 0 ? <Button isDisabled={busy} onPress={() => void run("link_designs")} size="compact">Link approved drawings · {linkableDesigns}</Button> : null}
      {section === "material-planning" && state.canManage && unplannedScope > 0 ? <Button isDisabled={busy} onPress={() => void run("materials_from_scope")} size="compact">Plan from scope · {unplannedScope}</Button> : null}
      {section === "procurement" && view === "deliveries" ? <Button size="compact" onPress={()=>setView("supplier_return")}>Returns & credits</Button> : null}
      {section === "handover" && state.canReview ? <Button isDisabled={busy || (d.phase !== "completed" && (!d.financeClosed || !d.handovers.length || d.handovers.some(h=>h.status!=="accepted") || d.tasks.some(t=>!["completed","cancelled"].includes(t.status)) || (d.workPackages??[]).some(w=>!["completed","cancelled"].includes(w.status)) || d.snags.some(s=>s.status!=="closed")))} onPress={() => d.phase === "completed" ? decision("Reopen project", "reopen_project", state.id) : void run("complete_project")} size="compact">{d.phase === "completed" ? "Reopen project" : "Complete project"}</Button> : null}
      {section === "commercial" && view === "all" ? <>
        {state.canManage && <Button isDisabled={busy} onPress={() => void run("sync_variations")} size="compact" variant="quiet">Sync scope changes</Button>}
        {state.canReview && <><Button isDisabled={busy} onPress={reconcileAccount} size="compact">Final account</Button><Button isDisabled={busy} onPress={editCostPlan} size="compact" variant="primary">{d.budget>0?"Edit budget":"Set budget"}</Button></>}
      </> : null}
      {section === "commercial" && view === "invoices" && state.canBuy && <Button variant="primary" size="compact" isDisabled={busy} onPress={()=>editSupplierInvoice()}><Plus size={14}/>Record invoice</Button>}
      {primaryButton}
    </>
  );
  function shortageAction(kind: ShortageAction, m: Material) {
    if (kind === "comments") conversation(m.id);
    else editOrder(undefined, kind === "enquiry", m);
  }
  function factoryAction(kind: FactoryAction, t: Task) {
    if (kind === "review") { const report=d.reports.find(r=>r.status==="submitted"&&r.entries.some(e=>e.taskId===t.id)); if(report)setViewingReportId(report.id); return; }
    if (kind === "open") { setSelected(t.id); setDetailTab("details"); }
    else if (kind === "start") void run("task_status", { id: t.id, status: "in_progress" });
    else if (kind === "report") newReport(t);
    else if (kind === "comments") conversation(t.id);
    else planDispatch(t);
  }
  function planDispatch(t: Task) {
    const receivingTasks = d.tasks.filter((candidate) => candidate.location === "site" && !["completed", "cancelled"].includes(candidate.status) && candidate.predecessors.includes(t.id));
    const receivingTask = receivingTasks.length === 1 ? receivingTasks[0] : undefined;
    setDispatchDraft({
      title: `${t.title} · delivery`,
      taskId: t.id,
      receivingTaskId: receivingTask?.id ?? "",
      quantity: projectInventory(d).factory.find(row=>row.taskId===t.id)?.available??0,
      dueDate: t.end,
      destination: receivingTask?.area ? `${state.name} · ${receivingTask.area}` : state.name,
    });
    setDispatchTaskId(t.id);
  }
  function documentAction(kind: DocumentAction, x: ProjectDocument) {
    if (kind === "submit") void run("document_status", { id: x.id, status: "review" });
    else if (kind === "approve") void run("document_status", { id: x.id, status: "approved" });
    else if (kind === "revise") editDocument(x.id);
    else if (kind === "edit") editDocument("", x);
    else if (kind === "publish" || kind === "unpublish") void run("publish_document", { id: x.id, published: kind === "publish" });
    else conversation(x.id);
  }
  const record = [
    ...d.tasks,
    ...d.reports,
    ...d.orders,
    ...d.materials,
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
  const RecordDialog = ControlledModalDialog;
  const taskBoard = (
    <ProjectTaskBoard
      state={state}
      tasks={tasks}
      busy={busy}
      showEmptyLanes={true}
      onEdit={editTask}
      onReport={newReport}
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
      className={`${theme.theme} ${s.page} ${workspaceStyles.recordTablePanel}`}
      aria-label={`${projectTabs.find(([id]) => id === section)?.[1]} workspace`}
    >
      {invoiceDetails && <ControlledModalDialog isOpen onOpenChange={isOpen=>{if(!isOpen)setInvoiceDetails(null)}} title={`Invoice ${invoiceDetails.number}`} size="md"><div className={s.section}><p>{d.orders.find(o=>o.id===invoiceDetails.orderId)?.vendor} · {invoiceDetails.date} · Due {invoiceDetails.dueDate}</p><p>{invoiceDetails.quantity} × {money(invoiceDetails.unitCost,d.scope?.currency)} + {money(invoiceDetails.tax,d.scope?.currency)} tax</p><strong>{money(invoiceTotal(invoiceDetails),d.scope?.currency)}</strong><p>{invoiceDetails.evidence}</p>{invoiceDetails.payments.length ? invoiceDetails.payments.map(p=><div className={s.row} key={p.id}><span>{p.date} · {p.reference}</span><strong>{money(p.amount,d.scope?.currency)}</strong></div>) : <p>No payments recorded.</p>}</div></ControlledModalDialog>}
      {!recordOnly && <>{section === "overview" && view === "summary" && <ProjectHeader
        busy={busy}
        onRefresh={() => void refresh()}
        run={run}
        state={state}
        status={success}
        today={today()}
      />}
      {error && !editor && !report && (
        <div className={s.callout}><Callout actions={<Button onPress={() => void refresh()} size="compact" variant="quiet">Refresh project</Button>} title="Something did not save" tone="danger">{error}</Callout></div>
      )}
      <ProjectWorkflowStrip state={state} busy={busy} run={run} />
      {!state.commercialReady && (
        <div className={s.callout}><Callout actions={<Link className={s.calloutLink} href={`${pre}/execution-release`}>Review release →</Link>} title={state.data.workflow?.template.code === "standard_delivery" && state.data.tasks.length > 0 ? "Review legacy commercial record" : "Execution not released"} tone="warning">{state.data.workflow?.template.code === "standard_delivery" && state.data.tasks.length > 0 ? "This existing project has recorded work, but its linked quotation, agreement or payment does not meet the current release checks. Reconcile the commercial record before advancing." : "A quotation, agreement or required payment approval is still pending, so work cannot start yet."}</Callout></div>
      )}
      {!["overview", "plan-teams", "production", "site-work", "daily-progress", "procurement", "material-planning", "commercial", "handover", "documents", "snagging"].includes(section) && stage ? (
        <StageHeader
          action={stageAction}
          description={section === "commercial" || section === "handover" || section === "documents" ? undefined : stage.description}
          metrics={section === "commercial" || section === "handover" || section === "documents" ? [] : stage.metrics}
          readOnly={stage.readOnly}
          title={stage.title}
        />
      ) : null}
      {!(connected && section === "overview" && view === "all") && (!["procurement", "material-planning", "handover"].includes(section) || ["supplier_return", "warehouse"].includes(view)) && (views.length > 1 || !["overview", "boq"].includes(section)) ? (
        <div className={s.toolbar}>
          <div className={s.tabs}>
            {views.length > 1 && !["material-planning", "plan-teams"].includes(section) && view !== "schedule" ? <SegmentedControl label="Views" options={views.map(([id, title]) => ({ id, label: title }))} value={view} onChange={setView} /> : null}
          </div>
          {!["overview", "boq", "commercial"].includes(section) ? <div className={s.search}><SearchInput label="Search project records" placeholder="Search this view…" value={search} onChange={setSearch} /></div> : null}
          {section === "plan-teams" && ["all", "tasks"].includes(view) && state.canManage && <Button size="compact" variant="primary" isDisabled={busy} onPress={()=>editTask()}><Plus size={14}/>Add task</Button>}
          {["procurement", "material-planning", "production", "site-work", "daily-progress", "commercial", "handover", "documents", "snagging"].includes(section) && <div className={s.detailActions}>{stageAction}</div>}
        </div>
      ) : null}
      {taskView && focusedPackage && <div className={s.row}><strong>{focusedPackage.title} · {focusedPackage.area}</strong>{state.canManage && <Button size="compact" onPress={()=>editWorkPackage(focusedPackage)}>Plan execution</Button>}<Link href={`/workspace/projects/${state.id}/plan-teams`}>Show all work</Link></div>}
      {(section === "production" || section === "site-work") && view === "all" && <div className={s.row}><span className={s.muted}>{section === "production" ? "Factory" : "On-site"} tasks are created in the delivery plan and tracked here without copying them. {d.tasks.filter(task=>task.location===(section === "production" ? "factory" : "site")&&task.status!=="cancelled").length} linked tasks · {(d.workPackages??[]).filter(work=>["ready","in_progress"].includes(work.status)).length} packages ready or active.</span><Link href={`/workspace/projects/${state.id}/overview`}>Review delivery plan →</Link></div>}

      {section === "production" && view === "batches" ? (
        <ProjectFactoryBatches key={`${state.id}:${state.data.revision}`} workspaceId={state.workspaceId} projectId={state.id} search={search}/>
      ) : section === "production" && view === "capacity" ? (
        <ProjectFactoryCapacity key={state.workspaceId} state={state} search={search} onBook={confirmBooking} />
      ) : view === "warehouse" ? (
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
        <ProjectCalendar state={state} run={run} busy={busy} today={today()} onOpen={(id) => { setSelected(id); setDetailTab("details"); }} />
      ) : section === "boq" ? (
        <ProjectBoq state={state} onEditWork={editWorkPackage} />
      ) : section === "overview" ? (
        <>{view === "client-updates" ? <ProjectClientUpdates state={state} busy={busy} error={error} run={run}/> : view === "approvals" ? <ProjectApprovals key={navigation.get("record")??"approvals"} state={state} busy={busy} error={error} run={run} initialId={navigation.get("record")}/> : view === "summary" ? <><ProjectOverview state={state} today={today()} open={id=>{setSelected(id);setDetailTab("details");}} conversation={conversation}/><ProjectInitiation state={state} busy={busy} run={run}/></> : connected ? <ProjectItemRegister state={state} busy={busy} error={error} run={run} onPlan={editWorkPackage} onRecord={id=>{setSelected(id);setDetailTab("details");}} onRefresh={()=>void refresh()}/> : <ProjectWorkOrders state={state} onOpen={editWorkPackage}/>}</>
      ) : taskView ? (
        section === "production" &&
        ["all", "tasks", "mine", "attention", "completed"].includes(view) ? (
          <FactoryTable state={state} tasks={tasks} busy={busy} onAction={factoryAction} />
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
            <ProjectTeams state={state} search={search} onOpen={task=>{setSelected(task.id);setDetailTab("details");}} onBook={confirmBooking}/>
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
            decision("Publish reviewed update", "publish_report", r.id, {clientSummary:r.clientSummary??""}, [
              f("clientSummary", "Update for the client", "textarea"),
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
          {procurementFilters}<MaterialsTable state={procurementState} scopeId={navigation.get("scope")??undefined} search="" toolbarActions={<>{navigation.get("scope") && <Link href={`/workspace/projects/${state.id}/material-planning`}>All requirements</Link>}{stageAction}</>} onAction={materialAction} /><ProjectFinishedStock state={state} onWork={task=>{setSelected(task.id);setDetailTab("details");}} onDelivery={planDispatch}/>
        </>
      ) : section === "procurement" ? (
        <>
          {view !== "suppliers" && procurementFilters}
          {view === "suppliers" ? <ProjectSuppliers workspaceId={state.workspaceId} onChange={()=>void loadSuppliers(state.workspaceId).then(setSupplierDirectory).catch(()=>{})}/> : view === "invoices" ? <><ProcurementTotals state={state}/><SupplierInvoices state={procurementState} search="" toolbarActions={stageAction} busy={busy} onEdit={editSupplierInvoice} onApprove={i=>void run("approve_supplier_invoice",{id:i.id})} onPay={i=>decision("Record supplier payment","supplier_payment",i.id,{amount:Math.round((invoiceTotal(i)-invoicePaid(i))*100)/100,date:today()},[f("amount","Amount paid","number",true),f("date","Payment date","date",true),f("reference","Bank / accounting reference","text",true)])}/></> : view === "deliveries" ? <ProcurementDeliveries state={procurementState} search="" toolbarActions={stageAction} onReceive={advanceOrder} onOpen={o=>orderAction("open",o)}/> : view === "enquiries" ? (
            <VendorComparison
              toolbarActions={stageAction}
              state={procurementState}
              onForm={(id) => void vendorAccess(id)}
              onEdit={(o) => orderAction("open",o)}
              onChoose={(o) => {
                const offer = o.vendorUpdates
                  ?.filter((u) => u.kind === "quotation")
                  .at(-1);
                decision(
                  "Select supplier quote",
                  "award_enquiry",
                  o.id,
                  {
                    quantity: offer?.quantity ?? o.quantity,
                    unitCost: offer?.unitCost ?? o.unitCost,
                    promisedDate: offer?.date || o.promisedDate,
                  },
                  [
                    f("quantity", "Order quantity", "number", true),
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
          ) : view === "shortages" ? (
            <ShortagesTable state={state} search={search} onAction={shortageAction} />
          ) : view === "expediting" ? (
            <ExpeditingTable state={state} search={search} onAction={orderAction} />
          ) : (
            <>
              {!d.budget && state.canBuy ? <div className={s.row}><span className={s.muted}>Set an approved budget before approving orders.</span>{state.canReview && <Button size="compact" onPress={editCostPlan}>Set budget</Button>}</div> : null}
              {toOrder && !d.orders.some((o) => o.status !== "enquiry") ? <div className={s.row}><span>{toOrder} materials to order</span><Button onPress={() => setView("shortages")} size="compact">View requirements</Button></div> : null}
              <OrdersTable state={procurementState} search="" toolbarActions={stageAction} onAction={orderAction} />
            </>
          )}
        </>
      ) : section === "documents" ? (
        <DocumentsTable state={state} search={search} onAction={documentAction} />
      ) : section === "snagging" ? (
        <>
          <SnagsTable state={state} search={search} onAction={snagAction} />
        </>
      ) : section === "handover" ? (
        <>
          {view === "all" ? <CloseoutReadiness state={state} toolbarActions={stageAction} search={search} onOpenTask={task=>{setSelected(task.id);setDetailTab("details");}}/> : <HandoversTable state={state} toolbarActions={stageAction} search={search} onAction={handoverAction} />}
        </>
      ) : section === "commercial" && view === "invoices" ? (
        <SupplierInvoices state={state} search="" busy={busy} onEdit={editSupplierInvoice} onApprove={i=>void run("approve_supplier_invoice",{id:i.id})} onPay={i=>decision("Record supplier payment","supplier_payment",i.id,{amount:Math.round((invoiceTotal(i)-invoicePaid(i))*100)/100,date:today()},[f("amount","Amount paid","number",true),f("date","Payment date","date",true),f("reference","Bank / accounting reference","text",true)])}/>
      ) : section === "commercial" && view === "accounting" ? (
        <ProjectAccounting
          workspaceId={state.workspaceId}
          caseId={state.caseId}
        />
      ) : section === "commercial" ? (
        <><ProcurementTotals state={state}/>
        <div className={s.row}><span className={s.muted}>Forecast final cost: {d.forecast>0?money(d.forecast,d.scope?.currency):"Not set"}</span><span className={s.muted}>Final account: {d.financeClosed?"Reconciled":"Open"}</span></div>
        {!d.budget&&<p className={s.muted}>Set a cost budget to approve supplier orders.</p>}
        <section className={s.section} aria-label="Contract and orders by room">
          <RoomBudgetTable state={state} onOpen={setBudgetRoom} />
          {!!d.changeCases?.length && <section aria-label="Accepted scope changes">{d.changeCases.map(change=><div className={s.row} key={change.requestId}><span>Change C{change.number} · {change.kind.replaceAll("_", " ")}</span><strong>{change.quoteIds.length} accepted document{change.quoteIds.length===1?"":"s"}</strong></div>)}</section>}
        </section></>
      ) : null}
      </>}
      <RecordDialog isOpen={budgetRoom!==null} onOpenChange={open=>!open&&setBudgetRoom(null)} size="lg" title={`${budgetRoom??''} · Order costs`}>
        <OrdersTable state={{...state,data:{...d,orders:d.orders.filter(o=>orderBudgetRoom(d,o)===budgetRoom&&["approved","acknowledged","closed"].includes(o.status))}}} search="" onAction={(kind,order)=>{setBudgetRoom(null);orderAction(kind,order);}}/>
      </RecordDialog>
      <RecordDialog
        isOpen={Boolean(selected)}
        onOpenChange={(v) => {if (!v) {setSelected("");setReturnTaskId(""); if(returnWork) {setPlanningWork(returnWork);setReturnWork(null);} else onRecordClose?.();}}}
        size="lg"
        title={
          task?.title ??
          ("title" in (record ?? {})
            ? String((record as { title: string }).title)
            : "Project record")
        }
      >
        <div className={task ? `${s.form} ${s.taskDialog}` : s.form}>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          {returnTaskId && <Button size="compact" variant="quiet" onPress={()=>{setSelected(returnTaskId);setDetailTab("materials");setReturnTaskId("");}}>← Back to task materials</Button>}
          {returnWork && <Button size="compact" variant="quiet" onPress={()=>{setSelected("");setPlanningWork(returnWork);setReturnWork(null);}}>← Back to {returnWork.title}</Button>}
          <div className={s.detailBar}>
            <SegmentedControl
              label="Record sections"
              options={(task
                ? [["details", "Details"], ["subtasks", "Subtasks"], ["materials", "Materials"], ["updates", task.location==="factory"?"Output":"Progress"], ["comments", `Comments (${comments.length})`], ["files", "Files"], ["history", "History"]]
                : d.orders.some(o=>o.id===selected) ? [["details", "Order details"], ["comments", `Comments (${comments.length})`]] : [...(d.materials.some(m=>m.id===selected) ? [["details", "Requirement"]] : d.handovers.some(item=>item.id===selected)||d.snags.some(item=>item.id===selected)?[["details","Details"]]:[]), ["comments", `Comments (${comments.length})`], ["files", "Files"], ["history", "History"]]
              ).map(([id, title]) => ({ id, label: title }))}
              value={detailTab}
              onChange={setDetailTab}
            />
            <Button
              isDisabled={busy}
              onPress={() => void run("follow", { id: selected, following: !d.followers?.some((f) => f.recordId === selected && f.memberId === state.memberId) })}
              size="compact"
              variant="quiet"
            >
              {d.followers?.some((f) => f.recordId === selected && f.memberId === state.memberId) ? "Following" : "Follow"}
            </Button>
          </div>
          {task && (() => {
            const empty = detailTab === "subtasks" && !d.tasks.some(item=>item.parentId===task.id)
              ? {title:"No subtasks yet",hint:"Break this task into smaller steps."}
              : detailTab === "updates" && !d.reports.some(report=>report.entries.some(entry=>entry.taskId===task.id))
              ? {title:"No progress updates yet",hint:task.status==="in_progress"?"Record completed work and photos.":"Updates appear here when work is reported."}
              : detailTab === "comments" && !comments.length
              ? {title:"No comments yet",hint:"Start a conversation with your team below."}
              : detailTab === "files" && !d.files?.some(file=>file.recordId===selected)
              ? {title:"No files attached",hint:"Attach a photo or PDF below."}
              : detailTab === "history" && !d.audit.some(event=>event.recordId===selected)
              ? {title:"No activity yet",hint:"Changes to this task will appear here."}
              : null;
            return empty ? <div className={s.taskEmpty}><Inbox size={24} aria-hidden="true"/><strong>{empty.title}</strong><p>{empty.hint}</p>{detailTab==="updates" && state.canReport && task.status==="in_progress" && <Button size="compact" variant="primary" isDisabled={busy} onPress={()=>newReport(task)}>Add update</Button>}</div> : null;
          })()}
          {detailTab === "details" && (()=>{
            const snag=d.snags.find(item=>item.id===selected);
            if(snag)return <section className={s.section}><Badge state={snag.status}/><p>{snag.evidence}</p><p>{snag.area} · {person(snag.ownerId)} · Fix by {snag.dueDate}</p>{snag.resolution&&<p>Correction: {snag.resolution}</p>}<div className={s.detailActions}>{(state.canManage||snag.ownerId===state.memberId)&&snag.status==="open"&&<Button size="compact" variant="primary" onPress={()=>snagAction("submit",snag)}>Submit correction</Button>}{state.canReview&&snag.status==="ready"&&<Button size="compact" variant="primary" onPress={()=>snagAction("verify",snag)}>Verify & close</Button>}{state.canManage&&snag.status!=="open"&&<Button size="compact" onPress={()=>snagAction("reopen",snag)}>Reopen defect</Button>}</div></section>;
            const handover=d.handovers.find(item=>item.id===selected);
            if(!handover)return null;
            return <section className={s.section}><Badge state={handover.status}/><p>{handover.area} · {handover.taskIds.length} tasks · {handover.documentIds.length} documents</p>{handover.acceptedBy&&<p>Accepted by {handover.acceptedBy} · {handover.acceptedAt}</p>}{handover.returnedNote&&<p>{handover.returnedNote}</p>}<ProjectHandoverScope handover={handover} state={state}/>{handover.outstandingItems?.map(item=><p key={item.id}>{item.title} · {item.status}</p>)}<div className={s.detailActions}>{state.canReview&&["draft","returned"].includes(handover.status)&&<Button size="compact" variant="primary" onPress={()=>handoverAction("prepare",handover)}>Prepare client review</Button>}{state.canReview&&handover.status==="ready"&&<Button size="compact" variant="primary" onPress={()=>handoverAction("accept",handover)}>Record signed acceptance</Button>}{state.canReport&&handover.status==="accepted"&&<Button size="compact" onPress={()=>handoverAction("warranty",handover)}>Record warranty defect</Button>}</div></section>;
          })()}
          {detailTab === "details" && (() => {
            const material = d.materials.find(m=>m.id===selected);
            return material ? <ProjectRequirementDetail key={material.id} state={state} material={material} busy={busy} run={run} onQuote={()=>editOrder(undefined,true,material)} onTransfer={()=>setStockMaterialId(material.id)} onPurchase={()=>editOrder(undefined,false,material)} onOrder={o=>orderAction("open",o)} onMove={kind=>decision(kind==="receive"?"Receive supplied materials":kind==="issue"?"Issue materials to work":"Return unused materials","material_move",material.id,{kind,taskId:material.taskId,quantity:0},[f("quantity",`Accepted quantity (${material.unit})`,"number",true),...(kind==="receive"?[]:[f("taskId","Task receiving / returning stock","select",true,taskOptions)]),f("note","Source / delivery note / inspection reference","textarea",true)])}/> : null;
          })()}
          {d.orders.some((o) => o.id === selected) &&
          detailTab === "details" ? (
            (() => {
              const order = d.orders.find((o) => o.id === selected)!;
              return (
                <ProjectOrderDetail
                  key={`${order.id}-${view}-${navigation.get("amendment")??""}`}
                  initialSection={navigation.get("amendment")?"amendments":view==="deliveries"||orderReceivingPosition(d,order).pendingInspection>0?"deliveries":"items"}
                  focusedAmendmentId={navigation.get("amendment")??undefined}
                  state={state}
                  order={order}
                  busy={busy}
                  onEdit={() => editOrder(order)}
                  onReassignAmendment={amendment=>decision("Reassign amendment review","order_amendment_assign",order.id,{amendmentId:amendment.id,reviewerId:amendment.reviewerId??"",dueDate:amendment.dueDate??today()},[f("reviewerId","Reviewer","select",true,state.members.filter(member=>member.canReview&&member.id!==amendment.createdBy).map(member=>({value:member.id,label:member.name}))),f("dueDate","Review due","date",true),f("note","Reassignment reason","textarea",true)])}
                  onProposeAmendment={()=>decision("Propose order amendment","order_amendment",order.id,{unitCost:order.unitCost,promisedDate:order.promisedDate},[f("reviewerId","Reviewer","select",true,state.members.filter(member=>member.canReview&&member.id!==state.memberId).map(member=>({value:member.id,label:member.name}))),f("dueDate","Review due","date",true),f("unitCost",`Revised unit price (${order.currency})`,"number",true),f("promisedDate","Revised delivery date","date",true),f("evidence","Supplier reference / evidence","text",true),f("note","Amendment reason","textarea",true)])}
                  onDecideAmendment={(amendment,result)=>decision(result==="approved"?"Approve amendment":result==="rejected"?"Reject amendment":"Withdraw amendment","order_amendment_decide",order.id,{amendmentId:amendment.id,decision:result},[f("note","Decision reason","textarea",true)])}
                  onOpenRelated={id=>{setSelected(id);setDetailTab("details");}}
                  onReplaceRequest={()=>decision("Replace supplier request","replace_enquiry",order.id,{quoteDueDate:order.quoteDueDate||today(),promisedDate:d.materials.find(material=>material.id===order.materialId)?.needBy||order.promisedDate},[f("quoteDueDate","Quotes due","date",true),f("promisedDate","Required delivery","date",true),f("note","Replacement reason","textarea",true)])}
                  onCancelRequest={()=>decision(order.status==="enquiry"?"Cancel supplier request":"Cancel supplier selection","order_status",order.id,{status:"cancelled"},[f("note","Cancellation reason","textarea",true)])}
                  onReopen={()=>decision("Reopen order receiving","reopen_order",order.id,{},[f("note","Reason for reopening","textarea",true)])}
                  onInvoice={invoice=>editSupplierInvoice(invoice,order)}
                  onOffer={()=>decision("Record supplier offer","record_supplier_offer",order.id,{quantity:order.quantity,unitCost:order.unitCost,promisedDate:order.promisedDate},[f("quantity","Offered quantity","number",true),f("unitCost","Unit price before tax","number",true),f("promisedDate","Offered delivery date","date",true),f("evidence","Supplier quotation document / reference","text",true),f("note","Notes","textarea")])}
                  onApproveInvoice={invoice=>void run("approve_supplier_invoice",{id:invoice.id})}
                  onPayInvoice={invoice=>decision("Record supplier payment","supplier_payment",invoice.id,{amount:Math.round((invoiceTotal(invoice)-invoicePaid(invoice))*100)/100,date:today()},[f("amount","Amount paid","number",true),f("date","Payment date","date",true),f("reference","Bank / accounting reference","text",true)])}
                  onNotes={()=>decision("Order notes","order_notes",order.id,{notes:order.notes??""},[f("notes","Notes","textarea")])}
                  onShipment={()=>decision("Update shipment","order_shipment",order.id,{status:order.shipments?.at(-1)?.status??"preparing",reference:order.shipments?.at(-1)?.reference??"",carrier:order.shipments?.at(-1)?.carrier??"",quantity:Math.min(order.shipments?.at(-1)?.quantity??orderReceivingPosition(d,order).remainingToArrive,orderReceivingPosition(d,order).remainingToArrive),expectedDate:order.shipments?.at(-1)?.expectedDate??order.promisedDate},[f("reference","Shipment / delivery note reference","text",true),f("status","Shipment status","select",true,opts(["preparing","dispatched","arrived"])),f("carrier","Carrier / driver","text"),f("quantity","Shipment quantity","number",true),f("expectedDate","Expected arrival","date",true),f("note","Notes","textarea")])}
                  onVendor={() => void vendorAccess(order.id)}
                  // ProjectOrderDetail calls this only from its button handler.
                  // eslint-disable-next-line react-hooks/refs
                  onStep={() => advanceOrder(order)}
                  onInspectReceipt={receipt=>decision(order.kind==="subcontract"?"Certify measured service":"Inspect delivery","receipt_inspect",order.id,{receiptId:receipt.id,expectedPending:receipt.pending,accepted:0,rejected:0},[{...f("accepted",`${order.kind==="subcontract"?"Certified quantity":"Accept"} (${order.unit})`,"number",true),hint:`${receipt.pending} ${order.unit} ${order.kind==="subcontract"?"awaiting certification":"pending QC"} · ${order.number}`},f("rejected",`Reject (${order.unit})`,"number",true),f("note","Inspection evidence / findings","textarea",true)])}
                />
              );
            })()
          ) : task && detailTab === "details" ? (
            <>
              <div className={s.taskSummary}><Badge state={task.status} /><span>{task.area || "General"} · {label(task.location)}</span>{state.canManage && <Button size="compact" onPress={()=>editTask(task)}>Edit task</Button>}</div>
              {(() => {const work=d.workPackages?.find(item=>item.id===task.packageId);return work?<section className={s.taskHandoff} aria-label="Planning to execution handoff"><div><strong>{work.title}</strong><span>{work.status==="planning"?"Planning checks pending — this task is not released for factory or site work.":["ready","in_progress","completed"].includes(work.status)?`Work package ${label(work.status)} — this task is shared by planning, factory, site and daily progress.`:"This work package is not released for new factory or site work. Review its status and checks."}</span></div><Badge state={work.status}/>{state.canManage&&<Button size="compact" onPress={()=>{setSelected("");editWorkPackage(work,"checks");}}>Review work plan</Button>}</section>:<div className={s.notice}>Link this task to a work package to carry its planning checks into execution.</div>;})()}
              <div className={s.taskDetailGrid}>
                <section className={s.taskDescription}><h3>Description</h3><p>{task.description || "No description added."}</p><h3>Work order</h3><p>{d.workPackages?.find(work=>work.id===task.packageId)?.title || task.package || "Not linked"}</p></section>
                <section className={s.taskProperties} aria-label="Task properties">
                  <SelectField label="Assignee" selectedKey={task.ownerId || "unassigned"} items={[{id:"unassigned",label:"Unassigned"},...state.members.map(member=>({id:member.id,label:member.name}))]} isDisabled={busy || !state.canManage} onSelectionChange={key=>{const ownerId=key==="unassigned"?"":String(key);void run("task",{task:{...task,ownerId,assigneeIds:[...new Set([...task.assigneeIds.filter(id=>id!==task.ownerId),...(ownerId?[ownerId]:[])])]}});}}/>
                  <div><span>Dates</span><strong>{task.start} → {task.end}</strong></div>
                  <SelectField label={task.location==="factory"?"Workshop / factory":"Crew / team"} selectedKey={task.resourceId || "unassigned"} items={[{id:"unassigned",label:"Not assigned"},...state.resources.filter(item=>item.active || item.id===task.resourceId).map(item=>({id:item.id,label:item.name}))]} isDisabled={busy || !state.canManage} onSelectionChange={key=>void run("task",{task:{...task,resourceId:key==="unassigned"?"":String(key)}})}/>
                  {task.resourceId && state.canManage && !["completed","cancelled"].includes(task.status) && !state.bookings.some(b=>b.projectId===state.id&&b.taskId===task.id&&b.status==="confirmed") && <Button size="compact" isDisabled={busy} onPress={()=>confirmBooking(task)}>Confirm booking</Button>}
                  <div><span>Priority</span><strong>{label(task.priority)}</strong></div>
                </section>
              </div>
              <Meter value={taskProgress(d, task)} />
              <ProjectInspectionHistory task={task} state={state}/>
              <ProjectInstallationBatches state={state} task={task} busy={busy} onCreate={()=>decision(task.location==="factory"?"Create production lot":"Create installation batch",task.location==="factory"?"factory_lot":"installation_batch",task.id,{title:'',quantity:0},[f("title",task.location==="factory"?"Lot name / reference":"Batch name / installed location","text",true),f("quantity",`Output quantity (${task.unit})`,"number",true)])} onReview={(batchId,passed)=>decision(passed?"Pass batch QC":"Return batch for rework",task.location==="factory"?"factory_lot_review":"installation_batch_review",task.id,{batchId,passed})} onCancel={batchId=>decision(task.location==="factory"?"Cancel production lot":"Cancel installation batch",task.location==="factory"?"factory_lot_cancel":"installation_batch_cancel",task.id,{batchId})}/>
              <p className={s.muted}>
                {task.approved} of {task.quantity} {task.unit} approved ·{" "}
                {task.area || "General"} · {label(task.location)}
              </p>
              <div className={s.grid}>
                {Object.entries(task.readiness).map(([k, v]) => (
                  <span key={k} className={s.readinessChip} data-ready={v}>
                    {v ? "✓" : "○"} {label(k)} {v ? "ready" : "pending"}
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
              <div className={s.detailActions}>
                {task.location==="factory" && task.approved>0 && <Button size="compact" onPress={()=>planDispatch(task)}>Dispatch & site receipt</Button>}
                {state.canManage && !["completed", "cancelled", "in_progress", "awaiting_inspection"].includes(task.status) && (
                  <Button
                    isDisabled={busy || !state.commercialReady}
                    onPress={() => void run("task_status", { id: task.id, status: "in_progress" })}
                    size="compact"
                    variant="primary"
                  >
                    Start work
                  </Button>
                )}
                {state.canReport && task.status === "in_progress" && !d.tasks.some((c) => c.parentId === task.id) && (
                  <Button onPress={() => newReport(task)} size="compact" variant="primary">{task.location==="factory"?"Record quantity built":"Record quantity installed"}</Button>
                )}
                {state.canReview && task.status === "awaiting_inspection" && !task.installationBatches?.some(batch=>batch.status!=='cancelled') && (
                  <>
                    <Button onPress={() => decision("Accept inspection", "inspect", task.id, { passed: true })} size="compact" variant="primary">Pass inspection</Button>
                    <Button onPress={() => decision("Inspection requires correction", "inspect", task.id, { passed: false })} size="compact">Return for correction</Button>
                  </>
                )}
                {state.canManage && (
                  <MenuButton
                    items={[
                      { id: "edit", label: "Edit task" },
                      { id: "subtask", label: "Add subtask", isDisabled: d.reports.some((r) => r.entries.some((e) => e.taskId === task.id)) },
                      ...(task.resourceId && !["completed","cancelled"].includes(task.status)
                        ? [state.bookings.some((b) => b.projectId === state.id && b.taskId === task.id)
                          ? { id: "release_booking", label: "Release booking", isDisabled: busy }
                          : { id: "booking", label: "Confirm booking" }]
                        : []),
                      ...(state.canReport && task.status !== "in_progress" && !d.tasks.some((c) => c.parentId === task.id) ? [{ id: "report", label: "Add daily update" }] : []),
                      { id: "status", label: "Hold / change status" },
                    ]}
                    label="More"
                    onAction={(id) => {
                      if (id === "edit") editTask(task);
                      else if (id === "subtask") editTask(undefined, task.id);
                      else if (id === "release_booking") void run("cancel_booking", { taskId: task.id });
                      else if (id === "report") newReport(task);
                      else if (id === "booking")
                        confirmBooking(task);
                      else
                        decision("Change task status", "task_status", task.id, { status: "on_hold" }, [
                          f("status", "Status", "select", true, opts(["planned", "blocked", "on_hold", "cancelled"])),
                          f("note", "Reason", "textarea", true),
                        ]);
                    }}
                  />
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
                <div><Button onPress={() => editTask(undefined, task.id)} size="compact" variant="primary"><Plus size={15} />Add subtask</Button></div>
              )}
            </>
          ) : task && detailTab === "materials" ? (
            <>
            {installationMaterialCapacity(d,task).controlled && <p role="status">{installationMaterialCapacity(d,task).issue ?? `${installationMaterialCapacity(d,task).quantity} ${task.unit} backed by issued materials · ${task.approved} approved`}</p>}
            <DataGrid gridLines ariaLabel="Task materials" rowNumbers={false} showToolbar={false} selectable={false} data={d.materials.filter(m=>m.taskId===task.id || m.reservations?.some(r=>r.taskId===task.id))} getRowId={m=>m.id} onRowAction={m=>{setReturnTaskId(task.id);setSelected(m.id);setDetailTab("details");}} columns={[
              {id:"title",header:"Material",accessorFn:m=>m.title,meta:{primary:true}},
              {id:"supply",header:"Source",accessorFn:m=>m.supply==="company"?"Company purchase / stock":m.supply==="client"?"Client supplied":"Included by supplier"},
              {id:"required",header:"Required",accessorFn:m=>`${m.required} ${m.unit}`},
              {id:"stock",header:"In stock",accessorFn:m=>`${materialPosition(m).stock} ${m.unit}`},
              {id:"allocated",header:"Allocated here",accessorFn:m=>`${m.reservations?.find(r=>r.taskId===task.id)?.quantity??0} ${m.unit}`},
              {id:"basis",header:"Usage basis",accessorFn:m=>m.outputBasis?`${m.outputBasis.perUnit} ${m.unit} / ${m.outputBasis.outputUnit}`:"Not set"},
              {id:"basis_action",header:"Action",meta:{renderCell:m=>task.location==="site" && m.taskId===task.id && m.supply!=="vendor" && state.canManage && !["completed","cancelled"].includes(task.status) && !m.movements.some(v=>["issue","return"].includes(v.kind)) && !d.reports.some(r=>r.entries.some(e=>e.taskId===task.id)) ? <Button size="compact" onPress={()=>decision("Material usage basis","material_output_basis",m.id,{perUnit:m.outputBasis?.perUnit??0},[f("perUnit",`${m.unit} per 1 ${task.unit}`,"number",true),f("note","Planning evidence / specification","textarea",true)])}>{m.outputBasis?"Edit usage basis":"Set usage basis"}</Button>:null}},
              {id:"issued",header:"Issued here",accessorFn:m=>`${m.movements.filter(v=>(v.taskId||m.taskId)===task.id).reduce((n,v)=>n+(v.kind==="issue"?v.quantity:v.kind==="return"?-v.quantity:0),0)} ${m.unit}`},
            ]} emptyTitle="No materials linked" emptyDescription="Link requirements to this task from Procurement → Requirements."/>
            </>
          ) : task && detailTab === "updates" ? (
            <>
            {state.canReport && !["completed","cancelled"].includes(task.status) && !d.tasks.some(child=>child.parentId===task.id) && <Button size="compact" variant="primary" onPress={()=>newReport(task)}>Log daily progress</Button>}
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
            </>
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
                      if (!result?.data) throw new Error("The save response was incomplete. Refresh and try again.");
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
                  <h3>Supplier submissions</h3>
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
                        <StateBadge state="resolved" />
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
              <ProjectCommentComposer key={selected} value={comment} mentions={mentions} members={state.members.filter(member=>member.canMention!==false)} busy={busy} onChange={(text,ids)=>{setComment(text);setMentions(ids);}} onSubmit={()=>{void (async()=>{if(await run("comment",{id:selected,text:comment,parentId:replyTo,mentions})){setComment("");setReplyTo("");setMentions([]);}})();}} />
            </>
          ) : detailTab === "history" ? (
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
          ) : null}
        </div>
      </RecordDialog>
      {stockMaterialId&&<ControlledModalDialog isOpen onOpenChange={open=>!open&&setStockMaterialId("")} title="Find & transfer stock" size="lg" footer={<Button onPress={()=>setStockMaterialId("")}>Back to material</Button>}><ProjectWarehouse state={state} materialId={stockMaterialId} onRefresh={async()=>{await refresh();}}/></ControlledModalDialog>}
      {dispatchTaskId&&<ControlledModalDialog isOpen onOpenChange={open=>!open&&setDispatchTaskId("")} title="Factory dispatch & site receipt" size="lg" footer={<Button onPress={()=>setDispatchTaskId("")}>Back to work</Button>}><ProjectControls state={state} kind="dispatch" taskId={dispatchTaskId} run={run} busy={busy} serverError={error} initialValues={Number(dispatchDraft?.quantity)>0?dispatchDraft:undefined}/></ControlledModalDialog>}
      {materialEditor && <ProjectMaterialEditor state={state} run={run} onClose={()=>{if(materialEditor==="quote")setQuoteRequest({});setMaterialEditor(null);}} onSaved={material=>{if(materialEditor==="quote")setQuoteRequest({source:material});setMaterialEditor(null);}}/>}
      {quoteRequest && <SupplierQuoteRequest onAddRequirement={()=>{setQuoteRequest(null);setMaterialEditor("quote");}} state={state} source={quoteRequest.source} onClose={()=>setQuoteRequest(null)}  run={run} onCreated={()=>{setQuoteRequest(null);if(section==="procurement")setView("enquiries");setSuccess("Supplier requests created. Open each request to share it.");}}/>}
      {planningWork && <ProjectWorkPlanEditor key={planningWork.id} state={state} work={d.workPackages?.find(work => work.id === planningWork.id) ?? planningWork} busy={busy} error={error} run={run} initialTab={workTab} onOpenRecord={(id,tab)=>{setWorkTab(tab);setReturnWork(planningWork);setPlanningWork(null);setSelected(id);setDetailTab("details");}} onHandover={()=>{const id=planningWork.id;setPlanningWork(null);editHandover(id);}} onOpenMaterial={(material)=>{setWorkTab("materials");setReturnWork(planningWork);setPlanningWork(null);setSelected(material.id);setDetailTab("details");}} onOpenTask={(task,tab,detail="details")=>{setWorkTab(tab);setReturnWork(planningWork);setPlanningWork(null);setSelected(task.id);setDetailTab(detail);}} onClose={()=>setPlanningWork(null)} />}
      <ControlledModalDialog
        isOpen={Boolean(vendorLink)}
        onOpenChange={(v) => !v && setVendorLink(null)}
        title="Share supplier request"
      >
        <div className={s.form}>
          <p className={s.muted}>
            Each link is private to one supplier and expires in seven days. Opening WhatsApp prepares a message; you send it there. Delivery is not tracked here. Generating a new link replaces the previous link.
          </p>
          {vendorLink && <SupplierWhatsAppLink order={d.orders.find(o=>o.id===vendorLink.orderId)} url={vendorLink.url}/>}
          <TextInput isReadOnly label="Supplier response link" value={vendorLink?.url ?? ""} />
          <div className={s.actions}>
            <a className={s.button} href={vendorLink?.url} rel="noreferrer" target="_blank">Preview supplier form ↗</a>
            <Button
              onPress={async () => {
                if (vendorLink) {
                  await navigator.clipboard.writeText(vendorLink.url);
                  setSuccess("Supplier link copied");
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
        isDismissable={!busy}
        footer={<div className="wd-dialog-actions"><Button onPress={()=>setEditor(null)} isDisabled={busy}>Cancel</Button><Button form="project-record-editor" type="submit" variant="primary" isLoading={busy}>{editor?.action==="receipt"?"Save receipt & update stock":"Save changes"}</Button></div>}
      >
        <Form
          id="project-record-editor"
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
            {editor && (['receipt','receipt_inspect','inspect','installation_batch_review','factory_lot_review'].includes(editor.action) || (editor.action==='handover_status' && form.status==='accepted')) && typeof editor.extra?.id==='string' && <ProjectDecisionEvidence key={`${editor.action}:${editor.extra.id}`} state={state} recordId={editor.extra.id} selected={Array.isArray(form.fileIds)?form.fileIds as string[]:[]} onChange={fileIds=>setForm(current=>({...current,fileIds}))} onData={data=>setState(current=>({...current,data}))} busy={busy} onBusy={setBusy}/>}
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
              {editor?.action==="receipt" && (()=>{const order=d.orders.find(o=>o.id===editor.extra?.id);const pending=order?.receipts.reduce((total,r)=>total+(r.pending??0),0)??0;return order ? <div className={s.receiptSummary}><strong>{order.number} · {d.materials.find(m=>m.id===order.materialId)?.title || order.title}</strong><p>{order.vendor} · Ordered {order.quantity} {order.unit} · Accepted {acceptedOrderQuantity(d,order)} · Pending QC {pending} · Yet to arrive {Math.max(0,order.quantity-acceptedOrderQuantity(d,order)-pending)} {order.unit}</p><p>Arrived = accepted + rejected + pending QC. Only accepted quantity enters stock.</p></div>:null;})()}
              {editor?.fields.map((field) => (
                <div key={field.key} className={["textarea", "multi"].includes(field.type ?? "") ? s.fullWidth : undefined}>
                  {field.type === "check" ? <Checkbox isSelected={form[field.key] === true} onChange={(value) => setForm((current) => ({ ...current, [field.key]: value }))}>{field.label}</Checkbox>
                    : field.type === "textarea" ? <TextAreaField description={field.hint} isRequired={field.required} label={field.label} onChange={(value) => setForm((current) => ({ ...current, [field.key]: value }))} value={String(form[field.key] ?? "")} />
                    : field.type === "multi" ? <MultiSelectField items={(field.options ?? []).map((option) => ({ id: option.value, label: option.label }))} label={field.label} onSelectionChange={(keys) => setForm((current) => ({ ...current, [field.key]: [...keys].map(String) }))} selectedKeys={new Set((form[field.key] as string[] | undefined) ?? [])} />
                    : field.type === "select" ? <SelectField description={field.hint} isRequired={field.required} items={(field.options ?? []).map((option) => ({ id: option.value, label: option.label }))} label={field.label} onSelectionChange={(key) => setForm((current) => {
                      const selectedWork = editor?.action==="task" && field.key==="packageId" ? d.workPackages?.find(work=>work.id===String(key)) : undefined;
                      const selectedLines = selectedWork ? scopeLines.filter(line=>selectedWork.scopeLineIds.includes(line.id)) : [];
                      const selectedDrawing = selectedWork ? d.documents.find(doc=>doc.status==="approved" && doc.scopeLineIds?.some(id=>selectedWork.scopeLineIds.includes(id))) : undefined;
                      const selectedOrder = editor?.action === "supplier_invoice" && field.key === "orderId" ? d.orders.find(o=>o.id===String(key)) : undefined;
                      const billed = selectedOrder ? (d.supplierInvoices ?? []).filter(i=>i.orderId===selectedOrder.id && i.status==="approved").reduce((n,i)=>n+i.quantity,0) : 0;
                      return { ...current, [field.key]: String(key ?? ""), ...(selectedWork ? {area:selectedWork.area,scopeIds:selectedWork.scopeLineIds,drawingId:selectedDrawing?.id ?? "",...(selectedLines.length===1 ? {quantity:selectedLines[0].quantity,unit:selectedLines[0].unit} : {})} : {}), ...(selectedOrder ? {unitCost:selectedOrder.unitCost,quantity:Math.max(0,acceptedOrderQuantity(d,selectedOrder)-billed)} : {}) };
                    })} selectedKey={String(form[field.key] ?? "") || null} />
                    : field.type === "number" ? <NumericInput description={field.hint} isRequired={field.required} label={field.label} minValue={0} onChange={(value) => setForm((current) => ({ ...current, [field.key]: value }))} value={typeof form[field.key] === "number" ? form[field.key] as number : NaN} />
                    : field.type === "date" ? <DateField label={field.label} isRequired={field.required} value={form[field.key] ? parseDate(String(form[field.key])) : null} onChange={value=>setForm(current=>({...current,[field.key]:value?.toString() ?? ""}))}/>
                    : <TextInput description={field.hint} inputType="text" isRequired={field.required} label={field.label} onChange={(value) => setForm((current) => ({ ...current, [field.key]: value }))} value={String(form[field.key] ?? "")} />}
                </div>
              ))}
            </div>
          </fieldset>
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
                  {clientSummary:current.clientSummary??""},
                  [
                    f("clientSummary", "Update for the client", "textarea"),
                    f(
                      "fileIds",
                      "Photos and files to share with the client",
                      "multi",
                      true,
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
