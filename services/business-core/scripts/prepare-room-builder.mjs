// Read-only preparation: compare every source cell before producing a tenant-scoped plan.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const [sourcePath,workbookJsonPath,workspaceId,outputPath]=process.argv.slice(2);
if(!outputPath||!/^[-0-9a-f]{36}$/i.test(workspaceId))throw Error('Usage: node prepare-room-builder.mjs mapped-source.json workbook.json workspace-id output.json');
const source=JSON.parse(fs.readFileSync(sourcePath)),workbook=JSON.parse(fs.readFileSync(workbookJsonPath));
const attr=(r,n)=>r.attributes.find(a=>a.name===n)?.value;
const errors=[];let accounted=0;const sheets={};
const text=value=>value==null?'':String(value);
for(const [sheet,grid]of Object.entries(workbook)){
 if(sheet==='00_Index')continue;
 const [headers,...rows]=grid;sheets[sheet]=rows.length;
 for(const [index,cells]of rows.entries()){
  const matches=source.filter(r=>attr(r,'Source worksheet')===sheet&&attr(r,'Source row')===String(index+2));
  if(matches.length!==1){errors.push(`${sheet}:${index+2}: expected one source row`);continue;}
  for(const [col,header]of headers.entries())if(text(cells[col])!==text(attr(matches[0],header)))errors.push(`${sheet}:${index+2}:${header}: source value differs`);
  accounted++;
 }
}
if(errors.length||accounted!==7392)throw Error(JSON.stringify({errors,accounted}));
const uid=key=>{const bytes=createHash('sha256').update(`room-builder-v1:${workspaceId}:${key}`).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const ids=new Map(source.map(r=>[r.id,uid(r.id)])),original=source.find(r=>r.kind==='catalog_group'),catalogId=ids.get(original.id);
const records=source.filter(r=>r.kind!=='catalog_group').map(({workspaceId:_w,archived:_a,starterVersion:_s,updatedAt:_u,...r})=>({...r,id:ids.get(r.id),catalogId,version:0,links:r.links.map(l=>({...l,targetId:ids.get(l.targetId)}))}));
for(const record of records){
 if(record.links.some(l=>!l.targetId))throw Error('Missing mapped dependency');
 if(record.kind==='material'&&!attr(record,'Source worksheet')&&!attr(record,'Import role'))record.attributes.push({name:'Catalog role',value:'family'});
 if(record.kind==='variant'){
  const item=records.find(r=>r.id===record.links.find(l=>l.relation==='work')?.targetId);
  if(!record.links.some(l=>l.relation==='unit'))record.links.push(...(item?.links.filter(l=>l.relation==='unit')??[]));
 }
}
let standardVariants=0;
for(const item of records.filter(r=>r.kind==='work'))if(!records.some(r=>r.kind==='variant'&&r.links.some(l=>l.relation==='work'&&l.targetId===item.id))){
 records.push({id:uid(`standard:${item.id}`),catalogId,version:0,kind:'variant',code:`STANDARD_${item.code}`,name:`${item.name} · Standard`.slice(0,180),description:'Default configuration. Price has not been set.',market:item.market,aliases:[],sizes:[],sources:[],attributes:[{name:'Catalog role',value:'default variant'}],links:[{relation:'work',targetId:item.id},...item.links.filter(l=>l.relation==='unit')],specificationStatus:'needs_specification',dimension:'none',configuration:{specificationTier:'Standard'}});standardVariants++;
}
const report={sourceSha256:'90ff51b53f46e41ada1aa81262224d868d0415427eb8d9ef51e1f8c5a43a9588',sourceRows:7392,accountedRows:accounted,sheets,standardVariants,errors,records:records.length};
fs.writeFileSync(outputPath,JSON.stringify({workspaceId,catalogId,name:'Room Builder',report,records}));console.log(JSON.stringify(report));
