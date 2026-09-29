import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { CloudOff, UserCheck, UserPlus } from 'lucide-react-native';
import { errorMessage, isOffline } from '../../core/api';
import { useT } from '../../core/i18n';
import { useOnline } from '../../core/query';
import { useSession } from '../../core/session';
import { haptic } from '../../core/haptics';
import { SelectField, TextField, type Option } from '../../ui/fields';
import { Banner, Failure, ListRow, Loading, Screen, Section } from '../../ui/layout';
import { Button, Row, Stack, Text } from '../../ui/primitives';
import { StatusChip } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { useContactMatches, useCreateEnquiry, useLeadOptions, useReferrers, useRoutingConfigured, useSalesOwners } from './api';
import { contactQuery, enquiryProblem, intakeBody, referralKind, regionOf, RETURNING_SOURCE, sourceAllowed, type EnquiryForm, type Identity, type Owner } from './model';

const OTHER_AREA = 'other';
const EMPTY: EnquiryForm = { name: '', mobile: '', email: '', region: '', area: '', serviceType: '', source: '', channel: '', customerType: '', summary: '',
  referral: { name: '', contact: '', membershipId: '', option: '' } };
type OwnerChoice = 'me' | 'routing' | 'unassigned' | `member:${string}`;
const ownerOf = (choice: OwnerChoice | null): Owner | null => (!choice ? null : choice.startsWith('member:') ? { membershipId: choice.slice(7) } : choice as Owner);

/**
 * A new enquiry while the client is on the phone (LF-1): the mobile first, matched as it's typed so an existing
 * client is recognised; then only what the workspace requires. Saved through the same intake command as the web,
 * with one idempotency key per form.
 */
