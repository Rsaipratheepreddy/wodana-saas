import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { AlertTriangle, CalendarClock, ListChecks, MapPin, Minus, Package, Plus, Ruler, Users } from 'lucide-react-native';
import type { SiteDelivery, SiteLine, TodayTask } from '../../../../web/lib/site/types';
import { errorMessage } from '../../core/api';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { useOutbox, usePending } from '../../core/outbox';
import { readProtectedOfflineText, writeProtectedOfflineText } from '../../core/protected-storage';
import { useSession } from '../../core/session';
import type { LocalPhoto } from '../../core/media';
import { DateField } from '../../ui/date-field';
import { OptionSheet, SearchField, SegmentedControl, SelectField, Stepper, TextField, ToggleRow, cleanDecimal } from '../../ui/fields';
import { Banner, Empty, Failure, ListRow, Loading, Screen, Section } from '../../ui/layout';
import { PhotoGrid } from '../../ui/photos';
import { Button, Chip, IconButton, Row, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useTheme } from '../../ui/theme';
import { useCrews } from '../hrms/api';
import { useMarkup } from '../capture/use-markup';
import { sitePhotoPath, useSite } from './api';
import type { ReportPayload } from './outbox';
import { chooseProgress, empty, fromPlan, fromReport, photoRow, reportBody, reportProblems, stepOf, STEPS, tagPhoto, taskRow, type Draft, type Installed, type Issue, type Material, type PhotoTags } from './report-model';

const WEATHER = [key('Clear'), key('Hot'), key('Humid'), key('Windy'), key('Dusty'), key('Rain')];
const STEP_LABEL: Record<number, string> = { 10: key('Started'), 25: '25%', 50: '50%', 75: '75%', 100: key('Done') };

/**
 * Today's report, phone-first and about two minutes: today's planned work with one tap each, photos by room
 * (made smaller on the phone, before/after paired), yesterday's crew ready, issues that raise a snag or a
 * material request, and tomorrow from the plan. The draft stays on the phone as it's written and sends when there's
 * a connection, so nothing is lost.
 */
