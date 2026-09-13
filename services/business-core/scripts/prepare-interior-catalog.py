"""Prepare a reviewed catalog delta; this script never connects to a database."""
import json, uuid, sys
from pathlib import Path
CATALOG = '5a83688b-fab6-45ae-b1f3-1c6fa6d6a160'
namespace = uuid.UUID('83640214-024c-4ae6-adab-f3c2d401cf82')
source = json.loads(Path(sys.argv[1]).read_text())
fields = {'description','market','aliases','attributes','sizes','sources','links','specificationStatus','dimension','baseFactor','configuration'}
records = {}
for row in source:
    if row['archived'] or (row['catalog_id'] != CATALOG and row['id'] != CATALOG): continue
    record = {k:v for k,v in row['content'].items() if k in fields}
    record.update({k:row[k] for k in ['id','kind','code','name','version']})
    if row['catalog_id']: record['catalogId'] = row['catalog_id']
    record.setdefault('configuration', {})
    records[(row['kind'],row['name'])] = record
original = {r['id']:json.loads(json.dumps(r)) for r in records.values()}

def get(kind,name):
    if (kind,name) not in records: raise ValueError(f'Missing {kind}: {name}')
    return records[kind,name]
def links(kind,names): return [{'relation':kind,'targetId':get(kind,n)['id']} for n in names]
def assign(record,kind,names):
    record['links'] = [l for l in record['links'] if l['relation'] != kind] + links(kind,names)
def attributes(record,**values):
    record['attributes'] = [a for a in record['attributes'] if a['name'] not in values] + [{'name':k,'value':str(v)} for k,v in values.items()]
def add(kind,name,description,unit=None,category=None,group=None,**extra):
    if (kind,name) in records: return get(kind,name)
    rid = str(uuid.uuid5(namespace, f'{CATALOG}:{kind}:{name}'))
    record = dict(id=rid,catalogId=CATALOG,version=0,kind=kind,code='INT_'+rid.replace('-','')[:24].upper(),name=name,description=description,market='GLOBAL',aliases=[],attributes=[],sizes=[],sources=[],links=[],specificationStatus='needs_specification',dimension='none',configuration={})
    records[kind,name]=record
    if unit: assign(record,'unit',[unit])
    if category: assign(record,'category',[category])
    assign(record,'record_group',[group or ('Rooms & items' if kind in ['work','variant','room','service'] else 'Materials & products')])
    record.update(extra)
    return record

