import {useEffect,useState} from 'react';
import * as Crypto from 'expo-crypto';
import {useAuth} from '../auth/provider';
// The field app consumes the same contracts and payload serializers as the portal.
export type {CaseContent,CaseRoom,CaseAsset,ScopeEntry,ItemDimension,CatalogChoice,CaseBrief,CaseDesign,DesignOptions,DesignVersion} from '../../../web/lib/pre-project/content';
export type {SiteData,SiteRecord,SiteKind} from '../../../web/lib/pre-project/site';
export type {PreProjectCase,PreProjectListItem,PreProjectList} from '../../../web/lib/pre-project/types';
export {entryPayload,briefFields} from '../../../web/lib/pre-project/content';
export {sitePayload,siteLabels,visitInstant,visitWallTime} from '../../../web/lib/pre-project/site';
import type {ScopeEntry} from '../../../web/lib/pre-project/content';
import type {SiteKind,SiteRecord} from '../../../web/lib/pre-project/site';
export const uuid=()=>Crypto.randomUUID();
export function newEntry(roomId:string|null=null):ScopeEntry{return {id:uuid(),version:0,kind:'requirement',title:'',roomId,note:'',category:'General',priority:'preferred',scopeStatus:'undecided',reviewStatus:'captured',quantity:null,unit:'nos',referenceUrl:'',avoid:'',source:'team',assets:[],catalogLinks:[],archivedAt:null};}
export function newSurvey(kind:SiteKind,timezone:string):SiteRecord{return {id:uuid(),version:0,kind,title:'',note:'',roomId:null,entryId:null,visitId:null,status:kind==='visit'?'planned':kind==='observation'?'open':'incomplete',assetIds:[],assets:[],timezone,scheduledAt:'',durationMinutes:60,assigneeId:null,location:'',access:'',outcome:'',category:'condition',resolution:'',dimensions:[]};}
export function usePreProjectApi(workspaceId:string,caseId?:string){const {client}=useAuth();return <T,>(path:string,method='GET',body?:unknown,binary=false)=>client.api<T>(`/workspaces/${workspaceId}/pre-projects${caseId?'/'+caseId:''}${path?'/'+path:''}`,method,body,binary);}
export function useFieldData<T>(workspaceId:string,path:string,revision=0){const {client}=useAuth();const key=`${workspaceId}:${path}:${revision}`;const [state,setState]=useState<{key:string;data:T|null;error:string}|null>(null);useEffect(()=>{let active=true;client.api<T>(`/workspaces/${workspaceId}/pre-projects${path?'/'+path:''}`).then(data=>active&&setState({key,data,error:''})).catch(e=>active&&setState(previous=>({key,data:previous?.key.startsWith(`${workspaceId}:${path}:`)?previous.data:null,error:e.message})));return()=>{active=false;};},[client,workspaceId,path,key]);return {data:state?.key.startsWith(`${workspaceId}:${path}:`)?state.data:null,error:state?.key===key?state.error:'',loading:state?.key!==key};}
export const errorText=(e:unknown)=>e instanceof Error?e.message:'Could not save. Your changes are still in the form.';
