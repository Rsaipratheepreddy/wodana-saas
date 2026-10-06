import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { BlockedUrlError, guardedLookup, isPublicAddress, parseFetchableUrl, type Resolver } from "./url-guard";

export type SafeFetchOptions = {
  /** The most bytes read from the body; a larger answer is refused. */
  maxBytes: number;
  /** One deadline for the whole fetch, redirects included. */
  timeoutMs: number;
  accept: string;
  maxRedirects?: number;
  /** Tests replace DNS and the address policy; production uses the system resolver and public addresses only. */
  resolver?: Resolver;
  allow?: (address: string) => boolean;
  /** Tests only: a local server listens on a random port. */
  anyPort?: boolean;
};
export type SafeFetchResult = { finalUrl: string; status: number; contentType: string; body: Buffer };

export class FetchFailedError extends Error {}

const systemResolver: Resolver = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => ({ address: entry.address, family: entry.family }));
const USER_AGENT = "Mozilla/5.0 (compatible; WodanaProductReader/1.0; +https://wodana.ai)";

/**
 * Fetches a public web page or image for a person, safely: http(s) only, every hop re-validated (redirects
 * included), DNS checked at connection time with the checked address pinned, no cookies or credentials sent or
 * kept, no connection reuse, a size cap and one overall deadline.
 */
export async function safeFetch(raw: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const deadline = Date.now() + options.timeoutMs;
  const allow = options.allow ?? isPublicAddress;
  const lookup = guardedLookup(options.resolver ?? systemResolver, allow);
  let current = parseFetchableUrl(raw, { anyPort: options.anyPort }).url;
  for (let hop = 0; hop <= (options.maxRedirects ?? 4); hop += 1) {
    // An IP literal never goes through DNS, so the policy is applied to it here.
    const literal = current.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && !allow(literal)) throw new BlockedUrlError("This address is not on the public internet.");
    const answer = await requestOnce(current, options, deadline, lookup);
    if (answer.status >= 300 && answer.status < 400 && answer.location) {
      let next: URL;
      try { next = new URL(answer.location, current); } catch { throw new FetchFailedError("The page redirected somewhere that can't be read."); }
      current = parseFetchableUrl(next.toString(), { anyPort: options.anyPort }).url;
      continue;
    }
    if (answer.status >= 400) throw new FetchFailedError(`The page answered ${answer.status}.`);
    return { finalUrl: current.toString(), status: answer.status, contentType: answer.contentType, body: answer.body };
  }
  throw new FetchFailedError("The page redirected too many times.");
}

function requestOnce(url: URL, options: SafeFetchOptions, deadline: number, lookup: ReturnType<typeof guardedLookup>) {
  return new Promise<{ status: number; location: string | null; contentType: string; body: Buffer }>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new FetchFailedError("The page took too long to answer."));
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(url, {
      method: "GET",
      agent: false,
      lookup: lookup as never,
      headers: { accept: options.accept, "user-agent": USER_AGENT, "accept-language": "en", "accept-encoding": "identity" },
      timeout: remaining,
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = typeof response.headers.location === "string" ? response.headers.location : null;
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (status >= 300 && status < 400) { response.resume(); return resolve({ status, location, contentType, body: Buffer.alloc(0) }); }
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > options.maxBytes) { request.destroy(); return reject(new FetchFailedError("The page is too large to read.")); }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxBytes) { request.destroy(); reject(new FetchFailedError("The page is too large to read.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, location, contentType, body: Buffer.concat(chunks) }));
      response.on("error", () => reject(new FetchFailedError("The page could not be read.")));
    });
    const timer = setTimeout(() => request.destroy(new FetchFailedError("The page took too long to answer.")), remaining);
    request.on("timeout", () => request.destroy(new FetchFailedError("The page took too long to answer.")));
    request.on("error", (error) => reject(error instanceof BlockedUrlError || error instanceof FetchFailedError ? error : new FetchFailedError("The page could not be reached.")));
    request.on("close", () => clearTimeout(timer));
    request.end();
  });
}
