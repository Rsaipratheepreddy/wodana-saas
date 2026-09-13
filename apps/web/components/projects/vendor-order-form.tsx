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
import { jsonRequest, money } from "@/lib/commercial/client";
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
    title: "Submit your offer",
    description: "Price, scope and lead time",
    icon: FileText,
  },
  {
    id: "acknowledgement",
    title: "Confirm availability",
    description: "Commit to scope and delivery dates",
    icon: CalendarDays,
  },
  {
    id: "progress",
    title: "Share work progress",
    description: "Completed work, risks or delays",
    icon: Factory,
  },
  {
    id: "delivery",
    title: "Notify delivery",
    description: "Quantity, date and delivery reference",
    icon: Truck,
  },
];
export function VendorOrderForm() {
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
    const t = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    token.current = t;
    void (async () => {
      if (!t)
        throw Error("Open the secure order link shared by your project team.");
      const next = await jsonRequest<Data>("/api/vendor-order", "POST", {
        token: t,
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
        "--wd-brand-gradient": `linear-gradient(110deg,${brand.primaryColor},${brand.accentColor})`,
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
      setNotice("Update received. Your project team can now review it.");
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
          <strong>{brand?.name ?? "Project workspace"}</strong>
        </div>
        <span>
          <ShieldCheck size={14} />
          Private vendor workspace
        </span>
      </header>
      {error && (
        <p role="alert" className={ui.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={s.success}>
          <Check size={17} />
          {notice}
        </p>
      )}
      {!data && !error && <p role="status">Opening your order…</p>}
      {o && (
        <>
          <section className={s.hero}>
            <div>
              <span>
                {o.number} ·{" "}
                {o.kind === "factory" ? "Factory order" : label(o.kind)}
              </span>
              <h1>{o.title}</h1>
              <p>Prepared for {o.vendor}</p>
            </div>
            <span className={ui.status} data-state={o.status}>
              {o.status === "enquiry" ? "Awaiting your offer" : label(o.status)}
            </span>
          </section>
          <div className={s.layout}>
            <aside className={s.orderSummary}>
              <h2>Order details</h2>
              <dl>
                <div>
                  <dt>Scope quantity</dt>
                  <dd>
                    {o.quantity} {o.unit}
                  </dd>
                </div>
                <div>
                  <dt>Required delivery</dt>
                  <dd>{o.promisedDate}</dd>
                </div>
                {o.workArea && (
                  <div>
                    <dt>Room / area</dt>
                    <dd>{o.workArea}</dd>
                  </div>
                )}
                {o.workTitle && (
                  <div>
                    <dt>Related work</dt>
                    <dd>{o.workTitle}</dd>
                  </div>
                )}
              </dl>
              {o.specification && (
                <section>
                  <h3>Specification</h3>
                  <p>{o.specification}</p>
                </section>
              )}
              {approved && (
                <section>
                  <h3>Delivery record</h3>
                  <div className={s.deliveryNumbers}>
                    <span>
                      <strong>{o.accepted}</strong>Accepted
                    </span>
                    <span>
                      <strong>{o.rejected}</strong>Rejected
                    </span>
                    <span>
                      <strong>{Math.max(0, o.quantity - o.accepted)}</strong>
                      Still due
                    </span>
                  </div>
                  <small>Quantities verified by the project team.</small>
                </section>
              )}
              {o.acknowledgement && (
                <section>
                  <h3>Confirmed scope & dates</h3>
                  <p>{o.acknowledgement}</p>
                </section>
              )}
            </aside>
            <div className={s.content}>
              {closed ? (
                <section className={s.actionPanel}>
                  <PackageCheck size={25} />
                  <h2>This order is {o.status}</h2>
                  <p>Your previous updates remain available below.</p>
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
                    Back to order
                  </button>
                  <h2>{current.title}</h2>
                  <p>
                    {current.description}. The project team reviews your update
                    before changing the order.
                  </p>
                  <fieldset disabled={busy}>
                    <div className={ui.grid}>
                      <label>
                        {form.kind === "delivery"
                          ? "Delivery date"
                          : form.kind === "progress"
                            ? "Progress date"
                            : "Proposed delivery date"}
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
                          ? "Completed quantity"
                          : form.kind === "delivery"
                            ? "Quantity in this delivery"
                            : "Offered / confirmed quantity"}{" "}
                        ({o.unit})
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
                          Unit price ({o.currency})
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
                        <span>Your offer · before taxes</span>
                        <strong>
                          {money(form.quantity * form.unitCost, o.currency)}
                        </strong>
                      </div>
                    )}
                    <label>
                      {form.kind === "quotation"
                        ? "Scope, inclusions, exclusions & payment terms"
                        : form.kind === "progress"
                          ? "Completed work, issues & expected finish"
                          : form.kind === "delivery"
                            ? "Delivery details & contact"
                            : "Availability, scope & date confirmation"}
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
                        ? "Delivery note / tracking reference"
                        : "Supporting document reference or link"}
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
                      {busy ? "Submitting…" : "Submit update"}
                      <ArrowRight size={15} />
                    </button>
                  </fieldset>
                </form>
              ) : (
                <section className={s.actionPanel}>
                  <span className={s.eyebrow}>YOUR NEXT STEP</span>
                  <h2>
                    {approved
                      ? "Keep delivery on track"
                      : "Review the scope and respond"}
                  </h2>
                  <p>
                    {approved
                      ? "Confirm your dates, share progress and tell the team when delivery is on its way."
                      : "Check the specifications and required date, then share your offer or availability."}
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
                                ? "Confirm order & dates"
                                : a.title}
                            </strong>
                            <small>{a.description}</small>
                          </span>
                          <ArrowRight size={15} />
                        </button>
                      ))}
                  </div>
                </section>
              )}
              <section className={s.updates}>
                <h2>
                  Updates & responses <span>{o.updates.length}</span>
                </h2>
                {o.updates.length ? (
                  <ol>
                    {[...o.updates].reverse().map((u) => (
                      <li key={u.id}>
                        <span className={s.dot} />
                        <div>
                          <strong>
                            {label(u.kind)} <small>{u.date}</small>
                          </strong>
                          <p>{u.note}</p>
                          {u.evidence && <p>{u.evidence}</p>}
                          <small>
                            {u.quantity} {o.unit}
                            {u.unitCost !== undefined
                              ? ` · ${money(u.quantity * u.unitCost, o.currency)}`
                              : ""}{" "}
                            · Submitted {new Date(u.at).toLocaleString()}
                          </small>
                        </div>
                        <Check size={15} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>
                    Your submitted offers, confirmations and delivery updates
                    will appear here.
                  </p>
                )}
              </section>
            </div>
          </div>
          <footer className={s.footer}>
            <ShieldCheck size={14} />
            This link gives access to this order only · expires{" "}
            {new Date(data!.expiresAt).toLocaleDateString()}
          </footer>
        </>
      )}
    </main>
  );
}
