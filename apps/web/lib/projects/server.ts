import 'server-only';
import {getAuthenticatedProfile} from '@/lib/auth/server';
import {authenticatedBackendFetch} from '@/lib/auth/backend-session';
import type {ProjectState} from './execution';

const e2ePortfolio = [{
  id: 'demo',
  caseId: 'demo-case',
  name: 'Jumeirah villa interiors',
  customer: 'Amira Hassan',
  phase: 'active',
  manager: 'Omar Rahman',
  reference: 'PRJ-2026-001',
  priority: 'high',
  risk: 'on_track',
  onHold: false,
  handoverDate: '2026-10-02',
  nextAction: 'Confirm joinery production slot',
  nextActionDate: '2026-09-12',
}];

export async function projectRead<T>(path:string){
  const profile=await getAuthenticatedProfile(),w=profile.memberships[0]?.workspaceId;
  if(!w)throw Error('Workspace unavailable.');
  if(process.env.NODE_ENV !== 'production' && process.env.E2E_AUTH_BYPASS === 'true' && path === 'portfolio') {
    return {workspaceId:w,data:e2ePortfolio as T};
  }
  const r=await authenticatedBackendFetch(`/workspaces/${w}/projects/${path}`);
  if(!r.upstream?.ok)throw Error('Projects could not be loaded. Check your access or refresh.');
  return {workspaceId:w,data:await r.upstream.json() as T};
}
export const getProject=(id:string)=>projectRead<ProjectState>(`${id}/execution`);
