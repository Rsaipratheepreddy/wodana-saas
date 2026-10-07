import { createHash } from "node:crypto";
import { CatalogKind, CatalogSizeDto, SaveCatalogRecordDto } from "./catalog.dto";

export const STARTER_VERSION = "interiors-groups-2026-09-07";
// Stable across installations; records and references are always scoped by workspace_id.
export function starterId(key: string): string {
  const h = createHash("sha256").update(`wodana:catalog:v1:${key}`).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
const code = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/_$/, "");
const link = (relation: string, name: string) => ({ relation, targetId: starterId(`${relation}:${code(name)}`) });
const rows: SaveCatalogRecordDto[] = [];
function add(kind: CatalogKind, name: string, extra: Partial<SaveCatalogRecordDto> = {}) {
  const row: SaveCatalogRecordDto = { id: starterId(`${kind}:${code(name)}`), version: 0, kind, code: code(name), name,
    description: "", market: "GLOBAL", aliases: [], attributes: [], sizes: [], sources: [], links: [],
    specificationStatus: "needs_specification", dimension: "none", ...extra };
  rows.push(row); return row;
}
function names(kind: CatalogKind, text: string, extra: Partial<SaveCatalogRecordDto> = {}) { text.split("|").forEach(name => add(kind, name, extra)); }

// Unit factors are relative to m, m², m³, kg, each and hour, respectively.
// Sheet/box/roll/set are packs: there is deliberately no universal conversion.
for (const [name, symbol, dimension, factor] of [
  ["Millimetre","mm","length",0.001],["Centimetre","cm","length",0.01],["Metre","m","length",1],["Inch","in","length",0.0254],["Foot","ft","length",0.3048],
  ["Square metre","m²","area",1],["Square foot","ft²","area",0.09290304],["Square yard","yd²","area",0.83612736],
  ["Cubic metre","m³","volume",1],["Cubic foot","ft³","volume",0.028316846592],["Litre","L","volume",0.001],["Millilitre","ml","volume",0.000001],
  ["Kilogram","kg","mass",1],["Gram","g","mass",0.001],["Tonne","t","mass",1000],
  ["Each","ea","count",1],["Pair","pair","count",2],["Hour","h","time",1],
] as const) add("unit",name,{ dimension, baseFactor:factor, aliases:[symbol], specificationStatus:"reference", description:`${symbol}. Base dimension: ${dimension}.` });
names("unit","Sheet|Box|Roll|Set|Bag|Lot|Point|Day",{ dimension:"pack",description:"Project or product-specific quantity. Define the pack contents or work basis before conversion." });
names("room","Foyer|Living room|Family room|Dining room|Kitchen|Utility|Primary bedroom|Bedroom|Children’s bedroom|Guest bedroom|Dressing room|Pooja room|Bathroom|Powder room|Study|Home office|Balcony|Terrace|Garden|Staircase|Corridor|Store room|Garage|Reception|Open office|Private office|Meeting room|Conference room|Pantry|Breakout area|Retail sales floor|Display area|Trial room|Restaurant dining|Commercial kitchen|Hotel guest room|Clinic consultation|Treatment room|Classroom|Accessible washroom|Server room|Common area", { specificationStatus:"reference", description:"Reusable room type. Create separately named instances, such as Bedroom 1 and Bedroom 2, in each project." });
for(const [name,aliases] of Object.entries({"Primary bedroom":["Master bedroom","Main bedroom"],"Children’s bedroom":["Kids bedroom","Kids bedroom (Boy)","Kids bedroom (Girl)"],"Dining room":["Dining area"],"Pooja room":["Puja room","Prayer room"],"Bathroom":["Toilet","Washroom"],"Common area":["Full home common"]})) rows.find(r=>r.kind==="room"&&r.name===name)!.aliases=aliases;
names("category","Boards & substrates|Laminates & veneers|Solid wood|Glass & mirrors|Tiles|Stone & countertops|Flooring|Paints & coatings|Wallcoverings & panels|Ceilings & partitions|Insulation & acoustics|Hardware|Modular accessories|Sanitaryware|Faucets & showers|Plumbing|Electrical|Lighting|HVAC & ventilation|Appliances|Fabrics & furnishings|Furniture|Doors & windows|Metalwork|Adhesives & sealants|Waterproofing|Civil materials|Safety & automation|Landscape & exterior", { specificationStatus:"reference" });
names("finish","Matt|Gloss|High gloss|Satin|Textured|Woodgrain|Metallic|Polished|Honed|Brushed|Fluted|Flamed|Leathered|Sandblasted|Lacquered|Powder coated|Anodized|Chrome|Nickel|Brass|Black|Natural",{ specificationStatus:"reference",description:"Finish vocabulary. Availability, shade and performance must be confirmed for the selected product." });

