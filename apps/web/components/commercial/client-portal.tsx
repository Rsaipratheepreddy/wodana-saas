"use client";
import { useEffect, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  MessageSquare,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { ControlledModalDialog, DesignSystemProvider } from "@/design-system";
import type {
  ClientCase,
  ClientQuote,
  PortalSettings,
} from "@/lib/commercial/types";
import { jsonRequest, money, statusLabel } from "@/lib/commercial/client";
import { BrandLogo } from "./portal-settings";
import { ClientQuotation } from "./client-quotation";
import p from "./client-portal.module.css";
type PortalData = { name: string; phone: string; cases: ClientCase[] };
const onBrand = (hex: string) => {
  const value = /^#[\da-f]{6}$/i.test(hex) ? hex.slice(1) : "694f7a";
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return red * 0.299 + green * 0.587 + blue * 0.114 > 155 ? "#211b24" : "#ffffff";
};
const tabs = [
  ["home", "Home"],
  ["approvals", "Approvals"],
  ["payments", "Payments"],
  ["project", "Progress"],
  ["requests", "Messages"],
];
export function ClientPortal({ settings }: { settings: PortalSettings }) {
  const [data, setData] = useState<PortalData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("home"),
    [caseId, setCaseId] = useState(""),
    [quoteId, setQuoteId] = useState(""),
    [designVersionId,setDesignVersionId] = useState(""),
    [materialApprovalId,setMaterialApprovalId] = useState(""),
    [country, setCountry] = useState("+971"),
    [mobile, setMobile] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState(""),
    [resendAt, setResendAt] = useState(0),
    [clock, setClock] = useState(() => Date.now()),
    [dialog, setDialog] = useState(""),
    [decision, setDecision] = useState("accept"),
    [note, setNote] = useState(""),
    [requestTitle, setRequestTitle] = useState(""),
    [requestId, setRequestId] = useState(""),
    [paymentId, setPaymentId] = useState(""),
    [notice, setNotice] = useState(""),
    [container, setContainer] = useState<HTMLElement | null>(null);
  const api = (action: string) =>
    `/api/client-portal/${settings.slug}/${action}`;
  const current = data?.cases.find((c) => c.id === caseId) ?? data?.cases[0],
    quote =
      current?.quotes.find((q) => q.id === quoteId) ?? current?.quotes.at(-1),
    request = current?.requests.find((r) => r.id === requestId),
    brand = settings.brand;
  const selectedDesign=current?.designs?.find(d=>d.id===designVersionId);
  const selectedMaterial=current?.materials?.find(item=>item.id===materialApprovalId);
  const decisionPurpose=`${dialog==='material-decision'?'material-decision':dialog==='design-decision'?'design-decision':'decision'}:${current?.id}:${dialog==='material-decision'?selectedMaterial?.id:dialog==='design-decision'?selectedDesign?.id:quote?.id}:${decision}`;
  function openDesignDecision(id:string,value:string){setDesignVersionId(id);setDecision(value);setDialog('design-decision');setNote('');setCode('');setChallenge('');setError('');}
  function openMaterialDecision(id:string,value:string){setMaterialApprovalId(id);setDecision(value);setDialog('material-decision');setNote('');setCode('');setChallenge('');setError('');}
  const style = {
    "--portal-primary": brand.primaryColor,
    "--portal-accent": brand.accentColor,
    "--portal-on-primary": onBrand(brand.primaryColor),
  } as CSSProperties;
  async function load() {
    try {
      const next = await jsonRequest<PortalData>(api("data"));
      setData(next);
      setCaseId((id) => id || next.cases[0]?.id || "");
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    jsonRequest<PortalData>(`/api/client-portal/${settings.slug}/data`)
      .then((next) => {
        if (active) {
          setData(next);
          setCaseId((id) => id || next.cases[0]?.id || "");
        }
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [settings.slug]);
  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendCode(purpose = "login") {
    await action(async () => {
      const result = await jsonRequest<{
        challengeId: string;
        resendAfter: number;
      }>(api("challenge"), "POST", {
        phone: data?.phone ?? country + mobile.replace(/\D/g, ""),
        purpose,
      });
      setChallenge(result.challengeId);
      setCode("");
      setResendAt(Date.now() + result.resendAfter * 1000);
    });
  }
  async function command(body: Record<string, unknown>) {
    await action(async () => {
      await jsonRequest(api("action"), "POST", {
        caseId: current?.id,
        ...body,
      });
      await load();
      setDialog("");
      setNote("");
      setNotice("Your update has been shared with the project team.");
    });
  }
  function openDecision(value: string) {
    setDecision(value);
    setDialog("decision");
    setNote("");
    setCode("");
    setChallenge("");
    setError("");
  }
  function openRequest(id: string) {
    setRequestId(id);
    setDialog("thread");
    setNote("");
    setError("");
  }
  const pending = current?.quotes.filter((q) => q.canDecide) ?? [];
  const pendingMaterials = current?.materials?.filter((item) => item.canDecide) ?? [];
  const pendingDesigns = current?.designs?.filter((design) => design.status === "client_review") ?? [];
  const pendingApprovals = pending.length + pendingMaterials.length + pendingDesigns.length;
  return (
    <DesignSystemProvider theme="light" portalContainer={container}>
      <div
        className={p.portal}
        style={style}
        data-layout={brand.layout}
        ref={setContainer}
      >
        <header className={p.header}>
          <BrandLogo brand={brand} />
          <div className={p.headerRight}>
            {data ? (
              <>
                <span>{data.name}</span>
                <button
                  onClick={() =>
                    void action(async () => {
                      await jsonRequest(api("logout"), "POST", {});
                      setData(null);
                      setChallenge("");
                      setCode("");
                    })
                  }
                >
                  Sign out
                </button>
              </>
            ) : (
              <span>Client portal</span>
            )}
          </div>
        </header>
        {loading ? (
          <div className={p.empty} role="status">
            Opening your portal…
          </div>
        ) : !data ? (
          <>
            <main className={p.login}>
              <section className={p.welcome}>
                <span className={p.status}>Your client workspace</span>
                <h1>{brand.welcomeTitle}</h1>
                <p>{brand.welcomeText}</p>
                <div className={p.illustration} aria-hidden />
              </section>
              <section className={p.loginForm}>
                <h2>
                  {challenge
                    ? settings.testMode
                      ? "Enter your demo code"
                      : "Check your WhatsApp"
                    : "Welcome back"}
                </h2>
                <p className={p.muted}>
                  {challenge
                    ? settings.testMode
                      ? "Enter the demo code below."
                      : `Enter the code sent to ${country} ${mobile}.`
                    : "Sign in with the mobile number shared with your project team."}
                </p>
                <form
                  className={p.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (challenge)
                      void action(async () => {
                        await jsonRequest(api("login"), "POST", {
                          challengeId: challenge,
                          code,
                        });
                        await load();
                        setChallenge("");
                        setCode("");
                      });
                    else void sendCode();
                  }}
                >
                  {!challenge ? (
                    <label>
                      WhatsApp mobile number
                      <div className={p.phone}>
                        <select
                          aria-label="Country code"
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                        >
                          {[
                            ["+971", "AE +971"],
                            ["+91", "IN +91"],
                            ["+966", "SA +966"],
                            ["+974", "QA +974"],
                            ["+968", "OM +968"],
                            ["+973", "BH +973"],
                            ["+965", "KW +965"],
                            ["+44", "UK +44"],
                            ["+1", "US +1"],
                          ].map(([value, label]) => (
                            <option value={value} key={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="tel"
                          autoComplete="tel-national"
                          aria-label="Mobile number"
                          placeholder="50 123 4567"
                          required
                          value={mobile}
                          onChange={(e) => setMobile(e.target.value)}
                        />
                      </div>
                    </label>
                  ) : (
                    <label>
                      Six-digit code
                      <input
                        autoFocus
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        required
                        maxLength={6}
                        value={code}
                        onChange={(e) =>
                          setCode(e.target.value.replace(/\D/g, ""))
                        }
                      />
                    </label>
                  )}
                  {error && (
                    <p role="alert" className={p.error}>
                      {error}
                    </p>
                  )}
                  <button className={p.primary} disabled={busy}>
                    {busy
                      ? "Please wait…"
                      : challenge
                        ? "Open my portal"
                        : "Continue with WhatsApp"}
                    <ArrowRight size={16} />
                  </button>
                  {challenge && (
                    <div className={p.actions}>
                      <button
                        className={p.button}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setChallenge("");
                          setError("");
                        }}
                      >
                        Change number
                      </button>
                      <button
                        className={p.button}
                        type="button"
                        disabled={busy || clock < resendAt}
                        onClick={() => void sendCode()}
                      >
                        {clock < resendAt
                          ? `Resend in ${Math.ceil((resendAt - clock) / 1000)}s`
                          : "Resend code"}
                      </button>
                    </div>
                  )}
                  {settings.testMode && (
                    <p className={p.test}>
                      Demo mode · Use <strong>123456</strong> with a registered
                      test contact. No WhatsApp message is sent.
                    </p>
                  )}
                  <p className={p.muted}>
                    <ShieldCheck
                      size={14}
                      style={{ display: "inline", verticalAlign: "middle" }}
                    />{" "}
                    Your documents are shared only with authorized contacts.
                  </p>
                </form>
              </section>
            </main>
          </>
        ) : (
          <main className={p.main}>
            <div className={p.title}>
              <div>
                <span className={p.muted}>Your project</span>
                <h1>{current?.title ?? "Your workspace"}</h1>
              </div>
              {data.cases.length > 1 && (
                <select
                  className={p.selector}
                  aria-label="Choose your project"
                  value={current?.id}
                  onChange={(e) => {
                    setCaseId(e.target.value);
                    setQuoteId("");
                    setDesignVersionId("");
                    setMaterialApprovalId("");
                    setRequestId("");
                    setPaymentId("");
                    setDialog("");
                    setError("");
                    setNotice("");
                  }}
                >
                  {data.cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <nav className={p.nav} aria-label="Client portal sections">
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  aria-current={tab === id ? "page" : undefined}
                  onClick={() => {
                    setTab(id);
                    setError("");
                    setNotice("");
                  }}
                >
                  {label}
                  {id === "approvals" && pendingApprovals > 0
                    ? ` · ${pendingApprovals}`
                    : ""}
                </button>
              ))}
            </nav>
            {error && !dialog && (
              <p role="alert" className={p.error}>
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className={p.muted}>
                {notice}
              </p>
            )}
            {tab === "home" ? (
              <>
                <div className={p.homeIntro}>
                  <h2>Hello, {data.name.split(" ")[0]}.</h2>
                  <p>
                    {pendingApprovals
                      ? `${pendingApprovals} ${pendingApprovals === 1 ? "item is" : "items are"} ready for your review.`
                      : "You’re up to date. Your project team will share the next steps here."}
                  </p>
                </div>
                <h3 style={{ fontWeight: 550 }}>Your next steps</h3>
                {pending.map((q) => (
                  <div className={p.section} key={q.id}>
                    <div className={p.title}>
                      <div>
                        <span className={p.status} data-status="issued">
                          Your review
                        </span>
                        <h3>Quotation V{q.number}</h3>
                        <p className={p.muted}>
                          {money(q.total, q.currency)} · Valid until{" "}
                          {q.validUntil}
                        </p>
                      </div>
                      <button
                        className={p.primary}
                        onClick={() => {
                          setQuoteId(q.id);
                          setTab("approvals");
                        }}
                      >
                        Review quotation
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                ))}
                {pendingMaterials.map((material) => (
                  <div className={p.section} key={material.id}>
                    <div className={p.title}>
                      <div>
                        <span className={p.status} data-status="issued">Material selection</span>
                        <h3>{material.name}</h3>
                        <p className={p.muted}>{material.room} · {material.item}</p>
                      </div>
                      <button className={p.primary} onClick={() => setTab("approvals")}>
                        Review selection <ArrowRight size={15}/>
                      </button>
                    </div>
                  </div>
                ))}
                {pendingDesigns.map((design) => (
                  <div className={p.section} key={design.id}>
                    <div className={p.title}>
                      <div>
                        <span className={p.status} data-status="issued">Design review</span>
                        <h3>{design.title} · V{design.number}</h3>
                        <p className={p.muted}>{design.type}</p>
                      </div>
                      <button className={p.primary} onClick={() => setTab("approvals")}>
                        Review design <ArrowRight size={15}/>
                      </button>
                    </div>
                  </div>
                ))}
                {current?.payments
                  .filter((p) => p.status !== "verified")
                  .map((payment) => (
                    <div className={p.section} key={payment.id}>
                      <div className={p.title}>
                        <div>
                          <h3>{payment.title}</h3>
                          <p className={p.muted}>
                            {payment.dueDate
                              ? `Due ${payment.dueDate}`
                              : (payment.trigger ?? "Date to confirm")}{" "}
                            · {money(payment.amount, quote?.currency)}
                          </p>
                        </div>
                        <button
                          className={p.button}
                          onClick={() => setTab("payments")}
                        >
                          View payment
                        </button>
                      </div>
                    </div>
                  ))}
                <div className={p.section}>
                  <div className={p.title}>
                    <div>
                      <h3>Have a question or a change?</h3>
                      <p className={p.muted}>
                        Keep the conversation connected to your project.
                      </p>
                    </div>
                    <button
                      className={p.button}
                      onClick={() => {
                        setDialog("request");
                        setNote("");
                        setRequestTitle("");
                      }}
                    >
                      Ask your team
                      <MessageSquare size={15} />
                    </button>
                  </div>
                </div>
              </>
            ) : tab === "approvals" && !quoteId ? (
              current?.designs?.length || current?.materials?.length || current?.quotes.length ? <>
                <div className={p.approvalHeading}>
                  <div><h2>Approvals</h2><p className={p.muted}>Designs, material selections and quotations in one review queue.</p></div>
                  <span>{pendingApprovals} pending</span>
                </div>
                {current.designs?.length ? <section className={p.approvalGroup} aria-labelledby="client-designs-heading">
                  <h3 id="client-designs-heading">Designs</h3>
                  {current.designs.map(design=><div className={p.approvalRow} key={design.id}><div><span className={p.status} data-status={design.status}>{design.status==='approved'?'Approved':'For your review'}</span><strong>{design.title} · V{design.number}</strong><small>{design.type}</small></div><div className={p.actions}><a className={p.button} href={`/api/client-portal/${settings.slug}/designs/${design.id}`} target="_blank" rel="noreferrer">Open design ↗</a>{design.status==='client_review'&&current.role==='approver'&&<><button className={p.button} onClick={()=>openDesignDecision(design.id,'changes')}>Reject / remarks</button><button className={p.primary} onClick={()=>openDesignDecision(design.id,'accept')}>Approve design</button></>}</div></div>)}
                </section> : null}
                {current.materials?.length ? <section className={p.approvalGroup} aria-labelledby="client-materials-heading">
                  <h3 id="client-materials-heading">Materials</h3>
                  {current.materials.map(material=><div className={p.materialCard} key={material.id}>
                    {material.photo?<img src={material.photo} alt={`${material.name} material selection`}/>:<span className={p.materialPhoto}>Material</span>}
                    <div><span className={p.status} data-status={material.status}>{statusLabel[material.status]??material.status.replaceAll('_',' ')}</span><h3>{material.name}</h3><p>{[material.brand,material.code].filter(Boolean).join(' · ')||material.specification}</p><p className={p.muted}>{material.room} · {material.item} · Revision {material.revision}</p>{material.decisionNote&&<p>{material.decisionNote}</p>}</div>
                    {material.canDecide&&<div className={p.actions}><button className={p.button} onClick={()=>openMaterialDecision(material.id,'changes')}>Reject / remarks</button><button className={p.primary} onClick={()=>openMaterialDecision(material.id,'accept')}>Approve material</button></div>}
                  </div>)}
                </section> : null}
                {current.quotes.length ? <section className={p.approvalGroup} aria-labelledby="client-quotations-heading">
                  <h3 id="client-quotations-heading">Quotations</h3>
                  {current.quotes.slice().reverse().map((item) => <div className={p.approvalRow} key={item.id}><div><span className={p.status} data-status={item.status}>{statusLabel[item.status] ?? item.status}</span><strong>Quotation V{item.number}</strong><small>{money(item.total, item.currency)} · Valid until {item.validUntil}</small></div><button className={item.canDecide ? p.primary : p.button} onClick={() => setQuoteId(item.id)}>{item.canDecide ? "Review quotation" : "View quotation"}<ArrowRight size={14}/></button></div>)}
                </section> : null}
              </>:<Empty title="Nothing to review yet" text="Your team will share reviewed designs, materials and quotations here. Drafts stay internal."/>
            ) : tab === "approvals" && quoteId ? (
              quote ? (
                <>
                  <div className={p.title}>
                    <div className={p.actions}><button className={p.button} onClick={() => setQuoteId("")}>← All approvals</button><select className={p.selector} aria-label="Quotation version" value={quote.id} onChange={(e) => setQuoteId(e.target.value)}>{current?.quotes.map((q) => <option key={q.id} value={q.id}>V{q.number} · {statusLabel[q.status]}</option>)}</select></div>
                    <div className={p.actions}>
                      <a
                        className={p.button}
                        href={`/portal/${settings.slug}/print?case=${current?.id}&quote=${quote.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Print / save PDF
                      </a>
                    </div>
                  </div>
                  <ClientQuoteChanges
                    quote={quote}
                    previous={current?.quotes
                      .filter(
                        (q) => q.number < quote.number && q.kind === quote.kind,
                      )
                      .at(-1)}
                  />
                  <ClientQuotation quote={quote} />
                  {quote.canDecide ? (
                    <div className={p.decision}>
                      <div>
                        <h3>Ready for your decision</h3>
                        <span className={p.muted}>
                          Your response applies to this exact version.
                        </span>
                      </div>
                      <div className={p.actions}>
                        <button
                          className={p.button}
                          onClick={() => openDecision("decline")}
                        >
                          Decline
                        </button>
                        <button
                          className={p.button}
                          onClick={() => openDecision("changes")}
                        >
                          Request changes
                        </button>
                        <button
                          className={p.primary}
                          onClick={() => openDecision("accept")}
                        >
                          Accept quotation
                          <Check size={15} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className={p.muted}>
                      {quote.status === "issued"
                        ? "Only the assigned approver can respond while this offer is valid."
                        : "This version is kept for your records. Open the latest version for current actions."}
                    </p>
                  )}
                </>
              ) : (
                <Empty
                  title="Your quotation will appear here"
                  text="Your project team will share the reviewed quotation when it’s ready."
                />
              )
            ) : tab === "project" ? (
              current?.project ? <>
                <section className={p.projectSummary} aria-labelledby="client-progress-heading">
                  <div><span className={p.status}>{current.project.phase.replaceAll('_',' ')}</span><h2 id="client-progress-heading">{current.project.name}</h2><p>{current.project.promise || "Approved progress from your project team."}</p></div>
                  <div className={p.projectProgress}><strong>{current.project.progress ?? 0}%</strong><span>overall progress</span><i><b style={{inlineSize:`${current.project.progress ?? 0}%`}}/></i></div>
                  <dl><div><dt>Target completion</dt><dd>{current.project.targetCompletion || "To be confirmed"}</dd></div><div><dt>Handover</dt><dd>{current.project.handoverDate || "To be confirmed"}</dd></div></dl>
                </section>
                {current.project.milestones?.length ? <section className={p.progressSection} aria-labelledby="client-milestones-heading"><h2 id="client-milestones-heading">Project milestones</h2><ol className={p.clientTimeline}>{current.project.milestones.map(milestone=><li key={milestone.id} data-complete={Boolean(milestone.acceptedAt)}><span aria-hidden>{milestone.acceptedAt?<Check size={13}/>:null}</span><div><strong>{milestone.title}</strong><small>Due {milestone.dueDate}{milestone.acceptedAt?` · Accepted ${milestone.acceptedAt.slice(0,10)}`:` · ${milestone.progress}% complete`}</small></div></li>)}</ol></section>:null}
                {current.project.reports.length ? <section className={p.progressSection} aria-labelledby="client-updates-heading"><h2 id="client-updates-heading">Recent updates</h2>{current.project.reports.slice().reverse().map(r=><div className={p.section} key={r.id}><span className={p.status}>Approved update · {r.location}</span><h3>{r.date}</h3>{r.work?.map((work,i)=><p key={i}>{work.title}<strong> · {work.quantity} {work.unit} completed</strong></p>)}{r.files?.map(file=><p key={file.id}><a className={p.button} href={`/api/client-portal/${settings.slug}/project-files/${current.project!.id}/${file.id}`} target="_blank" rel="noreferrer">{file.name} ↗</a></p>)}<p className={p.muted}>Next shift</p><p style={{whiteSpace:'pre-wrap'}}>{r.tomorrow||"Your team has shared an approved progress record."}</p></div>)}</section>:null}
                {current.project.documents.length ? <section className={p.progressSection} aria-labelledby="client-documents-heading"><h2 id="client-documents-heading">Approved documents</h2>{current.project.documents.map(doc=><div className={p.section} key={doc.id}><h3>{doc.title} · {doc.revision}</h3>{doc.url?<a className={p.button} href={doc.url} target="_blank" rel="noreferrer">Open approved document ↗</a>:<p className={p.muted}>Ask your project team for the controlled document.</p>}</div>)}</section>:null}
                {current.project.handovers.length ? <section className={p.progressSection} aria-labelledby="client-handover-heading"><h2 id="client-handover-heading">Handover</h2>{current.project.handovers.map(h=><div className={p.section} key={h.id}><span className={p.status}>{h.status}</span><h3>{h.title} · {h.area}</h3>{h.acceptedAt&&<p>Accepted {h.acceptedAt.slice(0,10)}</p>}{h.warrantyUntil&&<p className={p.muted}>Warranty until {h.warrantyUntil}</p>}{h.outstanding&&<p>{h.outstanding}</p>}</div>)}</section>:null}
                {!current.project.reports.length&&!current.project.documents.length&&!current.project.handovers.length&&!current.project.milestones?.length&&<Empty title="Your project workspace is ready" text="Your team will share approved progress updates and handover documents here."/>}
              </>:<Empty title="Project updates will appear here" text="Once your agreed scope is released, your team can share progress, approved documents and handover details."/>
            ) : tab === "payments" ? (
              <>
                {current?.agreement ? (
                  <div className={p.section}>
                    <span className={p.status}>Agreement verified</span>
                    <h3>{current.agreement.reference}</h3>
                    <p style={{ whiteSpace: "pre-wrap" }} className={p.muted}>
                      {current.agreement.terms}
                    </p>
                  </div>
                ) : (
                  <p className={p.muted}>
                    Your agreed contract will appear here once signing is
                    verified.
                  </p>
                )}
                {current?.credits?.map(c=><div className={p.section} key={c.id}><h3>Approved client credit · {money(c.amount,c.currency)}</h3><p>{c.status==="verified"?"Accounting credit / refund reconciled":"Your team is confirming the accounting credit or refund."}</p></div>)}
                {current?.payments.map((payment) => (
                  <div className={p.section} key={payment.id}>
                    <div className={p.title}>
                      <div>
                        <h3>{payment.title}</h3>
                        <p className={p.muted}>
                          {money(payment.amount, quote?.currency)} ·{" "}
                          {payment.dueDate
                            ? `Due ${payment.dueDate}`
                            : (payment.trigger ?? "Date to confirm")}
                        </p>
                        <span className={p.status} data-status={payment.status}>
                          {statusLabel[payment.status]}
                        </span>
                      </div>
                      {payment.status !== "verified" && (
                        <button
                          className={p.button}
                          onClick={() => {
                            setPaymentId(payment.id);
                            setNote(payment.proof);
                            setDialog("proof");
                          }}
                        >
                          Share payment details
                        </button>
                      )}
                    </div>
                    {payment.invoice && <div className={p.section}><p className={p.muted}>{payment.invoice.provider==='zoho_books'?'Zoho Books':'QuickBooks'} · {payment.invoice.number||payment.invoice.id} · Balance {money(payment.invoice.balance,payment.invoice.currency)}</p>{payment.invoice.paymentUrl&&payment.invoice.balance>0?<a className={p.button} href={payment.invoice.paymentUrl} target="_blank" rel="noreferrer">Open invoice & pay ↗</a>:payment.invoice.balance>0?<p className={p.muted}>Ask your team for the payment method on your invoice.</p>:null}<small className={p.muted}>Last verified {new Date(payment.invoice.refreshedAt).toLocaleString()}{payment.invoice.lastError?" · Verification needs attention. Please contact your project team.":""}</small></div>}
                    {payment.reference && (
                      <p className={p.muted}>Reference: {payment.reference}</p>
                    )}
                  </div>
                ))}
                {!current?.payments.length && (
                  <Empty
                    title="Payment milestones will appear here"
                    text="Your team will share the schedule agreed in your contract."
                  />
                )}
              </>
            ) : tab === "requests" ? (
              <>
                <div className={p.title}>
                  <h2>Requests & messages</h2>
                  <button
                    className={p.primary}
                    onClick={() => {
                      setDialog("request");
                      setNote("");
                      setRequestTitle("");
                    }}
                  >
                    New request
                  </button>
                </div>
                {current?.requests.map((r) => (
                  <div key={r.id} className={p.section}>
                    <div className={p.title}>
                      <div>
                        <span className={p.status}>
                          {statusLabel[r.status]}
                        </span>
                        <h3>{r.title}</h3>
                        <p className={p.muted}>
                          {r.owner
                            ? `With ${r.owner}`
                            : "Your team will assign an owner"}{" "}
                          · {r.comments.length} replies
                        </p>
                      </div>
                      <button
                        className={p.button}
                        onClick={() => openRequest(r.id)}
                      >
                        Open conversation
                      </button>
                    </div>
                    {r.resolution && <p className={p.muted}>{r.resolution}</p>}
                  </div>
                ))}
                {!current?.requests.length && (
                  <Empty
                    title="Your conversation starts here"
                    text="Ask a question, request a change or follow up with the project team."
                  />
                )}
              </>
            ) : (
              <Empty
                title="Designs are being prepared"
                text="Your team manages design versions in Preparation. Published designs will be connected here as that workflow is completed."
              />
            )}
          </main>
        )}
        <footer className={p.footer}>
          {brand.supportPhone ? (
            <a
              href={`https://wa.me/${brand.supportPhone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
            >
              <Phone size={12} style={{ display: "inline" }} /> Contact{" "}
              {brand.name}
            </a>
          ) : (
            brand.name
          )}{" "}
          · Client portal
        </footer>
        <ControlledModalDialog
          isOpen={Boolean(dialog)}
          onOpenChange={(open) => !open && setDialog("")}
          title={
            dialog === 'material-decision' ? decision==='accept'?'Approve material':'Reject material / remarks' : dialog === 'design-decision' ? decision==='accept'?'Approve design':'Reject design / remarks' : dialog === "decision"
              ? decision === "accept"
                ? `Accept quotation V${quote?.number}`
                : decision === "changes"
                  ? "Request quotation changes"
                  : "Decline quotation"
              : dialog === "thread"
                ? (request?.title ?? "Conversation")
                : dialog === "proof"
                  ? "Share payment details"
                  : "New request"
          }
        >
          <div className={p.form} style={style}>
            {error && (
              <p role="alert" className={p.error}>
                {error}
              </p>
            )}
            {dialog === "decision" || dialog === 'design-decision' || dialog === 'material-decision' ? (
              <>
                {dialog==='material-decision'?<><p className={p.muted}>{selectedMaterial?.room} · {selectedMaterial?.item}</p><h3>{selectedMaterial?.name}</h3><p>{selectedMaterial?.specification}</p><p>{decision==='accept'?'You are approving this exact material selection.':'Your remarks will return this material selection to the team.'}</p><label>Remarks{decision==='accept'?' · optional':''}<textarea maxLength={5000} value={note} onChange={e=>setNote(e.target.value)} required={decision!=='accept'}/></label></>:dialog==='design-decision'?<><p className={p.muted}>{selectedDesign?.title} · V{selectedDesign?.number}</p><p>{decision==='accept'?'You are approving this exact design file.':'Your remarks will return this file to the design team for revision.'}</p><label>Remarks{decision==='accept'?' · optional':''}<textarea maxLength={5000} value={note} onChange={e=>setNote(e.target.value)} required={decision!=='accept'}/></label></>:<>
                <p className={p.muted}>
                  {quote?.title} · V{quote?.number} ·{" "}
                  {money(quote?.total ?? 0, quote?.currency)}
                </p>
                {decision === "accept" ? (
                  <p>
                    You are accepting the scope, price, exclusions and terms in
                    this version. Contract signing and execution release follow
                    separately.
                  </p>
                ) : (
                  <label>
                    {decision === "changes"
                      ? "What would you like to change?"
                      : "Reason for declining"}
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      required
                    />
                  </label>
                )}
                </>}
                {!challenge ? (
                  <button
                    className={p.primary}
                    disabled={busy || (decision !== "accept" && !note.trim())}
                    onClick={() =>
                      void sendCode(
                        decisionPurpose,
                      )
                    }
                  >
                    Continue to verification
                  </button>
                ) : (
                  <>
                    <label>
                      Confirm with the six-digit code
                      <input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={code}
                        onChange={(e) =>
                          setCode(e.target.value.replace(/\D/g, ""))
                        }
                      />
                    </label>
                    {settings.testMode && (
                      <p className={p.test}>
                        Demo code: 123456. This verifies your decision
                        separately from login.
                      </p>
                    )}
                    <button
                      className={p.primary}
                      disabled={busy || code.length !== 6}
                      onClick={() =>
                        void command({
                          action: dialog==='material-decision'?'material-decision':dialog==='design-decision'?'design-decision':"decision",
                          ...(dialog==='material-decision'?{materialApprovalId:selectedMaterial?.id}:dialog==='design-decision'?{versionId:selectedDesign?.id}:{quoteId:quote?.id}),
                          decision,
                          challengeId: challenge,
                          code,
                          note,
                        })
                      }
                    >
                      Confirm{" "}
                      {decision === "accept"
                        ? "acceptance"
                        : decision === "changes"
                          ? "change request"
                          : "decline"}
                    </button>
                    <button
                      className={p.button}
                      disabled={busy || clock < resendAt}
                      onClick={() =>
                        void sendCode(
                        decisionPurpose,
                        )
                      }
                    >
                      Request a new code
                      {clock < resendAt
                        ? ` (${Math.ceil((resendAt - clock) / 1000)}s)`
                        : ""}
                    </button>
                  </>
                )}
              </>
            ) : dialog === "thread" ? (
              <>
                <p style={{ whiteSpace: "pre-wrap" }}>{request?.detail}</p>
                {request?.comments.map((c) => (
                  <div key={c.id} className={p.section}>
                    <strong>{c.author}</strong>
                    <p className={p.muted} style={{ whiteSpace: "pre-wrap" }}>
                      {c.text}
                    </p>
                  </div>
                ))}
                {request?.resolution && (
                  <p className={p.test}>{request.resolution}</p>
                )}
                <label>
                  Your reply
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button
                  className={p.primary}
                  disabled={busy || !note.trim()}
                  onClick={() =>
                    void command({ action: "comment", requestId, text: note })
                  }
                >
                  Send reply
                </button>
              </>
            ) : dialog === "proof" ? (
              <>
                <p className={p.muted}>
                  Share the bank transaction reference and payment date. Your
                  finance team will verify the receipt.
                </p>
                <label>
                  Payment reference & details
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button
                  className={p.primary}
                  disabled={busy || !note.trim()}
                  onClick={() =>
                    void command({ action: "proof", paymentId, proof: note })
                  }
                >
                  Submit for verification
                </button>
              </>
            ) : (
              <>
                <label>
                  Subject
                  <input
                    value={requestTitle}
                    onChange={(e) => setRequestTitle(e.target.value)}
                  />
                </label>
                <label>
                  How can your team help?
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button
                  className={p.primary}
                  disabled={busy || !requestTitle.trim() || !note.trim()}
                  onClick={() =>
                    void command({
                      action: "request",
                      title: requestTitle,
                      detail: note,
                    })
                  }
                >
                  Send request
                </button>
              </>
            )}
          </div>
        </ControlledModalDialog>
      </div>
    </DesignSystemProvider>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className={p.empty}>
      <FileText size={28} />
      <h2>{title}</h2>
      <p className={p.muted}>{text}</p>
    </div>
  );
}
function ClientQuoteChanges({
  quote,
  previous,
}: {
  quote: ClientQuote;
  previous?: ClientQuote;
}) {
  if (!previous) return null;
  const changed = quote.lines.filter(
      (l) =>
        JSON.stringify(l) !==
        JSON.stringify(previous.lines.find((p) => p.id === l.id)),
    ),
    removed = previous.lines.filter(
      (l) => !quote.lines.some((q) => q.id === l.id),
    );
  return (
    <details className={p.section}>
      <summary>
        What changed since V{previous.number} ·{" "}
        {money(quote.total - previous.total, quote.currency)}
      </summary>
      <ul>
        {changed.map((l) => (
          <li key={l.id}>
            {previous.lines.some((p) => p.id === l.id) ? "Updated" : "Added"}:{" "}
            {l.title}
          </li>
        ))}
        {removed.map((l) => (
          <li key={l.id}>Removed: {l.title}</li>
        ))}
      </ul>
      {quote.terms !== previous.terms && <p>Terms updated.</p>}
      {quote.exclusions !== previous.exclusions && <p>Exclusions updated.</p>}
      {quote.discount !== previous.discount && <p>Discount updated.</p>}
      {quote.taxRate !== previous.taxRate && <p>Tax rate updated.</p>}
      {quote.validUntil !== previous.validUntil && <p>Validity updated.</p>}
    </details>
  );
}
