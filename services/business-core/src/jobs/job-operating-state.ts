export const jobPhases = [
  "intake", "qualify", "discover", "design_scope", "price",
  "agree", "release", "deliver", "handover", "aftercare",
] as const;
export type JobPhase = typeof jobPhases[number];
export type JobFlagKind = "blocked" | "awaiting_client" | "at_risk";
export type JobSourcePointer = { type: string; id: string; version: number };
export type JobOwner = { membershipId: string; name: string | null };

export type JobOperatingSource = {
  type: "enquiry" | "lead" | "opportunity" | "case" | "quote" | "project";
  id: string;
  caseId: string | null;
  version: number;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  owner: JobOwner | null;
  nextAction: null | { title: string; dueAt: string | null; reason: string };
  details: Record<string, unknown>;
};

export type JobManualStage = {
  phase: JobPhase;
  stage: string;
  reason: string;
  setBy: string;
  setByName: string | null;
  setAt: string;
  version: number;
};

export type JobFlag = {
  active: boolean;
  reason: string | null;
  source: JobSourcePointer | null;
};

export type JobOperatingState = {
  phase: JobPhase | "unknown";
  phaseSource: JobSourcePointer | null;
  accessLimited: boolean;
  stage: {
    label: string;
    manual: boolean;
    version: number;
    reason: string | null;
    setBy: string | null;
    setByName: string | null;
    setAt: string | null;
  };
  owner: JobOwner | null;
  targetDate: string | null;
  flags: Record<JobFlagKind, JobFlag>;
  nextAction: null | {
    title: string;
    owner: JobOwner | null;
    dueAt: string | null;
    reason: string;
    route: string;
    source: JobSourcePointer;
  };
};

const phaseLabel: Record<JobPhase, string> = {
  intake: "Intake",
  qualify: "Qualification",
  discover: "Discovery",
  design_scope: "Design & scope",
  price: "Pricing",
  agree: "Agreement",
  release: "Release",
  deliver: "Delivery",
  handover: "Handover",
  aftercare: "Aftercare",
};

