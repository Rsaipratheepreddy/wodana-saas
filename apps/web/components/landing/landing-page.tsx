"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, BriefcaseBusiness, Check, CheckCheck, ChevronDown, CircleCheck, ClipboardCheck, ClipboardList, FolderKanban, Layers3, LayoutGrid, Menu, MessageCircle, Moon, MousePointer2, Package, PackageSearch, Palette, Pause, Play, Plus, Search, Sparkles, Sun, Users, X } from "lucide-react";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import { WodanaLogo, WoddyMark } from "@/components/brand";
import { Tabs } from "@/design-system/components/navigation";
import styles from "./landing.module.css";

const workflow = [
  { id: "connect", title: "Start with a conversation.", copy: "Keep enquiries, customer context, and follow-ups together. Give every new opportunity a clear next step.", icon: BriefcaseBusiness, label: "Connect", items: ["One place for your leads", "Follow-ups with clear ownership", "Customer conversations in context"] },
  { id: "plan", title: "Turn a brief into a plan.", copy: "Bring requirements, rooms, materials, and quotations into the same workspace. Keep the details connected as the design takes shape.", icon: ClipboardCheck, label: "Plan", items: ["Room-by-room requirements", "Reusable material catalogs", "Quotations linked to the brief"] },
  { id: "deliver", title: "Give everyone the full picture.", copy: "Bring your team and project context together, from the first handoff to the next milestone. A shared view of what comes next.", icon: FolderKanban, label: "Coordinate", items: ["A shared project workspace", "Documents and team comments", "Role-based access for your team"] },
];

const productStory = [
  {
    number: "01",
    title: "Qualify the right work.",
    copy: "Capture the enquiry, agree the brief, and keep every room, reference, and requirement connected.",
    light: "/landing/crm-light.webp",
    dark: "/landing/crm-dark.webp",
    alt: "Wodana CRM dashboard showing the day's priority work",
  },
  {
    number: "02",
    title: "Build the proposal visually.",
    copy: "Turn confirmed scope into a clear quotation, add system or manual items, and shape the client-facing pages on canvas.",
    light: "/landing/quotation-light.webp",
    dark: "/landing/quotation-dark.webp",
    alt: "Wodana visual quotation builder connected to scope and pricing",
  },
  {
    number: "03",
    title: "Deliver with one source of truth.",
    copy: "Move the accepted work into planning, materials, production, site progress, quality, and handover without retyping it.",
    light: "/landing/project-light.webp",
    dark: "/landing/project-dark.webp",
    alt: "Wodana project overview showing the connected delivery flow",
  },
];

// Match the portal module switcher's glyphs and shared identity gradients.
const moduleIcons = { crm: BriefcaseBusiness, planning: ClipboardCheck, projects: FolderKanban, catalogs: PackageSearch, people: Users, design: Palette };
type ModuleKind = keyof typeof moduleIcons;

function ModuleBadge({ kind, large = false }: { kind: ModuleKind; large?: boolean }) {
  const Icon = moduleIcons[kind];
  return <span className={styles.moduleBadge} data-module={kind} data-large={large} aria-hidden="true"><Icon size={large ? 28 : 23} strokeWidth={1.9} /></span>;
}

function RevealHeading({ id, first, second, hero = false }: { id: string; first: string; second: string; hero?: boolean }) {
  const Heading = hero ? "h1" : "h2";
  let character = 0;
  const split = (line: string) => line.split(" ").map((word, wordIndex, words) => <span className={styles.splitWord} key={`${word}-${wordIndex}`}>
    {Array.from(word).map((letter) => {
      const index = character++;
      return <span className={styles.splitChar} key={index} style={{ "--char": index, "--tone": `${Math.min(100, index * 2.6)}%` } as CSSProperties}>{letter}</span>;
    })}{wordIndex < words.length - 1 ? <span className={styles.wordSpace}> </span> : null}
  </span>);
  return <Heading id={id} className={styles.revealHeading} aria-label={`${first} ${second}`}>
    <span className={styles.headingLine} aria-hidden="true">{split(first)}</span><br />
    <span className={`${styles.headingLine} ${styles.headingAccent}`} aria-hidden="true">{split(second)}</span>
  </Heading>;
}

