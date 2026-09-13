import { useEffect, useState } from 'react';
import { useAuth } from '../auth/provider';

export type CrmRecord = Record<string, unknown> & { id: string };
export type CrmPage<T = CrmRecord> = { data: T[]; nextCursor?: string | null };

export function crmRows<T = CrmRecord>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const record = value as { data?: unknown; rows?: unknown; items?: unknown };
    if (Array.isArray(record.data)) return record.data as T[];
    if (Array.isArray(record.rows)) return record.rows as T[];
    if (Array.isArray(record.items)) return record.items as T[];
  }
  return [];
}

export function useCrm<T>(workspaceId: string, path: string | null, revision = 0) {
  const { client } = useAuth();
  const resource = path ? `${workspaceId}:${path}` : '';
  const key = `${resource}:${revision}`;
  const [result, setResult] = useState<{ key: string; resource: string; data: T | null; error: string } | null>(null);

  useEffect(() => {
    if (!path) return;
    let active = true;
    client.api<T>(`/workspaces/${workspaceId}/crm/${path}`)
      .then(data => { if (active) setResult({ key, resource, data, error: '' }); })
      .catch(error => { if (active) setResult({ key, resource, data: null, error: error instanceof Error ? error.message : 'CRM could not be loaded.' }); });
    return () => { active = false; };
  }, [client, workspaceId, path, key, resource]);

  return {
    data: path && result?.resource === resource ? result.data : null,
    error: path && result?.key === key ? result.error : '',
    loading: Boolean(path && result?.key !== key),
  };
}

export function useCrmActions(workspaceId: string) {
  const { client } = useAuth();
  return <T,>(path: string, method = 'POST', body?: unknown) =>
    client.api<T>(`/workspaces/${workspaceId}/crm/${path}`, method, body);
}

export const crmLabel = (value: unknown, fallback = 'Not set') => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
    .replace(/\bWhatsapp\b/g, 'WhatsApp').replace(/\bSla\b/g, 'SLA').replace(/\bCrm\b/g, 'CRM');
};

export const crmDate = (value: unknown, includeTime = false) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return 'Not scheduled';
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
};

export const crmNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export function crmContact(record: unknown, type: 'email' | 'phone') {
  if (!record || typeof record !== 'object') return '';
  const contacts = Array.isArray((record as { contacts?: unknown }).contacts)
    ? (record as { contacts: Array<Record<string, unknown>> }).contacts : [];
  const contact = contacts.find(item => item.type === type && item.isPrimary)
    ?? contacts.find(item => item.type === type);
  const value = contact?.rawValue ?? contact?.value ?? contact?.normalizedValue;
  return typeof value === 'string' ? value.trim() : '';
}
