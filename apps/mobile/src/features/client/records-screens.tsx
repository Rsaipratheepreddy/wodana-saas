import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { FileImage, FileSignature, FileText, PenLine, ShieldCheck } from 'lucide-react-native';
import { key, useT } from '../../core/i18n';
import { CodedDecision } from '../../portal/flows';
import { decisionPurpose, signed } from '../../portal/model';
import { usePortal, usePortalFormat, useProject, useRefreshPortal } from '../../portal/provider';
import type { PortalChange, PortalDocument, PortalProject } from '../../portal/types';
import { ReasonSheet } from '../../ui/dialogs';
import { Card, Empty, Failure, Fact, Loading, Screen, Section } from '../../ui/layout';
import { Button, Chip, Row, Text } from '../../ui/primitives';
import { Sheet } from '../../ui/sheet';
import { TextField } from '../../ui/fields';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';
import { AttachPhotos, CodeSheet, FileStrip, openPortalFile, PortalImage, StateChip } from './parts';

/** A screen of the signed-in client's project: loading, failure and "nothing yet" handled the same way everywhere. */
function ProjectScreen({ title, children, action }: { title: string; children: (project: PortalProject) => React.ReactNode; action?: React.ReactNode }) {
  const { project, query } = useProject();
  const refresh = useRefreshPortal();
  if (query.isLoading) return <Screen title={title} back><Loading shape="cards" count={3} /></Screen>;
  if (query.error && !query.data) return <Screen title={title} back><Failure message={query.error.message} onRetry={() => void query.refetch()} /></Screen>;
  return <Screen title={title} back action={action} onRefresh={() => void refresh()} refreshing={query.isRefetching}>{project ? children(project) : null}</Screen>;
}

const DOCUMENT_KINDS: Record<PortalDocument['kind'], string> = { agreement: key('Agreement'), design: key('Approved design'), handover: key('Handover'), change: key('Signed change') };

/** The documents published to the client as cards (E5-4): a preview, the title, type, version and date, "Changed" when it replaced one. */
export function ClientDocumentsScreen() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const format = usePortalFormat();
  const { client } = usePortal();
  return <ProjectScreen title={t('Documents')}>{(project) => {
    const documents = [...(project.documents ?? [])].sort((a, b) => (b.at ?? b.date ?? '').localeCompare(a.at ?? a.date ?? ''));
    if (!documents.length) return <Empty icon={FileText} title={t('No documents yet')} detail={t('Your agreement, approved designs and handover pack will appear here.')} />;
    return documents.map((document) => <Card key={`${document.kind}-${document.id}`} onPress={() => {
      void openPortalFile(client, document.kind, document.id, document.title).catch((cause: Error) => toast.error(cause.message));
    }}>
      <Row gap={3} align="flex-start">
        <View style={{ width: 64, height: 64, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
          {document.hasPreview ? <PortalImage kind={document.kind} id={document.id} style={{ width: 64, height: 64 }} />
            : document.mimeType.startsWith('image/') ? <FileImage color={theme.colors.icon} size={24} /> : <FileText color={theme.colors.icon} size={24} />}
        </View>
        <View style={{ flex: 1, gap: theme.space(1) }}>
          <Text variant="label" numberOfLines={2}>{document.title}</Text>
          <Row gap={1} wrap>
            <Chip label={t(DOCUMENT_KINDS[document.kind])} />
            {document.version ? <Chip label={t('V{number}', { number: document.version })} /> : null}
            {document.changed ? <Chip label={t('Changed')} tone="warning" /> : null}
          </Row>
          <Text variant="caption" tone="secondary">{[document.group, format.day(document.date)].filter(Boolean).join(' · ')}</Text>
        </View>
      </Row>
    </Card>);
  }}</ProjectScreen>;
}

const LINE_ACTIONS: Record<PortalChange['lines'][number]['action'], string> = { add: key('Add'), omit: key('Remove'), replace: key('Replace'), draw: key('From allowance') };

/**
 * Change requests (R11): what changes line by line and what it does to the price and the handover date. The
 * decision-maker approves with a code bound to exactly this change, or declines saying why. The client can ask for one.
 */
export function ClientChangesScreen() {
  const t = useT();
  const { project } = useProject();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const [asking, setAsking] = useState(false);
  const canAsk = project?.role === 'approver' && project.sections.decisions && Boolean(project.changes);
  return <ProjectScreen title={t('Changes')} action={canAsk ? <Button size="sm" icon={PenLine} label={t('Ask for a change')} onPress={() => setAsking(true)} /> : undefined}>{(current) => {
    const changes = current.changes ?? [];
    const ordered = [...changes].sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || Number(b.canDecide) - Number(a.canDecide) || b.createdAt.localeCompare(a.createdAt));
    return <>
      {ordered.length ? ordered.map((change) => <ChangeCard key={change.id} change={change} caseId={current.id} />)
        : <Empty icon={FileSignature} title={t('No changes yet')} />}
      <AskChangeSheet open={asking} onClose={() => setAsking(false)} caseId={current.id} />
    </>;
  }}</ProjectScreen>;
}

