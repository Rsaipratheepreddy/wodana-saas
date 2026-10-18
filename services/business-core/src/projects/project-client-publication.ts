import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ExecutionActor } from "./execution.domain";
import type { ProjectClientSections, ProjectClientUpdate, ProjectData, PublicProjectClientUpdate } from "./execution.types";

const sections = ["progress", "documents", "handover", "updates"] as const;
const kinds = ["progress", "delay", "issue", "delivery", "general"] as const;
const sources = ["task", "report", "order", "dispatch", "snag"] as const;
const text = (value: unknown, limit: number, required = false) => {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string" || value.length > limit || (required && !value.trim()))
    throw new BadRequestException("Enter valid client update details.");
  return value.trim();
};

export function projectClientSections(data: ProjectData): ProjectClientSections {
  return Object.fromEntries(sections.map(key => [key, data.clientSections?.[key] !== false])) as ProjectClientSections;
}

function assertSource(data: ProjectData, update: Pick<ProjectClientUpdate, "kind" | "sourceType" | "sourceId">) {
  if (!update.sourceType && !update.sourceId && update.kind === "general") return;
  if (!update.sourceType || !sources.includes(update.sourceType) || !update.sourceId)
    throw new BadRequestException("Link this update to a project record.");
  const records = { task: data.tasks, report: data.reports, order: data.orders, dispatch: data.dispatches ?? [], snag: data.snags };
  if (!records[update.sourceType].some(record => record.id === update.sourceId))
    throw new BadRequestException("Choose a source record from this project.");
}

export function publicProjectUpdates(data: ProjectData): PublicProjectClientUpdate[] {
  if (!projectClientSections(data).updates) return [];
  return (data.clientUpdates ?? []).filter(update => update.status === "published" && update.publishedAt).map(update => ({
    id: update.id, title: update.title, summary: update.summary, kind: update.kind,
    ...(update.sourceType && update.sourceId ? { sourceType: update.sourceType, sourceId: update.sourceId } : {}),
    status: "published", publishedAt: update.publishedAt!, revision: update.revision,
  }));
}

/** Existing execution transaction owns project authorization, revision locks and audit. */
export function applyClientPublication(data: ProjectData, action: string, body: Record<string, unknown>, actor: ExecutionActor): string | undefined {
  if (!["client_update_save", "client_update_submit", "client_update_publish", "client_update_withdraw", "client_sections_save"].includes(action)) return undefined;
  const review = () => { if (!actor.review) throw new ForbiddenException("A designated reviewer must approve client publication."); };
  const author = (update?: ProjectClientUpdate) => {
    if (!actor.report && !actor.manage) throw new ForbiddenException("Project reporting permission is required.");
    if (update && update.authorId !== actor.id && !actor.manage) throw new ForbiddenException("Only the author or project manager can change this update.");
  };
  if (action === "client_sections_save") {
    review();
    const value = body.sections;
    if (!value || typeof value !== "object" || sections.some(key => typeof (value as Record<string, unknown>)[key] !== "boolean"))
      throw new BadRequestException("Choose visibility for every client section.");
    data.clientSections = Object.fromEntries(sections.map(key => [key, (value as Record<string, unknown>)[key]])) as ProjectClientSections;
    return "client-sections";
  }
  if (action === "client_update_save") {
    author();
    if (!body.update || typeof body.update !== "object" || Array.isArray(body.update)) throw new BadRequestException("Enter client update details.");
    const value = body.update as Record<string, unknown>;
    const id = text(value.id, 80);
    const old = id ? data.clientUpdates?.find(update => update.id === id) : undefined;
    if (id && !old) throw new NotFoundException("Client update not found.");
    author(old);
    if (old?.status === "published") throw new ConflictException("Withdraw the published update before changing it.");
    if (!kinds.includes(value.kind as ProjectClientUpdate["kind"])) throw new BadRequestException("Choose a valid client update kind.");
    const sourceType = text(value.sourceType, 20) as ProjectClientUpdate["sourceType"];
    const sourceId = text(value.sourceId, 80);
    const update: ProjectClientUpdate = {
      id: old?.id ?? randomUUID(), title: text(value.title, 160, true), summary: text(value.summary, 4000, true),
      kind: value.kind as ProjectClientUpdate["kind"], ...(sourceType ? {sourceType} : {}), ...(sourceId ? {sourceId} : {}),
      status: "draft", authorId: actor.id, at: actor.now, revision: (old?.revision ?? 0) + 1,
    };
    // The person changing the approved wording becomes its author, preventing self-review through a manager edit.
    assertSource(data, update);
    if (old) {
      (data.clientUpdateHistory ??= []).push({ ...old, archivedAt: actor.now, archivedBy: actor.id });
      data.clientUpdates = data.clientUpdates!.map(item => item.id === old.id ? update : item);
    }
    else (data.clientUpdates ??= []).push(update);
    return update.id;
  }
  const id = text(body.id, 80, true);
  const update = data.clientUpdates?.find(item => item.id === id);
  if (!update) throw new NotFoundException("Client update not found.");
  if (action === "client_update_submit") {
    author(update);
    if (update.status !== "draft") throw new ConflictException("Save a draft before submitting it for review.");
    assertSource(data, update);
    update.status = "submitted";
  } else if (action === "client_update_publish") {
    review();
    if (update.status !== "submitted") throw new ConflictException("Submit the update for review before publishing.");
    if (update.authorId === actor.id) throw new ForbiddenException("Another reviewer must publish your client update.");
    assertSource(data, update);
    update.status = "published"; update.reviewerId = actor.id; update.publishedAt = actor.now;
  } else {
    review();
    if (update.status !== "published") throw new ConflictException("Only a published client update can be withdrawn.");
    update.status = "withdrawn";
  }
  return update.id;
}
