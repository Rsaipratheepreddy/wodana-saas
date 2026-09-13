import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '../design-system';
import { Icon, type IconName } from '../components/icon';
import { DateField } from '../hrms/date-field';
import { Button, CallButton, Choice, EmptyState, HorizontalFilters, Metric, Notice, RecordCard, ResourceState, SearchBox, SectionHeading, Sheet, TextField } from './ui';
import { crmContact, crmDate, crmLabel, crmNumber, crmRows, useCrm, useCrmActions, type CrmRecord } from './api';

type Props = { workspaceId: string; revision: number; refresh: () => void };
type MoreSection = 'people' | 'companies' | 'activities' | 'calendar' | 'sequences' | 'automations' | 'reports';
const getText = (value: unknown, fallback = 'Not set') => typeof value === 'string' && value.trim() ? value : fallback;
const errorText = (value: unknown) => value instanceof Error ? value.message : 'The CRM action could not be completed.';
const tomorrow = () => { const value = new Date(Date.now() + 86_400_000); const pad = (part: number) => String(part).padStart(2, '0'); return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`; };

const sections: { id: MoreSection; label: string; detail: string; icon: IconName; group: string }[] = [
  { id: 'people', label: 'People', detail: 'Customer contacts and details', icon: 'profile', group: 'Customers' },
  { id: 'companies', label: 'Companies', detail: 'Organizations and relationships', icon: 'crm', group: 'Customers' },
  { id: 'activities', label: 'Activities', detail: 'Tasks, calls, notes, and meetings', icon: 'check', group: 'Work' },
  { id: 'calendar', label: 'Calendar', detail: 'Scheduled CRM commitments', icon: 'calendar', group: 'Work' },
  { id: 'sequences', label: 'Sequences', detail: 'Multi-step customer follow-up', icon: 'arrow-right', group: 'Operations' },
  { id: 'automations', label: 'Automations', detail: 'Workflow health and approvals', icon: 'more', group: 'Operations' },
  { id: 'reports', label: 'Reports', detail: 'Sources, pipeline, SLA, and forecast', icon: 'crm', group: 'Insights' },
];

export function MoreView({ initialSection, onSectionChange, ...props }: Props & { initialSection?: MoreSection; onSectionChange?: () => void }) {
  const [section, setSection] = useState<MoreSection | null>(initialSection ?? null);
  const { colors } = useTheme();
  const show = (next: MoreSection | null) => { setSection(next); onSectionChange?.(); };
  if (section) return <View style={{ gap: 14 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back to CRM sections" onPress={() => show(null)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name="arrow-left" size={20} /><Text size="sm" weight="semibold">All CRM sections</Text>
    </Pressable>
    {section === 'people' ? <PartiesView {...props} type="person" /> : section === 'companies' ? <PartiesView {...props} type="organization" />
      : section === 'activities' ? <ActivitiesView {...props} /> : section === 'calendar' ? <CalendarView {...props} />
        : section === 'sequences' ? <SequencesView {...props} /> : section === 'automations' ? <AutomationsView {...props} /> : <ReportsView {...props} />}
  </View>;
  return <View style={{ gap: 14 }}>
    <SectionHeading title="More CRM" subtitle="Customer records, daily work, automation, and reporting." />
    {['Customers', 'Work', 'Operations', 'Insights'].map(group => <View key={group} style={{ gap: 8 }}>
      <Text size="xs" weight="semibold" tone="textTertiary" style={{ textTransform: 'uppercase', letterSpacing: 0.7 }}>{group}</Text>
      <View style={{ borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        {sections.filter(item => item.group === group).map((item, index, items) => <MoreCard key={item.id} item={item} last={index === items.length - 1} onPress={() => show(item.id)} />)}
      </View>
    </View>)}
  </View>;
}

function MoreCard({ item, last, onPress }: { item: typeof sections[number]; last: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.label}`} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 70, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: pressed ? colors.surfacePressed : colors.surface,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 13 })}>
    <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted }}><Icon name={item.icon} color={colors.actionPrimary} /></View>
    <View style={{ flex: 1 }}><Text weight="semibold">{item.label}</Text><Text size="xs" tone="textSecondary">{item.detail}</Text></View><Icon name="chevron-right" size={18} color={colors.iconSubtle} />
  </Pressable>;
}

