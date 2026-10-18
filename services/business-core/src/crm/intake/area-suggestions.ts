import type { PoolClient } from "pg";

type Option = { id: string; label: string };
/** The most areas offered for one region. */
const PER_REGION = 200;

/**
 * Area / city suggestions for the enquiry form, by region id ("" when the workspace lists no regions): the areas this
 * workspace's enquiries already name there, most used first, then the workspace's own list for that region, then the
 * areas its country's region pack lists for it. Suggestions only: the form still takes any typed area.
 */
export async function loadAreaSuggestions(client: PoolClient, workspaceId: string, regions: Option[], listed: Record<string, Option[]>): Promise<Record<string, string[]>> {
  const used = await client.query<{ region: string; area: string; uses: string }>(`SELECT COALESCE(enquiry.details->>'emirate', '') AS region,
      btrim(COALESCE(NULLIF(btrim(enquiry.details->>'area'), ''), enquiry.details->>'location')) AS area, count(*) AS uses
    FROM crm_enquiries enquiry
    WHERE enquiry.workspace_id = $1 AND btrim(COALESCE(NULLIF(btrim(enquiry.details->>'area'), ''), enquiry.details->>'location', '')) <> ''
    GROUP BY 1, 2 ORDER BY uses DESC, area LIMIT 5000`, [workspaceId]);
  const pack = await regionPackAreas(client, workspaceId, regions);
  const byRegion = new Map<string, Map<string, { label: string; uses: number }>>();
  for (const row of used.rows) {
    // An area picked from the workspace's own list is kept by its id: it is suggested by its name.
    const label = listed[row.region]?.find((option) => option.id === row.area)?.label ?? row.area;
    const areas = byRegion.get(row.region) ?? new Map<string, { label: string; uses: number }>();
    const key = label.toLocaleLowerCase();
    const found = areas.get(key);
    if (found) found.uses += Number(row.uses); else areas.set(key, { label, uses: Number(row.uses) });
    byRegion.set(row.region, areas);
  }
  const suggestions: Record<string, string[]> = {};
  for (const region of new Set(["", ...regions.map((option) => option.id), ...byRegion.keys()])) {
    const seen = new Set<string>();
    const list: string[] = [];
    const add = (label: string) => { const name = label.trim(); const key = name.toLocaleLowerCase(); if (name && !seen.has(key)) { seen.add(key); list.push(name); } };
    [...(byRegion.get(region)?.values() ?? [])].sort((a, b) => b.uses - a.uses).forEach((area) => add(area.label));
    (listed[region] ?? []).forEach((option) => add(option.label));
    (pack[region] ?? []).forEach(add);
    if (list.length) suggestions[region] = list.slice(0, PER_REGION);
  }
  return suggestions;
}

const slug = (label: string) => label.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/**
 * The areas the workspace's country lists for each region, when its region pack holds them: an address level after the
 * region whose `options` name each region's areas (`{ "<region>": ["<area>", …] }`). Keyed by the workspace's region id.
 */
async function regionPackAreas(client: PoolClient, workspaceId: string, regions: Option[]): Promise<Record<string, string[]>> {
  const result = await client.query<{ levels: unknown }>(`SELECT profile.configuration->'address'->'levels' AS levels
    FROM workspaces workspace JOIN tenant_setup_profiles profile ON profile.kind='region' AND profile.code=upper(split_part(workspace.default_locale, '-', 2))
    WHERE workspace.id=$1 ORDER BY profile.version DESC LIMIT 1`, [workspaceId]);
  const levels = result.rows[0]?.levels;
  if (!Array.isArray(levels)) return {};
  const byName = levels.slice(1).map((level) => (level as { options?: unknown } | null)?.options)
    .find((options): options is Record<string, unknown> => Boolean(options) && typeof options === "object" && !Array.isArray(options));
  if (!byName) return {};
  const areas: Record<string, string[]> = {};
  for (const [name, list] of Object.entries(byName)) {
    const region = regions.find((option) => option.label.toLocaleLowerCase() === name.trim().toLocaleLowerCase() || option.id === slug(name));
    if (!region || !Array.isArray(list)) continue;
    areas[region.id] = list.filter((area): area is string => typeof area === "string" && Boolean(area.trim()));
  }
  return areas;
}
