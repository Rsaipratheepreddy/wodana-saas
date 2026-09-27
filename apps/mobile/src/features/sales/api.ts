import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../core/api';
import { useSession } from '../../core/session';

export type LeadStatus = 'new' | 'attempting_contact' | 'connected' | 'nurturing' | 'qualified' | 'disqualified' | 'paused' | 'duplicate';
export type LeadRow = {
  id: string; status: LeadStatus; priority: string; ownerMembershipId: string | null; ownerName: string | null; nextActionAt: string | null; version: number;
  ownershipDueAt: string | null; isConverted: boolean; createdAt: string; updatedAt: string; partyId: string; partyName: string | null; enquiryId: string; reference: string | null;
  title: string | null; source: string | null; channel: string | null; serviceType: string | null; slaStatus: string | null; slaDueAt: string | null;
  details: { area?: string; location?: string; budgetRange?: string; contact?: { phone?: string; mobile?: string; email?: string } } | null;
};
export type LeadDetail = {
  id: string; partyId: string; status: LeadStatus; ownerMembershipId: string | null; nextActionAt: string | null; ownershipDueAt: string | null; disqualificationReason: string | null;
  pausedReason: string | null; createdAt: string; version: number;
  enquiry: {
    id: string; reference: string | null; title: string | null; summary: string | null; serviceType: string | null; source: string | null; channel: string | null;
    primaryEmail: string | null; primaryMobile: string | null; primaryPhone: string | null; partyName: string | null; receivedAt: string | null;
    details: { area?: string; location?: string; budgetRange?: string; customerType?: string } | null;
  } | null;
  opportunities: Array<{ id: string; title: string; status: string }>;
};
export type ActivityType = 'task' | 'note' | 'call' | 'meeting' | 'email' | 'whatsapp' | 'sms' | 'portal' | 'other';
export type Activity = {
  id: string; partyId: string | null; leadId: string | null; opportunityId: string | null; type: ActivityType; status: 'pending' | 'completed' | 'cancelled'; title: string; description: string | null;
  partyName: string | null; leadTitle: string | null; ownerMembershipId: string | null; ownerName: string | null; priority: string; dueAt: string | null; completedAt: string | null;
  completionOutcome: string | null; isNextAction: boolean; version: number; createdAt: string; appointment: { startsAt: string; endsAt: string; location: unknown } | null;
};
export type Opportunity = {
  id: string; title: string; status: 'open' | 'won' | 'lost' | 'abandoned'; partyName: string | null; stageName: string | null; pipelineName: string | null; ownerName: string | null;
  amount: string | null; currencyCode: string | null; nextActionAt: string | null; expectedCloseAt: string | null; leadId: string | null; enquiryReference: string | null; version: number;
};
export type OpportunityDetail = Opportunity & {
  funnel: Array<{ key: string; state: 'done' | 'current' | 'active' | 'upcoming'; detail: string | null; at: string | null }>;
  team: Array<{ membershipId: string; name: string; role: string }>;
  stageHistory: Array<{ id: string; toStageName: string | null; changedAt: string; reason: string | null }>;
};
type Page<T> = { data: T[]; nextCursor: string | null };

export const salesKeys = {
  all: (ws: string) => ['sales', ws] as const,
  leads: (ws: string, filters: Record<string, string>) => ['sales', ws, 'leads', filters] as const,
  lead: (ws: string, id: string) => ['sales', ws, 'lead', id] as const,
  activities: (ws: string, filters: Record<string, string>) => ['sales', ws, 'activities', filters] as const,
  opportunities: (ws: string, filters: Record<string, string>) => ['sales', ws, 'opportunities', filters] as const,
  opportunity: (ws: string, id: string) => ['sales', ws, 'opportunity', id] as const,
};
const query = (filters: Record<string, string>) => new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '')).toString();

export function useLeads(filters: Record<string, string>) {
  const api = useApi();
  const session = useSession();
  return useInfiniteQuery({
    queryKey: salesKeys.leads(api.workspaceId, filters),
    queryFn: ({ pageParam }) => api.get<Page<LeadRow>>(`crm/leads?${query({ ...filters, limit: '30', ...(pageParam ? { cursor: pageParam } : {}) })}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: session.has('crm') && session.can('crm.leads.view'),
  });
}
export function useLead(id: string) {
  const api = useApi();
  const session = useSession();
  return useQuery({ queryKey: salesKeys.lead(api.workspaceId, id), queryFn: () => api.get<LeadDetail>(`crm/leads/${id}`), enabled: session.has('crm') && !!id });
}
export function useActivities(filters: Record<string, string>, enabled = true) {
  const api = useApi();
  const session = useSession();
  return useQuery({
    queryKey: salesKeys.activities(api.workspaceId, filters),
    queryFn: () => api.get<Page<Activity>>(`crm/activities?${query({ ...filters, limit: '100' })}`),
    enabled: enabled && session.has('crm') && session.can('crm.activities.view'),
  });
}
export function useOpportunities(filters: Record<string, string>) {
  const api = useApi();
  const session = useSession();
  return useInfiniteQuery({
    queryKey: salesKeys.opportunities(api.workspaceId, filters),
    queryFn: ({ pageParam }) => api.get<Page<Opportunity>>(`crm/opportunities?${query({ ...filters, limit: '30', ...(pageParam ? { cursor: pageParam } : {}) })}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: session.has('crm') && session.can('crm.opportunities.view'),
  });
}
export function useOpportunity(id: string) {
  const api = useApi();
  const session = useSession();
  return useQuery({ queryKey: salesKeys.opportunity(api.workspaceId, id), queryFn: () => api.get<OpportunityDetail>(`crm/opportunities/${id}`), enabled: session.has('crm') && !!id });
}

/** A sales command; everything in sales refreshes afterwards (activities also move the enquiry's version). */
export function useSalesCommand<Input>(run: (api: ReturnType<typeof useApi>, input: Input) => Promise<unknown>) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: Input) => run(api, input), onSettled: () => queryClient.invalidateQueries({ queryKey: salesKeys.all(api.workspaceId) }) });
}
