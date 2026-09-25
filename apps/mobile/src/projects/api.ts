import { useEffect, useState } from 'react';
import { useAuth } from '../auth/provider';

export type ProjectFieldTask = {
  id: string; title: string; area: string; ownerId: string; location: 'site' | 'factory'; status: string;
  start: string; end: string; quantity: number; approved: number; remaining: number;
  unit: string; canReport: boolean; photoCount: number;
};
export type ProjectFieldReceipt = {
  id: string; title: string; quantity: number; unit: string; photoCount: number;
  destination?: string; dueDate?: string; reference?: string; canReceive?: boolean;
  number?: string; vendor?: string; promisedDate?: string; ordered?: number;
  accepted?: number; remaining?: number;
};
export type ProjectFieldMember = { id: string; name: string };
export type ProjectFieldSnag = {
  id: string; title: string; taskId: string; area: string; ownerId: string; owner: string;
  severity: 'minor' | 'major' | 'critical'; dueDate: string; status: 'open' | 'ready' | 'closed';
  evidence: string; resolution: string; canResolve: boolean; canVerify: boolean;
  canReopen: boolean; photoCount: number;
};
export type ProjectFieldOutstandingItem = {
  id: string; title: string; kind: 'punch' | 'document' | 'training' | 'delivery' | 'other';
  blocking: boolean; ownerId: string; owner: string; dueDate: string;
  status: 'open' | 'ready' | 'closed' | 'warranty'; evidence: string; resolution: string;
  canResolve: boolean; canVerify: boolean; canReopen: boolean;
};
export type ProjectFieldHandover = {
  id: string; title: string; area: string; status: 'draft' | 'ready' | 'returned' | 'accepted';
  warrantyUntil: string; clientReviewDueDate: string; returnedNote: string;
  packet?: {
    version: number;
    tasks: { id: string; title: string; area: string; quantity: number; unit: string }[];
    documents: { id: string; title: string; kind: string; revision: string; url: string }[];
  };
  outstandingItems: ProjectFieldOutstandingItem[];
};
export type ProjectFieldProject = {
  id: string; name: string; customer: string; revision: number; memberId: string;
  members: ProjectFieldMember[];
  reports?: {id:string;date:string;location:string;summary:string;status:string;note:string;published:boolean;photoCount:number}[];
  tasks: ProjectFieldTask[];
  deliveries: ProjectFieldReceipt[];
  purchaseReceipts: ProjectFieldReceipt[];
  snags: ProjectFieldSnag[];
  handovers: ProjectFieldHandover[];
};
export type ProjectFieldQueue = { projects: ProjectFieldProject[] };

export function useProjectFieldQueue(workspaceId: string, revision = 0) {
  const { client } = useAuth();
  const key = `${workspaceId}:${revision}`;
  const [result, setResult] = useState<{ key: string; data: ProjectFieldQueue | null; error: string } | null>(null);
  useEffect(() => {
    let active = true;
    client.api<ProjectFieldQueue>(`/workspaces/${workspaceId}/projects/field-queue`)
      .then(data => { if (active) setResult({ key, data, error: '' }); })
      .catch(error => { if (active) setResult({ key, data: null, error: error instanceof Error ? error.message : 'Assigned project work could not be loaded.' }); });
    return () => { active = false; };
  }, [client, workspaceId, key]);
  return { data: result?.key === key ? result.data : null, error: result?.key === key ? result.error : '', loading: result?.key !== key };
}

export function useProjectFieldActions(workspaceId: string) {
  const { client } = useAuth();
  return {
    command: <T,>(projectId: string, body: unknown) =>
      client.api<T>(`/workspaces/${workspaceId}/projects/${projectId}/field-actions`, 'POST', body),
    upload: <T,>(projectId: string, recordId: string, fileId: string, body: FormData) =>
      client.api<T>(`/workspaces/${workspaceId}/projects/${projectId}/files/${recordId}/${fileId}`, 'POST', body),
  };
}
