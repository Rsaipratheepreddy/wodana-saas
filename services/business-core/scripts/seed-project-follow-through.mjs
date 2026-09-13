// Adds optional v1 workflow examples to our labelled local delivery demo only.
const api='http://127.0.0.1:8131/api/v1';if(process.env.NODE_ENV==='production')throw Error('Local demo only');
const l=await fetch(api+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@igloarchitects.com',password:process.env.DEMO_PASSWORD??'IgloDemo#2026',tenantSlug:'iglo-architects'})}).then(r=>r.json());
const headers={authorization:'Bearer '+l.accessToken,'content-type':'application/json'},w='f81e8362-8d08-440a-89dd-06ec7a8b46e7',p='b6ee0e92-bc40-44dc-a188-e2492014c43f',path=api+`/workspaces/${w}/projects/${p}/execution`;
async function read(){const r=await fetch(path,{headers});if(!r.ok)throw Error(await r.text());return r.json();}
async function run(action,body){const current=await read();const r=await fetch(path,{method:'POST',headers,body:JSON.stringify({action,requestId:crypto.randomUUID(),revision:current.data.revision,...body})});if(!r.ok)throw Error(await r.text());return r.json();}
let state=await read();if(state.name!=='Jumeirah villa · Delivery demo')throw Error('Demo project mismatch');
for(const [title,location,date] of [['Joinery ready for dispatch','factory','2026-09-14'],['Installation signed off','site','2026-09-19']]){if(!state.data.milestones?.some(m=>m.title===title))await run('milestone',{milestone:{title,dueDate:date,ownerId:state.memberId,taskIds:state.data.tasks.filter(t=>t.location===location&&!state.data.tasks.some(c=>c.parentId===t.id)).map(t=>t.id)}});}
const material=state.data.materials[0];
for(const [vendor,price,date] of [['Demo supplier · Atlas Joinery',210,'2026-09-10'],['Demo supplier · Cedar Materials',230,'2026-09-09']]){
 state=await read();let order=state.data.orders.find(o=>o.vendor===vendor);
 if(!order){const r=await run('enquiry',{order:{title:'Remaining MR board supply · Demo enquiry',vendor,vendorContact:'Seeded comparison only',kind:'material',materialId:material.id,taskId:material.taskId,quantity:10,unit:material.unit,unitCost:0,promisedDate:date}});order=r.data.orders.at(-1);}
 if(order.vendorUpdates?.some(u=>u.kind==='quotation'))continue;
 const accessResponse=await fetch(api+`/workspaces/${w}/projects/${p}/vendor-access`,{method:'POST',headers,body:JSON.stringify({orderId:order.id})});if(!accessResponse.ok)throw Error(await accessResponse.text());const access=await accessResponse.json();
 try{const quote=await fetch(api+'/vendor-order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'submit',token:access.token,requestId:crypto.randomUUID(),kind:'quotation',unitCost:price,quantity:10,date,note:'Demo offer for material comparison. No supplier contacted.',evidence:'DEMO-OFFER'})});if(!quote.ok)throw Error(await quote.text());}
 finally{await fetch(api+`/workspaces/${w}/projects/${p}/vendor-access`,{method:'POST',headers,body:JSON.stringify({orderId:order.id,revoke:true})});}
}
console.log('Demo has two delivery milestones and two labelled vendor offers; no messages or purchases sent.');