const source = (title: string,url: string) => ({ title,url,checkedOn:"2026-09-07" });
const sources = {
  ply: source("Greenply: plywood size guide","https://www.greenply.com/blogs/plywood-size-charts-explained-everything-you-need-for-your-next-build"),
  mdf: source("Greenpanel: Exterior MDF","https://www.greenpanel.com/products/mdf/exterior-mdf.aspx"),
  laminate: source("Greenlam: collection specifications","https://www.greenlam.co.in/media/pdf/Greenlam%20Edition%202023-2025.pdf"),
  tile: source("Kajaria: Gres catalogue","https://www.kajariaceramics.com/catalogo/catalogue/gres-60x120.pdf"),
  gypsum: source("Gyproc: Gypboard Plain","https://www.gyproc.in/products-plasterboards/gypsum-plain-board"),
  quartz: source("Caesarstone: design and specification","https://www.caesarstoneus.com/design-and-specification/"),
  paint: source("Asian Paints: Royale Luxury Matt technical sheet","https://static.asianpaints.com/content/dam/professionals/products/pdfs/tds/TDS_Royale_Luxury_Matt.pdf"),
  runner: source("Blum: MOVENTO 2024/2025 technical catalogue","https://publications.blum.com/2024/catalogue/id/510/"),
  flooring: source("EGGER: EL2835 NatureSense","https://www.egger.com/en/flooring/decors/1784252?country=PF"),
  pipe: source("Astral: CPVC Pro technical catalogue","https://www.astralpipes.com/wp-content/uploads/2022/12/CPVC-Pro_PC_MAY-2024.pdf"),
  glass: source("Saint-Gobain: DECORGLASS","https://www.saint-gobain-glass.com/DECORGLASS"),
};
for (const [name, src] of [["Greenply",sources.ply],["Greenpanel",sources.mdf],["Greenlam",sources.laminate],["Kajaria",sources.tile],["Gyproc",sources.gypsum],["Caesarstone",sources.quartz],["Asian Paints",sources.paint],["Blum",sources.runner],["EGGER",sources.flooring],["Astral",sources.pipe],["Saint-Gobain",sources.glass]] as const) add("brand",name,{sources:[src],specificationStatus:"reference",description:"Manufacturer reference. Add the exact product line, SKU and local supplier specification to materials."});

