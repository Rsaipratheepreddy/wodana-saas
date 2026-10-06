import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/server", async () => { const { translator } = await import("@/lib/i18n/messages"); return { getServerT: async () => translator("en"), getServerLanguage: async () => "en" }; });
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workspace/workspace-api", () => ({
  UUID: /^[0-9a-f-]{36}$/i,
  isSameOrigin: () => true,
  invalidRequest: (message: string) => Response.json({ message }, { status: 400 }),
  workspaceJsonResponse: () => Response.json({ ok: true }),
}));

import { GET } from "./route";

// Every literal path the web app sends through the CRM gateway must pass its allow-list; a missing segment
// otherwise fails only in the browser ("Invalid CRM resource."), as the inbox insights and filing a chat did.
const files = execSync("git ls-files 'components/**/*.tsx' 'lib/**/*.ts' 'app/**/*.tsx'", { encoding: "utf8" })
  // A tracked file removed in the working tree (not yet committed) has nothing to call.
  .split("\n").filter((file) => file && !/\.test\.tsx?$/.test(file) && existsSync(file));
const CALL = /crmRequest(?:<[^>]*>)?\(\s*[\w.]+,\s*[`"]([^`"]+)[`"]/g;
const ID = "123e4567-e89b-42d3-a456-426614174000";
const workspaceId = "d004d45c-7140-4b0c-a68d-e87d012c2390";

function pathsIn(source: string) {
  return [...source.matchAll(CALL)].map((match) => match[1].split("?")[0])
    // A placeholder glued to a word is a query or suffix ("summary${query}"); a whole segment is a parameter.
    .map((path) => path.split("/").filter(Boolean).map((part) => (part.startsWith("${") ? part : part.replace(/\$\{.*$/, ""))))
    .filter((parts) => parts.length && !parts[0].startsWith("${"));
}

/** Each parameter is tried as an id and as a key, so keyed routes (system fields, step keys) count too. */
function variants(parts: string[]): string[][] {
  const at = parts.findIndex((part) => part.startsWith("${"));
  if (at < 0) return [parts];
  return [ID, "email"].flatMap((value) => variants([...parts.slice(0, at), value, ...parts.slice(at + 1)]));
}

async function accepted(parts: string[]) {
  for (const path of variants(parts)) {
    const response = await GET(new Request(`http://localhost/api/workspace/crm/data/${path.join("/")}?workspaceId=${workspaceId}`), { params: Promise.resolve({ path }) });
    if (response.status !== 400) return true;
  }
  return false;
}

describe("CRM gateway allow-list", () => {
  it("accepts every path the web app calls", async () => {
    const rejected: string[] = [];
    for (const file of files) {
      for (const parts of pathsIn(readFileSync(file, "utf8"))) {
        // "members" is a GET the gateway forwards on its own.
        if (parts[0] === "members") continue;
        if (!(await accepted(parts))) rejected.push(`${file}: ${parts.join("/")}`);
      }
    }
    expect(rejected).toEqual([]);
  });
});