function primaryContact(row: CrmRecord, type: string) {
  return getText(crmContact(row, type === 'phone' ? 'phone' : 'email'), 'Not added');
}

function PartiesView({ workspaceId, revision, refresh, type }: Props & { type: 'person' | 'organization' }) {
  const resource = useCrm<unknown>(workspaceId, `parties?type=${type}&includeArchived=true&limit=100`, revision);
  const rows = crmRows(resource.data); const [search, setSearch] = useState(''); const [filter, setFilter] = useState('active');
  const [selected, setSelected] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const visible = rows.filter(row => (filter === 'all' || row.status === filter || row.lifecycle === filter) && `${row.displayName ?? ''} ${primaryContact(row, 'email')} ${primaryContact(row, 'phone')}`.toLowerCase().includes(search.toLowerCase()));
  return <View style={{ gap: 14 }}>
    <SectionHeading title={type === 'person' ? 'People' : 'Companies'} subtitle={type === 'person' ? 'Contact details and customer history.' : 'Organizations and their customer relationships.'} action={<Button label="Add" onPress={() => setCreating(true)} />} />
    <SearchBox value={search} onChange={setSearch} placeholder={`Search ${type === 'person' ? 'people' : 'companies'}`} />
    <HorizontalFilters value={filter} onChange={setFilter} items={['active', 'prospect', 'customer', 'archived', 'all'].map(id => ({ id, label: crmLabel(id) }))} />
    <ResourceState loading={resource.loading} error={resource.error} empty={!visible.length} emptyTitle={`No ${type === 'person' ? 'people' : 'companies'} in this view`}>
      {visible.map(row => <RecordCard key={row.id} title={getText(row.displayName)} subtitle={primaryContact(row, 'email')} status={String(row.lifecycle)} meta={primaryContact(row, 'phone')} phone={crmContact(row, 'phone') || undefined} onPress={() => setSelected(row.id)} />)}
    </ResourceState>
    {selected ? <PartySheet workspaceId={workspaceId} partyId={selected} onClose={() => setSelected(null)} onSaved={refresh} /> : null}
    {creating ? <CreatePartySheet workspaceId={workspaceId} type={type} onClose={() => setCreating(false)} onSaved={refresh} /> : null}
  </View>;
}

