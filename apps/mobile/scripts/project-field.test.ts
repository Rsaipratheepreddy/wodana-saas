import assert from 'node:assert/strict';
import test from 'node:test';
import { createSnagCommand, createWarrantySnagCommand, draftReportTaskCommand, handoverItemStatusCommand, localDay, receiveCommand, reportTaskCommand, snagStatusCommand } from '../src/projects/field-work';

test('project field actions keep the optimistic revision and stable request identity', () => {
  const base = { revision: 7, requestId: 'request-id' };
  assert.deepEqual(reportTaskCommand(base, {
    recordId: 'report-id', taskId: 'task-id', date: '2026-09-18', quantity: 2,
    summary: 'Installed first batch', evidence: 'Site photo and room check',
  }), {
    revision: 7, requestId: 'request-id', action: 'report_task', recordId: 'report-id',
    taskId: 'task-id', date: '2026-09-18', quantity: 2, summary: 'Installed first batch',
    evidence: 'Site photo and room check',
  });
  assert.deepEqual(receiveCommand(base, 'dispatch', {
    recordId: 'dispatch-id', accepted: 3, rejected: 1, evidence: 'Signed GRN',
  }), {
    revision: 7, requestId: 'request-id', action: 'receive_dispatch', recordId: 'dispatch-id',
    accepted: 3, rejected: 1, evidence: 'Signed GRN',
  });
});

test('project quality actions preserve canonical record, owner, and recovery fields', () => {
  const base = { revision: 4, requestId: 'request-id' };
  assert.deepEqual(draftReportTaskCommand(base, {
    recordId: 'report-id', taskId: 'task-id', date: '2026-09-18', quantity: 1,
    summary: 'Joinery installed', evidence: '', issues: 'Access delayed', scheduleImpact: 'watch',
    impactReason: 'Lift booking moved', recoveryPlan: 'Add evening shift', nextUpdateOwnerId: 'owner-id',
    nextUpdateDate: '2026-09-19',
  }), {
    revision: 4, requestId: 'request-id', action: 'draft_report_task', recordId: 'report-id',
    taskId: 'task-id', date: '2026-09-18', quantity: 1, summary: 'Joinery installed', evidence: '',
    issues: 'Access delayed', scheduleImpact: 'watch', impactReason: 'Lift booking moved',
    recoveryPlan: 'Add evening shift', nextUpdateOwnerId: 'owner-id', nextUpdateDate: '2026-09-19',
  });
  assert.equal(createSnagCommand(base, {
    recordId: 'snag-id', title: 'Damaged hinge', taskId: 'task-id', area: 'Bedroom',
    ownerId: 'owner-id', severity: 'major', dueDate: '2026-09-20', evidence: 'Photo reference',
  }).action, 'create_snag');
  assert.deepEqual(snagStatusCommand(base, {
    recordId: 'snag-id', status: 'ready', evidence: 'Hinge replaced',
  }), { revision: 4, requestId: 'request-id', action: 'snag_status', recordId: 'snag-id', status: 'ready', evidence: 'Hinge replaced' });
});

test('project field day is local rather than UTC rollover', () => {
  const date = new Date('2026-09-18T00:30:00+04:00');
  assert.equal(localDay(date), new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
});

test('handover and warranty actions preserve the exact packet and commitment identity', () => {
  const base = { revision: 9, requestId: 'request-id' };
  assert.deepEqual(handoverItemStatusCommand(base, {
    recordId: 'item-id', handoverId: 'handover-id', status: 'ready', evidence: 'Training signed',
  }), {
    revision: 9, requestId: 'request-id', action: 'handover_outstanding_status',
    recordId: 'item-id', handoverId: 'handover-id', status: 'ready', evidence: 'Training signed',
  });
  assert.deepEqual(createWarrantySnagCommand(base, {
    recordId: 'snag-id', handoverId: 'handover-id', title: 'Adjust hinge', taskId: 'task-id',
    ownerId: 'owner-id', severity: 'minor', dueDate: '2026-09-22', evidence: 'Client service note',
  }), {
    revision: 9, requestId: 'request-id', action: 'create_warranty_snag', recordId: 'snag-id',
    handoverId: 'handover-id', title: 'Adjust hinge', taskId: 'task-id', ownerId: 'owner-id',
    severity: 'minor', dueDate: '2026-09-22', evidence: 'Client service note',
  });
});
