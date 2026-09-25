import type { ProjectData } from './execution.types';
import type { ExecutionActor, applyExecution } from './execution.domain';

/** Explicitly invoked seed repair for the named Palm demo; never runs during normal requests. */
export function enrichPalmDemo(source: ProjectData, actor: ExecutionActor, command: typeof applyExecution) {
  const marker = 'palm-demo-sections-20260923-v1';
  if (source.processed.includes(marker)) return { data: source, changed: false };
  if (source.scope?.quoteId !== 'd2596719-0304-4624-bca0-5254cc1547c1') throw Error('Palm demo scope changed');
  const invalidOwner = 'f084de8a-dcb2-441f-8963-2727c102932a';
  const owner = 'f084de8a-dcb2-441c-a14d-8c8d84954280';
  if (!actor.memberIds.includes(owner)) throw Error('Palm demo owner missing');
  const data: ProjectData = JSON.parse(JSON.stringify(source), (_key, value) => value === invalidOwner ? owner : value);
  const factory = data.tasks.find(task => task.id === '72000000-0000-4000-8000-000000000002');
  const site = data.tasks.find(task => task.id === '72000000-0000-4000-8000-000000000005');
  const material = data.materials.find(item => item.id === '76000000-0000-4000-8000-000000000001');
  const order = data.orders.find(item => item.id === '77000000-0000-4000-8000-000000000001');
  const drawing = data.documents.find(doc => doc.id === '75000000-0000-4000-8000-000000000003');
  if (!factory || !site || !material || !order || !drawing) throw Error('Demo execution references missing');
  const due = '2026-09-30';
  const id = (suffix: string) => `7ba40000-0000-4000-8000-${suffix.padStart(12, '0')}`;
  const run = (action: string, input: Record<string, unknown>) => command(data, action, input, actor);

  // Only repair stale imported links in draft handovers; never change accepted evidence.
  for (const handover of data.handovers.filter(pack => pack.status === 'draft')) {
    if (handover.taskIds.some(value => !data.tasks.some(task => task.id === value))) {
      handover.taskIds = data.tasks.filter(task => task.area === handover.area && task.location === 'site').map(task => task.id);
    }
    if (handover.documentIds.some(value => !data.documents.some(doc => doc.id === value))) {
      const scopeIds = data.scope!.lines.filter(line => line.room === handover.area).map(line => line.id);
      handover.documentIds = data.documents.filter(doc => doc.status === 'approved' && doc.scopeLineIds?.some(value => scopeIds.includes(value))).map(doc => doc.id);
    }
  }
  const dispatch = data.dispatches?.find(row => row.id === '78000000-0000-4000-8000-000000000001');
  if (dispatch?.receivingTaskId === '72000000-0000-4000-8000-000000000003') dispatch.receivingTaskId = site.id;

  if (!data.rfas?.some(row => row.documentId === drawing.id)) run('rfa_save', {
    id: id('1'), version: 0, documentId: drawing.id, reviewerId: '', dueDate: due,
    instructions: 'DEMO RFA · Review the coordination schematic against the released living-room scope. Assign an independent reviewer before submission. Not a client approval.',
  });
  if (!data.clientUpdates?.some(row => row.title === 'DEMO · Weekly project update')) run('client_update_save', { update: {
    title: 'DEMO · Weekly project update', kind: 'progress', sourceType: 'task', sourceId: site.id,
    summary: `Illustrative draft from the seeded project: ${site.approved}/${site.quantity} ${site.unit} recorded for living-room installation. Factory dressing-room work remains in progress. Internal draft only; not sent to the client.`,
  }});
  if (!data.supplierInvoices?.some(row => row.number === 'DEMO-INV-PL-001')) run('supplier_invoice', {
    orderId: order.id, number: 'DEMO-INV-PL-001', date: '2026-09-23', dueDate: due,
    quantity: order.quantity, unitCost: order.unitCost, tax: 0,
    evidence: 'DEMO invoice draft derived from the existing sample PO. Tax, supplier invoice and accounting review pending. No payment recorded.',
  });
  if (!data.transmittals?.some(row => row.id === id('2'))) run('transmittal', { record: {
    id: id('2'), title: 'DEMO · Joinery drawing coordination pack', recipient: 'DEMO internal site coordination team', dueDate: due,
    purpose: 'Draft review package using existing project drawings. No external transmission.',
    documentIds: data.documents.filter(doc => doc.status === 'approved').map(doc => doc.id),
  }});
  if (!data.commissioning?.some(row => row.id === id('3'))) run('commissioning', { record: {
    id: id('3'), title: 'DEMO · Living room lighting pre-handover check', taskId: site.id,
    ownerId: site.ownerId, dueDate: due, system: 'Integrated joinery lighting', readings: [],
    evidence: 'DEMO draft checklist. Enter actual readings after installation; no test result or pass is claimed.',
  }});
  if (!data.technicalQueries?.some(row => row.id === id('4'))) run('technical_query', { record: {
    id: id('4'), title: 'DEMO · Confirm care and maintenance instructions', taskIds: [], ownerId: owner, dueDate: due,
    question: 'For the sample handover, confirm the veneer-care instructions and maintenance contact. Coordination-only query; no task is blocked.',
  }});
  if (!data.supplierReturns?.some(row => row.id === id('5'))) run('supplier_return', { record: {
    id: id('5'), orderId: order.id, quantity: 1, creditAmount: 0,
    reason: 'DEMO proposed return of one sheet for inspection. Draft only: no stock deduction, dispatch, supplier acknowledgement or credit.',
  }});
  if (!data.retentions?.some(row => row.id === id('6'))) run('retention', { record: {
    id: id('6'), title: 'DEMO · Illustrative five-percent retention', amount: Math.round(data.scope!.value * 0.05 * 100) / 100,
    dueDate: '2027-09-30', handoverId: data.handovers[0]?.id ?? '',
    condition: 'Demonstration only. Verify the actual agreement before any release. No payment or contract amendment is created.',
  }});
  if (!data.orders.some(row => row.id === id('7'))) {
    run('material', { material: {id: id('8'), title: 'DEMO · Joinery protection sheets for delivery', unit: 'sheet', required: 12,
      supply: 'company', taskId: site.id, needBy: due, scopeLineId: site.scopeIds[0], specification: 'Sample delivery-protection requirement; quantity requires site confirmation.'} });
    run('enquiry', { order: {id: id('7'), title: 'DEMO · Quote request for delivery protection', kind: 'material',
      materialId: id('8'), taskId: site.id, quantity: 12, unit: 'sheet', unitCost: 0,
      vendorId: id('10'), vendor: 'DEMO supplier · Timber and packaging', vendorContact: '', quoteDueDate: '2026-09-28', promisedDate: due} });
  }
  if (!data.comments.some(row => row.text.includes(marker))) run('comment', {id: site.id, text: `DEMO data preparation (${marker}): draft RFQ, RFA, invoice, commissioning, transmittal and client update linked. No external messages or payments sent.`});
  data.processed.push(marker);
  data.audit.push({id: id('9'), at: actor.now, author: actor.name, action: 'demo_seed_repair', recordId: marker,
    note: 'Repaired invalid imported member/task/document links in this demo only. Added editable draft examples; existing approval and payment decisions preserved.'});
  return { data, changed: true };
}