catalog=get('catalog_group','Dubai materials & execution')
catalog.update(name='Interior design & fit-out',description='Reusable room, joinery, fit-out and material specifications. Select the exact product and supplier rate for each quotation.',market='GLOBAL')
# Specifications describe a selectable design requirement, not an invented manufacturer SKU or stock offer.
material_specs = [
('Birch plywood — 18 mm','Boards & substrates','Sheet','Cabinet carcasses and shelves','Core grade, face quality, moisture exposure and emission requirements','18'),
('Birch plywood — 6 mm','Boards & substrates','Sheet','Cabinet backs and drawer bottoms','Support spacing, face quality and approved construction detail','6'),
('Moisture-resistant MDF — 18 mm','Boards & substrates','Sheet','Routed cabinet fronts and painted interior panels','Moisture classification, edge sealing and coating system','18'),
('Interior MDF — 12 mm','Boards & substrates','Sheet','Decorative interior panelling','Fixing substrate, panel joint layout and coating system','12'),
('Melamine-faced board — 18 mm','Boards & substrates','Sheet','Cabinet carcasses and shelving','Core grade, decor reference, texture and matching edge band','18'),
('Compact laminate — 12 mm','Laminates & veneers','Square metre','Worktops and durable partitions','Core color, edge profile, support and manufacturer application guidance','12'),
('Decorative HPL — 1 mm','Laminates & veneers','Sheet','Cabinet shutters and decorative panels','Decor code, texture, substrate, adhesive and balancing layer','1'),
('Natural oak veneer','Laminates & veneers','Square metre','Cabinet fronts and feature panels','Veneer cut, grain matching, backing, stain and protective coating',''),
('Natural walnut veneer','Laminates & veneers','Square metre','Cabinet fronts and feature panels','Veneer cut, grain matching, backing, stain and protective coating',''),
('ABS edge band — 2 mm','Laminates & veneers','Metre','Exposed cabinet and shelf edges','Width, decor match, adhesive system and trimming radius','2'),
('ABS edge band — 1 mm','Laminates & veneers','Metre','Internal shelving and panel edges','Width, decor match and adhesive system','1'),
('Clear toughened glass — 10 mm','Glass & mirrors','Square metre','Interior glass screens','Final glass design, cutouts, edge finish, fittings and required safety evidence','10'),
('Clear toughened glass — 6 mm','Glass & mirrors','Square metre','Framed cabinet doors and shelves','Panel size, loading, support arrangement and edge finish','6'),
('Silvered mirror — 6 mm','Glass & mirrors','Square metre','Vanity and dressing mirrors','Backing protection, edge finish, fixing and moisture exposure','6'),
('Porcelain floor tile — 600 × 600 mm','Tiles','Square metre','Interior floor finishes','Product code, finish, slip requirement, shade batch and grout joint',''),
('Porcelain wall tile — 600 × 1200 mm','Tiles','Square metre','Feature and wet-area walls','Product code, substrate, fixing system and grout joint',''),
('Quartz worktop — 20 mm','Stone & countertops','Square metre','Kitchen and vanity worktops','Design code, usable slab dimensions, seams, edge profile and cutouts','20'),
('Sintered-stone worktop — 12 mm','Stone & countertops','Square metre','Kitchen worktops and wall cladding','Manufacturer support detail, edge design, cutouts and fabrication instructions','12'),
('Solid-surface worktop — 12 mm','Stone & countertops','Square metre','Reception counters and vanity surfaces','Color, substrate, seam layout and manufacturer fabrication guidance','12'),
('Engineered oak flooring','Flooring','Square metre','Dry interior floors','Wear layer, plank format, finish, substrate moisture and installation system',''),
('SPC click flooring','Flooring','Square metre','Interior resilient floor finish','Wear layer, plank format, underlay, expansion gaps and manufacturer suitability',''),
('Loop-pile carpet tile','Flooring','Square metre','Office and meeting-room floor finish','Tile format, backing, color batch, adhesive and declared performance',''),
('Interior acrylic emulsion — matt','Paints & coatings','Litre','Wall and ceiling decoration','Color code, primer, substrate preparation and coat system',''),
('Polyurethane clear coat — matt','Paints & coatings','Litre','Veneered and solid-timber joinery','Compatible stain/sealer, coat system, curing and approved sample',''),
('PET acoustic felt panel','Insulation & acoustics','Square metre','Interior acoustic wall treatment','Thickness, fixing, color and required acoustic/fire evidence',''),
('Mineral-wool acoustic infill','Insulation & acoustics','Square metre','Partition and ceiling cavities','Thickness, density and compatibility with the specified assembly',''),
('Gypsum plasterboard — 12.5 mm','Ceilings & partitions','Sheet','Interior drylining and ceilings','Board type, frame spacing and complete specified assembly','12.5'),
('Moisture-resistant gypsum board — 12.5 mm','Ceilings & partitions','Sheet','Humid interior drylining','Exposure limits, edge protection and complete specified assembly','12.5'),
('LED strip — warm white','Lighting','Metre','Cabinet and feature lighting','Voltage, power, color temperature, CRI, IP rating and compatible driver',''),
('Recessed LED downlight','Lighting','Each','Ceiling lighting','Lumens, beam, cutout, color temperature, CRI, driver and dimming',''),
('Blackout curtain fabric','Fabrics & furnishings','Metre','Bedroom and meeting-room window treatment','Fabric width, fullness, color, lining and any required fire evidence',''),
('Sheer curtain fabric','Fabrics & furnishings','Metre','Living and bedroom window treatment','Fabric width, fullness, color and track arrangement',''),
]
for name,category,unit,application,check,thickness in material_specs:
    r=add('material',name,f'{application}. Specify {check.lower()}.',unit,category)
    attributes(r,Application=application,**{'Selection details':check,'Supply basis':'Confirm exact manufacturer product, stock format and supplier offer.'})
    if thickness: r['sizes']=[{'label':f'{thickness} mm specified thickness','thicknessMm':float(thickness),'note':'Design specification; verify the selected product and available format.'}]

