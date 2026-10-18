import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTheme } from '../src/ui/theme-core';
import { tokens } from '../src/design-system/tokens.generated';

test('without co-branding the app uses the web\'s neutral tokens in both appearances', () => {
  assert.equal(buildTheme('light').colors.actionPrimary, tokens.colors.light.actionPrimary);
  assert.equal(buildTheme('dark').colors.canvas, tokens.colors.dark.canvas);
  assert.equal(buildTheme('light').space(4), 16);
});

test('a tenant brand drives actions, focus and selection with a readable colour, like the web', () => {
  const light = buildTheme('light', { primaryColor: '#E4E3DE', secondaryColor: '#000000' });
  assert.equal(light.colors.actionPrimary.toUpperCase(), '#000000');
  assert.equal(light.colors.focus, light.colors.actionPrimary);
  const pale = buildTheme('light', { primaryColor: '#F4E04D', secondaryColor: null });
  assert.notEqual(pale.colors.actionPrimary.toUpperCase(), '#F4E04D', 'a pale brand is darkened until white text reads on it');
  const dark = buildTheme('dark', { primaryColor: '#1B4D8C' });
  assert.notEqual(dark.colors.actionPrimary.toUpperCase(), '#1B4D8C', 'dark mode lifts a dark brand');
  assert.equal(buildTheme('light', { primaryColor: 'blue' }).colors.actionPrimary, tokens.colors.light.actionPrimary);
});