function ChangeCard({ change, caseId }: { change: PortalChange; caseId: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const format = usePortalFormat();
  const { client, state } = usePortal();
  const refresh = useRefreshPortal();
  const [decision, setDecision] = useState<CodedDecision | null>(null);
  const [declining, setDeclining] = useState(false);
  const [id] = useState(() => client.newId());
  const channels = (state.status === 'signedIn' ? state.site?.signIn.channels : null) ?? ['whatsapp', 'email'];
  const money = (value: string) => (change.currency ? format.money(value, change.currency) : value);
  const days = change.timeImpactDays ?? 0;
  const decline = async (note: string) => {
    try {
      await client.command(id, { action: 'change_decision', caseId, changeId: change.id, decision: 'decline', version: change.version, note });
      toast.success(t('Thank you. Your decision was sent to your project team.')); await refresh();
    } catch (cause) { toast.error((cause as Error).message); throw cause; }
  };
  return <Card>
    <Row style={{ justifyContent: 'space-between' }} align="flex-start">
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" tone="secondary">{change.reference}</Text>
        <Text variant="subheading">{change.title}</Text>
      </View>
      <StateChip state={change.status} canDecide={change.canDecide} />
    </Row>
    {change.description ? <Text>{change.description}</Text> : null}
    {change.status === 'with_team' ? <Text variant="caption" tone="secondary">{t('Your project team is working out what this changes. You\'ll decide once they send it.')}</Text> : null}
    {change.lines.length ? <View style={{ borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.structuralDivider }}>
      {change.lines.map((line, index) => <Fact key={line.id} first={index === 0} label={`${t(LINE_ACTIONS[line.action])}: ${line.title}`}
        value={<Text variant="label" style={{ writingDirection: 'ltr' }}>{signed(line.amount, money)}</Text>} />)}
    </View> : null}
    {change.priceImpact !== null ? <View style={{ gap: theme.space(1) }}>
      <Row style={{ justifyContent: 'space-between' }}><Text tone="secondary">{t('Price')}</Text><Text variant="label" style={{ writingDirection: 'ltr' }}>{signed(change.priceImpact, money)}</Text></Row>
      <Row style={{ justifyContent: 'space-between' }}><Text tone="secondary">{t('Handover')}</Text><Text variant="label" style={{ flexShrink: 1 }}>{days && change.handoverAfter
        ? Math.abs(days) === 1
          ? t('{before} → {after} ({days} working day)', { before: format.day(change.handoverBefore), after: format.day(change.handoverAfter), days: `${days > 0 ? '+' : ''}${days}` })
          : t('{before} → {after} ({days} working days)', { before: format.day(change.handoverBefore), after: format.day(change.handoverAfter), days: `${days > 0 ? '+' : ''}${days}` })
        : change.handoverBefore ? t('{date}, unchanged', { date: format.day(change.handoverBefore) }) : t('No change')}</Text></Row>
      {change.designImpact ? <Row style={{ justifyContent: 'space-between' }}><Text tone="secondary">{t('Design')}</Text><Text variant="label" style={{ flexShrink: 1 }}>{change.designImpact}</Text></Row> : null}
    </View> : null}
    {change.decidedAt ? <Text variant="caption" tone="secondary">{t('{name} decided on {date}.', { name: change.decidedBy ?? '', date: format.day(change.decidedAt) })}</Text> : null}
    {change.status === 'declined' && change.declineNote ? <Text variant="caption">{change.declineNote}</Text> : null}
    {change.signed ? <Button size="sm" variant="ghost" icon={FileText} label={t('Signed copy')}
      onPress={() => { void openPortalFile(client, 'change', change.id, `${change.reference}.pdf`).catch((cause: Error) => toast.error(cause.message)); }} /> : null}
    {change.canDecide ? <Row gap={2} style={{ justifyContent: 'flex-end' }}>
      <Button size="sm" variant="ghost" label={t('Decline')} onPress={() => setDeclining(true)} />
      <Button size="sm" variant="primary" label={t('Approve change')} testID={`approve-change-${change.id}`}
        onPress={() => setDecision(new CodedDecision(client, decisionPurpose('change', caseId, change.id, 'accept'),
          { action: 'change_decision', caseId, changeId: change.id, decision: 'accept', version: change.version }))} />
    </Row> : null}
    <ReasonSheet open={declining} onClose={() => setDeclining(false)} title={t('Decline change')} label={t('Why are you declining it?')} action={t('Decline change')} onSubmit={decline} />
    <CodeSheet decision={decision} channels={channels} confirmLabel={t('Approve change')} onClose={() => setDecision(null)}
      onDone={() => { setDecision(null); toast.success(t('Thank you. Your decision was sent to your project team.'), 'approve'); void refresh(); }} />
  </Card>;
}

function AskChangeSheet({ open, onClose, caseId }: { open: boolean; onClose: () => void; caseId: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { client } = usePortal();
  const refresh = useRefreshPortal();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [ids, setIds] = useState(() => ({ command: client.newId(), change: client.newId() }));
  const send = async () => {
    setBusy(true);
    try {
      await client.command(ids.command, { action: 'change_raise', caseId, id: ids.change, title: title.trim(), description: description.trim() });
      toast.success(t('Your message was sent to your project team.'), 'send');
      setTitle(''); setDescription(''); setIds({ command: client.newId(), change: client.newId() });
      onClose(); void refresh();
    } catch (cause) { toast.error((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={t('Ask for a change')}
    footer={<Button label={t('Send')} variant="primary" size="lg" full loading={busy} disabled={!title.trim()} onPress={() => void send()} />}>
    <View style={{ gap: theme.space(4) }}>
      <TextField label={t('What would you like to change?')} value={title} onChangeText={setTitle} maxLength={240} autoFocus />
      <TextField label={t('Details')} value={description} onChangeText={setDescription} maxLength={4000} multiline />
    </View>
  </Sheet>;
}

/** What's covered and until when, the client's reports, and a form to report a problem with photos. */
export function ClientWarrantyScreen() {
  const t = useT();
  const theme = useTheme();
  const format = usePortalFormat();
  const [reporting, setReporting] = useState<{ areaId: string | null } | null>(null);
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const { project } = useProject();
  const warranty = project?.warranty;
  return <ProjectScreen title={t('Warranty')} action={warranty?.canClaim ? <Button size="sm" variant="primary" label={t('Report a problem')} onPress={() => setReporting({ areaId: null })} /> : undefined}>
    {(current) => {
      const cover = current.warranty;
      if (!cover || (!cover.rooms.length && !cover.claims.length)) {
        return <Empty icon={ShieldCheck} title={t('Your warranty starts at handover')} detail={t('Once you accept the handover, what\'s covered and until when will be here.')} />;
      }
      return <>
        {cover.claims.length ? <Section title={t('Your reports')} flat>
          <View style={{ gap: theme.space(3) }}>{cover.claims.map((claim) => <Card key={claim.id}>
            <Row style={{ justifyContent: 'space-between' }} align="flex-start">
              <View style={{ flex: 1, gap: 2 }}><Text variant="label">{claim.description}</Text><Text variant="caption" tone="secondary">{format.day(claim.raisedOn)}</Text></View>
              <StateChip state={claim.status} />
            </Row>
            {claim.reason ? <Text variant="caption">{claim.reason}</Text> : null}
            <FileStrip files={claim.files} />
          </Card>)}</View>
        </Section> : null}
        {cover.rooms.length ? <Section title={t('What\'s covered')}>
          {cover.rooms.map((room, index) => {
            const id = room.id ?? 'general';
            const expanded = openRoom === id;
            return <View key={id} style={{ borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.structuralDivider }}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpenRoom(expanded ? null : id)} style={{ padding: theme.space(4), gap: 2 }}>
                <Text variant="label">{room.name ?? t('Whole home')}</Text>
                <Text variant="caption" tone="secondary">{[room.items.length === 1 ? t('1 item') : t('{count} items', { count: room.items.length }),
                  room.active ? t('until {date}', { date: format.day(room.until) }) : t('ended {date}', { date: format.day(room.until) })].join(' · ')}</Text>
              </Pressable>
              {expanded ? <View style={{ paddingHorizontal: theme.space(4), paddingBottom: theme.space(4), gap: theme.space(1) }}>
                {room.items.map((item) => <Text key={item.id} variant="caption">• {item.title}</Text>)}
                {cover.canClaim && room.active && room.id ? <Button size="sm" variant="ghost" label={t('Report a problem here')} onPress={() => setReporting({ areaId: room.id })} /> : null}
              </View> : null}
            </View>;
          })}
        </Section> : null}
        <ClaimSheet project={current} areaId={reporting?.areaId ?? null} open={reporting !== null} onClose={() => setReporting(null)} />
      </>;
    }}
  </ProjectScreen>;
}

/** A problem under warranty: where, which item if they know, what's wrong, and photos. */
function ClaimSheet({ project, areaId: initialArea, open, onClose }: { project: PortalProject; areaId: string | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { client } = usePortal();
  const refresh = useRefreshPortal();
  const warranty = project.warranty!;
  const [areaId, setAreaId] = useState<string | null>(initialArea);
  const [lineId, setLineId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [uploads, setUploads] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState(() => client.newId());
  const [form, setForm] = useState(0);
  const lines = warranty.lines.filter((line) => !areaId || line.areaId === areaId);
  const send = async () => {
    if (!description.trim()) { toast.error(t('Say what\'s wrong.')); return; }
    setBusy(true);
    try {
      await client.command(id, { action: 'warranty_claim', caseId: project.id, description: description.trim(), areaId: areaId || undefined, lineId: lineId || undefined, uploadIds: uploads });
      toast.success(t('Your message was sent to your project team.'), 'send');
      setDescription(''); setLineId(null); setId(client.newId()); setForm((value) => value + 1); onClose(); void refresh();
    } catch (cause) { toast.error((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <Sheet open={open} onClose={onClose} title={t('Report a problem')}
    footer={<Button label={t('Send report')} variant="primary" size="lg" full loading={busy} disabled={uploading || !description.trim()} onPress={() => void send()} />}>
    <View style={{ gap: theme.space(4) }}>
      {warranty.areas.length ? <View style={{ gap: theme.space(2) }}>
        <Text variant="label">{t('Where')}</Text>
        <Row wrap gap={2}>
          <Chip label={t('Anywhere')} selected={!areaId} onPress={() => { setAreaId(null); setLineId(null); }} />
          {warranty.areas.map((area) => <Chip key={area.id} label={area.name} selected={areaId === area.id} onPress={() => { setAreaId(area.id); setLineId(null); }} />)}
        </Row>
      </View> : null}
      {lines.length ? <View style={{ gap: theme.space(2) }}>
        <Text variant="label">{t('Which item')}</Text>
        <Row wrap gap={2}>
          <Chip label={t('I\'m not sure')} selected={!lineId} onPress={() => setLineId(null)} />
          {lines.map((line) => <Chip key={line.id} label={line.title} selected={lineId === line.id} onPress={() => setLineId(line.id)} />)}
        </Row>
      </View> : null}
      <TextField label={t('What\'s wrong?')} value={description} onChangeText={setDescription} maxLength={2000} multiline />
      <AttachPhotos key={form} caseId={project.id} onChange={setUploads} onBusy={setUploading} max={6} />
    </View>
  </Sheet>;
}
