import { describe, expect, it } from 'vitest';
import { allowedCasePath } from './api-path';
import { newSiteRecord, siteCalendarDays, sitePayload, visitCalendar, visitFallsOn, visitInstant, visitWallTime } from './site';
const id='e56299c6-3da3-402a-a9ac-3995bb37b9d4';
describe('site data and scheduling',()=>{
 it('converts the entered time in the selected zone, independently of the browser zone',()=>{
  const instant=visitInstant('2026-09-08T10:00','Asia/Dubai');expect(instant).toBe('2026-09-08T06:00:00.000Z');expect(visitWallTime(instant,'Asia/Dubai')).toBe('2026-09-08T10:00');expect(visitWallTime(instant,'Asia/Kolkata')).toBe('2026-09-08T11:30');
 });
 it('rejects ambiguous or unavailable daylight-saving times',()=>{expect(()=>visitInstant('2026-03-08T02:30','America/New_York')).toThrow();expect(()=>visitInstant('2026-11-01T01:30','America/New_York')).toThrow();});
 it('sends dimensions and stable relationships without review metadata',()=>{
  const record={...newSiteRecord('measurement','UTC',id),title:'Width',status:'verified',verifiedBy:id,dimensions:[{id,name:'Width',unit:'ft',basis:'site_opening',approximate:8,measured:7.9,source:'team',evidence:'Photo',verification:'verified',siteSurvey:{id,version:2,status:'verified'}}]};
  const payload=sitePayload(record,4);expect(payload).toMatchObject({roomId:id,specificationVersion:4});expect(payload).not.toHaveProperty('status');expect(payload).not.toHaveProperty('verifiedBy');expect('dimensions' in payload&&payload.dimensions[0]).not.toHaveProperty('siteSurvey');
 });
 it('downloads a real UTC calendar event without creating an invitation',()=>{
  const record={...newSiteRecord('visit','Asia/Dubai'),title:'Office, initial survey',scheduledAt:'2026-09-08T06:00:00Z',durationMinutes:90,note:'Check walls\nMeasure openings'};
  const text=visitCalendar(record);expect(text).toContain('DTSTART:20260908T060000Z');expect(text).toContain('DTEND:20260908T073000Z');expect(text).toContain('SUMMARY:Office\\, initial survey');expect(text).toContain('Check walls\\nMeasure openings');expect(text).not.toContain('ATTENDEE');
 });
 it('allows only supported Site paths',()=>{
  expect(allowedCasePath([id,'site'],'GET')).toBe(true);expect(allowedCasePath([id,'site','measurements'],'PUT')).toBe(true);expect(allowedCasePath([id,'site',id,'review'],'POST')).toBe(true);expect(allowedCasePath([id,'site',id,'history'],'GET')).toBe(true);expect(allowedCasePath([id,'site',id,'history'],'DELETE')).toBe(false);expect(allowedCasePath([id,'site','../../','review'],'POST')).toBe(false);
 });
 it('respects workspace week starts and spans month boundaries',()=>{
  expect(siteCalendarDays('2026-09-07',1)[0].toString()).toBe('2026-08-31');
  expect(siteCalendarDays('2026-09-07',0)[0].toString()).toBe('2026-08-30');
  expect(siteCalendarDays('2026-09-07',6)[0].toString()).toBe('2026-08-29');
  expect(siteCalendarDays('2026-12-28',1)[41].toString()).toBe('2027-01-10');
 });
 it('places overnight visits on each local day, excluding the ending midnight',()=>{
  const record={...newSiteRecord('visit','Asia/Dubai'),scheduledAt:'2026-09-08T19:30:00Z',durationMinutes:90};
  expect(visitFallsOn(record,'2026-09-08','Asia/Dubai')).toBe(true);expect(visitFallsOn(record,'2026-09-09','Asia/Dubai')).toBe(true);
  expect(visitFallsOn({...record,durationMinutes:30},'2026-09-09','Asia/Dubai')).toBe(false);
  expect(visitFallsOn(record,'2026-09-09','UTC')).toBe(false);
 });
});
