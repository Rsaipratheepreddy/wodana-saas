import { describe, expect, it } from "vitest";
import { isShortMapLink, mapsUrl, parseMapLink, validCoordinates } from "./map-link";

describe("map links", () => {
  it.each([
    ["https://www.google.com/maps/@25.2048493,55.2707828,15z", { latitude: 25.2048493, longitude: 55.2707828 }],
    ["https://www.google.com/maps/place/Burj+Khalifa/@25.197197,55.2721877,17z/data=!3m1!4b1!4m6!3m5!1s0x3e5f43348a67e24b:0xff45e502e1ceb7e2!8m2!3d25.1972018!4d55.2744117", { latitude: 25.1972018, longitude: 55.2744117 }],
    ["https://maps.google.com/?q=51.5007292,-0.1246254", { latitude: 51.5007292, longitude: -0.1246254 }],
    ["https://www.google.com/maps/search/?api=1&query=-33.8567844%2C151.213108", { latitude: -33.8567844, longitude: 151.213108 }],
    ["https://www.google.com/maps/place/40.6892494,-74.0445004", { latitude: 40.6892494, longitude: -74.0445004 }],
    ["https://www.google.com/maps/search/19.4326,+-99.1332", { latitude: 19.4326, longitude: -99.1332 }],
    ["https://www.google.com/maps/dir/?api=1&destination=48.8583701,2.2944813", { latitude: 48.8583701, longitude: 2.2944813 }],
    ["https://maps.apple.com/?ll=35.6585805,139.7454329&q=Tokyo%20Tower", { latitude: 35.6585805, longitude: 139.7454329 }],
    ["https://www.openstreetmap.org/?mlat=59.3293&mlon=18.0686#map=15/59.3293/18.0686", { latitude: 59.3293, longitude: 18.0686 }],
    ["https://www.openstreetmap.org/#map=17/-22.95191/-43.21049", { latitude: -22.95191, longitude: -43.21049 }],
    ["google.com/maps?q=loc:12.9715987,77.5945627", { latitude: 12.9715987, longitude: 77.5945627 }],
    ["geo:37.786971,-122.399677", { latitude: 37.786971, longitude: -122.399677 }],
    ["  1.2903, 103.8520 ", { latitude: 1.2903, longitude: 103.852 }],
    ["https://www.google.com/maps/@25.123456789,55.987654321,15z", { latitude: 25.1234568, longitude: 55.9876543 }],
  ])("reads %s", (link, expected) => {
    expect(parseMapLink(link)).toEqual(expected);
  });

  it.each([
    "", "   ", "Jumeirah Village Circle, Dubai", "https://maps.app.goo.gl/AbCdEf12345", "https://www.google.com/maps/place/Eiffel+Tower",
    "https://www.google.com/maps/@95.1,10.2,15z", "https://maps.google.com/?q=10,200", "not a url at all :// ?", "12.5", "12.5, abc",
  ])("finds no coordinates in %j", (link) => {
    expect(parseMapLink(link)).toBeNull();
  });

  it("checks the range and builds an Open in Maps link", () => {
    expect(validCoordinates(-90, 180)).toBe(true);
    expect(validCoordinates(90.0001, 0)).toBe(false);
    expect(validCoordinates(0, Number.NaN)).toBe(false);
    expect(validCoordinates(null, 1)).toBe(false);
    expect(mapsUrl({ latitude: 25.2, longitude: -0.12 })).toBe("https://www.google.com/maps/search/?api=1&query=25.2,-0.12");
  });
});

describe("isShortMapLink", () => {
  it("knows the Maps app's Share hosts", () => {
    expect(isShortMapLink("https://maps.app.goo.gl/AbCdEf12345")).toBe(true);
    expect(isShortMapLink("https://www.google.com/maps/@25.2,55.27,15z")).toBe(false);
    expect(isShortMapLink("Jumeirah Village Circle, Dubai")).toBe(false);
  });
});
