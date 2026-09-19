import { useState } from 'react';
import { View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Text } from '../design-system';
import { Button, Card, Notice, Sheet, StatusBadge, TextField } from '../hrms/ui';
import type {
  ProjectFieldHandover,
  ProjectFieldOutstandingItem,
  ProjectFieldProject,
} from './api';
import { handoverItemStatusCommand, localDay, projectFieldLabel } from './field-work';
import { PhotoPicker, useQueuedSave, type CapturedPhoto } from './quality';

export function ProjectHandoverCard({
  handover,
  onOpen,
}: {
  handover: ProjectFieldHandover;
  onOpen: () => void;
}) {
  const unresolved = handover.outstandingItems.filter((item) => item.status !== 'closed').length;
  return (
    <Card tinted={handover.status === 'returned'}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text weight="semibold">{handover.title}</Text>
          <Text size="xs" tone="textSecondary">
            {handover.area} · pack {handover.packet ? `v${handover.packet.version}` : 'not prepared'}
          </Text>
        </View>
        <StatusBadge label={projectFieldLabel(handover.status)} status={handover.status} />
      </View>
      <Text size="sm" tone="textSecondary">
        {unresolved} open commitment{unresolved === 1 ? '' : 's'}
        {handover.status === 'accepted' ? ` · warranty to ${handover.warrantyUntil}` : ''}
      </Text>
      <Button label="Open handover" variant="secondary" onPress={onOpen} />
    </Card>
  );
}

export function HandoverWalkthroughSheet({
  handover,
  onClose,
  onItemStatus,
  onWarranty,
}: {
  handover: ProjectFieldHandover;
  onClose: () => void;
  onItemStatus: (item: ProjectFieldOutstandingItem, status: 'open' | 'ready' | 'closed') => void;
  onWarranty: () => void;
}) {
  const warrantyOpen = handover.status === 'accepted' && Boolean(handover.warrantyUntil) && localDay() <= handover.warrantyUntil;
  return (
    <Sheet title={handover.title} onClose={onClose}>
      <View style={{ gap: 4 }}>
        <StatusBadge label={projectFieldLabel(handover.status)} status={handover.status} />
        <Text size="sm" tone="textSecondary">{handover.area}</Text>
        {handover.clientReviewDueDate ? <Text size="sm">Client review due {handover.clientReviewDueDate}</Text> : null}
      </View>
      {handover.returnedNote ? <Notice error>Client returned this pack: {handover.returnedNote}</Notice> : null}
      <Notice>
        Client acceptance stays in the secure client portal or a signed office record. Field staff cannot accept on the client’s behalf.
      </Notice>
      {handover.packet ? (
        <>
          <View style={{ gap: 6 }}>
            <Text weight="semibold">Accepted scope · version {handover.packet.version}</Text>
            {handover.packet.tasks.map((task) => (
              <Text key={task.id} size="sm">{task.title} · {task.quantity} {task.unit}</Text>
            ))}
          </View>
          <View style={{ gap: 6 }}>
            <Text weight="semibold">Closeout documents</Text>
            {handover.packet.documents.length ? handover.packet.documents.map((document) => (
              <Text key={document.id} size="sm">{document.title} · {document.revision}</Text>
            )) : <Text size="sm" tone="textSecondary">No closeout documents in this packet.</Text>}
          </View>
        </>
      ) : <Notice>The immutable handover packet has not been prepared yet.</Notice>}
      <View style={{ gap: 10 }}>
        <Text weight="semibold">Remaining commitments</Text>
        {handover.outstandingItems.length ? handover.outstandingItems.map((item) => (
          <Card key={item.id} tinted={item.blocking && item.status !== 'closed'}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text weight="semibold">{item.title}</Text>
                <Text size="xs" tone="textSecondary">{item.owner} · due {item.dueDate}{item.blocking ? ' · blocks acceptance' : ''}</Text>
              </View>
              <StatusBadge label={projectFieldLabel(item.status)} status={item.status} />
            </View>
            {item.resolution ? <Text size="sm">{item.resolution}</Text> : <Text size="sm" tone="textSecondary">{item.evidence}</Text>}
            {item.canResolve ? <Button label="Submit completion" onPress={() => onItemStatus(item, 'ready')} /> : null}
            {item.canVerify ? <Button label="Verify and close" onPress={() => onItemStatus(item, 'closed')} /> : null}
            {item.canReopen ? <Button label="Reopen" variant="secondary" onPress={() => onItemStatus(item, 'open')} /> : null}
          </Card>
        )) : <Text size="sm" tone="textSecondary">No remaining commitments.</Text>}
      </View>
      {warrantyOpen ? <Button label="Report warranty issue" onPress={onWarranty} /> : null}
      {handover.status === 'accepted' && !warrantyOpen ? (
        <Text size="sm" tone="textSecondary">Warranty coverage ended {handover.warrantyUntil}.</Text>
      ) : null}
    </Sheet>
  );
}

export function HandoverItemStatusSheet({
  workspaceId,
  project,
  handover,
  item,
  status,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  project: ProjectFieldProject;
  handover: ProjectFieldHandover;
  item: ProjectFieldOutstandingItem;
  status: 'open' | 'ready' | 'closed';
  onClose: () => void;
  onSaved: () => void;
}) {
  const requestId = useState(() => Crypto.randomUUID())[0];
  const [evidence, setEvidence] = useState('');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [validation, setValidation] = useState('');
  const queued = useQueuedSave(workspaceId, project, onSaved, onClose);
  const label = status === 'ready' ? 'Submit completion' : status === 'closed' ? 'Verify and close' : 'Reopen commitment';
  async function submit() {
    if (!evidence.trim() && !photos.length) {
      setValidation('Add a note or photo evidence.');
      return;
    }
    setValidation('');
    await queued.save({
      id: requestId,
      projectId: project.id,
      projectName: project.name,
      recordId: item.id,
      label: `${label} · ${item.title}`,
      kind: 'handover_item',
      command: handoverItemStatusCommand(
        { revision: project.revision, requestId },
        { recordId: item.id, handoverId: handover.id, status, evidence },
      ),
      revision: project.revision,
      stage: 'command',
    }, photos);
  }
  return (
    <Sheet title={label} onClose={onClose}>
      <Text weight="semibold">{item.title}</Text>
      <Text size="sm" tone="textSecondary">{handover.area} · {item.owner}</Text>
      <TextField label="Evidence note" value={evidence} onChangeText={setEvidence} multiline />
      <PhotoPicker photos={photos} onChange={setPhotos} />
      {validation ? <Notice error>{validation}</Notice> : null}
      {queued.error ? <Notice error>{queued.error}</Notice> : null}
      <Button label={label} loading={queued.busy} onPress={() => void submit()} />
    </Sheet>
  );
}
