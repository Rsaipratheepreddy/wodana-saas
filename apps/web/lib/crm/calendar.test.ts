import { describe, expect, it } from "vitest";
import { calendarDayKey, calendarRange, localDateTime, moveCalendar, timeEventLayout, eventsForDay, type CalendarEvent } from "./calendar";

describe("CRM calendar date boundaries", () => {
  it("includes leap day and complete weeks", () => {
    const range = calendarRange(new Date(2024, 1, 29), "month");
    expect(range.days).toHaveLength(42);
    expect(range.start.getDay()).toBe(0);
    expect(range.days.some((day) => calendarDayKey(day) === "2024-02-29")).toBe(true);
  });
  it("moves from the last day of a month without skipping the next month", () => {
    expect(calendarDayKey(moveCalendar(new Date(2026, 0, 31), "month", 1))).toBe("2026-02-01");
    expect(calendarDayKey(moveCalendar(new Date(2026, 0, 1), "month", -1))).toBe("2025-12-01");
  });
  it("uses local calendar dates for day and week navigation", () => {
    const range = calendarRange(new Date(2026, 8, 6), "week");
    expect(range.days).toHaveLength(7);
    expect(calendarDayKey(range.end)).toBe("2026-09-13");
    expect(localDateTime(new Date(2026, 8, 6, 10, 30).toISOString())).toBe("2026-09-06T10:30");
    expect(localDateTime("invalid")).toBe("");
  });
});


describe('Calendar time layout', () => {
  const day = new Date(2026,8,7);
  const event = (id:string,h:number,m:number,endHour?:number,endMinute=0):CalendarEvent => ({id,title:id,provider:'crm',start:new Date(2026,8,7,h,m),...(endHour===undefined?{}:{end:new Date(2026,8,7,endHour,endMinute)})});
  it('separates overlapping appointments and reuses columns after the overlap ends',()=>{
    const layout=timeEventLayout([event('a',9,0,10),event('b',9,30,11),event('c',10,0,10,30),event('d',11,0,12)],day);
    expect(layout.map(e=>[e.event.id,e.column,e.columns])).toEqual([['a',0,2],['b',1,2],['c',0,2],['d',0,1]]);
  });
  it('clips overnight events and treats all-day end dates as exclusive',()=>{
    const overnight={...event('overnight',23,0),start:new Date(2026,8,6,23),end:new Date(2026,8,7,1)};
    expect(timeEventLayout([overnight],day)[0]).toMatchObject({start:0,end:60});
    expect(eventsForDay([{...overnight,allDay:true,end:day}],day)).toHaveLength(0);
  });
  it('keeps midnight and late reminders inside the day',()=>{
    expect(timeEventLayout([event('midnight',0,0),event('late',23,50)],day).map(e=>[e.start,e.end])).toEqual([[0,30],[1430,1440]]);
  });
});