export function ReportScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const toast = useToast();
  const outbox = useOutbox();
  const session = useSession();
  const { id: projectId, date: dateParam } = useLocalSearchParams<{ id: string; date?: string }>();
  const site = useSite(projectId);
  const crews = useCrews(session.has('hrms'));
  const reportDate = dateParam ?? site.data?.today ?? format.today();
  const mine = site.data?.reports.find((report) => report.authorId === site.data?.me && report.reportDate === reportDate);
  const reportId = useRef<string>(Crypto.randomUUID());
  if (mine) reportId.current = mine.id;
  const pending = usePending(`report:${projectId}:${reportDate}`);
  const storageKey = `wodana.report-draft.v2.${session.userId}.${projectId}.${reportDate}`;
  const [draft, setDraft] = useState<Draft>(empty);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picking, setPicking] = useState(false);
  const [trade, setTrade] = useState(false);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [hoursFor, setHoursFor] = useState<string | null>(null);
  const [taggingPhoto, setTaggingPhoto] = useState<string | null>(null);
  const [issue, setIssue] = useState<Issue | 'new' | null>(null);
  const [noteFor, setNoteFor] = useState<TodayTask | null>(null);
  const [adding, setAdding] = useState(false);
  const [material, setMaterial] = useState<number | 'new' | null>(null);
  const markup = useMarkup();

  // Start from the saved report, a draft kept on the phone, or the plan (yesterday's crew, tomorrow's work).
  useEffect(() => {
    if (loaded || !site.data) return;
    void readProtectedOfflineText(storageKey).then((raw) => {
      const saved = raw ? (JSON.parse(raw) as { draft: Draft; reportId?: string }) : null;
      if (saved && !mine) { setDraft({ ...empty(), ...saved.draft }); if (saved.reportId) reportId.current = saved.reportId; }
      else setDraft(mine ? fromReport(mine) : fromPlan(site.data!));
    }).catch(() => setDraft(mine ? fromReport(mine) : fromPlan(site.data!))).finally(() => setLoaded(true));
  }, [site.data, loaded, mine, storageKey]);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => { void writeProtectedOfflineText(storageKey, JSON.stringify({ draft, reportId: reportId.current })).catch(() => undefined); }, 600);
    return () => clearTimeout(timer);
  }, [draft, loaded, storageKey]);

  const lines = site.data?.lines ?? [];
  const lineById = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);
  const trades = useMemo(() => {
    const names = new Set<string>();
    for (const report of site.data?.reports ?? []) for (const entry of report.workforce) names.add(entry.trade);
    for (const crew of crews.data?.crews ?? []) if (crew.trade) names.add(crew.trade);
    return [...names].filter((name) => !draft.workforce.some((entry) => entry.trade === name)).sort();
  }, [site.data, crews.data, draft.workforce]);

  if (site.isLoading || !loaded && !site.error) return <Screen title={t('Today’s report')} back><Loading shape="form" count={5} /></Screen>;
  if (site.error || !site.data) return <Screen title={t('Today’s report')} back><Failure message={errorMessage(site.error, t('The site could not be loaded.'))} onRetry={() => void site.refetch()} /></Screen>;
  const state = site.data;
  const readOnly = !!mine && (mine.status === 'submitted' || mine.status === 'approved');
  const existingPhotos = mine?.photos ?? [];
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const areas = state.areas ?? [];
  const areaName = (id: string | null) => areas.find((area) => area.id === id)?.name ?? null;
  const allPhotoIds = [...existingPhotos.map((photo) => photo.id), ...photos.filter((photo) => !existingPhotos.some((sent) => sent.id === photo.id)).map((photo) => photo.id)];
  const today = state.plan?.today ?? [];

  const send = async (submit: boolean) => {
    const problems = reportProblems(draft, existingPhotos.length + photos.length, submit, t);
    if (problems.length) { toast.error(problems[0]); return; }
    const raised = new Set((mine?.issues ?? []).filter((item) => item.raised).map((item) => item.id));
    const payload: ReportPayload = {
      projectId, reportId: reportId.current, submit, photoIds: photos.map((photo) => photo.id),
      report: reportBody(draft, reportDate),
      photoTags: Object.fromEntries(photos.map((photo) => [photo.id, draft.photos[photo.id] ?? { areaId: null, phase: null, pairId: null }])),
      raise: draft.issues.filter((item) => item.raise && item.description.trim() && !raised.has(item.id)).map((item) => ({ issueId: item.id, kind: item.raise! })),
    };
    try {
      await outbox.enqueue({ id: Crypto.randomUUID(), kind: 'site.report', title: submit ? t('Daily report') : t('Report draft'), detail: format.day(reportDate),
        scope: `report:${projectId}:${reportDate}`, payload }, photos.map((photo) => ({ key: photo.id, uri: photo.uri, name: photo.name, type: photo.type })));
      void writeProtectedOfflineText(storageKey, '').catch(() => undefined);
      toast.success(submit ? t('Report sent for approval') : t('Draft saved'));
      // Opened from a notification or a link, there may be nothing to go back to.
      if (router.canGoBack()) router.back();
      else router.replace(`/projects/${projectId}`);
    } catch (error) { toast.error(errorMessage(error, t('Something went wrong'))); }
  };

  if (!state.canReport && !mine) return <Screen title={t('Today’s report')} back><Empty title={t('You can’t report on this project')} detail={t('Ask the project manager to add you to its team.')} /></Screen>;

  const taskRow = (task: { id: string; title: string; detail: string; overdue: boolean; done: boolean }, index: number) => {
    const chosen = draft.tasks[task.id];
    return <View key={task.id} style={{ gap: theme.space(2), paddingHorizontal: theme.space(4), paddingVertical: theme.space(3), borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.structuralDivider }}>
      <Row gap={2} wrap>
        <Text variant="label" style={{ flexShrink: 1 }}>{task.title}</Text>
        {task.overdue ? <Chip label={t('Late')} tone="warning" /> : null}
        {task.done && !chosen ? <Chip label={t('Done')} tone="success" /> : null}
      </Row>
      {task.detail ? <Text variant="caption" tone="secondary">{task.detail}</Text> : null}
      {readOnly || (task.done && !chosen) ? null : <Row gap={1} wrap>
        {STEPS.map((step) => <Chip key={step} label={t(STEP_LABEL[step])} selected={chosen ? stepOf(chosen.progress) === step : false}
          onPress={() => setDraft((current) => chooseProgress(current, task.id, chosen && stepOf(chosen.progress) === step ? null : step))} />)}
        {chosen ? <Chip label={chosen.note ? t('Note ✓') : t('Note')} onPress={() => setNoteFor(today.find((item) => item.id === task.id) ?? null)} /> : null}
      </Row>}
    </View>;
  };

  return <Screen title={t('Today’s report')} subtitle={format.longDay(reportDate)} back keyboard
    footer={readOnly || pending.length ? undefined : <Row gap={2}>
      <Button label={t('Save draft')} variant="secondary" size="lg" onPress={() => send(false)} />
      <View style={{ flex: 1 }}><Button label={t('Submit')} variant="primary" size="lg" full onPress={() => send(true)} /></View>
    </Row>}>
    {mine ? <Row gap={2}><StatusChip status={mine.delivery === 'sent' ? 'sent' : mine.status} />{mine.decidedByName ? <Text variant="caption" tone="secondary">{mine.decidedByName}</Text> : null}</Row> : null}
    {mine?.status === 'returned' && mine.decisionNote ? <Banner tone="warning" title={t('Sent back')} detail={mine.decisionNote} /> : null}
    {pending.length ? <Banner tone="info" title={t('This report is waiting to send')} detail={pending[0].status === 'blocked' && pending[0].error ? t(pending[0].error) : t('It sends by itself when there is a connection.')}
      action={{ label: t('View'), onPress: () => router.push('/outbox') }} /> : null}
    {!mine && state.dueTime ? <Text variant="caption" tone="secondary">{t('Due by {time}', { time: state.dueTime })}</Text> : null}

    <Section title={t('Today’s work')}>
      {today.length || (mine?.tasks ?? []).length ? [
        ...today.map((task) => taskRow(task, format, t)),
        ...(mine?.tasks ?? []).filter((task) => !today.some((item) => item.id === task.workItemId)).map((task) => ({ id: task.workItemId, title: task.title, overdue: false, done: false, detail: '' })),
      ].map(taskRow) : <ListRow first icon={ListChecks} title={t('Nothing is planned for today on the plan.')} />}
    </Section>

    <Section flat title={t('Photos')}>
      {/* A photo already sent shows once, from the server, not again from this phone. */}
      <PhotoGrid photos={[...existingPhotos.map((photo) => ({ key: photo.id, path: sitePhotoPath(projectId, photo.id), label: areaName(draft.photos[photo.id]?.areaId ?? null) ?? undefined })),
        ...photos.filter((photo) => !existingPhotos.some((sent) => sent.id === photo.id)).map((photo) => ({ key: photo.id, uri: photo.uri, label: areaName(draft.photos[photo.id]?.areaId ?? null) ?? undefined }))]}
        onAdd={readOnly ? undefined : (next) => setPhotos((current) => [...current, ...next].slice(0, 20 - existingPhotos.length))}
        onRemove={readOnly ? undefined : (key) => setPhotos((current) => current.filter((photo) => photo.id !== key))}
        onDraw={readOnly ? undefined : (item) => { const photo = photos.find((entry) => entry.id === item.key); if (photo) markup(photo, (drawn) => setPhotos((list) => list.map((entry) => (entry.id === photo.id ? drawn : entry)))); }}
        max={20} />
    </Section>
    {allPhotoIds.length && !readOnly ? <Section title={t('Where the photos are')}>
      {allPhotoIds.map((id, index) => {
        const row = photoRow(draft.photos[id], index, allPhotoIds, areaName, t);
        return <ListRow key={id} first={index === 0} icon={MapPin} title={row.title} detail={row.detail} onPress={() => setTaggingPhoto(id)} />;
      })}
    </Section> : null}

    <Section title={t('Who worked')} action={readOnly ? undefined : <Button size="sm" variant="ghost" icon={Plus} label={t('Add trade')} onPress={() => setTrade(true)} />}>
      {draft.workforce.length ? draft.workforce.map((entry, index) => <View key={entry.trade} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(3), paddingHorizontal: theme.space(4), paddingVertical: theme.space(2), borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.structuralDivider }}>
        <View style={{ flex: 1 }}>
          <Text variant="label">{entry.trade}</Text>
          {readOnly ? (entry.hours ? <Text variant="caption" tone="secondary">{t('{hours} h', { hours: entry.hours })}</Text> : null)
            : <Chip label={entry.hours ? t('{hours} h', { hours: entry.hours }) : t('Hours')} onPress={() => setHoursFor(entry.trade)} />}
        </View>
        {readOnly ? <Text variant="label">{entry.people}</Text> : <>
          <IconButton icon={Minus} label={t('Fewer')} size={40} onPress={() => set('workforce', entry.people <= 1 ? draft.workforce.filter((item) => item.trade !== entry.trade) : draft.workforce.map((item) => (item.trade === entry.trade ? { ...item, people: item.people - 1 } : item)))} />
          <Text variant="subheading" style={{ minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{entry.people}</Text>
          <IconButton icon={Plus} label={t('More')} size={40} onPress={() => set('workforce', draft.workforce.map((item) => (item.trade === entry.trade ? { ...item, people: Math.min(1000, item.people + 1) } : item)))} />
        </>}
      </View>) : <ListRow first icon={Users} title={readOnly ? t('Nobody recorded') : t('Add the trades on site')} onPress={readOnly ? undefined : () => setTrade(true)} />}
    </Section>

    <Section title={t('Issues')} action={readOnly ? undefined : <Button size="sm" variant="ghost" icon={Plus} label={t('Add issue')} onPress={() => setIssue('new')} />}>
      {draft.issues.length ? draft.issues.map((item, index) => {
        const raised = mine?.issues?.find((entry) => entry.id === item.id)?.raised ?? null;
        return <ListRow key={item.id} first={index === 0} icon={AlertTriangle} iconTone={item.severity === 'critical' ? 'danger' : item.severity === 'major' ? 'warning' : 'neutral'} title={item.description}
          detail={[item.internal ? t('Internal') : t('The client can read this'), state.members.find((member) => member.membershipId === item.ownerId)?.name ?? null,
            item.dueOn ? t('Due {date}', { date: format.day(item.dueOn) }) : null,
            raised === 'snag' ? t('Snag raised') : raised === 'material' ? t('Material requested') : raised === 'change_request' ? t('Change request raised')
            : item.raise === 'snag' ? t('Snag to raise') : item.raise === 'material' ? t('Material to request') : item.raise === 'change_request' ? t('Change request to raise') : null]
            .filter(Boolean).join(' · ')}
          onPress={readOnly ? undefined : () => setIssue(item)} />;
      }) : <ListRow first icon={AlertTriangle} title={readOnly ? t('No issues') : t('Add an issue or blocker')} onPress={readOnly ? undefined : () => setIssue('new')} />}
    </Section>

    <Section title={t('Tomorrow')} action={readOnly ? undefined : <Button size="sm" variant="ghost" icon={Plus} label={t('Add')} onPress={() => setAdding(true)} />}>
      {draft.next.length ? draft.next.map((item, index) => <ListRow key={`${item.workItemId ?? 'text'}-${index}`} first={index === 0} icon={CalendarClock} title={item.title}
        trailing={readOnly ? undefined : <IconButton icon={Minus} label={t('Remove')} size={36} onPress={() => set('next', draft.next.filter((_, at) => at !== index))} />} />)
        : <ListRow first icon={CalendarClock} title={readOnly ? t('Nothing planned') : t('Add what’s planned for tomorrow')} onPress={readOnly ? undefined : () => setAdding(true)} />}
    </Section>

    <Section title={t('Materials')} action={readOnly ? undefined : <Button size="sm" variant="ghost" icon={Plus} label={t('Add')} onPress={() => setMaterial('new')} />}>
      {(draft.materials ?? []).length ? draft.materials.map((item, index) => <ListRow key={`${item.description}-${index}`} first={index === 0} icon={Package} title={item.description}
        detail={[item.direction === 'received' ? t('Received') : t('Used'), item.quantity ? `${item.quantity} ${item.unit}`.trim() : null,
          state.deliveries?.find((delivery) => `${delivery.kind}:${delivery.id}` === item.delivery)?.label ?? null].filter(Boolean).join(' · ')}
        onPress={readOnly ? undefined : () => setMaterial(index)} />)
        : <ListRow first icon={Package} title={readOnly ? t('None recorded') : t('Add what arrived or was used')} onPress={readOnly ? undefined : () => setMaterial('new')} />}
    </Section>

    <Section>
      <ToggleRow first label={t('No work today')} value={draft.noWork} onChange={(value) => !readOnly && set('noWork', value)} />
    </Section>
    {draft.noWork ? <TextField label={t('Why')} value={draft.noWorkReason} onChangeText={(value) => set('noWorkReason', value)} maxLength={500} editable={!readOnly} /> : null}

    <Section title={t('Installed today')} action={readOnly || !lines.length ? undefined : <Button size="sm" variant="ghost" icon={Plus} label={t('Add line')} onPress={() => setPicking(true)} />}>
      {draft.lines.length ? draft.lines.map((entry, index) => {
        const line = lineById.get(entry.boqLineId);
        return <ListRow key={entry.boqLineId} first={index === 0} title={line?.title ?? t('Scope line')} onPress={readOnly ? undefined : () => setEditingLine(entry.boqLineId)}
          detail={[line?.areaName, line ? t('{done} of {total} {unit} installed', { done: format.number(line.installed, 2), total: format.number(line.quantity, 2), unit: line.unit }) : null, entry.note].filter(Boolean).join(' · ')}
          trailing={<Chip label={`${Number(entry.installed) > 0 ? '+' : ''}${format.number(entry.installed, 2)} ${line?.unit ?? ''}`} tone={Number(entry.installed) < 0 ? 'warning' : 'action'} />} />;
      }) : <ListRow first icon={Ruler} title={readOnly ? t('Nothing recorded') : lines.length ? t('Add what was installed') : t('No scope lines on this project')} onPress={readOnly || !lines.length ? undefined : () => setPicking(true)} />}
    </Section>

    <Section flat title={t('Weather')}>
      <Row gap={2} wrap>{WEATHER.map((label) => <Chip key={label} label={t(label)} selected={draft.weather === t(label)} onPress={readOnly ? undefined : () => set('weather', draft.weather === t(label) ? '' : t(label))} />)}</Row>
    </Section>

    <Section flat title={t('Safety')}>
      <SegmentedControl value={draft.safety} onChange={(value) => !readOnly && set('safety', value)} options={[{ value: 'none', label: t('All clear') }, { value: 'observation', label: t('Observation') }, { value: 'incident', label: t('Incident') }]} />
      {draft.safety !== 'none' ? <TextField value={draft.safetyNote} onChangeText={(value) => set('safetyNote', value)} multiline maxLength={1000} editable={!readOnly}
        placeholder={draft.safety === 'incident' ? t('What happened, who was involved') : t('What you noticed')} /> : null}
    </Section>

    <Section flat title={t('Outlook')}>
      <SegmentedControl value={draft.forecast} onChange={(value) => !readOnly && set('forecast', value)} options={[{ value: 'none', label: t('On track') }, { value: 'watch', label: t('At risk') }, { value: 'blocked', label: t('Blocked') }]} />
      {draft.forecast !== 'none' ? <>
        <TextField label={t('What is at risk')} value={draft.impact} onChangeText={(value) => set('impact', value)} multiline maxLength={1000} editable={!readOnly} />
        <SelectField label={t('Who recovers it')} value={draft.recoveryOwnerId} onChange={(value) => set('recoveryOwnerId', value)} disabled={readOnly}
          options={state.members.map((member) => ({ value: member.membershipId, label: member.name }))} />
        <DateField label={t('By when')} value={draft.recoveryOn} onChange={(value) => set('recoveryOn', value)} min={format.today()} disabled={readOnly} />
      </> : null}
    </Section>

    <TextField label={t('Notes for the team')} value={draft.notes} onChangeText={(value) => set('notes', value)} multiline maxLength={4000} placeholder={t('Optional')} editable={!readOnly} />

    <OptionSheet open={trade} onClose={() => setTrade(false)} title={t('Trade')} value={null}
      options={[...trades.map((name) => ({ value: name, label: name })), { value: '__other__', label: t('Another trade…') }]}
      onChange={(value) => {
        setTrade(false);
        if (value === '__other__') setTimeout(() => setEditingLine('__trade__'), 300);
        else if (value) set('workforce', [...draft.workforce, { trade: value, people: 1, hours: null }]);
      }} />
    <LinePicker open={picking} onClose={() => setPicking(false)} lines={lines.filter((line) => !draft.lines.some((entry) => entry.boqLineId === line.id))}
      onPick={(line) => { setPicking(false); set('lines', [...draft.lines, { boqLineId: line.id, installed: '', note: '' }]); setTimeout(() => setEditingLine(line.id), 300); }} />
    <QuantitySheet line={editingLine && editingLine !== '__trade__' ? lineById.get(editingLine) ?? null : null} entry={draft.lines.find((entry) => entry.boqLineId === editingLine) ?? null}
      onClose={() => setEditingLine(null)}
      onSave={(entry) => { set('lines', draft.lines.map((item) => (item.boqLineId === entry.boqLineId ? entry : item))); setEditingLine(null); }}
      onRemove={(id) => { set('lines', draft.lines.filter((item) => item.boqLineId !== id)); setEditingLine(null); }} />
    <TradeNameSheet open={editingLine === '__trade__'} onClose={() => setEditingLine(null)} onAdd={(name) => { set('workforce', [...draft.workforce, { trade: name, people: 1, hours: null }]); setEditingLine(null); }} />
    <HoursSheet trade={hoursFor} hours={draft.workforce.find((entry) => entry.trade === hoursFor)?.hours ?? null} onClose={() => setHoursFor(null)}
      onSave={(hours) => { set('workforce', draft.workforce.map((entry) => (entry.trade === hoursFor ? { ...entry, hours } : entry))); setHoursFor(null); }} />
    <PhotoTagSheet id={taggingPhoto} tags={taggingPhoto ? draft.photos[taggingPhoto] ?? null : null} photoIds={allPhotoIds} areas={areas} onClose={() => setTaggingPhoto(null)}
      onChange={(patch) => taggingPhoto && setDraft((current) => tagPhoto(current, taggingPhoto, patch))} />
    <IssueSheet issue={issue} members={state.members} onClose={() => setIssue(null)}
      onSave={(saved) => { set('issues', draft.issues.some((item) => item.id === saved.id) ? draft.issues.map((item) => (item.id === saved.id ? saved : item)) : [...draft.issues, saved]); setIssue(null); }}
      onRemove={(id) => { set('issues', draft.issues.filter((item) => item.id !== id)); setIssue(null); }}
      raised={issue && issue !== 'new' ? mine?.issues?.find((entry) => entry.id === issue.id)?.raised ?? null : null} />
    <MaterialSheet material={material === null ? null : material === 'new' ? 'new' : draft.materials[material] ?? null} deliveries={state.deliveries ?? []} onClose={() => setMaterial(null)}
      onSave={(item) => { set('materials', material === 'new' || material === null ? [...draft.materials, item] : draft.materials.map((entry, at) => (at === material ? item : entry))); setMaterial(null); }}
      onRemove={() => { if (typeof material === 'number') set('materials', draft.materials.filter((_, at) => at !== material)); setMaterial(null); }} />
    <TextSheet open={adding} title={t('Planned for tomorrow')} label={t('What’s planned')} onClose={() => setAdding(false)}
      onAdd={(title) => { set('next', [...draft.next, { workItemId: null, title }]); setAdding(false); }} />
    <TextSheet open={!!noteFor} title={noteFor?.title ?? ''} label={t('Note')} initial={noteFor ? draft.tasks[noteFor.id]?.note ?? '' : ''} onClose={() => setNoteFor(null)}
      onAdd={(note) => { if (noteFor) set('tasks', { ...draft.tasks, [noteFor.id]: { ...(draft.tasks[noteFor.id] ?? { progress: 10 }), note } }); setNoteFor(null); }} />
  </Screen>;
}