function PartySheet({ workspaceId, partyId, onClose, onSaved }: { workspaceId: string; partyId: string; onClose: () => void; onSaved: () => void }) {
  const [revision, setRevision] = useState(0); const resource = useCrm<CrmRecord>(workspaceId, `parties/${partyId}`, revision); const action = useCrmActions(workspaceId);
  const [name, setName] = useState(''); const [lifecycle, setLifecycle] = useState(''); const [contactType, setContactType] = useState('email'); const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState(''); const row = resource.data;
  const reload = () => { setRevision(value => value + 1); onSaved(); };
  const edit = async () => { if (!row) return; setBusy(true); setFeedback(''); try {
    await action(`parties/${partyId}`, 'PATCH', { version: crmNumber(row.version), ...(name.trim() ? { displayName: name.trim() } : {}), ...(lifecycle ? { lifecycle } : {}) });
    setName(''); setLifecycle(''); setFeedback('Customer profile updated.'); reload();
  } catch (error) { setFeedback(errorText(error)); } finally { setBusy(false); } };
  const addContact = async () => { if (!contact.trim()) return; setBusy(true); setFeedback(''); try {
    await action(`parties/${partyId}/contact-points`, 'POST', { type: contactType, value: contact.trim(), isPrimary: true }); setContact(''); setFeedback('Contact added.'); reload();
  } catch (error) { setFeedback(errorText(error)); } finally { setBusy(false); } };
  const archive = async () => { if (!row) return; setBusy(true); setFeedback(''); try { await action(`parties/${partyId}/archive`, 'POST', { version: crmNumber(row.version), reason: 'Archived from mobile CRM' }); setFeedback('Customer archived.'); reload(); }
    catch (error) { setFeedback(errorText(error)); } finally { setBusy(false); } };
  const contacts = Array.isArray(row?.contacts) ? row.contacts as CrmRecord[] : []; const addresses = Array.isArray(row?.addresses) ? row.addresses as CrmRecord[] : [];
  return <Sheet title={getText(row?.displayName, 'Customer details')} onClose={onClose}>
    <ResourceState loading={resource.loading} error={resource.error} />
    {row ? <>
      <RecordCard title={getText(row.displayName)} subtitle={getText(row.jobTitle ?? row.industry, crmLabel(row.type))} status={String(row.lifecycle)} meta={crmLabel(row.status)} />
      <View style={{ gap: 10 }}><Text weight="semibold">Update profile</Text><TextField label="Name" value={name} onChangeText={setName} placeholder={getText(row.displayName)} />
        <Choice label="Lifecycle" value={lifecycle} onChange={setLifecycle} options={['prospect', 'customer', 'partner', 'vendor', 'other'].map(value => ({ value, label: crmLabel(value) }))} />
        <Button label="Save profile" variant="secondary" disabled={(!name.trim() && !lifecycle) || busy} onPress={edit} /></View>
      <View style={{ gap: 10 }}><Text weight="semibold">Contact details</Text>{contacts.map(item => <RecordCard key={item.id} title={getText(item.rawValue ?? item.value)} status={String(item.type)} meta={item.isPrimary ? 'Primary' : undefined} phone={item.type === 'phone' ? getText(item.rawValue ?? item.value, '') : undefined} />)}
        <Choice label="Contact type" value={contactType} onChange={setContactType} options={['email', 'phone', 'social', 'other'].map(value => ({ value, label: crmLabel(value) }))} />
        <TextField label="Contact value" value={contact} onChangeText={setContact} autoCapitalize="none" /><Button label="Add contact" variant="secondary" disabled={!contact.trim() || busy} onPress={addContact} /></View>
      {addresses.length ? <View style={{ gap: 8 }}><Text weight="semibold">Addresses</Text>{addresses.map(item => <RecordCard key={item.id} title={getText(item.label, 'Address')} subtitle={[item.line1, item.locality, item.region, item.postalCode, item.countryCode].filter(Boolean).join(', ')} />)}</View> : null}
      {row.status === 'active' ? <Button label="Archive record" variant="ghost" disabled={busy} onPress={archive} /> : null}
      {feedback ? <Notice error={!feedback.includes('updated') && !feedback.includes('added') && !feedback.includes('archived')}>{feedback}</Notice> : null}
    </> : null}
  </Sheet>;
}

function CreatePartySheet({ workspaceId, type, onClose, onSaved }: { workspaceId: string; type: 'person' | 'organization'; onClose: () => void; onSaved: () => void }) {
  const action = useCrmActions(workspaceId); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState('');
  const [industry, setIndustry] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async () => { setBusy(true); setError(''); try {
    await action('parties', 'POST', { type, displayName: name.trim(), ...(type === 'organization' && industry.trim() ? { industry: industry.trim(), legalName: name.trim() } : {}),
      contacts: [email.trim() && { type: 'email', value: email.trim(), isPrimary: true }, phone.trim() && { type: 'phone', value: phone.trim(), isPrimary: true }].filter(Boolean) }); onSaved(); onClose();
  } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } };
  return <Sheet title={`New ${type === 'person' ? 'person' : 'company'}`} onClose={onClose}>
    <TextField label="Name" value={name} onChangeText={setName} />{type === 'organization' ? <TextField label="Industry" value={industry} onChangeText={setIndustry} /> : null}
    <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" /><TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
    {error ? <Notice error>{error}</Notice> : null}<Button label={busy ? 'Creating…' : 'Create record'} loading={busy} disabled={!name.trim()} onPress={save} />
  </Sheet>;
}

