import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { Handover, ProjectData, Snag } from "./execution.types";

type CoverageInput = {
  handoverId: string;
  area: string;
  taskId?: string;
  onDate: string;
};

/**
 * Warranty is a continuation of an accepted area packet, never a second,
 * hand-entered project closeout record. This deliberately returns only facts
 * useful to the caller; it does not decide whether the contractor is liable.
 */
export function assertWarrantyCoverage(
  data: ProjectData,
  input: CoverageInput,
): Handover {
  const handover = data.handovers.find((item) => item.id === input.handoverId);
  if (!handover) throw new NotFoundException("Accepted handover was not found.");
  if (handover.status !== "accepted")
    throw new ConflictException("Report a warranty defect only against an accepted handover.");
  if (!handover.warrantyUntil)
    throw new ConflictException("This accepted handover has no recorded warranty coverage.");
  if (input.onDate > handover.warrantyUntil)
    throw new ConflictException("This handover's warranty coverage has ended. Record a new client request instead.");
  if (input.area !== handover.area)
    throw new BadRequestException("Use the accepted handover area.");

  if (input.taskId) {
    const task = data.tasks.find((item) => item.id === input.taskId);
    if (!task) throw new NotFoundException("Warranty work item was not found.");
    const acceptedTaskIds = handover.packet?.tasks.map((item) => item.id)
      ?? handover.taskIds;
    if (!acceptedTaskIds.includes(task.id) || task.area !== handover.area)
      throw new BadRequestException("Choose work covered by this accepted handover.");
  }
  return handover;
}

export function warrantyOwnerId(data: ProjectData) {
  const owner = data.initiation?.baseline?.projectOwnerId
    ?? data.roleAssignments?.find((assignment) => assignment.role === "project_manager")?.memberId
    ?? data.controls?.nextActionOwnerId;
  if (!owner)
    throw new ConflictException("Assign a project manager before client warranty reporting is enabled.");
  return owner;
}

export function addClientWarrantyClaim(
  data: ProjectData,
  input: {
    id: string;
    challengeId: string;
    handoverId: string;
    title: string;
    detail: string;
    severity: Snag["severity"];
    reportedBy: string;
    reportedAt: string;
    reportedDate: string;
    ownerId: string;
  },
) {
  const replay = data.snags.find(
    (item) => item.warrantyClaimChallengeId === input.challengeId,
  );
  if (replay) return { claim: replay, replayed: true };

  const handover = assertWarrantyCoverage(data, {
    handoverId: input.handoverId,
    area: data.handovers.find((item) => item.id === input.handoverId)?.area ?? "",
    onDate: input.reportedDate,
  });
  const claim: Snag = {
    id: input.id,
    handoverId: handover.id,
    title: input.title,
    taskId: "",
    area: handover.area,
    ownerId: input.ownerId,
    severity: input.severity,
    dueDate: input.reportedDate,
    status: "open",
    evidence: "Client portal warranty report",
    resolution: "",
    reportedAt: input.reportedAt,
    reportedBy: input.reportedBy,
    reportedVia: "client_portal",
    clientNote: input.detail,
    warrantyClaimChallengeId: input.challengeId,
  };
  data.snags.push(claim);
  return { claim, replayed: false };
}
