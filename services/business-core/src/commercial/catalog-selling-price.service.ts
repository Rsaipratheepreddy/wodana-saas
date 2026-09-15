import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  CatalogPriceSnapshot,
  CatalogPricingMode,
} from "./commercial.types";

export type SellingPriceLink = {
  relation: string;
  targetId: string;
};

export type SellingPriceRecord = {
  id: string;
  catalogId: string;
  kind: string;
  code: string;
  name: string;
  version: number;
  archived?: boolean;
  specificationStatus?: string;
  commerce?: { pricingMode: CatalogPricingMode };
  configuration?: Record<string, unknown>;
  links: SellingPriceLink[];
};

export type SellingPriceRequest = {
  catalogId: string;
  workId: string;
  workVersion: number;
  variantId?: string;
  variantVersion?: number;
  unitId?: string;
  unitVersion?: number;
  unitLabel?: string;
  rateZoneId?: string;
  rateZoneVersion?: number;
  quantity: number;
  currency: string;
  pricingDate: string;
  taxRate: number;
};

export type SellingPriceResult = {
  status: CatalogPriceSnapshot["status"];
  code:
    | "resolved"
    | "price_required"
    | "unpriced"
    | "missing_unit"
    | "missing_rate"
    | "currency_mismatch"
    | "no_current_rate"
    | "unit_mismatch"
    | "item_unverified"
    | "ambiguous_rate";
  message: string;
  snapshot: CatalogPriceSnapshot;
};

const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

function linked(record: SellingPriceRecord, relation: string) {
  return record.links.filter((link) => link.relation === relation);
}

