import type { Material, ProjectData, Task } from './execution.types';

export function issuedToTask(material: Material, taskId: string): number {
  return material.movements.reduce((total, movement) => total + (movement.taskId === taskId
    ? movement.kind === 'issue' ? movement.quantity : movement.kind === 'return' ? -movement.quantity : 0 : 0), 0);
}

/** Explicit opt-in; stock in the warehouse is not proof of custody by a site team. */
export function installationMaterialCapacity(data: ProjectData, task: Task): { controlled: boolean; quantity: number; issue?: string } {
  const materials = data.materials.filter(m => m.taskId === task.id && m.supply !== 'vendor');
  if (task.location !== 'site' || !materials.some(m => m.outputBasis)) return { controlled: false, quantity: task.quantity };
  let quantity = task.quantity;
  for (const material of materials) {
    const basis = material.outputBasis;
    if (!basis || !(basis.perUnit > 0) || basis.outputUnit !== task.unit)
      return { controlled: true, quantity: 0, issue: `Confirm the material usage basis for ${material.title} in ${task.unit}.` };
    quantity = Math.min(quantity, Math.max(0, issuedToTask(material, task.id)) / basis.perUnit);
  }
  return { controlled: true, quantity };
}
