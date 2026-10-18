import { useRouter, type Href } from 'expo-router';
import { Briefcase, CalendarCheck, ClipboardCheck, Factory, FolderKanban, Handshake, ListChecks, PackageCheck, PhoneCall, Plane, Ruler, ShoppingCart, Users, type LucideIcon } from 'lucide-react-native';
import { workAreas, type WorkArea } from '../../core/access';
import { key, useT } from '../../core/i18n';
import { useSession } from '../../core/session';
import { Empty, ListRow, Screen, Section } from '../../ui/layout';
import { useBootstrap } from '../hrms/api';

type Context = { can: (...codes: string[]) => boolean; team: boolean };
type Entry = { label: string; icon: LucideIcon; href: Href; when?: (context: Context) => boolean };
const AREAS: Record<WorkArea, { title: string; entries: Entry[] }> = {
  sales: { title: key('Sales'), entries: [
    { label: key('Enquiries'), icon: PhoneCall, href: '/sales', when: ({ can }) => can('crm.leads.view') },
    { label: key('Follow-ups'), icon: CalendarCheck, href: '/sales/follow-ups', when: ({ can }) => can('crm.activities.view') },
    { label: key('Opportunities'), icon: Handshake, href: '/sales/opportunities', when: ({ can }) => can('crm.opportunities.view') },
  ] },
  survey: { title: key('Site survey'), entries: [{ label: key('Cases'), icon: Ruler, href: '/survey' }] },
  projects: { title: key('Projects'), entries: [
    { label: key('My projects'), icon: FolderKanban, href: '/projects' },
    { label: key('My tasks'), icon: ListChecks, href: '/projects/tasks' },
  ] },
  deliveries: { title: key('Deliveries'), entries: [{ label: key('Receive and inspect'), icon: PackageCheck, href: '/purchasing' }] },
  orders: { title: key('Purchasing'), entries: [{ label: key('Orders'), icon: ShoppingCart, href: '/purchasing/orders' }] },
  factory: { title: key('Factory'), entries: [{ label: key('Work orders'), icon: Factory, href: '/factory' }] },
  people: { title: key('People'), entries: [
    { label: key('Attendance'), icon: ClipboardCheck, href: '/hrms/attendance' },
    { label: key('Leave'), icon: Plane, href: '/hrms/leave' },
    { label: key('Team'), icon: Users, href: '/hrms/team', when: ({ team }) => team },
  ] },
};

/** Work: every area this person can use, nothing else. */
export function WorkScreen() {
  const t = useT();
  const router = useRouter();
  const session = useSession();
  const bootstrap = useBootstrap();
  const areas = workAreas(session);
  const context: Context = { can: session.can, team: !!bootstrap.data?.permissions.team };
  return <Screen large title={t('Work')}>
    {areas.length ? areas.map((area) => {
      const entries = AREAS[area].entries.filter((entry) => !entry.when || entry.when(context));
      if (!entries.length) return null;
      return <Section key={area} title={t(AREAS[area].title)}>
        {entries.map((entry, index) => <ListRow key={entry.label} first={index === 0} icon={entry.icon} title={t(entry.label)} onPress={() => router.push(entry.href)} />)}
      </Section>;
    }) : <Empty icon={Briefcase} title={t('No work areas yet')} detail={t('Ask your administrator for access.')} />}
  </Screen>;
}
