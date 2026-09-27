"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarClock, ExternalLink, Link2, UserRound } from "lucide-react";
import {
  ActivityFeed,
  Badge,
  Button,
  Callout,
  Container,
  DataGrid,
  EmptyState,
  Grid,
  Heading,
  Inline,
  PageHeader,
  PropertyRow,
  Stack,
  StageTracker,
  Surface,
  Text,
  useDesignSystem,
  type DataGridColumn,
  type WorkflowStage,
} from "@/design-system";
import {
  jobFlagLabels,
  jobPhaseLabel,
  jobPhases,
  jobStateLabel,
  jobStateTone,
  sourceLabel,
  sourceRoute,
  type JobDetailProjection,
  type JobSourceLink,
} from "@/lib/jobs/jobs";
import { clientTimelineItems } from "@/lib/crm/client-timeline";
import type { Translate } from "@/lib/i18n/keys";
import styles from "./jobs.module.css";

/** A date in the person's locale and the workspace time zone. */
function dateLabel(format: { t: Translate; locale: string; timeZone: string }, value: string | null, withTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return format.t("Not set");
  return new Intl.DateTimeFormat(format.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: format.timeZone,
  }).format(new Date(value));
}

function sourceTone(link: JobSourceLink): "neutral" | "success" | "warning" {
  if (link.status === "detached") return "neutral";
  return link.sourceState === "available" ? "success" : "warning";
}

