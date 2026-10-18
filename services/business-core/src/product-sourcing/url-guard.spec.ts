import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeFetch } from "./safe-fetch";
import { BlockedUrlError, guardedLookup, isPublicAddress, parseFetchableUrl } from "./url-guard";

describe("SSRF guard: addresses", () => {
  it.each([
    "127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "255.255.255.255",
    "224.0.0.1", "198.18.0.1", "192.0.2.10", "203.0.113.5", "192.0.0.8", "240.0.0.1",
    "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::127.0.0.1",
    "64:ff9b::10.0.0.1", "2002:0a00:0001::1", "2001:0::1", "2001:db8::1", "fec0::1", "[::1]",
  ])("refuses %s", (address) => expect(isPublicAddress(address)).toBe(false));

  it.each(["93.184.216.34", "8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::8.8.8.8", "2a00:1450:4001::200e"])(
    "allows %s", (address) => expect(isPublicAddress(address)).toBe(true));

  it("refuses names that aren't IP addresses", () => expect(isPublicAddress("example.com")).toBe(false));
});

describe("SSRF guard: URLs", () => {
  it("accepts public http(s) links and drops the fragment", () => {
    expect(parseFetchableUrl("https://shop.example.com/sofa?id=1#reviews").url.toString()).toBe("https://shop.example.com/sofa?id=1");
    expect(parseFetchableUrl("http://shop.example.com:80/a").host).toBe("shop.example.com");
  });
  it.each([
    ["file:///etc/passwd", /http and https/], ["ftp://shop.example.com/x", /http and https/], ["javascript:alert(1)", /http and https/], ["gopher://x.example.com", /http and https/],
    ["https://user:pass@shop.example.com/", /user name/], ["https://shop.example.com:8443/", /unusual ports/], ["http://localhost/", /public internet/],
    ["http://127.0.0.1/", /public internet/], ["http://2130706433/", /public internet/], ["http://0x7f.1/", /public internet/], ["http://[::ffff:127.0.0.1]/", /public internet/],
    ["http://169.254.169.254/latest/meta-data/", /public internet/], ["http://metadata.google.internal/", /public internet/], ["http://intranet/", /public internet/],
    ["http://printer.local/", /public internet/], ["not a link", /full product page link/],
  ])("refuses %s", (raw, message) => expect(() => parseFetchableUrl(raw)).toThrow(message));
});

describe("SSRF guard: DNS at connection time", () => {
  const run = (lookup: ReturnType<typeof guardedLookup>, options: unknown = {}) =>
    new Promise<{ error: Error | null; address?: unknown; family?: number }>((resolve) => lookup("shop.example.com", options, (error, address, family) => resolve({ error, address, family })));

  it("pins the connection to the address it checked", async () => {
    let calls = 0;
    const lookup = guardedLookup(async () => { calls += 1; return [{ address: "93.184.216.34", family: 4 }]; });
    expect(await run(lookup)).toEqual({ error: null, address: "93.184.216.34", family: 4 });
    expect(await run(lookup, { all: true })).toEqual({ error: null, address: [{ address: "93.184.216.34", family: 4 }], family: undefined });
    expect(calls).toBe(2);
  });

  it("refuses a name that answers with any private address (rebinding with mixed answers)", async () => {
    const lookup = guardedLookup(async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]);
    expect((await run(lookup)).error).toBeInstanceOf(BlockedUrlError);
  });

  it("refuses a name that re-resolves to loopback on the second connection (rebinding over time)", async () => {
    const answers = [[{ address: "93.184.216.34", family: 4 }], [{ address: "127.0.0.1", family: 4 }]];
    const lookup = guardedLookup(async () => answers.shift()!);
    expect((await run(lookup)).error).toBeNull();
    expect((await run(lookup)).error).toBeInstanceOf(BlockedUrlError);
  });

  it("refuses IPv4-mapped IPv6 loopback and names that don't resolve", async () => {
    expect((await run(guardedLookup(async () => [{ address: "::ffff:127.0.0.1", family: 6 }]))).error).toBeInstanceOf(BlockedUrlError);
    expect((await run(guardedLookup(async () => { throw new Error("ENOTFOUND"); }))).error?.message).toMatch(/could not be found/);
  });
});

describe("safe fetch against a local server", () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];
  beforeAll(async () => {
    server = http.createServer((request, response) => {
      hits.push(`${request.url} cookie=${request.headers.cookie ?? ""}`);
      if (request.url === "/page") { response.setHeader("content-type", "text/html; charset=utf-8"); response.setHeader("set-cookie", "session=1"); response.end("<html><title>Sofa</title></html>"); }
      else if (request.url === "/to-metadata") { response.statusCode = 302; response.setHeader("location", "http://169.254.169.254/latest/meta-data/"); response.end(); }
      else if (request.url === "/to-private-name") { response.statusCode = 301; response.setHeader("location", `http://inside.example.com:${port}/page`); response.end(); }
      else if (request.url === "/to-localhost") { response.statusCode = 302; response.setHeader("location", `http://localhost:${port}/page`); response.end(); }
      else if (request.url === "/loop") { response.statusCode = 302; response.setHeader("location", "/loop"); response.end(); }
      else if (request.url === "/big") { response.setHeader("content-type", "text/html"); response.write(Buffer.alloc(4096, 97)); response.end(Buffer.alloc(4096, 97)); }
      else if (request.url === "/slow") { /* never answers */ }
      else { response.statusCode = 404; response.end(); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));

  // "shop.example.com" is the test's stand-in for a public site; only it may resolve to the local server.
  const resolver = async (host: string) => [{ address: host === "shop.example.com" ? "127.0.0.1" : "10.0.0.9", family: 4 }];
  const allow = (address: string) => address === "127.0.0.1";
  const options = { maxBytes: 6000, timeoutMs: 1500, accept: "text/html", resolver, allow, anyPort: true };

  it("reads a page and sends no cookies", async () => {
    const page = await safeFetch(`http://shop.example.com:${port}/page`, options);
    expect(page.body.toString()).toContain("<title>Sofa</title>");
    expect(page.contentType).toMatch(/text\/html/);
    await safeFetch(`http://shop.example.com:${port}/page`, options);
    expect(hits.filter((hit) => hit.startsWith("/page")).every((hit) => hit.endsWith("cookie="))).toBe(true);
  });
  it("re-checks every redirect: metadata IPs, private names and localhost are refused", async () => {
    await expect(safeFetch(`http://shop.example.com:${port}/to-metadata`, options)).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch(`http://shop.example.com:${port}/to-private-name`, options)).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch(`http://shop.example.com:${port}/to-localhost`, options)).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(safeFetch(`http://shop.example.com:${port}/loop`, options)).rejects.toThrow(/too many times/);
  });
  it("caps the size and the time", async () => {
    await expect(safeFetch(`http://shop.example.com:${port}/big`, options)).rejects.toThrow(/too large/);
    await expect(safeFetch(`http://shop.example.com:${port}/slow`, { ...options, timeoutMs: 300 })).rejects.toThrow(/too long/);
  });
  it("refuses the local server itself when addressed directly", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/page`, { ...options, allow: undefined })).rejects.toBeInstanceOf(BlockedUrlError);
  });
});
