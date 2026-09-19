import { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { Text } from '../design-system';
import { useAuth } from '../auth/provider';
import { Button, Card, Notice, StatusBadge } from '../hrms/ui';
import { useProjectFieldActions, type ProjectFieldProject } from './api';
import {
  projectFieldQueueSummary,
  projectFieldSyncFailure,
  syncProjectFieldOperation,
  type PendingProjectFieldOperation,
} from './field-queue';
import {
  projectFieldMediaForm,
  readProjectFieldQueue,
  removeProjectFieldQueue,
  writeProjectFieldQueue,
} from './pending-field';

const stateLabel: Record<PendingProjectFieldOperation['state'], string> = {
  pending: 'Waiting to sync',
  syncing: 'Sync interrupted',
  conflict: 'Project changed',
  permission: 'Access changed',
  invalid: 'Needs correction',
};

export function ProjectFieldQueuePanel({
  workspaceId,
  projects,
  revision,
  onSynced,
}: {
  workspaceId: string;
  projects: ProjectFieldProject[];
  revision: number;
  onSynced: () => void;
}) {
  const { state } = useAuth();
  const api = useProjectFieldActions(workspaceId);
  const userId = state.status === 'signedIn' ? state.profile.id : '';
  const [rows, setRows] = useState<PendingProjectFieldOperation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const automatic = useRef('');

  const reload = async () => {
    if (!userId) return;
    try {
      setRows(await readProjectFieldQueue(userId, workspaceId));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'The project field queue could not be read.',
      );
    }
  };

  async function sync(row: PendingProjectFieldOperation) {
    let current = row;
    try {
      current = await syncProjectFieldOperation(row, {
        command: api.command,
          upload: async (operation, media) => {
            const upload = await projectFieldMediaForm(media);
            try {
              return await api.upload(operation.projectId, operation.recordId, media.id, upload.form);
            } finally {
              upload.cleanup();
            }
          },
        checkpoint: async (next) => {
          current = next;
          await writeProjectFieldQueue(next);
        },
      });
      await removeProjectFieldQueue(current);
      onSynced();
      return true;
    } catch (reason) {
      const failure = projectFieldSyncFailure(reason);
      await writeProjectFieldQueue({
        ...current,
        state: failure.state,
        error: failure.message,
        updatedAt: Date.now(),
      });
      return false;
    }
  }

  async function retry() {
    if (busy || !userId) return;
    setBusy(true);
    setError('');
    try {
      const current = await readProjectFieldQueue(userId, workspaceId);
      for (const row of current.filter((item) =>
        ['pending', 'syncing'].includes(item.state),
      ))
        await sync(row);
      await reload();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'The project field queue could not be synced.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function rebase(row: PendingProjectFieldOperation) {
    const project = projects.find((item) => item.id === row.projectId);
    if (!project) {
      setError('Refresh assigned projects before reviewing this field update.');
      return;
    }
    await writeProjectFieldQueue({
      ...row,
      revision: project.revision,
      state: 'pending',
      error: '',
      updatedAt: Date.now(),
    });
    await reload();
  }

  useEffect(() => {
    void reload();
  }, [userId, workspaceId, revision]);
  useEffect(() => {
    const key = `${userId}:${workspaceId}:${revision}`;
    if (
      !userId ||
      automatic.current === key ||
      !rows.some((row) => ['pending', 'syncing'].includes(row.state))
    )
      return;
    automatic.current = key;
    void retry();
  }, [rows, userId, workspaceId, revision]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void retry();
    });
    return () => subscription.remove();
  }, [userId, workspaceId, busy]);

  if (!rows.length && !error) return null;
  const summary = projectFieldQueueSummary(rows);
  return (
    <View style={{ gap: 10 }}>
      {error ? <Notice error>{error}</Notice> : null}
      <Notice>
        {summary.pending
          ? `${summary.pending} field update${summary.pending === 1 ? ' is' : 's are'} waiting to sync. `
          : ''}
        {summary.attention
          ? `${summary.attention} need${summary.attention === 1 ? 's' : ''} review. Local photos are retained.`
          : 'Photos and updates resume with the same IDs.'}
      </Notice>
      {summary.pending > 0 ? (
        <Button
          label="Retry field sync"
          variant="secondary"
          loading={busy}
          disabled={busy}
          onPress={() => void retry()}
        />
      ) : null}
      {rows.map((row) => (
        <Card key={row.id}>
          <StatusBadge label={stateLabel[row.state]} status={row.state} />
          <View style={{ gap: 4 }}>
            <Text weight="semibold">{row.label}</Text>
            <Text size="xs" tone="textSecondary">
              {row.projectName} · {row.media.filter((media) => !media.uploaded).length}{' '}
              photo{row.media.filter((media) => !media.uploaded).length === 1 ? '' : 's'} waiting
            </Text>
          </View>
          {row.error ? <Text size="sm" tone="textSecondary">{row.error}</Text> : null}
          {row.state === 'conflict' ? (
            <Button
              label="Review latest and retry"
              variant="secondary"
              onPress={() => void rebase(row)}
            />
          ) : null}
          {['permission', 'invalid'].includes(row.state) ? (
            <Button
              label="Remove local update"
              variant="ghost"
              onPress={async () => {
                await removeProjectFieldQueue(row);
                await reload();
              }}
            />
          ) : null}
        </Card>
      ))}
    </View>
  );
}
