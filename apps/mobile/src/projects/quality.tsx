import { useState } from 'react';
import { Image, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { Text } from '../design-system';
import { useAuth } from '../auth/provider';
import { Button, Card, Choice, Notice, Sheet, StatusBadge, TextField } from '../hrms/ui';
import { DateField } from '../hrms/date-field';
import { NumberField } from '../pre-project/ui';
import type { ProjectFieldHandover, ProjectFieldProject, ProjectFieldSnag, ProjectFieldTask } from './api';
import { useProjectFieldActions } from './api';
import {
  createSnagCommand,
  createWarrantySnagCommand,
  draftReportTaskCommand,
  localDay,
  snagStatusCommand,
} from './field-work';
import {
  projectFieldSyncFailure,
  syncProjectFieldOperation,
  type PendingProjectFieldOperation,
  type ProjectFieldMedia,
} from './field-queue';
import {
  persistProjectFieldMedia,
  projectFieldMediaForm,
  removeProjectFieldQueue,
  writeProjectFieldQueue,
} from './pending-field';

export type CapturedPhoto = Omit<ProjectFieldMedia, 'uploaded'>;

export function PhotoPicker({ photos, onChange }: {
  photos: CapturedPhoto[];
  onChange: (photos: CapturedPhoto[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function capture() {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera access is off. Enable it in device settings to add project evidence.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled) return;
    const image = result.assets[0];
    if ((image.fileSize ?? 0) > 10 * 1024 * 1024) {
      setError('Take a photo smaller than 10 MB.');
      return;
    }
    setBusy(true);
    onChange([
      ...photos,
      {
        id: Crypto.randomUUID(),
        localUri: image.uri,
        name: image.fileName ?? `Project-${Date.now()}.jpg`,
        mimeType: image.mimeType ?? 'image/jpeg',
        byteSize: image.fileSize ?? 0,
      },
    ]);
    setBusy(false);
  }
  return (
    <View style={{ gap: 10 }}>
      {photos.map((photo) => (
        <View key={photo.id} style={{ gap: 6 }}>
          <Image
            source={{ uri: photo.localUri }}
            accessibilityLabel={photo.name}
            style={{ height: 150, borderRadius: 12 }}
            resizeMode="cover"
          />
          <Button
            label="Remove photo"
            variant="ghost"
            onPress={() => onChange(photos.filter((item) => item.id !== photo.id))}
          />
        </View>
      ))}
      {error ? <Notice error>{error}</Notice> : null}
      <Button
        label={photos.length ? 'Add another photo' : 'Add site photo'}
        variant="secondary"
        loading={busy}
        disabled={photos.length >= 5}
        onPress={() => void capture()}
      />
    </View>
  );
}

export function useQueuedSave(
  workspaceId: string,
  project: ProjectFieldProject,
  onSaved: () => void,
  onClose: () => void,
) {
  const { state } = useAuth();
  const api = useProjectFieldActions(workspaceId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(
    operation: Omit<PendingProjectFieldOperation, 'userId' | 'workspaceId' | 'media' | 'state' | 'attempts' | 'createdAt' | 'updatedAt' | 'error'>,
    photos: CapturedPhoto[],
  ) {
    if (state.status !== 'signedIn') {
      setError('Sign in again before saving this field update.');
      return;
    }
    setBusy(true);
    setError('');
    const now = Date.now();
    let current: PendingProjectFieldOperation = {
      ...operation,
      userId: state.profile.id,
      workspaceId,
      media: [],
      state: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      error: '',
    };
    try {
      current = {
        ...current,
        media: await Promise.all(
          photos.map((photo) =>
            persistProjectFieldMedia(
              {
                userId: current.userId,
                workspaceId,
                projectId: project.id,
                operationId: current.id,
              },
              photo,
            ),
          ),
        ),
      };
      await writeProjectFieldQueue(current);
      current = await syncProjectFieldOperation(current, {
        command: api.command,
        upload: async (row, media) => {
          const upload = await projectFieldMediaForm(media);
          try {
            return await api.upload(row.projectId, row.recordId, media.id, upload.form);
          } finally {
            upload.cleanup();
          }
        },
        checkpoint: async (row) => {
          current = row;
          await writeProjectFieldQueue(row);
        },
      });
      await removeProjectFieldQueue(current);
      onSaved();
      onClose();
    } catch (reason) {
      const failure = projectFieldSyncFailure(reason);
      current = {
        ...current,
        state: failure.state,
        error: failure.message,
        updatedAt: Date.now(),
      };
      await writeProjectFieldQueue(current).catch(() => {});
      onSaved();
      if (failure.state === 'pending') onClose();
      else setError(`${failure.message} The local update and photos are kept for review.`);
    } finally {
      setBusy(false);
    }
  }
  return { save, busy, error };
}

export function ReportProgressSheet({
  workspaceId,
  project,
  task,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  project: ProjectFieldProject;
  task: ProjectFieldTask;
  onClose: () => void;
  onSaved: () => void;
}) {
  const recordId = useState(() => Crypto.randomUUID())[0];
  const requestId = useState(() => Crypto.randomUUID())[0];
  const submitRequestId = useState(() => Crypto.randomUUID())[0];
  const [quantity, setQuantity] = useState<number | null>(null);
  const [reportDate,setReportDate]=useState(localDay());
  const [shift,setShift]=useState('Day');
  const [people,setPeople]=useState<number|null>(null),[hours,setHours]=useState<number|null>(null);
  const [materials,setMaterials]=useState(''),[tomorrow,setTomorrow]=useState(''),[weather,setWeather]=useState('');
  const [safetyStatus,setSafetyStatus]=useState<'none'|'observation'|'incident'>('none'),[safety,setSafety]=useState('');
  const [summary, setSummary] = useState('');
  const [evidence, setEvidence] = useState('');
  const [issues, setIssues] = useState('');
  const [impact, setImpact] = useState<'none' | 'watch' | 'blocked'>('none');
  const [impactReason, setImpactReason] = useState('');
  const [recoveryPlan, setRecoveryPlan] = useState('');
  const [nextOwner, setNextOwner] = useState(task.ownerId || project.memberId);
  const [nextDate, setNextDate] = useState(localDay());
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [validation, setValidation] = useState('');
  const queued = useQueuedSave(workspaceId, project, onSaved, onClose);

  async function submit() {
    if (quantity === null || quantity < 0) {
      setValidation('Enter the completed quantity, or 0 for a no-work update.');
      return;
    }
    if(quantity>0&&!['in_progress','awaiting_inspection'].includes(task.status)){setValidation("Start this task before reporting completed work. Use 0 to report a blocker.");return;}
    if(safetyStatus==='incident'&&impact==='none'){setValidation("Select a schedule impact and recovery action for the incident.");return;}
    if(quantity>task.remaining){setValidation("Quantity exceeds the remaining work. Refresh the project quantities.");return;}
    if(!reportDate||!summary.trim()){setValidation("Add the report date and a short update.");return;}
    if(safetyStatus!=="none"&&!safety.trim()){setValidation("Describe the safety observation or incident.");return;}
    if (!evidence.trim() && !photos.length) {
      setValidation('Add a photo or a site evidence reference.');
      return;
    }
    if (
      impact !== 'none' &&
      (!impactReason.trim() || !recoveryPlan.trim() || !nextOwner || !nextDate)
    ) {
      setValidation('Explain the impact, recovery plan, owner, and next update date.');
      return;
    }
    setValidation('');
    await queued.save(
      {
        id: requestId,
        projectId: project.id,
        projectName: project.name,
        recordId,
        label: `Daily report · ${task.title}`,
        kind: 'report',
        command: draftReportTaskCommand(
          { revision: project.revision, requestId },
          {
            recordId,
            taskId: task.id,
            date: reportDate,
            shift,people:people??0,hours:hours??0,materials,tomorrow,weather,safetyStatus,safety,
            quantity,
            summary,
            evidence,
            issues,
            scheduleImpact: impact,
            impactReason,
            recoveryPlan,
            nextUpdateOwnerId: impact === 'none' ? '' : nextOwner,
            nextUpdateDate: impact === 'none' ? '' : nextDate,
          },
        ),
        submitRequestId,
        revision: project.revision,
        stage: 'command',
      },
      photos,
    );
  }

  return (
    <Sheet title={`Report ${task.title}`} onClose={onClose}>
      <DateField label="Report date" value={reportDate} onChange={setReportDate}/>
      <TextField label="Shift" value={shift} onChangeText={setShift}/>
      <Notice>Save work quantities for review. Approval updates progress; sharing with the client is a separate review action.</Notice>
      <NumberField label={`Completed ${task.unit}`} value={quantity} onChange={setQuantity} />
      <TextField label="Short update" value={summary} onChangeText={setSummary} placeholder="Work completed, or reason no work could take place" />
      <NumberField label="People on this task" value={people} onChange={setPeople}/>
      <NumberField label="Hours worked" value={hours} onChange={setHours}/>
      <TextField label="Materials used" value={materials} onChangeText={setMaterials} multiline/>
      <TextField label="Next shift plan" value={tomorrow} onChangeText={setTomorrow} multiline/>
      {task.location==='site'&&<TextField label="Weather" value={weather} onChangeText={setWeather}/>}
      <Choice label="Safety" value={safetyStatus} options={[{value:'none',label:'No issue'},{value:'observation',label:'Observation'},{value:'incident',label:'Incident'}]} onChange={value=>setSafetyStatus(value as typeof safetyStatus)}/>
      {safetyStatus!=='none'&&<TextField label="Safety details" value={safety} onChangeText={setSafety} multiline/>}
      <TextField label="Issues or blockers" value={issues} onChangeText={setIssues} multiline placeholder="Leave blank when work is clear" />
      <Choice
        label="Schedule impact"
        value={impact}
        options={[
          { value: 'none', label: 'No impact' },
          { value: 'watch', label: 'Watch' },
          { value: 'blocked', label: 'Blocked' },
        ]}
        onChange={(value) => setImpact(value as typeof impact)}
      />
      {impact !== 'none' ? (
        <>
          <TextField label="Impact reason" value={impactReason} onChangeText={setImpactReason} multiline />
          <TextField label="Recovery plan" value={recoveryPlan} onChangeText={setRecoveryPlan} multiline />
          <Choice
            label="Next update owner"
            value={nextOwner}
            options={project.members.map((member) => ({ value: member.id, label: member.name }))}
            onChange={setNextOwner}
          />
          <DateField label="Next update date" value={nextDate} onChange={setNextDate} />
        </>
      ) : null}
      <TextField label="Evidence reference" value={evidence} onChangeText={setEvidence} multiline placeholder="Inspection, drawing, or site record" />
      <PhotoPicker photos={photos} onChange={setPhotos} />
      {validation ? <Notice error>{validation}</Notice> : null}
      {queued.error ? <Notice error>{queued.error}</Notice> : null}
      <Button label="Submit for review" loading={queued.busy} onPress={() => void submit()} />
    </Sheet>
  );
}

export function NewSnagSheet({
  workspaceId,
  project,
  handover,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  project: ProjectFieldProject;
  handover?: ProjectFieldHandover;
  onClose: () => void;
  onSaved: () => void;
}) {
  const recordId = useState(() => Crypto.randomUUID())[0];
  const requestId = useState(() => Crypto.randomUUID())[0];
  const [title, setTitle] = useState('');
  const [taskId, setTaskId] = useState('');
  const availableTasks = handover?.packet?.tasks ?? project.tasks;
  const selectedTask = availableTasks.find((task) => task.id === taskId);
  const [area, setArea] = useState('');
  const [ownerId, setOwnerId] = useState(project.memberId);
  const [severity, setSeverity] = useState<'minor' | 'major' | 'critical'>('minor');
  const [dueDate, setDueDate] = useState(localDay());
  const [evidence, setEvidence] = useState('');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [validation, setValidation] = useState('');
  const queued = useQueuedSave(workspaceId, project, onSaved, onClose);

  async function submit() {
    const snagArea = handover?.area || area.trim() || selectedTask?.area || '';
    if (!title.trim() || !snagArea || !ownerId || !dueDate || !evidence.trim()) {
      setValidation('Add the defect, area, owner, due date, and evidence note.');
      return;
    }
    setValidation('');
    await queued.save(
      {
        id: requestId,
        projectId: project.id,
        projectName: project.name,
        recordId,
        label: `${handover ? 'Warranty issue' : 'Snag'} · ${title.trim()}`,
        kind: handover ? 'warranty_snag' : 'snag',
        command: handover
          ? createWarrantySnagCommand(
              { revision: project.revision, requestId },
              { recordId, handoverId: handover.id, title, taskId, ownerId, severity, dueDate, evidence },
            )
          : createSnagCommand(
              { revision: project.revision, requestId },
              { recordId, title, taskId, area: snagArea, ownerId, severity, dueDate, evidence },
            ),
        revision: project.revision,
        stage: 'command',
      },
      photos,
    );
  }

  return (
    <Sheet title={handover ? `Warranty issue · ${handover.area}` : 'Record snag'} onClose={onClose}>
      <TextField label="Issue" value={title} onChangeText={setTitle} />
      <Choice
        label="Related work"
        value={taskId}
        options={[
          { value: '', label: 'General site snag' },
          ...availableTasks.map((task) => ({ value: task.id, label: `${task.title} · ${task.area}` })),
        ]}
        onChange={setTaskId}
      />
      {!handover ? <TextField label="Area" value={area} onChangeText={setArea} placeholder={selectedTask?.area ?? 'Room or zone'} /> : null}
      <Choice
        label="Owner"
        value={ownerId}
        options={project.members.map((member) => ({ value: member.id, label: member.name }))}
        onChange={setOwnerId}
      />
      <Choice
        label="Severity"
        value={severity}
        options={[
          { value: 'minor', label: 'Minor' },
          { value: 'major', label: 'Major' },
          { value: 'critical', label: 'Critical' },
        ]}
        onChange={(value) => setSeverity(value as typeof severity)}
      />
      <DateField label="Due date" value={dueDate} onChange={setDueDate} />
      <TextField label="Evidence note" value={evidence} onChangeText={setEvidence} multiline />
      <PhotoPicker photos={photos} onChange={setPhotos} />
      {validation ? <Notice error>{validation}</Notice> : null}
      {queued.error ? <Notice error>{queued.error}</Notice> : null}
      <Button label={handover ? 'Save warranty issue' : 'Save snag'} loading={queued.busy} onPress={() => void submit()} />
    </Sheet>
  );
}

export function SnagStatusSheet({
  workspaceId,
  project,
  snag,
  status,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  project: ProjectFieldProject;
  snag: ProjectFieldSnag;
  status: 'open' | 'ready' | 'closed';
  onClose: () => void;
  onSaved: () => void;
}) {
  const requestId = useState(() => Crypto.randomUUID())[0];
  const [evidence, setEvidence] = useState('');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [validation, setValidation] = useState('');
  const queued = useQueuedSave(workspaceId, project, onSaved, onClose);
  const actionLabel = status === 'ready' ? 'Submit correction' : status === 'closed' ? 'Verify and close' : 'Reopen snag';
  async function submit() {
    if (!evidence.trim()) {
      setValidation('Add the correction, verification, or reopening note.');
      return;
    }
    setValidation('');
    await queued.save(
      {
        id: requestId,
        projectId: project.id,
        projectName: project.name,
        recordId: snag.id,
        label: `${actionLabel} · ${snag.title}`,
        kind: 'snag_status',
        command: snagStatusCommand(
          { revision: project.revision, requestId },
          { recordId: snag.id, status, evidence },
        ),
        revision: project.revision,
        stage: 'command',
      },
      photos,
    );
  }
  return (
    <Sheet title={actionLabel} onClose={onClose}>
      <Text weight="semibold">{snag.title}</Text>
      <Text size="sm" tone="textSecondary">{snag.area} · {snag.owner}</Text>
      <TextField label="Evidence note" value={evidence} onChangeText={setEvidence} multiline />
      <PhotoPicker photos={photos} onChange={setPhotos} />
      {validation ? <Notice error>{validation}</Notice> : null}
      {queued.error ? <Notice error>{queued.error}</Notice> : null}
      <Button label={actionLabel} loading={queued.busy} onPress={() => void submit()} />
    </Sheet>
  );
}

export function ProjectSnagCard({
  snag,
  onStatus,
}: {
  snag: ProjectFieldSnag;
  onStatus: (status: 'open' | 'ready' | 'closed') => void;
}) {
  return (
    <Card tinted={snag.severity === 'critical'}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text weight="semibold">{snag.title}</Text>
          <Text size="xs" tone="textSecondary">{snag.area} · {snag.owner} · due {snag.dueDate}</Text>
        </View>
        <StatusBadge label={snag.status} status={snag.status} />
      </View>
      <Text size="sm">{snag.evidence}</Text>
      {snag.resolution ? <Text size="sm" tone="textSecondary">{snag.resolution}</Text> : null}
      <Text size="xs" tone="textSecondary">{snag.severity} · {snag.photoCount} photo{snag.photoCount === 1 ? '' : 's'}</Text>
      {snag.canResolve ? <Button label="Submit correction" onPress={() => onStatus('ready')} /> : null}
      {snag.canVerify ? <Button label="Verify and close" onPress={() => onStatus('closed')} /> : null}
      {snag.canReopen ? <Button label="Reopen" variant="secondary" onPress={() => onStatus('open')} /> : null}
    </Card>
  );
}
