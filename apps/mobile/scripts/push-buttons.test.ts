import assert from 'node:assert/strict';
import test from 'node:test';
import { isLater, LATER_ACTION, pushButtons } from '../src/features/shell/push-button-model';
import { OPEN_ACTION } from '../src/features/shell/approval-action-model';

const t = ((text: string) => text) as never;

test('each moment shows the button the firm chose; every button but Later opens its screen', () => {
  const sets = pushButtons(t);
  assert.deepEqual(Object.keys(sets).sort(), ['open', 'pay', 'reply', 'review']);
  assert.deepEqual(sets.open.map((button) => button.buttonTitle), ['Open']);
  assert.deepEqual(sets.review.map((button) => button.buttonTitle), ['Review', 'Later']);
  assert.deepEqual(sets.pay.map((button) => button.buttonTitle), ['Pay now']);
  for (const buttons of Object.values(sets)) for (const button of buttons) {
    assert.equal(button.options.opensAppToForeground, button.identifier !== LATER_ACTION);
    assert.ok([OPEN_ACTION, LATER_ACTION].includes(button.identifier));
  }
  assert.equal(isLater(LATER_ACTION), true);
  assert.equal(isLater(OPEN_ACTION), false);
  assert.equal(isLater(null), false);
});
