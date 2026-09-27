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
import { Checkbox, Skeleton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
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
  const t = useT();
  const { locale } = useDesignSystem();
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
        {t("Set when each payment is due. This schedule follows the accepted quotation into Agreement & payments.")}
      </p>
      {quote.direction === "deduction" ? (
        <p>
          {t("Acceptance records a client credit of {amount}.", { amount: money(total, quote.currency, locale) })}
        </p>
      ) : (
        <>
          <label>
            {t("Use a saved payment schedule")}
            <select
              aria-label={t("Payment schedule template")}
              value=""
              onChange={(e) => {
                const template = templates.find((item) => item.id === e.target.value);
                if (template)
                  onChange({
                    ...quote,
                    paymentTerms: template.milestones.map((m) => ({
                      ...m,
                      id: crypto.randomUUID(),
                    })),
                    paymentTemplate: {
                      id: template.id,
                      name: template.name,
                      version: template.version,
                    },
                  });
              }}
            >
              <option value="">{t("Choose schedule…")}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <div
            className={d.allocation}
            data-ready={Math.abs(sum - 100) < 0.001}
          >
            <strong>{sum.toFixed(2)}%</strong>
            <span>{t("of 100% allocated")}</span>
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
                  terms.findIndex((item) => item.id === drag),
                  i,
                );
                setDrag("");
              }}
            >
              <div className={d.milestoneHead}>
                <span
                  draggable
                  title={t("Drag to reorder")}
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
                    aria-label={t("Move {title} up", { title: term.title })}
                    disabled={!i}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    aria-label={t("Move {title} down", { title: term.title })}
                    disabled={i === terms.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    aria-label={t("Remove milestone {number}", { number: i + 1 })}
                    onClick={() =>
                      onChange({
                        ...quote,
                        paymentTerms: terms.filter((item) => item.id !== term.id),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <label>
                {t("Milestone")}
                <input
                  aria-label={t("Milestone {number} title", { number: i + 1 })}
                  value={term.title}
                  maxLength={160}
                  onChange={(e) =>
                    onChange({
                      ...quote,
                      paymentTerms: terms.map((item) =>
                        item.id === term.id ? { ...item, title: e.target.value } : item,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t("When due")}
                <input
                  aria-label={t("Milestone {number} trigger", { number: i + 1 })}
                  value={term.trigger}
                  maxLength={500}
                  placeholder={t("e.g. On signing the agreement")}
                  onChange={(e) =>
                    onChange({
                      ...quote,
                      paymentTerms: terms.map((item) =>
                        item.id === term.id
                          ? { ...item, trigger: e.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t("Percentage")}
                <QuotationNumberInput
                  label={t("Milestone {number} percentage", { number: i + 1 })}
                  value={term.percent}
                  max={100}
                  onChange={(percent) =>
                    onChange({
                      ...quote,
                      paymentTerms: terms.map((item) =>
                        item.id === term.id ? { ...item, percent } : item,
                      ),
                    })
                  }
                />
              </label>
              <div className={d.itemTotal}>
                <span>{t("Amount")}</span>
                <strong>
                  {money(
                    paymentMilestoneAmounts(total, terms)[i],
                      quote.currency,
                      locale,
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
                      paymentTerms: terms.map((item) =>
                        item.id === term.id
                          ? { ...item, requiredForRelease: e.target.checked }
                          : item,
                      ),
                    })
                  }
                />
                {t("Required before project release")}
              </label>
              <Checkbox
                isSelected={term.requiredForProduction === true}
                onChange={(selected) =>
                  onChange({
                    ...quote,
                    paymentTerms: terms.map((item) =>
                      item.id === term.id
                        ? { ...item, requiredForProduction: selected }
                        : item,
                    ),
                  })
                }
              >
                {t("Required before manufacturing starts")}
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
            {t("Add milestone")}
          </button>
          <section className={d.details}>
            <h3>{t("Save this payment schedule")}</h3>
            <label>
              {t("Schedule name")}
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
                  (item) => !item.title.trim() || !item.trigger.trim() || item.percent <= 0,
                )
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const template = await jsonRequest<PaymentTemplate>(
                    commercialPath(workspaceId, "payment-templates"),
                    "PUT",
                    { name, milestones: terms },
                  );
                  setTemplates([template, ...templates]);
                  setName("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("Save schedule")}
            </button>
          </section>
        </>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {translateKnown(t, error)}
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
  const t = useT();
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
        {t("Reuse rooms, items, materials, rates, terms and payment schedules. Client details and approval history stay with their quotation.")}
      </p>
      {canEdit && quote.kind === "quotation" && (
        <div className={d.templateSave}>
          <label>
            {t("Template name")}
            <input
              placeholder={t("e.g. Villa · joinery package")}
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
                    t("Save the quotation successfully before creating its template."),
                  );
                const template = await jsonRequest<QuotationTemplate>(
                  commercialPath(workspaceId, "quotation-templates"),
                  "PUT",
                  { name, caseId, quoteId: quote.id },
                );
                setTemplates([template, ...templates]);
                setName("");
                setNotice(t("Template saved for your workspace."));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <BookCopy size={14} />
            {t("Save quotation as template")}
          </button>
        </div>
      )}
      {loading && <Skeleton lines={4} />}
      {!loading && !templates.length && !error && (
        <p className={d.hint}>
          {t("Your saved quotation templates will appear here.")}
        </p>
      )}
      {templates.map((template) => (
        <div key={template.id} className={d.templateCard}>
          <span className={d.templateIcon}>
            <BookCopy size={22} />
          </span>
          <strong>{template.name}</strong>
          <small>
            {t("{count} items · {currency}", { count: template.content.lines.length, currency: template.content.currency })}
          </small>
          <p>
            {[...new Set(template.content.lines.map((l) => l.room))]
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
                }>(commercialPath(workspaceId, `quotation-templates/${template.id}`));
                setChosen(prepared.template);
                setWarnings(prepared.warnings);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Review & use")}
          </button>
        </div>
      ))}
      {chosen && (
        <section
          className={d.templateConfirm}
          aria-label={t("Apply quotation template")}
        >
          <strong>{t("Use {name}?", { name: chosen.name })}</strong>
          <p>
            {t("This replaces the draft’s {count} items, materials, terms and payment schedule with {templateCount} template items. Your client details stay in place.", { count: quote.lines.length, templateCount: chosen.content.lines.length })}
          </p>
          <p>
            {t("Rates are copied exactly in {currency}. Catalog links have been checked against the current workspace.", { currency: chosen.content.currency })}
          </p>
          {warnings.length > 0 && (
            <ul>
              {warnings.map((w) => (
                <li key={w}>{translateKnown(t, w)}</li>
              ))}
            </ul>
          )}
          <div className={s.actions}>
            <button
              className={s.primary}
              onClick={() => {
                try {
                  onChange(applyQuotationTemplate(quote, chosen, t));
                  setChosen(null);
                  setNotice(
                    t("Template applied to your draft. Review materials and rates, then save."),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {t("Replace draft scope")}
            </button>
            <button className={s.button} onClick={() => setChosen(null)}>
              {t("Cancel")}
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
          {translateKnown(t, error)}
        </p>
      )}
    </div>
  );
}
