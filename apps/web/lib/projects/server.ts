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
  team: ['Omar Rahman'],
  reference: 'PRJ-2026-001',
  priority: 'high',
  risk: 'on_track',
  onHold: false,
  handoverDate: '2026-10-02',
  nextAction: 'Confirm joinery production slot',
  nextActionDate: '2026-09-12',
}];

// The auth-bypass workspace has no project API behind it. Keep its read-only
// design fixture addressable so the local portfolio never links to a 404.
const e2eProject = (workspaceId: string): ProjectState => ({
  workspaceId,
  id: 'demo',
  caseId: 'demo-case',
  name: 'Jumeirah villa interiors',
  customer: 'Amira Hassan',
  memberId: 'demo-manager',
  canManage: false,
  canReview: false,
  canReport: false,
  canBuy: false,
  commercialReady: true,
  members: [{ id: 'demo-manager', name: 'Omar Rahman' }],
  resources: [],
  bookings: [],
  pulse: {
    health: 'watch',
    counts: { packages: 0, readyPackages: 0, activePackages: 0, blockedPackages: 0, overdueTasks: 0, awaitingInspection: 0 },
    nextActions: [{ id: 'demo-next-action', kind: 'prepare_package', priority: 'normal', title: 'Confirm joinery production slot', detail: 'Review the work plan with the project manager.', recordId: 'demo' }],
  },
  data: {
    revision: 1,
    phase: 'active',
    scope: null,
    tasks: [],
    reports: [],
    materials: [],
    orders: [],
    documents: [],
    snags: [],
    handovers: [],
    comments: [],
    audit: [],
    processed: [],
    budget: 0,
    forecast: 0,
    financeClosed: false,
    financeEvidence: '',
  },
});

export async function projectRead<T>(path:string){
  const profile=await getAuthenticatedProfile(),w=profile.memberships[0]?.workspaceId;
  if(!w)throw Error('Workspace unavailable.');
  if(process.env.NODE_ENV !== 'production' && process.env.E2E_AUTH_BYPASS === 'true' && path.startsWith('approvals?')) return {workspaceId:w,data:{rows:[],nextCursor:null,memberId:'demo-manager',canReview:false} as T};
  if(process.env.NODE_ENV !== 'production' && process.env.E2E_AUTH_BYPASS === 'true' && path.startsWith('task-board?')) return {workspaceId:w,data:{rows:[],nextCursor:null,counts:{},memberId:'demo-manager',canManage:true,projects:[],members:[]} as T};
  if(process.env.NODE_ENV !== 'production' && process.env.E2E_AUTH_BYPASS === 'true' && path === 'portfolio') {
    return {workspaceId:w,data:e2ePortfolio as T};
  }
  if(process.env.NODE_ENV !== 'production' && process.env.E2E_AUTH_BYPASS === 'true' && path.startsWith('calendar?')) {
    const query=new URLSearchParams(path.slice('calendar?'.length));
    return {workspaceId:w,data:{range:{from:query.get('from')??'',to:query.get('to')??'',timezone:'Asia/Dubai'},departments:[],events:[],items:[],overlapCount:0,conflictCount:0} as T};
  }
  if(process.env.NODE_ENV !== 'production' && process.env.E2E_AUTH_BYPASS === 'true' && path === 'demo/execution') {
    return {workspaceId:w,data:e2eProject(w) as T};
  }
  const r=await authenticatedBackendFetch(`/workspaces/${w}/projects/${path}`);
  if(!r.upstream?.ok)throw Object.assign(Error('Projects could not be loaded. Check your access or refresh.'),{status:r.upstream?.status});
  return {workspaceId:w,data:await r.upstream.json() as T};
}
export const getProject=(id:string)=>projectRead<ProjectState>(`${id}/execution`);
