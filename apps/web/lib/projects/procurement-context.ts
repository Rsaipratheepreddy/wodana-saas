import type { Order, ProjectData, Material } from "./execution";
export { acceptedOrderQuantity, orderReceivingPosition } from "../../../../services/business-core/src/projects/project-inventory";
/** Work location comes from the consuming task, never the supplier category. */
export function procurementContext(data: ProjectData, record: Order | Material) {
  const material = "materialId" in record ? data.materials?.find(m => m.id === record.materialId) : record;
  const task = data.tasks?.find(t => t.id === (record.taskId || material?.taskId));
  return { material, task, location: task?.location ?? "unassigned", area: task?.area || "Unassigned" };
}
export const procurementLocationLabel = (location: string) => ({factory:"Factory", site:"On-site", office:"Office", unassigned:"Unassigned"}[location] ?? location);
