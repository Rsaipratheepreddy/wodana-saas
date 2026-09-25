import type {ImportVendorRowDto} from './vendor.dto';
const normal=(s:string)=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
type Existing={id:string;displayName:string;code:string;status:string};
export type SupplierImportReview={rows:{sourceRow:number;name:string;status:'new'|'existing'|'error';detail:string}[];newCount:number;skipped:number};
export function reviewSupplierImport(rows:ImportVendorRowDto[],existing:Existing[],contacts:{vendorId:string;email:string}[]):SupplierImportReview {
 const names=new Set<string>(),codes=new Set<string>(),emails=new Set<string>(),ids=new Set<string>(),siteIds=new Set<string>();
 const review:SupplierImportReview={rows:[],newCount:0,skipped:0};
 for(const row of rows){
  const name=normal(row.displayName),code=row.code?.toUpperCase()??'',email=normal(row.email??'');
  let status:'new'|'existing'|'error'='new',detail='Create draft supplier';
  if(ids.has(row.id)||siteIds.has(row.siteId)||names.has(name)||(code&&codes.has(code))||(email&&emails.has(email))){status='error';detail='Duplicate supplier name, code or email in this file.';}
  else {
   const contactIds=new Set(contacts.filter(c=>email&&normal(c.email)===email).map(c=>c.vendorId));
   const matches=existing.filter(s=>s.id===row.id||normal(s.displayName)===name||(code&&s.code===code)||contactIds.has(s.id));
   if(matches.length>1){status='error';detail='Matches multiple existing suppliers. Check the name, code and email.';}
   else if(matches.length===1){const match=matches[0];if(normal(match.displayName)!==name||(code&&match.code!==code)){status='error';detail=`Code or email belongs to ${match.displayName}. Existing supplier will not be changed.`;}else {status='existing';detail=`Already exists (${match.status}). Keep existing supplier.`;}}
  }
  ids.add(row.id);siteIds.add(row.siteId);names.add(name);if(code)codes.add(code);if(email)emails.add(email);
  review.rows.push({sourceRow:row.sourceRow,name:row.displayName,status,detail});if(status==='new')review.newCount++;if(status==='existing')review.skipped++;
 }
 return review;
}
