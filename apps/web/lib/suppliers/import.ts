export type SupplierImportRow={id:string;siteId:string;version:0;sourceRow:number;displayName:string;capabilities:string[];code?:string;contactName?:string;email?:string;phone?:string;notes:string};
export type SupplierImportReview={rows:{sourceRow:number;name:string;status:'new'|'existing'|'error';detail:string}[];newCount:number;skipped:number;created?:number};
const keys:Record<string,string>={suppliername:'displayName',name:'displayName',company:'displayName',companyname:'displayName',supplies:'capabilities',capabilities:'capabilities',category:'capabilities',contactperson:'contactName',contactname:'contactName',whatsappphone:'phone',whatsapp:'phone',phone:'phone',mobile:'phone',email:'email',emailaddress:'email',suppliercode:'code',code:'code',notes:'notes'};
const caps=new Set(['materials','services','subcontracting','manufacturing','logistics','other']);
export function parseSupplierImport(table:string[][],newId=()=>crypto.randomUUID()) {
 const header=table[0]??[];
 const mapping=header.map(s=>keys[s.toLowerCase().replace(/[^a-z]/g,'')]??'');
 if(!mapping.includes('displayName'))throw new Error('Row 1 must contain a Supplier name column. Download the sample Excel for the supported columns.');
 if(mapping.filter(Boolean).length!==new Set(mapping.filter(Boolean)).size)throw new Error('Two columns map to the same supplier field. Keep one column per field.');
 const unknown=header.filter((s,i)=>s.trim()&&!mapping[i]);if(unknown.length)throw new Error(`Unsupported columns: ${unknown.join(', ')}. Use the sample Excel headings.`);
 const source=table.slice(1).map((cells,i)=>({cells,sourceRow:i+2})).filter(r=>r.cells.some(c=>c.trim()));
 if(!source.length)throw new Error('This worksheet has no supplier rows.');if(source.length>500)throw new Error('Import up to 500 suppliers at a time.');
 const records:SupplierImportRow[]=[],errors:SupplierImportReview['rows']=[];
 for(const {cells,sourceRow} of source){
  const v=(key:string)=>String(cells[mapping.indexOf(key)]??'').trim();
  const name=v('displayName'),code=v('code').toUpperCase(),email=v('email').toLowerCase(),phone=v('phone').replace(/[\s()-]/g,''),capabilities=[...new Set(v('capabilities').toLowerCase().split(/[;,]/).map(s=>s.trim()).filter(Boolean))];
  const issues:string[]=[];
  if(!name||name.length>240)issues.push('Supplier name is required (maximum 240 characters).');
  if(!capabilities.length||capabilities.some(c=>!caps.has(c)))issues.push('Supplies: use materials, services, subcontracting, manufacturing, logistics or other.');
  if(email&&(email.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))issues.push('Enter a valid email.');
  if(phone&&!/^\+[1-9]\d{7,14}$/.test(phone))issues.push('Phone must include + and country code. Format the Excel cell as Text.');
  if(code&&!/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(code))issues.push('Supplier code: letters, numbers, hyphens or underscores only (maximum 80).');
  if(v('contactName').length>180)issues.push('Contact person is too long (maximum 180).');
  if(v('notes').length>10000)issues.push('Notes are too long (maximum 10,000).');
  if(cells.some((cell,i)=>cell.trim()&&!mapping[i]))issues.push('A value has no supported column heading.');
  if(issues.length)errors.push({sourceRow,name:name||'Unnamed supplier',status:'error',detail:issues.join(' ')});
  records.push({id:newId(),siteId:newId(),version:0,sourceRow,displayName:name,capabilities,...(code?{code}:{}),...(email?{email}:{}),...(phone?{phone}:{}),...(v('contactName')?{contactName:v('contactName')}:{}),notes:v('notes')});
 }
 return {records,errors};
}
