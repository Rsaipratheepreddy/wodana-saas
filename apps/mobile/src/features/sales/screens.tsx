import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarCheck, CalendarPlus, Check, Handshake, Mail, MessageCircle, NotebookPen, Phone, PhoneCall, Users } from 'lucide-react-native';
import { errorMessage } from '../../core/api';
import { mailLink, telLink, whatsappLink } from '../../core/contact';
import { addDays, useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { useSession } from '../../core/session';
import { DateField } from '../../ui/date-field';
import { FilterChips, SearchField, SegmentedControl, TextField } from '../../ui/fields';
import { Banner, Empty, Failure, Fact, ListRow, ListScreen, Loading, Screen, Section } from '../../ui/layout';
import { Button, Chip, IconButton, Row, Stack, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { useActivities, useLead, useLeads, useOpportunities, useOpportunity, useSalesCommand, type Activity, type LeadDetail, type LeadRow } from './api';

const OUTCOMES = [
  { value: 'willing_to_talk', label: key('Willing to talk') }, { value: 'no_answer', label: key('No answer') }, { value: 'message_sent_no_reply', label: key('Message sent, no reply') },
  { value: 'come_back_later', label: key('Come back later') }, { value: 'not_interested', label: key('Not interested') }, { value: 'unreachable', label: key('Unreachable') },
] as const;
const CHANNELS = [{ value: 'call', label: key('Call') }, { value: 'whatsapp', label: key('WhatsApp') }, { value: 'email', label: key('Email') }, { value: 'meeting', label: key('Meeting') }] as const;
type Channel = (typeof CHANNELS)[number]['value'];
type Outcome = (typeof OUTCOMES)[number]['value'];
const CLOSED = ['qualified', 'disqualified', 'duplicate'];

const leadName = (lead: Pick<LeadRow, 'partyName' | 'title' | 'reference'>) => lead.partyName || lead.title || lead.reference || '—';

/** Enquiries: mine by default, by where they are in the funnel, searchable; the list pages as you scroll. */
export function LeadsScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const [who, setWho] = useState<'mine' | 'all'>('mine');
  const [funnel, setFunnel] = useState<'new' | 'contacted' | 'come_back' | 'all'>('new');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const leads = useLeads({ mine: who === 'mine' ? 'true' : '', funnel: funnel === 'all' ? '' : funnel, search: debounced });
  const rows = useMemo(() => leads.data?.pages.flatMap((page) => page.data) ?? [], [leads.data]);
  const now = new Date().toISOString();
  return <ListScreen title={t('Enquiries')} back items={rows} keyExtractor={(lead) => lead.id}
    toolbar={<View style={{ gap: theme.space(3) }}>
      <SearchField value={search} onChange={setSearch} placeholder={t('Name or reference')} />
      <SegmentedControl value={who} onChange={setWho} options={[{ value: 'mine', label: t('Mine') }, { value: 'all', label: t('Everyone') }]} />
      <FilterChips value={funnel} onChange={setFunnel} options={[{ value: 'new', label: t('New') }, { value: 'contacted', label: t('Contacted') }, { value: 'come_back', label: t('Come back') }, { value: 'all', label: t('All') }]} />
    </View>}
    loading={leads.isLoading} error={leads.error ? errorMessage(leads.error, t('Enquiries could not be loaded.')) : null} onRetry={() => void leads.refetch()}
    onRefresh={() => void leads.refetch()} refreshing={leads.isRefetching && !leads.isFetchingNextPage}
    onEndReached={() => { if (leads.hasNextPage && !leads.isFetchingNextPage) void leads.fetchNextPage(); }}
    empty={<Empty icon={Users} title={debounced ? t('Nothing matches') : t('No enquiries here')} />}
    renderItem={(lead, _, first) => <ListRow first={first} title={leadName(lead)} onPress={() => router.push(`/sales/${lead.id}`)}
      detail={[lead.reference, lead.source, lead.details?.area ?? lead.details?.location].filter(Boolean).join(' · ')}
      meta={lead.nextActionAt ? <Text variant="caption" tone={lead.nextActionAt < now ? 'danger' : 'tertiary'}>{t('Next {when}', { when: format.when(lead.nextActionAt) })}</Text>
        : lead.slaDueAt && lead.status === 'new' ? <Text variant="caption" tone={lead.slaStatus === 'breached' ? 'danger' : 'warning'}>{t('Respond by {when}', { when: format.when(lead.slaDueAt) })}</Text> : undefined}
      trailing={<StatusChip status={lead.status} />} />} />;
}

/** One enquiry: call, WhatsApp or email in one tap; log what happened; schedule the next follow-up. */
export function LeadScreen() {
  const t = useT();
  const router = useRouter();
  const format = useFormat();
  const session = useSession();
  const { id, log, schedule } = useLocalSearchParams<{ id: string; log?: string; schedule?: string }>();
  const lead = useLead(id);
  const activities = useActivities({ leadId: id });
  const [logging, setLogging] = useState<Channel | null>(log ? 'call' : null);
  const [scheduling, setScheduling] = useState(!!schedule);
  const calledAt = useRef<{ channel: Channel; at: number } | null>(null);
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
  const open = (url: string | null, channel?: Channel) => { if (!url) return; if (channel) calledAt.current = { channel, at: Date.now() }; void Linking.openURL(url).catch(() => undefined); };
  const canManage = session.can('crm.leads.manage');
  const canPlan = session.can('crm.activities.manage');
  const closed = CLOSED.includes(data.status);
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
    </Section>
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
  return <ListRow first={first} icon={icon} iconTone={item.status === 'pending' ? 'action' : 'neutral'} title={item.title}
    detail={[item.description, item.completionOutcome].filter(Boolean).join(' · ') || undefined}
    meta={<Text variant="caption" tone="tertiary">{[item.status === 'pending' ? t('Due {when}', { when: format.when(item.dueAt) }) : format.when(item.completedAt ?? item.createdAt), item.ownerName].filter(Boolean).join(' · ')}</Text>} />;
}

/** What happened when you contacted them; the outcome moves the enquiry on (the server decides how). */
function LogContactSheet({ lead, channel: initial, onClose }: { lead: LeadDetail; channel: Channel | null; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const format = useFormat();
  const leadQuery = useLead(lead.id);
  const [channel, setChannel] = useState<Channel>('call');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [day, setDay] = useState(addDays(format.today(), 1));
  const [time, setTime] = useState('10:00');
  useEffect(() => { if (initial) { setChannel(initial); setOutcome(null); setNote(''); setReason(''); } }, [initial]);
  const command = useSalesCommand((api, body: Record<string, unknown>) => api.send(`crm/leads/${lead.id}/contacts`, 'POST', body));
  const needsDate = outcome === 'come_back_later';
  const ready = !!outcome && note.trim().length > 0 && (outcome !== 'not_interested' || reason.trim().length > 0) && (!needsDate || (!!day && !!time));
  const save = async () => {
    try {
      const fresh = (await leadQuery.refetch()).data ?? lead;
      await command.mutateAsync({ version: fresh.version, channel, outcome, note: note.trim().slice(0, 4000), ...(outcome === 'not_interested' ? { reason: reason.trim().slice(0, 160) } : {}),
        ...(needsDate ? { nextActionAt: format.instant(day, time) } : {}) });
      toast.success(t('Logged'));
      onClose();
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };
  return <Sheet open={!!initial} onClose={onClose} title={t('Log contact')} full
    footer={<Button label={t('Save')} variant="primary" size="lg" full disabled={!ready} loading={command.isPending} onPress={save} />}>
    <SegmentedControl value={channel} onChange={setChannel} options={CHANNELS.map((option) => ({ value: option.value, label: t(option.label) }))} />
    <Stack gap={2}>
      <Text variant="label" tone="secondary">{t('How did it go?')}</Text>
      <Row gap={2} wrap>{OUTCOMES.map((option) => <Chip key={option.value} label={t(option.label)} selected={outcome === option.value} onPress={() => setOutcome(option.value)} />)}</Row>
    </Stack>
    {outcome === 'not_interested' ? <TextField label={t('Why')} value={reason} onChangeText={setReason} maxLength={160} /> : null}
    {needsDate ? <Row gap={2}><View style={{ flex: 1 }}><DateField label={t('Come back on')} value={day} onChange={setDay} min={format.today()} /></View>
      <View style={{ flex: 1 }}><DateField label={t('At')} value={time} onChange={setTime} mode="time" /></View></Row> : null}
    <TextField label={t('Note')} value={note} onChangeText={setNote} multiline maxLength={4000} placeholder={t('What did you talk about?')} />
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
  const rows = (leads.data?.pages.flatMap((page) => page.data) ?? []).filter((lead) => !CLOSED.includes(lead.status));
  return <ListScreen title={next === 'log' ? t('Log a call') : t('Follow-up')} back items={rows} keyExtractor={(lead) => lead.id}
    toolbar={<SearchField value={search} onChange={setSearch} placeholder={t('Which enquiry?')} autoFocus />}
    loading={leads.isLoading} error={leads.error ? errorMessage(leads.error, t('Enquiries could not be loaded.')) : null} onRetry={() => void leads.refetch()}
    empty={<Empty icon={Users} title={t('No enquiries here')} />}
    renderItem={(lead, _, first) => <ListRow first={first} title={leadName(lead)} detail={[lead.reference, lead.source].filter(Boolean).join(' · ')} trailing={<StatusChip status={lead.status} />}
      onPress={() => router.replace({ pathname: '/sales/[id]', params: next === 'log' ? { id: lead.id, log: '1' } : { id: lead.id, schedule: '1' } })} />} />;
}
