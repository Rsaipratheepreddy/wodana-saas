import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarCheck, CalendarPlus, Check, Handshake, Mail, MessageCircle, NotebookPen, Phone, PhoneCall, Plus, UserPlus, Users } from 'lucide-react-native';
import { errorMessage } from '../../core/api';
import { mailLink, telLink, whatsappLink } from '../../core/contact';
import { addDays, useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { useSession } from '../../core/session';
import { DateField } from '../../ui/date-field';
import { FilterChips, OptionSheet, SearchField, SegmentedControl, TextField } from '../../ui/fields';
import { Banner, Card, Empty, Failure, Fact, ListRow, ListScreen, Loading, Screen, Section } from '../../ui/layout';
import { Button, Chip, IconButton, Row, Stack, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { useActivities, useAssignLead, useLead, useLeads, useOpportunities, useOpportunity, useSalesCommand, useSalesOwners, type Activity, type LeadDetail, type LeadRow } from './api';
import { byUrgency, CLOSED_LEAD_STATUSES, CONTACT_CHANNELS, CONTACT_OUTCOMES, contactProblem, contactRules, endOfToday, isMyDay, isUnowned, quickFollowUps, UNANSWERED, type ContactChannel, type ContactOutcome } from './model';

const leadName = (lead: Pick<LeadRow, 'partyName' | 'title' | 'reference'>) => lead.partyName || lead.title || lead.reference || '—';
type LeadView = 'my_day' | 'new' | 'contacted' | 'come_back' | 'unowned' | 'all';
const VIEWS: LeadView[] = ['my_day', 'new', 'contacted', 'come_back', 'unowned', 'all'];
// Kept with the assignment history (English, like every audit reason).
const TAKE_REASON = 'Taken on the phone';
const ASSIGN_REASON = 'Sales owner selected on the phone';
const respondingBy = (lead: Pick<LeadRow, 'slaDueAt' | 'slaStatus'>) => !!lead.slaDueAt && ['active', 'warning', 'breached'].includes(lead.slaStatus ?? '');

/**
 * Enquiries (S-30): My day first (my new ones, those waiting for a first response, and follow-ups due today or
 * earlier), then the funnel lists; people who give enquiries out also see the ones nobody owns, and everyone's.
 */
export function LeadsScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const session = useSession();
  const toast = useToast();
  const params = useLocalSearchParams<{ view?: string }>();
  const me = session.membershipId;
  const canAssign = session.can('crm.leads.assign');
  const canCreate = session.can('crm.leads.manage');
  const views = VIEWS.filter((value) => (value === 'unowned' ? canAssign : value === 'my_day' ? !!me : true));
  const [view, setView] = useState<LeadView>(() => (views.includes(params.view as LeadView) ? params.view as LeadView : me ? 'my_day' : 'new'));
  const [who, setWho] = useState<'mine' | 'all'>('mine');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  // My day and No owner read the latest hundred and choose on the phone, as the web does.
  const filters: Record<string, string> = view === 'my_day' ? { mine: 'true', limit: '100', search: debounced }
    : view === 'unowned' ? { limit: '100', search: debounced }
      : { mine: who === 'mine' || !canAssign ? 'true' : '', funnel: view === 'all' ? '' : view, search: debounced };
  const leads = useLeads(filters);
  const dayEnds = endOfToday(format.today(), format.timeZone);
  const rows = useMemo(() => {
    const all = leads.data?.pages.flatMap((page) => page.data) ?? [];
    if (view === 'my_day') return all.filter((lead) => isMyDay(lead, me, dayEnds)).sort(byUrgency);
    if (view === 'unowned') return all.filter(isUnowned).sort(byUrgency);
    return all;
  }, [leads.data, view, me, dayEnds]);
  const assign = useAssignLead();
  const owners = useSalesOwners(canAssign && view === 'unowned');
  const meCanOwn = !!me && (owners.data?.items ?? []).some((item) => item.id === me);
  const take = async (lead: LeadRow) => {
    try { await assign.mutateAsync({ leadId: lead.id, version: lead.version, ownerMembershipId: me, reason: TAKE_REASON }); toast.success(t('It’s yours')); }
    catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  const nowIso = new Date().toISOString();
  const label: Record<LeadView, string> = { my_day: t('My day'), new: t('New'), contacted: t('Contacted'), come_back: t('Come back'), unowned: t('No owner'), all: t('All') };
  const counted = (value: LeadView) => value === view && (value === 'my_day' || value === 'unowned') && !leads.isLoading && !leads.error;
  return <ListScreen title={t('Enquiries')} back items={rows} keyExtractor={(lead) => lead.id}
    action={canCreate ? <IconButton icon={Plus} label={t('New enquiry')} tone="action" onPress={() => router.push('/sales/new')} /> : undefined}
    toolbar={<View style={{ gap: theme.space(3) }}>
      <SearchField value={search} onChange={setSearch} placeholder={t('Name or reference')} />
      <FilterChips value={view} onChange={setView} options={views.map((value) => ({ value, label: counted(value) ? `${label[value]} · ${rows.length}` : label[value] }))} />
      {canAssign && view !== 'my_day' && view !== 'unowned' ? <SegmentedControl value={who} onChange={setWho} options={[{ value: 'mine', label: t('Mine') }, { value: 'all', label: t('Everyone') }]} /> : null}
    </View>}
    loading={leads.isLoading} error={leads.error ? errorMessage(leads.error, t('Enquiries could not be loaded.')) : null} onRetry={() => void leads.refetch()}
    onRefresh={() => void leads.refetch()} refreshing={leads.isRefetching && !leads.isFetchingNextPage}
    onEndReached={() => { if (leads.hasNextPage && !leads.isFetchingNextPage) void leads.fetchNextPage(); }}
    empty={<Empty icon={view === 'my_day' ? CalendarCheck : Users}
      title={debounced ? t('Nothing matches') : view === 'my_day' ? t('Nothing due today') : view === 'unowned' ? t('Every enquiry has an owner') : t('No enquiries here')}
      action={!debounced && canCreate && (view === 'my_day' || view === 'new') ? { label: t('New enquiry'), onPress: () => router.push('/sales/new') } : undefined} />}
    renderItem={(lead, _, first) => <ListRow first={first} title={leadName(lead)} onPress={() => router.push(`/sales/${lead.id}`)}
      detail={[lead.reference, lead.source, lead.details?.area ?? lead.details?.location, !lead.ownerMembershipId && view !== 'unowned' ? t('No owner') : null].filter(Boolean).join(' · ')}
      meta={respondingBy(lead) ? <Text variant="caption" tone={lead.slaStatus === 'breached' ? 'danger' : 'warning'}>{t('Respond by {when}', { when: format.when(lead.slaDueAt) })}</Text>
        : lead.nextActionAt ? <Text variant="caption" tone={lead.nextActionAt < nowIso ? 'danger' : 'tertiary'}>{t('Next {when}', { when: format.when(lead.nextActionAt) })}</Text> : undefined}
      trailing={view === 'unowned' && meCanOwn ? <Button size="sm" label={t('Take it')} icon={UserPlus} loading={assign.isPending && assign.variables?.leadId === lead.id}
        disabled={assign.isPending} onPress={() => void take(lead)} /> : <StatusChip status={lead.status} />} />} />;
}

/** One enquiry: call, WhatsApp or email in one tap; log what happened; take it or give it out; schedule the next follow-up. */
export function LeadScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const session = useSession();
  const toast = useToast();
  const { id, log, schedule } = useLocalSearchParams<{ id: string; log?: string; schedule?: string }>();
  const lead = useLead(id);
  const activities = useActivities({ leadId: id });
  const canAssign = session.can('crm.leads.assign');
  const owners = useSalesOwners(canAssign);
  const assign = useAssignLead();
  const [logging, setLogging] = useState<ContactChannel | null>(log ? 'call' : null);
  const [scheduling, setScheduling] = useState(!!schedule);
  const [assigning, setAssigning] = useState(false);
  const calledAt = useRef<{ channel: ContactChannel; at: number } | null>(null);
  // Back from a call or WhatsApp: offer to log it straight away.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && calledAt.current && Date.now() - calledAt.current.at > 3000) { setLogging(calledAt.current.channel); calledAt.current = null; }
    });
    return () => listener.remove();
  }, []);
  if (lead.isLoading) return <Screen back><Loading shape="record" count={3} /></Screen>;
  if (lead.error || !lead.data) return <Screen back><Failure message={errorMessage(lead.error, t('This enquiry could not be loaded.'))} onRetry={() => void lead.refetch()} /></Screen>;
  const data = lead.data;
  const enquiry = data.enquiry;
  const phone = enquiry?.primaryMobile ?? enquiry?.primaryPhone ?? null;
  const open = (url: string | null, channel?: ContactChannel) => { if (!url) return; if (channel) calledAt.current = { channel, at: Date.now() }; void Linking.openURL(url).catch(() => undefined); };
  const canManage = session.can('crm.leads.manage');
  const canPlan = session.can('crm.activities.manage');
  const closed = CLOSED_LEAD_STATUSES.has(data.status);
  const me = session.membershipId;
  const meCanOwn = !!me && (owners.data?.items ?? []).some((item) => item.id === me);
  const ownerName = data.ownerMembershipId ? (data.ownerMembershipId === me ? t('Me') : owners.data?.items.find((item) => item.id === data.ownerMembershipId)?.displayName ?? null) : null;
  const giveTo = async (membershipId: string, reason: string) => {
    try {
      const fresh = (await lead.refetch()).data ?? data;
      await assign.mutateAsync({ leadId: data.id, version: fresh.version, ownerMembershipId: membershipId, reason });
      toast.success(membershipId === me ? t('It’s yours') : t('Assigned'));
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  const list = [...(activities.data?.data ?? [])].sort((a, b) => (b.completedAt ?? b.dueAt ?? b.createdAt).localeCompare(a.completedAt ?? a.dueAt ?? a.createdAt));
  const next = list.filter((item) => item.status === 'pending' && item.dueAt).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))[0];
  return <Screen back title={enquiry?.partyName ?? enquiry?.title ?? t('Enquiry')} subtitle={[enquiry?.reference, enquiry?.title].filter(Boolean).join(' · ')}
    onRefresh={() => { void lead.refetch(); void activities.refetch(); }} refreshing={lead.isRefetching}
    footer={canManage && !closed ? <Row gap={2}>
      {canPlan ? <Button label={t('Schedule')} icon={CalendarPlus} variant="secondary" size="lg" onPress={() => setScheduling(true)} /> : null}
      <View style={{ flex: 1 }}><Button label={t('Log contact')} icon={NotebookPen} variant="primary" size="lg" full onPress={() => setLogging('call')} /></View>
    </Row> : undefined}>
    <Row gap={2} wrap><StatusChip status={data.status} />{data.ownershipDueAt && data.status === 'new' ? <Chip label={t('Respond by {when}', { when: format.when(data.ownershipDueAt) })} tone="warning" /> : null}</Row>
    <Row gap={3} style={{ justifyContent: 'space-around' }}>
      <ContactButton icon={Phone} label={t('Call')} onPress={telLink(phone) ? () => open(telLink(phone), 'call') : undefined} />
      <ContactButton icon={MessageCircle} label={t('WhatsApp')} onPress={whatsappLink(phone) ? () => open(whatsappLink(phone), 'whatsapp') : undefined} />
      <ContactButton icon={Mail} label={t('Email')} onPress={mailLink(enquiry?.primaryEmail) ? () => open(mailLink(enquiry?.primaryEmail, enquiry?.reference ?? undefined), 'email') : undefined} />
    </Row>
    {!data.ownerMembershipId && !closed && canAssign ? <Card tone="muted">
      <Text variant="subheading">{t('No owner yet')}</Text>
      <Row gap={2}>
        {meCanOwn ? <View style={{ flex: 1 }}><Button label={t('Take it')} icon={UserPlus} variant="primary" full loading={assign.isPending && assign.variables?.ownerMembershipId === me}
          disabled={assign.isPending} onPress={() => void giveTo(me, TAKE_REASON)} /></View> : null}
        <View style={{ flex: 1 }}><Button label={t('Assign')} full disabled={assign.isPending || owners.isLoading} onPress={() => setAssigning(true)} /></View>
      </Row>
    </Card> : null}
    {next ? <Banner tone={next.dueAt && next.dueAt < new Date().toISOString() ? 'warning' : 'info'} icon={CalendarCheck} title={next.title} detail={format.when(next.dueAt)} /> : null}
    {data.status === 'paused' && data.pausedReason ? <Banner tone="neutral" title={t('Paused')} detail={data.pausedReason} /> : null}
    <Section>
      {phone ? <Fact first label={t('Phone')} value={phone} /> : null}
      {enquiry?.primaryEmail ? <Fact first={!phone} label={t('Email')} value={enquiry.primaryEmail} /> : null}
      {enquiry?.serviceType ? <Fact label={t('Looking for')} value={enquiry.serviceType} /> : null}
      {enquiry?.details?.area || enquiry?.details?.location ? <Fact label={t('Where')} value={[enquiry.details.area, enquiry.details.location].filter(Boolean).join(', ')} /> : null}
      {enquiry?.details?.budgetRange ? <Fact label={t('Budget')} value={enquiry.details.budgetRange} /> : null}
      {enquiry?.source ? <Fact label={t('Source')} value={[enquiry.source, enquiry.channel].filter(Boolean).join(' · ')} /> : null}
      {enquiry?.receivedAt ? <Fact label={t('Received')} value={format.when(enquiry.receivedAt)} /> : null}
      {data.ownerMembershipId && ownerName ? <Fact label={t('Owner')} value={ownerName} /> : null}
    </Section>
    {data.ownerMembershipId && canAssign && !closed ? <Button label={t('Reassign')} variant="ghost" onPress={() => setAssigning(true)} /> : null}
    {enquiry?.summary ? <Text tone="secondary">{enquiry.summary}</Text> : null}
    {data.opportunities.length ? <Section title={t('Opportunities')}>
      {data.opportunities.map((item, index) => <ListRow key={item.id} first={index === 0} icon={Handshake} title={item.title} trailing={<StatusChip status={item.status} />} onPress={() => router.push(`/sales/opportunity/${item.id}`)} />)}
    </Section> : null}
    <Section title={t('Activity')}>
      {activities.isLoading ? <ListRow first title="…" /> : list.length ? list.slice(0, 40).map((item, index) => <ActivityRow key={item.id} item={item} first={index === 0} />)
        : <ListRow first title={t('Nothing logged yet')} />}
    </Section>
    <LogContactSheet lead={data} channel={logging} onClose={() => setLogging(null)} />
    <ScheduleSheet leadId={data.id} name={enquiry?.partyName ?? ''} open={scheduling} onClose={() => setScheduling(false)} />
    <OptionSheet open={assigning} onClose={() => setAssigning(false)} title={data.ownerMembershipId ? t('Reassign enquiry') : t('Assign enquiry')} value={data.ownerMembershipId}
      options={(owners.data?.items ?? []).map((item) => ({ value: item.id, label: item.id === me ? t('Me ({name})', { name: item.displayName || item.email }) : item.displayName || item.email, detail: item.email }))}
      onChange={(value) => { setAssigning(false); if (value && value !== data.ownerMembershipId) void giveTo(value, value === me ? TAKE_REASON : ASSIGN_REASON); }} />
  </Screen>;
}

