import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { Text, useTheme } from '../design-system';
import { Button, Card, EmptyState, Notice, Sheet, StatusBadge, TextField } from '../hrms/ui';
import { NumberField } from '../pre-project/ui';
import { useProjectFieldActions, useProjectFieldQueue, type ProjectFieldHandover, type ProjectFieldOutstandingItem, type ProjectFieldProject, type ProjectFieldReceipt, type ProjectFieldSnag, type ProjectFieldTask } from './api';
import { projectFieldLabel, receiveCommand } from './field-work';
import { ProjectFieldQueuePanel } from './field-queue-panel';
import { HandoverItemStatusSheet, HandoverWalkthroughSheet, ProjectHandoverCard } from './handover';
import { NewSnagSheet, ProjectSnagCard, ReportProgressSheet, SnagStatusSheet } from './quality';

type Action =
  | { kind: 'task'; project: ProjectFieldProject; record: ProjectFieldTask }
  | { kind: 'dispatch' | 'order'; project: ProjectFieldProject; record: ProjectFieldReceipt }
  | { kind: 'new-snag'; project: ProjectFieldProject }
  | { kind: 'snag-status'; project: ProjectFieldProject; record: ProjectFieldSnag; status: 'open' | 'ready' | 'closed' }
  | { kind: 'handover'; project: ProjectFieldProject; record: ProjectFieldHandover }
  | { kind: 'handover-item'; project: ProjectFieldProject; handover: ProjectFieldHandover; record: ProjectFieldOutstandingItem; status: 'open' | 'ready' | 'closed' }
  | { kind: 'warranty'; project: ProjectFieldProject; record: ProjectFieldHandover };