export function NewEnquiryScreen() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const session = useSession();
  const { mobile: prefillMobile, name: prefillName } = useLocalSearchParams<{ mobile?: string; name?: string }>();
  const options = useLeadOptions();
  const owners = useSalesOwners();
  const routing = useRoutingConfigured();
  const create = useCreateEnquiry();
  const [requestId] = useState(() => Crypto.randomUUID());
  const [form, setForm] = useState<EnquiryForm>(() => ({ ...EMPTY, mobile: prefillMobile ?? '', name: prefillName ?? '' }));
  const [identity, setIdentity] = useState<Identity>(null);
  const [owner, setOwner] = useState<OwnerChoice | null>(null);
  const ownerTouched = useRef(false);
  const [areaOther, setAreaOther] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof EnquiryForm>(field: K) => (value: EnquiryForm[K]) => { setForm((current) => ({ ...current, [field]: value })); setProblem(null); };

  // The workspace's country reads a number typed without its code (region pack, never a constant).
  const country = regionOf(session.membership.workspaceLocale);
  const [typed, setTyped] = useState<{ mobile: string; email: string }>({ mobile: form.mobile, email: '' });
  useEffect(() => { const timer = setTimeout(() => setTyped({ mobile: form.mobile, email: form.email }), 350); return () => clearTimeout(timer); }, [form.mobile, form.email]);
  const query = useMemo(() => contactQuery(typed.mobile, typed.email, country), [typed, country]);
  const found = useContactMatches(query);
  const matches = query ? found.data?.matches ?? [] : [];
  const mobileError = query?.mobile && found.data && !found.data.valid ? found.data.message ?? t('Enter a valid mobile number.') : undefined;
  // A different set of people needs a fresh answer.
  const chosen: Identity = identity?.kind === 'existing' ? (matches.some((match) => match.partyId === identity.partyId) ? identity : null) : identity?.kind === 'new' && matches.length ? identity : null;

  const data = options.data;
  const roleKeys = data?.roleKeys ?? [];
  const sources = (data?.sources ?? []).filter((source) => source.id !== RETURNING_SOURCE && sourceAllowed(source, roleKeys));
  const channels = form.source ? data?.channels[form.source] ?? [] : [];
  const regions = data?.emirates ?? [];
  const areas = form.region ? data?.areas[form.region] ?? [] : [];
  const kind = referralKind(form.source, form.channel);
  const referrers = useReferrers(kind === 'internal');

  // Enquiry type starts at "not sure" when the workspace has it; nothing else is guessed.
  useEffect(() => {
    if (!data || form.serviceType) return;
    const start = data.enquiryTypes.find((item) => item.id === 'not_sure') ?? data.enquiryTypes[0];
    if (start) setForm((current) => ({ ...current, serviceType: start.id }));
  }, [data, form.serviceType]);

  // The owner: me for what I bring in myself, routing for the company's enquiries (the web's rule).
  const me = session.membershipId;
  const meCanOwn = !!me && (owners.data?.items ?? []).some((item) => item.id === me);
  const canAssign = session.can('crm.leads.assign');
  const limited = !!sources.find((source) => source.id === form.source)?.allowedRoles?.length;
  const routed = routing.data === true;
  useEffect(() => {
    if (ownerTouched.current || owners.isLoading || routing.isLoading) return;
    setOwner(meCanOwn && (limited || !routed) ? 'me' : routed ? 'routing' : meCanOwn ? 'me' : 'unassigned');
  }, [meCanOwn, limited, routed, owners.isLoading, routing.isLoading]);
  const ownerOptions: Option<OwnerChoice>[] = [
    ...(meCanOwn ? [{ value: 'me' as const, label: t('Me') }] : []),
    ...(routed ? [{ value: 'routing' as const, label: t('Use routing rules') }] : []),
    { value: 'unassigned', label: t('Leave unassigned') },
    ...(canAssign ? (owners.data?.items ?? []).filter((item) => item.id !== me).map((item) => ({ value: `member:${item.id}` as OwnerChoice, label: item.displayName || item.email, detail: item.email })) : []),
  ];

  const chooseSource = (value: string | null) => {
    const next = value ?? '';
    const list = data?.channels[next] ?? [];
    setForm((current) => ({ ...current, source: next, channel: list.length === 1 ? list[0].id : '', referral: EMPTY.referral }));
    setProblem(null);
  };

  const save = async () => {
    const reason = enquiryProblem(form, { matches: matches.length, identity: chosen, regions: regions.length > 0, customerTypes: (data?.customerTypes.length ?? 0) > 0, owner: ownerOf(owner) });
    if (reason || mobileError) { haptic.warning(); setProblem(reason ?? mobileError ?? null); return; }
    try {
      const result = await create.mutateAsync({ requestId, body: intakeBody(form, { identity: chosen, owner: ownerOf(owner)!, me, countryCode: country }) });
      toast.success(result.reference ? t('Enquiry {reference} created', { reference: result.reference }) : t('Enquiry created'));
      if (result.leadId) router.replace(`/sales/${result.leadId}`);
      else router.back();
    } catch (error) {
      setProblem(isOffline(error) ? t('New enquiries need a connection.') : errorMessage(error, t('The enquiry could not be saved.')));
      haptic.error();
    }
  };

  if (options.isLoading) return <Screen back title={t('New enquiry')}><Loading shape="form" count={6} /></Screen>;
  if (options.error || !data) return <Screen back title={t('New enquiry')}><Failure message={errorMessage(options.error, t('Enquiry options could not be loaded.'))} onRetry={() => void options.refetch()} /></Screen>;
  const existing = chosen?.kind === 'existing' ? chosen : null;
  return <Screen back title={t('New enquiry')} keyboard
    footer={<Stack gap={2}>
      {problem ? <Banner tone="danger" title={t(problem)} /> : null}
      <Button label={t('Create enquiry')} variant="primary" size="lg" full loading={create.isPending} disabled={!online} onPress={() => void save()} />
    </Stack>}>
    {!online ? <Banner tone="neutral" icon={CloudOff} title={t('No connection')} detail={t('New enquiries need a connection.')} /> : null}
    <TextField label={t('Mobile')} value={form.mobile} onChangeText={set('mobile')} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel"
      autoFocus={!prefillMobile} maxLength={40} error={mobileError}
      hint={found.isFetching ? t('Checking for an existing client…') : undefined} />
    {matches.length ? <Section title={t('Existing client?')}>
      {matches.map((match, index) => {
        const selected = existing?.partyId === match.partyId;
        return <ListRow key={match.partyId} first={index === 0} icon={selected ? UserCheck : undefined} iconTone={selected ? 'success' : 'neutral'} title={match.name}
          detail={[match.mobile, match.email].filter(Boolean).join(' · ')}
          meta={match.reference ? <Row gap={2} wrap style={{ marginTop: 4 }}>
            <Text variant="caption" tone="tertiary">{[match.reference, match.ownerName].filter(Boolean).join(' · ')}</Text>
            {match.status ? <StatusChip status={match.status} /> : null}
          </Row> : undefined}
          trailing={<Stack gap={1}>
            {match.open && match.leadId ? <Button size="sm" variant="ghost" label={t('Open it')} onPress={() => router.push(`/sales/${match.leadId}`)} /> : null}
            <Button size="sm" variant={selected ? 'primary' : 'secondary'} label={match.open ? t('Add to this client') : t('Add as returning')}
              onPress={() => { setIdentity({ kind: 'existing', partyId: match.partyId, name: match.name }); setProblem(null); }} />
          </Stack>} />;
      })}
      <ListRow title={t('Different person')} icon={chosen?.kind === 'new' ? UserCheck : UserPlus} iconTone={chosen?.kind === 'new' ? 'success' : 'neutral'}
        onPress={() => { setIdentity({ kind: 'new' }); setProblem(null); }} />
    </Section> : null}
    <TextField label={t('Customer name')} value={existing ? existing.name : form.name} onChangeText={set('name')} editable={!existing} autoCapitalize="words"
      textContentType="name" maxLength={240} />
    <TextField label={t('Email')} value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
      textContentType="emailAddress" maxLength={500} hint={t('Optional')} />
    <SelectField label={t('Enquiry type')} value={form.serviceType || null} onChange={(value) => set('serviceType')(value ?? '')}
      options={data.enquiryTypes.map((item) => ({ value: item.id, label: t(item.label) }))} />
    <SelectField label={t('Source')} placeholder={t('Choose source')} value={form.source || null} onChange={chooseSource}
      options={sources.map((item) => ({ value: item.id, label: t(item.label) }))} />
    {form.source ? <SelectField label={t('Channel')} placeholder={t('Choose channel')} value={form.channel || null} onChange={(value) => { set('channel')(value ?? ''); setForm((current) => ({ ...current, referral: EMPTY.referral })); }}
      options={channels.map((item) => ({ value: item.id, label: t(item.label) }))} /> : null}
    {kind === 'external' ? <Row gap={2} align="flex-start">
      <View style={{ flex: 1 }}><TextField label={t('Referred by')} value={form.referral.name} maxLength={160}
        onChangeText={(value) => setForm((current) => ({ ...current, referral: { ...current.referral, name: value } }))} /></View>
      <View style={{ flex: 1 }}><TextField label={t('Referrer contact')} value={form.referral.contact} maxLength={160}
        onChangeText={(value) => setForm((current) => ({ ...current, referral: { ...current.referral, contact: value } }))} /></View>
    </Row> : kind === 'internal' ? <SelectField label={t('Referred by')} value={form.referral.membershipId || null} options={referrers.data ?? []}
      onChange={(value) => setForm((current) => ({ ...current, referral: { ...current.referral, membershipId: value ?? '' } }))} />
      : kind ? <SelectField label={t('Referred by')} value={form.referral.option || null}
        options={((kind === 'broker' ? data.referralBrokers : data.referralPartners) ?? []).map((item) => ({ value: item.id, label: item.label }))}
        onChange={(value) => setForm((current) => ({ ...current, referral: { ...current.referral, option: value ?? '' } }))} /> : null}
    {regions.length ? <SelectField label={t('Region')} value={form.region || null} options={regions.map((item) => ({ value: item.id, label: t(item.label) }))}
      onChange={(value) => { setAreaOther(false); setForm((current) => ({ ...current, region: value ?? '', area: '' })); setProblem(null); }} /> : null}
    {form.region && areas.length && !areaOther ? <SelectField label={t('Area')} value={form.area || null} allowClear placeholder={t('Not specified')}
      options={[...areas.map((item) => ({ value: item.id, label: item.label })), { value: OTHER_AREA, label: t('Other area') }]}
      onChange={(value) => { if (value === OTHER_AREA) { setAreaOther(true); set('area')(''); } else set('area')(value ?? ''); }} />
      : form.region || !regions.length ? <TextField label={t('Area / city')} value={form.area} onChangeText={set('area')} maxLength={240} hint={t('Optional')} /> : null}
    {data.customerTypes.length ? <SelectField label={t('Client type')} value={form.customerType || null} onChange={(value) => set('customerType')(value ?? '')}
      options={data.customerTypes.map((item) => ({ value: item.id, label: t(item.label) }))} /> : null}
    <SelectField label={t('Owner')} value={owner} options={ownerOptions} onChange={(value) => { ownerTouched.current = true; setOwner(value); setProblem(null); }} />
    <TextField label={t('Project description')} value={form.summary} onChangeText={set('summary')} multiline maxLength={10_000} placeholder={t('What would the customer like to do?')} />
  </Screen>;
}
