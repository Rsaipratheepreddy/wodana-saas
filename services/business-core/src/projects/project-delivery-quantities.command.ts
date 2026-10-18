import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { ExecutionActor } from './execution.domain';
import type { DeliveryQuantityRow, ProjectData } from './execution.types';
import { activeReleasedScopeLines } from './project-scope-lines';
import { deliveryQuantityIssues, itemHasCommitments } from './project-delivery-quantities';

export function applyDeliveryQuantities(data: ProjectData, input: Record<string, unknown>, actor: ExecutionActor, revise: boolean) {
  if (!actor.manage) throw new ForbiddenException('A project planner must make this change.');
  const work = data.workPackages?.find(item => item.id === input.id);
  if (!work) throw new BadRequestException('Choose an existing project item.');
  if (['completed','cancelled','in_progress'].includes(work.status) || itemHasCommitments(data, work)) throw new ConflictException('This item has work or supply commitments. Review the impact before changing delivery quantities.');
  const current = work.deliveryQuantities;
  if (input.version !== (current?.version ?? 0)) throw new ConflictException('Delivery quantities changed. Refresh and review before saving.');
  const text = (value: unknown, max: number) => {
    if (typeof value !== 'string' || value.length > max) throw new BadRequestException('Enter a valid delivery field.');
    return value.trim();
  };
  if (revise) {
    if (current?.status !== 'confirmed') throw new ConflictException('Only confirmed quantities can be revised.');
    const reason = text(input.reason, 3000);
    if (!reason) throw new BadRequestException('Record why the confirmed quantities need revision.');
    work.deliveryQuantityHistory = [...(work.deliveryQuantityHistory ?? []), structuredClone(current)];
    work.deliveryQuantities = {version:current.version+1,status:'draft',rows:structuredClone(current.rows),updatedAt:actor.now,updatedBy:actor.id,revisionReason:reason};
  } else {
    if (current?.status === 'confirmed') throw new ConflictException('Revise confirmed quantities with a reason before changing them.');
    if (!['draft','confirmed'].includes(String(input.status))) throw new BadRequestException('Choose draft or confirmed quantities.');
    if (!Array.isArray(input.rows) || input.rows.length > 200) throw new BadRequestException('Use at most 200 deliveries in one item.');
    const rows: DeliveryQuantityRow[] = input.rows.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Enter a valid delivery row.');
      const row = value as Record<string,unknown>;
      if (!Array.isArray(row.sources) || row.sources.length > 200) throw new BadRequestException('Enter delivery source allocations.');
      return {id:text(row.id,80),title:text(row.title,240),quantity:typeof row.quantity === 'number' ? row.quantity : NaN,unit:text(row.unit,40),basis:text(row.basis ?? '',3000),sources:row.sources.map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException('Enter a valid source allocation.');
        return {scopeLineId:text(entry.scopeLineId,80),quantity:typeof entry.quantity === 'number' ? entry.quantity : NaN};
      })};
    });
    const sources = activeReleasedScopeLines(data).filter(line => work.scopeLineIds.includes(line.id));
    const confirmed = input.status === 'confirmed';
    const issues = deliveryQuantityIssues(sources, rows, confirmed);
    if (issues.length) throw new BadRequestException(issues[0]);
    work.deliveryQuantities = {version:(current?.version ?? 0)+1,status:confirmed?'confirmed':'draft',rows,updatedAt:actor.now,updatedBy:actor.id,revisionReason:current?.revisionReason,
      ...(confirmed ? {confirmedAt:actor.now,confirmedBy:actor.id,sourceSnapshot:structuredClone(sources)} : {})};
  }
  work.updatedAt = actor.now;
  return work.id;
}
