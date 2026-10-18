import { describe, expect, it } from "vitest";
import { ensureGallery } from "./gallery.service";

const ws = "00000000-0000-4000-8000-000000000001";

/** A client whose gallery row appears only after the INSERT, as when another request creates it first. */
function fakeClient(options: { createdByOtherRequest: boolean; slugTakenByOtherWorkspace?: string }) {
  const inserts: string[] = [];
  let row: { slug: string } | null = null;
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      if (text.includes("FROM workspace_galleries")) return { rows: row ? [row] : [] };
      if (text.includes("FROM workspaces")) return { rows: [{ slug: "palm-living", name: "Palm Living" }] };
      if (text.includes("gallery_slug_taken")) return { rows: [{ taken: values[0] === options.slugTakenByOtherWorkspace }] };
      if (text.includes("FROM crm_lead_forms")) return { rows: [] };
      if (text.startsWith("INSERT INTO workspace_galleries")) {
        inserts.push(String(values[1]));
        expect(text).toMatch(/ON CONFLICT DO NOTHING/);
        // The other request won: this insert is skipped, yet the row now exists.
        if (options.createdByOtherRequest) row = { slug: "palm-living" };
        else row = { slug: String(values[1]) };
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
  return { client, inserts };
}

describe("ensureGallery", () => {
  it("returns the gallery another first request created at the same moment", async () => {
    const { client, inserts } = fakeClient({ createdByOtherRequest: true });
    await expect(ensureGallery(client as never, ws)).resolves.toMatchObject({ slug: "palm-living" });
    expect(inserts).toEqual(["palm-living"]);
  });

  it("moves to the next slug when another workspace already has it", async () => {
    const { client, inserts } = fakeClient({ createdByOtherRequest: false, slugTakenByOtherWorkspace: "palm-living" });
    await expect(ensureGallery(client as never, ws)).resolves.toMatchObject({ slug: "palm-living-2" });
    expect(inserts).toEqual(["palm-living-2"]);
  });
});
