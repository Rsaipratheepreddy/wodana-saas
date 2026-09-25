"use client";

import {
  Button,
  DataGrid,
  DataGridStatus,
  type DataGridColumn,
} from "@/design-system";
import {
  label,
  type ProjectConnectedPlan as ConnectedPlan,
  type ProjectState,
  type ProjectWorkPackage,
} from "@/lib/projects/execution";
import s from "./project-workspace.module.css";

type PlanPackage = ConnectedPlan["packages"][number];

const tone = (item: PlanPackage) =>
  item.risk === "blocked" || item.issues.some((issue) => issue.code === "promise")
    ? "danger"
    : item.risk === "watch" || item.issues.length
      ? "warning"
      : "success";

export function ProjectConnectedPlan({ state, onEdit }: {
  state: ProjectState;
  onEdit: (workPackage: ProjectWorkPackage) => void;
}) {
  const plan = state.connectedPlan;
  if (!plan) return null;
  const title = (id: string) => plan.packages.find((item) => item.id === id)?.title ?? "Unknown package";
  const person = (id: string) => state.members.find((member) => member.id === id)?.name ?? "Unassigned";
  const columns: DataGridColumn<PlanPackage>[] = [
    { accessorKey: "title", header: "Package", size: 230, meta: { primary: true, renderCell: (item) => <><strong>{item.title}</strong><span className={s.detail}>{item.area || "No area"} · {label(item.status)}</span></> } },
    { accessorKey: "ownerId", header: "Accountability", size: 180, meta: { renderCell: (item) => <><strong>{person(item.ownerId)}</strong><span className={s.detail}>{label(item.priority)} priority</span></> } },
    { id: "plan", header: "Plan & dependencies", size: 250, meta: { renderCell: (item) => <><strong>{item.plannedStart && item.plannedEnd ? `${item.plannedStart} → ${item.plannedEnd}` : "Dates required"}</strong><span className={s.detail}>{item.predecessorPackageIds.length ? `After ${item.predecessorPackageIds.map(title).join(", ")}` : "No package dependency"}</span></> } },
    { id: "commitments", header: "Supplier & capacity", size: 260, meta: { renderCell: (item) => <><strong>{item.supplierCommitments.length ? item.supplierCommitments.map((order) => `${order.vendor} · ${order.promisedDate}${order.leadTimeDays ? ` · ${order.leadTimeDays}d` : ""}`).join(" / ") : "No supplier commitment"}</strong><span className={s.detail}>{item.capacityCommitments.length ? item.capacityCommitments.map((booking) => `${booking.resourceName} · ${label(booking.bookingStatus)}`).join(" / ") : "No field capacity required"}</span></> } },
    { id: "nextAction", header: "Next action", size: 240, meta: { renderCell: (item) => <><strong>{item.nextAction || "Not set"}</strong><span className={s.detail}>{item.nextActionDate || "No due date"} · {person(item.nextActionOwnerId)}</span></> } },
    { id: "risk", header: "Risk", size: 170, meta: { renderCell: (item) => <><DataGridStatus tone={tone(item)}>{label(item.risk)}</DataGridStatus><span className={s.detail}>{item.issues[0]?.detail ?? "Plan connected"}</span></> } },
    { id: "actions", header: "", size: 90, meta: { align: "end", renderCell: (item) => {
      const workPackage = state.data.workPackages?.find((candidate) => candidate.id === item.id);
      return state.canManage && workPackage ? <Button onPress={() => onEdit(workPackage)} size="compact" variant="quiet">Edit</Button> : null;
    } } },
  ];
  return <section className={s.scheduleWorkspace} aria-labelledby="connected-plan-heading">
    <div className={s.timelineHeading}><div><h2 id="connected-plan-heading">Delivery packages</h2><p>{plan.promise.statement || "Set the client promise in project controls."}{plan.promise.targetCompletion ? ` Target ${plan.promise.targetCompletion}.` : ""}</p></div></div>
    <DataGrid gridLines appearance="flush" ariaLabel="Connected project packages" columns={columns} data={plan.packages} emptyDescription="Released scope creates delivery packages automatically." emptyTitle="No released packages" getRowId={(item) => item.id} rowNumbers={false} selectable={false} showToolbar={false} />
  </section>;
}
