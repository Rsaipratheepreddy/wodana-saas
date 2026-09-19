import { BadRequestException } from "@nestjs/common";
import type { RecipePreviewDto } from "./catalog.dto";

type Master = {
  id: string;
  kind: string;
  code: string;
  name: string;
  version: number;
  archived?: boolean;
  specificationStatus?: string;
  dimension?: string;
  baseFactor?: number;
  configuration?: Record<string, string | number>;
  links: { relation: string; targetId: string }[];
  sizes?: { lengthMm?: number; widthMm?: number }[];
};
const cfg = (r?: Master) => r?.configuration ?? {};
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const productKinds = [
  "sku",
  "hardware",
  "consumable",
  "material",
  "factory_process",
  "site_process",
  "logistics_rule",
  "service",
  "work",
  "resource",
];
export function previewRecipe(records: Master[], input: RecipePreviewDto) {
  const byId = new Map(
    records.filter((r) => !r.archived).map((r) => [r.id, r]),
  );
  const get = (id: string | undefined, kind?: string) => {
    const r = id ? byId.get(id) : undefined;
    if (id && (!r || (kind && r.kind !== kind)))
      throw new BadRequestException(
        `Choose an active ${kind ?? "record"} from this workspace.`,
      );
    return r;
  };
  const linked = (r: Master, relation: string) =>
    r.links
      .filter((l) => l.relation === relation)
      .map((l) => byId.get(l.targetId))
      .filter((r): r is Master => Boolean(r));
  const template = get(input.templateId, "construction")!;
  if (cfg(template).recordRole !== "template")
    throw new BadRequestException("Choose a parent item recipe.");
  const execution = get(input.executionId, "execution")!;
  const variant = get(input.variantId, "variant_rule");
  const room = get(input.roomId, "room");
  get(input.rateZoneId, "rate_zone");
  if (
    variant &&
    (!linked(variant, "construction").some((r) => r.id === template.id) ||
      cfg(variant).operation !== "group")
  )
    throw new BadRequestException(
      "Choose a variant linked to this item recipe.",
    );
  const issues: string[] = [];
  const warnings: string[] = [];
  const changes: string[] = [];
  for (const list of [
    (input.values ?? []).map((v) => v.key),
    (input.selections ?? []).map((v) => v.slotId),
    input.commercialRuleIds ?? [],
  ])
    if (new Set(list).size !== list.length)
      throw new BadRequestException(
        "Remove duplicate preview inputs or rules.",
      );
  const unitScale = { ft: 0.3048, m: 1, mm: 0.001 }[input.dimensionUnit];
  const values = Object.fromEntries(
    (input.values ?? []).map((v) => [v.key, v.value]),
  );
  const selected = new Map(
    (input.selections ?? []).map((v) => [v.slotId, v.targetId]),
  );
  const dimensions = {
    width: input.width,
    height: input.height,
    length: input.length,
    depth: input.depth,
  };
  const measure = (
    basis: string | number | undefined,
    key?: string | number,
  ): { value: number; dimension: string } | null => {
    const dim = (name: keyof typeof dimensions) =>
      dimensions[name] == null ? null : dimensions[name]! * unitScale;
    if (basis === "count" || basis === "manual") {
      const value = key
        ? values[String(key)]
        : basis === "count"
          ? 1
          : undefined;
      return value == null
        ? null
        : { value, dimension: basis === "count" ? "count" : "explicit" };
    }
    if (["length", "width", "height"].includes(String(basis))) {
      const v = dim(basis as "length" | "width" | "height");
      return v == null ? null : { value: v, dimension: "length" };
    }
    if (basis === "perimeter") {
      const l = dim("length"),
        w = dim("width");
      return l == null || w == null
        ? null
        : { value: 2 * (l + w), dimension: "length" };
    }
    const parts = String(basis).split("_") as (keyof typeof dimensions)[];
    if (parts.length !== 2 || !parts.every((k) => k in dimensions)) return null;
    const a = dim(parts[0]),
      b = dim(parts[1]);
    return a == null || b == null ? null : { value: a * b, dimension: "area" };
  };
  const sellingBasis = cfg(template).sellingBasis ?? "manual";
  const selling = measure(
    sellingBasis,
    sellingBasis === "manual" ? "selling_quantity" : undefined,
  );
  const sellingUnit = linked(template, "unit")[0];
  const quantity =
    selling && sellingUnit && selling.dimension === sellingUnit.dimension
      ? (selling.value / (sellingUnit.baseFactor ?? 1)) * input.quantity
      : selling &&
          sellingUnit &&
          ["count", "explicit"].includes(selling.dimension)
        ? selling.value * input.quantity
        : null;
  if (quantity == null)
    issues.push("Complete the item selling measurement and its output unit.");
  const slots = records.filter(
    (r) =>
      !r.archived &&
      r.kind === "construction" &&
      r.links.some(
        (l) => l.relation === "parent" && l.targetId === template.id,
      ),
  );
  if (!slots.length)
    issues.push("Add component and process rows to this item recipe.");
  for (const [slotId, targetId] of selected) {
    if (!slots.some((s) => s.id === slotId))
      throw new BadRequestException("A selection must belong to this recipe.");
    const target = get(targetId);
    if (!target || !productKinds.includes(target.kind))
      throw new BadRequestException(
        "Select a product or process for the component.",
      );
  }
  const overrides = new Map<string, Master | null>();
  if (variant)
    for (const rule of records.filter(
      (r) =>
        !r.archived &&
        r.kind === "variant_rule" &&
        r.links.some(
          (l) => l.relation === "parent" && l.targetId === variant.id,
        ),
    )) {
      const c = cfg(rule);
      if (
        c.qualityGrade &&
        c.qualityGrade !== "Any" &&
        c.qualityGrade !== input.grade
      )
        continue;
      const target = linked(rule, "construction").find((t) =>
        slots.some((s) => s.id === t.id),
      );
      if (!target) {
        warnings.push(
          `${rule.name}: ${c.value ?? c.condition ?? "review the variant specification"}`,
        );
        issues.push(
          `${rule.name}: connect this variant rule to a component before pricing.`,
        );
        continue;
      }
      if (c.operation === "remove") {
        overrides.set(target.id, null);
        changes.push(`${target.name}: removed by ${variant.name}`);
        continue;
      }
      const products = rule.links
        .filter((l) => productKinds.includes(l.relation))
        .map((l) => get(l.targetId)!);
      if (products.length === 1) {
        if (overrides.has(target.id))
          issues.push(
            `${target.name}: multiple variant overrides match this grade.`,
          );
        overrides.set(target.id, products[0]);
        changes.push(`${target.name}: ${products[0].name} (${input.grade})`);
      } else
        issues.push(`${rule.name}: select exactly one replacement product.`);
    }
  const fabrication = String(cfg(execution).fabrication);
  const applicable = (r: Master) => {
    const routes = linked(r, "execution");
    return !routes.length || routes.some((route) => route.id === execution.id);
  };
  const date = input.pricingDate ?? new Date().toISOString().slice(0, 10);
  if (
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new BadRequestException("Choose a valid pricing date.");
  const lines: {
    id: string;
    name: string;
    location: string;
    sourceId: string | null;
    source: string;
    unit: string;
    quantity: number | null;
    allowedQuantity: number | null;
    rate: number | null;
    amount: number | null;
    issues: string[];
    quantityBasis: string;
    quantityInput: string;
    rateId?: string;
    purchaseUnits?: number;
    roundPack?: boolean;
    norm: {
      factor: number;
      basis: string;
      kind: "material" | "labour_or_process" | "charge";
      sourceId: string;
      sourceVersion: number;
    };
    wastePercent: number;
  }[] = [];
  const groups = new Map<
    string,
    { rate: Master; units: number; roundPack: boolean; lines: number[] }
  >();
  for (const slot of slots.sort(
    (a, b) => Number(cfg(a).sequence ?? 0) - Number(cfg(b).sequence ?? 0),
  )) {
    const c = cfg(slot);
    if (
      !applicable(slot) ||
      (c.qualityGrade &&
        c.qualityGrade !== "Any" &&
        c.qualityGrade !== input.grade) ||
      overrides.get(slot.id) === null
    )
      continue;
    const products = slot.links
      .filter((l) => productKinds.includes(l.relation))
      .map((l) => get(l.targetId)!);
    const source = selected.has(slot.id)
      ? get(selected.get(slot.id))
      : (overrides.get(slot.id) ??
        (products.length === 1 ? products[0] : undefined));
    let outputUnit = linked(slot, "unit")[0];
    let quantityInput = String(c.quantityInput ?? "");
    const sourceUnit = source ? linked(source, "unit")[0] : undefined;
    // A mechanism set and individual hinges cannot share the same count input.
    // Resolve the new product unit and explicitly request its count instead of guessing a conversion.
    if (
      c.quantityBasis === "count" &&
      outputUnit?.dimension === "pack" &&
      sourceUnit?.dimension === "count"
    ) {
      outputUnit = sourceUnit;
      quantityInput = `qty_${source!.code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    }
    const measured = measure(c.quantityBasis, quantityInput);
    const normFactor = Number(c.factor ?? 1);
    const optional = c.required === "optional" || c.required === "conditional";
    if (
      optional &&
      !selected.has(slot.id) &&
      (!measured || measured.value === 0 || !source)
    )
      continue;
    const line: (typeof lines)[number] = {
      id: slot.id,
      name: slot.name,
      location: String(
        c.workLocation ??
          (fabrication === "mixed" ? "unassigned" : fabrication),
      ),
      sourceId: source?.id ?? null,
      source: source?.name ?? "Select product / process",
      unit: "",
      quantity: null as number | null,
      allowedQuantity: null as number | null,
      rate: null as number | null,
      amount: null as number | null,
      issues: [] as string[],
      quantityBasis: String(c.quantityBasis ?? "manual"),
      quantityInput,
      rateId: undefined as string | undefined,
      purchaseUnits: undefined as number | undefined,
      roundPack: false,
      norm: {
        factor: normFactor,
        basis: String(c.quantityBasis ?? "manual"),
        kind:
          c.recordRole === "operation"
            ? "labour_or_process"
            : c.recordRole === "charge"
              ? "charge"
              : "material",
        sourceId: slot.id,
        sourceVersion: slot.version,
      },
      wastePercent: 0,
    };
    line.unit = outputUnit?.name ?? "Unconfigured";
    if (line.location === "unassigned")
      line.issues.push(
        "Set factory or site location for this hybrid component.",
      );
    if (!source) line.issues.push("Select one product or process.");
    if (!Number.isFinite(normFactor) || normFactor <= 0)
      line.issues.push("Set a positive quantity or labour norm for this row.");
    if (!measured)
      line.issues.push(
        `Enter ${quantityInput || "dimensions / quantity calculation"}.`,
      );
    if (measured && outputUnit && Number.isFinite(normFactor) && normFactor > 0) {
      if (
        measured.dimension === "explicit" ||
        (measured.dimension === "count" &&
          ["count", "pack"].includes(outputUnit.dimension ?? ""))
      )
        line.quantity = measured.value * normFactor * input.quantity;
      else if (
        measured.dimension === outputUnit.dimension &&
        outputUnit.baseFactor
      )
        line.quantity =
          (measured.value / outputUnit.baseFactor) *
          normFactor *
          input.quantity;
      else
        line.issues.push(
          "Calculation and output unit have different dimensions.",
        );
    }
    if (!outputUnit) line.issues.push("Choose the component output unit.");
    let waste = 0;
    const wasteRules = linked(slot, "wastage_rule").filter((r) =>
      linked(r, "execution").some(
        (route) => cfg(route).fabrication === line.location,
      ),
    );
    if (wasteRules.length > 1)
      line.issues.push("Choose one applicable wastage rule.");
    else if (wasteRules.length === 1) {
      if (
        cfg(wasteRules[0]).approvedPercent == null ||
        wasteRules[0].specificationStatus !== "workspace_verified"
      )
        line.issues.push(`Review workspace allowance: ${wasteRules[0].name}.`);
      else waste = Number(cfg(wasteRules[0]).approvedPercent) / 100;
    }
    line.wastePercent = waste * 100;
    if (line.quantity != null)
      line.allowedQuantity = line.quantity * (1 + waste);
    if (
      source &&
      source.kind === "sku" &&
      source.specificationStatus !== "workspace_verified"
    )
      line.issues.push(
        "Confirm the exact brand, product code and format for this SKU.",
      );
    let rates = source
      ? records.filter(
          (r) =>
            !r.archived &&
            r.kind === "rate_card" &&
            r.specificationStatus === "workspace_verified" &&
            ["purchase", "cost"].includes(String(cfg(r).priceType)) &&
            r.links.some(
              (l) => l.targetId === source.id && l.relation === source.kind,
            ) &&
            cfg(r).currency === input.currency &&
            String(cfg(r).effectiveFrom ?? "9999") <= date &&
            (!cfg(r).effectiveTo || String(cfg(r).effectiveTo) >= date) &&
            (!linked(r, "rate_zone").length ||
              linked(r, "rate_zone").some((z) => z.id === input.rateZoneId)),
        )
      : [];
    if (
      input.rateZoneId &&
      rates.some((r) =>
        linked(r, "rate_zone").some((z) => z.id === input.rateZoneId),
      )
    )
      rates = rates.filter((r) =>
        linked(r, "rate_zone").some((z) => z.id === input.rateZoneId),
      );
    if (source && rates.length !== 1)
      line.issues.push(
        rates.length
          ? "Multiple valid rates match; narrow the price book selection."
          : "Add a verified, current price-book rate in this currency / zone.",
      );
    const rate = rates.length === 1 ? rates[0] : undefined;
    if (rate && source && outputUnit && line.allowedQuantity != null) {
      const rateUnit = linked(rate, "unit")[0];
      const rc = cfg(rate);
      let units: number | null = null;
      if (
        typeof rc.amount !== "number" ||
        !Number.isFinite(rc.amount) ||
        rc.amount < 0
      )
        line.issues.push("Enter a valid price-book amount.");
      if (rc.taxIncluded !== "no")
        line.issues.push("Use a tax-exclusive cost rate for this preview.");
      if (rc.costIncludes === "all_inclusive")
        line.issues.push(
          "Review this all-inclusive scope before adding separate process or delivery costs.",
        );
      if (rateUnit?.id === outputUnit.id) units = line.allowedQuantity;
      else if (
        rateUnit?.dimension === outputUnit.dimension &&
        rateUnit?.baseFactor &&
        outputUnit.baseFactor
      )
        units =
          (line.allowedQuantity * outputUnit.baseFactor) / rateUnit.baseFactor;
      else if (
        rateUnit?.dimension === "pack" &&
        outputUnit.dimension === "area"
      ) {
        const coverage = Number(cfg(source).packCoverage);
        const coverageUnit = records.find(
          (r) =>
            r.kind === "unit" &&
            (r.code === cfg(source).usageUnit ||
              r.name === cfg(source).usageUnit),
        );
        const exactSize =
          source.sizes?.length === 1 ? source.sizes[0] : undefined;
        const sqm =
          coverage > 0 && coverageUnit?.dimension === "area"
            ? coverage * (coverageUnit.baseFactor ?? 0)
            : exactSize?.lengthMm && exactSize.widthMm
              ? (exactSize.lengthMm * exactSize.widthMm) / 1e6
              : 0;
        if (sqm > 0 && outputUnit.baseFactor) {
          units = (line.allowedQuantity * outputUnit.baseFactor) / sqm;
          line.roundPack = true;
        } else
          line.issues.push(
            "Define the selected SKU pack coverage and coverage unit.",
          );
      } else
        line.issues.push(
          "Rate and quantity units need a compatible conversion.",
        );
      if (
        units != null &&
        typeof rc.amount === "number" &&
        Number.isFinite(rc.amount) &&
        rc.amount >= 0
      ) {
        line.rate = rc.amount;
        line.rateId = rate.id;
        line.purchaseUnits = units;
        const group = groups.get(rate.id) ?? {
          rate,
          units: 0,
          roundPack: line.roundPack === true,
          lines: [] as number[],
        };
        if (group.roundPack !== line.roundPack)
          line.issues.push(
            "Do not mix pack and consumption costing for the same SKU.",
          );
        group.units += units;
        group.lines.push(lines.length);
        groups.set(rate.id, group);
      }
    }
    lines.push(line);
  }
  for (const group of groups.values()) {
    const c = cfg(group.rate);
    const demand = Math.max(group.units, Number(c.minimumQuantity ?? 0));
    const qty = group.roundPack ? Math.ceil(demand - 1e-10) : demand;
    const total = money(
      Math.max(qty * Number(c.amount), Number(c.minimumCharge ?? 0)),
    );
    let allocated = 0;
    group.lines.forEach((index, i) => {
      const line = lines[index];
      line.amount =
        i === group.lines.length - 1
          ? money(total - allocated)
          : money((total * (line.purchaseUnits ?? 0)) / (group.units || 1));
      allocated += line.amount;
    });
  }
  const directCost = money(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0));
  let costBasis = directCost,
    preTax: number | null = null;
  const commercial =
    input.commercialRuleIds?.map((id) => get(id, "commercial_rule")!) ?? [];
  const margin = commercial.filter((r) => cfg(r).ruleGroup === "Margin");
  if (margin.length !== 1)
    issues.push("Choose one reviewed target margin rule.");
  const overheadScopes = new Set<string>();
  for (const rule of commercial) {
    const c = cfg(rule);
    if (
      rule.specificationStatus !== "workspace_verified" ||
      c.approvedValue == null
    ) {
      issues.push(`Review workspace commercial value: ${rule.name}.`);
      continue;
    }
    if (c.ruleGroup === "Overhead") {
      const routeScopes = linked(rule, "execution").map((r) =>
        String(cfg(r).fabrication),
      );
      const scopes =
        routeScopes.length && !routeScopes.includes("mixed")
          ? routeScopes
          : ["factory", "site", "supplier"];
      if (scopes.some((s) => overheadScopes.has(s)))
        issues.push("Overhead rules overlap; apply each cost allocation once.");
      scopes.forEach((s) => overheadScopes.add(s));
      const base = lines
        .filter((l) => scopes.includes(l.location))
        .reduce((sum, l) => sum + (l.amount ?? 0), 0);
      costBasis += (base * Number(c.approvedValue)) / 100;
    } else if (c.ruleGroup !== "Margin")
      issues.push(
        `${rule.name}: this commercial operation is not supported in the preview.`,
      );
  }
  if (
    margin.length === 1 &&
    cfg(margin[0]).approvedValue != null &&
    Number(cfg(margin[0]).approvedValue) < 100
  )
    preTax = money(
      costBasis / (1 - Number(cfg(margin[0]).approvedValue) / 100),
    );
  for (const line of lines)
    if (line.issues.length)
      issues.push(...line.issues.map((e) => `${line.name}: ${e}`));
  const tax = get(input.taxId, "tax");
  let taxAmount: number | null = null;
  if (tax) {
    const t = cfg(tax);
    if (
      tax.specificationStatus !== "workspace_verified" ||
      !t.effectiveFrom ||
      String(t.effectiveFrom) > date ||
      (t.effectiveTo && String(t.effectiveTo) < date) ||
      (t.currency && t.currency !== input.currency)
    )
      issues.push(
        "Select a verified tax code valid for this currency and date.",
      );
    else if (["exempt", "out_of_scope"].includes(String(t.treatment)))
      taxAmount = 0;
    else if (t.approvedPercent != null && preTax != null)
      taxAmount = money((preTax * Number(t.approvedPercent)) / 100);
    else issues.push("Validate the selected tax rate and treatment.");
  }
  const blocked = issues.length > 0;
  return {
    status: blocked ? "needs_configuration" : "priced",
    template: {
      id: template.id,
      name: template.name,
      version: template.version,
    },
    room: room?.name ?? null,
    variant: variant?.name ?? null,
    grade: input.grade,
    execution: execution.name,
    currency: input.currency,
    measurement: {
      quantity: quantity == null ? null : Math.round(quantity * 1e6) / 1e6,
      unit: sellingUnit?.name ?? "Unconfigured",
    },
    lines,
    changes,
    warnings,
    issues,
    directCost: blocked ? null : directCost,
    costBasis: blocked ? null : money(costBasis),
    priceBeforeTax: blocked ? null : preTax,
    taxAmount: blocked ? null : taxAmount,
    priceAfterTax:
      blocked || preTax == null || taxAmount == null
        ? null
        : money(preTax + taxAmount),
    pricingDate: date,
    estimateNote:
      "Estimate from configured quantities. Confirm cut lists, door overlap, grain, hardware compatibility and site dimensions before release.",
  };
}
