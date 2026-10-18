import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answerable, answerVersion, askedGroups, changedAnswers, draftsFrom, requiredLeft, type DesignJourneyView, type SiteChecklistItem,
} from '../src/features/survey/questions-model';

const question = (key: string, overrides: Partial<SiteChecklistItem> = {}): SiteChecklistItem => ({
  key, question: `Question ${key}`, kind: 'answer', required: false, answer: null, status: null, answeredByName: null, answeredAt: null, ...overrides,
});
const view = (overrides: Partial<DesignJourneyView> = {}): DesignJourneyView => ({
  stages: [{ stage: 'kickoff', status: 'done', version: 3 }],
  siteVisit: { within: 'task', open: true, done: false, version: 5 },
  checklist: [question('access', { required: true }), question('ceiling'), question('wardrobe', { kind: 'check', scope: 'Wardrobes' }), question('pool', { scope: 'Pool' })],
  checklistGroups: [
    { scope: null, section: 'Project overview', required: true, keys: ['access', 'ceiling'] },
    { scope: 'Wardrobes', required: true, keys: ['wardrobe'] },
    { scope: 'Pool', required: false, keys: ['pool'] },
  ],
  canEdit: true, ...overrides,
});

test('the phone asks the firm\'s published questions for this job: general first, then the checklists that apply', () => {
  const groups = askedGroups(view());
  assert.deepEqual(groups.map((group) => [group.title, group.questions.map((item) => item.key)]), [['Project overview', ['access', 'ceiling']], ['Wardrobes', ['wardrobe']]]);
});

test('questions are optional unless the firm marked them required', () => {
  const groups = askedGroups(view());
  const drafts = draftsFrom(view().checklist!);
  assert.equal(requiredLeft(groups, drafts), 1, 'only the required one counts');
  drafts.access = { answer: 'Lift to floor 4', status: null };
  assert.equal(requiredLeft(groups, drafts), 0, 'the optional ones may stay empty');
});

test('only what changed is sent; a checklist line needs its status before its note', () => {
  const checklist = view().checklist!.map((item) => (item.key === 'ceiling' ? { ...item, answer: '2.7 m' } : item));
  const drafts = draftsFrom(checklist);
  assert.deepEqual(changedAnswers(drafts, checklist), []);
  drafts.access = { answer: '  Lift to floor 4 ', status: null };
  drafts.ceiling = { answer: '', status: null };
  drafts.wardrobe = { answer: 'Measure the alcove', status: null };
  assert.deepEqual(changedAnswers(drafts, checklist), [{ key: 'access', answer: 'Lift to floor 4', status: null }, { key: 'ceiling', answer: '', status: null }]);
  drafts.wardrobe = { answer: 'Measure the alcove', status: 'pending' };
  assert.deepEqual(changedAnswers(drafts, checklist).at(-1), { key: 'wardrobe', answer: 'Measure the alcove', status: 'pending' });
});

test('answers go to the kick-off while it is current, else the visit; a checklist line stays open after the visit', () => {
  assert.equal(answerVersion(view()), 5);
  assert.equal(answerVersion(view({ stages: [{ stage: 'kickoff', status: 'active', version: 8 }] })), 8);
  assert.equal(answerVersion(view({ siteVisit: null })), null);
  const done = view({ siteVisit: { within: 'task', open: false, done: true, version: 6 } });
  assert.equal(answerable(done, { kind: 'answer' }), false);
  assert.equal(answerable(done, { kind: 'check' }), true);
  assert.equal(answerable(view({ canEdit: false }), { kind: 'answer' }), false);
});
