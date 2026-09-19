"use client";

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
import styles from "./jobs.module.css";

function dateLabel(value: string | null, withTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Asia/Dubai",
  }).format(new Date(value));
}

function sourceTone(link: JobSourceLink): "neutral" | "success" | "warning" {
  if (link.status === "detached") return "neutral";
  return link.sourceState === "available" ? "success" : "warning";
}

export function JobProfile({ job }: { job: JobDetailProjection }) {
  const router = useRouter();
  const flags = jobFlagLabels(job);
  const phaseIndex = jobPhases.findIndex((phase) => phase.id === job.phase);
  const stages = useMemo<WorkflowStage[]>(() => jobPhases.map((phase, index) => ({
    id: phase.id,
    label: phase.label,
    state: job.phase === "unknown" ? "upcoming" : index < phaseIndex ? "complete" : index === phaseIndex ? (job.flags.blocked.active ? "blocked" : "current") : "upcoming",
  })), [job.flags.blocked.active, job.phase, phaseIndex]);
  const sourceColumns = useMemo<DataGridColumn<JobSourceLink>[]>(() => [
    { accessorKey: "type", header: "Record", size: 190, meta: { primary: true, renderCell: (link) => <span className={styles.sourceIdentity}><Link2 aria-hidden="true" size={14} /><strong>{sourceLabel(link.type)}</strong></span> } },
    { accessorKey: "sourceState", header: "State", size: 130, meta: { renderCell: (link) => <Badge tone={sourceTone(link)}>{link.status === "detached" ? "Detached" : link.sourceState === "available" ? "Available" : "Missing"}</Badge> } },
    { accessorKey: "version", header: "Version", size: 95, meta: { align: "center", mobileHidden: true, renderCell: (link) => `v${link.version}` } },
    { id: "open", header: "", size: 110, enableSorting: false, meta: { align: "end", renderCell: (link) => sourceRoute(link) ? <Button aria-label={`Open ${sourceLabel(link.type)}`} onPress={() => router.push(sourceRoute(link)!)} size="compact" variant="quiet">Open<ExternalLink aria-hidden="true" size={13} /></Button> : <span className={styles.muted}>Unavailable</span> } },
  ], [router]);
  const activity = job.timeline.map((event) => ({
    id: event.id,
    actor: event.actor?.name ?? "System",
    action: event.title.toLocaleLowerCase(),
    target: event.detail ?? (event.source ? `${event.source.type} v${event.source.version}` : undefined),
    occurredAt: dateLabel(event.occurredAt, true),
    kind: event.kind === "stage" ? "change" as const : event.kind === "source_link" ? "assignment" as const : "change" as const,
  }));
  const clientActivity = clientTimelineItems(job.clientTimeline ?? [], job.customer?.name);

  return <Container as="section" className={styles.page} size="full">
    <Stack gap={5}>
      <Button className={styles.back} onPress={() => router.push("/workspace/crm/jobs")} size="compact" variant="quiet"><ArrowLeft aria-hidden="true" size={14} />Jobs</Button>
      <PageHeader
        actions={job.nextAction ? <Button onPress={() => router.push(job.nextAction!.route)} variant="primary">Open next action<ArrowRight aria-hidden="true" size={15} /></Button> : undefined}
        description={job.customer?.name ?? "Customer not linked"}
        eyebrow={job.reference}
        title={job.title ?? "Untitled Job"}
      />

      {job.accessLimited ? <Callout title="Some Job details are hidden" tone="warning">Your role cannot access every linked source, so phase and next action may be unavailable.</Callout> : null}

      <Surface as="section" className={styles.phase} tone="subtle">
        <Inline gap={3}>
          <Badge tone={job.phase === "unknown" ? "neutral" : "info"}>{jobPhaseLabel(job.phase)}</Badge>
          <Text size="xs" tone="muted">Stage: {job.stage.label}</Text>
          {job.stage.manual ? <Badge>Manual · v{job.stage.version}</Badge> : null}
        </Inline>
        <StageTracker ariaLabel="Job phases" stages={stages} />
      </Surface>

      <Grid gap={5} min={320}>
        <Surface as="section" className={styles.panel} tone="raised">
          <Stack gap={4}>
            <Inline gap={2}><CalendarClock aria-hidden="true" size={16} /><Heading as="h2" size="sm">Next action</Heading></Inline>
            {job.nextAction ? <>
              <Heading as="h3" size="md">{job.nextAction.title}</Heading>
              <Text tone="muted">{job.nextAction.reason}</Text>
              <div className={styles.properties}>
                <PropertyRow label="Owner"><span>{job.nextAction.owner?.name ?? job.owner?.name ?? "Unassigned"}</span></PropertyRow>
                <PropertyRow label="Due"><span>{dateLabel(job.nextAction.dueAt, true)}</span></PropertyRow>
                <PropertyRow label="Source"><span>{job.nextAction.source.type} · v{job.nextAction.source.version}</span></PropertyRow>
              </div>
            </> : <EmptyState description="The current source records do not have an action due." title="No next action" />}
          </Stack>
        </Surface>

        <Surface as="section" className={styles.panel} tone="raised">
          <Stack gap={4}>
            <Inline gap={2}><UserRound aria-hidden="true" size={16} /><Heading as="h2" size="sm">Operating state</Heading></Inline>
            <Inline gap={2}><Badge tone={jobStateTone(job)}>{jobStateLabel(job)}</Badge>{flags.slice(1).map((flag) => <Badge key={flag} tone="warning">{flag}</Badge>)}</Inline>
            <div className={styles.properties}>
              <PropertyRow label="Job owner"><span>{job.owner?.name ?? "Unassigned"}</span></PropertyRow>
              <PropertyRow label="Target"><span>{dateLabel(job.targetDate)}</span></PropertyRow>
              <PropertyRow label="Customer"><span>{job.customer?.name ?? "Not linked"}</span></PropertyRow>
              {job.stage.reason ? <PropertyRow label="Stage reason"><span>{job.stage.reason}</span></PropertyRow> : null}
            </div>
          </Stack>
        </Surface>
      </Grid>

      <Stack as="section" gap={3}>
        <div className={styles.sectionHeading}><div><Heading as="h2">Linked work</Heading><Text size="xs" tone="muted">Source systems keep ownership of their facts. This Job only connects them.</Text></div><Badge>{job.links.length}</Badge></div>
        <DataGrid
          ariaLabel="Linked Job records"
          columns={sourceColumns}
          data={job.links}
          emptyDescription="Source records will appear here when work is linked to this Job."
          emptyTitle="No linked records"
          getRowId={(link) => `${link.type}-${link.id}`}
          rowNumbers={false}
          selectable={false}
          showToolbar={false}
        />
      </Stack>

      <Stack as="section" gap={3}>
        <div className={styles.sectionHeading}><div><Heading as="h2">Client timeline</Heading><Text size="xs" tone="muted">Messages, portal decisions, calls and notes in one evidence trail.</Text></div></div>
        {job.clientTimelineAccess && (!job.clientTimelineAccess.communications || !job.clientTimelineAccess.activities) ? <Callout title="Timeline access is limited" tone="warning">Some communication or activity records are hidden by your role.</Callout> : null}
        {clientActivity.length ? <ActivityFeed items={clientActivity} /> : <EmptyState description="Messages, portal decisions and completed client interactions will appear here." title="No client communication yet" />}
      </Stack>

      <Stack as="section" gap={3}>
        <div className={styles.sectionHeading}><div><Heading as="h2">Timeline</Heading><Text size="xs" tone="muted">Permission-filtered source, link and stage history.</Text></div></div>
        {activity.length ? <ActivityFeed items={activity} /> : <EmptyState description="Linked source and stage changes will appear here." title="No timeline events" />}
      </Stack>
    </Stack>
  </Container>;
}
