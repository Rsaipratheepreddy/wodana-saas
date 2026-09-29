import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Minus, Plus, Ruler, Users } from 'lucide-react-native';
import type { SiteLine } from '../../../../web/lib/site/types';
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
import { empty, fromReport, reportProblems, type Draft, type Installed } from './report-model';

const WEATHER = [key('Clear'), key('Hot'), key('Humid'), key('Windy'), key('Dusty'), key('Rain')];
/** Today's site report: who worked, what was installed, weather, safety, outlook and photos. Works offline. */
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
  const storageKey = `wodana.report-draft.v1.${session.userId}.${projectId}.${reportDate}`;
  const [draft, setDraft] = useState<Draft>(empty);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [picking, setPicking] = useState(false);
  const [trade, setTrade] = useState(false);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const markup = useMarkup();

  // Start from the saved report, or a draft kept on the phone.
  useEffect(() => {
    if (loaded || !site.data) return;
    void readProtectedOfflineText(storageKey).then((raw) => {
      const saved = raw ? (JSON.parse(raw) as { draft: Draft; reportId?: string }) : null;
      if (saved && !mine) { setDraft(saved.draft); if (saved.reportId) reportId.current = saved.reportId; }
      else if (mine) setDraft(fromReport(mine));
    }).catch(() => { if (mine) setDraft(fromReport(mine)); }).finally(() => setLoaded(true));
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

  if (site.isLoading || !loaded && !site.error) return <Screen title={t('Daily report')} back><Loading shape="form" count={5} /></Screen>;
  if (site.error || !site.data) return <Screen title={t('Daily report')} back><Failure message={errorMessage(site.error, t('The site could not be loaded.'))} onRetry={() => void site.refetch()} /></Screen>;
  const state = site.data;
  const readOnly = !!mine && (mine.status === 'submitted' || mine.status === 'approved');
  const existingPhotos = mine?.photos ?? [];
  const set = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((current) => ({ ...current, [field]: value }));

  const send = async (submit: boolean) => {
    const problems = reportProblems(draft, existingPhotos.length + photos.length, submit, t);
    if (problems.length) { toast.error(problems[0]); return; }
    const payload: ReportPayload = {
      projectId, reportId: reportId.current, submit, photoIds: photos.map((photo) => photo.id),
      report: {
        reportDate, weather: draft.weather.trim().slice(0, 120), safety: draft.safety, safetyNote: draft.safety === 'none' ? '' : draft.safetyNote.trim(),
        forecast: draft.forecast, impact: draft.forecast === 'none' ? '' : draft.impact.trim(),
        ...(draft.forecast !== 'none' ? { recoveryOwnerId: draft.recoveryOwnerId, recoveryOn: draft.recoveryOn } : {}),
        noWorkReason: draft.noWork ? draft.noWorkReason.trim() : '', notes: draft.notes.trim(),
        workforce: draft.workforce.filter((entry) => entry.trade.trim() && entry.people > 0),
        lines: draft.lines.map((line) => ({ boqLineId: line.boqLineId, installed: line.installed, note: line.note.trim() })),
      },
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

  if (!state.canReport && !mine) return <Screen title={t('Daily report')} back><Empty title={t('You can’t report on this project')} detail={t('Ask the project manager to add you to its team.')} /></Screen>;

  return <Screen title={t('Daily report')} subtitle={format.longDay(reportDate)} back keyboard
    footer={readOnly || pending.length ? undefined : <Row gap={2}>
      <Button label={t('Save draft')} variant="secondary" size="lg" onPress={() => send(false)} />
      <View style={{ flex: 1 }}><Button label={t('Submit')} variant="primary" size="lg" full onPress={() => send(true)} /></View>
    </Row>}>
    {mine ? <Row gap={2}><StatusChip status={mine.status} />{mine.decidedByName ? <Text variant="caption" tone="secondary">{mine.decidedByName}</Text> : null}</Row> : null}
    {mine?.status === 'returned' && mine.decisionNote ? <Banner tone="warning" title={t('Sent back')} detail={mine.decisionNote} /> : null}
    {pending.length ? <Banner tone="info" title={t('This report is waiting to send')} detail={pending[0].status === 'blocked' ? pending[0].error : t('It sends by itself when there is a connection.')}
      action={{ label: t('View'), onPress: () => router.push('/outbox') }} /> : null}

    <Section title={t('Who worked')} action={readOnly ? undefined : <Button size="sm" variant="ghost" icon={Plus} label={t('Add trade')} onPress={() => setTrade(true)} />}>
      {draft.workforce.length ? draft.workforce.map((entry, index) => <View key={entry.trade} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space(3), paddingHorizontal: theme.space(4), paddingVertical: theme.space(2), borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.structuralDivider }}>
        <Text variant="label" style={{ flex: 1 }}>{entry.trade}</Text>
        {readOnly ? <Text variant="label">{entry.people}</Text> : <>
          <IconButton icon={Minus} label={t('Fewer')} size={40} onPress={() => set('workforce', entry.people <= 1 ? draft.workforce.filter((item) => item.trade !== entry.trade) : draft.workforce.map((item) => (item.trade === entry.trade ? { ...item, people: item.people - 1 } : item)))} />
          <Text variant="subheading" style={{ minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{entry.people}</Text>
          <IconButton icon={Plus} label={t('More')} size={40} onPress={() => set('workforce', draft.workforce.map((item) => (item.trade === entry.trade ? { ...item, people: Math.min(1000, item.people + 1) } : item)))} />
        </>}
      </View>) : <ListRow first icon={Users} title={readOnly ? t('Nobody recorded') : t('Add the trades on site')} onPress={readOnly ? undefined : () => setTrade(true)} />}
    </Section>

    <Section title={t('Installed today')} action={readOnly || !lines.length ? undefined : <Button size="sm" variant="ghost" icon={Plus} label={t('Add line')} onPress={() => setPicking(true)} />}>
      {draft.lines.length ? draft.lines.map((entry, index) => {
        const line = lineById.get(entry.boqLineId);
        return <ListRow key={entry.boqLineId} first={index === 0} title={line?.title ?? t('Scope line')} onPress={readOnly ? undefined : () => setEditingLine(entry.boqLineId)}
          detail={[line?.areaName, line ? t('{done} of {total} {unit} installed', { done: format.number(line.installed, 2), total: format.number(line.quantity, 2), unit: line.unit }) : null, entry.note].filter(Boolean).join(' · ')}
          trailing={<Chip label={`${Number(entry.installed) > 0 ? '+' : ''}${format.number(entry.installed, 2)} ${line?.unit ?? ''}`} tone={Number(entry.installed) < 0 ? 'warning' : 'action'} />} />;
      }) : <ListRow first icon={Ruler} title={readOnly ? t('Nothing recorded') : lines.length ? t('Add what was installed') : t('No scope lines on this project')} onPress={readOnly || !lines.length ? undefined : () => setPicking(true)} />}
    </Section>

    <Section flat title={t('Photos')}>
      {/* A photo already sent shows once, from the server, not again from this phone. */}
      <PhotoGrid photos={[...existingPhotos.map((photo) => ({ key: photo.id, path: sitePhotoPath(projectId, photo.id) })),
        ...photos.filter((photo) => !existingPhotos.some((sent) => sent.id === photo.id)).map((photo) => ({ key: photo.id, uri: photo.uri }))]}
        onAdd={readOnly ? undefined : (next) => setPhotos((current) => [...current, ...next].slice(0, 10 - existingPhotos.length))}
        onRemove={readOnly ? undefined : (key) => setPhotos((current) => current.filter((photo) => photo.id !== key))}
        onDraw={readOnly ? undefined : (item) => { const photo = photos.find((entry) => entry.id === item.key); if (photo) markup(photo, (drawn) => setPhotos((list) => list.map((entry) => (entry.id === photo.id ? drawn : entry)))); }}
        max={10} />
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

    <Section>
      <ToggleRow first label={t('No work today')} value={draft.noWork} onChange={(value) => !readOnly && set('noWork', value)} />
    </Section>
    {draft.noWork ? <TextField label={t('Why')} value={draft.noWorkReason} onChangeText={(value) => set('noWorkReason', value)} maxLength={500} editable={!readOnly} /> : null}
    <TextField label={t('Notes')} value={draft.notes} onChangeText={(value) => set('notes', value)} multiline maxLength={4000} placeholder={t('Optional')} editable={!readOnly} />

    <OptionSheet open={trade} onClose={() => setTrade(false)} title={t('Trade')} value={null}
      options={[...trades.map((name) => ({ value: name, label: name })), { value: '__other__', label: t('Another trade…') }]}
      onChange={(value) => {
        setTrade(false);
        if (value === '__other__') setTimeout(() => setEditingLine('__trade__'), 300);
        else if (value) set('workforce', [...draft.workforce, { trade: value, people: 1 }]);
      }} />
    <LinePicker open={picking} onClose={() => setPicking(false)} lines={lines.filter((line) => !draft.lines.some((entry) => entry.boqLineId === line.id))}
      onPick={(line) => { setPicking(false); set('lines', [...draft.lines, { boqLineId: line.id, installed: '', note: '' }]); setTimeout(() => setEditingLine(line.id), 300); }} />
    <QuantitySheet line={editingLine && editingLine !== '__trade__' ? lineById.get(editingLine) ?? null : null} entry={draft.lines.find((entry) => entry.boqLineId === editingLine) ?? null}
      onClose={() => setEditingLine(null)}
      onSave={(entry) => { set('lines', draft.lines.map((item) => (item.boqLineId === entry.boqLineId ? entry : item))); setEditingLine(null); }}
      onRemove={(id) => { set('lines', draft.lines.filter((item) => item.boqLineId !== id)); setEditingLine(null); }} />
    <TradeNameSheet open={editingLine === '__trade__'} onClose={() => setEditingLine(null)} onAdd={(name) => { set('workforce', [...draft.workforce, { trade: name, people: 1 }]); setEditingLine(null); }} />
  </Screen>;
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