/** Hours the trade was on site today. */
function HoursSheet({ trade, hours, onClose, onSave }: { trade: string | null; hours: number | null; onClose: () => void; onSave: (hours: number | null) => void }) {
  const t = useT();
  const [value, setValue] = useState('');
  useEffect(() => { if (trade) setValue(hours ? String(hours) : '8'); }, [trade, hours]);
  return <Sheet open={!!trade} onClose={onClose} title={trade ?? ''} footer={<>
    <Button label={t('Done')} variant="primary" size="lg" full onPress={() => onSave(Number(value) > 0 ? Math.min(24, Number(value)) : null)} />
    <Button label={t('Clear')} variant="ghost" full onPress={() => onSave(null)} />
  </>}>
    <Stepper label={t('Hours on site')} value={value} onChange={setValue} unit="h" places={1} max={24} step={0.5} />
  </Sheet>;
}

/** A photo's room, before or after, and the photo it pairs with. */
function PhotoTagSheet({ id, tags, photoIds, areas, onClose, onChange }: {
  id: string | null; tags: PhotoTags | null; photoIds: string[]; areas: Array<{ id: string; name: string }>; onClose: () => void; onChange: (patch: Partial<PhotoTags>) => void;
}) {
  const t = useT();
  const number = id ? photoIds.indexOf(id) + 1 : 0;
  return <Sheet open={!!id} onClose={onClose} title={t('Photo {number}', { number })} footer={<Button label={t('Done')} variant="primary" size="lg" full onPress={onClose} />}>
    {areas.length ? <SelectField label={t('Room or area')} value={tags?.areaId ?? null} allowClear options={areas.map((area) => ({ value: area.id, label: area.name }))}
      onChange={(value) => onChange({ areaId: value })} /> : null}
    <SegmentedControl label={t('Before or after')} value={tags?.phase ?? 'none'} onChange={(value) => onChange({ phase: value === 'none' ? null : value })}
      options={[{ value: 'none', label: t('Photo') }, { value: 'before', label: t('Before') }, { value: 'after', label: t('After') }]} />
    {tags?.phase && photoIds.length > 1 ? <SelectField label={t('Pairs with')} value={tags.pairId ?? null} allowClear
      options={photoIds.filter((other) => other !== id).map((other) => ({ value: other, label: t('Photo {number}', { number: photoIds.indexOf(other) + 1 }) }))}
      onChange={(value) => onChange({ pairId: value })} /> : null}
  </Sheet>;
}

