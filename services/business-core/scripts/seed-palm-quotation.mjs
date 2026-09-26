// Local-only demo data for Planning → Quotations on the demo case (run seed-palm-moodboard first).
// A starter interiors catalog (materials, hardware, labour, and assemblies priced from their parts)
// with an active price book in the workspace currency, the firm's work packages and pricing settings,
// and a draft quote. No rooms are added: the estimator adds areas from the catalog in the builder.
// Safe to re-run: fixed ids and upserts.
//   DATABASE_URL=postgresql://…@localhost:5432/wodana PALM_ALLOW_SHARED_LOCAL_SEED=palm-living-demo-only node scripts/seed-palm-quotation.mjs
import assert from "node:assert/strict";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "Set DATABASE_URL to the local database.");
assert(["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname), "This seed is local-only.");
assert(process.env.PALM_ALLOW_SHARED_LOCAL_SEED === "palm-living-demo-only", "Opt in with PALM_ALLOW_SHARED_LOCAL_SEED=palm-living-demo-only.");

const id = (n) => `d3000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const caseId = "d2000000-0000-4000-8000-000000000005";
const quoteId = id(900);

const UNITS = [["pcs", "count", "1", "piece"], ["nos", "count", "1", "number"], ["m", "length", "1", "metre"], ["lm", "length", "1", "running metre"], ["sqm", "area", "1", "square metre"],
  ["l", "volume", "0.001", "litre"], ["hr", "time", "1", "hour"], ["point", "count", "1", "point"], ["job", "count", "1", "job"], ["trip", "count", "1", "trip"], ["set", "count", "1", "set"]];
const CATEGORIES = [["joinery", "Joinery"], ["materials", "Boards & surfaces"], ["hardware", "Hardware"], ["electrical", "Electrical"], ["finishes", "Paint & finishes"], ["civil", "Civil & site"], ["lighting", "Lighting"]];
// [n, code, name, type, unit, category, description, waste, price]
// price: ["fixed", price] | ["per_measure", rate] | ["cost_plus", cost, markup] | ["assembly_rollup", labour, margin]
const ITEMS = [
  [1, "PLY18", "Plywood 18 mm (BWP)", "material", "sqm", "materials", "Boiling-water-proof, both sides sanded", "10", ["cost_plus", "52", "40"]],
  [2, "MDF18", "MDF 18 mm (MR)", "material", "sqm", "materials", "Moisture-resistant", "10", ["cost_plus", "38", "40"]],
  [3, "LAM1", "Laminate 1 mm", "material", "sqm", "materials", "Matt finish, colour to choose", "12", ["cost_plus", "22", "45"]],
  [4, "VEN-WAL", "Walnut veneer", "material", "sqm", "materials", "Natural walnut, lacquered", "15", ["cost_plus", "95", "40"]],
  [5, "QTZ20", "Quartz worktop 20 mm", "material", "sqm", "materials", "Eased edge, templated on site", "8", ["fixed", "780"]],
  [6, "GYP12", "Gypsum board 12.5 mm", "material", "sqm", "civil", "False ceiling board on metal frame", "8", ["fixed", "38"]],
  [7, "HNG-SC", "Soft-close hinge", "product", "nos", "hardware", "Clip-on, 110°", null, ["fixed", "28"]],
  [8, "RUN-TB", "Drawer runner, full extension", "product", "set", "hardware", "Soft close, 45 kg", null, ["fixed", "95"]],
  [9, "HDL-BAR", "Bar handle 160 mm", "product", "nos", "hardware", "Brushed brass", null, ["fixed", "45"]],
  [10, "LAB-CARP", "Carpentry labour", "service", "hr", "joinery", "Fabrication and fitting", null, ["per_measure", "65"]],
  [11, "LAB-PAINT", "Painting (2 coats)", "service", "sqm", "finishes", "Primer and two coats emulsion", null, ["per_measure", "18"]],
  [12, "EL-POINT", "Electrical point", "service", "point", "electrical", "Wiring, conduit and switch/socket", null, ["per_measure", "140"]],
  [13, "EL-LED", "LED strip with driver", "product", "m", "lighting", "Warm white, aluminium profile", "5", ["fixed", "85"]],
  [14, "CIV-DEMO", "Demolition", "service", "sqm", "civil", "Break-out and cart away to site skip", null, ["per_measure", "35"]],
  [15, "CIV-SKIP", "Debris disposal", "service", "trip", "civil", "Licensed disposal, one skip", null, ["fixed", "650"]],
  [16, "CEIL-FC", "False ceiling", "assembly", "sqm", "civil", "Gypsum on metal frame, painted", null, ["assembly_rollup", "20", "25"]],
  [17, "WRD-H", "Wardrobe · hinged", "assembly", "nos", "joinery", "Floor-to-ceiling, laminate finish, soft-close", null, ["assembly_rollup", null, "30"]],
  [18, "KIT-BASE", "Kitchen base cabinet", "assembly", "lm", "joinery", "MR carcass, laminate shutters, soft-close", null, ["assembly_rollup", null, "30"]],
  [19, "TV-UNIT", "TV unit", "assembly", "nos", "joinery", "Wall-hung, walnut veneer", null, ["assembly_rollup", null, "35"]],
  [20, "PEND-01", "Pendant light", "product", "nos", "lighting", "Supplied and installed", null, ["fixed", "1250"]],
];
// parent, child, formula per one unit of the parent
const PARTS = [
  [16, 6, "1"], [16, 11, "1"],
  [17, 1, "width * height * 2.4"], [17, 3, "width * height * 2"], [17, 7, "ceil(width / 0.45) * 3"], [17, 9, "ceil(width / 0.45)"], [17, 10, "8"],
  [18, 2, "2.2"], [18, 3, "1.6"], [18, 7, "4"], [18, 8, "1"], [18, 10, "3"],
  [19, 1, "width * 0.9"], [19, 4, "width * 0.8"], [19, 13, "width"], [19, 10, "6"],
];
const TRADES = ["Joinery", "Civil", "Electrical", "Painting & finishes", "Loose furniture"];

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  const ws = (await client.query(`SELECT workspace_id AS id FROM tenant_login_branding WHERE login_slug='palm-living'`)).rows[0]?.id;
  assert(ws, "The Palm Living workspace is not configured locally.");
  await client.query(`SELECT set_config('app.current_workspace_id',$1,true)`, [ws]);
  assert((await client.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id=$1 AND id=$2`, [ws, caseId])).rowCount, "Run seed-palm-moodboard.mjs first.");
  const currency = (await client.query(`SELECT default_currency AS c FROM workspaces WHERE id=$1`, [ws])).rows[0].c;
  const owner = (await client.query(`SELECT u.id FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status='active' ORDER BY u.primary_email LIKE 'operations@%' DESC, m.joined_at LIMIT 1`, [ws])).rows[0].id;

  for (const [code, kind, toBase, label] of UNITS)
    await client.query(`INSERT INTO catalog_units(workspace_id,code,label,kind,to_base) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [ws, code, label, kind, toBase]);
  const catalog = id(1);
  await client.query(`INSERT INTO catalogs(id,workspace_id,code,name,purpose,created_by) VALUES($1,$2,'interiors','Interiors starter','sell',$3) ON CONFLICT(id) DO NOTHING`, [catalog, ws, owner]);
  const category = {};
  for (const [position, [code, name]] of CATEGORIES.entries()) {
    category[code] = id(10 + position);
    await client.query(`INSERT INTO catalog_categories(id,workspace_id,catalog_id,code,name,sort_order) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`, [category[code], ws, catalog, code, name, position]);
  }
  for (const [n, code, name, type, unit, cat, description, waste] of ITEMS)
    await client.query(`INSERT INTO catalog_items(id,workspace_id,catalog_id,category_id,code,name,item_type,unit_code,description,waste_percent,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, waste_percent=excluded.waste_percent`,
      [id(100 + n), ws, catalog, category[cat], code, name, type, unit, description, waste, owner]);
  await client.query(`DELETE FROM catalog_components WHERE workspace_id=$1 AND parent_item_id = ANY($2::uuid[])`, [ws, [...new Set(PARTS.map(([parent]) => id(100 + parent)))]]);
  for (const [position, [parent, child, formula]] of PARTS.entries()) {
    const unit = ITEMS.find(([n]) => n === child)[4];
    await client.query(`INSERT INTO catalog_components(workspace_id,parent_item_id,component_item_id,quantity_formula,unit_code,sort_order) VALUES($1,$2,$3,$4,$5,$6)`, [ws, id(100 + parent), id(100 + child), formula, unit, position]);
  }
  const book = id(2);
  await client.query(`INSERT INTO price_books(id,workspace_id,catalog_id,name,currency,status,effective_from) VALUES($1,$2,$3,'Retail',$4,'active',current_date - 30) ON CONFLICT(id) DO UPDATE SET status='active'`, [book, ws, catalog, currency]);
  for (const [n, , , , , , , , [method, a, b]] of ITEMS) {
    const values = { fixed: [a, null, null, null, null, null], per_measure: [null, a, null, null, null, null], cost_plus: [null, null, a, b, null, null], assembly_rollup: [null, null, null, null, a, b] }[method];
    await client.query(`INSERT INTO price_entries(id,workspace_id,price_book_id,item_id,method,price,rate,cost,markup_percent,labour,margin_percent,status,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12)
      ON CONFLICT(id) DO UPDATE SET method=excluded.method, price=excluded.price, rate=excluded.rate, cost=excluded.cost, markup_percent=excluded.markup_percent, labour=excluded.labour, margin_percent=excluded.margin_percent`,
      [id(300 + n), ws, book, id(100 + n), method, ...values, owner]);
  }

  for (const [position, name] of TRADES.entries())
    await client.query(`INSERT INTO workspace_work_packages(id,workspace_id,name,position,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`, [id(500 + position), ws, name, position, owner]);
  await client.query(`INSERT INTO workspace_quotation_settings(workspace_id,default_view,default_markup_percent,margin_floor_percent,discount_approval_percent,validity_days,updated_by)
    VALUES($1,'area',35,25,10,7,$2) ON CONFLICT(workspace_id) DO NOTHING`, [ws, owner]);

  // A draft quote to build in; lines are added in the builder.
  await client.query(`INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}') ON CONFLICT(case_id) DO NOTHING`, [ws, caseId]);
  await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency,tax_rate,detail)
    VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote',$4,5,'{"terms":"","exclusions":"","requestIds":[]}')
    ON CONFLICT(case_id,id) DO NOTHING`, [ws, caseId, quoteId, currency]);
  await client.query("COMMIT");
  console.log(`Quotation demo ready: Planning → Jumeirah Garden Villa → Quotations → Q-1 (catalog "Interiors starter", ${ITEMS.length} items, ${currency}).`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
