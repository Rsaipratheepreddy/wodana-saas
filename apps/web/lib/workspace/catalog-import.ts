import { blankCatalogRecord, catalogStructure, type CatalogKind, type CatalogRecord } from './catalog';
import { recordCode, withRecordGroup } from './catalog-navigation';
import { priceableKinds } from './catalog-prices';

export type ImportTable = {name:string; rows:string[][]};
export type ImportField = {key:string;label:string};
export type ImportReviewRow = {sourceRow:number;name:string;type:string;status:'new'|'existing'|'error';detail:string};
export type ImportPlan = {records:CatalogRecord[];references:{id:string;version:number}[];rows:ImportReviewRow[];errors:string[];skipped:number};
export type ImportOptions = {catalogId:string;kind:CatalogKind;groupId:string;createReferences:boolean;priceDefaults:Record<string,string>};
const normal = (value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g,' ');
const headerKey = (value:string)=>normal(value).replace(/[^a-z0-9]/g,'');
const referenceKinds = new Set<CatalogKind>(['brand','finish','room','category']);
const sizeFields=['label','lengthMm','widthMm','thicknessMm','diameterMm','packQuantity','packUnit'] as const;

export function importFields(kind:CatalogKind):ImportField[] {
 const fields:ImportField[]=[{key:'name',label:'Name'},{key:'code',label:'Code / existing identifier'},{key:'description',label:'Description'},{key:'group',label:'Group name'},{key:'aliases',label:'Aliases (separate with ;)'}];
 for(const link of catalogStructure[kind].links.filter(l=>l.relation!=='record_group'))fields.push({key:`link:${link.relation}`,label:link.label});
 for(const field of catalogStructure[kind].fields)fields.push({key:`config:${field.key}`,label:field.label});
 if(kind==='unit')fields.push({key:'dimension',label:'Measurement type'},{key:'baseFactor',label:'Conversion factor to base unit'});
 if(['material','sku'].includes(kind))for(const key of sizeFields)fields.push({key:`size:${key}`,label:key==='label'?'Size label':key.replace('Mm',' (mm)').replace(/([A-Z])/g,' $1')});
 if(priceableKinds.includes(kind)) {
  for(const field of catalogStructure.rate_card.fields)fields.push({key:`price:${field.key}`,label:field.key==='amount'?'Price / unit':`Price · ${field.label}`});
  fields.push({key:'price:unit',label:'Price unit (if different)'});
 }
 return fields;
}
const aliases:Record<string,string[]>={name:['name','recordname','productname','materialname','itemname','roomname','brandname','finishname','processname','unitname','rulename'],code:['code','id','recordid','materialid','itemid','roomid','processid','unitid','sku','productcode'],group:['group','groupname','cataloggroup'],description:['description','notes','remarks'], 'link:unit':['unit','uom','unitofmeasure','measurementunit'], 'link:brand':['brand','brandname','brandid'], 'link:finish':['finish','finishname','finishid'], 'link:material':['material','materialid'], 'link:work':['item','itemid','parentitem'], 'link:execution':['execution','executiontype','executionroute'], 'link:parent':['parent','parentcode','parentname'], 'price:amount':['price','rate','unitprice','priceperunit','amount','cost'], 'price:currency':['currency'], 'price:supplier':['supplier','vendor'], 'price:unit':['priceunit','rateunit'], dimension:['dimension','measurementtype'],baseFactor:['basefactor','conversionfactor','factortobaseunit']};
export function suggestImportMapping(headers:string[],kind:CatalogKind):string[] {
 const fields=importFields(kind),used=new Set<string>();
 // Prefer the selected record's own identity, even when supplier/room columns
 // precede it. A material's brand_name must never become its product name.
 const identityNames:Partial<Record<CatalogKind,string[]>>={
  brand:['brandname'],room:['roomname'],unit:['unitname'],work:['itemname','elementname'],
  material:['representativename','materialname','productname'],sku:['productname','materialname'],
  hardware:['productname','hardwarename'],consumable:['productname','consumablename'],finish:['finishname'],
 };
 const identityCodes:Partial<Record<CatalogKind,string[]>>={
  brand:['brandid'],room:['roomid'],unit:['unitid'],work:['itemid','elementid'],material:['masterid','materialid'],
  sku:['skuid','boardid','laminateid','veneerid','paintid','tileid','sanitaryid','lightid','applianceid','fabricid','fcid','flooringid','pipeid','electricalid'],
  hardware:['hardwareid','accessoryid'],consumable:['consumableid','adhesiveid'],finish:['finishid'],
 };
 const headerKeys=headers.map(headerKey);
 const preferred=(candidates:string[])=>candidates.map(key=>headerKeys.indexOf(key)).find(index=>index>=0);
 const nameColumn=preferred(['name','recordname',...(identityNames[kind]??['productname','itemname','processname','rulename'])]);
 const codeColumn=preferred(['code','recordid','id',...(identityCodes[kind]??[])]);
 return headers.map((header,index)=>{
  if(index===nameColumn){used.add('name');return 'name';}
  if(index===codeColumn){used.add('code');return 'code';}
  const key=headerKey(header);
  const field=fields.find(f=>!['name','code'].includes(f.key)&&!used.has(f.key)&&(headerKey(f.key.replace(/^(config|price|size):/,''))===key||headerKey(f.label)===key||(aliases[f.key]??(f.key==='link:room'?['room','roomname','roomid']:[])).includes(key)));
  if(field){used.add(field.key);return field.key;}
  return `attribute:${index}`;
 });
}
export function guessImportHeader(rows:string[][],kind:CatalogKind):number {
 let best=0,score=-1;
 rows.slice(0,20).forEach((row,index)=>{const mapped=suggestImportMapping(row,kind);const n=mapped.filter(k=>!k.startsWith('attribute:')).length+(mapped.includes('name')?5:0);if(n>score){score=n;best=index;}});
 return best;
}
export function parseDelimitedCatalog(text:string):string[][] {
 const input=text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
 if(input.length>2_000_000)throw new Error('Use a file or paste smaller than 2 MB.');
 const firstLine=input.split('\n')[0];const delimiter=firstLine.includes('\t')?'\t':',';
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<input.length;i++){
  const ch=input[i];
  if(ch==='"'&&(quoted||!cell)){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&(ch===delimiter||ch==='\n')){row.push(cell);cell='';if(ch==='\n'){rows.push(row);row=[];}}
  else cell+=ch;
  if(rows.length>5000||row.length>100||cell.length>10000)throw new Error('Use at most 5,000 source rows, 100 columns and 10,000 characters per cell.');
 }
 if(quoted)throw new Error('A quoted cell is unfinished. Check the CSV or paste again.');
 if(cell||row.length)rows.push([...row,cell]);
 return rows;
}
function numeric(value:string,label:string):number {
 if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())||!Number.isFinite(Number(value)))throw new Error(`${label}: enter a number without currency symbols or separators.`);
 return Number(value);
}

