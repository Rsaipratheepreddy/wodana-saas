import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmProblem, isPicture, paymentEvidence, returnPath, returnProblem, type CaseReceipt, type ClientPaymentReport, type ReviewRow,
} from '../src/features/approvals/review-model';

const row = (overrides: Partial<ReviewRow> = {}): ReviewRow => ({
  kind: 'order', id: 'order-1', amount: '1250.50', currency: 'USD', since: '2026-10-16T09:00:00Z', canDecide: true, parentId: null,
  decide: { approve: 'approve', other: 'return', approveNeedsNote: false }, ...overrides,
});
const receiptRow = (overrides: Partial<ReviewRow> = {}) => row({ kind: 'receipt', id: 'payment-1', parentId: 'case-1', amount: '15000.00', decide: { approve: 'verify_payment', other: null, approveNeedsNote: false }, ...overrides });
const report = (overrides: Partial<ClientPaymentReport> = {}): ClientPaymentReport => ({
  id: 'report-1', paymentId: 'payment-1', status: 'submitted', paidOn: '2026-10-15', reference: 'TRX-881', amount: '15000.00', currency: 'USD', note: 'Paid from the joint account',
  grantName: 'Client contact', at: '2026-10-15T10:00:00Z', version: 2,
  files: [{ id: 'asset-1', name: 'transfer.jpg', mimeType: 'image/jpeg', hasPreview: true }, { id: 'asset-2', name: 'statement.pdf', mimeType: 'application/pdf', hasPreview: false }], ...overrides,
});

test('Return always asks for a reason before it can be sent', () => {
  assert.equal(returnProblem(''), 'reason');
  assert.equal(returnProblem('  no  '), 'reason', 'blank space and two letters are not a reason');
  assert.equal(returnProblem('Wrong amount on the slip'), null);
});

test('Confirm is decided here only when the row can be, with a note when the approval asks for one', () => {
  assert.equal(confirmProblem(row(), ''), null);
  assert.equal(confirmProblem(row({ decide: { approve: 'approve', other: 'return', approveNeedsNote: true } }), 'ok'), 'note');
  assert.equal(confirmProblem(row({ decide: { approve: 'approve', other: 'return', approveNeedsNote: true } }), 'Checked against the order'), null);
  assert.equal(confirmProblem(row({ canDecide: false }), ''), 'decided_elsewhere');
  assert.equal(confirmProblem(row({ decide: null }), ''), 'decided_elsewhere');
});

test('Return goes where the server takes it: the row\'s own return or refusal, or the client\'s payment report', () => {
  assert.deepEqual(returnPath(row(), null), { kind: 'decide', decision: 'return' });
  assert.deepEqual(returnPath(row({ decide: { approve: 'approve', other: 'reject', approveNeedsNote: false } }), null), { kind: 'decide', decision: 'reject' });
  // A provider's settlement has no return; one the team recorded goes back to them with a reason; one the client
  // reported with proof is returned as "not received".
  assert.equal(returnPath(receiptRow(), { report: null }), null);
  assert.deepEqual(returnPath(receiptRow({ decide: { approve: 'verify_payment', other: 'return', approveNeedsNote: false } }), { report: null }), { kind: 'decide', decision: 'return' });
  assert.deepEqual(returnPath(receiptRow(), { report: { id: 'report-1', version: 2 } }), { kind: 'payment_report', reportId: 'report-1', version: 2 });
  assert.equal(returnPath(row({ canDecide: false }), null), null, 'your own: someone else decides');
});

test('a payment\'s evidence comes first: the client\'s proof, the amount as sent, how it was paid and who submitted it', () => {
  const receipts: CaseReceipt[] = [
    { paymentId: 'payment-0', status: 'reported', method: 'cash', reportedBy: 'Someone else' },
    { paymentId: 'payment-1', status: 'reported', method: 'bank', reference: 'TRX-881', receivedOn: '2026-10-15', reportedBy: 'Account manager', reportedAt: '2026-10-15T12:00:00Z', evidence: '' },
  ];
  const evidence = paymentEvidence(receiptRow(), receipts, [report({ id: 'old', status: 'not_received', at: '2026-10-01T10:00:00Z' }), report()]);
  assert.deepEqual(evidence, {
    files: report().files, amount: '15000.00', currency: 'USD', method: 'bank', provider: null, reference: 'TRX-881', paidOn: '2026-10-15', note: 'Paid from the joint account',
    submittedBy: 'Account manager', submittedAt: '2026-10-15T12:00:00Z', report: { id: 'report-1', version: 2 },
  });
  // The amount stays the server's exact string (never a float).
  assert.equal(typeof evidence.amount, 'string');
  // Without the receipt (no access to it), the client's report still says who paid and when.
  const portalOnly = paymentEvidence(receiptRow(), [], [report()]);
  assert.equal(portalOnly.submittedBy, 'Client contact');
  assert.equal(portalOnly.method, null);
  // A report already closed is shown, but there is nothing to return.
  assert.equal(paymentEvidence(receiptRow(), [], [report({ status: 'recorded' })]).report, null);
  assert.deepEqual(report().files.map(isPicture), [true, false]);
});
