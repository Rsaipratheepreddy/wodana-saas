"use client";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookCopy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  Quote,
  PaymentTemplate,
  QuotationTemplate,
} from "@/lib/commercial/types";
import {
  commercialPath,
  jsonRequest,
  money,
  quoteTotals,
  paymentMilestoneAmounts,
} from "@/lib/commercial/client";
import { applyQuotationTemplate } from "@/lib/commercial/templates";
import { Checkbox, Skeleton } from "@/design-system";
import { QuotationNumberInput } from "./quotation-number-input";
import s from "./commercial.module.css";
import d from "./quotation-studio.module.css";

export function QuotationPaymentInspector({
  quote,
  onChange,
  workspaceId,
}: {
  quote: Quote;
  onChange: (q: Quote) => void;
  workspaceId: string;
}) {
  const [templates, setTemplates] = useState<PaymentTemplate[]>([]),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [drag, setDrag] = useState("");
  const terms = quote.paymentTerms,
    sum = terms.reduce((s, m) => s + m.percent, 0);
  useEffect(() => {
    let live = true;
    jsonRequest<{ items: PaymentTemplate[] }>(
      commercialPath(workspaceId, "payment-templates"),
    )
      .then((r) => {
        if (live) setTemplates(r.items);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [workspaceId]);
  const move = (from: number, to: number) => {
    if (from < 0 || to < 0 || to >= terms.length) return;
    const next = [...terms];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange({ ...quote, paymentTerms: next });
  };
  const total = quoteTotals(quote).total;
  return (
    <div className={d.fields}>
      <p className={d.hint}>
        Set when each payment is due. This schedule follows the accepted
        quotation into Agreement & payments.
      </p>
      {quote.direction === "deduction" ? (
        <p>
          Acceptance records a client credit of {money(total, quote.currency)}.
        </p>
      ) : (
        <>
          <label>
            Use a saved payment schedule
            <select
              aria-label="Payment schedule template"
              value=""
              onChange={(e) => {
                const t = templates.find((t) => t.id === e.target.value);
                if (t)
                  onChange({
                    ...quote,
                    paymentTerms: t.milestones.map((m) => ({
                      ...m,
                      id: crypto.randomUUID(),
                    })),
                    paymentTemplate: {
                      id: t.id,
                      name: t.name,
                      version: t.version,
                    },
                  });
              }}
            >
              <option value="">Choose schedule…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <div
            className={d.allocation}
            data-ready={Math.abs(sum - 100) < 0.001}
          >
            <strong>{sum.toFixed(2)}%</strong>
            <span>of 100% allocated</span>
          </div>
          {terms.map((term, i) => (
            <section
              className={d.milestone}
              key={term.id}
              onDragOver={(e) => {
                if (drag) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                move(
                  terms.findIndex((t) => t.id === drag),
                  i,
                );
                setDrag("");
              }}
            >
              <div className={d.milestoneHead}>
                <span
                  draggable
                  title="Drag to reorder"
                  onDragStart={(e) => {
                    setDrag(term.id);
                    e.dataTransfer.setData("text/plain", term.id);
                  }}
                  onDragEnd={() => setDrag("")}
                >
                  <GripVertical size={14} />
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <button
                    aria-label={`Move ${term.title} up`}
                    disabled={!i}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    aria-label={`Move ${term.title} down`}
                    disabled={i === terms.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    aria-label={`Remove milestone ${i + 1}`}
                    onClick={() =>
                      onChange({
                        ...quote,
                        paymentTerms: terms.filter((t) => t.id !== term.id),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <label>
                Milestone
                <input
                  aria-label={`Milestone ${i + 1} title`}
                  value={term.title}
                  maxLength={160}
                  onChange={(e) =>
                    onChange({
                      ...quote,
                      paymentTerms: terms.map((t) =>
                        t.id === term.id ? { ...t, title: e.target.value } : t,
                      ),
                    })
                  }
                />
              </label>
              <label>
                When due
                <input
                  aria-label={`Milestone ${i + 1} trigger`}
                  value={term.trigger}
                  maxLength={500}
                  placeholder="e.g. On signing the agreement"
                  onChange={(e) =>
                    onChange({
                      ...quote,
                      paymentTerms: terms.map((t) =>
                        t.id === term.id
                          ? { ...t, trigger: e.target.value }
                          : t,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Percentage
                <QuotationNumberInput
                  label={`Milestone ${i + 1} percentage`}
                  value={term.percent}
                  max={100}
                  onChange={(percent) =>
                    onChange({
                      ...quote,
                      paymentTerms: terms.map((t) =>
                        t.id === term.id ? { ...t, percent } : t,
                      ),
                    })
                  }
                />
              </label>
              <div className={d.itemTotal}>
                <span>Amount</span>
                <strong>
                  {money(
                    paymentMilestoneAmounts(total, terms)[i],
                      quote.currency,
                  )}
                </strong>
              </div>
              <label className={d.check}>
                <input
                  type="checkbox"
                  checked={term.requiredForRelease}
                  onChange={(e) =>
                    onChange({
                      ...quote,
                      paymentTerms: terms.map((t) =>
                        t.id === term.id
                          ? { ...t, requiredForRelease: e.target.checked }
                          : t,
                      ),
                    })
                  }
                />
                Required before project release
              </label>
              <Checkbox
                isSelected={term.requiredForProduction === true}
                onChange={(selected) =>
                  onChange({
                    ...quote,
                    paymentTerms: terms.map((t) =>
                      t.id === term.id
                        ? { ...t, requiredForProduction: selected }
                        : t,
                    ),
                  })
                }
              >
                Required before manufacturing starts
              </Checkbox>
            </section>
          ))}
          <button
            className={s.button}
            disabled={terms.length >= 20}
            onClick={() =>
              onChange({
                ...quote,
                paymentTerms: [
                  ...terms,
                  {
                    id: crypto.randomUUID(),
                    title: "",
                    trigger: "",
                    percent: Math.max(0, 100 - sum),
                    requiredForRelease: false,
                    requiredForProduction: false,
                  },
                ],
              })
            }
          >
            <Plus size={14} />
            Add milestone
          </button>
          <section className={d.details}>
            <h3>Save this payment schedule</h3>
            <label>
              Schedule name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={160}
              />
            </label>
            <button
              className={s.button}
              disabled={
                busy ||
                !name.trim() ||
                Math.abs(sum - 100) > 0.001 ||
                terms.some(
                  (t) => !t.title.trim() || !t.trigger.trim() || t.percent <= 0,
                )
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const t = await jsonRequest<PaymentTemplate>(
                    commercialPath(workspaceId, "payment-templates"),
                    "PUT",
                    { name, milestones: terms },
                  );
                  setTemplates([t, ...templates]);
                  setName("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save schedule
            </button>
          </section>
        </>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </div>
  );
}

export function QuotationTemplateLibrary({
  quote,
  onChange,
  workspaceId,
  caseId,
  onSave,
  canEdit,
}: {
  quote: Quote;
  onChange: (q: Quote) => void;
  workspaceId: string;
  caseId: string;
  onSave: () => Promise<boolean>;
  canEdit: boolean;
}) {
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [chosen, setChosen] = useState<QuotationTemplate | null>(null),
    [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    jsonRequest<{ items: QuotationTemplate[] }>(
      commercialPath(workspaceId, "quotation-templates"),
    )
      .then((r) => {
        if (live) setTemplates(r.items);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [workspaceId]);
  return (
    <div className={d.fields}>
      <p className={d.hint}>
        Reuse rooms, items, materials, rates, terms and payment schedules.
        Client details and approval history stay with their quotation.
      </p>
      {canEdit && quote.kind === "quotation" && (
        <div className={d.templateSave}>
          <label>
            Template name
            <input
              placeholder="e.g. Villa · joinery package"
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className={s.primary}
            disabled={busy || !name.trim() || !quote.lines.length}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                if (quote.status === "draft" && !(await onSave()))
                  throw new Error(
                    "Save the quotation successfully before creating its template.",
                  );
                const t = await jsonRequest<QuotationTemplate>(
                  commercialPath(workspaceId, "quotation-templates"),
                  "PUT",
                  { name, caseId, quoteId: quote.id },
                );
                setTemplates([t, ...templates]);
                setName("");
                setNotice("Template saved for your workspace.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <BookCopy size={14} />
            Save quotation as template
          </button>
        </div>
      )}
      {loading && <Skeleton lines={4} />}
      {!loading && !templates.length && !error && (
        <p className={d.hint}>
          Your saved quotation templates will appear here.
        </p>
      )}
      {templates.map((t) => (
        <div key={t.id} className={d.templateCard}>
          <span className={d.templateIcon}>
            <BookCopy size={22} />
          </span>
          <strong>{t.name}</strong>
          <small>
            {t.content.lines.length} items · {t.content.currency}
          </small>
          <p>
            {[...new Set(t.content.lines.map((l) => l.room))]
              .slice(0, 4)
              .join(" · ")}
          </p>
          <button
            className={s.button}
            disabled={
              busy ||
              !canEdit ||
              quote.status !== "draft" ||
              quote.kind !== "quotation"
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const prepared = await jsonRequest<{
                  template: QuotationTemplate;
                  warnings: string[];
                }>(commercialPath(workspaceId, `quotation-templates/${t.id}`));
                setChosen(prepared.template);
                setWarnings(prepared.warnings);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Review & use
          </button>
        </div>
      ))}
      {chosen && (
        <section
          className={d.templateConfirm}
          aria-label="Apply quotation template"
        >
          <strong>Use {chosen.name}?</strong>
          <p>
            This replaces the draft’s {quote.lines.length} items, materials,
            terms and payment schedule with {chosen.content.lines.length}{" "}
            template items. Your client details stay in place.
          </p>
          <p>
            Rates are copied exactly in {chosen.content.currency}. Catalog links
            have been checked against the current workspace.
          </p>
          {warnings.length > 0 && (
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className={s.actions}>
            <button
              className={s.primary}
              onClick={() => {
                try {
                  onChange(applyQuotationTemplate(quote, chosen));
                  setChosen(null);
                  setNotice(
                    "Template applied to your draft. Review materials and rates, then save.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Replace draft scope
            </button>
            <button className={s.button} onClick={() => setChosen(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
      {notice && (
        <p role="status" className={d.hint}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </div>
  );
}
