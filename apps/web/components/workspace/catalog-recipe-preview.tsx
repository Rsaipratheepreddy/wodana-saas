"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, DataGrid } from "@/design-system";
import type { CatalogPageData, CatalogRecord } from "@/lib/workspace/catalog";
import styles from "./catalog-recipe-preview.module.css";

type Preview = {
  status: string;
  measurement: { quantity: number | null; unit: string };
  lines: {
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
    quantityBasis: string;
    quantityInput: string;
    issues: string[];
  }[];
  changes: string[];
  warnings: string[];
  issues: string[];
  directCost: number | null;
  costBasis: number | null;
  priceBeforeTax: number | null;
  taxAmount: number | null;
  priceAfterTax: number | null;
  estimateNote: string;
};
export function CatalogRecipePreview({
  data,
  onEdit,
  initialTemplateId,
  initialVariantId,
}: {
  initialTemplateId?: string;
  initialVariantId?: string;
  data: CatalogPageData;
  onEdit: (record: CatalogRecord) => void;
}) {
  const templates = data.items.filter(
    (r) =>
      r.kind === "construction" &&
      !r.archived &&
      r.configuration?.recordRole === "template",
  );
  const first = (code: string) =>
    data.items.find((r) => r.code === code && !r.archived)?.id ?? "";
  const [templateId, setTemplateId] = useState(
    initialTemplateId || first("ICT-WARD") || templates[0]?.id || "",
  );
  const [executionId, setExecutionId] = useState(first("EXEC-FACTORY"));
  const [variantId, setVariantId] = useState(
    initialTemplateId ? (initialVariantId ?? "") : first("VR-WARD-SLD"),
  );
  const [roomId, setRoomId] = useState(first("PRIMARY_BEDROOM"));
  const [grade, setGrade] = useState(
    initialTemplateId ? "Standard" : "Premium",
  );
  const [dimensions, setDimensions] = useState<Record<string, string>>({
    width: initialTemplateId ? "" : "8",
    height: initialTemplateId ? "" : "9",
    depth: "",
    length: "",
    quantity: "1",
  });
  const [dimensionUnit, setDimensionUnit] = useState("ft");
  const [currency, setCurrency] = useState("INR");
  const [rateZoneId, setRateZoneId] = useState(first("ZONE-IN-HYD"));
  const [marginId, setMarginId] = useState(first("COM-MAR-TGT"));
  const [overheadId, setOverheadId] = useState(first("COM-OH-FACT"));
  const [taxId, setTaxId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({
    opening_sets: "1",
    jobs: "1",
    deliveries: "1",
  });
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const template = data.items.find((r) => r.id === templateId);
  const execution = data.items.find((r) => r.id === executionId);
  const variants = data.items.filter(
    (r) =>
      r.kind === "variant_rule" &&
      !r.archived &&
      r.configuration?.operation === "group" &&
      r.links.some(
        (l) => l.relation === "construction" && l.targetId === templateId,
      ),
  );
  const slots = useMemo(
    () =>
      data.items.filter(
        (r) =>
          r.kind === "construction" &&
          !r.archived &&
          r.links.some(
            (l) => l.relation === "parent" && l.targetId === templateId,
          ) &&
          (!r.links.some((l) => l.relation === "execution") ||
            r.links.some(
              (l) => l.relation === "execution" && l.targetId === executionId,
            )),
      ),
    [data.items, templateId, executionId],
  );
  const inputKeys = Array.from(
    new Set(
      slots
        .filter((r) =>
          ["manual", "count"].includes(String(r.configuration?.quantityBasis)),
        )
        .map((r) => String(r.configuration?.quantityInput ?? ""))
        .filter(Boolean),
    ),
  );
  const revision = useRef(0);
  const update = () => {
    revision.current += 1;
    setStale(true);
  };
  const calculate = async () => {
    const requestRevision = revision.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/workspace/catalog/preview?workspaceId=${data.workspaceId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            templateId,
            executionId,
            variantId: variantId || undefined,
            roomId: roomId || undefined,
            grade,
            dimensionUnit,
            currency,
            rateZoneId: rateZoneId || undefined,
            taxId: taxId || undefined,
            ...Object.fromEntries(
              Object.entries(dimensions)
                .filter(([, v]) => v !== "")
                .map(([k, v]) => [k, Number(v)]),
            ),
            values: Object.entries(values)
              .filter(([, v]) => v !== "")
              .map(([key, value]) => ({ key, value: Number(value) })),
            selections: Object.entries(selections)
              .filter(([, id]) => id)
              .map(([slotId, targetId]) => ({ slotId, targetId })),
            commercialRuleIds: [overheadId, marginId].filter(Boolean),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.message === "string"
            ? result.message
            : result.message?.join?.(" ") || "Could not calculate the recipe.",
        );
      setPreview(result);
      setStale(revision.current !== requestRevision);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not calculate.");
    } finally {
      setBusy(false);
    }
  };
  // Initial example is the user-supplied 8 × 9 ft sliding wardrobe, with no invented rates.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (templateId && executionId) void calculate();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data.items]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    records: CatalogRecord[],
    empty = "Select…",
  ) => (
    <label>
      {label}
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          update();
        }}
      >
        <option value="">{empty}</option>
        {records.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
  const records = (kind: string) =>
    data.items.filter((r) => r.kind === kind && !r.archived);
  const cash = (n: number | null | undefined) =>
    n == null
      ? "—"
      : new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: /^[A-Z]{3}$/.test(currency) ? currency : "INR",
        }).format(n);
  return (
    <div className={styles.page}>
      <header>
        <div>
          <h2>Quotation recipe</h2>
          <p>
            Resolve an item from its masters before using it in a quotation.
          </p>
        </div>
        {template && data.canManage && (
          <Button size="compact" onPress={() => onEdit(template)}>
            Edit item recipe
          </Button>
        )}
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void calculate();
        }}
      >
        <div className={styles.inputs}>
          {choose("Room", roomId, setRoomId, records("room"))}
          {choose(
            "Item",
            templateId,
            (id) => {
              setTemplateId(id);
              setVariantId("");
              setSelections({});
              setValues({ jobs: "1", deliveries: "1" });
              setPreview(null);
            },
            templates,
          )}
          {choose(
            "Variant",
            variantId,
            setVariantId,
            variants,
            "Base configuration",
          )}
          <label>
            Grade
            <select
              value={grade}
              onChange={(e) => {
                setGrade(e.target.value);
                update();
              }}
            >
              {["Standard", "Premium", "Luxury"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          {choose(
            "Execution",
            executionId,
            (id) => {
              setExecutionId(id);
              setOverheadId(
                first(
                  id === first("EXEC-FACTORY")
                    ? "COM-OH-FACT"
                    : id === first("EXEC-ONSITE")
                      ? "COM-OH-SITE"
                      : "COM-OH-HYB",
                ),
              );
            },
            records("execution"),
          )}
        </div>
        <div className={styles.measurements}>
          {["width", "height", "depth", "length", "quantity"].map((key) => (
            <label key={key}>
              {key[0].toUpperCase() + key.slice(1)}
              <input
                type="number"
                step="any"
                min="0.001"
                aria-label={`Item ${key}`}
                placeholder="As needed"
                value={dimensions[key]}
                onChange={(e) => {
                  setDimensions((d) => ({ ...d, [key]: e.target.value }));
                  update();
                }}
              />
            </label>
          ))}
          <label>
            Dimension unit
            <select
              value={dimensionUnit}
              onChange={(e) => {
                setDimensionUnit(e.target.value);
                update();
              }}
            >
              {["ft", "m", "mm"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
        </div>
        <details className={styles.options}>
          <summary>Commercial settings · {currency}</summary>
          <div className={styles.inputs}>
            <label>
              Currency
              <input
                value={currency}
                maxLength={3}
                pattern="[A-Z]{3}"
                onChange={(e) => {
                  setCurrency(e.target.value.toUpperCase());
                  update();
                }}
              />
            </label>
            {choose(
              "Rate zone",
              rateZoneId,
              (id) => {
                setRateZoneId(id);
                const code = data.items.find((r) => r.id === id)?.configuration
                  ?.currency;
                if (code) setCurrency(String(code));
              },
              records("rate_zone"),
              "Workspace rates",
            )}
            {choose(
              "Overhead rule",
              overheadId,
              setOverheadId,
              records("commercial_rule").filter(
                (r) => r.configuration?.ruleGroup === "Overhead",
              ),
              "No overhead",
            )}
            {choose(
              "Target margin rule",
              marginId,
              setMarginId,
              records("commercial_rule").filter(
                (r) => r.configuration?.ruleGroup === "Margin",
              ),
            )}
            {choose(
              "Tax code",
              taxId,
              setTaxId,
              records("tax"),
              "Price before tax",
            )}
          </div>
        </details>
        <div className={styles.calculation}>
          <div>
            <span>Selling measurement</span>
            <strong>
              {stale ? "—" : (preview?.measurement.quantity ?? "—")}{" "}
              <small>{preview?.measurement.unit ?? ""}</small>
            </strong>
          </div>
          <p>
            {template?.name}{" "}
            {variantId
              ? `/ ${variants.find((v) => v.id === variantId)?.configuration?.variant ?? ""}`
              : ""}{" "}
            / {grade} / {execution?.name}
            {stale ? " · Changes need recalculation" : ""}
          </p>
          <Button
            type="submit"
            variant="primary"
            size="compact"
            isLoading={busy}
            isDisabled={!templateId || !executionId || busy}
          >
            Recalculate
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.body}>
        <div className={styles.tableArea}>
          <div className={styles.sectionHeading}>
            <h3>Components & processes</h3>
            <span>{preview?.lines.length ?? slots.length} lines</span>
          </div>
          <DataGrid ariaLabel="Resolved quotation recipe" data={preview?.lines ?? []} getRowId={line=>line.id} searchLabel="Search recipe" exportFileName="quotation-recipe.csv" selectable={false} columns={[{id:"name",header:"Component / process",size:240,accessorFn:line=>line.name,meta:{renderCell:line=>{
                  const slot = slots.find((r) => r.id === line.id);
                  const cfg = slot?.configuration ?? {};
                  const key = line.quantityInput;
                  const manual =
                    ["manual", "count"].includes(line.quantityBasis) && key;
                  const sourceKinds =
                    line.location === "factory" &&
                    cfg.recordRole === "operation"
                      ? ["factory_process"]
                      : cfg.recordRole === "operation"
                        ? ["site_process", "factory_process"]
                        : cfg.recordRole === "charge"
                          ? ["logistics_rule", "service"]
                          : [
                              "sku",
                              "material",
                              "hardware",
                              "consumable",
                              "work",
                              "service",
                            ];
                  return <>
                        <button
                          className={styles.editLink}
                          onClick={() => slot && onEdit(slot)}
                        >
                          {line.name.replace(`${template?.name} · `, "")}
                        </button>
                        <small>{line.location}</small>
                      </>;}}},
{id:"source",header:"Selected product or process",size:290,accessorFn:line=>line.source,meta:{renderCell:line=>{
                  const slot = slots.find((r) => r.id === line.id);
                  const cfg = slot?.configuration ?? {};
                  const key = line.quantityInput;
                  const manual =
                    ["manual", "count"].includes(line.quantityBasis) && key;
                  const sourceKinds =
                    line.location === "factory" &&
                    cfg.recordRole === "operation"
                      ? ["factory_process"]
                      : cfg.recordRole === "operation"
                        ? ["site_process", "factory_process"]
                        : cfg.recordRole === "charge"
                          ? ["logistics_rule", "service"]
                          : [
                              "sku",
                              "material",
                              "hardware",
                              "consumable",
                              "work",
                              "service",
                            ];
                  return <>
                        <select
                          aria-label={`Product for ${line.name}`}
                          value={selections[line.id] ?? line.sourceId ?? ""}
                          onChange={(e) => {
                            setSelections((s) => ({
                              ...s,
                              [line.id]: e.target.value,
                            }));
                            update();
                          }}
                        >
                          <option value="">Select product / process</option>
                          {data.items
                            .filter(
                              (r) =>
                                !r.archived && sourceKinds.includes(r.kind),
                            )
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                        </select>
                        {line.issues.length > 0 && (
                          <details className={styles.lineChecks}>
                            <summary>
                              {line.issues.length} setup{" "}
                              {line.issues.length === 1 ? "check" : "checks"}
                            </summary>
                            {line.issues.map((issue) => (
                              <small key={issue} className={styles.issue}>
                                {issue}
                              </small>
                            ))}
                          </details>
                        )}
                      </>;}}},
{id:"quantity",header:"Quantity",size:130,accessorFn:line=>line.quantity,meta:{renderCell:line=>{
                  const slot = slots.find((r) => r.id === line.id);
                  const cfg = slot?.configuration ?? {};
                  const key = line.quantityInput;
                  const manual =
                    ["manual", "count"].includes(line.quantityBasis) && key;
                  const sourceKinds =
                    line.location === "factory" &&
                    cfg.recordRole === "operation"
                      ? ["factory_process"]
                      : cfg.recordRole === "operation"
                        ? ["site_process", "factory_process"]
                        : cfg.recordRole === "charge"
                          ? ["logistics_rule", "service"]
                          : [
                              "sku",
                              "material",
                              "hardware",
                              "consumable",
                              "work",
                              "service",
                            ];
                  return <>
                        {manual ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            aria-label={`Quantity for ${line.name}`}
                            placeholder="Enter quantity"
                            value={values[key] ?? ""}
                            onChange={(e) => {
                              setValues((v) => ({
                                ...v,
                                [key]: e.target.value,
                              }));
                              update();
                            }}
                          />
                        ) : (
                          <strong>
                            {line.quantity == null
                              ? "—"
                              : Number(line.quantity.toFixed(3))}
                          </strong>
                        )}
                        <small>
                          {line.unit}
                          {line.allowedQuantity != null &&
                          line.allowedQuantity !== line.quantity
                            ? ` · with allowance ${line.allowedQuantity.toFixed(3)}`
                            : ""}
                        </small>
                      </>;}}},
{id:"amount",header:"Cost",size:140,accessorFn:line=>line.amount,meta:{renderCell:line=>{
                  const slot = slots.find((r) => r.id === line.id);
                  const cfg = slot?.configuration ?? {};
                  const key = line.quantityInput;
                  const manual =
                    ["manual", "count"].includes(line.quantityBasis) && key;
                  const sourceKinds =
                    line.location === "factory" &&
                    cfg.recordRole === "operation"
                      ? ["factory_process"]
                      : cfg.recordRole === "operation"
                        ? ["site_process", "factory_process"]
                        : cfg.recordRole === "charge"
                          ? ["logistics_rule", "service"]
                          : [
                              "sku",
                              "material",
                              "hardware",
                              "consumable",
                              "work",
                              "service",
                            ];
                  return <>
                        {stale || line.issues.length ? "—" : cash(line.amount)}
                      </>;}}}]}/>
          {inputKeys.some(
            (k) =>
              !preview?.lines.some(
                (l) =>
                  String(
                    slots.find((s) => s.id === l.id)?.configuration
                      ?.quantityInput,
                  ) === k,
              ),
          ) && (
            <details className={styles.options}>
              <summary>Optional component quantities</summary>
              <div className={styles.measurements}>
                {inputKeys
                  .filter(
                    (k) =>
                      !preview?.lines.some(
                        (l) =>
                          String(
                            slots.find((s) => s.id === l.id)?.configuration
                              ?.quantityInput,
                          ) === k,
                      ),
                  )
                  .map((k) => (
                    <label key={k}>
                      {k.replaceAll("_", " ")}
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={values[k] ?? ""}
                        onChange={(e) => {
                          setValues((v) => ({ ...v, [k]: e.target.value }));
                          update();
                        }}
                      />
                    </label>
                  ))}
              </div>
            </details>
          )}
        </div>
        <aside className={styles.summary}>
          <h3>Price calculation</h3>
          <dl>
            <dt>Direct cost</dt>
            <dd>{stale ? "—" : cash(preview?.directCost)}</dd>
            <dt>With overhead</dt>
            <dd>{stale ? "—" : cash(preview?.costBasis)}</dd>
            <dt>Price before tax</dt>
            <dd>{stale ? "—" : cash(preview?.priceBeforeTax)}</dd>
            <dt>Tax</dt>
            <dd>{stale ? "—" : cash(preview?.taxAmount)}</dd>
            <dt>Total</dt>
            <dd>{stale ? "—" : cash(preview?.priceAfterTax)}</dd>
          </dl>
          {preview?.issues.length ? (
            <>
              <p className={styles.issue}>
                {preview.issues.length} configuration checks remain. A final
                price is available when the required quantities and rates are
                complete.
              </p>
              <details>
                <summary>Show remaining setup</summary>
                <ul>
                  {preview.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </details>
            </>
          ) : null}
          {preview?.changes.length ? (
            <>
              <h4>Variant selections</h4>
              {preview.changes.map((change) => (
                <p key={change}>{change}</p>
              ))}
            </>
          ) : null}
          {preview?.warnings.length ? (
            <details>
              <summary>Specification notes</summary>
              <ul>
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <p>{preview?.estimateNote}</p>
        </aside>
      </div>
    </div>
  );
}