export function JobProfile({ job }: { job: JobDetailProjection }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const format = { t, locale, timeZone };
  const router = useRouter();
  const flags = jobFlagLabels(job);
  const phaseIndex = jobPhases.findIndex((phase) => phase.id === job.phase);
  const stages = useMemo<WorkflowStage[]>(() => jobPhases.map((phase, index) => ({
    id: phase.id,
    label: t(phase.label as never),
    state: job.phase === "unknown" ? "upcoming" : index < phaseIndex ? "complete" : index === phaseIndex ? (job.flags.blocked.active ? "blocked" : "current") : "upcoming",
  })), [job.flags.blocked.active, job.phase, phaseIndex, t]);
  const sourceColumns = useMemo<DataGridColumn<JobSourceLink>[]>(() => [
    { accessorKey: "type", header: t("Record"), size: 190, meta: { primary: true, renderCell: (link) => <span className={styles.sourceIdentity}><Link2 aria-hidden="true" size={14} /><strong>{t(sourceLabel(link.type))}</strong></span> } },
    { accessorKey: "sourceState", header: t("State"), size: 130, meta: { renderCell: (link) => <Badge tone={sourceTone(link)}>{link.status === "detached" ? t("Detached") : link.sourceState === "available" ? t("Available") : t("Missing")}</Badge> } },
    { accessorKey: "version", header: t("Version"), size: 95, meta: { align: "center", mobileHidden: true, renderCell: (link) => `v${link.version}` } },
    { id: "open", header: "", size: 110, enableSorting: false, meta: { align: "end", renderCell: (link) => sourceRoute(link) ? <Button aria-label={t("Open {record}", { record: t(sourceLabel(link.type)) })} onPress={() => router.push(sourceRoute(link)!)} size="compact" variant="quiet">{t("Open")}<ExternalLink aria-hidden="true" size={13} /></Button> : <span className={styles.muted}>{t("Unavailable")}</span> } },
  ], [router, t]);
  const activity = job.timeline.map((event) => ({
    id: event.id,
    actor: event.actor?.name ?? t("System"),
    action: event.title.toLocaleLowerCase(),
    target: event.detail ?? (event.source ? `${event.source.type} v${event.source.version}` : undefined),
    occurredAt: dateLabel(format, event.occurredAt, true),
    kind: event.kind === "stage" ? "change" as const : event.kind === "source_link" ? "assignment" as const : "change" as const,
  }));
  const clientActivity = clientTimelineItems(job.clientTimeline ?? [], job.customer?.name);

  return <Container as="section" className={styles.page} size="full">
    <Stack gap={5}>
      <Button className={styles.back} onPress={() => router.push("/workspace/crm/jobs")} size="compact" variant="quiet"><ArrowLeft aria-hidden="true" size={14} />{t("Jobs")}</Button>
      <PageHeader
        actions={job.nextAction ? <Button onPress={() => router.push(job.nextAction!.route)} variant="primary">{t("Open next action")}<ArrowRight aria-hidden="true" size={15} /></Button> : undefined}
        description={job.customer?.name ?? t("Customer not linked")}
        eyebrow={job.reference}
        title={job.title ?? t("Untitled Job")}
      />

      {job.accessLimited ? <Callout title={t("Some Job details are hidden")} tone="warning">{t("Your role cannot access every linked source, so phase and next action may be unavailable.")}</Callout> : null}

      <Surface as="section" className={styles.phase} tone="subtle">
        <Inline gap={3}>
          <Badge tone={job.phase === "unknown" ? "neutral" : "info"}>{t(jobPhaseLabel(job.phase) as never)}</Badge>
          <Text size="xs" tone="muted">{t("Stage: {stage}", { stage: job.stage.label })}</Text>
          {job.stage.manual ? <Badge>{t("Manual · v{version}", { version: job.stage.version })}</Badge> : null}
        </Inline>
        <StageTracker ariaLabel={t("Job phases")} stages={stages} />
      </Surface>

      <Grid gap={5} min={320}>
        <Surface as="section" className={styles.panel} tone="raised">
          <Stack gap={4}>
            <Inline gap={2}><CalendarClock aria-hidden="true" size={16} /><Heading as="h2" size="sm">{t("Next action")}</Heading></Inline>
            {job.nextAction ? <>
              <Heading as="h3" size="md">{job.nextAction.title}</Heading>
              <Text tone="muted">{job.nextAction.reason}</Text>
              <div className={styles.properties}>
                <PropertyRow label={t("Owner")}><span>{job.nextAction.owner?.name ?? job.owner?.name ?? t("Unassigned")}</span></PropertyRow>
                <PropertyRow label={t("Due")}><span>{dateLabel(format, job.nextAction.dueAt, true)}</span></PropertyRow>
                <PropertyRow label={t("Source")}><span>{job.nextAction.source.type} · v{job.nextAction.source.version}</span></PropertyRow>
              </div>
            </> : <EmptyState description={t("The current source records do not have an action due.")} title={t("No next action")} />}
          </Stack>
        </Surface>

        <Surface as="section" className={styles.panel} tone="raised">
          <Stack gap={4}>
            <Inline gap={2}><UserRound aria-hidden="true" size={16} /><Heading as="h2" size="sm">{t("Operating state")}</Heading></Inline>
            <Inline gap={2}><Badge tone={jobStateTone(job)}>{t(jobStateLabel(job) as never)}</Badge>{flags.slice(1).map((flag) => <Badge key={flag} tone="warning">{t(flag as never)}</Badge>)}</Inline>
            <div className={styles.properties}>
              <PropertyRow label={t("Job owner")}><span>{job.owner?.name ?? t("Unassigned")}</span></PropertyRow>
              <PropertyRow label={t("Target")}><span>{dateLabel(format, job.targetDate)}</span></PropertyRow>
              <PropertyRow label={t("Customer")}><span>{job.customer?.name ?? t("Not linked")}</span></PropertyRow>
              {job.stage.reason ? <PropertyRow label={t("Stage reason")}><span>{job.stage.reason}</span></PropertyRow> : null}
            </div>
          </Stack>
        </Surface>
      </Grid>

      <Stack as="section" gap={3}>
        <div className={styles.sectionHeading}><div><Heading as="h2">{t("Linked work")}</Heading><Text size="xs" tone="muted">{t("Source systems keep ownership of their facts. This Job only connects them.")}</Text></div><Badge>{job.links.length}</Badge></div>
        <DataGrid
          ariaLabel={t("Linked Job records")}
          columns={sourceColumns}
          data={job.links}
          emptyDescription={t("Source records will appear here when work is linked to this Job.")}
          emptyTitle={t("No linked records")}
          getRowId={(link) => `${link.type}-${link.id}`}
          rowNumbers={false}
          selectable={false}
          showToolbar={false}
        />
      </Stack>

      <Stack as="section" gap={3}>
        <div className={styles.sectionHeading}><div><Heading as="h2">{t("Client timeline")}</Heading><Text size="xs" tone="muted">{t("Messages, portal decisions, calls and notes in one evidence trail.")}</Text></div></div>
        {job.clientTimelineAccess && (!job.clientTimelineAccess.communications || !job.clientTimelineAccess.activities) ? <Callout title={t("Timeline access is limited")} tone="warning">{t("Some communication or activity records are hidden by your role.")}</Callout> : null}
        {clientActivity.length ? <ActivityFeed items={clientActivity} /> : <EmptyState description={t("Messages, portal decisions and completed client interactions will appear here.")} title={t("No client communication yet")} />}
      </Stack>

      <Stack as="section" gap={3}>
        <div className={styles.sectionHeading}><div><Heading as="h2">{t("Timeline")}</Heading><Text size="xs" tone="muted">{t("Permission-filtered source, link and stage history.")}</Text></div></div>
        {activity.length ? <ActivityFeed items={activity} /> : <EmptyState description={t("Linked source and stage changes will appear here.")} title={t("No timeline events")} />}
      </Stack>
    </Stack>
  </Container>;
}