hardware_specs = [
('Soft-close cabinet hinge set','Set','Hinged shutters','Overlay/inset, opening angle, mounting plate, door weight and thickness'),
('Full-extension soft-close drawer runner pair','Pair','Timber drawers','Nominal length, cabinet clearances, load class and locking devices'),
('Metal-sided drawer system','Set','Kitchen and vanity drawers','Drawer height, nominal length, internal width, runner and front connectors'),
('Wardrobe sliding-door track set','Set','Sliding wardrobes','Door count, panel weight, opening width, track length and soft-close option'),
('Wardrobe rail with end supports','Set','Hanging compartments','Rail length, section, supports, finish and loading'),
('Adjustable shelf-support set','Set','Adjustable cabinet shelving','Pin diameter, shelf thickness and loading'),
('Cabinet pull handle','Each','Drawer and shutter fronts','Hole centers, projection, length and finish'),
('Push-to-open cabinet fitting','Set','Handleless shutters','Door weight, mounting position and hinge compatibility'),
('Kitchen pull-out waste-bin unit','Set','Base cabinets','Cabinet width, bucket capacity, runner and door mounting'),
('Kitchen cutlery insert','Each','Kitchen drawers','Usable drawer width/depth, layout and material'),
('Countertop cable grommet','Each','Desks and meeting tables','Cutout diameter, finish and cable capacity'),
('Cabinet ventilation grille','Each','Appliance and AV cabinets','Free-air area, cutout, finish and appliance ventilation instructions'),
]
for name,unit,application,check in hardware_specs:
    r=add('hardware',name,f'{application}. Select {check.lower()}.',unit)
    attributes(r,Application=application,**{'Selection details':check})
    r['configuration']={'category':application,'selectionCriteria':check}

# Verified manufacturer families are references; procurement must choose the exact order code.
manufacturer_refs = [
('hardware','Blum CLIP top BLUMOTION hinge','Blum','Each','https://www.blum.com/us/en/products/hingesystems/clip-top-blumotion/overview/','Concealed cabinet hinge family with integrated soft-close. Select the hinge and mounting plate for the door application.'),
('hardware','Hettich AvanTech YOU drawer system','Hettich','Set','https://www.hettich.com/en-mt/products/drawer-systems/avantech-you','Configurable drawer system. Specify the drawer components, runner system, dimensions and front fixing.'),
('material','EGGER Eurodekor faced chipboard','EGGER','Sheet','https://www.egger.com/en/interior/product/MELAMINFACEDBOARDS?country=BI','Decorative faced-board family. Choose the core grade, decor, texture, thickness and edge band for the application.'),
('material','Knauf Wallboard','Knauf','Sheet','https://knauf.com/en-GB/p/products/boards-30337/gypsum-boards-26684','Standard plasterboard product family for interior drylining. Confirm the board format and specified wall or ceiling assembly.'),
]
for kind,name,brand,unit,url,description in manufacturer_refs:
    if ('brand',brand) not in records: add('brand',brand,'Manufacturer reference; purchasing is through the project’s selected supplier.',specificationStatus='reference')
    r=add(kind,name,description,unit,'Boards & substrates' if brand=='EGGER' else 'Ceilings & partitions' if brand=='Knauf' else None)
    assign(r,'brand',[brand]);r['sources']=[{'title':f'{brand} — product reference','url':url,'checkedOn':'2026-09-07'}]
    attributes(r,**{'Product selection':'Family reference; exact order code, stock and price are selected per quotation.'})

