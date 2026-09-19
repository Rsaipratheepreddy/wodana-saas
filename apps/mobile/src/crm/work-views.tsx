import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '../design-system';
import { DateField } from '../hrms/date-field';
import { Button, CallButton, Card, Choice, ContactButton, EmptyState, HorizontalFilters, Metric, Notice, RecordCard, ResourceState, SearchBox, SectionHeading, Sheet, TextField } from './ui';
import { crmContact, crmDate, crmLabel, crmNumber, crmRows, useCrm, useCrmActions, type CrmRecord } from './api';
import { responseActivityBody, type ResponseAction } from './response';

type ViewProps = { workspaceId: string; revision: number; refresh: () => void };

type TodayPayload = CrmRecord & {
  summary?: Record<string, unknown>;
  items?: CrmRecord[];
};

function message(error: unknown) { return error instanceof Error ? error.message : 'The CRM action could not be completed.'; }
function text(value: unknown, fallback = 'Not set') { return typeof value === 'string' && value.trim() ? value : fallback; }
function schedule(days = 1) {
  const value = new Date(Date.now() + days * 86_400_000); const pad = (part: number) => String(part).padStart(2, '0');
  return { date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`, time: '10:00' };
}

function qualificationHandoff(deal: CrmRecord | null) {
  const evidence = (deal?.qualificationEvidence ?? deal?.qualification_evidence) as Record<string, unknown> | undefined;
  if (!evidence || !Array.isArray(evidence.answers)) return null;
  const form = evidence.form && typeof evidence.form === 'object' ? evidence.form as Record<string, unknown> : null;
  const questions = form && Array.isArray(form.questions) ? form.questions as Array<Record<string, unknown>> : [];
  const labels = new Map(questions.filter(question => typeof question.key === 'string').map(question => [String(question.key), text(question.label, crmLabel(question.key))]));
  const rows = (evidence.answers as Array<Record<string, unknown>>).flatMap(answer => {
    if (typeof answer.questionKey !== 'string') return [];
    const value = Array.isArray(answer.value) ? answer.value.join(', ') : answer.value === true ? 'Yes' : answer.value === false ? 'No' : text(answer.value, 'Not provided');
    return [{ key: answer.questionKey, label: labels.get(answer.questionKey) ?? crmLabel(answer.questionKey), value }];
  });
  return { formName: text(form?.name, 'No configured form'), evaluatedAt: evidence.evaluatedAt, rows };
}

export function TodayView({ workspaceId, revision, refresh, open }: ViewProps & { open: (kind: string, id: string) => void }) {
  const resource = useCrm<TodayPayload>(workspaceId, 'today', revision);
  const [expanded, setExpanded] = useState(false);
  const summary = resource.data?.summary ?? {};
  const items = resource.data?.items ?? [];
  const visibleItems = expanded ? items : items.slice(0, 8);
  return <View style={{ gap: 16 }}>
    <View style={{ gap: 4 }}><Text size="xl" weight="bold">Today</Text><Text size="sm" tone="textSecondary">Customer replies and commitments that need attention.</Text></View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <Metric value={crmNumber(summary.activeLeads)} label="Active leads" accent />
      <Metric value={crmNumber(summary.openOpportunities)} label="Open deals" />
      <Metric value={crmNumber(summary.pendingFollowUps)} label="Follow-ups" />
      <Metric value={crmNumber(summary.customers)} label="Customers" />
    </View>
    <ResourceState loading={resource.loading} error={resource.error} empty={!items.length} emptyTitle="You are caught up">
      {items.length ? <SectionHeading title={`${items.length} priorities`} action={<Button label="Refresh" variant="ghost" onPress={refresh} />} /> : null}
      {visibleItems.map(item => <RecordCard key={`${item.kind}-${item.recordId ?? item.id}`} title={text(item.title, 'CRM priority')}
        subtitle={text(item.reason, 'Review this item')} status={String(item.kind ?? '')} meta={crmDate(item.dueAt, true)}
        onPress={() => open(String(item.kind ?? ''), String(item.recordId ?? item.id))} />)}
      {items.length > 8 ? <Button label={expanded ? 'Show top priorities' : `Show all ${items.length}`} variant="secondary" onPress={() => setExpanded(value => !value)} /> : null}
    </ResourceState>
  </View>;
}

const transitions: Record<string, string[]> = {
  new: ['attempting_contact', 'connected', 'nurturing', 'disqualified', 'paused'],
  attempting_contact: ['new', 'connected', 'nurturing', 'disqualified', 'paused'],
  connected: ['attempting_contact', 'nurturing', 'qualified', 'disqualified', 'paused'],
  nurturing: ['attempting_contact', 'connected', 'qualified', 'disqualified', 'paused'],
  qualified: ['nurturing'], disqualified: ['nurturing'], paused: ['new', 'attempting_contact', 'connected', 'nurturing'],
};

export function LeadsView({ workspaceId, revision, refresh, initialId }: ViewProps & { initialId?: string }) {
  const resource = useCrm<unknown>(workspaceId, 'leads?limit=100', revision);
  const rows = crmRows(resource.data);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [creating, setCreating] = useState(false);
  const visible = useMemo(() => rows.filter(row => {
    const active = ['new', 'attempting_contact', 'connected', 'nurturing'].includes(String(row.status));
    return (filter === 'all' || filter === String(row.status) || (filter === 'active' && active))
      && `${row.partyName ?? ''} ${row.title ?? ''} ${row.source ?? ''}`.toLowerCase().includes(search.toLowerCase());
  }), [rows, filter, search]);
  return <View style={{ gap: 14 }}>
    <SectionHeading title="Leads" subtitle="Move every enquiry to a clear next action." action={<Button label="Add" onPress={() => setCreating(true)} />} />
    <SearchBox value={search} onChange={setSearch} placeholder="Search leads" />
    <HorizontalFilters value={filter} onChange={setFilter} items={[
      { id: 'active', label: 'Active' }, { id: 'new', label: 'New' }, { id: 'connected', label: 'Connected' },
      { id: 'nurturing', label: 'Nurturing' }, { id: 'qualified', label: 'Qualified' }, { id: 'all', label: 'All' },
    ]} />
    <ResourceState loading={resource.loading} error={resource.error} empty={!visible.length} emptyTitle="No leads in this view">
      {visible.map(lead => <RecordCard key={lead.id} title={text(lead.partyName, text(lead.title, 'Unnamed lead'))}
        subtitle={`${text(lead.title, 'Enquiry')} · ${crmLabel(lead.source, 'Manual')}`} status={String(lead.status ?? '')}
        meta={`${lead.ownerName ? text(lead.ownerName) : lead.ownerMembershipId ? 'Assigned' : 'Unassigned'} · ${crmDate(lead.nextActionAt, true)}`} onPress={() => setSelected(lead.id)} />)}
    </ResourceState>
    {selected ? <LeadSheet workspaceId={workspaceId} leadId={selected} onClose={() => setSelected(null)} onSaved={refresh} /> : null}
    {creating ? <CreateLeadSheet workspaceId={workspaceId} onClose={() => setCreating(false)} onSaved={refresh} /> : null}
  </View>;
}

function LeadSheet({ workspaceId, leadId, onClose, onSaved }: { workspaceId: string; leadId: string; onClose: () => void; onSaved: () => void }) {
  const [revision, setRevision] = useState(0);
  const resource = useCrm<CrmRecord>(workspaceId, `leads/${leadId}`, revision);
  const action = useCrmActions(workspaceId);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const defaultNext = schedule();
  const [nextActionDate, setNextActionDate] = useState(defaultNext.date);
  const [nextActionTime, setNextActionTime] = useState(defaultNext.time);
  const [activity, setActivity] = useState('');
  const [responseAction, setResponseAction] = useState<ResponseAction>('follow_up');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const lead = resource.data;
  const party = useCrm<CrmRecord>(workspaceId, typeof lead?.partyId === 'string' ? `parties/${lead.partyId}` : null, revision);
  const phone = crmContact(party.data, 'phone');
  const email = crmContact(party.data, 'email');
  const activities = useCrm<unknown>(workspaceId, `activities?leadId=${leadId}&limit=10`, revision);
  const reload = () => { setRevision(value => value + 1); onSaved(); };
  const saveStatus = async () => {
    if (!lead || !status) return;
    setBusy(true); setFeedback('');
    try {
      await action(`leads/${leadId}/status`, 'POST', { version: crmNumber(lead.version), status, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(!['qualified', 'disqualified', 'paused'].includes(status) ? { nextActionAt: new Date(`${nextActionDate}T${nextActionTime}:00`).toISOString() } : {}) });
      setStatus(''); setReason(''); setFeedback('Lead status updated.'); reload();
    } catch (error) { setFeedback(message(error)); } finally { setBusy(false); }
  };
  const addActivity = async () => {
    if (!lead || !activity.trim()) return;
    setBusy(true); setFeedback('');
    try {
      const created = await action<CrmRecord>('activities', 'POST', responseActivityBody({
        kind: responseAction, leadId, partyId: typeof lead.partyId === 'string' ? lead.partyId : undefined,
        ownerMembershipId: typeof lead.ownerMembershipId === 'string' ? lead.ownerMembershipId : undefined,
        text: activity, followUpAt: new Date(Date.now() + 86_400_000).toISOString(),
      }));
      if (responseAction === 'call') await action(`activities/${created.id}/complete`, 'POST', { version: crmNumber(created.version), outcome: activity.trim() });
      setActivity('');
      setFeedback(responseAction === 'call' ? 'Completed outbound call recorded.' : responseAction === 'note' ? 'Internal note saved. It was not sent to the customer.' : 'Follow-up created for tomorrow.');
      reload();
    } catch (error) { setFeedback(message(error)); } finally { setBusy(false); }
  };
  return <Sheet title={text(lead?.enquiry && (lead.enquiry as CrmRecord).partyName, 'Lead details')} onClose={onClose}>
    <ResourceState loading={resource.loading} error={resource.error} />
    {lead ? <>
      <RecordCard title={text((lead.enquiry as CrmRecord | undefined)?.title, 'Enquiry')} subtitle={text((lead.enquiry as CrmRecord | undefined)?.summary, 'No enquiry notes')}
        status={String(lead.status)} meta={`${crmLabel((lead.enquiry as CrmRecord | undefined)?.source, 'Manual')} · ${lead.ownerName ? text(lead.ownerName) : lead.ownerMembershipId ? 'Assigned' : 'Unassigned'}`} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <ContactButton kind="phone" value={phone} label="Call" />
        <ContactButton kind="email" value={email} label="Email" />
        <ContactButton kind="whatsapp" value={phone} label="WhatsApp" />
      </View>
      <Notice>Contact buttons open another app. They do not prove a message was sent or delivered; provider-tracked delivery appears in Inbox.</Notice>
      <Card><View style={{ gap: 5 }}><Text weight="semibold">Enquiry provenance</Text>
        <Text size="sm" tone="textSecondary">{crmLabel((lead.enquiry as CrmRecord | undefined)?.source, 'Unknown source')} · {crmLabel((lead.enquiry as CrmRecord | undefined)?.channel, 'Unknown channel')} · {crmLabel((lead.enquiry as CrmRecord | undefined)?.intakeMethod, 'Manual')}</Text>
        <Text size="xs" tone="textTertiary">Received {crmDate((lead.enquiry as CrmRecord | undefined)?.receivedAt, true)}</Text>
        {Array.isArray((lead.enquiry as CrmRecord | undefined)?.attribution) ? ((lead.enquiry as CrmRecord).attribution as CrmRecord[]).map(touch => <Text key={touch.id} size="xs" tone="textTertiary">{crmLabel(touch.source)}{touch.medium ? ` · ${crmLabel(touch.medium)}` : ''}{touch.campaign ? ` · ${text(touch.campaign)}` : ''}</Text>) : null}
      </View></Card>
      <Choice label="Move lead to" value={status} onChange={setStatus} options={(transitions[String(lead.status)] ?? []).map(value => ({ value, label: crmLabel(value) }))} />
      {status ? <>
        {['disqualified', 'paused'].includes(status) ? <TextField label="Reason" value={reason} onChangeText={setReason} /> : null}
        {!['qualified', 'disqualified', 'paused'].includes(status) ? <View style={{ gap: 12 }}><DateField label="Next action date" value={nextActionDate} onChange={setNextActionDate} /><DateField label="Time" value={nextActionTime} onChange={setNextActionTime} mode="time" /></View> : null}
        <Button label={busy ? 'Saving…' : 'Update status'} loading={busy} disabled={(['disqualified', 'paused'].includes(status) && !reason.trim())} onPress={saveStatus} />
      </> : null}
      <View style={{ gap: 10 }}><Text weight="semibold">Record response</Text>
        <Choice label="Action" value={responseAction} onChange={value => setResponseAction(value as ResponseAction)} options={[{ value: 'follow_up', label: 'Schedule follow-up' }, { value: 'note', label: 'Add internal note' }, { value: 'call', label: 'Log completed outbound call' }]} />
        <TextField label={responseAction === 'follow_up' ? 'Next action' : 'Outcome or note'} value={activity} onChangeText={setActivity} placeholder={responseAction === 'follow_up' ? 'Call about the quotation' : 'What happened?'} />
        <Button label={busy ? 'Saving…' : responseAction === 'follow_up' ? 'Create for tomorrow' : responseAction === 'note' ? 'Save note' : 'Record completed call'} variant="secondary" disabled={!activity.trim() || busy} onPress={addActivity} />
      </View>
      {feedback ? <Notice error={!['updated', 'created', 'recorded', 'saved'].some(word => feedback.includes(word))}>{feedback}</Notice> : null}
      <View style={{ gap: 8 }}><Text weight="semibold">Response history</Text>
        <ResourceState loading={activities.loading} error={activities.error} empty={!crmRows(activities.data).length} emptyTitle="No response activity yet">
          {crmRows(activities.data).map(item => <RecordCard key={item.id} title={text(item.title, crmLabel(item.type))} subtitle={text(item.description, 'No note')} status={String(item.status ?? '')} meta={`${item.interactionDirection ? `${crmLabel(item.interactionDirection)} · ` : ''}${crmDate(item.completedAt ?? item.dueAt ?? item.createdAt, true)}`} />)}
        </ResourceState>
      </View>
      {Array.isArray(lead.opportunities) && lead.opportunities.length ? <View style={{ gap: 8 }}><Text weight="semibold">Converted opportunity</Text>{(lead.opportunities as CrmRecord[]).map(deal => <RecordCard key={deal.id} title={text(deal.title)} status={String(deal.status)} />)}</View> : null}
    </> : null}
  </Sheet>;
}

function CreateLeadSheet({ workspaceId, onClose, onSaved }: { workspaceId: string; onClose: () => void; onSaved: () => void }) {
  const action = useCrmActions(workspaceId);
  const [name, setName] = useState(''); const [title, setTitle] = useState(''); const [email, setEmail] = useState('');
  const [phone, setPhone] = useState(''); const [notes, setNotes] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      await action('intake-events', 'POST', { source: 'manual', channel: phone.trim() ? 'phone' : 'email', intakeMethod: 'manual', receivedAt: new Date().toISOString(),
        party: { displayName: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined }, title: title.trim(), summary: notes.trim() || undefined,
        originalPayload: { source: 'mobile_crm', capturedAt: new Date().toISOString() } });
      onSaved(); onClose();
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  };
  return <Sheet title="New lead" onClose={onClose}>
    <TextField label="Customer name" value={name} onChangeText={setName} />
    <TextField label="Enquiry title" value={title} onChangeText={setTitle} />
    <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
    <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
    <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
    {error ? <Notice error>{error}</Notice> : null}
    <Button label={busy ? 'Creating…' : 'Create lead'} loading={busy} disabled={!name.trim() || !title.trim() || (!email.trim() && !phone.trim())} onPress={save} />
  </Sheet>;
}

export function DealsView({ workspaceId, revision, refresh, initialId }: ViewProps & { initialId?: string }) {
  const resource = useCrm<unknown>(workspaceId, 'opportunities?limit=100', revision);
  const rows = crmRows(resource.data);
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('open'); const [selected, setSelected] = useState<string | null>(initialId ?? null); const [creating, setCreating] = useState(false);
  const visible = rows.filter(row => (filter === 'all' || row.status === filter) && `${row.title ?? ''} ${row.partyName ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <View style={{ gap: 14 }}>
    <SectionHeading title="Deals" subtitle="Track value, commitment, and the next commercial step." action={<Button label="Add" onPress={() => setCreating(true)} />} />
    <SearchBox value={search} onChange={setSearch} placeholder="Search deals" />
    <HorizontalFilters value={filter} onChange={setFilter} items={['open', 'won', 'lost', 'all'].map(id => ({ id, label: crmLabel(id) }))} />
    <ResourceState loading={resource.loading} error={resource.error} empty={!visible.length} emptyTitle="No deals in this view">
      {visible.map(deal => <RecordCard key={deal.id} title={text(deal.title, 'Untitled deal')} subtitle={text(deal.partyName, 'No customer')}
        status={String(deal.status)} meta={`${text(deal.stageName, 'No stage')} · ${deal.amount == null ? 'Value not set' : `${crmNumber(deal.amount).toLocaleString()} ${text(deal.currencyCode, '')}`}`}
        onPress={() => setSelected(deal.id)} />)}
    </ResourceState>
    {selected ? <DealSheet workspaceId={workspaceId} dealId={selected} onClose={() => setSelected(null)} onSaved={refresh} /> : null}
    {creating ? <CreateDealSheet workspaceId={workspaceId} onClose={() => setCreating(false)} onSaved={refresh} /> : null}
  </View>;
}

function DealSheet({ workspaceId, dealId, onClose, onSaved }: { workspaceId: string; dealId: string; onClose: () => void; onSaved: () => void }) {
  const [revision, setRevision] = useState(0); const resource = useCrm<CrmRecord>(workspaceId, `opportunities/${dealId}`, revision); const action = useCrmActions(workspaceId);
  const [outcome, setOutcome] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const deal = resource.data;
  const party = useCrm<CrmRecord>(workspaceId, typeof deal?.partyId === 'string' ? `parties/${deal.partyId}` : null, revision);
  const phone = crmContact(party.data, 'phone');
  const handoff = qualificationHandoff(deal);
  const save = async () => { if (!deal || !outcome) return; setBusy(true); setFeedback(''); try {
    await action(`opportunities/${dealId}/transition`, 'POST', { version: crmNumber(deal.version), status: outcome, reason: reason.trim() || outcome });
    setFeedback('Deal updated.'); setOutcome(''); setReason(''); setRevision(v => v + 1); onSaved();
  } catch (error) { setFeedback(message(error)); } finally { setBusy(false); } };
  return <Sheet title={text(deal?.title, 'Deal details')} onClose={onClose}>
    <ResourceState loading={resource.loading} error={resource.error} />
    {deal ? <>
      <RecordCard title={text(deal.partyName, 'Customer')} subtitle={`${text(deal.pipelineName, 'Pipeline')} · ${text(deal.stageName, 'Stage')}`} status={String(deal.status)}
        meta={deal.amount == null ? 'Value not set' : `${crmNumber(deal.amount).toLocaleString()} ${text(deal.currencyCode, '')}`} />
      {phone ? <CallButton phone={phone} label="Call customer" /> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}><Metric value={`${crmNumber(deal.probability)}%`} label="Probability" /><Metric value={crmDate(deal.nextActionAt, true)} label="Next action" /></View>
      {handoff ? <Card><View style={{ gap: 8 }}><Text weight="semibold">Qualification handoff</Text><Text size="xs" tone="textSecondary">{handoff.formName} · frozen {crmDate(handoff.evaluatedAt, true)}</Text>{handoff.rows.length ? handoff.rows.map(answer => <View key={answer.key} style={{ gap: 2 }}><Text size="xs" tone="textSecondary">{answer.label}</Text><Text size="sm">{answer.value}</Text></View>) : <Text size="sm" tone="textSecondary">No qualification answers were required.</Text>}</View></Card> : null}
      {Array.isArray(deal.stageHistory) && deal.stageHistory.length ? <Card><View style={{ gap: 8 }}><Text weight="semibold">Decision history</Text>{(deal.stageHistory as CrmRecord[]).map((entry, index) => <Text key={entry.id || String(index)} size="sm">{crmLabel(entry.toStatus)} · {text(entry.reason, 'Stage changed')} · {crmDate(entry.changedAt, true)}</Text>)}</View></Card> : null}
      <Choice label={deal.status === 'open' ? 'Close deal as' : 'Reopen deal'} value={outcome} onChange={setOutcome}
        options={(deal.status === 'open' ? ['won', 'lost', 'abandoned'] : ['open']).map(value => ({ value, label: crmLabel(value) }))} />
      {outcome ? <><TextField label="Reason" value={reason} onChangeText={setReason} /><Button label={busy ? 'Saving…' : 'Update deal'} loading={busy} disabled={!reason.trim()} onPress={save} /></> : null}
      {feedback ? <Notice error={!feedback.includes('updated')}>{feedback}</Notice> : null}
      {Array.isArray(deal.stakeholders) && deal.stakeholders.length ? <View style={{ gap: 8 }}><Text weight="semibold">Stakeholders</Text>{(deal.stakeholders as CrmRecord[]).map((person, index) => <RecordCard key={`${person.partyId}-${index}`} title={text(person.partyName)} status={String(person.role)} />)}</View> : null}
    </> : null}
  </Sheet>;
}

function CreateDealSheet({ workspaceId, onClose, onSaved }: { workspaceId: string; onClose: () => void; onSaved: () => void }) {
  const parties = useCrm<unknown>(workspaceId, 'parties?limit=100'); const pipelines = useCrm<unknown>(workspaceId, 'pipelines'); const action = useCrmActions(workspaceId);
  const defaultNext = schedule();
  const [partyId, setPartyId] = useState(''); const [pipelineId, setPipelineId] = useState(''); const [title, setTitle] = useState(''); const [amount, setAmount] = useState(''); const [nextActionDate, setNextActionDate] = useState(defaultNext.date); const [nextActionTime, setNextActionTime] = useState(defaultNext.time);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async () => { setBusy(true); setError(''); try {
    const parsedAmount = Number(amount); await action('opportunities', 'POST', { partyId, pipelineId, title: title.trim(), nextActionAt: new Date(`${nextActionDate}T${nextActionTime}:00`).toISOString(),
      ...(amount.trim() && Number.isFinite(parsedAmount) ? { amount: parsedAmount, currencyCode: 'AED' } : {}) }); onSaved(); onClose();
  } catch (caught) { setError(message(caught)); } finally { setBusy(false); } };
  return <Sheet title="New deal" onClose={onClose}>
    <ResourceState loading={parties.loading || pipelines.loading} error={parties.error || pipelines.error} />
    <Choice label="Customer" value={partyId} onChange={setPartyId} options={crmRows(parties.data).filter(row => row.status === 'active').map(row => ({ value: row.id, label: text(row.displayName) }))} />
    <Choice label="Pipeline" value={pipelineId} onChange={setPipelineId} options={crmRows(pipelines.data).filter(row => row.status === 'active').map(row => ({ value: row.id, label: text(row.name) }))} />
    <TextField label="Deal title" value={title} onChangeText={setTitle} />
    <TextField label="Value (AED)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
    <DateField label="Next action date" value={nextActionDate} onChange={setNextActionDate} /><DateField label="Time" value={nextActionTime} onChange={setNextActionTime} mode="time" />
    {error ? <Notice error>{error}</Notice> : null}
    <Button label={busy ? 'Creating…' : 'Create deal'} loading={busy} disabled={!partyId || !pipelineId || !title.trim()} onPress={save} />
  </Sheet>;
}

export function InboxView({ workspaceId, revision, refresh, initialId }: ViewProps & { initialId?: string }) {
  const resource = useCrm<unknown>(workspaceId, 'conversations?limit=100', revision); const rows = crmRows(resource.data);
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('open'); const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const visible = rows.filter(row => (filter === 'all' || row.status === filter || (filter === 'unread' && crmNumber(row.unreadCount) > 0)) && `${row.partyName ?? ''} ${row.subject ?? ''} ${row.lastMessageText ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <View style={{ gap: 14 }}>
    <SectionHeading title="Inbox" subtitle="Keep every customer conversation in one place." action={<Button label="Refresh" variant="ghost" onPress={refresh} />} />
    <SearchBox value={search} onChange={setSearch} placeholder="Search conversations" />
    <HorizontalFilters value={filter} onChange={setFilter} items={['open', 'unread', 'closed', 'all'].map(id => ({ id, label: crmLabel(id) }))} />
    <ResourceState loading={resource.loading} error={resource.error} empty={!visible.length} emptyTitle="No conversations in this view">
      {visible.map(thread => <RecordCard key={thread.id} title={text(thread.partyName, 'Internal team')} subtitle={text(thread.lastMessageText, text(thread.subject, 'No messages yet'))}
        status={String(thread.channel)} unread={crmNumber(thread.unreadCount)} meta={`${crmLabel(thread.status)} · ${crmDate(thread.lastMessageAt, true)}`} onPress={() => setSelected(thread.id)} />)}
    </ResourceState>
    {selected ? <ConversationSheet workspaceId={workspaceId} conversationId={selected} onClose={() => setSelected(null)} onSaved={refresh} /> : null}
  </View>;
}

function ConversationSheet({ workspaceId, conversationId, onClose, onSaved }: { workspaceId: string; conversationId: string; onClose: () => void; onSaved: () => void }) {
  const [revision, setRevision] = useState(0); const resource = useCrm<CrmRecord>(workspaceId, `conversations/${conversationId}`, revision); const action = useCrmActions(workspaceId);
  const [draft, setDraft] = useState(''); const [direction, setDirection] = useState('outbound'); const [templateId, setTemplateId] = useState(''); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState('');
  const thread = resource.data; const reload = () => { setRevision(v => v + 1); onSaved(); };
  const party = useCrm<CrmRecord>(workspaceId, typeof thread?.partyId === 'string' ? `parties/${thread.partyId}` : null, revision);
  const templates = useCrm<unknown>(workspaceId, thread?.channel === 'whatsapp' ? 'notification-templates' : null, revision);
  const phone = crmContact(party.data, 'phone');
  const canReply = thread?.channel === 'email' || thread?.channel === 'whatsapp';
  useEffect(() => { if (thread && !canReply) setDirection('internal'); }, [canReply, thread]);
  const inboundAt = Date.parse(String(thread?.lastInboundAt ?? ''));
  const windowOpen = Number.isFinite(inboundAt) && Date.now() >= inboundAt && Date.now() - inboundAt < 86_400_000;
  const templateMode = direction === 'outbound' && thread?.channel === 'whatsapp' && !windowOpen;
  const approvedTemplates = crmRows(templates.data).filter(item => item.channel === 'whatsapp' && item.status === 'approved');
  const selectedTemplate = approvedTemplates.find(item => item.id === templateId);
  const ready = templateMode ? Boolean(templateId) : Boolean(draft.trim());
  const send = async () => { if (!ready || !thread || thread.status !== 'open') return; setBusy(true); setFeedback(''); try {
    const payload = direction === 'internal' ? { direction, bodyText: draft.trim() }
      : templateMode ? { direction, purpose: 'service', templateId }
        : { direction, purpose: 'service', bodyText: draft.trim() };
    await action(`conversations/${conversationId}/messages`, 'POST', payload); setDraft(''); setFeedback(direction === 'internal' ? 'Private note saved.' : templateMode ? 'Approved template queued.' : 'Custom message queued for delivery.'); reload();
  } catch (error) { setFeedback(message(error)); } finally { setBusy(false); } };
  const toggle = async () => { if (!thread) return; setBusy(true); setFeedback(''); try {
    await action(`conversations/${conversationId}`, 'PATCH', { version: crmNumber(thread.version), status: thread.status === 'open' ? 'closed' : 'open' }); setFeedback(thread.status === 'open' ? 'Conversation resolved.' : 'Conversation reopened.'); reload();
  } catch (error) { setFeedback(message(error)); } finally { setBusy(false); } };
  const messages = Array.isArray(thread?.messages) ? thread.messages as CrmRecord[] : [];
  return <Sheet title={text(thread?.partyName, text(thread?.subject, 'Conversation'))} onClose={onClose}>
    <ResourceState loading={resource.loading} error={resource.error} />
    {thread ? <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><View style={{ flex: 1 }}><Text weight="semibold">{text(thread.subject, 'No subject')}</Text><Text size="xs" tone="textSecondary">{crmLabel(thread.channel)} · {crmLabel(thread.status)}</Text></View><Button label={thread.status === 'open' ? 'Resolve' : 'Reopen'} variant="ghost" onPress={toggle} /></View>
      {phone ? <CallButton phone={phone} label="Call customer" /> : null}
      <View style={{ gap: 10 }}>{messages.map(item => <MessageBubble key={item.id} message={item} />)}</View>
      {!messages.length ? <EmptyState title="No messages yet" description="Send a reply or save a private team note below." icon="inbox" /> : null}
      <Choice label="What do you want to do?" value={direction} onChange={setDirection} options={[...(canReply ? [{ value: 'outbound', label: `Reply to customer via ${crmLabel(thread.channel)}` }] : []), { value: 'internal', label: thread.channel === 'phone' ? 'Save private call note' : 'Save private team note' }]} />
      {thread.channel === 'whatsapp' && direction === 'outbound' ? windowOpen
        ? <Notice>{`Custom WhatsApp text is available until ${crmDate(new Date(inboundAt + 86_400_000).toISOString(), true)}.`}</Notice>
        : <Notice>Custom text is locked by WhatsApp until the customer messages again. Choose an approved template to start the conversation.</Notice> : null}
      {templateMode ? <>
        <ResourceState loading={templates.loading} error={templates.error} empty={!approvedTemplates.length} emptyTitle="No approved WhatsApp templates" />
        {approvedTemplates.length ? <Choice label="Approved template" value={templateId} onChange={setTemplateId} options={approvedTemplates.map(item => ({ value: item.id, label: text(item.code) }))} /> : null}
        {selectedTemplate ? <Card><Text weight="semibold">{text(selectedTemplate.code)}</Text><Text size="sm" tone="textSecondary">{text(selectedTemplate.bodyTemplate, 'Approved WhatsApp template')}</Text></Card> : null}
      </> : <TextField label={direction === 'internal' ? 'Private team note · not sent to customer' : 'Custom message'} value={draft} onChangeText={setDraft} multiline />}
      <Button label={busy ? 'Saving…' : direction === 'internal' ? 'Save private note' : templateMode ? 'Send approved template' : 'Send custom message'} loading={busy} disabled={!ready || thread.status !== 'open'} onPress={send} />
      {thread.status !== 'open' ? <Notice>Reopen this conversation before replying.</Notice> : null}
      {feedback ? <Notice error={!feedback.includes('saved') && !feedback.includes('queued') && !feedback.includes('resolved') && !feedback.includes('reopened')}>{feedback}</Notice> : null}
    </> : null}
  </Sheet>;
}

function MessageBubble({ message: item }: { message: CrmRecord }) {
  const { colors } = useTheme(); const mine = item.direction !== 'inbound';
  return <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
    backgroundColor: item.direction === 'internal' ? colors.surfaceMuted : mine ? colors.actionPrimary : colors.surface,
    borderWidth: mine && item.direction !== 'internal' ? 0 : 1, borderColor: colors.border }}>
    <Text size="sm" style={{ color: mine && item.direction !== 'internal' ? colors.actionOnPrimary : colors.text }}>{text(item.bodyText, 'Attachment')}</Text>
    <Text size="xs" style={{ marginTop: 4, color: mine && item.direction !== 'internal' ? colors.actionOnPrimary : colors.textTertiary }}>{item.direction === 'internal' ? 'Private team note · Not sent' : crmLabel(item.status)} · {crmDate(item.createdAt, true)}</Text>
  </View>;
}
