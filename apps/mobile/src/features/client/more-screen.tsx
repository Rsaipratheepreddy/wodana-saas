import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Bell, FileSignature, FileText, Globe, LogOut, Mail, MessageCircle, Phone, ShieldCheck } from 'lucide-react-native';
import { telLink, mailLink, whatsappLink } from '../../core/contact';
import { languages, useLanguage, useT, type AppLanguage } from '../../core/i18n';
import { usePortal, useProject } from '../../portal/provider';
import { useClientPushState } from '../../portal/push';
import { ConfirmSheet } from '../../ui/dialogs';
import { SelectField, ToggleRow } from '../../ui/fields';
import { ListRow, Screen, Section } from '../../ui/layout';
import { Avatar, Row, Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';

/**
 * More: the client's documents, change requests and warranty (each only when the firm shows it), notifications on this
 * phone, the language, the firm's support contacts and signing out.
 */
export function ClientMoreScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const language = useLanguage();
  const { client, state } = usePortal();
  const { project, view } = useProject();
  const push = useClientPushState();
  const [leaving, setLeaving] = useState(false);
  const site = state.status === 'signedIn' ? state.site : null;
  const sections = project?.sections;
  const open = (path: string) => router.push(path as Href);
  const support = site?.support;
  const records = [
    sections?.documents && project?.documents ? { path: '/portal/documents', icon: FileText, title: t('Documents') } : null,
    sections?.decisions && project?.changes ? { path: '/portal/changes', icon: FileSignature, title: t('Changes') } : null,
    sections?.warranty && project?.warranty ? { path: '/portal/warranty', icon: ShieldCheck, title: t('Warranty') } : null,
  ].filter((record) => record !== null);
  const notifications = push?.step === 'unavailable' ? t('Notifications work in the app installed from the store.')
    : push?.step === 'blocked' ? t('Allow notifications for this app in your phone\'s settings.') : undefined;
  return <Screen title={t('More')} large>
    {view ? <Row gap={3} style={{ paddingHorizontal: theme.space(1) }}>
      <Avatar name={view.contact.name} size={48} />
      <View style={{ flex: 1 }}>
        <Text variant="subheading">{view.contact.name}</Text>
        <Text variant="caption" tone="secondary" style={{ writingDirection: 'ltr' }}>{view.contact.phone}</Text>
      </View>
    </Row> : null}

    {records.length ? <Section>
      {records.map((record, index) => <ListRow key={record.path} first={index === 0} icon={record.icon} title={record.title} onPress={() => open(record.path)} />)}
    </Section> : null}

    <Section title={t('Notifications')}>
      {push && push.step !== 'unavailable' && push.step !== 'blocked'
        ? <ToggleRow first label={t('Notifications on this phone')} value={push.step === 'register'}
          onChange={(on) => { void (on ? push.allow() : push.turnOff()); }} />
        : <ListRow first icon={Bell} title={t('Notifications on this phone')} detail={notifications}
          onPress={push?.step === 'blocked' ? () => { void Linking.openSettings().catch(() => undefined); } : undefined} />}
    </Section>

    <Section title={t('Language')}>
      <View style={{ padding: theme.space(4) }}>
        <SelectField label={t('Language')} value={language.language} options={languages.map((item) => ({ value: item.id, label: item.label }))}
          onChange={(next) => { if (next) void language.setLanguage(next as AppLanguage); }} />
      </View>
    </Section>

    {support && (support.phone || support.email || support.whatsapp) ? <Section title={t('Contact your project team')}>
      {support.phone ? <ListRow first icon={Phone} title={support.phone} onPress={() => { const link = telLink(support.phone); if (link) void Linking.openURL(link).catch(() => undefined); }} /> : null}
      {support.whatsapp ? <ListRow first={!support.phone} icon={MessageCircle} title={t('WhatsApp')} detail={support.whatsapp}
        onPress={() => { const link = whatsappLink(support.whatsapp); if (link) void Linking.openURL(link).catch(() => undefined); }} /> : null}
      {support.email ? <ListRow first={!support.phone && !support.whatsapp} icon={Mail} title={support.email}
        onPress={() => { const link = mailLink(support.email); if (link) void Linking.openURL(link).catch(() => undefined); }} /> : null}
    </Section> : null}

    <Section>
      <ListRow first icon={LogOut} danger title={t('Sign out')} onPress={() => setLeaving(true)} />
    </Section>
    <Row gap={1} style={{ justifyContent: 'center' }}><Globe color={theme.colors.iconSubtle} size={12} />
      <Text variant="caption" tone="tertiary" style={{ fontSize: 11 }}>{t('Powered by Wodana')}</Text></Row>
    <ConfirmSheet open={leaving} onClose={() => setLeaving(false)} title={t('Sign out')} action={t('Sign out')} danger onConfirm={() => client.signOut()} />
  </Screen>;
}