function material(category: string, name: string, unit: string, required: string, extra: Partial<SaveCatalogRecordDto> = {}) {
  return add("material",name,{ description:`Specify ${required}.`, attributes:[{name:"Specification checklist",value:required}],links:[link("category",category),link("unit",unit)],...extra });
}
const families: [string,string,string,string][] = [
  ["Boards & substrates","MR plywood|BWR plywood|BWP plywood|Flexible plywood|Fire-retardant plywood|Blockboard|Interior MDF|Exterior MDF|HDHMR board|Particleboard|OSB|Cement-bonded board|PVC foam board|WPC board","Sheet","grade, thickness, sheet size, emission class, product line and suitability"],
  ["Laminates & veneers","Decorative HPL|Compact laminate|Acrylic sheet|PET laminate|Natural veneer|Reconstituted veneer|PVC edge band|ABS edge band","Sheet","substrate, thickness, size, finish, decor code and edge details"],
  ["Solid wood","Teak timber|Oak timber|Ash timber|Walnut timber|Rubberwood|Pine timber|Bamboo panel","Cubic metre","species, origin, moisture content, grade, section and length"],
  ["Glass & mirrors","Clear float glass|Toughened glass|Laminated glass|Tinted glass|Fluted glass|Frosted glass|Back-painted glass|Mirror","Square metre","glass build-up, thickness, cut size, edge treatment, holes and safety requirements"],
  ["Tiles","Ceramic wall tile|Glazed vitrified tile|Polished vitrified tile|Full-body vitrified tile|Porcelain tile|Mosaic tile|Outdoor paving tile|Tile skirting","Square metre","size, thickness, finish, batch, shade, slip rating and box coverage"],
  ["Stone & countertops","Granite slab|Marble slab|Quartz slab|Sintered stone|Solid surface|Limestone|Sandstone|Terrazzo","Square metre","usable slab size, thickness, finish, batch, edge profile and cut-outs"],
  ["Flooring","Laminate flooring|Engineered wood flooring|Solid wood flooring|SPC flooring|LVT flooring|Vinyl sheet flooring|Carpet tile|Broadloom carpet|Rubber flooring|Floor underlay","Square metre","plank or roll size, thickness, wear layer, installation system and pack coverage"],
  ["Paints & coatings","Interior emulsion|Exterior emulsion|Primer|Wall putty|Enamel paint|PU coating|Melamine polish|Wood stain|Epoxy floor coating|Texture paint","Litre","product, shade code, pack size, substrate, coats and coverage from current technical sheet"],
  ["Wallcoverings & panels","Wallpaper|Fabric wallcovering|PVC wall panel|WPC wall panel|Decorative metal panel|Wood slat panel|Stone veneer panel","Square metre","width, repeat, length, thickness, finish and installation system"],
  ["Ceilings & partitions","Gypsum plasterboard|Moisture-resistant gypsum board|Fire-resistant gypsum board|Fibre cement board|Calcium silicate board|Mineral fibre ceiling tile|Metal ceiling tile|Ceiling grid|Partition stud|Partition track","Square metre","board or profile size, gauge, spacing and tested assembly specification"],
  ["Insulation & acoustics","Glass wool|Rock wool|PET acoustic panel|Wood-wool panel|Acoustic foam","Square metre","thickness, density, facing, acoustic rating and tested fire classification"],
  ["Hardware","Concealed hinge|Drawer runner|Tandem drawer system|Lift-up fitting|Sliding door track|Handle|Knob|Cabinet lock|Door lock|Door closer|Door stopper|Castor|Shelf support|Fastener","Each","model, size, mounting, load, finish and compatible components"],
  ["Modular accessories","Cutlery tray|Bottle pull-out|Corner carousel|Magic corner|Pantry pull-out|Tall unit basket|Waste bin pull-out|Wardrobe organizer|Trouser pull-out|Shoe rack fitting|Handleless profile","Set","cabinet opening, clearances, load capacity, model and included hardware"],
  ["Sanitaryware","Wall-hung WC|Floor-mounted WC|Concealed cistern|Countertop basin|Undercounter basin|Wall-hung basin|Urinal|Bathtub|Kitchen sink","Each","model, overall dimensions, rough-in, mounting and required fittings"],
  ["Faucets & showers","Basin mixer|Sink mixer|Shower mixer|Overhead shower|Hand shower|Health faucet|Diverter|Floor drain","Each","model, finish, mounting, flow, connection and operating pressure"],
  ["Plumbing","CPVC pipe|uPVC pipe|PPR pipe|SWR pipe|Copper pipe|Pipe fitting|Isolation valve|Flexible connector|Water tank","Metre","nominal size, actual OD, wall thickness, pressure class and pipe system"],
  ["Electrical","Copper wire|Armoured cable|Conduit|Junction box|Switch|Socket|MCB|RCCB|Distribution board|Data outlet|Earthing conductor","Each","conductor area, rating, poles, length, insulation and applicable system design"],
  ["Lighting","Recessed downlight|Surface downlight|Track light|LED strip|LED profile|Pendant light|Wall light|Outdoor light|LED driver|Dimmer|Ceiling fan","Each","power, lumens, CCT, CRI, cut-out, IP rating, beam angle and driver compatibility"],
  ["HVAC & ventilation","Split AC|Cassette AC|Ducted AC|Exhaust fan|Air grille|Air diffuser|Ductwork|Duct insulation|Thermostat","Each","capacity, airflow, noise, dimensions, power and installation requirements"],
  ["Appliances","Built-in hob|Cooker hood|Built-in oven|Microwave|Dishwasher|Refrigerator|Washing machine|Dryer|Water purifier|Water heater","Each","model, cut-out, service clearances, utility connections and electrical load"],
  ["Fabrics & furnishings","Upholstery fabric|Curtain fabric|Sheer fabric|Blackout fabric|Roller blind|Venetian blind|Curtain track|Curtain rod|Mattress|Rug","Metre","composition, width, repeat, abrasion rating, lining and finished dimensions"],
  ["Furniture","Sofa|Lounge chair|Dining table|Dining chair|Office chair|Workstation|Bed frame|Side table|Coffee table|Bench","Each","dimensions, construction, upholstery, finish and assembly details"],
  ["Doors & windows","Flush door|Panel door|Fire-rated door assembly|Aluminium window|uPVC window|Door frame|Window glazing|Door seal","Each","opening size, leaf thickness, frame section, finish, hardware and performance"],
  ["Metalwork","Mild steel section|Stainless steel section|Aluminium profile|Metal sheet|Metal mesh|Railing system","Metre","alloy, section, gauge, length, finish and fabrication drawing"],
  ["Adhesives & sealants","PVA wood adhesive|Contact adhesive|PU adhesive|Tile adhesive|Epoxy grout|Cementitious grout|Silicone sealant|Acrylic sealant|PU foam","Kilogram","substrate compatibility, pack size, coverage, movement class and cure time"],
  ["Waterproofing","Cementitious waterproofing|Liquid membrane|Sheet membrane|Waterproofing tape|Waterstop","Square metre","system, substrate preparation, thickness, coverage and testing method"],
  ["Civil materials","Cement|Sand|Aggregate|AAC block|Clay brick|Gypsum plaster|Ready-mix plaster|Screed|Reinforcement steel","Kilogram","grade, size, strength, unit of supply and project specification"],
  ["Safety & automation","Smoke detector|Heat detector|Sprinkler|Fire extinguisher|CCTV camera|Access control|Smart relay|Motion sensor|Video door phone","Each","model, certification, power, communication protocol and system compatibility"],
  ["Landscape & exterior","Artificial turf|Decking board|Outdoor paver|Planter|Irrigation line|Geotextile","Square metre","dimensions, weather exposure, drainage, grade and fixing system"],
];
for (const [category,items,unit,required] of families) items.split("|").forEach(name => material(category,name,unit,required));
// Family defaults are editable measurement suggestions, not supplier pack conversions.
for (const [name,unit] of [["PVC edge band","Metre"],["ABS edge band","Metre"],["Wall putty","Kilogram"],["Tile adhesive","Kilogram"],["Epoxy grout","Kilogram"],["Cementitious grout","Kilogram"],["Copper wire","Metre"],["Armoured cable","Metre"],["Conduit","Metre"],["Curtain track","Metre"],["Curtain rod","Metre"],["Mattress","Each"],["Rug","Each"],["Water tank","Each"],["Pipe fitting","Each"],["Isolation valve","Each"],["Flexible connector","Each"],["Cement","Bag"],["Sand","Cubic metre"],["Aggregate","Cubic metre"],["AAC block","Each"],["Clay brick","Each"],["Gypsum plaster","Bag"],["Ready-mix plaster","Bag"],["Roller blind","Square metre"],["Venetian blind","Square metre"]]) {
  const row = rows.find(r=>r.kind==="material"&&r.name===name)!; row.links=row.links.filter(l=>l.relation!=="unit").concat(link("unit",unit));
}