export function prepareCatalogImport(table:ImportTable,header:number,mapping:string[],items:CatalogRecord[],options:ImportOptions):ImportPlan {
 const headers=table.rows[header]??[];const plan:ImportPlan={records:[],references:[],rows:[],errors:[],skipped:0};
 const active=items.filter(r=>r.catalogId===options.catalogId);
 const fields=importFields(options.kind);const allowed=new Set(fields.map(f=>f.key));
 if(!mapping.includes('name'))plan.errors.push('Match a column to Name.');
 const mapped=mapping.filter(k=>k&&!k.startsWith('attribute:'));
 if(new Set(mapped).size!==mapped.length)plan.errors.push('Each destination field can be matched only once.');
 if(mapped.some(k=>!allowed.has(k)))plan.errors.push('The selected columns do not match this record type.');
 const source=table.rows.slice(header+1).map((cells,i)=>({cells,number:header+i+2})).filter(r=>r.cells.some(c=>c.trim()));
 if(!source.length)plan.errors.push('There are no data rows below the header.');
 if(source.length>500)plan.errors.push('Import up to 500 source rows at a time. Split this worksheet into smaller files.');
 if(plan.errors.length)return plan;
 const value=(cells:string[],key:string)=>String(cells[mapping.indexOf(key)]??'').trim();
 const lookup=(kind:CatalogKind,name:string,pool:CatalogRecord[])=>pool.filter(r=>r.kind===kind&&[r.id,r.code,r.name,...r.aliases].some(v=>normal(v)===normal(name)));
 const newRecord=(kind:CatalogKind,name:string):CatalogRecord=>{const r:CatalogRecord={...blankCatalogRecord(kind),catalogId:options.catalogId,name,configuration:{}};r.code=recordCode(name,r.id).slice(0,65)+'_'+r.id.slice(0,8).toUpperCase();return r;};
 const getGroup=(name:string):string=>{
  if(!name)return options.groupId;
  const matches=lookup('record_group',name,[...active,...plan.records]);
  if(matches.length>1)throw new Error(`Group “${name}” matches more than one record.`);
  if(matches[0]){if(matches[0].archived)throw new Error(`Group “${name}” is archived.`);return matches[0].id;}
  const group=newRecord('record_group',name);group.configuration={defaultKind:options.kind,icon:'folder',sortOrder:1000+plan.records.length};plan.records.push(group);return group.id;
 };
 const staged:Array<{record:CatalogRecord;cells:string[];report:ImportReviewRow;isNew:boolean}>=[];
 const sourceNames=new Set<string>(),sourceCodes=new Set<string>();
 // Create identities first so later rows can refer to earlier or later rows in the sheet.
 for(const {cells,number} of source){
  const report:ImportReviewRow={sourceRow:number,name:value(cells,'name'),type:catalogStructure[options.kind].label,status:'new',detail:'New record'};plan.rows.push(report);
  try {
   if(cells.length>headers.length&&cells.slice(headers.length).some(c=>c.trim()))throw new Error('This row has more values than the header. Add the missing column headings.');
   if(!report.name||report.name.length>180)throw new Error('Name is required and must be 180 characters or fewer.');
   const code=value(cells,'code').toUpperCase();
   if(code&&!/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(code))throw new Error('Code must use letters, numbers, underscores or hyphens (up to 80 characters). Keep another identifier as a specification.');
   if(sourceNames.has(normal(report.name))||(code&&sourceCodes.has(code)))throw new Error('Duplicate name or code in this worksheet. Combine or rename these rows.');
   sourceNames.add(normal(report.name));if(code)sourceCodes.add(code);
   const matches=active.filter(r=>r.kind===options.kind&&(normal(r.name)===normal(report.name)||(code&&r.code===code)));
   if(matches.length>1)throw new Error('Name and code refer to different existing records.');
   if(matches[0]?.archived)throw new Error('This record is archived. Restore it or choose another name/code.');
   if(matches[0]){report.status='existing';report.detail='Existing record kept; incoming changes are not applied';plan.skipped++;staged.push({record:matches[0],cells,report,isNew:false});continue;}
   let record=newRecord(options.kind,report.name);if(code)record.code=code;
   record=withRecordGroup(record,getGroup(value(cells,'group')));
   record.description=value(cells,'description');record.aliases=value(cells,'aliases').split(';').map(s=>s.trim()).filter(Boolean);
   mapping.forEach((key,i)=>{if(key.startsWith('attribute:')&&cells[i]?.trim())record.attributes.push({name:(headers[i]||`Column ${i+1}`).trim(),value:cells[i].trim()});});
   if(record.attributes.length>30||record.attributes.some(a=>a.name.length>80||a.value.length>1000))throw new Error('Keep at most 30 specifications, with headings up to 80 and values up to 1,000 characters.');
   if(options.kind==='unit'){
    record.dimension=value(cells,'dimension').toLowerCase();
    if(!['length','area','volume','mass','count','time','pack'].includes(record.dimension))throw new Error('Units need an explicit measurement type: length, area, volume, mass, count, time or pack.');
    const factor=value(cells,'baseFactor');record.baseFactor=factor?numeric(factor,'Conversion factor'):undefined;
    if(record.dimension==='pack'&&record.baseFactor!==undefined)throw new Error('Packs cannot have a universal conversion factor. Define quantities on the product.');
    if(record.dimension!=='pack'&&!(record.baseFactor!>0))throw new Error('A positive conversion factor is required.');
   }
   for(const field of catalogStructure[options.kind].fields){const v=value(cells,`config:${field.key}`);if(v)record.configuration![field.key]=field.type==='number'?numeric(v,field.label):v;}
   if(['material','sku'].includes(options.kind)&&sizeFields.some(k=>value(cells,`size:${k}`))){
    const size:NonNullable<CatalogRecord['sizes']>[number]={label:value(cells,'size:label')||`${record.name} format`};
    for(const key of sizeFields.filter(k=>k!=='label')){const v=value(cells,`size:${key}`);if(v){if(key==='packUnit')size[key]=v;else size[key]=numeric(v,key);}}
    record.sizes=[size];
   }
   plan.records.push(record);staged.push({record,cells,report,isNew:true});
  }catch(e){report.status='error';report.detail=e instanceof Error?e.message:'Invalid row';}
 }
 const resolve=(relation:string,raw:string,owner:CatalogRecord)=>{
  const kind=(relation==='parent'?owner.kind:relation) as CatalogKind;
  const pool=[...active,...plan.records].filter(r=>relation==='related'?!['record_group','catalog_group'].includes(r.kind):r.kind===kind);
  const matches=pool.filter(r=>[r.id,r.code,r.name,...r.aliases].some(v=>normal(v)===normal(raw)));
  if(matches.length>1)throw new Error(`“${raw}” is ambiguous. Use its exact code.`);
  if(matches[0]?.archived)throw new Error(`“${raw}” is archived.`);
  if(matches[0])return matches[0].id;
  if(options.createReferences&&referenceKinds.has(kind)){
   const ref=withRecordGroup(newRecord(kind,raw),options.groupId);plan.records.push(ref);return ref.id;
  }
  throw new Error(`${relation}: “${raw}” was not found. Import or define this linked record first, or use its existing name/code.`);
 };
 for(const {record,cells,report,isNew} of staged){
  try{
   if(isNew)for(const link of catalogStructure[record.kind].links.filter(l=>l.relation!=='record_group')){
    const v=value(cells,`link:${link.relation}`);if(!v)continue;
    const values=link.multiple?v.split(';').map(s=>s.trim()).filter(Boolean):[v];
    for(const raw of values){const targetId=resolve(link.relation,raw,record);if(targetId===record.id)throw new Error('A record cannot link to itself.');if(!record.links.some(l=>l.relation===link.relation&&l.targetId===targetId))record.links.push({relation:link.relation,targetId});}
   }
   const amount=value(cells,'price:amount');
   if(amount&&priceableKinds.includes(record.kind)){
    const config:Record<string,string|number>={...options.priceDefaults,amount:numeric(amount,'Price')};
    for(const field of catalogStructure.rate_card.fields){const v=value(cells,`price:${field.key}`);if(v)config[field.key]=field.type==='number'?numeric(v,field.label):v;}
    const unitRaw=value(cells,'price:unit')||value(cells,'link:unit');
    const unitId=unitRaw?resolve('unit',unitRaw,record):record.links.find(l=>l.relation==='unit')?.targetId;
    if(!unitId)throw new Error('A price needs a unit. Match Unit or Price unit to an existing unit.');
    if(!config.costIncludes||!config.taxIncluded||!config.effectiveFrom)throw new Error('Complete the price defaults: inclusions, tax treatment and effective date.');
    const price=newRecord('rate_card',`${record.name} · ${config.priceType} · ${config.effectiveFrom}`.slice(0,180));
    price.configuration=config;price.links=[{relation:record.kind,targetId:record.id},{relation:'unit',targetId:unitId},...record.links.filter(l=>l.relation==='record_group')];
    const old=active.find(r=>r.kind==='rate_card'&&normal(r.name)===normal(price.name));
    if(old)throw new Error('A price with this name/date already exists. Review it in Prices before adding another.');
    plan.records.push(price);report.detail+=` · new price ${config.currency} ${config.amount}`;
   }
  }catch(e){report.status='error';report.detail=e instanceof Error?e.message:'Invalid connection';}
 }
 for(const row of plan.rows.filter(r=>r.status==='error'))plan.errors.push(`Row ${row.sourceRow}: ${row.detail}`);
 for(const record of plan.records.filter(r=>!staged.some(s=>s.record.id===r.id)))plan.rows.push({sourceRow:0,name:record.name,type:catalogStructure[record.kind].label,status:'new',detail:record.kind==='rate_card'?'Linked price':'New group or linked reference'});
 if(plan.records.length>500)plan.errors.push('This import creates more than 500 records including groups, references and prices. Split it into smaller files.');
 const createdIds=new Set(plan.records.map(r=>r.id));
 const dependencyIds=new Set(plan.records.flatMap(r=>r.links.map(l=>l.targetId)).filter(id=>!createdIds.has(id)));
 plan.references=items.filter(r=>dependencyIds.has(r.id)).map(r=>({id:r.id,version:r.version}));
 return plan;
}
