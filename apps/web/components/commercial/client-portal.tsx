"use client";
import Image from "next/image";
import {ClientProjectProgress} from "./client-project-progress";
import { WodanaLogo } from "@/components/brand";
import { useEffect, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  MessageSquare,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { Button, Checkbox, ControlledModalDialog, DataGrid, DesignSystemProvider, SelectField, TextAreaField } from "@/design-system";
import type {
  ClientCase,
  ClientQuote,
  PortalSettings,
} from "@/lib/commercial/types";
import { jsonRequest, money, quoteSelectionTotals, statusLabel } from "@/lib/commercial/client";
import { decisionPolicySummary } from "@/lib/commercial/decision-requests";
import { BrandLogo } from "./portal-settings";
import { ClientQuotation } from "./client-quotation";
import p from "./client-portal.module.css";
type PortalData = { name: string; phone: string; cases: ClientCase[] };
const tabs = [
  ["home", "Home"],
  ["project", "Progress"],
  ["approvals", "Approvals"],
  ["payments", "Payments"],
  ["requests", "Inbox"],
];
const designContext = (design: NonNullable<ClientCase["designs"]>[number]) =>
  [design.roomName, design.itemName, design.type].filter(Boolean).join(" · ");
const designDue = (design: NonNullable<ClientCase["designs"]>[number]) =>
  design.clientReviewExpiresAt
    ? `Decision due ${new Date(design.clientReviewExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
    : "";
export function ClientPortal({ settings }: { settings: PortalSettings }) {
  const [data, setData] = useState<PortalData | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selectedTab, setTab] = useState("home"),
    [caseId, setCaseId] = useState(""),
    [quoteId, setQuoteId] = useState(""),
    [definitionOpen, setDefinitionOpen] = useState(false),
    [designVersionId,setDesignVersionId] = useState(""),
    [materialApprovalId,setMaterialApprovalId] = useState(""),
    [handoverId,setHandoverId] = useState(""),
    [warrantyTitle, setWarrantyTitle] = useState(""),
    [warrantySeverity, setWarrantySeverity] = useState("minor"),
    [country, setCountry] = useState("+971"),
    [mobile, setMobile] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState(""),
    [resendAt, setResendAt] = useState(0),
    [clock, setClock] = useState(() => Date.now()),
    [dialog, setDialog] = useState(""),
    [decision, setDecision] = useState("accept"),
    [selectedOptionLineIds, setSelectedOptionLineIds] = useState<string[]>([]),
    [note, setNote] = useState(""),
    [requestTitle, setRequestTitle] = useState(""),
    [requestId, setRequestId] = useState(""),
    [decisionChoice, setDecisionChoice] = useState(""),
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
  const clientSections = {progress:true,documents:true,handover:true,updates:true,...current?.project?.clientSections};
  const hasProjectSections = Object.values(clientSections).some(Boolean);
  const tab = selectedTab === "project" && !hasProjectSections ? "home" : selectedTab === "alerts" && !clientSections.updates ? (hasProjectSections ? "project" : "home") : selectedTab;
  const mainTab = tab === "designs" ? "approvals" : tab === "alerts" ? "project" : tab;
  const sharedImages = (current?.designs ?? []).filter(design => ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(design.mimeType)).slice(0, 3);
  const selectedDesign=current?.designs?.find(d=>d.id===designVersionId);
  const selectedMaterial=current?.materials?.find(item=>item.id===materialApprovalId);
  const selectedHandover=current?.project?.handovers.find(item=>item.id===handoverId);
  const definition = current?.definitionBaseline;
  const optionLines = quote?.lines.filter((line) => line.optional) ?? [];
  const acceptanceTotals = quote
    ? quoteSelectionTotals(
        { ...quote, lines: quote.lines.map((line) => ({ ...line, unitCost: 0 })) },
        selectedOptionLineIds,
      )
    : { baseTotal: 0, optionsTotal: 0, acceptedTotal: 0 };
  const decisionPurpose=dialog==='warranty-claim'
    ? `warranty-claim:${current?.id}:${current?.project?.id}:${handoverId}`
    : `${dialog==='definition-decision'?'definition-decision':dialog==='material-decision'?'material-decision':dialog==='design-decision'?'design-decision':dialog==='handover-decision'?'handover-decision':'decision'}:${current?.id}:${dialog==='definition-decision'?definition?.id:dialog==='material-decision'?selectedMaterial?.id:dialog==='design-decision'?selectedDesign?.id:dialog==='handover-decision'?`${current?.project?.id}:${handoverId}`:quote?.id}:${decision}`;
  function openDefinitionDecision(value:"accept"|"changes"){setDecision(value);setDialog('definition-decision');setNote('');setCode('');setChallenge('');setError('');}
  function openDesignDecision(id:string,value:string){setDesignVersionId(id);setDecision(value);setDialog('design-decision');setNote('');setCode('');setChallenge('');setError('');}
  function openMaterialDecision(id:string,value:string){setMaterialApprovalId(id);setDecision(value);setDialog('material-decision');setNote('');setCode('');setChallenge('');setError('');}
  function openHandoverDecision(id:string,value:"accept"|"changes"){setHandoverId(id);setDecision(value);setDialog('handover-decision');setNote('');setCode('');setChallenge('');setError('');}
  function openWarrantyClaim(id:string){setHandoverId(id);setWarrantyTitle('');setWarrantySeverity('minor');setDialog('warranty-claim');setNote('');setCode('');setChallenge('');setError('');}
  const style = {
    "--portal-primary": brand.primaryColor || "#254e40",
    "--portal-accent": brand.accentColor || "#626b65",
    "--portal-on-primary": "#ffffff",
  } as CSSProperties;
  async function load() {
    try {
      const next = await jsonRequest<PortalData>(api("data"));
      setData(next);
      setError("");
      setCaseId((id) => id || next.cases[0]?.id || "");
    } catch {
      setError("Could not refresh your project. Please try again.");
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
    if (!data) return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void jsonRequest<PortalData>(api('data')).then(next => {
        if (active) setData(next);
      }).catch(() => { /* Keep the last verified view during a temporary outage. */ });
    };
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active=false; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [Boolean(data), settings.slug]);
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
    setSelectedOptionLineIds([]);
    setDialog("decision");
    setNote("");
    setCode("");
    setChallenge("");
    setError("");
  }
  function openRequest(id: string) {
    setRequestId(id);
    setDecisionChoice("");
    setDialog("thread");
    setNote("");
    setError("");
  }
  const pending = current?.quotes.filter((q) => q.canDecide) ?? [];
  const pendingMaterials = current?.materials?.filter((item) => item.canDecide) ?? [];
  const pendingDesigns = current?.designs?.filter((design) => design.status === "client_review") ?? [];
  const pendingDecisions = current?.requests.filter((item) => item.status === "awaiting_decision" && item.decisionRequest && !item.decisionRequest.decision) ?? [];
  const pendingApprovals = pending.length + pendingMaterials.length + pendingDesigns.length + (definition?.canDecide ? 1 : 0);
  return (
    <DesignSystemProvider theme="light" portalContainer={container}>
      <div
        className={p.portal}
        style={style}
        data-layout={brand.layout}
        ref={setContainer}
      >
        <header className={p.header}>
          <div className={p.clientBrand}><BrandLogo brand={brand} /></div>
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
                    setDefinitionOpen(false);
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
              {tabs.filter(([id]) => id !== "project" || hasProjectSections).map(([id, label]) => (
                <button
                  key={id}
                  aria-current={mainTab === id ? "page" : undefined}
                  onClick={() => {
                    setTab(id);
                    setError("");
                    setNotice("");
                  }}
                >
                  {label}
                  {id === "project" && clientSections.updates && !!current?.project?.alerts?.length && <span className={p.count}>{current.project.alerts.length}</span>}
                  {id === "approvals" && pendingApprovals > 0
                    ? <span className={p.count}>{pendingApprovals}</span>
                    : id === "requests" && pendingDecisions.length > 0 ? <span className={p.count}>{pendingDecisions.length}</span> : null}
                </button>
              ))}
            </nav>
            {mainTab === "approvals" && <nav className={p.subnav} aria-label="Approval views"><button aria-current={tab === "approvals" ? "page" : undefined} onClick={() => setTab("approvals")}>Review queue</button><button aria-current={tab === "designs" ? "page" : undefined} onClick={() => setTab("designs")}>Designs</button></nav>}
            {mainTab === "project" && clientSections.updates && <nav className={p.subnav} aria-label="Progress views"><button aria-current={tab === "project" ? "page" : undefined} onClick={() => setTab("project")}>Project updates</button><button aria-current={tab === "alerts" ? "page" : undefined} onClick={() => setTab("alerts")}>Alerts{!!current?.project?.alerts?.length && <span className={p.count}>{current.project.alerts.length}</span>}</button></nav>}
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
            {clientSections.updates && !!current?.project?.alerts?.length && tab !== "alerts" && <div className={p.section} role="status"><strong>{current.project.alerts.length} schedule {current.project.alerts.length===1?'update':'updates'}</strong><button className={p.button} onClick={()=>setTab('alerts')}>View alerts</button></div>}
            {tab === "alerts" ? <section><div className={p.title}><h2>Schedule alerts</h2><button className={p.button} onClick={()=>void load()}>Refresh</button></div>{current?.project?.alerts?.length ? current.project.alerts.map(alert=><article className={p.section} key={alert.id}><h3>{alert.title}</h3><p>{alert.message}</p><p className={p.muted}>Planned: {alert.dueDate}{alert.expectedDate?` · Updated expected date: ${alert.expectedDate}`:''}</p><button className={p.button} onClick={()=>{setTab('requests');setDialog('request');setRequestTitle(alert.title);setNote('');}}>Ask your team</button></article>) : <Empty title="No active schedule alerts" text="Delivery and work delays will appear here when they need your attention."/>}</section> : tab === "home" ? (
              <>
                <div className={p.homeIntro}>
                  <h2>Hello, {data.name.split(" ")[0]}.</h2>
                  <p>
                    {pendingApprovals
                      ? `${pendingApprovals} ${pendingApprovals === 1 ? "item is" : "items are"} ready for your review.`
                      : pendingDecisions.length
                        ? `${pendingDecisions.length} ${pendingDecisions.length === 1 ? "decision needs" : "decisions need"} your response.`
                      : "You’re up to date. Your project team will share the next steps here."}
                  </p>
                </div>
                {sharedImages.length > 0 && <section className={p.designGallery} aria-label="Shared project designs">{sharedImages.map(design => <a key={design.id} href={`/api/client-portal/${settings.slug}/designs/${design.id}`} target="_blank" rel="noreferrer"><Image unoptimized src={`/api/client-portal/${settings.slug}/designs/${design.id}`} width={480} height={300} alt={`${design.title} · V${design.number}`} /><span><strong>{design.title}</strong><small>{design.roomName || "Shared design"} · V{design.number}</small></span></a>)}</section>}
                <h3 style={{ fontWeight: 650 }}>Your next steps</h3>
                {pendingDecisions.map((item) => <div className={p.section} key={item.id}><div className={p.title}><div><span className={p.status} data-status="issued">Decision requested</span><h3>{item.title}</h3><p className={p.muted}>{item.decisionRequest?.target.label} · Due {item.dueDate}</p></div><button className={p.primary} onClick={() => openRequest(item.id)}>Respond <ArrowRight size={15}/></button></div></div>)}
                {definition?.canDecide ? <div className={p.section}><div className={p.title}><div><span className={p.status} data-status="issued">Your review</span><h3>Scope definition · V{definition.number}</h3><p className={p.muted}>Confirm the current requirements before quotation.</p></div><button className={p.primary} onClick={() => { setTab("approvals"); setDefinitionOpen(true); }}>Review scope <ArrowRight size={15}/></button></div></div> : null}
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
                        <p className={p.muted}>{designContext(design)}{designDue(design) ? ` · ${designDue(design)}` : ""}</p>
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
            ) : tab === "designs" ? (
current?.designs?.length ? <section className={p.approvalGroup} aria-labelledby="client-designs-heading">
                  <h3 id="client-designs-heading">Designs</h3>
                  <DataGrid gridLines appearance="card" ariaLabel="Shared designs" rowNumbers={false} selectable={false} data={current.designs} getRowId={design=>design.id} columns={[
                    {id:'title',header:'Design',size:240,accessorFn:design=>`${design.title} · V${design.number}`,meta:{primary:true}},
                    {id:'context',header:'Room / item',size:240,accessorFn:design=>designContext(design)},
                    {id:'status',header:'Status',size:130,accessorFn:design=>design.status,meta:{renderCell:design=><span className={p.status} data-status={design.status}>{design.status==='approved'?'Approved':design.status==='changes_requested'?'Changes requested':design.status==='rejected'?'Rejected':design.status==='expired'?'Review expired':'For your review'}</span>}},
                    {id:'due',header:'Decision due',size:160,accessorFn:design=>design.status==='client_review'?(designDue(design).replace('Decision due ','')||'—'):'—'},
                    {id:'actions',header:'Actions',enableSorting:false,size:230,meta:{renderCell:design=><div className={p.designActions}><a className={p.button} href={`/api/client-portal/${settings.slug}/designs/${design.id}`} target="_blank" rel="noreferrer">Open design ↗</a>{design.status==='client_review'&&current.role==='approver'&&<Button size="compact" onPress={()=>setTab("approvals")}>Review</Button>}</div>}},
                  ]} />
                </section> : <Empty title="No shared designs yet" text="Design revisions and approval requests will appear here."/>
            ) : tab === "approvals" && definitionOpen && definition ? (
              <ClientScopeDefinition definition={definition} onBack={() => setDefinitionOpen(false)} onDecision={openDefinitionDecision} />
            ) : tab === "approvals" && !quoteId ? (
              definition || current?.designs?.length || current?.materials?.length || current?.quotes.length ? <>
                <div className={p.approvalHeading}>
                  <div><h2>Approvals</h2><p className={p.muted}>Scope, designs, materials and quotations.</p></div>
                  <span>{pendingApprovals} pending</span>
                </div>
                {definition ? <section className={p.approvalGroup} aria-labelledby="client-scope-heading"><h3 id="client-scope-heading">Scope</h3><div className={p.approvalRow}><div><span className={p.status} data-status={definition.status}>{definition.status === "confirmed" ? "Confirmed" : definition.status === "changes_requested" ? "Changes requested" : definition.current ? "For your review" : "Earlier version"}</span><strong>Scope definition · V{definition.number}</strong><small>{definition.snapshot.definition.items.length} item{definition.snapshot.definition.items.length === 1 ? "" : "s"}</small></div><button className={definition.canDecide ? p.primary : p.button} onClick={() => setDefinitionOpen(true)}>{definition.canDecide ? "Review scope" : "View scope"}<ArrowRight size={14}/></button></div></section> : null}
                {current.designs?.length ? <section className={p.approvalGroup} aria-labelledby="client-designs-heading">
                  <h3 id="client-designs-heading">Designs</h3>
                  {current.designs.map(design=><div className={p.approvalRow} key={design.id}><div><span className={p.status} data-status={design.status}>{design.status==='approved'?'Approved':design.status==='changes_requested'?'Changes requested':design.status==='rejected'?'Rejected':design.status==='expired'?'Review expired':'For your review'}</span><strong>{design.title} · V{design.number}</strong><small>{designContext(design)}{designDue(design) ? ` · ${designDue(design)}` : ""}</small></div><div className={p.actions}><a className={p.button} href={`/api/client-portal/${settings.slug}/designs/${design.id}`} target="_blank" rel="noreferrer">Open design ↗</a>{design.status==='client_review'&&current.role==='approver'&&<><button className={p.button} onClick={()=>openDesignDecision(design.id,'changes')}>Request changes</button><button className={p.button} onClick={()=>openDesignDecision(design.id,'decline')}>Reject design</button><button className={p.primary} onClick={()=>openDesignDecision(design.id,'accept')}>Approve design</button></>}</div></div>)}
                </section> : null}
                {current.materials?.length ? <section className={p.approvalGroup} aria-labelledby="client-materials-heading">
                  <h3 id="client-materials-heading">Materials</h3>
                  {current.materials.map(material=><div className={p.materialCard} key={material.id}>
                    {material.photo?<Image unoptimized width={96} height={96} src={material.photo} alt={`${material.name} material selection`}/>:<span className={p.materialPhoto}>Material</span>}
                    <div><span className={p.status} data-status={material.status}>{statusLabel[material.status]??material.status.replaceAll('_',' ')}</span><h3>{material.name}</h3><p>{[material.brand,material.code].filter(Boolean).join(' · ')||material.specification}</p><p className={p.muted}>{material.room} · {material.item} · Revision {material.revision}</p>{material.decisionNote&&<p>{material.decisionNote}</p>}</div>
                    {material.canDecide&&<div className={p.actions}><button className={p.button} onClick={()=>openMaterialDecision(material.id,'changes')}>Reject / remarks</button><button className={p.primary} onClick={()=>openMaterialDecision(material.id,'accept')}>Approve material</button></div>}
                  </div>)}
                </section> : null}
                {current.quotes.length ? <section className={p.approvalGroup} aria-labelledby="client-quotations-heading">
                  <h3 id="client-quotations-heading">Quotations</h3>
                  {current.quotes.slice().reverse().map((item) => <div className={p.approvalRow} key={item.id}><div><span className={p.status} data-status={item.expired ? "expired" : item.status}>{item.expired && item.status === "issued" ? "Expired" : statusLabel[item.status] ?? item.status}</span><strong>Quotation V{item.number}</strong><small>{money(item.total, item.currency)} · Valid until {item.validUntil}</small></div><button className={item.canDecide ? p.primary : p.button} onClick={() => setQuoteId(item.id)}>{item.canDecide ? "Review quotation" : "View quotation"}<ArrowRight size={14}/></button></div>)}
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
                        href={`/portal/${settings.slug}/print?case=${current?.id}&quote=${quote.id}${quote.hash ? `&snapshot=${quote.hash}` : ""}`}
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
                        ? quote.expired
                          ? `This quotation expired on ${quote.validUntil}. Ask the project team for a current revision.`
                          : "Only the assigned approver can respond while this offer is valid."
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
              current?.project ? <ClientProjectProgress project={current.project} slug={settings.slug} onRefresh={()=>void load()} handover={current.project.handovers.length ? <section className={p.progressSection} aria-labelledby="client-handover-heading"><h2 id="client-handover-heading">Handover</h2>{current.project.handovers.map(h=><div className={p.section} key={h.id}><span className={p.status}>{h.status}</span><h3>{h.title} · {h.area}</h3>{h.clientReviewDueDate&&h.status==='ready'&&<p className={p.muted}>Decision requested by {h.clientReviewDueDate}</p>}{h.acceptedAt&&<p>Accepted {h.acceptedAt.slice(0,10)}</p>}{h.warrantyUntil&&<p className={p.muted}>Warranty until {h.warrantyUntil}</p>}{h.packet&&<details><summary>Review handover pack · V{h.packet.version}</summary><p>{h.packet.tasks.map(task=>`${task.title} · ${task.quantity} ${task.unit}`).join(', ')}</p>{h.packet.documents.map(document=><p key={document.id}>{document.url?<a className={p.button} href={document.url} target="_blank" rel="noreferrer">{document.title} · {document.revision} ↗</a>:`${document.title} · ${document.revision}`}</p>)}</details>}{h.outstandingItems?.map(item=><p key={item.id} className={p.muted}>{item.title} · {item.status}{item.dueDate?` · due ${item.dueDate}`:''}</p>)}{h.outstanding&&<p>{h.outstanding}</p>}{current.project!.warrantyClaims.filter(claim=>claim.handoverId===h.id).map(claim=><p key={claim.id} className={p.muted}>Warranty request · {claim.title} · {claim.status.replaceAll('_',' ')}</p>)}{h.canDecide&&<div className={p.actions}><button className={p.primary} onClick={()=>openHandoverDecision(h.id,'accept')}>Accept handover</button><button className={p.button} onClick={()=>openHandoverDecision(h.id,'changes')}>Request changes</button></div>}{h.canReportWarranty&&<div className={p.actions}><button className={p.button} onClick={()=>openWarrantyClaim(h.id)}>Report a warranty issue</button></div>}</div>)}</section>:null}/>
              :<Empty title="Project updates will appear here" text="Once your agreed scope is released, your team can share progress, approved documents and handover details."/>
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
                    {payment.invoice && <div className={p.section}><p className={p.muted}>{payment.invoice.provider==='zoho_books'?'Zoho Books':'QuickBooks'} · {payment.invoice.number||"Linked invoice"} · Balance {money(payment.invoice.balance,payment.invoice.currency)}</p>{payment.invoice.paymentUrl&&payment.invoice.balance>0?<a className={p.button} href={payment.invoice.paymentUrl} target="_blank" rel="noreferrer">Open invoice & pay ↗</a>:payment.invoice.balance>0?<p className={p.muted}>Ask your team for the payment method on your invoice.</p>:null}<small className={p.muted}>Last checked {new Date(payment.invoice.refreshedAt).toLocaleString()}{payment.invoice.lastError?" · Verification needs attention. Please contact your project team.":""}</small></div>}
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
                          · {r.comments.length} replies{r.decisionRequest ? ` · ${r.decisionRequest.target.label} · Due ${r.dueDate}` : ""}
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
          <span className={p.portalSupport}>
            {brand.supportPhone ? (
              <a
                href={`https://wa.me/${brand.supportPhone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
              >
                <Phone size={12} /> Contact {brand.name}
              </a>
            ) : (
              <>{brand.name} · Client portal</>
            )}
          </span>
          <span className={p.poweredBy} aria-label="Powered by Wodana">
            <span>Powered by</span>
            <WodanaLogo size="micro" />
          </span>
        </footer>
        <ControlledModalDialog
          isOpen={Boolean(dialog) && (!['handover-decision','warranty-claim'].includes(dialog) || clientSections.handover)}
          onOpenChange={(open) => !open && setDialog("")}
          title={
            dialog === 'warranty-claim' ? 'Report a warranty issue' : dialog === 'definition-decision' ? decision === 'accept' ? 'Confirm scope' : 'Request scope changes' : dialog === 'material-decision' ? decision==='accept'?'Approve material':'Reject material / remarks' : dialog === 'design-decision' ? decision==='accept'?'Approve design':decision==='changes'?'Request design changes':'Reject design' : dialog === 'handover-decision' ? decision==='accept'?'Accept handover':'Request handover changes' : dialog === "decision"
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
            {dialog === 'warranty-claim' ? (
              <>
                <p className={p.muted}>{selectedHandover?.title} · {selectedHandover?.area}</p>
                <p>Tell us what needs attention. Your project team will receive this as a warranty request.</p>
                <label>What needs attention?<input maxLength={240} value={warrantyTitle} onChange={e=>setWarrantyTitle(e.target.value)} /></label>
                <label>Urgency<select value={warrantySeverity} onChange={e=>setWarrantySeverity(e.target.value)}><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></select></label>
                <label>Details<textarea maxLength={5000} value={note} onChange={e=>setNote(e.target.value)} /></label>
                {!challenge ? <button className={p.primary} disabled={busy||!warrantyTitle.trim()||!note.trim()} onClick={()=>void sendCode(decisionPurpose)}>Continue to verification</button> : <><label>Confirm with the six-digit code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))}/></label>{settings.testMode&&<p className={p.test}>Demo code: 123456. This verifies your report separately from sign-in.</p>}<button className={p.primary} disabled={busy||code.length!==6} onClick={()=>void command({action:'warranty-claim',projectId:current?.project?.id,handoverId,title:warrantyTitle,severity:warrantySeverity,detail:note,challengeId:challenge,code})}>Submit warranty request</button><button className={p.button} disabled={busy||clock<resendAt} onClick={()=>void sendCode(decisionPurpose)}>Request a new code{clock<resendAt?` (${Math.ceil((resendAt-clock)/1000)}s)`:""}</button></>}
              </>
            ) : dialog === "decision" || dialog === 'definition-decision' || dialog === 'design-decision' || dialog === 'material-decision' || dialog === 'handover-decision' ? (
              <>
                {dialog==='definition-decision'?<><p className={p.muted}>Scope definition · V{definition?.number}</p><p>{decision === 'accept' ? 'You are confirming this exact version of the requirements and scope.' : 'Your remarks will return this scope to the team for revision.'}</p><label>Remarks{decision === 'accept' ? ' · optional' : ''}<textarea maxLength={5000} value={note} onChange={e=>setNote(e.target.value)} required={decision !== 'accept'}/></label></>:dialog==='handover-decision'?<><p className={p.muted}>{selectedHandover?.title} · {selectedHandover?.area}</p><p>{decision==='accept'?'You are accepting this exact, versioned handover pack. Warranty and any recorded follow-up will remain visible here.':'Your remarks will return this handover pack to the project team for correction.'}</p><label>Remarks{decision==='accept'?' · optional':''}<textarea maxLength={5000} value={note} onChange={e=>setNote(e.target.value)} required={decision!=='accept'}/></label></>:dialog==='material-decision'?<><p className={p.muted}>{selectedMaterial?.room} · {selectedMaterial?.item}</p><h3>{selectedMaterial?.name}</h3><p>{selectedMaterial?.specification}</p><p>{decision==='accept'?'You are approving this exact material selection.':'Your remarks will return this material selection to the team.'}</p><label>Remarks{decision==='accept'?' · optional':''}<textarea maxLength={5000} value={note} onChange={e=>setNote(e.target.value)} required={decision!=='accept'}/></label></>:dialog==='design-decision'?<><p className={p.muted}>{selectedDesign?.title} · V{selectedDesign?.number}</p><p>{decision==='accept'?'You are approving this exact design file.':decision==='changes'?'Your requested changes will return this exact revision to the design team.':'You are rejecting this exact revision. It will remain in the approval history.'}</p><label>{decision==='accept'?'Remarks · optional':decision==='changes'?'Changes needed':'Reason for rejection'}<textarea maxLength={5000} value={note} onChange={e=>setNote(e.target.value)} required={decision!=='accept'}/></label></>:<>
                <p className={p.muted}>
                  {quote?.title} · V{quote?.number} ·{" "}
                  {money(quote?.total ?? 0, quote?.currency)}
                </p>
                {decision === "accept" ? (
                  <>
                    <p>
                      You are accepting the scope, price, exclusions and terms in
                      this exact issued version. Contract signing follows separately.
                    </p>
                    {optionLines.length ? (
                      <fieldset className={p.optionSelection}>
                        <legend>Optional items</legend>
                        <p className={p.muted}>Choose only the alternates you want included in the accepted amount.</p>
                        {optionLines.map((line) => (
                          <Checkbox
                            key={line.id}
                            isSelected={selectedOptionLineIds.includes(line.id)}
                            onChange={(selected) =>
                              setSelectedOptionLineIds((current) =>
                                selected
                                  ? [...current, line.id]
                                  : current.filter((id) => id !== line.id),
                              )
                            }
                          >
                            <span className={p.optionLabel}><strong>{line.title}</strong><small>{line.room} · {money(line.quantity * line.rate, quote?.currency)}</small></span>
                          </Checkbox>
                        ))}
                      </fieldset>
                    ) : null}
                    <dl className={p.acceptanceSummary}>
                      <div><dt>Base quotation</dt><dd>{money(acceptanceTotals.baseTotal, quote?.currency)}</dd></div>
                      <div><dt>Selected options incl. tax</dt><dd>{money(acceptanceTotals.optionsTotal, quote?.currency)}</dd></div>
                      <div><dt>Amount you are accepting</dt><dd>{money(acceptanceTotals.acceptedTotal, quote?.currency)}</dd></div>
                    </dl>
                  </>
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
                          action: dialog==='definition-decision'?'definition-decision':dialog==='material-decision'?'material-decision':dialog==='design-decision'?'design-decision':dialog==='handover-decision'?'handover-decision':"decision",
                          ...(dialog==='definition-decision'?{baselineId:definition?.id}:dialog==='material-decision'?{materialApprovalId:selectedMaterial?.id}:dialog==='design-decision'?{versionId:selectedDesign?.id}:dialog==='handover-decision'?{projectId:current?.project?.id,handoverId}:{quoteId:quote?.id}),
                          decision,
                          ...(dialog === "decision" && decision === "accept" ? { selectedOptionLineIds } : {}),
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
                          : dialog === "design-decision"
                            ? "rejection"
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
                {request?.decisionRequest ? <div className={p.section}><span className={p.status} data-status={request.status}>{request.decisionRequest.decision ? "Answered" : "Your decision"}</span><h3>{request.decisionRequest.target.label}</h3><p className={p.muted}>This response applies only to the exact revision above · Due {request.dueDate}</p><p className={p.muted}>{decisionPolicySummary(request.decisionRequest)}</p>{request.decisionRequest.decision ? <p><strong>{request.decisionRequest.decision.choiceLabel}</strong>{request.decisionRequest.decision.note ? ` · ${request.decisionRequest.decision.note}` : ""}</p> : <><SelectField label="Choose your response" isRequired items={request.decisionRequest.allowedChoices} selectedKey={decisionChoice || null} onSelectionChange={(key) => setDecisionChoice(String(key ?? ""))} /><TextAreaField label="Note (optional)" value={note} onChange={setNote} /><Button variant="primary" isLoading={busy} isDisabled={!decisionChoice} onPress={() => void command({ action: "decision_response", requestId, choiceId: decisionChoice, note, responseId: crypto.randomUUID() })}>Submit decision</Button></>}</div> : null}
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
                {!request?.decisionRequest ? <><label>
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
                </> : null}
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
function ClientScopeDefinition({ definition, onBack, onDecision }: { definition: NonNullable<ClientCase["definitionBaseline"]>; onBack: () => void; onDecision: (decision: "accept" | "changes") => void }) {
  const scope = definition.snapshot.definition;
  return <div className={p.scopeReview}>
    <button className={p.button} onClick={onBack}>← All approvals</button>
    <div className={p.approvalHeading}><div><h2>Scope definition · V{definition.number}</h2><p className={p.muted}>The requirements and selections shared by your project team.</p></div><span className={p.status} data-status={definition.status}>{definition.status === "confirmed" ? "Confirmed" : definition.status === "changes_requested" ? "Changes requested" : definition.current ? "For your review" : "Earlier version"}</span></div>
    {scope.brief.goals || scope.brief.location || scope.brief.timeline || scope.brief.exclusions ? <dl className={p.scopeFacts}>{([ ["Project goal", scope.brief.goals], ["Location", scope.brief.location], ["Timeline", scope.brief.timeline], ["Known exclusions", scope.brief.exclusions] ] as const).filter((entry) => Boolean(entry[1])).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
    <div className={p.scopeList}><h3>Items in this version</h3>{scope.items.map((item) => <article key={item.id} className={p.scopeItem}><div><strong>{item.title}</strong><span>{item.scopeStatus === "included" ? "Included" : item.scopeStatus === "excluded" ? "Excluded" : item.scopeStatus.replaceAll("_", " ")}</span></div><small>{[item.roomName, item.quantity ? `${item.quantity} ${item.unit}` : ""].filter(Boolean).join(" · ")}</small>{item.specification?.refinedRequirement ? <p>{item.specification.refinedRequirement}</p> : null}{item.specification?.inclusions ? <p>Includes: {item.specification.inclusions}</p> : null}{item.specification?.exclusions ? <p>Excludes: {item.specification.exclusions}</p> : null}{item.specification?.materials?.length ? <p>Materials: {item.specification.materials.map((material) => [material.application, material.productName, material.productCode].filter(Boolean).join(" · ")).join("; ")}</p> : null}</article>)}</div>
    {definition.decision ? <p className={p.muted}>{definition.decision.decision === "confirmed" ? "Confirmed" : "Changes requested"} by {definition.decision.decisionBy}{definition.decision.note ? ` · ${definition.decision.note}` : ""}</p> : null}
    {definition.canDecide ? <div className={p.actions}><button className={p.button} onClick={() => onDecision("changes")}>Request changes</button><button className={p.primary} onClick={() => onDecision("accept")}>Confirm scope</button></div> : null}
  </div>;
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