const questions = [
  ["Who is Wodana built for?", "Wodana is built for interior-design businesses, architecture studios, and teams coordinating customer enquiries, pre-execution planning, and delivery."],
  ["What can I manage in the workspace?", "Bring together CRM, customer follow-ups, room requirements, catalogs, quotations, and your team. Available project and HR workflows depend on the modules enabled for your organisation."],
  ["Can I use my existing material catalogs?", "Yes. Organise your catalogs into groups and import supported spreadsheets. Your team can reuse the same rooms, items, and materials across pre-execution planning."],
  ["Can different people have different access?", "Yes. Your administrator manages workspace members, roles, and permissions so people can access the work relevant to them."],
  ["How do I get access?", "Your workspace administrator can invite you to Wodana. If you already have an account, choose Open workspace and sign in with your work email."],
];

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  const Icon = diagonal ? ArrowUpRight : ArrowRight;
  return <Icon aria-hidden="true" size={17} />;
}

function Avatars() {
  return <span className={styles.avatars} aria-label="Design, sales, and project teams"><span>AK</span><span>RM</span><span>SN</span><span>+4</span></span>;
}

function MiniBoard({ mode = "plan" }: { mode?: string }) {
  const rows = mode === "connect"
    ? [["New enquiry", "Parkside residence", "Full-home interiors", "New"], ["Follow-up", "The Grove apartment", "Design consultation", "Today"], ["Qualified", "Jumeirah villa", "Ready for planning", "Ready"]]
    : mode === "deliver"
      ? [["Planning", "Living & dining", "Scope and requirements", "Ready"], ["Design review", "Kitchen joinery", "Material selection", "Review"], ["Team handoff", "Master bedroom", "Drawings and notes", "Next"]]
      : [["Requirements", "Living & dining", "Room brief confirmed", "Ready"], ["Design review", "Kitchen joinery", "Materials & finishes", "Review"], ["Quotation", "Master bedroom", "Estimate prepared", "Draft"]];
  return <div className={styles.miniBoard}>{rows.map(([stage, title, detail, status], index) => <div className={styles.boardColumn} key={stage}>
    <div className={styles.columnHeading}><span><i data-tone={index} />{stage}</span><span>0{index + 1}</span></div>
    <div className={styles.taskCard} style={{ "--card-delay": `${index * 140}ms` } as CSSProperties}>
      <div className={styles.taskMeta}><span>JUMEIRAH VILLA</span><span>···</span></div>
      <strong>{title}</strong><p>{detail}</p>
      <div className={styles.materialSwatches} aria-hidden="true"><span /><span /><span /><span /></div>
      <div className={styles.taskBottom}><span data-status={index}>{status}</span><span className={styles.miniAvatar}>{["AK", "RM", "SN"][index]}</span></div>
    </div>
    <div className={styles.secondaryTask}><CircleCheck size={14} /><span>{["Site measurements", "Finish schedule", "Room estimate"][index]}</span><span className={styles.tinyDot} /></div>
  </div>)}</div>;
}

