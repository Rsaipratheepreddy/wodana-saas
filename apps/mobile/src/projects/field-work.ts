export type FieldCommandBase = { revision: number; requestId: string };

export function reportTaskCommand(base: FieldCommandBase, input: {
  recordId: string; taskId: string; date: string; quantity: number; summary: string; evidence: string;
}) {
  return { ...base, action: 'report_task', ...input };
}

export function draftReportTaskCommand(base: FieldCommandBase, input: {
  recordId: string;
  taskId: string;
  date: string;
  quantity: number;
  summary: string;
  evidence: string;
  issues: string;
  scheduleImpact: 'none' | 'watch' | 'blocked';
  impactReason: string;
  recoveryPlan: string;
  nextUpdateOwnerId: string;
  nextUpdateDate: string;
}) {
  return { ...base, action: 'draft_report_task', ...input };
}

export function createSnagCommand(base: FieldCommandBase, input: {
  recordId: string;
  title: string;
  taskId: string;
  area: string;
  ownerId: string;
  severity: 'minor' | 'major' | 'critical';
  dueDate: string;
  evidence: string;
}) {
  return { ...base, action: 'create_snag', ...input };
}

export function snagStatusCommand(base: FieldCommandBase, input: {
  recordId: string;
  status: 'open' | 'ready' | 'closed';
  evidence: string;
}) {
  return { ...base, action: 'snag_status', ...input };
}

export function createWarrantySnagCommand(base: FieldCommandBase, input: {
  recordId: string;
  handoverId: string;
  title: string;
  taskId: string;
  ownerId: string;
  severity: 'minor' | 'major' | 'critical';
  dueDate: string;
  evidence: string;
}) {
  return { ...base, action: 'create_warranty_snag', ...input };
}

export function handoverItemStatusCommand(base: FieldCommandBase, input: {
  recordId: string;
  handoverId: string;
  status: 'open' | 'ready' | 'closed' | 'warranty';
  evidence: string;
}) {
  return { ...base, action: 'handover_outstanding_status', ...input };
}

export function receiveCommand(base: FieldCommandBase, kind: 'dispatch' | 'order', input: {
  recordId: string; accepted: number; rejected: number; evidence: string;
}) {
  return { ...base, action: kind === 'dispatch' ? 'receive_dispatch' : 'receive_order', ...input };
}

export const projectFieldLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export const localDay = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};
