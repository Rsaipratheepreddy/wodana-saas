"use client";
import { useEffect, useState, useRef, type CSSProperties } from "react";
import {
  ArrowRight,
  ArrowLeft,
  CalendarDays,
  FileText,
  PackageCheck,
  Truck,
  Check,
  ShieldCheck,
  Factory,
} from "lucide-react";
import { useDesignSystem } from "@/design-system";
import { jsonRequest, money } from "@/lib/commercial/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import { label } from "@/lib/projects/execution";
import theme from "../crm/crm-workspace-colors.module.css";
import ui from "./project-workspace.module.css";
import s from "./vendor-order.module.css";
type Update = {
  id: string;
  at: string;
  kind: string;
  note: string;
  date: string;
  quantity: number;
  unitCost?: number;
  evidence: string;
};
type Data = {
  brand: {
    name: string;
    logo: string;
    primaryColor: string;
    accentColor: string;
  } | null;
  order: {
    number: string;
    title: string;
    vendor: string;
    kind: string;
    quantity: number;
    unit: string;
    currency: string;
    status: string;
    promisedDate: string;
    specification: string;
    workTitle: string;
    workArea: string;
    accepted: number;
    rejected: number;
    acknowledgement: string;
    updates: Update[];
  };
  expiresAt: string;
};
const actions = [
  {
    id: "quotation",
    title: tKey("Submit your offer"),
    description: tKey("Price, scope and lead time"),
    icon: FileText,
  },
  {
    id: "acknowledgement",
    title: tKey("Confirm availability"),
    description: tKey("Commit to scope and delivery dates"),
    icon: CalendarDays,
  },
  {
    id: "progress",
    title: tKey("Share work progress"),
    description: tKey("Completed work, risks or delays"),
    icon: Factory,
  },
  {
    id: "delivery",
    title: tKey("Notify delivery"),
    description: tKey("Quantity, date and delivery reference"),
    icon: Truck,
  },
];
/** Order kinds, order states and update kinds the supplier sees; anything unknown is humanized. */
const vendorLabels: Record<string, string> = {
  material: tKey("Material"), subcontract: tKey("Subcontract"),
  draft: tKey("Draft"), submitted: tKey("Submitted"), approved: tKey("Approved"), acknowledged: tKey("Acknowledged"), closed: tKey("Closed"), cancelled: tKey("Cancelled"),
  quotation: tKey("Quotation"), acknowledgement: tKey("Acknowledgement"), progress: tKey("Progress"), delivery: tKey("Delivery"),
};
export function VendorOrderForm() {
  const t = useT();
  const { locale } = useDesignSystem();
  const text = (value: string) => vendorLabels[value] ? t(vendorLabels[value] as never) : label(value);
  const token = useRef(""),
    retry = useRef(crypto.randomUUID());
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [editing, setEditing] = useState(false),
    [form, setForm] = useState({
      kind: "acknowledgement",
      note: "",
      evidence: "",
      date: new Date().toISOString().slice(0, 10),
      quantity: 0,
      unitCost: 0,
    });
  useEffect(() => {
    let active = true;
    const link = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    token.current = link;
    void (async () => {
      if (!link)
        throw Error(tKey("Open the secure order link shared by your project team."));
      const next = await jsonRequest<Data>("/api/vendor-order", "POST", {
        token: link,
        action: "read",
      });
      if (active) {
        setData(next);
        setForm((f) => ({
          ...f,
          date: next.order.promisedDate,
          quantity: next.order.quantity,
          kind:
            next.order.status === "enquiry" ? "quotation" : "acknowledgement",
        }));
      }
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, []);
  const o = data?.order,
    brand = data?.brand,
    closed = o && ["closed", "cancelled"].includes(o.status),
    approved = o && ["approved", "acknowledged", "closed"].includes(o.status),
    current = actions.find((a) => a.id === form.kind)!;
  const brandStyle = brand
    ? ({
        "--wd-brand-gradient": brand.primaryColor,
        "--vendor-tint": brand.primaryColor,
      } as CSSProperties)
    : {};
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setData(
        await jsonRequest<Data>("/api/vendor-order", "POST", {
          token: token.current,
          action: "submit",
          requestId: retry.current,
          ...form,
        }),
      );
      retry.current = crypto.randomUUID();
      setEditing(false);
      setNotice(t("Update received. Your project team can now review it."));
      setForm((f) => ({ ...f, note: "", evidence: "" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={`${theme.theme} ${s.vendor}`} style={brandStyle}>
      <header className={s.brandHeader}>
        <div>
          {brand?.logo ? (
            <img src={brand.logo} alt={brand.name} />
          ) : (
            <span className={s.brandMark}>
              {brand?.name?.slice(0, 1) || "W"}
            </span>
          )}
          <strong>{brand?.name ?? t("Project workspace")}</strong>
        </div>
        <span>
          <ShieldCheck size={14} />
          {t("Private supplier workspace")}
        </span>
      </header>
      {error && (
        <p role="alert" className={ui.error}>
          {translateKnown(t, error)}
        </p>
      )}
      {notice && (
        <p role="status" className={s.success}>
          <Check size={17} />
          {notice}
        </p>
      )}
      {!data && !error && <p role="status">{t("Opening your order…")}</p>}
      {o && (
        <>
          <section className={s.hero}>
            <div>
              <span>
                {o.number} ·{" "}
                {o.kind === "factory" ? t("Factory order") : text(o.kind)}
              </span>
              <h1>{o.title}</h1>
              <p>{t("Prepared for {vendor}", { vendor: o.vendor })}</p>
            </div>
            <span className={ui.status} data-state={o.status}>
              {o.status === "enquiry" ? t("Awaiting your offer") : text(o.status)}
            </span>
          </section>
          <div className={s.layout}>
            <aside className={s.orderSummary}>
              <h2>{t("Order details")}</h2>
              <dl>
                <div>
                  <dt>{t("Scope quantity")}</dt>
                  <dd>
                    {o.quantity} {o.unit}
                  </dd>
                </div>
                <div>
                  <dt>{t("Required delivery")}</dt>
                  <dd>{o.promisedDate}</dd>
                </div>
                {o.workArea && (
                  <div>
                    <dt>{t("Room / area")}</dt>
                    <dd>{o.workArea}</dd>
                  </div>
                )}
                {o.workTitle && (
                  <div>
                    <dt>{t("Related work")}</dt>
                    <dd>{o.workTitle}</dd>
                  </div>
                )}
              </dl>
              {o.specification && (
                <section>
                  <h3>{t("Specification")}</h3>
                  <p>{o.specification}</p>
                </section>
              )}
              {approved && (
                <section>
                  <h3>{t("Delivery record")}</h3>
                  <div className={s.deliveryNumbers}>
                    <span>
                      <strong>{o.accepted}</strong>{t("Accepted")}
                    </span>
                    <span>
                      <strong>{o.rejected}</strong>{t("Rejected")}
                    </span>
                    <span>
                      <strong>{Math.max(0, o.quantity - o.accepted)}</strong>
                      {t("Still due")}
                    </span>
                  </div>
                  <small>{t("Quantities verified by the project team.")}</small>
                </section>
              )}
              {o.acknowledgement && (
                <section>
                  <h3>{t("Confirmed scope & dates")}</h3>
                  <p>{o.acknowledgement}</p>
                </section>
              )}
            </aside>
            <div className={s.content}>
              {closed ? (
                <section className={s.actionPanel}>
                  <PackageCheck size={25} />
                  <h2>{o.status === "cancelled" ? t("This order is cancelled") : t("This order is closed")}</h2>
                  <p>{t("Your previous updates remain available below.")}</p>
                </section>
              ) : editing ? (
                <form
                  className={`${ui.form} ${s.actionPanel}`}
                  onSubmit={submit}
                >
                  <button
                    className={s.back}
                    type="button"
                    onClick={() => setEditing(false)}
                  >
                    <ArrowLeft size={14} />
                    {t("Back to order")}
                  </button>
                  <h2>{t(current.title as never)}</h2>
                  <p>
                    {t(current.description as never)}. {t("The project team reviews your update before changing the order.")}
                  </p>
                  <fieldset disabled={busy}>
                    <div className={ui.grid}>
                      <label>
                        {form.kind === "delivery"
                          ? t("Delivery date")
                          : form.kind === "progress"
                            ? t("Progress date")
                            : t("Proposed delivery date")}
                        <input
                          required
                          type="date"
                          value={form.date}
                          onChange={(e) =>
                            setForm({ ...form, date: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        {form.kind === "progress"
                          ? t("Completed quantity ({unit})", { unit: o.unit })
                          : form.kind === "delivery"
                            ? t("Quantity in this delivery ({unit})", { unit: o.unit })
                            : t("Offered / confirmed quantity ({unit})", { unit: o.unit })}
                        <input
                          required
                          type="number"
                          min="0"
                          max={o.quantity}
                          step="any"
                          value={form.quantity}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              quantity: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      {form.kind === "quotation" && (
                        <label>
                          {t("Unit price ({currency})", { currency: o.currency })}
                          <input
                            required
                            type="number"
                            min="0"
                            step=".01"
                            value={form.unitCost}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                unitCost: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                    {form.kind === "quotation" && (
                      <div className={s.offerTotal}>
                        <span>{t("Your offer · before taxes")}</span>
                        <strong>
                          {money(form.quantity * form.unitCost, o.currency, locale)}
                        </strong>
                      </div>
                    )}
                    <label>
                      {form.kind === "quotation"
                        ? t("Scope, inclusions, exclusions & payment terms")
                        : form.kind === "progress"
                          ? t("Completed work, issues & expected finish")
                          : form.kind === "delivery"
                            ? t("Delivery details & contact")
                            : t("Availability, scope & date confirmation")}
                      <textarea
                        required
                        rows={4}
                        value={form.note}
                        onChange={(e) =>
                          setForm({ ...form, note: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {form.kind === "delivery"
                        ? t("Delivery note / tracking reference")
                        : t("Supporting document reference or link")}
                      <textarea
                        rows={2}
                        value={form.evidence}
                        onChange={(e) =>
                          setForm({ ...form, evidence: e.target.value })
                        }
                      />
                    </label>
                    <button
                      className={ui.primary}
                      disabled={busy || !form.note.trim()}
                    >
                      {busy ? t("Submitting…") : t("Submit update")}
                      <ArrowRight size={15} />
                    </button>
                  </fieldset>
                </form>
              ) : (
                <section className={s.actionPanel}>
                  <span className={s.eyebrow}>{t("YOUR NEXT STEP")}</span>
                  <h2>
                    {approved
                      ? t("Keep delivery on track")
                      : t("Review the scope and respond")}
                  </h2>
                  <p>
                    {approved
                      ? t("Confirm your dates, share progress and tell the team when delivery is on its way.")
                      : t("Check the specifications and required date, then share your offer or availability.")}
                  </p>
                  <div className={s.actionChoices}>
                    {actions
                      .filter((a) =>
                        approved
                          ? a.id !== "quotation"
                          : ["quotation", "acknowledgement"].includes(a.id),
                      )
                      .map((a) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            setForm((f) => ({ ...f, kind: a.id }));
                            setEditing(true);
                            setError("");
                          }}
                        >
                          <a.icon size={21} />
                          <span>
                            <strong>
                              {a.id === "acknowledgement" && approved
                                ? t("Confirm order & dates")
                                : t(a.title as never)}
                            </strong>
                            <small>{t(a.description as never)}</small>
                          </span>
                          <ArrowRight size={15} />
                        </button>
                      ))}
                  </div>
                </section>
              )}
              <section className={s.updates}>
                <h2>
                  {t("Updates & responses")} <span>{o.updates.length}</span>
                </h2>
                {o.updates.length ? (
                  <ol>
                    {[...o.updates].reverse().map((u) => (
                      <li key={u.id}>
                        <span className={s.dot} />
                        <div>
                          <strong>
                            {text(u.kind)} <small>{u.date}</small>
                          </strong>
                          <p>{u.note}</p>
                          {u.evidence && <p>{u.evidence}</p>}
                          <small>
                            {u.quantity} {o.unit}
                            {u.unitCost !== undefined
                              ? ` · ${money(u.quantity * u.unitCost, o.currency, locale)}`
                              : ""}{" "}
                            · {t("Submitted {date}", { date: new Date(u.at).toLocaleString(locale) })}
                          </small>
                        </div>
                        <Check size={15} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>
                    {t("Your submitted offers, confirmations and delivery updates will appear here.")}
                  </p>
                )}
              </section>
            </div>
          </div>
          <footer className={s.footer}>
            <ShieldCheck size={14} />
            {t("This link gives access to this order only · expires {date}", { date: new Date(data!.expiresAt).toLocaleDateString(locale) })}
          </footer>
        </>
      )}
    </main>
  );
}