# Each entry names the item, unit, measurement basis, material choices, room applicability and specific scope.
work_rows = [
('Base cabinet','Square metre','Front elevation area; drawer accessories scheduled separately','Birch plywood — 18 mm|Birch plywood — 6 mm|Decorative HPL — 1 mm','Kitchen|Pantry','Carcass, adjustable shelves, shutters, edge banding and plinth; worktop and appliances separate'),
('Wall cabinet','Square metre','Front elevation area; depth stated separately','Birch plywood — 18 mm|Birch plywood — 6 mm|Decorative HPL — 1 mm','Kitchen|Pantry','Carcass, shelves, shutters and wall-hanging arrangement; lighting separate'),
('Tall cabinet','Square metre','Front elevation area; height and depth stated separately','Birch plywood — 18 mm|Melamine-faced board — 18 mm|Decorative HPL — 1 mm','Kitchen|Pantry','Full-height carcass, adjustable shelves and shutters; appliance and pull-out fittings scheduled separately'),
('Under-sink cabinet','Square metre','Front elevation area','Birch plywood — 18 mm|Decorative HPL — 1 mm','Kitchen|Utility','Carcass, shutters and protected edges; sink, plumbing and waterproof tray selected separately'),
('Kitchen island','Each','One island with drawing-defined length, width and height','Birch plywood — 18 mm|Decorative HPL — 1 mm|Quartz worktop — 20 mm','Kitchen','Island cabinetry with fronts and end panels; worktop, services and appliances itemized in the quotation'),
('Breakfast counter','Each','One counter with drawing-defined dimensions','Birch plywood — 18 mm|Natural oak veneer|Solid-surface worktop — 12 mm','Kitchen|Dining room','Counter structure and finished visible faces; seating and services separate'),
('Countertop','Square metre','Finished horizontal plan area; edges and cutouts stated separately','Quartz worktop — 20 mm|Sintered-stone worktop — 12 mm|Solid-surface worktop — 12 mm','Kitchen|Bathroom|Utility','Fabricated surface, joint layout, edge detail and installation; sink and tap supply separate'),
('Backsplash','Square metre','Net finished wall area','Porcelain wall tile — 600 × 1200 mm|Quartz worktop — 20 mm|Back-painted glass','Kitchen|Pantry','Prepared wall finish with joint and edge details; sockets and service alterations separate'),
('Hinged wardrobe','Square metre','Front elevation area; internal layout and depth stated separately','Birch plywood — 18 mm|Melamine-faced board — 18 mm|Decorative HPL — 1 mm','Primary bedroom|Bedroom|Guest bedroom|Dressing room','Carcass, hinged shutters, shelves and hanging compartments; internal accessories selected per bay'),
('Sliding wardrobe','Square metre','Front elevation area; track and door system specified separately','Birch plywood — 18 mm|Melamine-faced board — 18 mm|Decorative HPL — 1 mm','Primary bedroom|Bedroom|Dressing room','Carcass, shelves and sliding panels; coordinated track, door weight and clear opening'),
('Wardrobe','Square foot','Front elevation area; depth and internal arrangement separately defined','Birch plywood — 18 mm|Melamine-faced board — 18 mm|Decorative HPL — 1 mm','Primary bedroom|Bedroom|Dressing room','Select hinged or sliding construction and record the internal bay arrangement and fittings'),
('Walk-in wardrobe','Each','One scheduled wardrobe arrangement with measured elevations','Melamine-faced board — 18 mm|Birch plywood — 18 mm|Natural walnut veneer','Dressing room|Primary bedroom','Open storage bays, drawers, shelves and hanging sections; doors and lighting scheduled separately'),
('Loft storage','Square metre','Front elevation area','Birch plywood — 18 mm|Decorative HPL — 1 mm','Bedroom|Utility|Store room','Overhead carcass, shutters and fixing; load and access requirements defined on drawings'),
('Dressing unit','Each','One unit with measured drawing','Birch plywood — 18 mm|Natural oak veneer|Silvered mirror — 6 mm','Dressing room|Primary bedroom','Counter, storage and mirror arrangement; lighting and loose seating separate'),
('Vanity cabinet','Each','One vanity cabinet with drawing-defined dimensions','Birch plywood — 18 mm|Moisture-resistant MDF — 18 mm|Decorative HPL — 1 mm','Bathroom|Powder room','Cabinet, drawers or shutters and protected edges; basin, top, mixer and plumbing separate'),
('TV unit','Each','One media unit with measured drawing','Birch plywood — 18 mm|Decorative HPL — 1 mm|Natural walnut veneer','Living room|Family room','Storage, shelves and cable access; electronics, electrical points and lighting separate'),
('Media wall','Square metre','Finished wall elevation area','Interior MDF — 12 mm|Natural oak veneer|PET acoustic felt panel','Living room|Family room','Panel layout, subframe and service access; AV equipment and electrical works separate'),
('Wall panelling','Square metre','Net finished wall elevation area','Interior MDF — 12 mm|Natural oak veneer|Decorative HPL — 1 mm','Living room|Bedroom|Reception','Subframe, panel finish, trims and access-panel locations; hidden services separate'),
('Headboard','Each','One bed-head assembly with measured drawing','Birch plywood — 18 mm|Upholstery fabric|PU foam','Primary bedroom|Bedroom|Hotel guest room','Headboard substrate, padding and fabric or panel finish; bed base and services separate'),
('Study desk','Each','One desk with scheduled dimensions','Birch plywood — 18 mm|Decorative HPL — 1 mm|Natural oak veneer','Study|Home office|Children’s bedroom','Desktop, supports and scheduled drawers; chair, sockets and accessories separate'),
('Reception desk','Each','One reception counter with measured drawing','Birch plywood — 18 mm|Decorative HPL — 1 mm|Solid-surface worktop — 12 mm','Reception','Counter, storage, front finish and service openings; signage and electrical fittings separate'),
('Meeting table','Each','One table with scheduled dimensions and seating capacity','Birch plywood — 18 mm|Natural oak veneer|Decorative HPL — 1 mm','Meeting room|Conference room','Top, base and coordinated cable openings; power modules and chairs separate'),
('Office partition','Square metre','Partition elevation area; door openings stated separately','Gypsum plasterboard — 12.5 mm|Mineral-wool acoustic infill|Clear toughened glass — 10 mm','Open office|Private office|Meeting room','Specified partition assembly, framing and joints; door sets and services itemized separately'),
('Shower partition','Each','One screen or enclosure with surveyed dimensions','Clear toughened glass — 10 mm|Silicone sealant','Bathroom','Glass, coordinated fittings, seals and installation; waterproofing and shower fixtures separate'),
('Mirror installation','Square metre','Finished mirror face area','Silvered mirror — 6 mm|Silicone sealant','Bathroom|Dressing room|Reception','Mirror cutting, edge finish and compatible fixing; lighting and backing support where specified'),
]
# Shared scope families still keep each item as its own record and selection.
for name in ['Shoe cabinet','Foyer console','Bookcase','Crockery unit','Bar unit','Display cabinet','Storage credenza','Utility cabinet','Laundry counter','Pooja unit','Retail display','Cash counter','Trial room fitting']:
    rooms={'Shoe cabinet':'Foyer','Foyer console':'Foyer','Bookcase':'Living room|Study','Crockery unit':'Dining room','Bar unit':'Dining room|Living room','Display cabinet':'Living room|Display area','Storage credenza':'Private office|Meeting room','Utility cabinet':'Utility','Laundry counter':'Utility','Pooja unit':'Pooja room','Retail display':'Retail sales floor|Display area','Cash counter':'Retail sales floor','Trial room fitting':'Trial room'}[name]
    work_rows.append((name,'Each','One scheduled unit with measured dimensions','Birch plywood — 18 mm|Decorative HPL — 1 mm|Natural oak veneer',rooms,f'{name} carcass, visible finish, shelves or drawers and fixing; specialist accessories and services scheduled separately'))