function referenced(name: string, category: string, unit: string, brand: string, src: typeof sources.ply, sizes: CatalogSizeDto[], note: string, market = "IN") {
  material(category,name,unit,"exact product/decor and local availability before procurement",{market,specificationStatus:"reference",sources:[src],sizes:sizes.map(s=>({...s,sourceUrl:src.url})),description:note,links:[link("category",category),link("unit",unit),link("brand",brand)]});
}
referenced("Greenply plywood: reference thicknesses","Boards & substrates","Sheet","Greenply",sources.ply,[4,6,9,12,16,19,25].map(thicknessMm=>({label:`${thicknessMm} mm thickness`,thicknessMm})),"Manufacturer guide thickness examples. Sheet size and grade must be selected from the exact product; these are not guaranteed combinations.");
referenced("Greenpanel Exterior MDF: reference sheets","Boards & substrates","Sheet","Greenpanel",sources.mdf,[
  {label:"2440 × 1220 mm",lengthMm:2440,widthMm:1220},{label:"2440 × 1830 mm",lengthMm:2440,widthMm:1830},
  ...[2.7,3.3,5.5,7.3,11,17,18,25].map(thicknessMm=>({label:`${thicknessMm} mm thickness`,thicknessMm}))
],"Published sheet formats and thicknesses are separate choices. Confirm the chosen combination, grade and finish with the manufacturer.");
referenced("Greenlam Super Gloss: 1 mm","Laminates & veneers","Sheet","Greenlam",sources.laminate,[2440,3050].map(lengthMm=>({label:`${lengthMm} × 1220 × 1 mm`,lengthMm,widthMm:1220,thicknessMm:1})),"Super Gloss collection. The larger format is limited to marked decors; confirm the exact decor code.");
referenced("Kajaria Gres: reference tile formats","Tiles","Square metre","Kajaria",sources.tile,[[800,1600],[600,1200],[195,1200],[600,600]].map(([widthMm,lengthMm])=>({label:`${widthMm} × ${lengthMm} mm`,lengthMm,widthMm})),"Collection format examples. Thickness, finish, pieces per box and slip rating remain product-specific.");
referenced("Gyproc Gypboard Plain: board formats","Ceilings & partitions","Sheet","Gyproc",sources.gypsum,[[1829,9.5],[1829,12.5],[2438,12.5],[1829,15],[2438,15]].map(([lengthMm,thicknessMm])=>({label:`${lengthMm} × 1219 × ${thicknessMm} mm`,lengthMm,widthMm:1219,thicknessMm})),"Dimensions retained exactly as published. A board is a component; fire and acoustic ratings belong to tested assemblies.");
referenced("Caesarstone quartz: reference slabs","Stone & countertops","Square metre","Caesarstone",sources.quartz,[{label:"Standard 3050 × 1440 mm",lengthMm:3050,widthMm:1440},{label:"Jumbo 3270 × 1640 mm",lengthMm:3270,widthMm:1640,note:"±1.5%; availability depends on design"},{label:"20 mm thickness",thicknessMm:20},{label:"30 mm thickness",thicknessMm:30}],"US reference dimensions. Format and thickness availability depend on color; local supply and usable slab dimensions must be confirmed.","GLOBAL");
referenced("Asian Paints Royale Luxury Matt: pack sizes","Paints & coatings","Litre","Asian Paints",sources.paint,[1,3.6,16.5,18].map(packQuantity=>({label:`${packQuantity} L`,packQuantity,packUnit:"L"})),"Packs from the current linked Royale Luxury Matt technical sheet; other Royale variants have different packs. Coverage depends on coats and substrate.");
referenced("Blum MOVENTO TIP-ON 760H: nominal lengths","Hardware","Pair","Blum",sources.runner,[250,270,300,320,350,380,400,420,450,480,500,520,550,600].map(lengthMm=>({label:`${lengthMm} mm nominal length`,lengthMm})),"760H TIP-ON, 40 kg reference series. Nominal length is not cabinet depth. Check the current model, locking devices and required clearances.","GLOBAL");
referenced("EGGER EL2835 NatureSense: plank","Flooring","Square metre","EGGER",sources.flooring,[{label:"1292 × 193 × 8 mm",lengthMm:1292,widthMm:193,thicknessMm:8}],"Specific decor EL2835. Confirm local collection, pack contents, underlay and installation conditions.","GLOBAL");
referenced("Saint-Gobain DECORGLASS: patterned glass","Glass & mirrors","Square metre","Saint-Gobain",sources.glass,[],"Published thickness range 3–8 mm; actual sizes and thickness depend on pattern. Specify an exact pattern and fabricated glass build-up.","GLOBAL");
referenced("Astral CPVC Pro: plumbing system","Plumbing","Metre","Astral",sources.pipe,[],"Use the technical catalogue for CTS/IPS, SDR/schedule, actual OD and wall thickness. A nominal trade size is not the measured outside diameter.");