function WorkspacePreview({ mode = "plan", compact = false }: { mode?: string; compact?: boolean }) {
  return <div className={styles.workspacePreview} data-compact={compact} aria-label="Illustrative Wodana workspace with sample project data">
    <div className={styles.previewTop}><div className={styles.previewBrand}><span className={styles.brandTile}>w.</span><strong>Studio workspace</strong><ChevronDown size={13} /></div><span className={styles.previewCrumb}>{mode === "connect" ? "CRM" : "Pre-execution"}<span>/</span>Jumeirah villa</span><span className={styles.previewWoddy}><Sparkles size={14} />Ask Woddy</span></div>
    <div className={styles.previewBody}>
      <aside className={styles.previewSidebar} aria-hidden="true"><span className={styles.searchMock}><Search size={13} />Search workspace <kbd>⌘ K</kbd></span><small>YOUR WORKSPACE</small>{[[LayoutGrid, "Overview"], [MessageCircle, "CRM"], [Layers3, "Pre-execution"], [FolderKanban, "Projects"], [Package, "Catalogs"], [Users, "Team"]].map(([Icon, label]) => { const ItemIcon = Icon as typeof LayoutGrid; return <span key={label as string} data-active={label === (mode === "connect" ? "CRM" : "Pre-execution")}><ItemIcon size={15} />{label as string}</span>; })}<div className={styles.sidebarBottom}><span className={styles.miniAvatar}>S</span>Studio team <span>⌄</span></div></aside>
      <div className={styles.previewContent}><div className={styles.previewTitle}><div><span className={styles.previewEyebrow}>EVERY DETAIL, CONNECTED</span><h3>{mode === "connect" ? "Your next great project starts here." : mode === "deliver" ? "Great work, moving together." : "A little more clarity. A lot more possibility."}</h3></div><span className={styles.newProject}><Plus size={13} />New project</span></div>
        <div className={styles.previewStats}>{[["Active projects", "12", "Across your studio"], ["Designs in review", "08", "Ready for feedback"], ["Upcoming handoffs", "04", "Everyone in the loop"]].map(([title, value, foot], i) => <div key={title}><span>{title}</span><strong>{value}<span className={styles.statIcon}>{i === 0 ? <FolderKanban size={17} /> : i === 1 ? <Palette size={17} /> : <Users size={17} />}</span></strong><small>{foot}</small></div>)}</div>
        <div className={styles.boardHeading}><strong>{mode === "connect" ? "Your opportunity pipeline" : "Jumeirah villa interiors"}</strong><Avatars /></div><MiniBoard mode={mode} />
        <div className={styles.previewFooter}><span><span className={styles.liveDot} />One shared view. Every team in sync.</span><span>Illustrative workspace</span></div>
      </div>
    </div>
  </div>;
}