site_rows = [
('Floor tiling','Square metre','Net finished floor area','Porcelain floor tile — 600 × 600 mm|Tile adhesive|Cementitious grout','Floor layout, adhesive, grouting and edge details; substrate repairs and waterproofing separate'),
('Wall tiling','Square metre','Net finished wall area','Porcelain wall tile — 600 × 1200 mm|Tile adhesive|Cementitious grout','Tile layout, adhesive, grout and corner trims; substrate repairs and waterproofing separate'),
('Wood flooring installation','Square metre','Net finished floor area','Engineered oak flooring|Floor underlay','Flooring layout, installation and transitions; moisture remediation and skirting separately scheduled'),
('False ceiling','Square metre','Horizontal plan area; bulkheads measured separately','Gypsum plasterboard — 12.5 mm|Ceiling grid','Specified framing, boards, joints and access hatches; paint, lights and MEP services separate'),
('Painting','Square metre','Actual decorated surface area','Interior acrylic emulsion — matt|Primer|Wall putty','Surface preparation, primer and specified finish coats; major substrate repairs separate'),
('Wallpaper installation','Square metre','Net finished wall area','Wallpaper|Contact adhesive','Approved wallcovering, compatible adhesive, joint layout and trimming; substrate repair separate'),
('Waterproofing','Square metre','Treated floor and wall-return area','Liquid membrane|Waterproofing tape','Compatible primer, membrane, corners and penetrations; application and testing to specified system'),
('Acoustic treatment','Square metre','Installed acoustic surface area','PET acoustic felt panel|Mineral-wool acoustic infill','Acoustic panels and specified support assembly; performance claims require project-specific evidence'),
('Floor levelling','Square metre','Treated floor area with average thickness stated','Screed','Substrate preparation, leveling compound and required finish level; structural repairs separate'),
('Masonry','Square metre','Wall elevation area with thickness stated','AAC block|Cement|Sand','Blocks, mortar and specified ties; openings, lintels and structural works separately scheduled'),
('Plastering','Square metre','Actual plastered surface area','Ready-mix plaster|Gypsum plaster','Prepared substrate and specified plaster thickness; paint and major remedial work separate'),
('Electrical wiring','Metre','Installed circuit cable length by conductor size','Copper wire|Conduit|Junction box','Defined wiring route, conduit and termination; point accessories and distribution equipment separate'),
('Switch point','Point','One scheduled switch point','Switch|Junction box|Copper wire','Switch module, plate, box and connection to scheduled wiring circuit'),
('Light point','Point','One scheduled lighting point','Recessed LED downlight|LED driver|Copper wire','Luminaire, compatible driver and connection as scheduled; ceiling and circuit alterations separate'),
('Plumbing rough-in','Metre','Installed pipe length by size and service','PPR pipe|uPVC pipe|Pipe fitting','Pipework, fittings, supports and testing; fixtures, drainage penetrations and builder works separately stated'),
('Door installation','Each','One complete scheduled door set','Flush door|Door frame|Door seal','Frame, leaf alignment and scheduled ironmongery; finishes and fire-rated assembly requirements explicitly specified'),
('Window installation','Each','One surveyed window opening','Aluminium window|Window glazing|Silicone sealant','Frame, glazing, fixing and perimeter sealing; structural opening alterations separate'),
('Curtain installation','Window','One surveyed window treatment','Blackout curtain fabric|Sheer curtain fabric|Curtain track','Measured fabric, track, heading and installation; motor and electrical supply separately selected'),
('Data cabling','Metre','Installed cable-run length by specification','Data outlet|Conduit','Cable installation, outlets and identification; testing scope and active network equipment separately scheduled'),
('Polishing','Square metre','Actual timber surface area','Wood stain|Polyurethane clear coat — matt','Surface preparation, approved stain sample and coating system; timber repairs separately scheduled'),
('Final cleaning','Square metre','Cleaned floor area with included surfaces defined','Floor/Surface Protection Sheet','Post-work cleaning of agreed surfaces and waste segregation; specialist cleaning and external access separate'),
('Debris removal','Vehicle','One agreed vehicle load with capacity stated','Floor/Surface Protection Sheet','Waste collection, loading and disposal to an approved facility; permits and access constraints stated'),
('Demolition','Square metre','Measured affected surface with construction type stated','Floor/Surface Protection Sheet','Controlled removal, protection and segregation; structural demolition, hazardous materials and live-service isolation separately assessed'),
('Decking','Square metre','Finished horizontal deck area','Decking board|Stainless steel section','Deck boards, supports and fixings to approved detail; ground preparation and drainage separate'),
('Pergola','Each','One drawing-defined pergola','Mild steel section|Decking board','Structure, specified finish and fixings; foundations, permits and lighting separately scheduled'),
('Planter installation','Each','One scheduled planter','Planter|Waterproofing tape','Planter positioning, protection and drainage interface; planting and irrigation separately selected'),
]
# Labor and clearance scopes do not need an artificial default material.
for i,row in enumerate(site_rows):
    if row[3]=='Floor/Surface Protection Sheet': site_rows[i]=(*row[:3],'',row[4])