function positive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function skeleton(
  request: SellingPriceRequest,
  work: SellingPriceRecord,
  variant: SellingPriceRecord | undefined,
  unit: SellingPriceRecord | undefined,
  mode: CatalogPricingMode,
): CatalogPriceSnapshot {
  return {
    status: mode === "on_request" ? "price_required" : "unpriced",
    source: "catalog",
    mode,
    catalogId: request.catalogId,
    work: { id: work.id, version: work.version },
    ...(variant
      ? { variant: { id: variant.id, version: variant.version } }
      : {}),
    ...(unit ? { unit: { id: unit.id, version: unit.version } } : {}),
    ...(request.unitLabel ? { unitLabel: request.unitLabel } : {}),
    quantity: request.quantity,
    currency: request.currency,
    pricingDate: request.pricingDate,
    taxRate: request.taxRate,
    ...(request.rateZoneId
      ? {
          rateZone: {
            id: request.rateZoneId,
            version: request.rateZoneVersion!,
          },
        }
      : {}),
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic selling-price selection. The caller supplies records already
 * constrained to one workspace; this function never considers supplier offers.
 */
export function resolveSellingPrice(
  records: SellingPriceRecord[],
  request: SellingPriceRequest,
): SellingPriceResult {
  const work = records.find(
    (record) =>
      record.id === request.workId &&
      record.kind === "work" &&
      record.catalogId === request.catalogId &&
      !record.archived,
  );
  if (!work || work.version !== request.workVersion)
    throw new NotFoundException("The catalog item or version is unavailable.");

  const variant = request.variantId
    ? records.find(
        (record) =>
          record.id === request.variantId &&
          record.kind === "variant" &&
          record.catalogId === request.catalogId &&
          !record.archived,
      )
    : undefined;
  if (
    request.variantId &&
    (!variant ||
      variant.version !== request.variantVersion ||
      !linked(variant, "work").some((link) => link.targetId === work.id))
  )
    throw new BadRequestException(
      "This variant does not belong to the selected catalog item.",
    );

  if (request.rateZoneId) {
    const rateZone = records.find(
      (record) =>
        record.id === request.rateZoneId &&
        record.kind === "rate_zone" &&
        record.catalogId === request.catalogId &&
        !record.archived,
    );
    if (!rateZone || rateZone.version !== request.rateZoneVersion)
      throw new NotFoundException(
        "The pricing zone or version is unavailable.",
      );
  }

  const mode =
    variant?.commerce?.pricingMode ??
    work.commerce?.pricingMode ??
    "unpriced";
  const variantUnits = variant ? linked(variant, "unit") : [],
    inferredUnitIds = [
      ...(variantUnits.length ? variantUnits : linked(work, "unit")),
    ].map((link) => link.targetId),
    uniqueUnitIds = [...new Set(inferredUnitIds)];
  const unitId =
    request.unitId ?? (uniqueUnitIds.length === 1 ? uniqueUnitIds[0] : undefined);
  const unit = unitId
    ? records.find(
        (record) =>
          record.id === unitId &&
          record.kind === "unit" &&
          record.catalogId === request.catalogId &&
          !record.archived,
      )
    : undefined;
  if (
    request.unitId &&
    (!unit || unit.version !== request.unitVersion)
  )
    throw new NotFoundException("The pricing unit or version is unavailable.");

  const base = skeleton(request, work, variant, unit, mode);
  if (mode === "on_request")
    return {
      status: "price_required",
      code: "price_required",
      message: "A selling price must be confirmed for this item.",
      snapshot: {
        ...base,
        issue: {
          code: "price_required",
          message: "A selling price must be confirmed for this item.",
        },
      },
    };
  if (mode === "unpriced")
    return {
      status: "unpriced",
      code: "unpriced",
      message: "Configure a pricing mode or enter an authorized override.",
      snapshot: {
        ...base,
        issue: {
          code: "unpriced",
          message: "Configure a pricing mode or enter an authorized override.",
        },
      },
    };
  if ((variant ?? work).specificationStatus !== "workspace_verified")
    return {
      status: "price_required",
      code: "item_unverified",
      message: "Verify the catalog item before using its fixed selling price.",
      snapshot: {
        ...base,
        status: "price_required",
        issue: {
          code: "item_unverified",
          message: "Verify the catalog item before using its fixed selling price.",
        },
      },
    };
  if (!unit)
    return {
      status: "price_required",
      code: "missing_unit",
      message: "Choose a pricing unit before resolving the selling rate.",
      snapshot: {
        ...base,
        status: "price_required",
        issue: {
          code: "missing_unit",
          message: "Choose a pricing unit before resolving the selling rate.",
        },
      },
    };

  const unitSymbol = String(unit.configuration?.symbol ?? unit.code)
    .trim()
    .toLowerCase();
  if (request.unitLabel && unitSymbol !== request.unitLabel.trim().toLowerCase())
    return {
      status: "price_required",
      code: "unit_mismatch",
      message: "The quotation unit does not match the catalog pricing unit.",
      snapshot: {
        ...base,
        status: "price_required",
        issue: {
          code: "unit_mismatch",
          message: "The quotation unit does not match the catalog pricing unit.",
        },
      },
    };

  const target = variant ?? work;
  const directlyTargeted = records.filter(
    (record) =>
      record.kind === "rate_card" &&
      record.catalogId === request.catalogId &&
      !record.archived &&
      record.configuration?.priceType === "selling" &&
      linked(record, target.kind).some((link) => link.targetId === target.id),
  );
  const rateCards = directlyTargeted.filter(
    (record) => record.specificationStatus === "workspace_verified",
  );
  // A variant may intentionally inherit the work-level selling price.
  const targeted =
    directlyTargeted.length || !variant
      ? rateCards
      : records.filter(
          (record) =>
            record.kind === "rate_card" &&
            record.catalogId === request.catalogId &&
            !record.archived &&
            record.specificationStatus === "workspace_verified" &&
            record.configuration?.priceType === "selling" &&
            linked(record, "work").some((link) => link.targetId === work.id),
        );
  const current = targeted.filter((record) => {
    const config = record.configuration ?? {};
    return (
      String(config.effectiveFrom ?? "9999-99-99") <= request.pricingDate &&
      (!config.effectiveTo || String(config.effectiveTo) >= request.pricingDate)
    );
  });
  const currency = current.filter(
    (record) => record.configuration?.currency === request.currency,
  );
  const matchingUnit = currency.filter((record) =>
    linked(record, "unit").some((link) => link.targetId === unit.id),
  );
  let zoned = matchingUnit.filter((record) => {
    const zones = linked(record, "rate_zone");
    return request.rateZoneId
      ? !zones.length || zones.some((link) => link.targetId === request.rateZoneId)
      : !zones.length;
  });
  if (
    request.rateZoneId &&
    zoned.some((record) =>
      linked(record, "rate_zone").some(
        (link) => link.targetId === request.rateZoneId,
      ),
    )
  )
    zoned = zoned.filter((record) =>
      linked(record, "rate_zone").some(
        (link) => link.targetId === request.rateZoneId,
      ),
    );
  const eligible = zoned.filter(
    (record) =>
      Number(record.configuration?.minimumQuantity ?? 0) <= request.quantity,
  );
  const highestThreshold = Math.max(
    -1,
    ...eligible.map((record) =>
      Number(record.configuration?.minimumQuantity ?? 0),
    ),
  );
  const candidates = eligible.filter(
    (record) =>
      Number(record.configuration?.minimumQuantity ?? 0) === highestThreshold,
  );

  if (candidates.length !== 1) {
    let code: SellingPriceResult["code"] = "missing_rate";
    let message = "Add a verified selling rate for this item and unit.";
    if (candidates.length > 1) {
      code = "ambiguous_rate";
      message =
        "Multiple current selling rates match. Close the overlap or select a rate zone.";
    } else if (targeted.length && !current.length) {
      code = "no_current_rate";
      message = "No selling rate is effective on the selected pricing date.";
    } else if (current.length && !currency.length) {
      code = "currency_mismatch";
      message = `No current selling rate is available in ${request.currency}.`;
    } else if (currency.length && !matchingUnit.length) {
      code = "unit_mismatch";
      message = "No current selling rate uses the selected pricing unit.";
    }
    return {
      status: "price_required",
      code,
      message,
      snapshot: {
        ...base,
        status: "price_required",
        issue: { code, message },
      },
    };
  }

  const rateCard = candidates[0];
  const config = rateCard.configuration ?? {};
  if (!positive(config.amount))
    return {
      status: "price_required",
      code: "missing_rate",
      message: "The matched selling rate must be greater than zero.",
      snapshot: {
        ...base,
        status: "price_required",
        issue: {
          code: "missing_rate",
          message: "The matched selling rate must be greater than zero.",
        },
      },
    };
  const taxIncluded = config.taxIncluded === "yes";
  const divisor = taxIncluded ? 1 + request.taxRate / 100 : 1;
  const baseUnitRate = Number(config.amount) / divisor;
  const minimumCharge = positive(config.minimumCharge)
    ? Number(config.minimumCharge) / divisor
    : undefined;
  const appliedUnitRate = round(
    Math.max(baseUnitRate, (minimumCharge ?? 0) / request.quantity),
  );
  const snapshot: CatalogPriceSnapshot = {
    ...base,
    status: "resolved",
    rateCard: {
      id: rateCard.id,
      version: rateCard.version,
      amount: Number(config.amount),
      baseUnitRate: round(baseUnitRate),
      appliedUnitRate,
      effectiveFrom: String(config.effectiveFrom),
      ...(config.effectiveTo
        ? { effectiveTo: String(config.effectiveTo) }
        : {}),
      taxIncluded,
      costIncludes: String(config.costIncludes),
      ...(minimumCharge !== undefined
        ? { minimumCharge: round(minimumCharge) }
        : {}),
      ...(positive(config.minimumQuantity)
        ? { minimumQuantity: Number(config.minimumQuantity) }
        : {}),
      ...(config.reference ? { reference: String(config.reference) } : {}),
    },
  };
  return {
    status: "resolved",
    code: "resolved",
    message: "Selling rate resolved from the verified price book.",
    snapshot,
  };
}

@Injectable()
export class CatalogSellingPriceService {
  async resolve(
    client: PoolClient,
    workspaceId: string,
    request: SellingPriceRequest,
  ) {
    const selectedIds = [
      request.workId,
      request.variantId,
      request.unitId,
      request.rateZoneId,
    ].filter(Boolean) as string[];
    const selected = await client.query(
      `SELECT r.id,r.catalog_id AS "catalogId",r.kind,r.code,r.name,r.version,r.archived,
        r.content->>'specificationStatus' AS "specificationStatus",r.content->'commerce' AS commerce,
        r.content->'configuration' AS configuration,
        coalesce((SELECT jsonb_agg(jsonb_build_object('relation',l.relation,'targetId',l.target_id))
          FROM workspace_catalog_links l WHERE l.workspace_id=r.workspace_id AND l.record_id=r.id),'[]'::jsonb) AS links
       FROM workspace_catalog_records r
       JOIN workspace_catalog_records catalog ON catalog.workspace_id=r.workspace_id
         AND catalog.id=r.catalog_id AND catalog.kind='catalog_group' AND NOT catalog.archived
       WHERE r.workspace_id=$1 AND r.catalog_id=$2 AND
         (r.id=ANY($3::uuid[]) OR r.id IN (
           SELECT inferred.target_id FROM workspace_catalog_links inferred
           WHERE inferred.workspace_id=$1 AND inferred.record_id=ANY($4::uuid[])
             AND inferred.relation='unit'
         ))`,
      [
        workspaceId,
        request.catalogId,
        selectedIds,
        [request.workId, request.variantId].filter(Boolean),
      ],
    );
    const rates = await client.query(
      `SELECT DISTINCT r.id,r.catalog_id AS "catalogId",r.kind,r.code,r.name,r.version,r.archived,
        r.content->>'specificationStatus' AS "specificationStatus",r.content->'commerce' AS commerce,
        r.content->'configuration' AS configuration,
        coalesce((SELECT jsonb_agg(jsonb_build_object('relation',all_links.relation,'targetId',all_links.target_id))
          FROM workspace_catalog_links all_links WHERE all_links.workspace_id=r.workspace_id AND all_links.record_id=r.id),'[]'::jsonb) AS links
       FROM workspace_catalog_records r
       JOIN workspace_catalog_records catalog ON catalog.workspace_id=r.workspace_id
         AND catalog.id=r.catalog_id AND catalog.kind='catalog_group' AND NOT catalog.archived
       JOIN workspace_catalog_links target ON target.workspace_id=r.workspace_id AND target.record_id=r.id
       WHERE r.workspace_id=$1 AND r.catalog_id=$2 AND r.kind='rate_card'
         AND target.target_id=ANY($3::uuid[])`,
      [workspaceId, request.catalogId, [request.workId, request.variantId].filter(Boolean)],
    );
    return resolveSellingPrice(
      [...selected.rows, ...rates.rows] as SellingPriceRecord[],
      request,
    );
  }
}