function ActivitiesView({ workspaceId, revision, refresh }: Props) {
  const resource = useCrm<unknown>(workspaceId, 'activities?limit=100', revision); const rows = crmRows(resource.data); const [filter, setFilter] = useState('pending'); const [selected, setSelected] = useState<CrmRecord | null>(null); const [creating, setCreating] = useState(false);
  const visible = rows.filter(row => filter === 'all' || row.status === filter || (filter === 'overdue' && row.status === 'pending' && typeof row.dueAt === 'string' && Date.parse(row.dueAt) < Date.now()));
  return <View style={{ gap: 14 }}><SectionHeading title="Activities" subtitle="Calls, meetings, notes, and next actions." action={<Button label="Add" onPress={() => setCreating(true)} />} />
    <HorizontalFilters value={filter} onChange={setFilter} items={['pending', 'overdue', 'completed', 'all'].map(id => ({ id, label: crmLabel(id) }))} />
    <ResourceState loading={resource.loading} error={resource.error} empty={!visible.length} emptyTitle="No activities in this view">
      {visible.map(row => <RecordCard key={row.id} title={getText(row.title)} subtitle={getText(row.description, crmLabel(row.type))} status={String(row.status)} meta={`${crmLabel(row.priority)} · ${crmDate(row.dueAt, true)}`} onPress={() => setSelected(row)} />)}
    </ResourceState>{selected ? <ActivitySheet workspaceId={workspaceId} row={selected} onClose={() => setSelected(null)} onSaved={refresh} /> : null}
    {creating ? <CreateActivitySheet workspaceId={workspaceId} onClose={() => setCreating(false)} onSaved={refresh} /> : null}</View>;
}

function ActivitySheet({ workspaceId, row, onClose, onSaved }: { workspaceId: string; row: CrmRecord; onClose: () => void; onSaved: () => void }) {
  const action = useCrmActions(workspaceId); const [outcome, setOutcome] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const party = useCrm<CrmRecord>(workspaceId, typeof row.partyId === 'string' ? `parties/${row.partyId}` : null);
  const phone = crmContact(party.data, 'phone');
  const complete = async () => { setBusy(true); setError(''); try { await action(`activities/${row.id}/complete`, 'POST', { version: crmNumber(row.version), outcome: outcome.trim() || undefined }); onSaved(); onClose(); }
    catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } };
  return <Sheet title={getText(row.title)} onClose={onClose}><RecordCard title={crmLabel(row.type)} subtitle={getText(row.description, 'No notes')} status={String(row.status)} meta={crmDate(row.dueAt, true)} />
    {phone ? <CallButton phone={phone} label="Call customer" /> : null}
    {row.status === 'pending' ? <><TextField label="Outcome" value={outcome} onChangeText={setOutcome} placeholder="Called customer; quotation requested" /><Button label="Complete activity" loading={busy} onPress={complete} /></> : null}{error ? <Notice error>{error}</Notice> : null}</Sheet>;
}