const sourceRank: Record<JobOperatingSource["type"], number> = {
  enquiry: 1, lead: 2, opportunity: 3, case: 4, quote: 5, project: 6,
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function sourcePointer(source: JobOperatingSource): JobSourcePointer {
  return { type: source.type, id: source.id, version: source.version };
}

function route(source: JobOperatingSource): string {
  if (source.type === "enquiry") return "/workspace/crm/leads";
  if (source.type === "lead") return `/workspace/crm/leads?lead=${source.id}`;
  if (source.type === "opportunity") return `/workspace/crm/opportunities?record=${source.id}`;
  if (source.type === "case") return `/workspace/pre-projects/cases/${source.id}/overview`;
  if (source.type === "quote")
    return `/workspace/pre-projects/cases/${source.caseId ?? "unknown"}/quotations?quote=${source.id}`;
  return `/workspace/projects/${source.id}`;
}

function evidencePhase(source: JobOperatingSource): JobPhase {
  if (source.type === "enquiry") return "intake";
  if (source.type === "lead")
    return source.status === "qualified" ? "discover" : "qualify";
  if (source.type === "opportunity") return "discover";
  if (source.type === "quote") {
    if (source.status === "accepted") return "agree";
    return "price";
  }
  if (source.type === "case") {
    if (source.status === "released" || source.details.phase === "release") return "release";
    const phase = text(source.details.phase);
    if (phase === "price") return "price";
    if (phase === "agree") return "agree";
    if (phase === "define" || phase === "design") return "design_scope";
    return "discover";
  }
  const phase = text(source.details.phase);
  if (source.status === "completed" || phase === "completed") return "aftercare";
  if (phase === "handover") return "handover";
  return "deliver";
}

function phaseRank(phase: JobPhase): number {
  return jobPhases.indexOf(phase);
}

function bestSource(sources: JobOperatingSource[]): JobOperatingSource | undefined {
  return [...sources].sort((a, b) => {
    const byPhase = phaseRank(evidencePhase(b)) - phaseRank(evidencePhase(a));
    return byPhase || sourceRank[b.type] - sourceRank[a.type];
  })[0];
}

function flag(
  source: JobOperatingSource | undefined,
  reason: string | null,
): JobFlag {
  return source && reason
    ? { active: true, reason, source: sourcePointer(source) }
    : { active: false, reason: null, source: null };
}

function inPhase(sources: JobOperatingSource[], phase: JobPhase): JobOperatingSource[] {
  return sources.filter((item) => evidencePhase(item) === phase);
}

function blocked(sources: JobOperatingSource[], phase: JobPhase): { source?: JobOperatingSource; reason: string | null } {
  const current = inPhase(sources, phase);
  const project = current.find((item) => item.type === "project" && (
    bool(item.details.onHold) || bool(item.details.hasBlockedWork)
  ));
  if (project) return { source: project, reason: text(project.details.holdReason) ?? "Delivery work is blocked." };
  const caseSource = current.find((item) => item.type === "case" && item.status === "on_hold");
  if (caseSource) return { source: caseSource, reason: text(caseSource.details.holdReason) ?? "Pre-execution is on hold." };
  const lead = current.find((item) => item.type === "lead" && item.status === "paused");
  if (lead) return { source: lead, reason: text(lead.details.pausedReason) ?? "Lead follow-up is paused." };
  return { reason: null };
}

function awaitingClient(sources: JobOperatingSource[], phase: JobPhase): { source?: JobOperatingSource; reason: string | null } {
  const current = inPhase(sources, phase);
  const quote = [...current].reverse().find((item) => item.type === "quote" && item.status === "issued");
  if (quote) return { source: quote, reason: "Client quotation decision is pending." };
  const project = current.find((item) => item.type === "project" && bool(item.details.awaitingClient));
  if (project) return { source: project, reason: text(project.details.awaitingClientReason) ?? "A client decision is pending." };
  return { reason: null };
}

function atRisk(sources: JobOperatingSource[], phase: JobPhase, now: Date): { source?: JobOperatingSource; reason: string | null } {
  const current = inPhase(sources, phase);
  const explicit = current.find((item) => {
    const risk = text(item.details.risk);
    return risk === "high" || risk === "critical" || risk === "urgent_action" || risk === "high_risk" || risk === "blocked";
  });
  if (explicit) return { source: explicit, reason: `Risk is ${text(explicit.details.risk)?.replaceAll("_", " ")}.` };
  const overdue = current
    .filter((item) => item.nextAction?.dueAt && Date.parse(item.nextAction.dueAt) < now.getTime())
    .sort((a, b) => Date.parse(a.nextAction!.dueAt!) - Date.parse(b.nextAction!.dueAt!))[0];
  if (overdue) return { source: overdue, reason: `Next action was due ${overdue.nextAction!.dueAt}.` };
  return { reason: null };
}

function defaultAction(phase: JobPhase, source: JobOperatingSource): { title: string; reason: string } {
  const values: Record<JobPhase, { title: string; reason: string }> = {
    intake: { title: "Review the enquiry", reason: "Confirm the request and assign qualification ownership." },
    qualify: { title: "Qualify the enquiry", reason: "Record contact, fit and the next customer commitment." },
    discover: { title: "Complete discovery", reason: "Confirm the brief, decision-makers, budget and timing." },
    design_scope: { title: "Progress design and scope", reason: "Turn approved discovery into reviewable scope evidence." },
    price: { title: "Prepare the commercial decision", reason: "Complete pricing and issue the next reviewable quotation." },
    agree: { title: "Close the agreement", reason: "Capture the client decision and required commercial evidence." },
    release: { title: "Complete release readiness", reason: "Satisfy finance and approval gates before delivery starts." },
    deliver: { title: "Progress delivery", reason: "Complete the highest-priority safe delivery action." },
    handover: { title: "Complete handover", reason: "Close acceptance, outstanding work and client documentation." },
    aftercare: { title: "Review aftercare", reason: "Track open warranty and post-handover commitments." },
  };
  void source;
  return values[phase];
}

export function deriveJobOperatingState(input: {
  sources: JobOperatingSource[];
  hiddenSourceCount?: number;
  manualStage?: JobManualStage | null;
  now?: Date;
}): JobOperatingState {
  const now = input.now ?? new Date();
  const accessLimited = (input.hiddenSourceCount ?? 0) > 0;
  const source = bestSource(input.sources);
  const phase = accessLimited || !source ? "unknown" : evidencePhase(source);

  if (phase === "unknown" || !source) {
    return {
      phase: "unknown",
      phaseSource: null,
      accessLimited,
      stage: { label: "Unknown", manual: false, version: 0, reason: accessLimited ? "Additional source access is required." : null, setBy: null, setByName: null, setAt: null },
      owner: null,
      targetDate: null,
      flags: {
        blocked: flag(undefined, null),
        awaiting_client: flag(undefined, null),
        at_risk: flag(undefined, null),
      },
      nextAction: null,
    };
  }

  const block = blocked(input.sources, phase);
  const waiting = awaitingClient(input.sources, phase);
  const risk = atRisk(input.sources, phase, now);
  const flags = {
    blocked: flag(block.source, block.reason),
    awaiting_client: flag(waiting.source, waiting.reason),
    at_risk: flag(risk.source, risk.reason),
  } satisfies Record<JobFlagKind, JobFlag>;
  const stage = input.manualStage?.phase === phase ? input.manualStage : null;
  const blockedAction = block.source && block.reason
    ? { source: block.source, title: block.reason, reason: "Resolve the blocker before progressing the Job." }
    : null;
  const waitingAction = waiting.source && waiting.reason
    ? { source: waiting.source, title: "Get the client decision", reason: waiting.reason }
    : null;
  const explicit = input.sources
    .filter((item) => item.nextAction && evidencePhase(item) === phase)
    .sort((a, b) => {
      const left = a.nextAction?.dueAt ? Date.parse(a.nextAction.dueAt) : Number.MAX_SAFE_INTEGER;
      const right = b.nextAction?.dueAt ? Date.parse(b.nextAction.dueAt) : Number.MAX_SAFE_INTEGER;
      return left - right || sourceRank[b.type] - sourceRank[a.type];
    })[0];
  const selected = blockedAction ?? waitingAction ?? (explicit ? {
    source: explicit,
    title: explicit.nextAction!.title,
    reason: explicit.nextAction!.reason,
  } : { source, ...defaultAction(phase, source) });
  const targetDate = text(selected.source.details.targetDate)
    ?? selected.source.nextAction?.dueAt
    ?? null;

  return {
    phase,
    phaseSource: sourcePointer(source),
    accessLimited,
    stage: stage ? {
      label: stage.stage, manual: true, version: stage.version, reason: stage.reason,
      setBy: stage.setBy, setByName: stage.setByName, setAt: stage.setAt,
    } : {
      label: phaseLabel[phase], manual: false, version: 0, reason: null,
      setBy: null, setByName: null, setAt: null,
    },
    owner: selected.source.nextAction ? selected.source.owner : (selected.source.owner ?? source.owner),
    targetDate,
    flags,
    nextAction: {
      title: selected.title,
      owner: selected.source.owner,
      dueAt: selected.source.nextAction?.dueAt ?? targetDate,
      reason: selected.reason,
      route: route(selected.source),
      source: sourcePointer(selected.source),
    },
  };
}
