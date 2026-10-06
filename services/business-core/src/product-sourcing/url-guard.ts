import { isIP } from "node:net";

/**
 * Which addresses the server may fetch from on a person's behalf (SSRF guard, plan §6.7a batch 3).
 * Only public unicast addresses are allowed: loopback, private, link-local (cloud metadata), carrier-grade NAT,
 * benchmarking, documentation, multicast, reserved and unspecified ranges are refused, in IPv4, IPv6 and IPv4
 * embedded in IPv6 (mapped, compatible, NAT64, 6to4, Teredo).
 */
export class BlockedUrlError extends Error {}

const V4_BLOCKED: Array<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8 "this network"
  [0x0a000000, 8], // 10/8 private
  [0x64400000, 10], // 100.64/10 carrier-grade NAT
  [0x7f000000, 8], // 127/8 loopback
  [0xa9fe0000, 16], // 169.254/16 link-local (cloud metadata)
  [0xac100000, 12], // 172.16/12 private
  [0xc0000000, 24], // 192.0.0/24 IETF protocol assignments
  [0xc0000200, 24], // 192.0.2/24 documentation
  [0xc0586300, 24], // 192.88.99/24 6to4 relay anycast
  [0xc0a80000, 16], // 192.168/16 private
  [0xc6120000, 15], // 198.18/15 benchmarking
  [0xc6336400, 24], // 198.51.100/24 documentation
  [0xcb007100, 24], // 203.0.113/24 documentation
  [0xe0000000, 4], // 224/4 multicast
  [0xf0000000, 4], // 240/4 reserved and 255.255.255.255 broadcast
];

function v4Number(ip: string) {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function v4Public(value: number) {
  return !V4_BLOCKED.some(([base, bits]) => (bits === 0 ? true : (value >>> (32 - bits)) === (base >>> (32 - bits))));
}

/** Eight 16-bit groups of an IPv6 address (with an embedded dotted IPv4 tail expanded). */
function v6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (isIP(tail[1]) !== 4) return null;
    const value = v4Number(tail[1]);
    text = `${text.slice(0, -tail[1].length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...rest].map((group) => parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

function v6Public(groups: number[]): boolean {
  const [a, b] = groups;
  const embedded = (high: number, low: number) => v4Public(((high << 16) >>> 0) + low);
  if (groups.every((group) => group === 0)) return false; // :: unspecified
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false; // ::1 loopback
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) return embedded(groups[6], groups[7]); // ::ffff:a.b.c.d mapped
  if (groups.slice(0, 6).every((group) => group === 0)) return embedded(groups[6], groups[7]); // ::a.b.c.d compatible (deprecated)
  if (a === 0x64 && b === 0xff9b) return embedded(groups[6], groups[7]); // 64:ff9b::/96 NAT64 (and the /48 local-use range)
  if (a === 0x2002) return embedded(groups[1], groups[2]); // 2002::/16 6to4
  if (a === 0x2001 && b === 0) return false; // 2001::/32 Teredo (the client address is obfuscated; refuse)
  if (a === 0x2001 && b === 0x0db8) return false; // documentation
  if ((a & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((a & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (a === 0x0100 && groups.slice(1, 4).every((group) => group === 0)) return false; // 100::/64 discard
  // Global unicast is 2000::/3; anything else is reserved.
  return (a & 0xe000) === 0x2000;
}

/** True only for a public unicast IP address. Anything that isn't an IP literal is false. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address.replace(/^\[|\]$/g, ""));
  if (family === 4) return v4Public(v4Number(address));
  if (family === 6) {
    const groups = v6Groups(address.replace(/^\[|\]$/g, ""));
    return groups ? v6Public(groups) : false;
  }
  return false;
}

export type FetchableUrl = { url: URL; host: string };

/**
 * A URL the server may fetch: http or https, no user name or password, the standard port, a host name that is a
 * public address or a DNS name (never "localhost" or an internal-only suffix). Resolution is checked again at
 * connection time, so a name that later resolves to a private address is still refused.
 */
export function parseFetchableUrl(raw: string, options: { anyPort?: boolean } = {}): FetchableUrl {
  const text = String(raw ?? "").trim();
  if (!text || text.length > 2000) throw new BlockedUrlError("Paste the full product page link.");
  let url: URL;
  try { url = new URL(text); } catch { throw new BlockedUrlError("Paste the full product page link."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BlockedUrlError("Only http and https links can be read.");
  if (url.username || url.password) throw new BlockedUrlError("Links with a user name or password can't be read.");
  if (url.port && !options.anyPort && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) throw new BlockedUrlError("Links on unusual ports can't be read.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) throw new BlockedUrlError("Paste the full product page link.");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new BlockedUrlError("This address is not on the public internet.");
  } else if (!host.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(host) || host.endsWith(".arpa")) {
    throw new BlockedUrlError("This address is not on the public internet.");
  }
  url.hash = "";
  return { url, host };
}

export type Resolver = (host: string) => Promise<Array<{ address: string; family: number }>>;

/**
 * A `lookup` for node's http(s).request that resolves once, refuses the connection when ANY resolved address is
 * not public (a name answering with one public and one private address is a rebinding attempt), and hands the
 * socket exactly the address it checked, so a second DNS answer can never be used.
 */
export function guardedLookup(resolve: Resolver, allow: (address: string) => boolean = isPublicAddress) {
  return (hostname: string, options: unknown, callback: (error: Error | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void) => {
    const wantsAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    resolve(hostname).then((addresses) => {
      if (!addresses.length) return callback(new BlockedUrlError("This site could not be found."));
      if (addresses.some((entry) => !allow(entry.address))) return callback(new BlockedUrlError("This address is not on the public internet."));
      const chosen = addresses[0];
      if (wantsAll) return callback(null, [chosen]);
      return callback(null, chosen.address, chosen.family);
    }, () => callback(new BlockedUrlError("This site could not be found.")));
  };
}
