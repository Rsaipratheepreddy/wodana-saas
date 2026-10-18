import type { DeliveryQuantityRow, ProjectData, ProjectWorkPackage, ReleasedScopeLine } from './execution.types';
import { activeReleasedScopeLines } from './project-scope-lines';

// Measurement precision is six decimal places; never reconcile unlike units.
export const quantityScale = 1_000_000;
export function sourceBalances(sources: ReleasedScopeLine[], rows: DeliveryQuantityRow[]) {
  return sources.map(source => {
    const allocated = rows.flatMap(row => row.sources).filter(entry => entry.scopeLineId === source.id)
      .reduce((sum, entry) => sum + Math.round(entry.quantity * quantityScale), 0) / quantityScale;
    return { ...source, allocated, remaining: (Math.round(source.quantity * quantityScale) - Math.round(allocated * quantityScale)) / quantityScale };
  });
}
export function deliveryQuantityIssues(sources: ReleasedScopeLine[], rows: DeliveryQuantityRow[], confirm: boolean): string[] {
  const issues: string[] = [];
  const positive = (n: number) => Number.isFinite(n) && n > 0 && n <= 1e9 && Math.abs(n * quantityScale - Math.round(n * quantityScale)) < 0.001;
  if (!sources.length) issues.push('This item has no active released BOQ source. Review its scope first.');
  if (confirm && !rows.length) issues.push('Add at least one delivery before confirming quantities.');
  if (new Set(rows.map(row => row.id)).size !== rows.length) issues.push('Delivery identifiers must be unique.');
  for (const row of rows) {
    if (!row.id || !row.title.trim() || !row.unit.trim() || !positive(row.quantity)) issues.push('Each delivery needs a title, unit and positive quantity with at most six decimal places.');
    if (!row.sources.length || new Set(row.sources.map(source => source.scopeLineId)).size !== row.sources.length) issues.push(`${row.title || 'Delivery'} needs distinct BOQ source allocations.`);
    for (const source of row.sources) {
      if (!sources.some(line => line.id === source.scopeLineId)) issues.push('Allocate only active BOQ sources belonging to this item.');
      if (!positive(source.quantity)) issues.push('Source quantities must be positive with at most six decimal places.');
    }
    const source = sources.find(line => line.id === row.sources[0]?.scopeLineId);
    const direct = row.sources.length === 1 && source?.unit === row.unit && row.sources[0].quantity === row.quantity;
    if (!direct && !row.basis.trim()) issues.push(`${row.title || 'Delivery'} needs a measurement basis for bundled sources or different quantities/units.`);
  }
  for (const source of sourceBalances(sources, rows)) {
    if (source.remaining < 0) issues.push(`${source.title}: allocated quantity exceeds ${source.quantity} ${source.unit}.`);
    else if (confirm && source.remaining > 0) issues.push(`${source.title}: allocate the remaining ${source.remaining} ${source.unit} before confirming.`);
  }
  return issues;
}
export function deliveryQuantityReadiness(data: ProjectData, work: ProjectWorkPackage): string | undefined {
  const plan = work.deliveryQuantities;
  if (!plan) return; // Preserve legacy plans without inventing allocations.
  if (plan.status !== 'confirmed') return 'Confirm delivery quantities before releasing or starting work.';
  const sources = activeReleasedScopeLines(data).filter(line => work.scopeLineIds.includes(line.id));
  const signature = (lines: ReleasedScopeLine[]) => JSON.stringify([...lines].sort((a,b)=>a.id.localeCompare(b.id)));
  if (!plan.sourceSnapshot || signature(sources) !== signature(plan.sourceSnapshot)) return 'The released BOQ changed. Review and revise the delivery quantities.';
  return deliveryQuantityIssues(sources, plan.rows, true)[0];
}
export function itemHasCommitments(data: ProjectData, work: ProjectWorkPackage) {
  const tasks = data.tasks.filter(task => task.packageId === work.id);
  const taskIds = new Set(tasks.map(task => task.id));
  const materials = data.materials.filter(material => taskIds.has(material.taskId) || work.scopeLineIds.includes(material.scopeLineId ?? ''));
  const materialIds = new Set(materials.map(material => material.id));
  return tasks.some(task => task.approved > 0 || ['in_progress','awaiting_inspection','completed'].includes(task.status))
    || data.reports.some(report => report.entries.some(entry => taskIds.has(entry.taskId)))
    || data.orders.some(order => (taskIds.has(order.taskId) || materialIds.has(order.materialId)) && (!['enquiry','draft','cancelled'].includes(order.status) || order.receipts.length > 0))
    || materials.some(material => material.movements.length > 0);
}
