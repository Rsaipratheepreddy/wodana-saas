import { expect, it } from "vitest";
import { defaultHomeLayout, homeActivityId, parseHomeLayout } from "./home-layout";
it("recovers missing widgets and ignores unknown or duplicate saved entries", () => {
  const parsed = parseHomeLayout(JSON.stringify([{id:"tools",visible:false,wide:true},{id:"tools"},{id:"admin"},null]));
  expect(parsed.map(item => item.id)).toEqual(["tools","attention","planning","projects","sales","attendance"]);
  expect(parsed[0]).toEqual({id:"tools",visible:false,wide:true});
  expect(parseHomeLayout("invalid")).toEqual(defaultHomeLayout);
});
it("only opens activity inspectors for valid internal activity links", () => {
  expect(homeActivityId({deepLink:"https://example.com/crm/activities/74000000-0000-4000-8000-000000000001"})).toBeNull();
  expect(homeActivityId({deepLink:"/crm/activities/74000000-0000-4000-8000-000000000001"})).toBe("74000000-0000-4000-8000-000000000001");
});
