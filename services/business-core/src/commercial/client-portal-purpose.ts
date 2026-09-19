export type PortalChallengePurpose =
  | {
      kind: "decision" | "design-decision" | "material-decision" | "definition-decision";
      caseId: string;
      recordId: string;
      decision: "accept" | "changes" | "decline";
    }
  | {
      kind: "handover-decision";
      caseId: string;
      projectId: string;
      handoverId: string;
      decision: "accept" | "changes";
    }
  | {
      kind: "warranty-claim";
      caseId: string;
      projectId: string;
      handoverId: string;
    };

/** Parses only structurally valid, purpose-bound portal OTP challenges. */
export function parsePortalChallengePurpose(value: string): PortalChallengePurpose | null {
  const parts = value.split(":");
  const decisionKinds = ["decision", "design-decision", "material-decision", "definition-decision"] as const;
  if (
    parts.length === 4 &&
    decisionKinds.includes(parts[0] as typeof decisionKinds[number]) &&
    ["accept", "changes", "decline"].includes(parts[3])
  ) {
    const kind = parts[0] as typeof decisionKinds[number];
    const decision = parts[3] as "accept" | "changes" | "decline";
    if (
      (["material-decision", "definition-decision"] as string[]).includes(kind) &&
      decision === "decline"
    ) return null;
    return { kind, caseId: parts[1], recordId: parts[2], decision };
  }
  if (parts.length === 5 && parts[0] === "handover-decision" && ["accept", "changes"].includes(parts[4]))
    return {
      kind: "handover-decision",
      caseId: parts[1],
      projectId: parts[2],
      handoverId: parts[3],
      decision: parts[4] as "accept" | "changes",
    };
  if (parts.length === 4 && parts[0] === "warranty-claim")
    return { kind: "warranty-claim", caseId: parts[1], projectId: parts[2], handoverId: parts[3] };
  return null;
}