for name,unit,basis,mats,note in site_rows:
    work_rows.append((name,unit,basis,mats,'Common area',note))
remaining={
'HVAC installation':('Lot','One defined HVAC system or zone','Ducted AC|Ductwork|Air diffuser','Equipment schedule, ductwork and commissioning; electrical and builder interfaces clearly defined'),
'Fire system installation':('Lot','One engineered fire-system scope','Smoke detector|Sprinkler|Fire extinguisher','Specialist-designed devices and interfaces; authority requirements, testing and certification stated by the specialist'),
'Smart home installation':('Lot','One defined automation package','Smart relay|Motion sensor|Thermostat','Device schedule, control interfaces and commissioning; network, subscriptions and electrical works separately defined'),
'Joinery installation':('Each','One scheduled cabinet or furniture assembly','Fastener|Silicone sealant','Setting out, positioning, leveling, fixing and adjustment; supply and major site modifications separate'),
'Hardware installation':('Each','One scheduled hardware fitting or set','Fastener|Handle','Fitting, adjustment and operation check; exact hardware and compatibility approved before work'),
'Bathroom accessory installation':('Each','One scheduled accessory','Fastener|Silicone sealant','Set-out, drilling and fixing to suitable backing; accessory supply and concealed-service checks stated'),
'Workstation installation':('Each','One scheduled workstation','Workstation|Fastener','Assembly, positioning and adjustment; power/data connections and chairs separate'),
'Jaali screen':('Square metre','Finished screen elevation area','Interior MDF — 12 mm|Natural oak veneer','Drawing-defined perforated screen and support; pattern, fixing and finish sample approved before fabrication'),
}
for name,(unit,basis,mats,note) in remaining.items():work_rows.append((name,unit,basis,mats,'Common area',note))
new_works=[
('Kitchen drawer base cabinet','Each','One cabinet with scheduled drawer arrangement','Birch plywood — 18 mm|Decorative HPL — 1 mm','Kitchen|Pantry','Carcass and drawer fronts; drawer-system model, internal sizes and fittings selected separately'),
('Built-in bench seating','Metre','Finished seating run; depth and height stated','Birch plywood — 18 mm|Upholstery fabric|PU foam','Dining room|Breakout area|Restaurant dining','Bench structure and cushion arrangement; fabric, storage and loose furniture scheduled separately'),
('Bedside cabinet','Each','One cabinet with scheduled dimensions','Birch plywood — 18 mm|Natural walnut veneer','Primary bedroom|Bedroom|Hotel guest room','Cabinet carcass, drawer or shelf and visible finish; integrated power and lighting separate'),
('Floating vanity shelf','Metre','Finished shelf run with depth stated','Birch plywood — 18 mm|Solid-surface worktop — 12 mm','Bathroom|Powder room','Shelf, support and water-exposed edge detailing; basin and plumbing separate'),
('Linear LED cabinet lighting','Metre','Installed illuminated length','LED strip — warm white|LED profile|LED driver','Kitchen|Dressing room|Living room','Strip, diffuser profile, driver and access; mains wiring and controls separately coordinated'),
('Carpet-tile installation','Square metre','Net finished floor area','Loop-pile carpet tile|Contact adhesive','Open office|Meeting room|Conference room','Tile layout, compatible adhesive and transitions; substrate moisture and repairs assessed separately'),
('SPC flooring installation','Square metre','Net finished floor area','SPC click flooring|Floor underlay','Bedroom|Living room|Private office','Flooring, specified underlay and transitions; subfloor repairs and skirting separately measured'),
('Feature-wall veneer finish','Square metre','Net finished panel area','Natural oak veneer|Natural walnut veneer|Interior MDF — 12 mm','Living room|Reception|Private office','Veneer sequence, substrate, joints and approved coating sample; lighting and services separate'),
('Glass office partition','Square metre','Finished glazed elevation excluding scheduled doors','Clear toughened glass — 10 mm|Aluminium profile|Silicone sealant','Open office|Meeting room|Private office','Engineered glass, channels, seals and installation; doors and performance criteria separately defined'),
('Interior skirting','Metre','Installed skirting run','Tile skirting|Oak timber|Interior MDF — 12 mm','Common area|Living room|Bedroom','Cutting, fixing, corners and finished junctions; height and finish stated on schedule'),
('Ceiling access panel','Each','One complete opening and access panel','Gypsum plasterboard — 12.5 mm|Aluminium profile','Common area|Bathroom|Kitchen','Framed opening and operable panel; size, finish and assembly compatibility coordinated'),
('Vanity mirror with lighting','Each','One scheduled mirror assembly','Silvered mirror — 6 mm|LED strip — warm white|LED driver','Bathroom|Powder room','Mirror and accessible lighting arrangement; electrical supply and suitable wet-area components separately specified'),
]
work_rows.extend(new_works)
records_by_id={r['id']:r for r in records.values()}
for name,unit,basis,materials,rooms,note in work_rows:
    r=get('work',name) if ('work',name) in records else add('work',name,note,unit)
    r.update(description=note+'.',market='GLOBAL')
    if r['id'] not in original: assign(r,'unit',[unit])
    else:
        current_unit=next((records_by_id[l['targetId']]['name'] for l in r['links'] if l['relation']=='unit'),unit)
        if current_unit!=unit: basis=f'Priced per {current_unit.lower()}; define the included {name.lower()} scope and record its measured dimensions separately.'
    assign(r,'material',materials.split('|') if materials else [])
    if rooms!='Common area' or not any(l['relation']=='room' for l in r['links']):assign(r,'room',rooms.split('|'))
    if not any(l['relation']=='execution' for l in r['links']):assign(r,'execution',['On-site'] if name in [x[0] for x in site_rows] or name.endswith('installation') or name in ['Linear LED cabinet lighting','Glass office partition','Interior skirting','Ceiling access panel'] else ['Factory','On-site','Hybrid'])
    attributes(r,**{'Measurement basis':basis,'Before quotation':'Confirm dimensions, material/finish selection, inclusions and supplier rate.','Scope boundary':note})
    # Link the existing construction recipe rather than make a parallel unconnected item recipe.
    recipes=[x for x in records.values() if x['kind']=='construction' and any(l['relation']=='work' and l['targetId']==r['id'] for l in x['links'])]
    if recipes and not any(l['relation']=='construction' for l in r['links']):assign(r,'construction',[recipes[0]['name']])