function ContactButton({ icon: Icon, label, onPress }: { icon: typeof Phone; label: string; onPress?: () => void }) {
  const theme = useTheme();
  return <View style={{ alignItems: 'center', gap: theme.space(1), opacity: onPress ? 1 : 0.4 }}>
    <IconButton icon={Icon} label={label} tone="action" filled size={56} onPress={onPress ?? (() => undefined)} disabled={!onPress} />
    <Text variant="caption" tone="secondary">{label}</Text>
  </View>;
}

function ActivityRow({ item, first }: { item: Activity; first: boolean }) {
  const t = useT();
  const format = useFormat();
  const icon = item.type === 'call' ? PhoneCall : item.type === 'whatsapp' ? MessageCircle : item.type === 'email' ? Mail : item.type === 'meeting' ? Users : NotebookPen;
  const channel = CONTACT_CHANNELS.find((option) => option.value === item.type);
  const outcome = CONTACT_OUTCOMES.find((option) => option.value === item.completionOutcome);
  // A logged contact reads "Call · Willing to talk" in the reader's language; anything else keeps its own title.
  const title = channel && outcome ? `${t(channel.label)} · ${t(outcome.label)}` : item.title;
  return <ListRow first={first} icon={icon} iconTone={item.status === 'pending' ? 'action' : 'neutral'} title={title}
    detail={[item.description, outcome ? null : item.completionOutcome].filter(Boolean).join(' · ') || undefined}
    meta={<Text variant="caption" tone="tertiary">{[item.status === 'pending' ? t('Due {when}', { when: format.when(item.dueAt) }) : format.when(item.completedAt ?? item.createdAt), item.ownerName].filter(Boolean).join(' · ')}</Text>} />;
}

