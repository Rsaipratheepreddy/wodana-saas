import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { CrmEventsService } from "../crm/shared/crm-events.service";
import { canonicalHash } from "../crm/shared/crm-types";
import type { DefinitionSourceItem, DefinitionSourceSnapshot } from "../pre-projects/pre-project-definition";
import { PreProjectDefinitionService } from "../pre-projects/pre-project-definition.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CatalogSellingPriceService } from "./catalog-selling-price.service";
import { importedScopeCatalogLinks, importedScopeDetails } from "./commercial-scope";
import { object, text } from "./commercial.domain";
import { CommercialService } from "./commercial.service";
import type {
  CatalogPriceSnapshot,
  CatalogSelection,
  CommercialData,
  Quote,
  QuoteLine,
} from "./commercial.types";
import {
  compareQuotationRevisions,
  mergeQuotationProposal,
  quotationComposerReadiness,
  quotationLineIdentities,
  quoteDraftHash,
  type QuotationProposal,
  type QuotationProposalItem,
  type QuotationProposalMode,
} from "./quotation-composer";

type DefinitionContext = {
  id: string;
  number: number;
  sourceHash: string;
  snapshotHash: string;
  snapshot: DefinitionSourceSnapshot;
};

type Ref = { role: string; id: string; version: number };
type Seed = {
  roomName: string;
  roomRef?: Ref;
  refs: Ref[];
  sourceIds: string[];
  reason: string;
  sourceItem?: DefinitionSourceItem;
};
type CatalogRecord = CatalogSelection["snapshot"];
type RunRow = {
  id: string;
  quoteId: string;
  mode: QuotationProposalMode;
  status: "proposed" | "applied" | "dismissed";
  commercialRevision: number;
  quoteDraftHash: string;
  definitionBaselineId: string;
  definitionSnapshotHash: string;
  definitionSourceHash: string;
  proposalHash: string;
  proposal: QuotationProposal;
  createdAt: Date | string;
  createdBy: string;
  appliedAt: Date | string | null;
  appliedBy: string | null;
  appliedRevision: number | null;
  dismissedAt: Date | string | null;
  dismissedBy: string | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown, label: string) {
  const result = text(value, 36, true);
  if (!uuidPattern.test(result))
    throw new BadRequestException(`Choose a valid ${label}.`);
  return result;
}

function revision(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 0)
    throw new BadRequestException("Use the current commercial revision.");
  return Number(value);
}