function CreateActivitySheet({ workspaceId, onClose, onSaved }: { workspaceId: string; onClose: () => void; onSaved: () => void }) {
  const parties = useCrm<unknown>(workspaceId, 'parties?limit=100'); const action = useCrmActions(workspaceId); const [partyId, setPartyId] = useState(''); const [type, setType] = useState('task');
  const [title, setTitle] = useState(''); const [notes, setNotes] = useState(''); const [dueDate, setDueDate] = useState(tomorrow); const [dueTime, setDueTime] = useState('10:00'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async () => { setBusy(true); setError(''); try { await action('activities', 'POST', { ...(partyId ? { partyId } : {}), type, title: title.trim(), description: notes.trim() || undefined,
      dueAt: new Date(`${dueDate}T${dueTime}:00`).toISOString(), priority: 'normal', isNextAction: false }); onSaved(); onClose(); } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } };
  return <Sheet title="New activity" onClose={onClose}><ResourceState loading={parties.loading} error={parties.error} />
    <Choice label="Customer (optional)" value={partyId} onChange={setPartyId} options={[{ value: '', label: 'No customer' }, ...crmRows(parties.data).map(row => ({ value: row.id, label: getText(row.displayName) }))]} />
    <Choice label="Activity type" value={type} onChange={setType} options={['task', 'call', 'meeting', 'email', 'whatsapp', 'note'].map(value => ({ value, label: crmLabel(value) }))} />
    <TextField label="Title" value={title} onChangeText={setTitle} /><DateField label="Due date" value={dueDate} onChange={setDueDate} /><DateField label="Time" value={dueTime} onChange={setDueTime} mode="time" /><TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
    {error ? <Notice error>{error}</Notice> : null}<Button label="Create activity" loading={busy} disabled={!title.trim()} onPress={save} /></Sheet>;
}

function CalendarView({ workspaceId, revision, refresh }: Props) {
  const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString(); const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 31).toISOString();
  const resource = useCrm<unknown>(workspaceId, `activities?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`, revision);
  const rows = crmRows(resource.data).filter(row => row.dueAt).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  const groups = useMemo(() => rows.reduce<Record<string, CrmRecord[]>>((all, row) => { const key = crmDate(row.dueAt); (all[key] ??= []).push(row); return all; }, {}), [rows]);
  const [selected, setSelected] = useState<CrmRecord | null>(null);
  return <View style={{ gap: 14 }}><SectionHeading title="Calendar" subtitle="Your next 30 days of customer commitments." />
    <ResourceState loading={resource.loading} error={resource.error} empty={!rows.length} emptyTitle="No scheduled CRM work">
      {Object.entries(groups).map(([day, items]) => <View key={day} style={{ gap: 9 }}><Text weight="semibold">{day}</Text>{items.map(row => <RecordCard key={row.id} title={getText(row.title)} subtitle={getText(row.partyName, crmLabel(row.type))} status={String(row.status)} meta={crmDate(row.dueAt, true)} onPress={() => setSelected(row)} />)}</View>)}
    </ResourceState>{selected ? <ActivitySheet workspaceId={workspaceId} row={selected} onClose={() => setSelected(null)} onSaved={refresh} /> : null}</View>;
}

function SequencesView({ workspaceId, revision, refresh }: Props) {
  const resource = useCrm<unknown>(workspaceId, 'sequences', revision); const rows = crmRows(resource.data); const [selected, setSelected] = useState<CrmRecord | null>(null);
  return <View style={{ gap: 14 }}><View style={{ gap: 4 }}><Text size="xl" weight="bold">Sequences</Text><Text size="sm" tone="textSecondary">Consistent follow-up across email, WhatsApp, and tasks.</Text></View>
    <ResourceState loading={resource.loading} error={resource.error} empty={!rows.length} emptyTitle="No follow-up sequences">
      {rows.map(row => <RecordCard key={row.id} title={getText(row.name)} subtitle={`${Array.isArray(row.steps) ? row.steps.length : 0} steps`} status={String(row.status)} meta={`Version ${crmNumber(row.version)}`} onPress={() => setSelected(row)} />)}
    </ResourceState>{selected ? <SequenceSheet workspaceId={workspaceId} row={selected} onClose={() => setSelected(null)} onSaved={refresh} /> : null}</View>;
}