/**
 * What happened when you contacted them (PLM-042, S-16): the outcome moves the enquiry on (the server decides how).
 * A try that reached nobody needs no note; the next try is one chip away; "Come back later" needs its date.
 */
function LogContactSheet({ lead, channel: initial, onClose }: { lead: LeadDetail; channel: ContactChannel | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const format = useFormat();
  const leadQuery = useLead(lead.id);
  const [channel, setChannel] = useState<ContactChannel>('call');
  const [outcome, setOutcome] = useState<ContactOutcome | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [opened] = useState(() => new Date());
  useEffect(() => { if (initial) { setChannel(initial); setOutcome(null); setNote(''); setReason(''); setDay(''); setTime(''); setProblem(null); } }, [initial]);
  const command = useSalesCommand((api, body: Record<string, unknown>) => api.send(`crm/leads/${lead.id}/contacts`, 'POST', body));
  const rules = contactRules(outcome);
  const picks = quickFollowUps(opened, format.today(), format.timeZone);
  const setAt = (iso: string) => { setDay(format.dayOf(iso)); setTime(format.clock(iso)); setProblem(null); };
  const nextAt = rules.followUp && day && time ? format.instant(day, time) : null;
  const choose = (next: ContactOutcome) => {
    setOutcome(next);
    setProblem(null);
    // A next step where one is expected; the person can change or clear it.
    if (!day && UNANSWERED.has(next) && next !== 'unreachable') setAt(picks[0].at);
    if (!day && next === 'come_back_later') setAt(picks[1].at);
  };
  const save = async () => {
    const blocked = contactProblem({ outcome, note, reason, nextAt });
    if (blocked) { setProblem(blocked); return; }
    try {
      const fresh = (await leadQuery.refetch()).data ?? lead;
      await command.mutateAsync({ version: fresh.version, channel, outcome, note: note.trim().slice(0, 4000), ...(outcome === 'not_interested' ? { reason: reason.trim().slice(0, 160) } : {}),
        ...(nextAt ? { nextActionAt: nextAt } : {}) });
      toast.success(t('Logged'), 'send');
      onClose();
    } catch (error) { setProblem(errorMessage(error, t('The contact could not be logged.'))); }
  };
  const pickLabel = (id: (typeof picks)[number]['id'], at: string) => (id === 'two_hours' ? t('In 2 h · {when}', { when: format.when(at) })
    : id === 'tomorrow' ? t('Tomorrow · {when}', { when: format.time(at) }) : t('In 3 days · {when}', { when: format.when(at) }));
  return <Sheet open={!!initial} onClose={onClose} title={t('Log contact')} subtitle={lead.enquiry?.partyName ?? undefined} full
    footer={<Stack gap={2}>
      {problem ? <Banner tone="danger" title={t(problem)} /> : null}
      <Button label={t('Log contact')} variant="primary" size="lg" full disabled={!outcome} loading={command.isPending} onPress={() => void save()} />
    </Stack>}>
    <Stack gap={2}>
      <Text variant="label" tone="secondary">{t('How')}</Text>
      <Row gap={2} wrap>{CONTACT_CHANNELS.map((option) => <Chip key={option.value} label={t(option.label)} selected={channel === option.value} onPress={() => setChannel(option.value)} />)}</Row>
    </Stack>
    <Stack gap={2}>
      <Text variant="label" tone="secondary">{t('Outcome')}</Text>
      <Row gap={2} wrap>{CONTACT_OUTCOMES.map((option) => <Chip key={option.value} label={t(option.label)} selected={outcome === option.value} onPress={() => choose(option.value)} />)}</Row>
    </Stack>
    {rules.reasonRequired ? <TextField label={t('Reason')} value={reason} onChangeText={(value) => { setReason(value); setProblem(null); }} maxLength={160} /> : null}
    <TextField label={t('Note')} value={note} onChangeText={(value) => { setNote(value); setProblem(null); }} multiline maxLength={4000}
      placeholder={outcome && !rules.noteRequired ? t('Noted as an attempt if you leave it empty') : t('What did you discuss?')} />
    {rules.followUp ? <Stack gap={2}>
      <Text variant="label" tone="secondary">{rules.followUpRequired ? t('Come back on') : t('Next follow-up')}</Text>
      <Row gap={2} wrap>{picks.map((pick) => <Chip key={pick.id} label={pickLabel(pick.id, pick.at)} selected={nextAt === pick.at} onPress={() => setAt(pick.at)} />)}</Row>
      <Row gap={2}>
        <View style={{ flex: 1 }}><DateField label={t('Day')} value={day} onChange={(value) => { setDay(value); if (!time) setTime('10:00'); setProblem(null); }} min={format.today()} placeholder={t('Not set')} /></View>
        <View style={{ flex: 1 }}><DateField label={t('Time')} value={time} onChange={(value) => { setTime(value); setProblem(null); }} mode="time" disabled={!day} /></View>
      </Row>
      {day && !rules.followUpRequired ? <Button label={t('No follow-up')} variant="ghost" size="sm" onPress={() => { setDay(''); setTime(''); }} /> : null}
    </Stack> : null}
  </Sheet>;
}

/** The next call or visit, on my calendar with the time in the workspace's zone. */
function ScheduleSheet({ leadId, name, open, onClose }: { leadId: string; name: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const format = useFormat();
  const session = useSession();
  const [type, setType] = useState<'call' | 'meeting' | 'task'>('call');
  const [title, setTitle] = useState('');
  const [day, setDay] = useState(addDays(format.today(), 1));
  const [time, setTime] = useState('10:00');
  const command = useSalesCommand((api, body: Record<string, unknown>) => api.send('crm/activities', 'POST', body));
  useEffect(() => { if (open) setTitle(type === 'call' ? t('Call {name}', { name }) : type === 'meeting' ? t('Meet {name}', { name }) : t('Follow up with {name}', { name })); }, [open, type]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const dueAt = format.instant(day, time);
    if (new Date(dueAt).getTime() < Date.now()) { toast.error(t('Choose a time in the future.')); return; }
    try {
      await command.mutateAsync({ type, title: title.trim().slice(0, 240), leadId, ownerMembershipId: session.membershipId || undefined, priority: 'normal', dueAt,
        ...(type !== 'task' ? { durationMinutes: 30 } : {}), isNextAction: true, customerVisible: false });
      toast.success(t('Follow-up scheduled'));
      onClose();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  return <Sheet open={open} onClose={onClose} title={t('Schedule follow-up')}
    footer={<Button label={t('Schedule')} variant="primary" size="lg" full disabled={!title.trim() || !day || !time} loading={command.isPending} onPress={save} />}>
    <SegmentedControl value={type} onChange={setType} options={[{ value: 'call', label: t('Call') }, { value: 'meeting', label: t('Meeting') }, { value: 'task', label: t('Task') }]} />
    <TextField label={t('What')} value={title} onChangeText={setTitle} maxLength={240} />
    <Row gap={2}><View style={{ flex: 1 }}><DateField label={t('Day')} value={day} onChange={setDay} min={format.today()} /></View>
      <View style={{ flex: 1 }}><DateField label={t('Time')} value={time} onChange={setTime} mode="time" /></View></Row>
  </Sheet>;
}

/** My follow-ups: late first, then today and what's coming; one tap opens the enquiry, another marks it done. */
export function FollowUpsScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const toast = useToast();
  const session = useSession();
  const activities = useActivities({ ownerMembershipId: session.membershipId, status: 'pending' }, !!session.membershipId);
  const [done, setDone] = useState<Activity | null>(null);
  const [outcome, setOutcome] = useState('');
  const complete = useSalesCommand((api, input: { id: string; version: number; outcome: string }) => api.send(`crm/activities/${input.id}/complete`, 'POST', { version: input.version, ...(input.outcome ? { outcome: input.outcome } : {}) }));
  // Today and notices open the follow-up they're about.
  const { record } = useLocalSearchParams<{ record?: string }>();
  const linked = useRef<string | null>(null);
  useEffect(() => {
    if (!record || linked.current === record || !activities.data) return;
    linked.current = record;
    const found = activities.data.data.find((item) => item.id === record);
    if (found) setDone(found);
  }, [record, activities.data]);
  const today = format.today();
  const items = [...(activities.data?.data ?? [])].filter((item) => item.type !== 'note').sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
  const group = (item: Activity) => {
    if (!item.dueAt) return t('No date');
    const day = format.dayOf(item.dueAt);
    return item.dueAt < new Date().toISOString() && day < today ? t('Late') : day === today ? t('Today') : day <= addDays(today, 6) ? t('This week') : t('Later');
  };
  return <>
    <ListScreen title={t('Follow-ups')} back items={items} keyExtractor={(item) => item.id} groupBy={group}
      loading={activities.isLoading} error={activities.error ? errorMessage(activities.error, t('Follow-ups could not be loaded.')) : null} onRetry={() => void activities.refetch()}
      onRefresh={() => void activities.refetch()} refreshing={activities.isRefetching}
      empty={<Empty icon={CalendarCheck} title={t('No follow-ups due')} />}
      renderItem={(item, _, first) => <ListRow first={first} icon={item.type === 'call' ? PhoneCall : item.type === 'meeting' ? Users : CalendarCheck}
        iconTone={item.dueAt && item.dueAt < new Date().toISOString() ? 'danger' : 'action'} title={item.title}
        detail={[item.partyName ?? item.leadTitle, item.dueAt ? format.when(item.dueAt) : null].filter(Boolean).join(' · ')}
        onPress={() => setDone(item)} />} />
    <Sheet open={!!done} onClose={() => setDone(null)} title={done?.title} subtitle={[done?.partyName ?? done?.leadTitle, done?.dueAt ? format.when(done.dueAt) : null].filter(Boolean).join(' · ')}
      footer={<>
        <Button label={t('Mark done')} icon={Check} variant="primary" size="lg" full loading={complete.isPending} onPress={async () => {
          if (!done) return;
          try { await complete.mutateAsync({ id: done.id, version: done.version, outcome: outcome.trim().slice(0, 120) }); toast.success(t('Done')); setDone(null); setOutcome(''); }
          catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
        }} />
        {done?.leadId ? <Button label={t('Open enquiry')} variant="ghost" full onPress={() => { const leadId = done.leadId; setDone(null); router.push(`/sales/${leadId}`); }} /> : null}
      </>}>
      <TextField label={t('Outcome')} value={outcome} onChangeText={setOutcome} maxLength={120} placeholder={t('Optional')} />
    </Sheet>
  </>;
}

/** Opportunities: mine or everyone's, open ones, with their stage and next step. */
export function OpportunitiesScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const session = useSession();
  const [who, setWho] = useState<'mine' | 'all'>('mine');
  const [status, setStatus] = useState<'open' | 'won' | 'lost'>('open');
  const list = useOpportunities({ status, ownerMembershipId: who === 'mine' ? session.membershipId : '' });
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data]);
  const theme = useTheme();
  return <ListScreen title={t('Opportunities')} back items={rows} keyExtractor={(item) => item.id}
    toolbar={<View style={{ gap: theme.space(3) }}>
      <SegmentedControl value={who} onChange={setWho} options={[{ value: 'mine', label: t('Mine') }, { value: 'all', label: t('Everyone') }]} />
      <FilterChips value={status} onChange={setStatus} options={[{ value: 'open', label: t('Open') }, { value: 'won', label: t('Won') }, { value: 'lost', label: t('Lost') }]} />
    </View>}
    loading={list.isLoading} error={list.error ? errorMessage(list.error, t('Opportunities could not be loaded.')) : null} onRetry={() => void list.refetch()}
    onRefresh={() => void list.refetch()} refreshing={list.isRefetching && !list.isFetchingNextPage}
    onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
    empty={<Empty icon={Handshake} title={t('No opportunities here')} />}
    renderItem={(item, _, first) => <ListRow first={first} title={item.title} onPress={() => router.push(`/sales/opportunity/${item.id}`)}
      detail={[item.partyName, item.stageName, item.amount ? format.money(item.amount, item.currencyCode ?? undefined) : null].filter(Boolean).join(' · ')}
      meta={item.nextActionAt ? <Text variant="caption" tone="tertiary">{t('Next {when}', { when: format.when(item.nextActionAt) })}</Text> : undefined}
      trailing={<StatusChip status={item.status} />} />} />;
}

