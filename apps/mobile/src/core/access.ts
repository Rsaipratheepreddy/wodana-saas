import type { TenantModuleId } from '../auth/client';

/**
 * What a person may see and do, from the permission codes and modules the server lists for them. The
 * app hides what they can't use; the server remains the authority and refuses anything else.
 */
export type Access = {
  /** At least one of these permission codes. */
  can: (...codes: string[]) => boolean;
  /** A product module open to this person and sold to the workspace. */
  has: (module: TenantModuleId) => boolean;
};

export function makeAccess(permissions: readonly string[], modules: readonly TenantModuleId[]): Access {
  const granted = new Set(permissions);
  const open = new Set(modules);
  return {
    can: (...codes) => codes.some((code) => granted.has(code)),
    has: (module) => open.has(module),
  };
}

export type WorkArea = 'sales' | 'projects' | 'survey' | 'deliveries' | 'orders' | 'factory' | 'people';

/** The areas on the Work tab, in the order a person meets them in the funnel. */
export function workAreas(access: Access): WorkArea[] {
  const areas: WorkArea[] = [];
  if (access.has('crm') && access.can('crm.leads.view', 'crm.activities.view', 'crm.opportunities.view')) areas.push('sales');
  if (access.has('pre-project') && access.can('pre_projects.view')) areas.push('survey');
  if (access.has('projects') && access.can('projects.view', 'projects.manage')) areas.push('projects');
  if (access.has('projects') && access.can('purchasing.view', 'purchasing.manage', 'stock.receive', 'stock.inspect')) areas.push('deliveries');
  if (access.has('projects') && access.can('purchasing.view')) areas.push('orders');
  if (access.has('projects') && access.can('factory.view', 'factory.manage', 'factory.report', 'factory.approve')) areas.push('factory');
  if (access.has('hrms')) areas.push('people');
  return areas;
}

export type CaptureAction = 'photo' | 'measurement' | 'report' | 'crew-day' | 'delivery' | 'snag' | 'note' | 'follow-up' | 'expense';

/** Quick actions on the Capture sheet, most used first. */
export function captureActions(access: Access): CaptureAction[] {
  const actions: CaptureAction[] = [];
  const projects = access.has('projects') && access.can('projects.view', 'projects.manage');
  const survey = access.has('pre-project') && access.can('pre_projects.view') && access.can('pre_projects.edit');
  if (projects || survey) actions.push('photo');
  if (projects) actions.push('report');
  if (projects && access.has('hrms')) actions.push('crew-day');
  if (projects) actions.push('snag');
  if (survey) actions.push('measurement');
  if (access.has('projects') && access.can('stock.receive', 'purchasing.manage')) actions.push('delivery');
  if (access.has('crm') && access.can('crm.leads.manage')) actions.push('note');
  if (access.has('crm') && access.can('crm.activities.manage')) actions.push('follow-up');
  if (projects) actions.push('expense');
  return actions;
}

/** The inbox lists your own notices from every module; the server needs only membership, so every member has it. */
export const canUseInbox = (_access: Access) => true;
