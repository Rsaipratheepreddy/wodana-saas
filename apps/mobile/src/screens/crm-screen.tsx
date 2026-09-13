import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text, useTheme } from '../design-system';
import { HrmsTheme } from '../hrms/theme';
import { MoreView } from '../crm/more-views';
import { DealsView, InboxView, LeadsView, TodayView } from '../crm/work-views';
import { CrmTabs, type CrmTab } from '../crm/ui';

export function CrmScreen({ workspaceId }: { workspaceId: string }) {
  return <HrmsTheme><CrmWorkspace workspaceId={workspaceId} /></HrmsTheme>;
}

function CrmWorkspace({ workspaceId }: { workspaceId: string }) {
  const { colors } = useTheme();
  const [tab, setTab] = useState<CrmTab>('today');
  const [revision, setRevision] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const [record, setRecord] = useState<{ tab: CrmTab; id?: string; more?: 'activities' } | null>(null);
  const refresh = () => setRevision(value => value + 1);
  const changeTab = (next: CrmTab) => { setRecord(null); setTab(next); };
  const openPriority = (kind: string, id: string) => {
    if (kind === 'customer_reply') { setRecord({ tab: 'inbox', id }); setTab('inbox'); return; }
    if (kind === 'stale_opportunity') { setRecord({ tab: 'deals', id }); setTab('deals'); return; }
    if (['sla_breach', 'stale_lead'].includes(kind)) { setRecord({ tab: 'leads', id }); setTab('leads'); return; }
    setRecord({ tab: 'more', more: 'activities' }); setTab('more');
  };
  return <View style={{ flex: 1, backgroundColor: colors.canvas }}>
    <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', gap: 12, paddingBottom: 12 }}>
      <Text size="sm" tone="textSecondary">Follow customers from first enquiry through delivery handoff.</Text>
      <CrmTabs value={tab} onChange={changeTab} />
    </View>
    <ScrollView ref={scroll} key={tab} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}
      style={{ width: '100%', maxWidth: 720, alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.actionPrimary} colors={[colors.actionPrimary]} />}
      contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
      {tab === 'today' ? <TodayView workspaceId={workspaceId} revision={revision} refresh={refresh} open={openPriority} />
        : tab === 'leads' ? <LeadsView workspaceId={workspaceId} revision={revision} refresh={refresh} initialId={record?.tab === 'leads' ? record.id : undefined} />
          : tab === 'deals' ? <DealsView workspaceId={workspaceId} revision={revision} refresh={refresh} initialId={record?.tab === 'deals' ? record.id : undefined} />
            : tab === 'inbox' ? <InboxView workspaceId={workspaceId} revision={revision} refresh={refresh} initialId={record?.tab === 'inbox' ? record.id : undefined} />
              : <MoreView key={record?.more ?? 'hub'} workspaceId={workspaceId} revision={revision} refresh={refresh} initialSection={record?.more}
                onSectionChange={() => requestAnimationFrame(() => scroll.current?.scrollTo({ y: 0, animated: false }))} />}
    </ScrollView>
  </View>;
}