const workGroups: [string,string,string[]][] = [
  ["Shoe cabinet|Foyer console","Square metre",["Foyer"]],
  ["TV unit|Media wall|Display cabinet|Bookcase|Crockery unit|Bar unit|Wall panelling","Square metre",["Living room","Family room","Dining room"]],
  ["Base cabinet|Wall cabinet|Tall cabinet|Kitchen island|Breakfast counter|Under-sink cabinet|Countertop|Backsplash","Square metre",["Kitchen","Pantry","Commercial kitchen"]],
  ["Hinged wardrobe|Sliding wardrobe|Loft storage|Walk-in wardrobe|Dressing unit|Headboard|Study desk","Square metre",["Primary bedroom","Bedroom","Children’s bedroom","Guest bedroom","Dressing room"]],
  ["Vanity cabinet|Shower partition|Mirror installation|Bathroom accessory installation","Each",["Bathroom","Powder room","Accessible washroom"]],
  ["Pooja unit|Jaali screen","Square metre",["Pooja room"]],
  ["Utility cabinet|Laundry counter","Square metre",["Utility"]],
  ["Reception desk|Storage credenza|Office partition|Meeting table|Workstation installation","Each",["Reception","Open office","Private office","Meeting room","Conference room"]],
  ["Retail display|Cash counter|Trial room fitting","Each",["Retail sales floor","Display area","Trial room"]],
  ["Decking|Pergola|Planter installation","Square metre",["Balcony","Terrace","Garden"]],
];
for(const [items,unit,rooms] of workGroups) for(const name of items.split("|")) add("work",name,{description:"Scope template. Confirm dimensions, materials, fittings, exclusions and measurement basis in the project.",links:[link("unit",unit),...rooms.map(r=>link("room",r))],attributes:[{name:"Measurement basis",value:unit==="Square metre"?"Define elevation area, plan area or finished surface area explicitly.":"Count completed units; define supply versus installation scope."}]});
for(const name of "Demolition|Masonry|Plastering|Floor levelling|Floor tiling|Wall tiling|Wood flooring installation|False ceiling|Painting|Wallpaper installation|Electrical wiring|Switch point|Light point|Plumbing rough-in|Waterproofing|Door installation|Window installation|Curtain installation|Acoustic treatment|HVAC installation|Fire system installation|Data cabling|Smart home installation|Joinery installation|Hardware installation|Polishing|Final cleaning|Debris removal".split("|")) add("work",name,{description:"Available across rooms. Confirm measured quantities, inclusions, materials, installation and testing requirements.",links:[link("unit","Lot")]});
names("service","Site survey|Measured drawings|Space planning|Concept design|3D visualization|Working drawings|MEP coordination|Structural consultation|Quantity take-off|Tender support|Procurement coordination|Site supervision|Project management|Quality inspection|Snagging|Handover documentation|Maintenance visit|Furniture assembly|Transport & delivery|Installation labour",{description:"Define deliverables, visit or hour basis, exclusions and acceptance criteria for each project.",links:[link("unit","Lot")]});
const executionRows:SaveCatalogRecordDto[] = require("../../../../packages/contracts/data/execution-master-seed.json");
export const EXECUTION_BASELINE:SaveCatalogRecordDto[] = require("../../../../packages/contracts/data/execution-master-baseline.json");
const starterGroups = [
  {name:"Rooms & items",code:"GROUP_ROOMS_ITEMS",kinds:["room","work","variant","service"]},
  {name:"Materials & products",code:"GROUP_MATERIALS",kinds:["material","brand","finish","sku","hardware","consumable","category"]},
  {name:"Measurements",code:"GROUP_MEASUREMENTS",kinds:["unit","measurement"]},
  {name:"Factory & on-site",code:"GROUP_EXECUTION",kinds:["execution","factory_process","site_process","execution_rule","resource"]},
  {name:"Construction templates",code:"GROUP_CONSTRUCTION",kinds:["construction","variant_rule"]},
  {name:"Allowances & references",code:"GROUP_REFERENCES",kinds:["wastage_rule","logistics_rule","installation_rule","commercial_rule","tax","rate_zone","rate_card"]},
];
const wardrobe = add("work","Wardrobe",{description:"Reusable wardrobe item. Choose a variant, then specify components and actual dimensions in the project.",links:[link("room","Primary bedroom"),link("unit","Square foot"),{relation:"construction",targetId:executionRows.find(r=>r.code==="ICT-WARD")!.id}]});
for(const [name, rule] of [["Sliding","VR-WARD-SLD"],["Openable","VR-WARD-OPEN"]]) {
  const variantRule = executionRows.find(r=>r.code===rule);
  add("variant",name,{links:[{relation:"work",targetId:wardrobe.id},...(variantRule?[{relation:"variant_rule",targetId:variantRule.id}]:[])]});
}
const ungrouped = [...rows,...executionRows];
const groupDescriptions = ["Rooms, items, variants and reusable services.","Materials, exact products, brands, finishes and hardware.","Units and reusable measurement definitions.","Execution choices, factory operations and site activities.","Component templates and the changes made by item variants.","Wastage, installation, logistics and commercial references."];
const groupDefaults = ["work","material","unit","factory_process","construction","custom"];
const groups = starterGroups.map((g,i)=>({id:starterId(`record_group:${g.code}`),version:0,kind:"record_group",code:g.code,name:g.name,description:groupDescriptions[i],market:"CUSTOM",aliases:[],attributes:[],sizes:[],sources:[],links:[],specificationStatus:"needs_specification",dimension:"none",configuration:{sortOrder:(i+1)*10,defaultKind:groupDefaults[i]}} as SaveCatalogRecordDto));
export const CATALOG_STARTER = [...groups,...ungrouped.map(r=>({...r,links:[...r.links,...(r.kind === "construction" && r.code === "ICT-WARD" ? [{relation:"work",targetId:wardrobe.id}] : []),{relation:"record_group",targetId:groups[starterGroups.findIndex(g=>g.kinds.includes(r.kind))].id}]}))];
export const CATALOG_STARTER_GROUPS = starterGroups;