const FUNNEL: Record<string, string> = { enquiry: key('Enquiry'), discovery: key('Discovery'), intro: key('Intro meeting'), design: key('Design'), quote: key('Quote'), deal: key('Deal') };

/** One opportunity: its stage, where it is in the funnel, the team and the next step. */
export function OpportunityScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useOpportunity(id);
  if (item.isLoading) return <Screen back><Loading shape="record" count={3} /></Screen>;
  if (item.error || !item.data) return <Screen back><Failure message={errorMessage(item.error, t('This opportunity could not be loaded.'))} onRetry={() => void item.refetch()} /></Screen>;
  const data = item.data;
  return <Screen back title={data.title} subtitle={[data.enquiryReference, data.partyName].filter(Boolean).join(' · ')} onRefresh={() => void item.refetch()} refreshing={item.isRefetching}
    footer={data.leadId ? <Button label={t('Open enquiry')} variant="secondary" size="lg" full onPress={() => router.push(`/sales/${data.leadId}`)} /> : undefined}>
    <Row gap={2}><StatusChip status={data.status} />{data.stageName ? <Chip label={data.stageName} tone="info" /> : null}</Row>
    <Section>
      {data.amount ? <Fact first label={t('Value')} value={format.money(data.amount, data.currencyCode ?? undefined)} /> : null}
      {data.ownerName ? <Fact first={!data.amount} label={t('Owner')} value={data.ownerName} /> : null}
      {data.nextActionAt ? <Fact label={t('Next step')} value={format.when(data.nextActionAt)} /> : null}
      {data.expectedCloseAt ? <Fact label={t('Expected close')} value={format.day(data.expectedCloseAt.slice(0, 10))} /> : null}
    </Section>
    {data.funnel?.length ? <Section title={t('Funnel')}>
      {data.funnel.map((step, index) => <ListRow key={step.key} first={index === 0} title={t(FUNNEL[step.key] ?? step.key)} detail={step.detail ?? undefined}
        trailing={<StatusChip status={step.state === 'done' ? 'done' : step.state === 'upcoming' ? 'upcoming' : 'current'} />} />)}
    </Section> : null}
    {data.team?.length ? <Section title={t('Team')}>
      {data.team.map((member, index) => <Fact key={member.membershipId} first={index === 0} label={member.role} value={member.name} />)}
    </Section> : null}
  </Screen>;
}

