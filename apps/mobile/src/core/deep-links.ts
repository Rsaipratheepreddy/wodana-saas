/**
 * Links in notifications and "next action" items point at the web (`/workspace/projects/<id>/site?crewDay=<id>`).
 * This maps each one to the screen that shows the same record in the app, or null when the app has no
 * screen for it (the person opens it on the web).
 */
const UUID = '[0-9a-fA-F-]{36}';
const id = (value: string | null | undefined) => (value && new RegExp(`^${UUID}$`).test(value) ? value : null);

export function appRouteFor(link: string | null | undefined): string | null {
  if (!link) return null;
  let url: URL;
  try { url = new URL(link, 'https://app.invalid'); } catch { return null; }
  const path = url.pathname.replace(/\/+$/, '');
  const q = (name: string) => id(url.searchParams.get(name));
  const parts = path.split('/').filter(Boolean);
  // "/workspace/…" (notifications) and "/crm/…" (Today items) both appear.
  const [first, ...rest] = parts[0] === 'workspace' ? parts.slice(1) : parts;
  switch (first) {
    case 'projects': {
      const projectId = id(rest[0]);
      if (!projectId) return '/projects';
      const section = rest[1] ?? '';
      const record = q('record') ?? q('item');
      if (section === 'site' && q('crewDay')) return `/crew-day/${q('crewDay')}`;
      if (section === 'plan' && q('item')) return `/projects/${projectId}/task/${q('item')}`;
      if (section === 'plan' || section === 'plan-teams') return record ? `/projects/${projectId}/task/${record}` : `/projects/${projectId}/plan`;
      if (section === 'snagging') return record ? `/projects/${projectId}/task/${record}` : `/projects/${projectId}/snags`;
      if (section === 'site' || section === 'daily-progress' || section === 'site-work') return `/projects/${projectId}/reports`;
      if (section === 'handover' || section === 'warranty') return `/projects/${projectId}/handover`;
      if (section === 'petty-cash') return `/projects/${projectId}/expenses`;
      return `/projects/${projectId}`;
    }
    case 'hrms': {
      const section = rest[0] ?? '';
      if (!section) return url.searchParams.get('day') ? `/hrms/days?day=${encodeURIComponent(url.searchParams.get('day')!.slice(0, 10))}` : '/hrms/attendance';
      if (section === 'leave') return q('request') ? `/hrms/leave?request=${q('request')}` : '/hrms/leave';
      if (section === 'team') return '/hrms/team';
      if (section === 'crews') return q('crewDay') ? `/crew-day/${q('crewDay')}` : '/hrms/team';
      if (section === 'time') return url.searchParams.get('week') ? `/hrms/time?week=${encodeURIComponent(url.searchParams.get('week')!.slice(0, 10))}` : '/hrms/time';
      if (section === 'documents') return '/hrms/documents';
      if (section === 'attendance') return '/hrms/attendance';
      return '/hrms/attendance';
    }
    case 'crm': {
      const section = rest[0] ?? '';
      if (section === 'leads') return id(rest[1]) ? `/sales/${rest[1]}` : q('lead') ? `/sales/${q('lead')}` : '/sales';
      if (section === 'opportunities') return id(rest[1]) ? `/sales/opportunity/${rest[1]}` : q('record') ? `/sales/opportunity/${q('record')}` : '/sales/opportunities';
      if (section === 'follow-ups' || section === 'activities') return '/sales/follow-ups';
      return null;
    }
    case 'purchasing': {
      const section = rest[0] ?? '';
      if (section === 'orders' && q('order')) return `/purchasing/order/${q('order')}`;
      if (section === 'orders') return '/purchasing/orders';
      if (section === 'deliveries' && q('receipt')) return `/purchasing/receipt/${q('receipt')}`;
      if (section === 'deliveries' || !section) return '/purchasing';
      return null;
    }
    case 'factory':
      return q('order') ? `/factory/${q('order')}` : '/factory';
    case 'inventory':
      return rest[0] === 'moves' && q('move') ? `/purchasing/move/${q('move')}` : null;
    case 'pre-projects': {
      const caseId = id(rest[0] === 'cases' ? rest[1] : rest[0]);
      return caseId ? `/survey/${caseId}` : '/survey';
    }
    default:
      return null;
  }
}