variant_rows=[
('Hinged wardrobe','Hinged wardrobe — Blum CLIP top BLUMOTION','Blum CLIP top BLUMOTION hinge|Wardrobe rail with end supports'),
('Hinged wardrobe','Hinged wardrobe — soft-close','Soft-close cabinet hinge set|Wardrobe rail with end supports|Adjustable shelf-support set'),
('Hinged wardrobe','Hinged wardrobe — handleless','Push-to-open cabinet fitting|Wardrobe rail with end supports'),
('Sliding wardrobe','Sliding wardrobe — two-door system','Wardrobe sliding-door track set|Wardrobe rail with end supports'),
('Base cabinet','Base cabinet — hinged shutters','Soft-close cabinet hinge set|Cabinet pull handle'),
('Base cabinet','Base cabinet — drawer storage','Metal-sided drawer system|Kitchen cutlery insert'),
('Base cabinet','Base cabinet — waste-bin pull-out','Kitchen pull-out waste-bin unit'),
('Wall cabinet','Wall cabinet — hinged shutters','Soft-close cabinet hinge set|Cabinet pull handle'),
('Tall cabinet','Tall cabinet — internal drawers','Metal-sided drawer system|Soft-close cabinet hinge set'),
('Vanity cabinet','Vanity cabinet — drawer storage','Full-extension soft-close drawer runner pair|Cabinet pull handle'),
('Vanity cabinet','Vanity cabinet — hinged shutters','Soft-close cabinet hinge set|Cabinet pull handle'),
('Study desk','Study desk — integrated drawer','Full-extension soft-close drawer runner pair|Countertop cable grommet'),
('TV unit','TV unit — handleless fronts','Push-to-open cabinet fitting|Cabinet ventilation grille'),
('Reception desk','Reception desk — cable management','Countertop cable grommet|Cabinet ventilation grille'),
('Kitchen drawer base cabinet','Kitchen drawers — Blum hinge coordination','Blum CLIP top BLUMOTION hinge'),
('Kitchen drawer base cabinet','Kitchen drawers — Hettich AvanTech YOU','Hettich AvanTech YOU drawer system'),
('Bedside cabinet','Bedside cabinet — soft-close drawer','Full-extension soft-close drawer runner pair|Cabinet pull handle'),
]
# A drawer cabinet should not offer a hinge-only configuration.
variant_rows=[r for r in variant_rows if r[1]!='Kitchen drawers — Blum hinge coordination']
for work,name,hardware in variant_rows:
    r=add('variant',name,f'{work} arrangement using the selected hardware. Match fitting size, capacity and clearance to the approved item drawing.')
    assign(r,'work',[work]);assign(r,'hardware',hardware.split('|'));assign(r,'execution',['Factory','On-site','Hybrid'])

