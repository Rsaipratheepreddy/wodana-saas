import { useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { Check, ExternalLink, Images, Palette } from 'lucide-react-native';
import { useT } from '../../core/i18n';
import { CodedDecision } from '../../portal/flows';
import { choicePending, decisionPurpose } from '../../portal/model';
import { usePortal, usePortalFormat, useProject, useRefreshPortal } from '../../portal/provider';
import type { PortalAlternative, PortalChoice, PortalDesign, PortalPresentation, PortalProject } from '../../portal/types';
import { ReasonSheet } from '../../ui/dialogs';
import { Card, Empty, Failure, Loading, Screen, Section } from '../../ui/layout';
import { Button, Chip, Row, Text } from '../../ui/primitives';
import { dismissFallbackMs } from '../../ui/sequence';
import { useTheme } from '../../ui/theme';
import { useToast } from '../../ui/toast';
import { CodeSheet, openPortalFile, PortalImage, ProjectSwitcher, StateChip } from './parts';

/**
 * The client's design decisions (plan §6.7a, the web portal's Decisions → design): concepts to choose from, designs
 * to approve (with a code), ask changes on or decline with a reason, and each material and design choice to confirm or
 * turn down — with up to three alternatives offered after a "not this" (R2).
 */
export function ClientDesignScreen() {
  const t = useT();
  const { project, query } = useProject();
  const refresh = useRefreshPortal();
  if (query.isLoading) return <Screen title={t('Design')} large><Loading shape="cards" count={3} /></Screen>;
  if (query.error && !query.data) return <Screen title={t('Design')} large><Failure message={query.error.message} onRetry={() => void query.refetch()} /></Screen>;
  const designs = project?.decisions?.designs ?? [];
  const choices = project?.choices;
  const shared = project?.design?.designs ?? [];
  const nothing = !project || (!designs.length && !choices?.presentations.length && !choices?.choices.length && !shared.length);
  return <Screen title={t('Design')} large below={<ProjectSwitcher />} onRefresh={() => void refresh()} refreshing={query.isRefetching}>
    {nothing || !project ? <Empty icon={Palette} title={t('No designs to review')} />
      : <DesignContent project={project} />}
  </Screen>;
}

function DesignContent({ project }: { project: PortalProject }) {
  const t = useT();
  const theme = useTheme();
  const presentations = project.choices?.presentations.filter((item) => item.canDecide) ?? [];
  const reviews = project.decisions?.designs ?? [];
  const choices = project.choices?.choices ?? [];
  const waiting = choices.filter(choicePending);
  const settled = choices.filter((item) => !choicePending(item));
  const decided = new Set(reviews.map((design) => design.id));
  const others = (project.design?.designs ?? []).flatMap((design) => design.versions.filter((version) => version.latest && !decided.has(version.id))
    .map((version) => ({ ...version, title: design.title, room: design.room })));
  return <>
    {presentations.map((round) => <PresentationCard key={round.id} round={round} caseId={project.id} />)}
    {reviews.length ? <Section title={reviews.some((design) => design.canDecide) ? t('Designs to review') : t('Designs')} flat>
      <View style={{ gap: theme.space(3) }}>{reviews.map((design) => <DesignCard key={design.id} design={design} caseId={project.id} />)}</View>
    </Section> : null}
    {choices.length ? <Section title={t('Your choices')} action={project.choices?.locked ? <Chip label={t('Signed off')} tone="success" />
      : waiting.length ? <Chip label={t('{count} to confirm', { count: waiting.length })} tone="info" /> : undefined} flat>
      <View style={{ gap: theme.space(3) }}>{[...waiting, ...settled].map((choice) => <ChoiceCard key={choice.versionId} choice={choice} caseId={project.id} />)}</View>
    </Section> : null}
    {others.length ? <Section title={t('Shared designs')} flat>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(3) }}>{others.map((version) => <SharedTile key={version.id} id={version.id} title={version.title}
        detail={[version.room, t('V{number}', { number: version.number })].filter(Boolean).join(' · ')} image={version.hasPreview && /^image\//.test(version.mimeType)} />)}</View>
    </Section> : null}
  </>;
}

function SharedTile({ id, title, detail, image }: { id: string; title: string; detail: string; image: boolean }) {
  const theme = useTheme();
  const { client } = usePortal();
  const toast = useToast();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} style={{ width: '47%', gap: 4 }}
    onPress={() => { void openPortalFile(client, 'design', id, title).catch((cause: Error) => toast.error(cause.message)); }}>
    {image ? <PortalImage kind="design" id={id} style={{ width: '100%', aspectRatio: 1, borderRadius: theme.radius.md }} />
      : <View style={{ width: '100%', aspectRatio: 1, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
        <Images color={theme.colors.icon} size={24} /></View>}
    <Text variant="label" numberOfLines={1}>{title}</Text>
    <Text variant="caption" tone="secondary" numberOfLines={1}>{detail}</Text>
  </Pressable>;
}

/** A presentation round: pick one of the options, or ask for changes. */
function PresentationCard({ round, caseId }: { round: PortalPresentation; caseId: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { client } = usePortal();
  const refresh = useRefreshPortal();
  const [picked, setPicked] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [id] = useState(() => client.newId());
  const send = async (input: Record<string, unknown>) => {
    setBusy(true);
    try { await client.command(id, { action: 'presentation_choice', caseId, presentationId: round.id, version: round.version, ...input }); toast.success(t('Sent')); await refresh(); }
    catch (cause) { toast.error((cause as Error).message); throw cause; }
    finally { setBusy(false); }
  };
  return <Card>
    <Row style={{ justifyContent: 'space-between' }}>
      <Text variant="subheading" style={{ flex: 1 }}>{round.round > 1 ? t('{stage} · revision {number}', { stage: round.label, number: round.round - 1 }) : round.label}</Text>
      <Chip label={t('Choose one')} tone="info" />
    </Row>
    <View accessibilityRole="radiogroup" accessibilityLabel={t('Options')} style={{ gap: theme.space(3) }}>
      {round.options.map((option) => {
        const chosen = picked === option.id;
        return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: chosen }} onPress={() => setPicked(option.id)}
          style={{ borderRadius: theme.radius.md, borderWidth: chosen ? 2 : 1, borderColor: chosen ? theme.colors.actionPrimary : theme.colors.structuralDivider, overflow: 'hidden' }}>
          {option.versionId && option.hasPreview ? <PortalImage kind="design" id={option.versionId} style={{ width: '100%', aspectRatio: 16 / 10 }} /> : null}
          <Row style={{ padding: theme.space(3), justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label">{option.title}</Text>
              {option.note ? <Text variant="caption" tone="secondary">{option.note}</Text> : null}
            </View>
            {option.linkUrl ? <Button size="sm" variant="ghost" icon={ExternalLink} label={t('Open link')} onPress={() => { void Linking.openURL(option.linkUrl!).catch(() => undefined); }} /> : null}
            {chosen ? <Check color={theme.colors.actionPrimary} size={20} /> : null}
          </Row>
        </Pressable>;
      })}
    </View>
    <Row gap={2} style={{ justifyContent: 'flex-end' }}>
      <Button size="sm" variant="ghost" label={t('Ask for changes')} disabled={busy} onPress={() => setAsking(true)} />
      <Button size="sm" variant="primary" label={t('Choose this one')} loading={busy} disabled={!picked} onPress={() => { void send({ decision: 'choose', optionId: picked }).catch(() => undefined); }} />
    </Row>
    <ReasonSheet open={asking} onClose={() => setAsking(false)} title={t('Ask for changes')} label={t('What would you like changed?')} action={t('Send')}
      onSubmit={(note) => send({ decision: 'changes', note })} />
  </Card>;
}

/** A design at its exact version: approve with a code, or ask for changes / decline with a reason (then the code). */
function DesignCard({ design, caseId }: { design: PortalDesign; caseId: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const format = usePortalFormat();
  const { client, state } = usePortal();
  const refresh = useRefreshPortal();
  const [reason, setReason] = useState<'changes' | 'decline' | null>(null);
  const [decision, setDecision] = useState<CodedDecision | null>(null);
  const [label, setLabel] = useState('');
  const channels = (state.status === 'signedIn' ? state.site?.signIn.channels : null) ?? ['whatsapp', 'email'];
  const image = /^image\//.test(design.mimeType) && design.hasPreview !== false;
  const decide = (choice: 'accept' | 'changes' | 'decline', note = '') => {
    setLabel(choice === 'accept' ? t('Approve') : choice === 'changes' ? t('Ask for changes') : t('Decline'));
    setDecision(new CodedDecision(client, decisionPurpose('design', caseId, design.id, choice),
      { action: 'design_decision', caseId, versionId: design.id, decision: choice, note, uploadIds: [] }));
  };
  return <Card>
    {image ? <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${design.title} · V${design.number}`}
      onPress={() => { void openPortalFile(client, 'design', design.id, design.title).catch((cause: Error) => toast.error(cause.message)); }}>
      <PortalImage kind="design" id={design.id} preview={false} contentFit="contain" style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: theme.radius.md }} />
    </Pressable> : <Button icon={Images} label={t('Open the file')} onPress={() => { void openPortalFile(client, 'design', design.id, design.title).catch((cause: Error) => toast.error(cause.message)); }} />}
    <Row style={{ justifyContent: 'space-between' }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="subheading">{design.title} · V{design.number}</Text>
        <Text variant="caption" tone="secondary">{[design.room, design.item, design.type].filter(Boolean).join(' · ')}</Text>
      </View>
      <StateChip state={design.status} canDecide={design.canDecide} />
    </Row>
    {design.canDecide ? <>
      {design.dueAt ? <Text variant="caption" tone="secondary">{t('Please decide by {date}', { date: format.day(design.dueAt) })}</Text> : null}
      <Row gap={2} wrap style={{ justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" label={t('Decline')} onPress={() => setReason('decline')} />
        <Button size="sm" label={t('Ask for changes')} onPress={() => setReason('changes')} />
        <Button size="sm" variant="primary" label={t('Approve')} onPress={() => decide('accept')} testID={`approve-${design.id}`} />
      </Row>
    </> : null}
    <ReasonSheet open={reason !== null} onClose={() => setReason(null)} title={reason === 'decline' ? t('Decline') : t('Ask for changes')}
      label={reason === 'decline' ? t('Why are you declining?') : t('What would you like changed?')} action={t('Continue')}
      // The code sheet opens once the reason sheet has gone (one modal at a time on iOS).
      onSubmit={(note) => { const choice = reason; if (choice) setTimeout(() => decide(choice, note), dismissFallbackMs(Platform.OS) + 120); }} />
    <CodeSheet decision={decision} channels={channels} confirmLabel={label} onClose={() => setDecision(null)}
      onDone={() => { setDecision(null); toast.success(t('Thank you. Your decision was sent to your project team.'), 'approve'); void refresh(); }} />
  </Card>;
}

/** A material or design choice the team recorded: confirm it or say "not this" (then pick an alternative, R2). */
function ChoiceCard({ choice, caseId }: { choice: PortalChoice; caseId: string }) {
  const t = useT();
  const toast = useToast();
  const format = usePortalFormat();
  const { client } = usePortal();
  const refresh = useRefreshPortal();
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [id] = useState(() => client.newId());
  const send = async (decision: 'confirm' | 'decline', note = '') => {
    setBusy(true);
    try { await client.command(id, { action: 'ledger_decision', caseId, entryId: choice.entryId, versionId: choice.versionId, decision, note }); toast.success(t('Sent'), 'approve'); await refresh(); }
    catch (cause) { toast.error((cause as Error).message); throw cause; }
    finally { setBusy(false); }
  };
  const details = [choice.specification, choice.room, choice.quantity ? `${choice.quantity} ${choice.unit}`.trim() : '', choice.unitPrice && choice.currency ? format.money(choice.unitPrice, choice.currency) : '']
    .filter(Boolean).join(' · ');
  return <Card>
    <Row style={{ justifyContent: 'space-between' }} align="flex-start">
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label">{choice.title}</Text>
        {details ? <Text variant="caption" tone="secondary">{details}</Text> : null}
        {choice.status === 'confirmed' && choice.confirmedAt ? <Text variant="caption" tone="secondary">
          {t('Confirmed by {name} on {date}', { name: choice.confirmedByName ?? '', date: format.day(choice.confirmedAt) })}</Text> : null}
      </View>
      {choice.changed ? <Chip label={t('Changed')} tone="warning" /> : !choice.canDecide ? <StateChip state={choice.status} /> : null}
    </Row>
    {choice.canDecide ? <Row gap={2} style={{ justifyContent: 'flex-end' }}>
      <Button size="sm" variant="ghost" label={t('Not this')} disabled={busy} onPress={() => setDeclining(true)} />
      <Button size="sm" variant="primary" label={t('Confirm')} loading={busy} onPress={() => { void send('confirm').catch(() => undefined); }} />
    </Row> : null}
    {choice.alternatives?.length ? <Alternatives alternatives={choice.alternatives} caseId={caseId} /> : null}
    <ReasonSheet open={declining} onClose={() => setDeclining(false)} title={t('Not this')} label={t('What would you like instead?')} action={t('Send')}
      onSubmit={(note) => send('decline', note)} />
  </Card>;
}

function Alternatives({ alternatives, caseId }: { alternatives: PortalAlternative[]; caseId: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const format = usePortalFormat();
  const { client } = usePortal();
  const refresh = useRefreshPortal();
  const [busy, setBusy] = useState<string | null>(null);
  const [id] = useState(() => client.newId());
  const choose = async (alternative: PortalAlternative) => {
    setBusy(alternative.id);
    try { await client.command(id, { action: 'ledger_alternative', caseId, alternativeId: alternative.id }); toast.success(t('Sent'), 'approve'); await refresh(); }
    catch (cause) { toast.error((cause as Error).message); }
    finally { setBusy(null); }
  };
  return <View style={{ gap: theme.space(2), paddingTop: theme.space(2), borderTopWidth: 1, borderTopColor: theme.colors.structuralDivider }}>
    <Text variant="caption" tone="secondary">{t('Alternatives you could choose instead')}</Text>
    {alternatives.map((alternative) => <View key={alternative.id} style={{ gap: theme.space(1) }}>
      <Text variant="label">{alternative.title}</Text>
      {alternative.unitPrice && alternative.currency ? <Text variant="caption" tone="secondary">
        {format.money(alternative.unitPrice, alternative.currency)}{alternative.unit ? ` / ${alternative.unit}` : ''}{alternative.lineTotal ? ` · ${format.money(alternative.lineTotal, alternative.currency)}` : ''}</Text> : null}
      <Row gap={2} wrap>
        {alternative.inStock ? <Chip label={t('In stock')} tone="success" /> : null}
        {alternative.inBudget ? <Chip label={t('Within budget')} tone="info" /> : null}
        {alternative.fromPastJobs ? <Chip label={t('Used before')} /> : null}
      </Row>
      {alternative.canChoose ? <Button size="sm" variant="primary" label={t('Choose this')} loading={busy === alternative.id} disabled={Boolean(busy)} onPress={() => void choose(alternative)} /> : null}
    </View>)}
  </View>;
}