function SequenceSheet({ workspaceId, row, onClose, onSaved }: { workspaceId: string; row: CrmRecord; onClose: () => void; onSaved: () => void }) {
  const action = useCrmActions(workspaceId); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState(''); const steps = Array.isArray(row.steps) ? row.steps as CrmRecord[] : [];
  const change = async (next: 'publish' | 'pause' | 'archive') => { setBusy(true); setFeedback(''); try { await action(`sequences/${row.id}/${next}`, 'POST', { version: crmNumber(row.version) }); onSaved(); onClose(); }
    catch (error) { setFeedback(errorText(error)); } finally { setBusy(false); } };
  return <Sheet title={getText(row.name)} onClose={onClose}><RecordCard title={getText(row.name)} subtitle={`${steps.length} steps`} status={String(row.status)} />
    <View style={{ gap: 8 }}>{steps.map((step, index) => <RecordCard key={String(step.id ?? index)} title={`${index + 1}. ${crmLabel(step.type)}`} subtitle={crmNumber(step.delayMinutes) ? `Wait ${crmNumber(step.delayMinutes)} minutes` : 'Runs immediately'} />)}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{row.status !== 'active' ? <Button label="Publish" disabled={busy} onPress={() => change('publish')} /> : <Button label="Pause" disabled={busy} onPress={() => change('pause')} />}{row.status !== 'archived' ? <Button label="Archive" variant="ghost" disabled={busy} onPress={() => change('archive')} /> : null}</View>
    {feedback ? <Notice error={!feedback.includes('published') && !feedback.includes('paused') && !feedback.includes('archived')}>{feedback}</Notice> : null}</Sheet>;
}

function AutomationsView({ workspaceId, revision, refresh }: Props) {
  const definitions = useCrm<unknown>(workspaceId, 'automations', revision); const approvals = useCrm<unknown>(workspaceId, 'automation-approvals', revision); const [filter, setFilter] = useState('workflows'); const [selected, setSelected] = useState<CrmRecord | null>(null);
  const rows = filter === 'workflows' ? crmRows(definitions.data) : crmRows(approvals.data);
  return <View style={{ gap: 14 }}><View style={{ gap: 4 }}><Text size="xl" weight="bold">Automations</Text><Text size="sm" tone="textSecondary">Monitor workflows and decide approval requests.</Text></View>
    <HorizontalFilters value={filter} onChange={setFilter} items={[{ id: 'workflows', label: 'Workflows' }, { id: 'approvals', label: 'Approvals' }]} />
    <ResourceState loading={filter === 'workflows' ? definitions.loading : approvals.loading} error={filter === 'workflows' ? definitions.error : approvals.error} empty={!rows.length} emptyTitle={filter === 'workflows' ? 'No automations' : 'No pending approvals'}>
      {rows.map(row => <RecordCard key={row.id} title={getText(row.name ?? row.action, filter === 'workflows' ? 'Workflow' : 'Approval request')} subtitle={getText(row.description ?? row.reason, crmLabel(row.code ?? row.status))} status={String(row.status)} meta={crmDate(row.createdAt, true)} onPress={() => setSelected(row)} />)}
    </ResourceState>{selected ? <AutomationSheet workspaceId={workspaceId} row={selected} approval={filter === 'approvals'} onClose={() => setSelected(null)} onSaved={refresh} /> : null}</View>;
}

