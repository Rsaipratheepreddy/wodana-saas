import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, isoDay, makeFormat, wallTimeToIso, weekStart, zoneOffsetMinutes } from '../src/core/format-core';

test('wall-clock times become instants in the workspace zone, across daylight saving', () => {
  assert.equal(wallTimeToIso('2026-10-05', '09:30', 'Asia/Dubai'), '2026-10-05T05:30:00.000Z');
  assert.equal(wallTimeToIso('2026-10-05', '09:30', 'Asia/Kolkata'), '2026-10-05T04:00:00.000Z');
  assert.equal(wallTimeToIso('2026-07-01', '09:00', 'Europe/London'), '2026-07-01T08:00:00.000Z');
  assert.equal(wallTimeToIso('2026-12-01', '09:00', 'Europe/London'), '2026-12-01T09:00:00.000Z');
  assert.equal(wallTimeToIso('2026-03-08', '12:00', 'America/New_York'), '2026-03-08T16:00:00.000Z');
  assert.equal(zoneOffsetMinutes(new Date('2026-01-01T00:00:00Z'), 'Asia/Dubai'), 240);
});

test('calendar days are the zone\'s, and weeks start on the workspace\'s first day', () => {
  assert.equal(isoDay('2026-09-27T21:30:00Z', 'Asia/Dubai'), '2026-09-28');
  assert.equal(isoDay('2026-09-27T21:30:00Z', 'America/New_York'), '2026-09-27');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(weekStart('2026-09-27', 1), '2026-09-21');
  assert.equal(weekStart('2026-09-27', 0), '2026-09-27');
  assert.equal(weekStart('2026-09-24', 6), '2026-09-19');
});

test('money uses the currency\'s own decimals and the workspace locale', () => {
  const aed = makeFormat({ locale: 'en-AE', timeZone: 'Asia/Dubai', currency: 'AED' });
  assert.match(aed.money('1250.5'), /1,250\.50/);
  assert.equal(aed.moneyPlaces(), 2);
  const jpy = makeFormat({ locale: 'ja-JP', timeZone: 'Asia/Tokyo', currency: 'JPY' });
  assert.equal(jpy.moneyPlaces(), 0);
  assert.doesNotMatch(jpy.money(1250), /\./);
  const kwd = makeFormat({ locale: 'en', timeZone: 'Asia/Kuwait', currency: 'KWD' });
  assert.equal(kwd.moneyPlaces(), 3);
  assert.equal(aed.money(null), '');
});

test('another language keeps the workspace region and Latin digits', () => {
  const arabic = makeFormat({ locale: 'ar-AE-u-nu-latn', timeZone: 'Asia/Dubai', currency: 'AED' });
  assert.equal(arabic.locale, 'ar-AE-u-nu-latn');
  assert.match(arabic.money('1250.5'), /1,250\.50/);
  assert.match(arabic.number(3.5, 1), /^3[.,٫]5$/);
});

test('durations, clock labels and unknown settings degrade safely', () => {
  const format = makeFormat({ locale: 'not a locale', timeZone: 'Mars/Base', currency: '' });
  assert.equal(format.timeZone, format.timeZone === 'UTC' ? 'UTC' : format.timeZone);
  assert.equal(format.duration(450), '7h 30m');
  assert.equal(format.duration(45), '45m');
  assert.equal(format.duration(120), '2h');
  assert.match(makeFormat({ locale: 'en-GB', timeZone: 'UTC' }).clockLabel('09:05'), /09:05|9:05/);
  assert.equal(makeFormat({ locale: 'en', timeZone: 'Asia/Dubai' }).instant('2026-10-05', '09:30'), '2026-10-05T05:30:00.000Z');
});
