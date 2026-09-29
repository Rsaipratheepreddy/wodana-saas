import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { ArrowLeftRight, Bell, CalendarClock, CalendarDays, CloudUpload, FileText, Languages, LogIn, LogOut, Plane, Users } from 'lucide-react-native';
import { useAuth } from '../../auth/provider';
import { errorMessage, useApi } from '../../core/api';
import { openSettings } from '../../core/media';
import { ToggleRow } from '../../ui/fields';
import { useToast } from '../../ui/toast';
import { setHapticsEnabled } from '../../core/haptics';
import { releaseThisPhone, usePushState, useSetPush } from '../shell/push-registration';
import { useFormat } from '../../core/format';
import { languages, preferenceLocale, useLanguage, useT, type AppLanguage } from '../../core/i18n';
import { useOutbox } from '../../core/outbox';
import { useSession } from '../../core/session';
import { ConfirmSheet } from '../../ui/dialogs';
import { OptionSheet } from '../../ui/fields';
import { Card, ListRow, Screen, Section, Shimmer } from '../../ui/layout';
import { Avatar, Button, Chip, Row, Text } from '../../ui/primitives';
import { useTheme } from '../../ui/theme';
import { useOrganization } from '../auth/organization';
import { useBalances, useBootstrap, useCurrentAttendance, useLeaveRequests, usePendingTime, useReviews } from '../hrms/api';
import { minutesSince, MODE_LABEL } from '../hrms/model';
import { personDisplayName } from '../../core/person';

