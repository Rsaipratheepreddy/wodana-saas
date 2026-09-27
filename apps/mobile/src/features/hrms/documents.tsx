import { FileText } from 'lucide-react-native';
import type { HrmsDocumentKind } from '../../../../../packages/contracts/src/hrms';
import { useAuth } from '../../auth/provider';
import { errorMessage, useApi } from '../../core/api';
import { openWorkspaceFile } from '../../core/files';
import { useFormat } from '../../core/format';
import { key, useT } from '../../core/i18n';
import { Empty, ListRow, ListScreen } from '../../ui/layout';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useDocuments } from './api';

export const DOCUMENT_KIND: Record<HrmsDocumentKind, string> = {
  identity: key('Identity'), work_permit: key('Work permit'), residence: key('Residence'), licence: key('Licence'),
  insurance: key('Insurance'), safety_induction: key('Safety induction'), medical: key('Medical'), other: key('Other'),
};

/** My documents and when they expire; a scan opens on the phone. */
export function DocumentsScreen() {
  const t = useT();
  const format = useFormat();
  const toast = useToast();
  const api = useApi();
  const { client } = useAuth();
  const documents = useDocuments();
  const items = [...(documents.data?.documents ?? [])].sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999'));
  const open = async (id: string, name: string) => {
    try { await openWorkspaceFile(client, api.url(`hrms/documents/${id}/file`), name); }
    catch (error) { toast.error(errorMessage(error, t('The file could not be opened.'))); }
  };
  return <ListScreen title={t('Documents')} back items={items} keyExtractor={(item) => item.id}
    loading={documents.isLoading} error={documents.error ? errorMessage(documents.error, t('Documents could not be loaded.')) : null} onRetry={() => void documents.refetch()}
    onRefresh={() => void documents.refetch()} refreshing={documents.isRefetching}
    empty={<Empty icon={FileText} title={t('No documents yet')} detail={t('HR adds your documents.')} />}
    renderItem={(item, _, first) => <ListRow first={first} icon={FileText} title={item.title || t(DOCUMENT_KIND[item.kind])}
      detail={[t(DOCUMENT_KIND[item.kind]), item.number, item.expiresOn ? t('Expires {day}', { day: format.day(item.expiresOn) }) : null].filter(Boolean).join(' · ')}
      trailing={<StatusChip status={item.status} />} onPress={item.fileName ? () => void open(item.id, item.fileName ?? item.title) : undefined} />} />;
}
