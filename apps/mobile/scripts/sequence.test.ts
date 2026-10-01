import assert from 'node:assert/strict';
import test from 'node:test';
import { afterTransition, closeFallbackMs, deferred, dismissFallbackMs } from '../src/ui/sequence';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a deferred action runs once, only after the sheet says it has gone', () => {
  const pending = deferred();
  let runs = 0;
  assert.equal(pending.run(), false, 'nothing set: nothing runs');
  pending.set(() => { runs += 1; });
  assert.equal(pending.waiting, true);
  assert.equal(runs, 0, 'choosing an action does not run it while the sheet is still closing');
  assert.equal(pending.run(), true);
  assert.equal(runs, 1);
  assert.equal(pending.run(), false, 'a second close (backdrop, swipe) runs nothing again');
  assert.equal(runs, 1);
});

test('the last chosen action wins and a cleared one never runs', () => {
  const pending = deferred();
  const calls: string[] = [];
  pending.set(() => calls.push('first'));
  pending.set(() => calls.push('second'));
  pending.run();
  assert.deepEqual(calls, ['second']);
  pending.set(() => calls.push('third'));
  pending.clear();
  assert.equal(pending.run(), false);
  assert.deepEqual(calls, ['second']);
});

test('a sheet is taken off the screen a little after its close animation, whatever the animation reports', () => {
  assert.ok(closeFallbackMs(240) > 240);
  assert.ok(closeFallbackMs(240) < 1000, 'but never long enough to feel stuck');
});

test('only iOS waits for the phone to report the dismissal; Android and the web count the modal gone at once', () => {
  assert.ok(dismissFallbackMs('ios') >= 300, 'a fade-out takes about 300 ms before onDismiss');
  assert.equal(dismissFallbackMs('android'), 0);
  assert.equal(dismissFallbackMs('web'), 0);
});

function fakeStack() {
  const listeners = new Map<string, Set<(event: { data?: { closing?: boolean } }) => void>>();
  return {
    addListener(event: never, listener: (event: { data?: { closing?: boolean } }) => void) {
      const name = event as unknown as string;
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => { set.delete(listener); };
    },
    emit(event: string, data: { closing: boolean }) { for (const listener of listeners.get(event) ?? []) listener({ data }); },
    count(event: string) { return listeners.get(event)?.size ?? 0; },
  };
}

test('the camera opens once the screen has finished pushing, and only once', async () => {
  const stack = fakeStack();
  let opened = 0;
  afterTransition(stack, () => { opened += 1; }, 1000);
  assert.equal(opened, 0, 'not while the push is still animating');
  stack.emit('transitionEnd', { closing: false });
  assert.equal(opened, 1);
  stack.emit('transitionEnd', { closing: false });
  assert.equal(opened, 1, 'a later transition does not open it again');
  assert.equal(stack.count('transitionEnd'), 0, 'the listener is removed');
});

test('a screen that is going away never opens the camera; without any event it opens after the fallback', async () => {
  const stack = fakeStack();
  let opened = 0;
  afterTransition(stack, () => { opened += 1; }, 30);
  stack.emit('transitionEnd', { closing: true });
  assert.equal(opened, 0);
  await tick(60);
  assert.equal(opened, 1, 'the web and already-shown screens get no event');
});

test('leaving the screen before the transition ends cancels the camera', async () => {
  const stack = fakeStack();
  let opened = 0;
  const cancel = afterTransition(stack, () => { opened += 1; }, 20);
  cancel();
  stack.emit('transitionEnd', { closing: false });
  await tick(40);
  assert.equal(opened, 0);
  assert.equal(stack.count('transitionEnd'), 0);
});