/** An issue or blocker: how serious, what it is, whether the client may read it, who owns it by when, and a snag, change request or material request raised from it. */
function IssueSheet({ issue, raised, members, onClose, onSave, onRemove }: {
  issue: Issue | 'new' | null; raised: 'snag' | 'material' | 'change_request' | null; members: Array<{ membershipId: string; name: string }>;
  onClose: () => void; onSave: (issue: Issue) => void; onRemove: (id: string) => void;
}) {
  const t = useT();
  const format = useFormat();
  const [value, setValue] = useState<Issue | null>(null);
  useEffect(() => { if (issue) setValue(issue === 'new' ? { id: Crypto.randomUUID(), severity: 'minor', description: '', internal: true, raise: null, ownerId: null, dueOn: null } : issue); }, [issue]);
  if (!issue || !value) return null;
  return <Sheet open={!!issue} onClose={onClose} title={issue === 'new' ? t('Add issue') : t('Issue')} footer={<>
    <Button label={t('Done')} variant="primary" size="lg" full disabled={!value.description.trim()} onPress={() => onSave({ ...value, description: value.description.trim().slice(0, 1000) })} />
    {issue !== 'new' ? <Button label={t('Remove')} variant="ghost" full onPress={() => onRemove(value.id)} /> : null}
  </>}>
    <SegmentedControl label={t('How serious')} value={value.severity} onChange={(severity) => setValue({ ...value, severity })}
      options={[{ value: 'minor', label: t('Minor') }, { value: 'major', label: t('Major') }, { value: 'critical', label: t('Critical') }]} />
    <TextField label={t('What’s wrong')} value={value.description} onChangeText={(description) => setValue({ ...value, description })} multiline maxLength={1000} autoFocus={issue === 'new'} />
    <ToggleRow first label={t('The client can read this')} value={!value.internal} onChange={(shown) => setValue({ ...value, internal: !shown })} />
    <SelectField label={t('Owner')} value={value.ownerId ?? null} allowClear options={members.map((member) => ({ value: member.membershipId, label: member.name }))}
      onChange={(ownerId) => setValue({ ...value, ownerId })} />
    <DateField label={t('Due')} value={value.dueOn ?? ''} onChange={(dueOn) => setValue({ ...value, dueOn: dueOn || null })} min={format.today()} />
    {raised ? <Banner tone="info" title={raised === 'snag' ? t('Snag raised') : raised === 'change_request' ? t('Change request raised') : t('Material requested')} /> : <Row gap={2} wrap>
      <Chip label={t('Raise a snag')} selected={value.raise === 'snag'} onPress={() => setValue({ ...value, raise: value.raise === 'snag' ? null : 'snag' })} />
      <Chip label={t('Raise a change request')} selected={value.raise === 'change_request'} onPress={() => setValue({ ...value, raise: value.raise === 'change_request' ? null : 'change_request' })} />
      <Chip label={t('Request material')} selected={value.raise === 'material'} onPress={() => setValue({ ...value, raise: value.raise === 'material' ? null : 'material' })} />
    </Row>}
  </Sheet>;
}