function AutomationSheet({ workspaceId, row, approval, onClose, onSaved }: { workspaceId: string; row: CrmRecord; approval: boolean; onClose: () => void; onSaved: () => void }) {
  const action = useCrmActions(workspaceId); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState(''); const [reason, setReason] = useState('');
  const execute = async (command: string) => { setBusy(true); setFeedback(''); try {
    await action(approval ? `automation-approvals/${row.id}/decision` : `automations/${row.id}/${command}`, 'POST', approval ? { version: crmNumber(row.version), decision: command, reason: reason.trim() || undefined } : command === 'dry-run' ? { context: {} } : { version: crmNumber(row.version) });
    const isStateChange = approval || ['publish', 'pause'].includes(command);
    setFeedback(approval ? `Request ${command}.` : command === 'validate' ? 'Workflow validation completed.' : `Workflow ${command === 'publish' ? 'published' : command === 'pause' ? 'paused' : 'tested'}.`); onSaved();
    if (isStateChange) onClose();
  } catch (error) { setFeedback(errorText(error)); } finally { setBusy(false); } };
  return <Sheet title={getText(row.name ?? row.action, approval ? 'Approval request' : 'Workflow')} onClose={onClose}><RecordCard title={getText(row.name ?? row.action, 'Workflow')} subtitle={getText(row.description ?? row.reason, crmLabel(row.code))} status={String(row.status)} />
    {approval ? <><TextField label="Decision note" value={reason} onChangeText={setReason} multiline /><View style={{ flexDirection: 'row', gap: 10 }}><Button label="Approve" disabled={busy} onPress={() => execute('approved')} /><Button label="Reject" variant="secondary" disabled={busy} onPress={() => execute('rejected')} /></View></>
      : <View style={{ gap: 10 }}><Button label="Validate workflow" variant="secondary" disabled={busy} onPress={() => execute('validate')} /><Button label="Test with empty context" variant="secondary" disabled={busy} onPress={() => execute('dry-run')} />{row.status === 'active' ? <Button label="Pause workflow" disabled={busy} onPress={() => execute('pause')} /> : <Button label="Publish workflow" disabled={busy} onPress={() => execute('publish')} />}</View>}
    {feedback ? <Notice error={!feedback.includes('completed') && !feedback.includes('published') && !feedback.includes('paused') && !feedback.includes('tested') && !feedback.includes('approved') && !feedback.includes('rejected')}>{feedback}</Notice> : null}</Sheet>;
}

const reportTypes = ['sources', 'pipeline', 'funnel', 'sla', 'assignment', 'forecast'] as const;
function ReportsView({ workspaceId, revision }: Props) {
  const [report, setReport] = useState<typeof reportTypes[number]>('sources');
  const now = new Date(); const pad = (part: number) => String(part).padStart(2, '0'); const day = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const [from, setFrom] = useState(() => day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90))); const [to, setTo] = useState(() => day(now));
  const selected = useCrm<unknown>(workspaceId, `reports/${report}?from=${encodeURIComponent(new Date(`${from}T00:00:00`).toISOString())}&to=${encodeURIComponent(new Date(`${to}T23:59:59`).toISOString())}`, revision); const rows = crmRows(selected.data);
  return <View style={{ gap: 14 }}><SectionHeading title="CRM reports" subtitle="Sales and response performance for the period you choose." />
    <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><DateField label="From" value={from} onChange={setFrom} /></View><View style={{ flex: 1 }}><DateField label="To" value={to} onChange={setTo} /></View></View>
    <HorizontalFilters value={report} onChange={value => setReport(value as typeof report)} items={reportTypes.map(id => ({ id, label: crmLabel(id) }))} />
    <ResourceState loading={selected.loading} error={selected.error} empty={!rows.length} emptyTitle={`No ${crmLabel(report).toLowerCase()} data`}>
      {rows.map((row, index) => <ReportRow key={row.id ?? `${report}-${index}`} row={row} report={report} />)}
    </ResourceState></View>;
}

function ReportRow({ row, report }: { row: CrmRecord; report: string }) {
  const title = getText(row.source ?? row.pipeline ?? row.stage ?? row.owner ?? row.status ?? row.currency, crmLabel(report));
  const count = crmNumber(row.enquiries ?? row.leads ?? row.count); const value = row.value ?? row.amount ?? row.weightedAmount;
  return <RecordCard title={title} subtitle={[row.channel && crmLabel(row.channel), row.stage && crmLabel(row.stage), row.method && crmLabel(row.method)].filter(Boolean).join(' · ') || crmLabel(report)} status={String(row.status ?? report)}
    meta={value == null ? `${count} records` : `${crmNumber(value).toLocaleString()} ${getText(row.currency, '')} · ${count} records`} />;
}