function EvidencePhoto({ workspaceId, projectId, recordId, onUploaded }: {
  workspaceId: string; projectId: string; recordId: string; onUploaded: () => void;
}) {
  const actions = useProjectFieldActions(workspaceId);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState('');
  async function capture() {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setError('Camera access is off. Enable it in device settings to attach site evidence.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: .85 });
    if (result.canceled) return;
    const image = result.assets[0];
    if ((image.fileSize ?? 0) > 7 * 1024 * 1024) { setError('Choose a photo smaller than 7 MB.'); return; }
    setBusy(true); setPreview(image.uri);
    try {
      const form = new FormData();
      form.append('file', { uri: image.uri, name: image.fileName ?? `Project-${Date.now()}.jpg`, type: image.mimeType ?? 'image/jpeg' } as unknown as Blob);
      await actions.upload(projectId, recordId, Crypto.randomUUID(), form);
      onUploaded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The photo could not be uploaded.');
    } finally { setBusy(false); }
  }
  return <View style={{ gap: 8 }}>
    {preview && <Image source={{ uri: preview }} accessibilityLabel="Captured project evidence" style={{ height: 150, borderRadius: 12 }} resizeMode="cover" />}
    {error && <Notice error>{error}</Notice>}
    <Button label="Add site photo" variant="secondary" loading={busy} onPress={() => void capture()} />
  </View>;
}

function ReceiptSheet({ workspaceId, action, onClose, onSaved }: {
  workspaceId: string; action: Extract<Action, { kind: 'dispatch' | 'order' }>; onClose: () => void; onSaved: () => void;
}) {
  const api = useProjectFieldActions(workspaceId);
  const [quantity, setQuantity] = useState<number | null>(action.record.remaining ?? action.record.quantity);
  const [rejected, setRejected] = useState<number | null>(0);
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const title = `Receive ${action.record.title}`;
  async function save() {
    if (!quantity || quantity < 0 || (rejected ?? 0) < 0) { setError('Enter the quantities received.'); return; }
    if (!evidence.trim()) { setError('Add the site, delivery-note or inspection reference.'); return; }
    setBusy(true); setError('');
    try {
      const base = { revision: action.project.revision, requestId: Crypto.randomUUID() };
      const body = receiveCommand(base, action.kind, { recordId: action.record.id, accepted: quantity, rejected: rejected ?? 0, evidence });
      await api.command(action.project.id, body);
      onSaved(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The action could not be saved. Refresh and try again.'); }
    finally { setBusy(false); }
  }
  return <Sheet title={title} onClose={onClose}>
    <NumberField label={`Accepted ${action.record.unit}`} value={quantity} onChange={setQuantity} />
    <NumberField label={`Rejected ${action.record.unit}`} value={rejected} onChange={setRejected} />
    <TextField label="Evidence reference" value={evidence} onChangeText={setEvidence} multiline placeholder="Delivery note, inspection or site evidence" />
    {error && <Notice error>{error}</Notice>}
    <Button label="Record receipt" loading={busy} onPress={() => void save()} />
  </Sheet>;
}

export function ProjectFieldWorkspace({ workspaceId, initialProjectId, initialActionId }: {
  workspaceId: string; initialProjectId?: string | null; initialActionId?: string | null;
}) {
  const { colors } = useTheme();
  const [revision, setRevision] = useState(0), [action, setAction] = useState<Action | null>(null);
  const result = useProjectFieldQueue(workspaceId, revision);
  const openedAction = useRef<string | null>(null);
  const projects = useMemo(() => {
    const items = result.data?.projects ?? [];
    return initialProjectId ? [...items].sort((left, right) => Number(right.id === initialProjectId) - Number(left.id === initialProjectId)) : items;
  }, [initialProjectId, result.data]);
  useEffect(() => {
    if (!initialActionId || openedAction.current === initialActionId || !result.data) return;
    for (const project of result.data.projects) {
      const task = project.tasks.find(item => item.id === initialActionId);
      if (task) { openedAction.current = initialActionId; setAction({ kind: 'task', project, record: task }); return; }
      const delivery = project.deliveries.find(item => item.id === initialActionId);
      if (delivery) { openedAction.current = initialActionId; setAction({ kind: 'dispatch', project, record: delivery }); return; }
      const order = project.purchaseReceipts.find(item => item.id === initialActionId);
      if (order) { openedAction.current = initialActionId; setAction({ kind: 'order', project, record: order }); return; }
      const snag = project.snags.find(item => item.id === initialActionId);
      if (snag) {
        openedAction.current = initialActionId;
        if (snag.canResolve) setAction({ kind: 'snag-status', project, record: snag, status: 'ready' });
        else if (snag.canVerify) setAction({ kind: 'snag-status', project, record: snag, status: 'closed' });
        return;
      }
      const handover = (project.handovers ?? []).find(item => item.id === initialActionId || item.outstandingItems.some(outstanding => outstanding.id === initialActionId));
      if (handover) {
        openedAction.current = initialActionId;
        const item = handover.outstandingItems.find(outstanding => outstanding.id === initialActionId);
        if (item?.canResolve) setAction({ kind: 'handover-item', project, handover, record: item, status: 'ready' });
        else if (item?.canVerify) setAction({ kind: 'handover-item', project, handover, record: item, status: 'closed' });
        else setAction({ kind: 'handover', project, record: handover });
        return;
      }
    }
  }, [initialActionId, result.data]);
  const refresh = () => setRevision(value => value + 1);
  return <>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48, gap: 16 }}>
      <View style={{ gap: 4 }}><Text accessibilityRole="header" size="xl" weight="semibold">My field work</Text><Text size="sm" tone="textSecondary">Assigned tasks, receipts and evidence—nothing else.</Text></View>
      {result.error && <><Notice error>{result.error}</Notice><Button label="Retry" variant="secondary" onPress={refresh} /></>}
      {result.loading && !result.data && <Text tone="textSecondary">Loading assigned work…</Text>}
      {result.data && !result.data.projects.length && <EmptyState title="No assigned field work" description="Tasks and receipts appear here when they are assigned to you." icon="projects" />}
      <ProjectFieldQueuePanel workspaceId={workspaceId} projects={projects} revision={revision} onSynced={refresh} />
      {projects.map(project => <View key={project.id} style={{ gap: 12 }}>
        <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 10 }}><Text size="lg" weight="semibold">{project.name}</Text><Text size="xs" tone="textSecondary">{project.customer}</Text></View>
        <Button label="Record snag" variant="secondary" onPress={() => setAction({ kind: 'new-snag', project })} />
        {project.deliveries.map(item => <Card key={item.id} tinted>
          <StatusBadge label="Delivery arriving" status="needs_review" />
          <View style={{ gap: 4 }}><Text weight="semibold">{item.title}</Text><Text size="xs" tone="textSecondary">{item.quantity} {item.unit} · due {item.dueDate} · {item.destination}</Text></View>
          {item.canReceive && <Button label="Receive delivery" onPress={() => setAction({ kind: 'dispatch', project, record: item })} />}
          <EvidencePhoto workspaceId={workspaceId} projectId={project.id} recordId={item.id} onUploaded={refresh} />
        </Card>)}
        {project.purchaseReceipts.map(item => <Card key={item.id}>
          <StatusBadge label="Purchase order" status="pending" />
          <View style={{ gap: 4 }}><Text weight="semibold">{item.number} · {item.title}</Text><Text size="xs" tone="textSecondary">{item.vendor} · {item.remaining} {item.unit} remaining</Text></View>
          <Button label="Receive purchase order" onPress={() => setAction({ kind: 'order', project, record: item })} />
          <EvidencePhoto workspaceId={workspaceId} projectId={project.id} recordId={item.id} onUploaded={refresh} />
        </Card>)}
        {project.tasks.map(item => <Card key={item.id}>
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between', alignItems: 'flex-start' }}><View style={{ flex: 1, gap: 4 }}><Text weight="semibold">{item.title}</Text><Text size="xs" tone="textSecondary">{item.area} · {item.location === 'factory' ? 'Factory' : 'Site'} · due {item.end}</Text></View><StatusBadge label={projectFieldLabel(item.status)} status={item.status} /></View>
          <Text size="sm">{item.approved} / {item.quantity} {item.unit} approved · {item.remaining} remaining</Text>
          {item.canReport && <Button label="Report progress" onPress={() => setAction({ kind: 'task', project, record: item })} />}
          <EvidencePhoto workspaceId={workspaceId} projectId={project.id} recordId={item.id} onUploaded={refresh} />
        </Card>)}
        {project.snags.length > 0 && <View style={{ gap: 10 }}>
          <Text weight="semibold">Quality & snags</Text>
          {project.snags.map(item => <ProjectSnagCard key={item.id} snag={item} onStatus={status => setAction({ kind: 'snag-status', project, record: item, status })} />)}
        </View>}
        {(project.handovers ?? []).length > 0 && <View style={{ gap: 10 }}>
          <Text weight="semibold">Handover & aftercare</Text>
          {(project.handovers ?? []).map(item => <ProjectHandoverCard key={item.id} handover={item} onOpen={() => setAction({ kind: 'handover', project, record: item })} />)}
        </View>}
      </View>)}
    </ScrollView>
    {action?.kind === 'task' && <ReportProgressSheet workspaceId={workspaceId} project={action.project} task={action.record} onClose={() => setAction(null)} onSaved={refresh} />}
    {(action?.kind === 'dispatch' || action?.kind === 'order') && <ReceiptSheet workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={refresh} />}
    {action?.kind === 'new-snag' && <NewSnagSheet workspaceId={workspaceId} project={action.project} onClose={() => setAction(null)} onSaved={refresh} />}
    {action?.kind === 'snag-status' && <SnagStatusSheet workspaceId={workspaceId} project={action.project} snag={action.record} status={action.status} onClose={() => setAction(null)} onSaved={refresh} />}
    {action?.kind === 'handover' && <HandoverWalkthroughSheet
      handover={action.record}
      onClose={() => setAction(null)}
      onItemStatus={(record, status) => setAction({ kind: 'handover-item', project: action.project, handover: action.record, record, status })}
      onWarranty={() => setAction({ kind: 'warranty', project: action.project, record: action.record })}
    />}
    {action?.kind === 'handover-item' && <HandoverItemStatusSheet workspaceId={workspaceId} project={action.project} handover={action.handover} item={action.record} status={action.status} onClose={() => setAction(null)} onSaved={refresh} />}
    {action?.kind === 'warranty' && <NewSnagSheet workspaceId={workspaceId} project={action.project} handover={action.record} onClose={() => setAction(null)} onSaved={refresh} />}
  </>;
}