/** Me: my attendance first (one tap to check in or out), then my leave, days, time and documents. */
export function MeScreen() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const format = useFormat();
  const { client } = useAuth();
  const session = useSession();
  const outbox = useOutbox();
  const hrms = session.has('hrms');
  const bootstrap = useBootstrap();
  const current = useCurrentAttendance(hrms);
  const year = Number(format.today().slice(0, 4));
  const balances = useBalances(year);
  const team = !!bootstrap.data?.permissions.team;
  const teamLeave = useLeaveRequests('team', undefined, hrms && team);
  const teamReviews = useReviews('team', hrms && team);
  const teamTime = usePendingTime(hrms && team);
  const myRequests = useLeaveRequests('self', year, hrms);
  const [signingOut, setSigningOut] = useState(false);
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const language = useLanguage();
  const api = useApi();
  const organization = useOrganization();
  const workspaces = session.profile.memberships.length;
  const push = usePushState();
  const setPush = useSetPush();
  const toast = useToast();

  const open = current.data && !current.data.endedAt ? current.data : null;
  const segment = open?.segments[open.segments.length - 1];
  const toApprove = (teamLeave.data ?? []).filter((item) => item.canDecide && (item.status === 'pending' || item.status === 'cancellation_pending')).length
    + (teamReviews.data ?? []).filter((item) => item.canDecide && item.status === 'pending').length
    + (teamTime.data?.weeks ?? []).filter((week) => week.canDecide).length;
  const annual = (balances.data ?? []).find((item) => item.limited);
  const upcoming = (myRequests.data ?? []).filter((item) => ['pending', 'approved'].includes(item.status) && item.endDate >= format.today()).length;
  const waiting = outbox.items.length;
  const employee = bootstrap.data?.employee;
  const [feedback, setFeedback] = useState(session.profile.feedbackEnabled !== false);
  const chooseFeedback = async (enabled: boolean) => {
    // Saved on the profile so the web and other phones follow; this phone switches at once.
    setFeedback(enabled); setHapticsEnabled(enabled);
    await api.send('me/feedback', 'PUT', { enabled }).catch(() => toast.show(t('Saved on this phone only. It will follow you once you are back online.'), 'info'));
  };
  const chooseLanguage = async (next: AppLanguage) => {
    setChoosingLanguage(false);
    if (next === language.language) return;
    // Saved on the profile so the web and other phones follow; offline, this phone still switches.
    await api.send('me/language', 'PUT', { preferredLocale: preferenceLocale(next, session.membership.workspaceLocale) }).catch(() => undefined);
    await language.setLanguage(next);
  };

  const name = personDisplayName(session.profile.displayName, session.profile.primaryEmail);
  return <Screen large title={name} subtitle={`${session.membership.workspaceName} · ${session.profile.primaryEmail}`}
    action={<Avatar name={name} size={44} person={{ id: session.profile.id, roles: session.membership.roles }} />}
    onRefresh={() => { void bootstrap.refetch(); void current.refetch(); void balances.refetch(); }} refreshing={current.isRefetching}>
    {hrms && employee?.enabled !== false ? <Card tone={open ? 'action' : 'default'}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="overline" tone="secondary">{t('Attendance')}</Text>
        {open ? <Chip label={t('Checked in')} tone="action" /> : null}
      </Row>
      {current.isLoading ? <Shimmer width="50%" height={22} /> : open
        ? <Text variant="heading">{format.duration(minutesSince(open.startedAt))} · {segment ? (segment.context.location?.name ?? segment.context.name ?? t(MODE_LABEL[segment.mode])) : ''}</Text>
        : <Text variant="heading">{t('Not checked in')}</Text>}
      <View style={{ marginTop: theme.space(2) }}>
        <Button label={open ? t('Check out') : t('Check in')} icon={open ? LogOut : LogIn} variant={open ? 'secondary' : 'primary'} full onPress={() => router.push('/hrms/attendance')} />
      </View>
    </Card> : null}

    {hrms ? <Section>
      <ListRow first icon={Plane} title={t('Leave')} onPress={() => router.push('/hrms/leave')}
        detail={annual ? t('{name}: {days} days left', { name: annual.leaveTypeName, days: format.number(annual.available ?? 0, 1) }) : undefined}
        trailing={upcoming ? <Chip label={t('{count} booked', { count: upcoming })} tone="info" /> : undefined} />
      <ListRow icon={CalendarDays} title={t('My days')} onPress={() => router.push('/hrms/days')} />
      <ListRow icon={CalendarClock} title={t('My time')} onPress={() => router.push('/hrms/time')} />
      <ListRow icon={FileText} title={t('Documents')} onPress={() => router.push('/hrms/documents')} />
    </Section> : null}

    {hrms && team ? <Section>
      <ListRow first icon={Users} title={t('Team')} onPress={() => router.push('/hrms/team')}
        trailing={toApprove ? <Chip label={t('{count} to approve', { count: toApprove })} tone="warning" /> : undefined} />
    </Section> : null}

    {waiting ? <Section>
      <ListRow first icon={CloudUpload} title={t('Waiting to send')} onPress={() => router.push('/outbox')}
        trailing={<Chip label={String(waiting)} tone={outbox.items.some((item) => item.status === 'blocked') ? 'warning' : 'info'} />} />
    </Section> : null}

    <Section>
      {push.state === 'on' || push.state === 'off' || push.state === 'not-registered'
        ? <ToggleRow first label={t('Notifications on this phone')} value={push.state === 'on'}
          detail={setPush.isPending ? t('Saving…') : push.state === 'on' ? t('Work given to you, approvals and site alerts arrive as pushes.') : t('Off: notices wait in the inbox.')}
          onChange={(enabled) => setPush.mutate(enabled, { onError: (error) => toast.show(errorMessage(error, t('Notifications could not be changed.')), 'error') })} />
        : <ListRow first icon={Bell} title={t('Notifications on this phone')}
          detail={push.state === 'blocked' ? t('Not allowed in the phone’s settings') : t('Not available on this device')}
          onPress={push.state === 'blocked' ? openSettings : undefined} />}
    </Section>

    <Section>
      <ToggleRow first label={t('Sound & haptics')} value={feedback}
        detail={t('A light touch when you approve, send, refresh or finish something.')} onChange={(enabled) => void chooseFeedback(enabled)} />
    </Section>

    <Section>
      <ListRow first icon={Languages} title={t('Language')} detail={language.label} onPress={() => setChoosingLanguage(true)} />
      {workspaces > 1 ? <ListRow icon={ArrowLeftRight} title={t('Switch workspace')} detail={session.membership.workspaceName}
        onPress={() => { organization.chooseWorkspace(true); void releaseThisPhone(api).then(() => client.signOut()); }} /> : null}
      <ListRow icon={LogOut} title={t('Sign out')} danger onPress={() => setSigningOut(true)} />
    </Section>
    <Text variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>{t('Version {version}', { version: Constants.expoConfig?.version ?? '' })}</Text>

    <OptionSheet open={choosingLanguage} onClose={() => setChoosingLanguage(false)} title={t('Language')} value={language.language}
      options={languages.map((item) => ({ value: item.id, label: item.label }))} onChange={(next) => { if (next) void chooseLanguage(next); }} />
    <ConfirmSheet open={signingOut} onClose={() => setSigningOut(false)} danger title={t('Sign out?')} action={t('Sign out')}
      detail={waiting ? t('{count} captures are still waiting to send. They send after you sign in again.', { count: waiting }) : undefined}
      onConfirm={async () => {
        // This phone stops getting the person's pushes; signing out never waits more than a moment on it.
        await releaseThisPhone(api);
        await client.signOut();
      }} />
  </Screen>;
}