function catalogVersion(value: unknown) {
  const result = revision(value);
  if (result < 1) throw new BadRequestException("Use the current catalog version.");
  return result;
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function optionalObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ref(value: unknown, role: string): Ref | undefined {
  const row = optionalObject(value);
  if (!row) return undefined;
  const id = row.id ?? row.recordId;
  if (id === undefined) return undefined;
  return {
    role,
    id: uuid(id, `${role} catalog item`),
    version: catalogVersion(row.version),
  };
}

const runSelect = `SELECT run.id,run.quote_id AS "quoteId",run.mode,run.status,
 run.commercial_revision AS "commercialRevision",run.quote_draft_hash AS "quoteDraftHash",
 run.definition_baseline_id AS "definitionBaselineId",
 run.definition_snapshot_hash AS "definitionSnapshotHash",
 run.definition_source_hash AS "definitionSourceHash",run.proposal_hash AS "proposalHash",
 run.proposal,run.created_at AS "createdAt",creator.display_name AS "createdBy",
 run.applied_at AS "appliedAt",applier.display_name AS "appliedBy",run.applied_revision AS "appliedRevision",
 run.dismissed_at AS "dismissedAt",dismisser.display_name AS "dismissedBy"
 FROM quotation_proposal_runs run
 JOIN users creator ON creator.id=run.created_by
 LEFT JOIN users applier ON applier.id=run.applied_by
 LEFT JOIN users dismisser ON dismisser.id=run.dismissed_by`;

@Injectable()
export class QuotationComposerService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly commercial: CommercialService,
    private readonly definitions: PreProjectDefinitionService,
    private readonly sellingPrices: CatalogSellingPriceService,
    private readonly events: CrmEventsService,
  ) {}

  get(actor: RequestActor, workspaceId: string, caseId: string, quoteId: string) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "pre_projects.view",
      async (client) => {
        await this.commercial.caseRecord(client, workspaceId, caseId);
        const data = await this.commercial.load(client, workspaceId, caseId);
        const quote = this.quote(data, quoteId);
        const definition = await this.definition(client, workspaceId, caseId, false);
        const runs = await client.query<RunRow>(
          `${runSelect} WHERE run.workspace_id=$1 AND run.case_id=$2 AND run.quote_id=$3
           ORDER BY run.created_at DESC,run.id DESC LIMIT 20`,
          [workspaceId, caseId, quoteId],
        );
        const previous = this.previousQuote(data, quote);
        return {
          quoteId,
          revision: data.revision,
          definition: definition
            ? {
                id: definition.id,
                number: definition.number,
                sourceHash: definition.sourceHash,
                snapshotHash: definition.snapshotHash,
                confirmed: true,
                current: true,
              }
            : null,
          readiness: quotationComposerReadiness(
            quote,
            definition ? { confirmed: true, current: true } : null,
          ),
          comparison: compareQuotationRevisions(quote, previous),
          runs: runs.rows.map((run) => this.present(run, data, quote, definition)),
        };
      },
    );
  }

  create(actor: RequestActor, workspaceId: string, caseId: string, input: unknown) {
    const body = object(input);
    const requestId = uuid(body.requestId, "request ID");
    const quoteId = uuid(body.quoteId, "quotation");
    const commercialRevision = revision(body.revision);
    const mode: QuotationProposalMode =
      body.mode === "scope" || body.mode === "assistant"
        ? body.mode
        : (() => {
            throw new BadRequestException("Choose scope or assistant proposal mode.");
          })();
    const intent = text(body.intent ?? "", 1000);
    if (mode === "assistant" && !intent)
      throw new BadRequestException("Describe what the assistant should prepare.");
    const requestHash = canonicalHash({
      caseId,
      quoteId,
      revision: commercialRevision,
      mode,
      intent,
      proposal: body.proposal ?? null,
    });
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["pre_projects.view", "pre_projects.edit"],
      async (client, user) => {
        await this.commercial.caseRecord(client, workspaceId, caseId, true);
        await this.requestLock(client, workspaceId, requestId);
        const replay = await this.replay(client, workspaceId, requestId, "create", requestHash);
        if (replay) return { ...replay, replayed: true };
        const data = await this.commercial.load(client, workspaceId, caseId);
        if (data.revision !== commercialRevision)
          throw new ConflictException("The quotation changed. Reload before preparing suggestions.");
        const quote = this.quote(data, quoteId);
        this.editableProposalTarget(quote);
        const definition = await this.definition(client, workspaceId, caseId, true);
        const sourceIds = this.authorizedSourceIds(definition.snapshot, intent);
        const seeds =
          mode === "scope"
            ? this.scopeSeeds(definition.snapshot)
            : this.assistantSeeds(body.proposal, definition.snapshot, sourceIds);
        if (!seeds.length)
          throw new BadRequestException(
            mode === "scope"
              ? "The confirmed definition has no included scope to propose."
              : "The assistant returned no valid catalog suggestions.",
          );
        const pricingDate = await this.workspaceDate(client, workspaceId);
        const proposal = await this.buildProposal(
          client,
          workspaceId,
          quote,
          definition,
          mode,
          intent,
          text(optionalObject(body.proposal)?.summary ?? "", 800),
          seeds,
          pricingDate,
        );
        const id = randomUUID();
        const proposalHash = canonicalHash(proposal);
        await client.query(
          `INSERT INTO quotation_proposal_runs
           (id,workspace_id,case_id,quote_id,mode,commercial_revision,quote_draft_hash,
            definition_baseline_id,definition_snapshot_hash,definition_source_hash,
            proposal_hash,proposal,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            id,
            workspaceId,
            caseId,
            quoteId,
            mode,
            data.revision,
            quoteDraftHash(quote),
            definition.id,
            definition.snapshotHash,
            definition.sourceHash,
            proposalHash,
            proposal,
            user.userId,
          ],
        );
        await this.events.record(client, {
          workspaceId,
          actorUserId: user.userId,
          source: "user",
          action: "commercial.quotation_proposal_created.v1",
          entityType: "quotation_proposal_run",
          entityId: id,
          correlationId: requestId,
          after: {
            caseId,
            quoteId,
            mode,
            definitionBaselineId: definition.id,
            proposalHash,
            itemCount: proposal.items.length,
          },
        });
        const response = {
          run: {
            id,
            quoteId,
            mode,
            status: "proposed" as const,
            stale: false,
            staleReasons: [] as string[],
            proposal,
            duplicates: this.duplicates(quote, proposal.items),
            createdAt: new Date().toISOString(),
            createdBy: user.displayName,
          },
          revision: data.revision,
          replayed: false,
        };
        await this.saveCommand(client, workspaceId, caseId, id, requestId, "create", requestHash, response, user.userId);
        return response;
      },
    );
  }

  apply(
    actor: RequestActor,
    workspaceId: string,
    caseId: string,
    runId: string,
    input: unknown,
  ) {
    const body = object(input);
    const requestId = uuid(body.requestId, "request ID");
    const commercialRevision = revision(body.revision);
    if (!Array.isArray(body.selectedItemIds) || body.selectedItemIds.length > 300)
      throw new BadRequestException("Choose up to 300 proposed items.");
    const selectedItemIds = body.selectedItemIds.map((value) => uuid(value, "proposal item"));
    const requestHash = canonicalHash({ runId, revision: commercialRevision, selectedItemIds });
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["pre_projects.view", "pre_projects.edit"],
      async (client, user) => {
        await this.commercial.caseRecord(client, workspaceId, caseId, true);
        await this.requestLock(client, workspaceId, requestId);
        const replay = await this.replay(client, workspaceId, requestId, "apply", requestHash);
        if (replay) return { ...replay, replayed: true };
        const run = await this.run(client, workspaceId, caseId, runId, true);
        if (run.status !== "proposed")
          throw new ConflictException("This proposal is already closed.");
        if (canonicalHash(run.proposal) !== run.proposalHash)
          throw new ConflictException("The saved proposal failed its integrity check.");
        const data = await this.commercial.load(client, workspaceId, caseId);
        if (data.revision !== commercialRevision || data.revision !== run.commercialRevision)
          throw new ConflictException("The quotation changed after this proposal. Prepare it again.");
        const quote = this.quote(data, run.quoteId);
        this.editableProposalTarget(quote);
        if (quoteDraftHash(quote) !== run.quoteDraftHash)
          throw new ConflictException("The quotation changed after this proposal. Prepare it again.");
        const definition = await this.definition(client, workspaceId, caseId, true);
        if (
          definition.id !== run.definitionBaselineId ||
          definition.snapshotHash !== run.definitionSnapshotHash ||
          definition.sourceHash !== run.definitionSourceHash
        )
          throw new ConflictException("The confirmed definition changed. Prepare a new proposal.");
        const refreshed = await this.revalidateProposal(
          client,
          workspaceId,
          quote,
          run.proposal.items,
          await this.workspaceDate(client, workspaceId),
        );
        const merged = mergeQuotationProposal(quote, refreshed, selectedItemIds);
        Object.assign(quote, merged.quote, {
          definitionBaseline: {
            id: definition.id,
            number: definition.number,
            hash: definition.snapshotHash,
          },
        });
        await this.commercial.persist(
          client,
          workspaceId,
          caseId,
          data,
          user.displayName,
          "quotation_proposal_applied",
          quote.id,
          `${merged.added.length} item(s) added; ${merged.skipped.length} duplicate(s) skipped.`,
        );
        await client.query(
          `UPDATE quotation_proposal_runs SET status='applied',applied_by=$4,applied_at=now(),applied_revision=$5
           WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND status='proposed'`,
          [workspaceId, caseId, runId, user.userId, data.revision],
        );
        await this.events.record(client, {
          workspaceId,
          actorUserId: user.userId,
          source: "user",
          action: "commercial.quotation_proposal_applied.v1",
          entityType: "quotation_proposal_run",
          entityId: runId,
          correlationId: requestId,
          after: {
            caseId,
            quoteId: quote.id,
            definitionBaselineId: definition.id,
            addedItemIds: merged.added,
            skippedDuplicateItemIds: merged.skipped,
            commercialRevision: data.revision,
          },
        });
        const response = {
          runId,
          status: "applied" as const,
          addedItemIds: merged.added,
          skippedDuplicateItemIds: merged.skipped,
          revision: data.revision,
          quote,
          readiness: quotationComposerReadiness(quote, { confirmed: true, current: true }),
          replayed: false,
        };
        await this.saveCommand(client, workspaceId, caseId, runId, requestId, "apply", requestHash, response, user.userId);
        return response;
      },
    );
  }

  dismiss(
    actor: RequestActor,
    workspaceId: string,
    caseId: string,
    runId: string,
    input: unknown,
  ) {
    const body = object(input);
    const requestId = uuid(body.requestId, "request ID");
    const requestHash = canonicalHash({ runId });
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["pre_projects.view", "pre_projects.edit"],
      async (client, user) => {
        await this.commercial.caseRecord(client, workspaceId, caseId, true);
        await this.requestLock(client, workspaceId, requestId);
        const replay = await this.replay(client, workspaceId, requestId, "dismiss", requestHash);
        if (replay) return { ...replay, replayed: true };
        const run = await this.run(client, workspaceId, caseId, runId, true);
        if (run.status !== "proposed")
          throw new ConflictException("This proposal is already closed.");
        await client.query(
          `UPDATE quotation_proposal_runs SET status='dismissed',dismissed_by=$4,dismissed_at=now()
           WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND status='proposed'`,
          [workspaceId, caseId, runId, user.userId],
        );
        await this.events.record(client, {
          workspaceId,
          actorUserId: user.userId,
          source: "user",
          action: "commercial.quotation_proposal_dismissed.v1",
          entityType: "quotation_proposal_run",
          entityId: runId,
          correlationId: requestId,
          after: { caseId, quoteId: run.quoteId },
        });
        const response = { runId, status: "dismissed" as const, replayed: false };
        await this.saveCommand(client, workspaceId, caseId, runId, requestId, "dismiss", requestHash, response, user.userId);
        return response;
      },
    );
  }

  private quote(data: CommercialData, quoteId: string) {
    const quote = data.quotes.find((candidate) => candidate.id === quoteId);
    if (!quote) throw new NotFoundException("Quotation not found.");
    return quote;
  }

  private editableProposalTarget(quote: Quote) {
    if (quote.status !== "draft")
      throw new ConflictException("Only a draft quotation can use the composer.");
    if (quote.direction === "deduction")
      throw new ConflictException(
        "Deduction variations must select accepted items instead of generated suggestions.",
      );
  }

  private previousQuote(data: CommercialData, quote: Quote) {
    const family = quote.familyId ?? quote.id;
    return (
      data.quotes
        .filter(
          (candidate) =>
            candidate.id !== quote.id &&
            (candidate.familyId ?? candidate.id) === family &&
            candidate.number < quote.number,
        )
        .sort((left, right) => right.number - left.number)[0] ??
      data.quotes.find((candidate) => candidate.id === quote.baselineId)
    );
  }

  private async definition(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    required: true,
  ): Promise<DefinitionContext>;
  private async definition(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    required: false,
  ): Promise<DefinitionContext | null>;
  private async definition(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    required: boolean,
  ): Promise<DefinitionContext | null> {
    const confirmation = await this.definitions.currentConfirmation(client, workspaceId, caseId);
    if (!confirmation.confirmed || !confirmation.latest?.current || confirmation.latest.status !== "confirmed") {
      if (required)
        throw new ConflictException(
          "Confirm the current requirements and design definition before preparing a quotation proposal.",
        );
      return null;
    }
    const result = await client.query<{
      id: string;
      number: number;
      sourceHash: string;
      snapshotHash: string;
      snapshot: { definition?: DefinitionSourceSnapshot };
    }>(
      `SELECT id,number,source_hash AS "sourceHash",snapshot_hash AS "snapshotHash",snapshot
       FROM pre_project_definition_baselines
       WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,
      [workspaceId, caseId, confirmation.latest.id],
    );
    const row = result.rows[0];
    if (!row?.snapshot?.definition) {
      if (required) throw new ConflictException("The confirmed definition snapshot is unavailable.");
      return null;
    }
    return {
      id: row.id,
      number: Number(row.number),
      sourceHash: row.sourceHash,
      snapshotHash: row.snapshotHash,
      snapshot: row.snapshot.definition,
    };
  }

  private authorizedSourceIds(snapshot: DefinitionSourceSnapshot, intent: string) {
    const ids = new Set<string>([snapshot.caseId, "brief"]);
    if (intent) ids.add("prompt");
    for (const room of snapshot.rooms) ids.add(room.id);
    for (const item of snapshot.items) {
      ids.add(item.id);
      for (const file of item.evidenceFiles) if (typeof file.id === "string") ids.add(file.id);
      for (const design of item.specification?.designs ?? []) {
        if (typeof design.versionId === "string") ids.add(design.versionId);
        if (typeof design.designId === "string") ids.add(design.designId);
      }
    }
    return ids;
  }

  private scopeSeeds(snapshot: DefinitionSourceSnapshot): Seed[] {
    return snapshot.items
      .filter((item) => item.scopeStatus === "included")
      .map((item) => {
        const refs = item.catalog.flatMap((value) => {
          const row = optionalObject(value);
          if (!row || typeof row.role !== "string") return [];
          const parsed = ref({ id: row.recordId, version: row.version }, row.role);
          return parsed ? [parsed] : [];
        });
        return {
          roomName: item.roomName || "General",
          refs,
          sourceIds: [item.id],
          reason: "Included in the confirmed client definition.",
          sourceItem: item,
        };
      });
  }

  private assistantSeeds(
    value: unknown,
    snapshot: DefinitionSourceSnapshot,
    authorizedSourceIds: Set<string>,
  ): Seed[] {
    const proposal = object(value);
    const rooms = list(proposal.rooms);
    if (!rooms.length || rooms.length > 100)
      throw new BadRequestException("Use between 1 and 100 proposed rooms.");
    const sourceItems = new Map<string, DefinitionSourceItem>();
    for (const item of snapshot.items.filter((candidate) => candidate.scopeStatus === "included"))
      for (const sourceId of this.itemSourceIds(item)) sourceItems.set(sourceId, item);
    const proposalSources = this.proposalSourceIds(snapshot);
    const seeds: Seed[] = [];
    for (const roomValue of rooms) {
      const room = object(roomValue);
      const roomName = text(room.name, 120, true);
      const roomRef = ref(room.room, "room");
      const roomSources = this.sourceList(room.sourceIds, authorizedSourceIds);
      const roomItems = list(room.items);
      if (seeds.length + roomItems.length > 300)
        throw new BadRequestException("Use up to 300 proposed items.");
      for (const itemValue of roomItems) {
        const item = object(itemValue);
        const work = ref(item.work ?? { id: item.workId, version: item.workVersion }, "work");
        if (!work) continue;
        const materialInputs = list(item.materials ?? item.materialIds);
        if (materialInputs.length > 10)
          throw new BadRequestException("Use up to 10 proposed materials per item.");
        const refs = [
          work,
          ref(item.variant ?? { id: item.variantId, version: item.variantVersion }, "variant"),
          ref(item.unit ?? { id: item.unitId, version: item.unitVersion }, "unit"),
          ...materialInputs.flatMap((choice) => {
            if (typeof choice === "string")
              throw new BadRequestException("Assistant catalog references must include their current version.");
            const row = object(choice);
            const kind = typeof row.kind === "string" && row.kind === "finish" ? "finish" : "material";
            const parsed = ref(row, kind);
            return parsed ? [parsed] : [];
          }),
        ].filter((choice): choice is Ref => !!choice);
        const ownSources = this.sourceList(item.sourceIds, authorizedSourceIds);
        const sourceIds = [...new Set([...roomSources, ...ownSources])];
        if (!sourceIds.length)
          throw new BadRequestException("Every assistant suggestion must cite an authorized source.");
        if (!sourceIds.some((id) => proposalSources.has(id)))
          throw new BadRequestException(
            "A suggestion must be grounded in included scope, the confirmed brief, a confirmed room, or the user's prompt.",
          );
        const linkedItems = [
          ...new Set(
            sourceIds
              .map((id) => sourceItems.get(id))
              .filter((item): item is DefinitionSourceItem => !!item),
          ),
        ];
        seeds.push({
          roomName,
          ...(roomRef ? { roomRef } : {}),
          refs,
          sourceIds,
          reason: text(item.reason ?? room.reason ?? "", 500),
          ...(linkedItems.length === 1 ? { sourceItem: linkedItems[0] } : {}),
        });
      }
    }
    return seeds;
  }

  private proposalSourceIds(snapshot: DefinitionSourceSnapshot) {
    const ids = new Set<string>([snapshot.caseId, "brief", "prompt"]);
    for (const room of snapshot.rooms) ids.add(room.id);
    for (const item of snapshot.items.filter((candidate) => candidate.scopeStatus === "included"))
      for (const sourceId of this.itemSourceIds(item)) ids.add(sourceId);
    return ids;
  }

  private itemSourceIds(item: DefinitionSourceItem) {
    const ids = new Set<string>([item.id]);
    for (const file of item.evidenceFiles) if (typeof file.id === "string") ids.add(file.id);
    for (const design of item.specification?.designs ?? []) {
      if (typeof design.versionId === "string") ids.add(design.versionId);
      if (typeof design.designId === "string") ids.add(design.designId);
    }
    return ids;
  }

  private sourceList(value: unknown, allowed: Set<string>) {
    if (!Array.isArray(value) || value.length > 100)
      throw new BadRequestException("Use a valid bounded source list.");
    const ids = value.map((item) => text(item, 80, true));
    if (ids.some((id) => !allowed.has(id)))
      throw new BadRequestException("A suggestion cites an unavailable source.");
    return [...new Set(ids)];
  }

  private async buildProposal(
    client: PoolClient,
    workspaceId: string,
    quote: Quote,
    definition: DefinitionContext,
    mode: QuotationProposalMode,
    intent: string,
    summary: string,
    seeds: Seed[],
    pricingDate: string,
  ): Promise<QuotationProposal> {
    if (seeds.length > 300) throw new BadRequestException("Use up to 300 proposed items.");
    const records = await this.catalogRecords(client, workspaceId, seeds);
    const links = await this.catalogLinks(client, workspaceId, seeds.flatMap((seed) => seed.refs.map((item) => item.id)));
    const allowed = await this.allowedCatalog(client, workspaceId, seeds);
    const items: QuotationProposalItem[] = [];
    const identities = new Set<string>();
    for (const seed of seeds) {
      const built = await this.proposalItem(client, workspaceId, quote, mode, seed, records, links, allowed, pricingDate);
      const itemIdentities = quotationLineIdentities(built.line);
      if (itemIdentities.some((identity) => identities.has(identity))) continue;
      for (const identity of itemIdentities) identities.add(identity);
      items.push(built);
    }
    const includedSourceIds = definition.snapshot.items
      .filter((item) => item.scopeStatus === "included")
      .map((item) => item.id);
    const linked = new Set(items.flatMap((item) => item.sourceIds));
    const linkedSourceIds = definition.snapshot.items
      .filter(
        (item) =>
          item.scopeStatus === "included" &&
          [...this.itemSourceIds(item)].some((sourceId) => linked.has(sourceId)),
      )
      .map((item) => item.id);
    const unlinkedSourceIds = includedSourceIds.filter((id) => !linked.has(id));
    const notes: string[] = [];
    if (unlinkedSourceIds.length)
      notes.push(`${unlinkedSourceIds.length} confirmed scope item(s) are not linked to this proposal.`);
    if (items.some((item) => item.status === "price_required"))
      notes.push("Confirm unresolved selling prices before quotation review.");
    if (items.some((item) => item.status === "catalog_required"))
      notes.push("Some confirmed scope is custom and needs a catalog item or manual selling rate.");
    return {
      schemaVersion: 1,
      mode,
      summary: summary || (mode === "scope" ? "Confirmed scope proposal" : "Assistant catalog proposal"),
      intent,
      items,
      coverage: { includedSourceIds, linkedSourceIds, unlinkedSourceIds },
      notes,
    };
  }

  private async proposalItem(
    client: PoolClient,
    workspaceId: string,
    quote: Quote,
    mode: QuotationProposalMode,
    seed: Seed,
    records: Map<string, CatalogRecord>,
    links: Array<{ recordId: string; targetId: string; relation: string }>,
    allowed: Map<string, Set<string>>,
    pricingDate: string,
  ): Promise<QuotationProposalItem> {
    const selections = this.selections(seed.refs, records);
    const roomCatalog = seed.roomRef ? this.selections([seed.roomRef], records)[0] : undefined;
    this.validateRelations(selections, roomCatalog, links, allowed);
    const work = selections.find((item) => item.role === "work");
    const variant = selections.find((item) => item.role === "variant");
    let unit = selections.find((item) => item.role === "unit");
    if (work && !unit) {
      const anchor = variant?.recordId ?? work.recordId;
      const unitIds = links
        .filter((link) => link.recordId === anchor && link.relation === "unit")
        .map((link) => link.targetId);
      const unique = [...new Set(unitIds)];
      if (unique.length === 1 && records.has(unique[0])) {
        const snapshot = records.get(unique[0])!;
        unit = { role: "unit", recordId: snapshot.id, version: snapshot.version, snapshot };
        selections.push(unit);
      }
    }
    const scope = seed.sourceItem;
    const scopeSpecification = this.scopeSpecification(scope);
    const details = scope
      ? importedScopeDetails({
          note: scope.requirement,
          specification: scopeSpecification,
          catalogLinks: selections,
        })
      : {
          specification: seed.reason,
          material: selections.filter((item) => item.role === "material").map((item) => item.snapshot.name).join(" · "),
          finish: selections.filter((item) => item.role === "finish").map((item) => item.snapshot.name).join(" · "),
        };
    const unitLabel =
      (typeof unit?.snapshot.configuration?.symbol === "string"
        ? unit.snapshot.configuration.symbol
        : unit?.snapshot.code) ||
      scope?.unit ||
      "nos";
    const catalogLinks = importedScopeCatalogLinks({
      catalogLinks: selections,
      specification: scopeSpecification,
    });
    if (catalogLinks.length > 12)
      throw new BadRequestException(
        `“${mode === "scope" && scope ? scope.title : work?.snapshot.name ?? scope?.title ?? "Custom item"}” has more than 12 catalog selections.`,
      );
    const line: QuoteLine = {
      id: randomUUID(),
      room: seed.roomName,
      title: mode === "scope" && scope ? scope.title : work?.snapshot.name ?? scope?.title ?? "Custom item",
      specification: details.specification,
      material: details.material,
      finish: details.finish,
      quantity: scope?.quantity && scope.quantity > 0 ? scope.quantity : 1,
      unit: unitLabel,
      unitCost: 0,
      rate: 0,
      ...(variant ? { variant: variant.snapshot.name } : {}),
      catalogLinks,
      ...(mode === "scope" && scope
        ? {
            scopeId: scope.id,
            scopeVersion: scope.version,
            ...(scope.specification?.version
              ? { specificationVersion: scope.specification.version }
              : {}),
          }
        : {}),
    };
    let status: QuotationProposalItem["status"] = "catalog_required";
    let issue = "Choose a catalog item or add an authorized manual selling rate.";
    if (work) {
      const resolution = await this.sellingPrices.resolve(client, workspaceId, {
        catalogId: work.snapshot.catalogId,
        workId: work.recordId,
        workVersion: work.version,
        ...(variant ? { variantId: variant.recordId, variantVersion: variant.version } : {}),
        ...(unit ? { unitId: unit.recordId, unitVersion: unit.version } : {}),
        unitLabel: line.unit,
        quantity: line.quantity,
        currency: quote.currency,
        pricingDate,
        taxRate: quote.taxRate,
      });
      line.catalogPrice = resolution.snapshot;
      line.rate = this.snapshotRate(resolution.snapshot);
      status = resolution.status === "resolved" ? "ready" : "price_required";
      issue = resolution.message;
    }
    const matchingRoom = seed.sourceItem?.roomId
      ? seed.sourceItem.roomId
      : undefined;
    return {
      id: randomUUID(),
      roomId: matchingRoom ?? randomUUID(),
      roomName: seed.roomName,
      ...(roomCatalog ? { roomCatalog } : {}),
      line,
      sourceIds: seed.sourceIds,
      reason: seed.reason,
      status,
      ...(status !== "ready" ? { issue } : {}),
    };
  }

  private async revalidateProposal(
    client: PoolClient,
    workspaceId: string,
    quote: Quote,
    items: QuotationProposalItem[],
    pricingDate: string,
  ) {
    const seeds: Seed[] = items.map((item) => ({
      roomName: item.roomName,
      refs: (item.line.catalogLinks ?? []).map((selection) => ({
        role: selection.role,
        id: selection.recordId,
        version: selection.version,
      })),
      ...(item.roomCatalog
        ? { roomRef: { role: "room", id: item.roomCatalog.recordId, version: item.roomCatalog.version } }
        : {}),
      sourceIds: item.sourceIds,
      reason: item.reason,
    }));
    const records = await this.catalogRecords(client, workspaceId, seeds);
    const links = await this.catalogLinks(client, workspaceId, seeds.flatMap((seed) => seed.refs.map((entry) => entry.id)));
    const allowed = await this.allowedCatalog(client, workspaceId, seeds);
    const refreshed: QuotationProposalItem[] = [];
    for (let index = 0; index < items.length; index++) {
      const item = structuredClone(items[index]);
      item.line.catalogLinks = this.selections(seeds[index].refs, records);
      if (seeds[index].roomRef)
        item.roomCatalog = this.selections([seeds[index].roomRef!], records)[0];
      this.validateRelations(item.line.catalogLinks, item.roomCatalog, links, allowed);
      const work = item.line.catalogLinks.find((selection) => selection.role === "work");
      const variant = item.line.catalogLinks.find((selection) => selection.role === "variant");
      const unit = item.line.catalogLinks.find((selection) => selection.role === "unit");
      if (work) {
        const resolution = await this.sellingPrices.resolve(client, workspaceId, {
          catalogId: work.snapshot.catalogId,
          workId: work.recordId,
          workVersion: work.version,
          ...(variant ? { variantId: variant.recordId, variantVersion: variant.version } : {}),
          ...(unit ? { unitId: unit.recordId, unitVersion: unit.version } : {}),
          unitLabel: item.line.unit,
          quantity: item.line.quantity,
          currency: quote.currency,
          pricingDate,
          taxRate: quote.taxRate,
        });
        if (canonicalHash(this.priceBasis(resolution.snapshot)) !== canonicalHash(this.priceBasis(item.line.catalogPrice)))
          throw new ConflictException(
            `The selling-price basis for ${item.line.title} changed. Prepare a new proposal.`,
          );
        item.line.catalogPrice = resolution.snapshot;
        item.line.rate = this.snapshotRate(resolution.snapshot);
      }
      refreshed.push(item);
    }
    return refreshed;
  }

  private async catalogRecords(client: PoolClient, workspaceId: string, seeds: Seed[]) {
    const references = [
      ...seeds.flatMap((seed) => seed.refs),
      ...seeds.flatMap((seed) => (seed.roomRef ? [seed.roomRef] : [])),
    ];
    const ids = [...new Set(references.map((entry) => entry.id))];
    if (!ids.length) return new Map<string, CatalogRecord>();
    const result = await client.query<CatalogRecord>(
      `SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",catalog.name AS "catalogName",
       CASE WHEN r.kind='unit' THEN coalesce(r.content->'configuration','{}'::jsonb)||
         jsonb_build_object('symbol',coalesce(r.content->'configuration'->>'symbol',r.content->'aliases'->>0,r.code))
       ELSE r.content->'configuration' END AS configuration,r.content->'commerce' AS commerce
       FROM workspace_catalog_records r
       JOIN workspace_catalog_records catalog ON catalog.workspace_id=r.workspace_id
        AND catalog.id=r.catalog_id AND catalog.kind='catalog_group' AND NOT catalog.archived
       WHERE r.workspace_id=$1 AND NOT r.archived AND
        (r.id=ANY($2::uuid[]) OR r.id IN (
          SELECT link.target_id FROM workspace_catalog_links link
          WHERE link.workspace_id=$1 AND link.record_id=ANY($2::uuid[]) AND link.relation='unit'
        ))`,
      [workspaceId, ids],
    );
    const records = new Map(result.rows.map((row) => [row.id, row]));
    for (const reference of references) {
      const record = records.get(reference.id);
      if (!record || Number(record.version) !== reference.version)
        throw new ConflictException(
          "A catalog selection changed or is unavailable. Prepare the proposal again.",
        );
    }
    return records;
  }

  private selections(refs: Ref[], records: Map<string, CatalogRecord>): CatalogSelection[] {
    const unique = new Set<string>();
    return refs.map((reference) => {
      const record = records.get(reference.id)!;
      if (
        reference.role !== record.kind &&
        !(reference.role === "material" && ["sku", "hardware", "consumable"].includes(record.kind))
      )
        throw new BadRequestException("A catalog selection has the wrong role.");
      const key = `${reference.role}:${reference.id}`;
      if (unique.has(key)) throw new BadRequestException("A catalog selection is repeated.");
      unique.add(key);
      return {
        role: reference.role,
        recordId: reference.id,
        version: reference.version,
        snapshot: record,
      };
    });
  }

  private async catalogLinks(client: PoolClient, workspaceId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    return (
      await client.query<{ recordId: string; targetId: string; relation: string }>(
        `SELECT record_id AS "recordId",target_id AS "targetId",relation
         FROM workspace_catalog_links
         WHERE workspace_id=$1 AND (record_id=ANY($2::uuid[]) OR target_id=ANY($2::uuid[]))`,
        [workspaceId, unique],
      )
    ).rows;
  }

  private async allowedCatalog(client: PoolClient, workspaceId: string, seeds: Seed[]) {
    const workIds = [...new Set(seeds.flatMap((seed) => seed.refs.filter((entry) => entry.role === "work").map((entry) => entry.id)))];
    const result = workIds.length
      ? await client.query<{ root: string; id: string }>(
          `WITH RECURSIVE edges(source,target) AS (
             SELECT link.record_id,link.target_id
             FROM workspace_catalog_links link
             JOIN workspace_catalog_records source ON source.workspace_id=link.workspace_id AND source.id=link.record_id
             JOIN workspace_catalog_records target ON target.workspace_id=link.workspace_id AND target.id=link.target_id
             WHERE link.workspace_id=$1 AND NOT source.archived AND NOT target.archived AND
               (link.relation='unit'
                OR (source.kind IN ('work','variant','construction') AND link.relation IN ('material','sku','hardware','consumable','finish','construction','variant')))
             UNION
             SELECT link.target_id,link.record_id
             FROM workspace_catalog_links link
             JOIN workspace_catalog_records source ON source.workspace_id=link.workspace_id AND source.id=link.record_id
             JOIN workspace_catalog_records target ON target.workspace_id=link.workspace_id AND target.id=link.target_id
             WHERE link.workspace_id=$1 AND NOT source.archived AND NOT target.archived
               AND source.kind IN ('variant','construction') AND link.relation IN ('work','parent')
           ), scoped(root,id) AS (
             SELECT record.id,record.id FROM workspace_catalog_records record
             WHERE record.workspace_id=$1 AND record.id=ANY($2::uuid[]) AND record.kind='work' AND NOT record.archived
             UNION
             SELECT scoped.root,edges.target FROM scoped JOIN edges ON edges.source=scoped.id
           ) SELECT root,id FROM scoped`,
          [workspaceId, workIds],
        )
      : { rows: [] as Array<{ root: string; id: string }> };
    const allowed = new Map<string, Set<string>>();
    for (const row of result.rows) {
      const values = allowed.get(row.root) ?? new Set<string>();
      values.add(row.id);
      allowed.set(row.root, values);
    }
    return allowed;
  }

  private validateRelations(
    selections: CatalogSelection[],
    room: CatalogSelection | undefined,
    links: Array<{ recordId: string; targetId: string; relation: string }>,
    allowed: Map<string, Set<string>>,
  ) {
    for (const role of ["work", "variant", "unit"])
      if (selections.filter((selection) => selection.role === role).length > 1)
        throw new BadRequestException(`Choose only one catalog ${role} per proposed item.`);
    const work = selections.find((selection) => selection.role === "work");
    const variant = selections.find((selection) => selection.role === "variant");
    if (variant && (!work || !links.some((link) => link.recordId === variant.recordId && link.targetId === work.recordId && link.relation === "work")))
      throw new BadRequestException("A proposed variant does not belong to its catalog item.");
    const unit = selections.find((selection) => selection.role === "unit");
    if (unit && work) {
      const variantUnits = variant
        ? links.filter((link) => link.recordId === variant.recordId && link.relation === "unit")
        : [];
      const unitOwner = variantUnits.length ? variant!.recordId : work.recordId;
      if (!links.some((link) => link.recordId === unitOwner && link.targetId === unit.recordId && link.relation === "unit"))
        throw new BadRequestException("A proposed pricing unit does not belong to its catalog item.");
    }
    if (room && work && !links.some((link) =>
      link.relation === "room" &&
      ((link.recordId === work.recordId && link.targetId === room.recordId) ||
        (link.recordId === room.recordId && link.targetId === work.recordId))))
      throw new BadRequestException("A proposed catalog item does not belong to its room catalog.");
    if (work) {
      const valid = allowed.get(work.recordId) ?? new Set([work.recordId]);
      const invalid = selections.find((selection) =>
        ["material", "finish"].includes(selection.role) && !valid.has(selection.recordId));
      if (invalid)
        throw new BadRequestException("A proposed material is outside the selected catalog item's recipe.");
    }
  }

  private duplicates(quote: Quote, items: QuotationProposalItem[]) {
    const identities = new Set(quote.lines.flatMap(quotationLineIdentities));
    return items
      .filter((item) => {
        return quotationLineIdentities(item.line).some((identity) => identities.has(identity));
      })
      .map((item) => item.id);
  }

  private scopeSpecification(source?: DefinitionSourceItem) {
    if (!source?.specification) return undefined;
    const stringValue = (value: unknown) =>
      typeof value === "string" ? value : "";
    const numberValue = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    return {
      refinedRequirement: source.specification.refinedRequirement,
      construction: source.specification.construction,
      materials: source.specification.materials.map((value) => {
        const material = optionalObject(value) ?? {};
        const catalog = optionalObject(material.catalog) ?? {};
        return {
          application: stringValue(material.application),
          productName: stringValue(material.productName),
          productCode: stringValue(material.productCode),
          finishCode: stringValue(material.finishCode),
          stockSize: stringValue(material.stockSize),
          status: stringValue(material.status),
          catalog: {
            material: (optionalObject(catalog.material) ?? {}) as CatalogSelection["snapshot"],
            brand: (optionalObject(catalog.brand) ?? {}) as CatalogSelection["snapshot"],
            finish: (optionalObject(catalog.finish) ?? {}) as CatalogSelection["snapshot"],
          },
        };
      }),
      dimensions: source.specification.dimensions.map((value) => {
        const dimension = optionalObject(value) ?? {};
        return {
          name: stringValue(dimension.name),
          measured: numberValue(dimension.measured),
          approximate: numberValue(dimension.approximate),
          unit: stringValue(dimension.unit),
          verification: stringValue(dimension.verification),
        };
      }),
    };
  }

  private present(run: RunRow, data: CommercialData, quote: Quote, definition: DefinitionContext | null) {
    const staleReasons: string[] = [];
    if (run.commercialRevision !== data.revision || run.quoteDraftHash !== quoteDraftHash(quote))
      staleReasons.push("quotation_changed");
    if (
      !definition ||
      run.definitionBaselineId !== definition.id ||
      run.definitionSnapshotHash !== definition.snapshotHash ||
      run.definitionSourceHash !== definition.sourceHash
    )
      staleReasons.push("definition_changed");
    return {
      id: run.id,
      quoteId: run.quoteId,
      mode: run.mode,
      status: run.status,
      stale: run.status === "proposed" && staleReasons.length > 0,
      staleReasons,
      proposal: run.proposal,
      duplicates: this.duplicates(quote, run.proposal.items),
      createdAt: new Date(run.createdAt).toISOString(),
      createdBy: run.createdBy,
      appliedAt: run.appliedAt ? new Date(run.appliedAt).toISOString() : null,
      appliedBy: run.appliedBy,
      appliedRevision: run.appliedRevision,
      dismissedAt: run.dismissedAt ? new Date(run.dismissedAt).toISOString() : null,
      dismissedBy: run.dismissedBy,
    };
  }

  private async run(client: PoolClient, workspaceId: string, caseId: string, runId: string, lock: boolean) {
    const result = await client.query<RunRow>(
      `${runSelect} WHERE run.workspace_id=$1 AND run.case_id=$2 AND run.id=$3 ${lock ? "FOR UPDATE OF run" : ""}`,
      [workspaceId, caseId, runId],
    );
    if (!result.rowCount) throw new NotFoundException("Quotation proposal not found.");
    return result.rows[0];
  }

  private async workspaceDate(client: PoolClient, workspaceId: string) {
    const result = await client.query<{ date: string }>(
      `SELECT to_char(now() AT TIME ZONE default_timezone,'YYYY-MM-DD') AS date
       FROM workspaces WHERE id=$1`,
      [workspaceId],
    );
    return result.rows[0]?.date ?? new Date().toISOString().slice(0, 10);
  }

  private snapshotRate(snapshot: CatalogPriceSnapshot) {
    return snapshot.status === "resolved"
      ? snapshot.override?.amount ?? snapshot.rateCard?.appliedUnitRate ?? 0
      : 0;
  }

  private priceBasis(snapshot?: CatalogPriceSnapshot) {
    if (!snapshot) return null;
    const { resolvedAt: _resolvedAt, ...basis } = snapshot;
    return basis;
  }

  private requestLock(client: PoolClient, workspaceId: string, requestId: string) {
    return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${workspaceId}:quotation-proposal:${requestId}`,
    ]);
  }

  private async replay(
    client: PoolClient,
    workspaceId: string,
    requestId: string,
    action: "create" | "apply" | "dismiss",
    requestHash: string,
  ) {
    const result = await client.query<{ action: string; requestHash: string; responseBody: Record<string, unknown> }>(
      `SELECT action,request_hash AS "requestHash",response_body AS "responseBody"
       FROM quotation_proposal_commands WHERE workspace_id=$1 AND request_id=$2`,
      [workspaceId, requestId],
    );
    if (!result.rowCount) return null;
    if (result.rows[0].action !== action || result.rows[0].requestHash !== requestHash)
      throw new ConflictException("This request ID was already used for a different quotation action.");
    return result.rows[0].responseBody;
  }

  private saveCommand(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    runId: string,
    requestId: string,
    action: "create" | "apply" | "dismiss",
    requestHash: string,
    response: unknown,
    userId: string,
  ) {
    return client.query(
      `INSERT INTO quotation_proposal_commands
       (workspace_id,request_id,case_id,run_id,action,request_hash,response_body,actor_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [workspaceId, requestId, caseId, runId, action, requestHash, response, userId],
    );
  }
}