# Improve room applicability and services without changing any product reference IDs.
for r in records.values():
    if r['kind']=='room':
        applicable=[w['name'] for w in records.values() if w['kind']=='work' and any(l['relation']=='room' and l['targetId']==r['id'] for l in w['links'])]
        if applicable:
            r['description']=f"Reusable {r['name'].lower()} room type. Typical scope: {', '.join(applicable[:8]).lower()}. Name each actual room and capture its measurements in the project."
            r['market']='GLOBAL'
    if r['kind']=='service':
        attributes(r,**{'Deliverable':r['name'],'Scope definition':'State the drawings, reports, visits or hours included, review rounds and acceptance criteria.','Commercial basis':'Confirm the supplier or team rate and agreed unit before quotation.'})
        r['market']='GLOBAL'
# Ensure every prepared relationship is local, active and represented by the correct type.
all_ids={r['id']:r for r in records.values()}
for r in records.values():
    assert len(r['links'])<=100
    seen=set()
    for l in r['links']:
        key=(l['relation'],l['targetId']);assert key not in seen;seen.add(key)
        target=all_ids[l['targetId']]
        assert target['catalogId']==CATALOG
        assert l['relation'] in ['related','parent'] or target['kind']==l['relation']
additions=[r for r in records.values() if r['id'] not in original]
updates=[r for r in records.values() if r['id'] in original and r!=original[r['id']]]
# Preserve published pricing, project snapshots and any manually authored records outside this catalog.
plan={'catalogId':CATALOG,'name':'Interior design & fit-out','additions':additions,'updates':updates,'originals':[original[r['id']] for r in updates]}
Path(sys.argv[2]).write_text(json.dumps(plan,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'newRecords':len(additions),'updatedRecords':len(updates),'newByType':{k:sum(r['kind']==k for r in additions) for k in sorted({r['kind'] for r in additions})},'workItemsWithMaterials':sum(r['kind']=='work' and any(l['relation']=='material' for l in r['links']) for r in records.values())}))
