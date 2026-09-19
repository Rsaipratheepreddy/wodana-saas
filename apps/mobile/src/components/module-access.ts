import type { TenantModuleId } from '../auth/client';

export function visibleHomeModuleIds(allowed: readonly TenantModuleId[] | undefined) {
  return (['crm', 'pre-project', 'projects', 'hrms'] as const).filter(module => allowed?.includes(module));
}