/** A material that arrived on site or was used, on the delivery it came with when there's one. */
function MaterialSheet({ material, deliveries, onClose, onSave, onRemove }: {
  material: Material | 'new' | null; deliveries: SiteDelivery[]; onClose: () => void; onSave: (material: Material) => void; onRemove: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState<Material | null>(null);
  useEffect(() => { if (material) setValue(material === 'new' ? { direction: 'received', description: '', quantity: '', unit: '', delivery: '' } : material); }, [material]);
  if (!material || !value) return null;
  return <Sheet open={!!material} onClose={onClose} title={material === 'new' ? t('Add a material') : t('Material')} footer={<>
    <Button label={t('Done')} variant="primary" size="lg" full disabled={!value.description.trim()} onPress={() => onSave({ ...value, description: value.description.trim().slice(0, 300) })} />
    {material !== 'new' ? <Button label={t('Remove')} variant="ghost" full onPress={onRemove} /> : null}
  </>}>
    <SegmentedControl label={t('Received or used')} value={value.direction} onChange={(direction) => setValue({ ...value, direction })}
      options={[{ value: 'received', label: t('Received') }, { value: 'used', label: t('Used') }]} />
    <TextField label={t('Material')} value={value.description} onChangeText={(description) => setValue({ ...value, description })} maxLength={300} autoFocus={material === 'new'} />
    <Row gap={2}>
      <View style={{ flex: 1 }}><TextField label={t('Quantity')} value={value.quantity} keyboardType="decimal-pad" onChangeText={(quantity) => setValue({ ...value, quantity: cleanDecimal(quantity, 4) })} /></View>
      <View style={{ flex: 1 }}><TextField label={t('Unit')} value={value.unit} onChangeText={(unit) => setValue({ ...value, unit })} maxLength={20} /></View>
    </Row>
    {deliveries.length ? <SelectField label={t('Delivery')} value={value.delivery || null} allowClear options={deliveries.map((delivery) => ({ value: `${delivery.kind}:${delivery.id}`, label: delivery.label }))}
      onChange={(delivery) => setValue({ ...value, delivery: delivery ?? '' })} /> : null}
  </Sheet>;
}

/** One line of text: tomorrow's work, or a note on a task. */
function TextSheet({ open, title, label, initial = '', onClose, onAdd }: { open: boolean; title: string; label: string; initial?: string; onClose: () => void; onAdd: (text: string) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  useEffect(() => { if (open) setText(initial); }, [open, initial]);
  return <Sheet open={open} onClose={onClose} title={title}
    footer={<Button label={t('Done')} variant="primary" size="lg" full disabled={!text.trim() && !initial} onPress={() => onAdd(text.trim().slice(0, 300))} />}>
    <TextField label={label} value={text} onChangeText={setText} autoFocus maxLength={300} />
  </Sheet>;
}


function LinePicker({ open, onClose, lines, onPick }: { open: boolean; onClose: () => void; lines: SiteLine[]; onPick: (line: SiteLine) => void }) {
  const t = useT();
  const format = useFormat();
  const [query, setQuery] = useState('');
  const shown = lines.filter((line) => `${line.title} ${line.areaName ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <Sheet open={open} onClose={onClose} title={t('What was installed?')} full>
    <SearchField value={query} onChange={setQuery} placeholder={t('Search the scope')} />
    <Section>
      {shown.slice(0, 80).map((line, index) => <ListRow key={line.id} first={index === 0} title={line.title} onPress={() => onPick(line)}
        detail={[line.areaName, t('{done} of {total} {unit}', { done: format.number(line.installed, 2), total: format.number(line.quantity, 2), unit: line.unit })].filter(Boolean).join(' · ')} />)}
      {!shown.length ? <ListRow first title={t('Nothing matches')} /> : null}
    </Section>
  </Sheet>;
}

/** How much of a line went in today; a negative amount corrects an earlier report and needs a note. */
function QuantitySheet({ line, entry, onClose, onSave, onRemove }: { line: SiteLine | null; entry: Installed | null; onClose: () => void; onSave: (entry: Installed) => void; onRemove: (id: string) => void }) {
  const t = useT();
  const format = useFormat();
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [correction, setCorrection] = useState(false);
  useEffect(() => {
    if (!entry) return;
    setCorrection(Number(entry.installed) < 0);
    setValue(entry.installed ? String(Math.abs(Number(entry.installed))) : '');
    setNote(entry.note);
  }, [entry]);
  if (!line || !entry) return null;
  const left = Math.max(0, Number(line.quantity) - Number(line.installed) - Number(line.pending));
  const amount = Number(value || 0);
  const over = !correction && amount > left;
  return <Sheet open={!!line} onClose={onClose} title={line.title} subtitle={line.areaName ?? undefined}
    footer={<>
      <Button label={t('Done')} variant="primary" size="lg" full disabled={!amount || (correction && !note.trim())} onPress={() => onSave({ boqLineId: line.id, installed: `${correction ? '-' : ''}${cleanDecimal(value, 4)}`, note: note.trim().slice(0, 500) })} />
      <Button label={t('Remove')} variant="ghost" full onPress={() => onRemove(line.id)} />
    </>}>
    <Text variant="caption" tone="secondary">{t('{done} of {total} {unit} installed · {left} left', { done: format.number(line.installed, 2), total: format.number(line.quantity, 2), unit: line.unit, left: format.number(left, 2) })}</Text>
    <Stepper label={correction ? t('Take back') : t('Installed today')} value={value} onChange={setValue} unit={line.unit} places={4}
      error={over ? t('More than is left on this line') : undefined} />
    <ToggleRow first label={t('Correct an earlier report')} value={correction} onChange={setCorrection} />
    <TextField label={correction ? t('Why') : t('Note')} value={note} onChangeText={setNote} maxLength={500} placeholder={correction ? undefined : t('Optional')} />
  </Sheet>;
}

function TradeNameSheet({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (name: string) => void }) {
  const t = useT();
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName(''); }, [open]);
  return <Sheet open={open} onClose={onClose} title={t('Another trade')}
    footer={<Button label={t('Add')} variant="primary" size="lg" full disabled={!name.trim()} onPress={() => onAdd(name.trim().slice(0, 80))} />}>
    <TextField label={t('Trade')} value={name} onChangeText={setName} autoFocus maxLength={80} placeholder={t('e.g. Tiling')} />
  </Sheet>;
}