export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { theme, toggleTheme } = useWorkspaceTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (!element || !("IntersectionObserver" in window)) return;

    const observed = new WeakSet<Element>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.setAttribute("data-visible", "true");
        // Text stays revealed; cards keep replaying their entrance on scroll.
        if (entry.target.getAttribute("data-reveal") === "once") observer.unobserve(entry.target);
      });
    }, { threshold: 0, rootMargin: "-72px 0px -48px 0px" });
    // Reset cards only well outside the viewport to prevent boundary flicker.
    const resetObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) entry.target.setAttribute("data-visible", "false");
      });
    }, { threshold: 0, rootMargin: "120px 0px 120px 0px" });
    const observeSections = () => {
      element.querySelectorAll("[data-reveal]").forEach((item) => {
        if (!observed.has(item)) {
          observed.add(item);
          item.setAttribute("data-visible", "false");
          observer.observe(item);
          if (item.getAttribute("data-reveal") !== "once") resetObserver.observe(item);
        }
      });
    };
    observeSections();
    // Live edits and newly mounted panels must receive the same motion setup.
    const mutations = new MutationObserver(observeSections);
    mutations.observe(element, { childList: true, subtree: true });
    element.setAttribute("data-motion-ready", "true");
    return () => { observer.disconnect(); resetObserver.disconnect(); mutations.disconnect(); element.removeAttribute("data-motion-ready"); };
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (paused || reducedMotion.matches) return;
      const range = document.documentElement.scrollHeight - window.innerHeight;
      element.style.setProperty("--reading-progress", String(range > 0 ? window.scrollY / range : 0));
      element.style.setProperty("--hero-shift", `${Math.min(window.scrollY * .075, 65)}px`);
      const cards = Array.from(element.querySelectorAll<HTMLElement>("[data-scroll-card]"));
      const positions = cards.map((card) => card.getBoundingClientRect().top);
      cards.forEach((card, index) => {
        const drift = Math.max(-28, Math.min(36, (positions[index] - window.innerHeight * .45) * .055));
        card.style.setProperty("--card-drift", `${drift}px`);
      });
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    reducedMotion.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      reducedMotion.removeEventListener("change", schedule);
    };
  }, [paused]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return <div className={styles.landing} ref={root} data-paused={paused}>
    <a className={styles.skipLink} href="#main-content">Skip to content</a>
    <header className={styles.header}>
      <a href="#" className={styles.logoLink} aria-label="Wodana home"><WodanaLogo size="large" /></a>
      <nav aria-label="Main navigation" className={styles.desktopNav}><a href="#platform">Platform</a><a href="#workflow">How it works</a><a href="#teams">For your team</a><a href="#faq">FAQs</a></nav>
      <div className={styles.headerActions}><button type="button" className={styles.themeToggle} onClick={toggleTheme} aria-label={theme === "light" ? "Use dark mode" : "Use light mode"} title={theme === "light" ? "Use dark mode" : "Use light mode"}>{theme === "light" ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}</button><Link href="/login" className={styles.loginLink}>Log in <Arrow diagonal /></Link><Link href="/workspace" className={styles.smallCta}>Open workspace <Arrow /></Link><button ref={menuButton} className={styles.menuToggle} aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button></div>
      {menuOpen && <nav id="mobile-navigation" aria-label="Mobile navigation" className={styles.mobileNav}>{[["#platform", "Platform"], ["#workflow", "How it works"], ["#teams", "For your team"], ["#faq", "FAQs"], ["/workspace", "Open workspace"]].map(([href, label]) => <a href={href} key={href} onClick={() => setMenuOpen(false)}>{label}<Arrow /></a>)}</nav>}
    </header>

    <main id="main-content">
      <section className={styles.hero} aria-labelledby="hero-heading">
        <div className={styles.heroBackdrop} aria-hidden="true"><div className={styles.gradientField} /><div className={styles.heroGrid} /><div className={styles.orbitOne} /><div className={styles.orbitTwo} /></div>
        <div className={styles.heroCopy} data-reveal="once">
          <span className={styles.eyebrow}><span className={styles.liveDot} />THE WORKSPACE FOR INTERIOR BUSINESSES</span>
          <RevealHeading id="hero-heading" first="Beautiful spaces." second="Beautifully managed." hero />
          <p>From the first hello to the final handover.<br className={styles.desktopBreak} /> Bring your clients, projects, and people into one happy place.</p>
          <div className={styles.heroActions}><Link href="/workspace" className={styles.primaryButton}>Find your flow <Arrow diagonal /></Link><a href="#platform" className={styles.secondaryButton}><span className={styles.playIcon}><ArrowDown size={15} /></span>Explore Wodana</a></div>
          <span className={styles.heroNote}>Made for the way your studio works.</span>
        </div>
        <div className={styles.heroProduct}>
          <div className={`${styles.floatingLabel} ${styles.designerLabel}`}><span className={styles.labelIcon}><Palette size={15} /></span>For the creative minds<MousePointer2 className={styles.labelPointer} size={18} /></div>
          <div className={`${styles.floatingLabel} ${styles.teamLabel}`}><span className={styles.labelIcon}><Users size={15} /></span>And the people behind them<MousePointer2 className={styles.labelPointer} size={18} /></div>
          <div className={styles.heroPreview}><WorkspacePreview /></div>
          <div className={styles.approvalFloat}><span className={styles.approvalIcon}><CheckCheck size={19} /></span><div><strong>One step closer.</strong><span>Living room design approved</span></div><span className={styles.notificationDot} /></div>
          <div className={styles.progressFloat}><div><span>Project clarity</span><ArrowUpRight size={16} /></div><strong>100<span>%</span></strong><div className={styles.progressBars} aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ "--bar": i } as CSSProperties} />)}</div><small>Every detail. In the right place.</small></div>
        </div>
        <div className={styles.heroBottom}><span>LESS JUGGLING. MORE CREATING.</span><button aria-pressed={paused} onClick={() => setPaused(!paused)} className={styles.motionButton}>{paused ? "Play animations" : "Pause animations"}{paused ? <Play aria-hidden="true" size={12} /> : <Pause aria-hidden="true" size={12} />}</button></div>
      </section>
      <div className={styles.moduleStrip} aria-label="Connected workspace modules">{([["crm", "CRM & conversations"], ["planning", "Pre-execution planning"], ["catalogs", "Materials & catalogs"], ["projects", "Project coordination"], ["people", "People & teams"]] as [ModuleKind, string][]).map(([kind, label]) => <span key={kind}><ModuleBadge kind={kind} />{label}</span>)}</div>

      <section className={styles.productTour} id="tour" aria-labelledby="tour-heading">
        <div className={styles.sectionHeading} data-reveal="once">
          <span className={styles.eyebrow}>ONE COMPLETE FLOW</span>
          <RevealHeading id="tour-heading" first="See the work move." second="From enquiry to handover." />
          <p>Real Wodana screens. One connected record all the way through.</p>
        </div>
        <div className={styles.flowRail} aria-label="Wodana workflow">
          {['Enquiry', 'Requirements', 'Quotation', 'Project', 'Delivery', 'Handover'].map((label, index) => <span key={label}><b>{index + 1}</b>{label}</span>)}
        </div>
        <div className={styles.flowFilm} data-reveal>
          <video aria-label="A complete Wodana workflow from enquiry to project handover" autoPlay loop muted playsInline poster="/landing/crm-dark.webp">
            <source src="/landing/wodana-complete-flow.webm" type="video/webm" />
          </video>
          <span className={styles.filmCaption}><span className={styles.liveDot} />Recorded in the working product</span>
        </div>
        <div className={styles.storyGrid}>
          {productStory.map((story) => <article className={styles.storyCard} data-reveal data-scroll-card key={story.number}>
            <div className={styles.storyCopy}><span>{story.number}</span><h3>{story.title}</h3><p>{story.copy}</p></div>
            <div className={styles.storyFrame}>
              <Image alt={story.alt} className={styles.storyImageLight} height={900} src={story.light} width={1440} />
              <Image alt="" aria-hidden="true" className={styles.storyImageDark} height={900} src={story.dark} width={1440} />
            </div>
          </article>)}
        </div>
      </section>

      <section id="platform" className={styles.section} aria-labelledby="platform-heading">
        <div className={styles.sectionHeading} data-reveal="once"><span className={styles.eyebrow}>A LITTLE LESS CHAOS</span><RevealHeading id="platform-heading" first="Big ideas need" second="a beautifully organised home." /><p>All the moving parts of your interior business.<br className={styles.desktopBreak} /> Finally, moving together.</p></div>
        <div className={styles.featureGrid}>
          <article className={`${styles.featureCard} ${styles.crmCard}`} data-reveal data-scroll-card><ModuleBadge kind="crm" /><h3>Good conversations.<br />Great beginnings.</h3><p>Give every enquiry a home. Keep the context, follow-ups, and next steps close.</p><div className={styles.pipelineVisual} aria-label="Illustrative CRM pipeline"><div><span>Your opportunity pipeline</span><span>•••</span></div><strong>Make the next move clear.</strong><div className={styles.pipelineTrack}><span /><span /><span /></div><div className={styles.pipelineLegend}><span><i />New enquiry</span><span><i />In conversation</span><span><i />Qualified</span></div><div className={styles.leadCard}><span className={styles.leadAvatar}>SR</span><div><strong>Studio residence</strong><span>Full-home interiors</span></div><span className={styles.leadBadge}>Follow up <ArrowUpRight size={12} /></span></div></div></article>
          <article className={`${styles.featureCard} ${styles.planningCard}`} data-reveal data-scroll-card><ModuleBadge kind="planning" /><h3>From moodboard<br />to master plan.</h3><p>Connect room requirements, materials, and quotations. Let the details do the talking.</p><div className={styles.roomVisual}><div className={styles.roomVisualHeader}><span><Palette size={15} />Living room palette</span><span>04 finishes</span></div><div className={styles.bigSwatches} aria-label="Material palette: oak, linen, stone, and clay"><span><i />Oak</span><span><i />Linen</span><span><i />Stone</span><span><i />Clay</span></div><div className={styles.roomCheck}><CircleCheck size={15} /><span>Requirements captured</span><span>12 / 12</span></div><div className={styles.roomCheck}><ClipboardList size={15} /><span>Quotation ready for review</span><ArrowUpRight size={14} /></div></div></article>
          <article className={`${styles.featureCard} ${styles.woddyCard}`} data-reveal data-scroll-card><span className={styles.woddyBadge}><Sparkles size={14} />MEET YOUR WORKSPACE SIDEKICK</span><div className={styles.woddyMark}><WoddyMark size={150} alt="Woddy, the Wodana assistant" /></div><h3>A little help.<br />Right where you work.</h3><p>Meet Woddy. Ask a question and get a helping hand with your workspace.</p><div className={styles.chatVisual} aria-label="Illustrative Woddy conversation"><div className={styles.chatQuestion}>Where should I start today?</div><div className={styles.chatAnswer}><Sparkles size={16} /><div><strong>Let’s make room for good work.</strong><p>Start with your follow-ups, then review the briefs waiting for your attention.</p><span><Check size={13} />One next step at a time</span></div></div><div className={styles.chatInput}><span>Ask Woddy a question…</span><span><ArrowUpRight size={14} /></span></div></div><small>Illustrative conversation</small></article>
          <article className={`${styles.featureCard} ${styles.collaborationCard}`} data-reveal data-scroll-card><div><ModuleBadge kind="people" /><h3>Same page.<br />Even on different days.</h3><p>Bring decisions, documents, and people together. Keep the handoff as thoughtful as the design.</p></div><div className={styles.activityVisual}><div className={styles.activityTitle}><strong>The latest, all together.</strong><Avatars /></div>{[["AK", "Anika added the room brief", "Planning · Just now"], ["RM", "Rohan shared the finish schedule", "Design · 12 min ago"], ["SN", "Sara left a review comment", "Team · 24 min ago"]].map(([initials, title, detail]) => <div className={styles.activityItem} key={initials}><span className={styles.miniAvatar}>{initials}</span><div><strong>{title}</strong><span>{detail}</span></div><CheckCheck size={13} /></div>)}<div className={styles.activityNote}><span className={styles.liveDot} />A shared space for every little update.</div></div></article>
        </div>
      </section>

      <section className={styles.clarityBand} aria-labelledby="clarity-heading"><div className={styles.clarityInner}><div data-reveal="once"><span className={styles.eyebrow}>ROOM TO DO YOUR BEST WORK</span><RevealHeading id="clarity-heading" first="Less chasing." second="More creating." /></div><div className={styles.clarityPoints} data-reveal="once">{[["01", "A shared source of context", "Keep the brief, the materials, and the conversation connected."], ["02", "A clear next step", "Know what needs attention and who’s taking it forward."], ["03", "A little breathing room", "Spend less time piecing things together. More time on your craft."]].map(([number,title,copy]) => <div key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></div>)}</div></div></section>

      <section id="workflow" className={`${styles.section} ${styles.workflowSection}`} aria-labelledby="workflow-heading"><div className={styles.sectionHeading} data-reveal="once"><span className={styles.eyebrow}>FROM HELLO TO WHAT’S NEXT</span><RevealHeading id="workflow-heading" first="A natural flow." second="For extraordinary work." /><p>A connected journey for your clients and your team.</p></div><div className={styles.workflowTabs} data-reveal><Tabs defaultSelectedKey="connect" items={workflow.map((step, index) => ({ id: step.id, label: <><span>0{index + 1}</span><step.icon size={16} />{step.label}</>, panel: <div className={styles.workflowPanel}><div className={styles.workflowCopy}><span className={styles.stepNumber}>0{index + 1} / 03</span><h3>{step.title}</h3><p>{step.copy}</p><ul>{step.items.map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul><Link href="/workspace" className={styles.textLink}>Bring it all together <Arrow /></Link></div><div className={styles.workflowPreview}><WorkspacePreview mode={step.id} compact /><span className={styles.workflowCaption}><CircleCheck size={14} />One workspace. A more connected way to work.</span></div></div> }))} /></div></section>

      <section id="teams" className={`${styles.section} ${styles.teamsSection}`} aria-labelledby="teams-heading"><div className={styles.splitHeading} data-reveal="once"><div><span className={styles.eyebrow}>DESIGNED AROUND YOUR PEOPLE</span><RevealHeading id="teams-heading" first="Different superpowers." second="One shared space." /></div><p>For the people with the vision.<br />And everyone who brings it to life.</p></div><div className={styles.teamGrid}>{[
        { module: "design" as ModuleKind, label: "FOR DESIGNERS", title: "Keep the vision in view.", copy: "Bring briefs, room requirements, and material selections together without losing the little details.", tags: ["Room briefs", "Materials", "Design context"] },
        { module: "crm" as ModuleKind, label: "FOR SALES TEAMS", title: "Make every hello count.", copy: "Build stronger client relationships with shared context and thoughtful, timely follow-ups.", tags: ["Lead pipeline", "Follow-ups", "Conversations"] },
        { module: "projects" as ModuleKind, label: "FOR STUDIO LEADS", title: "See how it all connects.", copy: "Give your team a shared home for people, project context, and the work coming next.", tags: ["Team access", "Project context", "Coordination"] },
      ].map((team, i) => <article className={styles.teamCard} key={team.title} data-tone={i} data-reveal data-scroll-card><div className={styles.teamCardTop}><ModuleBadge kind={team.module} large /><ArrowUpRight size={20} /></div><span className={styles.teamEyebrow}>{team.label}</span><h3>{team.title}</h3><p>{team.copy}</p><div className={styles.teamTags}>{team.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></article>)}</div></section>

      <section className={styles.connectedSection} aria-labelledby="connected-heading"><div className={styles.connectedInner}><div className={styles.connectedVisual} data-reveal aria-label="CRM, planning, projects, catalogs, and people connected in Wodana"><div className={styles.connectionRing} /><div className={styles.connectionRingTwo} /><div className={styles.hubMark}><WodanaLogo /><span>YOUR WORKSPACE</span></div>{([["crm", "CRM"], ["planning", "Planning"], ["catalogs", "Catalogs"], ["people", "People"], ["projects", "Projects"], ["design", "Design"]] as [ModuleKind, string][]).map(([kind, label], i) => <div key={kind} className={styles.moduleNode} style={{ "--node": i } as CSSProperties}><ModuleBadge kind={kind} /><strong>{label}</strong></div>)}</div><div className={styles.connectedCopy} data-reveal="once"><span className={styles.eyebrow}>THE WHOLE STUDIO, CONNECTED</span><RevealHeading id="connected-heading" first="Everything has a place." second="Everything feels closer." /><p>Your conversations inform the brief. Your catalogs inform the plan. Your people bring it all together. That’s the beauty of a shared workspace.</p><a href="#platform" className={styles.textLink}>Meet your new workspace <Arrow /></a></div></div></section>

      <section className={`${styles.section} ${styles.faqSection}`} id="faq" aria-labelledby="faq-heading"><div className={styles.faqIntro} data-reveal="once"><span className={styles.eyebrow}>A FEW THINGS TO KNOW</span><RevealHeading id="faq-heading" first="Good questions." second="Clear answers." /><p>A little clarity before you step inside.</p><span className={styles.faqSparkle} aria-hidden="true"><Sparkles size={55} strokeWidth={1} /></span></div><div className={styles.faqList} data-reveal="once">{questions.map(([question, answer]) => <details key={question} name="landing-faq"><summary>{question}<Plus size={18} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>

      <section className={styles.ctaSection} aria-labelledby="cta-heading"><div className={styles.ctaGradient} aria-hidden="true" /><div className={styles.ctaContent} data-reveal="once"><span className={styles.eyebrow}>MAKE ROOM FOR WHAT MATTERS</span><RevealHeading id="cta-heading" first="Great spaces start" second="with a little harmony." /><p>Bring your next chapter together in Wodana.</p><Link href="/workspace" className={styles.primaryButton}>Step into your workspace <Arrow diagonal /></Link><span className={styles.ctaNote}>Your people. Your projects. Your happy place.</span></div><span className={styles.ctaLeft} aria-hidden="true"><Palette size={23} />Room to create</span><span className={styles.ctaRight} aria-hidden="true"><CheckCheck size={23} />Space to grow</span></section>
    </main>
    <footer className={styles.footer}><div><a href="#" aria-label="Wodana home" className={styles.logoLink}><WodanaLogo size="large" /></a><p>A little less admin.<br />A lot more room to create.</p></div><div><span>YOUR WORKSPACE</span><a href="#platform">The platform</a><a href="#workflow">How it works</a><a href="/login">Sign in</a></div><div><span>MADE FOR YOUR TEAM</span><a href="#teams">Interior studios</a><a href="#teams">Project teams</a><a href="#faq">Questions & answers</a></div><div className={styles.footerBottom}><span>© {new Date().getFullYear()} Wodana. Made for work that matters.</span><span>From first hello, to beautifully done. <Sparkles size={14} /></span></div></footer>
  </div>;
}
