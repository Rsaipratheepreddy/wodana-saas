import type { TenantModuleId } from '../auth/client';
import { visibleHomeModuleIds } from './module-access';

export type HomeModule = {
  id: 'crm' | 'pre-project' | 'projects' | 'hrms';
  label: string;
  group: string;
  description: string;
};

export const homeModules: readonly HomeModule[] = [
  { id: 'crm', label: 'CRM', group: 'Customers & sales', description: 'Enquiries, follow-ups and deals' },
  { id: 'pre-project', label: 'Pre-execution', group: 'Plan the work', description: 'Briefs, scope and site visits' },
  { id: 'projects', label: 'Projects', group: 'Deliver the work', description: 'Assigned work, receipts and site photos' },
  { id: 'hrms', label: 'People', group: 'Team operations', description: 'Attendance, leave and approvals' },
];

export function visibleHomeModules(allowed: readonly TenantModuleId[] | undefined): HomeModule[] {
  const ids = visibleHomeModuleIds(allowed);
  return homeModules.filter(module => ids.includes(module.id));
}