/** Choose an enquiry for a quick capture (log a call, schedule a follow-up). */
export function PickLeadScreen({ next }: { next: 'log' | 'schedule' }) {
  const t = useT();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const leads = useLeads({ mine: debounced ? '' : 'true', search: debounced });
  const rows = (leads.data?.pages.flatMap((page) => page.data) ?? []).filter((lead) => !CLOSED_LEAD_STATUSES.has(lead.status));
  return <ListScreen title={next === 'log' ? t('Log a call') : t('Follow-up')} back items={rows} keyExtractor={(lead) => lead.id}
    toolbar={<SearchField value={search} onChange={setSearch} placeholder={t('Which enquiry?')} autoFocus />}
    loading={leads.isLoading} error={leads.error ? errorMessage(leads.error, t('Enquiries could not be loaded.')) : null} onRetry={() => void leads.refetch()}
    empty={<Empty icon={Users} title={t('No enquiries here')} />}
    renderItem={(lead, _, first) => <ListRow first={first} title={leadName(lead)} detail={[lead.reference, lead.source].filter(Boolean).join(' · ')} trailing={<StatusChip status={lead.status} />}
      onPress={() => router.replace({ pathname: '/sales/[id]', params: next === 'log' ? { id: lead.id, log: '1' } : { id: lead.id, schedule: '1' } })} />} />;
}
