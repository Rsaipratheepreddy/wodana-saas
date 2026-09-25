"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/design-system';
import {jsonRequest} from '@/lib/commercial/client';
import type {IntegrationConnection,IntegrationProvider,IntegrationsPageData} from '@/lib/workspace/integrations';
import {IntegrationDialog} from '../workspace/integrations-page';
import s from './project-workspace.module.css';

export function ProjectAccountingConnections({workspaceId}:{workspaceId:string}) {
 const [data,setData]=useState<IntegrationsPageData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const [editor,setEditor]=useState<{provider:IntegrationProvider;connection?:IntegrationConnection}|null>(null);
 const [revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;setError('');setData(null);void jsonRequest<IntegrationsPageData>(`/api/workspace/accounting-setup?workspaceId=${workspaceId}`).then(next=>{if(active)setData(next)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[workspaceId,revision]);
 async function connect(connection:IntegrationConnection){
  setBusy(connection.id);setError('');
  try{
   const result=await jsonRequest<{authorizationUrl?:string;connectionVersion?:number}>(`/api/workspace/integration-connections/${connection.id}/connect`,'POST',{workspaceId,provider:connection.provider,version:connection.version});
   if(result.connectionVersion) setData(current=>current?{...current,connections:current.connections.map(c=>c.id===connection.id?{...c,version:result.connectionVersion!,status:'pending'}:c)}:current);
   if(!result.authorizationUrl) throw new Error('Authorization could not be started. Please retry.');
   const url=new URL(result.authorizationUrl);
   if(url.protocol!=='https:'||!['appcenter.intuit.com','accounts.zoho.com','accounts.zoho.in','accounts.zoho.eu','accounts.zoho.com.au','accounts.zohocloud.ca','accounts.zoho.jp','accounts.zoho.sa'].includes(url.hostname)) throw new Error('The provider returned an invalid authorization address.');
   window.location.assign(url.toString());
  }catch(e){setError((e as Error).message)}finally{setBusy('')}
 }
 const providers=data?.providerCapabilities.providers.filter(p=>['quickbooks','zoho_books'].includes(p.id)&&p.implementation==='available'&&p.configurationState!=='unavailable'&&p.setupMode==='tenant_connection')??[];
 return <section aria-label="Accounting connections">
  {error?<p role="alert" className={s.error}>{error} <Button size="compact" onPress={()=>setRevision(v=>v+1)}>Retry connections</Button></p>:!data?<p role="status">Checking accounting connections…</p>:null}
  {data&&!providers.length&&<p className={s.muted}>No accounting integration is enabled for this workspace.</p>}
  {providers.map(provider=>{
   const connections=data!.connections.filter(c=>c.provider===provider.id&&c.status!=='revoked');
   return <div className={s.row} key={provider.id}><div><strong>{provider.label}</strong>{connections.length?connections.map(c=><p key={c.id} className={s.muted}>{c.displayName}{c.legalEntityName?` · ${c.legalEntityName}`:''} · {c.status==='connected'?'Connected':c.status==='degraded'?'Needs attention':c.status==='pending'?'Connection pending':'Not connected'}</p>):<p className={s.muted}>Not connected</p>}</div><div className={s.detailActions}>
    {data!.canManage ? connections.length?connections.map(c=><span key={c.id} className={s.detailActions}><Button size="compact" isDisabled={!!busy} onPress={()=>setEditor({provider:c.provider,connection:c})}>Manage account</Button>{c.status!=='connected'&&<Button size="compact" variant="primary" isDisabled={!!busy} onPress={()=>void connect(c)}>{c.status==='draft'?'Connect':'Reconnect'}</Button>}</span>):<Button size="compact" variant="primary" onPress={()=>setEditor({provider:provider.provider!})}>Connect {provider.label}</Button>:<span className={s.muted}>Administrator access required to connect</span>}
   </div></div>;
  })}
  {data&&<IntegrationDialog key={editor?.connection?.id??editor?.provider??'closed'} initialData={data} item={editor} onClose={()=>setEditor(null)} onSaved={(connection,shouldConnect)=>{setData({...data,connections:[...data.connections.filter(c=>c.id!==connection.id),connection]});setEditor(null);if(shouldConnect)void connect(connection);}}/>}
 </section>;
}
