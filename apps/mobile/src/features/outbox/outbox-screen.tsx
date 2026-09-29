import { useState } from 'react';
import { CloudOff, CloudUpload, TriangleAlert } from 'lucide-react-native';
import { useFormat } from '../../core/format';
import { useT } from '../../core/i18n';
import { useOutbox } from '../../core/outbox';
import type { OutboxItem } from '../../core/outbox-model';
import { useOnline } from '../../core/query';
import { ActionSheet, ConfirmSheet, ReasonSheet } from '../../ui/dialogs';
import { Banner, Empty, ListRow, ListScreen } from '../../ui/layout';
import { Chip, Text } from '../../ui/primitives';

/** Captures waiting on this phone: what they are, whether they're sending, and what the server asked for. */
export function OutboxScreen() {
  const t = useT();
  const format = useFormat();
  const online = useOnline();
  const outbox = useOutbox();
  const [menu, setMenu] = useState<OutboxItem | null>(null);
  const [discarding, setDiscarding] = useState<OutboxItem | null>(null);
  const [reasonFor, setReasonFor] = useState<OutboxItem | null>(null);
  const items = [...outbox.items].sort((a, b) => a.createdAt - b.createdAt);
  const reasonable = (item: OutboxItem) => item.status === 'blocked' && !!item.issues?.length;
  return <>
    <ListScreen title={t('Waiting to send')} back items={items} keyExtractor={(item) => item.id}
      toolbar={!online ? <Banner tone="neutral" icon={CloudOff} title={t('No connection')} detail={t('Everything here sends by itself when you are back online.')} /> : undefined}
      // Pulling down sends what's waiting now instead of at its next try.
      onRefresh={online ? () => outbox.flush() : undefined} refreshing={false}
      empty={<Empty icon={CloudUpload} title={t('Everything is sent')} />}
      renderItem={(item, _, first) => <ListRow first={first} icon={item.status === 'blocked' ? TriangleAlert : CloudUpload} iconTone={item.status === 'blocked' ? 'warning' : 'info'}
        title={item.title} onPress={() => setMenu(item)}
        detail={item.status === 'blocked' ? (item.issues?.length ? item.issues.map((issue) => t(issue)).join(' · ') : item.error) : [item.detail, item.attempts ? item.error : null].filter(Boolean).join(' · ')}
        meta={<Text variant="caption" tone="tertiary">{t('Saved {when}', { when: format.ago(new Date(item.createdAt)) })}</Text>}
        trailing={<Chip label={item.status === 'blocked' ? t('Needs you') : item.status === 'sending' ? t('Sending') : t('Waiting')} tone={item.status === 'blocked' ? 'warning' : 'info'} />} />}
      footer={undefined} />
    <ActionSheet open={!!menu} onClose={() => setMenu(null)} title={menu?.title} actions={menu ? [
      ...(reasonable(menu) ? [{ label: t('Add reason'), onPress: () => setReasonFor(menu) }] : []),
      ...(menu.status !== 'sending' ? [{ label: t('Send now'), onPress: () => outbox.retry(menu.id) }] : []),
      { label: t('Discard'), danger: true, onPress: () => setDiscarding(menu) },
    ] : []} />
    <ReasonSheet open={!!reasonFor} onClose={() => setReasonFor(null)} title={t('Why is this different?')} detail={reasonFor?.issues?.map((issue) => t(issue)).join(' · ')}
      label={t('Reason for review')} action={t('Send')} onSubmit={(reason) => { if (reasonFor) outbox.amend(reasonFor.id, { exceptionReason: reason }); }} />
    <ConfirmSheet open={!!discarding} onClose={() => setDiscarding(null)} danger title={t('Discard this?')} detail={t('It will not be sent. Photos saved for it are deleted from this phone.')}
      action={t('Discard')} onConfirm={() => { if (discarding) outbox.discard(discarding.id); }} />
  </>;
}
