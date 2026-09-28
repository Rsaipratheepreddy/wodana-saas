import assert from 'node:assert/strict';
import test from 'node:test';
import { consentChanged, deviceLocale, devicePermission, pushState, shouldEnablePush, type NotificationSettings } from '../src/features/shell/push-model';

const install = '11111111-2222-4333-8444-555555555555';
const settings = (overrides: Partial<NotificationSettings> = {}): NotificationSettings => ({
  pushEnabled: false, pushAvailable: false, preference: null, consents: [], devices: [], unreadCount: 0, ...overrides,
});

test("the phone's permission in the server's words", () => {
  assert.equal(devicePermission({ status: 'granted' }), 'granted');
  assert.equal(devicePermission({ status: 'denied' }), 'denied');
  assert.equal(devicePermission({ status: 'undetermined' }), 'undetermined');
  assert.equal(devicePermission({ status: 'granted', ios: { status: 3 } }), 'provisional');
  assert.equal(devicePermission({ status: 'granted', ios: { status: 4 } }), 'ephemeral');
});

test('a locale the server accepts', () => {
  assert.equal(deviceLocale('en-US'), 'en-US');
  assert.equal(deviceLocale('ar-AE-u-nu-latn'), 'ar-AE');
  assert.equal(deviceLocale('en_GB'), 'en-GB');
  assert.equal(deviceLocale('not a locale', 'ar'), 'ar');
  assert.equal(deviceLocale(undefined), 'en');
});

test('push turns on at registration unless the person turned it off', () => {
  assert.equal(shouldEnablePush(settings(), install), true);
  assert.equal(shouldEnablePush(settings({ preference: { enabled: true, version: 1 } }), install), false);
  assert.equal(shouldEnablePush(settings({ preference: { enabled: false, version: 2 }, consents: [{ installationId: install, permissionStatus: 'granted' }] }), install), false);
  // Off only because the phone didn't allow notifications; now it does.
  assert.equal(shouldEnablePush(settings({ preference: { enabled: false, version: 2 }, consents: [{ installationId: install, permissionStatus: 'denied' }] }), install), true);
});

test('consent is recorded only when it changed', () => {
  assert.equal(consentChanged(settings(), install, 'granted'), true);
  assert.equal(consentChanged(settings({ consents: [{ installationId: install, permissionStatus: 'granted' }] }), install, 'granted'), false);
  assert.equal(consentChanged(settings({ consents: [{ installationId: install, permissionStatus: 'granted' }] }), install, 'denied'), true);
});

test('Me shows the one state of push on this phone', () => {
  const registered = settings({ devices: [{ id: 'd', installationId: install, status: 'active', version: 1 }] });
  assert.equal(pushState({ supported: false, permission: 'granted', installationId: install, settings: registered }), 'unavailable');
  assert.equal(pushState({ supported: true, permission: 'denied', installationId: install, settings: registered }), 'blocked');
  assert.equal(pushState({ supported: true, permission: 'granted', installationId: install, settings: settings() }), 'not-registered');
  assert.equal(pushState({ supported: true, permission: 'granted', installationId: install, settings: registered }), 'off');
  assert.equal(pushState({ supported: true, permission: 'granted', installationId: install, settings: { ...registered, pushEnabled: true } }), 'on');
});
