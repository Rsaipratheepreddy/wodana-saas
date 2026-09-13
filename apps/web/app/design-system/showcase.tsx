"use client";

import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  AlignRight, ArrowUpRight, Bell, Blocks, Boxes, Building2, CalendarDays, Check, Copy,
  ChevronRight, CircleDollarSign, FileText, FormInput, Gauge, Globe2,
  LayoutDashboard, MessageSquare, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus,
  Search, Settings2, Sparkles, Sun, Table2, Users, Workflow,
} from "lucide-react";
import {
  AIResult, ApprovalRow, Avatar, AvatarGroup, Badge, BoqEditor, Button, Callout, Checkbox,
  CommentLayer, DataGrid, DesignSystemProvider, FieldStack, FileBrowser, Heading,
  IconButton, Inline, InputAction, IntegrationConnectionRow, InteriorProjectFlow, LocalizedValue, MenuButton,
  ModalDialog, MoneyInput, Persona, ProcurementChain, Progress, PropertyRow, SideSheet,
  RadioSet, SelectField, Skeleton, Spinner, Stack, Switch, Tabs, Text, TextAreaField, TextInput,
  ToastProvider, TooltipBubble, useToast,
  type BoqLine, type CommentAuthor, type DataGridColumn,
  type DesignSystemDensity, type DesignSystemDirection, type DesignSystemTheme,
  type PointComment, type ProcurementStage,
} from "@/design-system";
import styles from "./design-system.module.css";

type Project = {
  id: string;
  project: string;
  client: string;
  owner: string;
  phase: string;
  progress: number;
  value: number;
  currency: string;
  status: "On track" | "Needs approval" | "At risk";
};

type NavItem = {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

const initialProjects: Project[] = [
  { id: "PRJ-1042", project: "Shah Residence", client: "Meera Shah · Indiranagar", owner: "Kabir Arora", phase: "Design approval", progress: 68, value: 1265432, currency: "INR", status: "On track" },
  { id: "PRJ-1043", project: "Palm Villa", client: "Nadia Rahman · Jumeirah", owner: "Diya Nair", phase: "BOQ approval", progress: 42, value: 186400, currency: "AED", status: "Needs approval" },
  { id: "PRJ-1044", project: "Bose Apartment", client: "Rhea Bose · Whitefield", owner: "Manoj Pillai", phase: "Production", progress: 76, value: 842000, currency: "INR", status: "At risk" },
  { id: "PRJ-1045", project: "Olive Townhouse", client: "Sara George · Dubai Hills", owner: "Rhea Mehta", phase: "Installation", progress: 84, value: 242000, currency: "AED", status: "On track" },
];

const people: CommentAuthor[] = [
  { id: "u1", name: "Iglo Owner" },
  { id: "u2", name: "Diya Nair" },
  { id: "u3", name: "Kabir Arora" },
];

const navigation: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "data", label: "Data tables", icon: Table2 },
  { id: "foundations", label: "Foundations", icon: Blocks },
  { id: "actions", label: "Actions", icon: Gauge },
  { id: "forms", label: "Forms", icon: FormInput },
  { id: "workflow", label: "Workflow", icon: Workflow },
  { id: "collaboration", label: "Collaboration", icon: MessageSquare },
  { id: "domain", label: "Domain patterns", icon: Boxes },
];

const sparks = [
  "4,31 18,24 31,27 44,16 58,22 72,20 88,28 102,17 116,19 132,8",
  "4,27 18,28 31,18 44,22 58,14 72,18 88,12 102,19 116,13 132,10",
  "4,30 18,24 31,25 44,22 58,27 72,18 88,20 102,14 116,17 132,7",
  "4,25 18,22 31,27 44,18 58,20 72,15 88,24 102,16 116,10 132,12",
  "4,29 18,25 31,19 44,25 58,21 72,22 88,14 102,18 116,9 132,6",
];

function MiniChart({ points }: { points: string }) {
  return (
    <svg aria-hidden="true" className={styles.sparkline} preserveAspectRatio="none" viewBox="0 0 136 36">
      <polyline fill="none" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Metric({ detail, index, label, value }: { detail: string; index: number; label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong dir="ltr">{value}</strong>
      <small>{detail}</small>
      <MiniChart points={sparks[index]} />
    </div>
  );
}

function SectionHeader({ description, eyebrow, title }: { description: string; eyebrow: string; title: string }) {
  return (
    <header className={styles.sectionHeader}>
      <div><span>{eyebrow}</span><Heading size="md">{title}</Heading></div>
      <Text tone="muted">{description}</Text>
    </header>
  );
}

function Specimen({ children, description, title }: { children: ReactNode; description: string; title: string }) {
  return (
    <section className={styles.specimen}>
      <header><strong>{title}</strong><span>{description}</span></header>
      <div>{children}</div>
    </section>
  );
}

function DesignSystemShowcaseContent() {
  const { push } = useToast();
  const [theme, setTheme] = useState<DesignSystemTheme>("light");
  const [density, setDensity] = useState<DesignSystemDensity>("comfortable");
  const [direction, setDirection] = useState<DesignSystemDirection>("ltr");
  const [collapsed, setCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState(initialProjects);
  const [projectView, setProjectView] = useState("all");
  const [comments, setComments] = useState<PointComment[]>([]);
  const [projectName, setProjectName] = useState("");
  const [website, setWebsite] = useState("wodana.com");
  const [additionalEmails, setAdditionalEmails] = useState<string[]>([]);
  const [projectOwner, setProjectOwner] = useState("diya");
  const [approvalState, setApprovalState] = useState<"pending" | "approved" | "rejected">("pending");
  const [procurementStage, setProcurementStage] = useState<ProcurementStage>("quotes");
  const [boq, setBoq] = useState<BoqLine[]>([
    { id: "B1", space: "Kitchen", item: "Base cabinets", specification: "Moisture-resistant carcass", quantity: 8.4, unit: "lm", rate: 1200, sellingRate: 1680, status: "approved" },
    { id: "B2", space: "Kitchen", item: "Quartz worktop", specification: "20 mm, eased edge", quantity: 5.8, unit: "sqm", rate: 780, sellingRate: 1080, status: "approved" },
    { id: "B3", space: "Living", item: "Feature wall joinery", specification: "Oak veneer and lacquer", quantity: 1, unit: "lot", rate: 14200, sellingRate: 19500, status: "draft" },
  ]);

  const visibleNavigation = navigation.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const nextTheme: DesignSystemTheme = theme === "light" ? "dark" : theme === "dark" ? "high-contrast" : "light";
  const nextThemeLabel = nextTheme === "high-contrast" ? "high contrast" : nextTheme;
  const notify = (title: string, message: string, tone: "neutral" | "success" | "warning" | "danger" | "info" = "neutral") => push({ title, message, tone });

  const visibleProjects = useMemo(
    () => projectView === "mine" ? projects.filter((project) => project.owner === "Diya Nair") : projectView === "risk" ? projects.filter((project) => project.status === "At risk") : projects,
    [projectView, projects],
  );

  const columns = useMemo<DataGridColumn<Project>[]>(() => [
    { accessorKey: "project", header: "Project", size: 208, meta: { primary: true }, cell: ({ row }) => <span className={styles.primaryCell}><strong>{row.original.project}</strong><small>{row.original.client}</small></span> },
    { accessorKey: "owner", header: "Owner", size: 138, meta: { mobileHidden: true }, cell: ({ row }) => <Persona name={row.original.owner} /> },
    { accessorKey: "phase", header: "Current stage", size: 140, meta: { editable: true, mobileHidden: true } },
    { accessorKey: "progress", header: "Progress", size: 132, meta: { mobileHidden: true }, cell: ({ row }) => <span className={styles.progressCell}><Progress label={`${row.original.project} progress`} value={row.original.progress} /><LocalizedValue><small>{row.original.progress}%</small></LocalizedValue></span> },
    { accessorKey: "status", header: "Status", size: 136, cell: ({ row }) => <Badge tone={row.original.status === "On track" ? "success" : row.original.status === "At risk" ? "danger" : "warning"}>{row.original.status}</Badge> },
    { accessorKey: "value", header: "Value", size: 124, meta: { align: "end", mobileHidden: true }, cell: ({ row }) => <LocalizedValue>{new Intl.NumberFormat(direction === "rtl" ? "ar-AE" : "en-AE", { style: "currency", currency: row.original.currency, maximumFractionDigits: 0 }).format(row.original.value)}</LocalizedValue> },
  ], [direction]);

  const createProject = () => {
    const name = projectName.trim();
    if (!name) return;
    setProjects((current) => [...current, {
      id: `PRJ-${1042 + current.length}`, project: name,
      client: "New client · Location pending",
      owner: projectOwner === "diya" ? "Diya Nair" : "Kabir Arora",
      phase: "Briefing", progress: 8, value: 0, currency: "AED", status: "On track",
    }]);
    setProjectName("");
    notify("Project created", `${name} was added to the table.`, "success");
  };

  return (
    <DesignSystemProvider currency="AED" density={density} direction={direction} locale={direction === "rtl" ? "ar-AE" : "en-AE"} theme={theme} timeZone="Asia/Dubai">
      <main className={styles.shell} data-collapsed={collapsed || undefined}>
        <header className={styles.topbar}>
          <div className={styles.brandCell}>
            <a aria-label="Wodana design system" className={styles.brand} dir="ltr" href="#overview"><span>wo</span>dana</a>
            <IconButton aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className={styles.sidebarToggle} onPress={() => setCollapsed((value) => !value)} size="compact">
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </IconButton>
          </div>
          <div className={styles.topbarTitle}><strong>Design system</strong><span>Product UI · v1.0</span></div>
          <div className={styles.topbarActions}>
            <IconButton aria-label={density === "compact" ? "Use standard density" : "Use compact density"} onPress={() => setDensity((value) => value === "compact" ? "comfortable" : "compact")} size="compact"><Gauge size={15} /></IconButton>
            <IconButton aria-label={`Use ${nextThemeLabel} theme`} onPress={() => setTheme(nextTheme)} size="compact">{theme === "light" ? <Moon size={15} /> : theme === "dark" ? <Sparkles size={15} /> : <Sun size={15} />}</IconButton>
            <IconButton aria-label={`Switch to ${direction === "ltr" ? "RTL" : "LTR"}`} onPress={() => setDirection((value) => value === "ltr" ? "rtl" : "ltr")} size="compact">{direction === "ltr" ? <AlignRight size={15} /> : <Globe2 size={15} />}</IconButton>
            <Avatar name="Iglo Owner" />
          </div>
        </header>

        <aside className={styles.sidebar}>
          <div className={styles.workspace}><span className={styles.workspaceMark}><Sparkles size={15} /></span><span><strong>Wodana system</strong><small>Production library</small></span></div>
          <label className={styles.navSearch}><Search aria-hidden="true" size={14} /><span className="wd-visually-hidden">Search components</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Find components" value={query} /></label>
          <nav aria-label="Design system sections" className={styles.navigation}>
            {visibleNavigation.map((item) => {
              const Icon = item.icon;
              return <a aria-label={item.label} data-active={activeSection === item.id || undefined} data-label={item.label} href={`#${item.id}`} key={item.id} onClick={() => setActiveSection(item.id)}><Icon size={16} strokeWidth={1.8} /><span>{item.label}</span></a>;
            })}
          </nav>
          <div className={styles.sidebarFooter}><span className={styles.statusDot} /><span><strong>System ready</strong><small>48 components checked</small></span></div>
        </aside>

        <article className={styles.content}>
          <section className={styles.overview} id="overview">
            <div className={styles.pageHeading}>
              <div><Heading as="h1" size="md">Overview <span>· September</span></Heading><Text tone="muted">A compact product language for Wodana’s interior-design workspace.</Text></div>
              <Badge tone="success"><Check size={12} /> Release candidate</Badge>
            </div>
            <div className={styles.metricGrid}>
              <Metric detail="Inter · Noto Arabic" index={0} label="Product type" value="14 / 20" />
              <Metric detail="Compact / standard" index={1} label="Control height" value="32 / 38" />
              <Metric detail="Default density" index={2} label="Table rows" value="52 px" />
              <Metric detail="Hover / interface" index={3} label="Motion" value="150 / 200" />
              <Metric detail="English and Arabic" index={4} label="Direction" value="LTR / RTL" />
            </div>
          </section>

          <section className={styles.section} id="data">
            <div className={styles.dataTitle}>
              <div><Heading size="md">Data tables</Heading><Text tone="muted">Search, saved views, inline hierarchy and a fixed inspector.</Text></div>
              <ModalDialog description="Create a connected project record without leaving the table." footer={<div className="wd-dialog-actions"><Button slot="close">Cancel</Button><Button isDisabled={!projectName.trim()} onPress={createProject} slot="close" variant="primary">Create project</Button></div>} title="Create project" trigger={<Button variant="primary"><Plus size={15} />Create project</Button>}>
                <FieldStack><TextInput description="Visible to your internal team and client." isRequired label="Project name" onChange={setProjectName} placeholder="e.g. Palm Villa" value={projectName} /><SelectField items={[{ id: "diya", label: "Diya Nair" }, { id: "kabir", label: "Kabir Arora" }]} label="Project owner" onSelectionChange={(key) => setProjectOwner(String(key))} selectedKey={projectOwner} /><SelectField items={[{ id: "residential", label: "Residential" }, { id: "hospitality", label: "Hospitality" }, { id: "retail", label: "Retail" }]} label="Project type" /><MoneyInput currency="AED" label="Estimated contract value" minValue={0} /></FieldStack>
              </ModalDialog>
            </div>
            <DataGrid ariaLabel="Project portfolio" bulkActions={(rows) => <Button onPress={() => setProjects((items) => items.map((item) => rows.some((row) => row.id === item.id) ? { ...item, owner: "Diya Nair" } : item))} size="compact">Assign {rows.length} to me</Button>} columns={columns} data={visibleProjects} getInspectorTitle={(row) => row.project} getRowId={(row) => row.id} onCellUpdate={(row, column, value) => setProjects((items) => items.map((item) => item.id === row.id ? { ...item, [column]: value } : item))} onViewChange={setProjectView} persistKey="ds-projects" renderInspector={(row) => <Stack gap={4}><Persona description={row.client} name={row.owner} /><PropertyRow label="Stage"><strong>{row.phase}</strong></PropertyRow><PropertyRow label="Status"><Badge tone={row.status === "On track" ? "success" : row.status === "At risk" ? "danger" : "warning"}>{row.status}</Badge></PropertyRow><PropertyRow label="Progress"><Progress label="Project progress" value={row.progress} /></PropertyRow><PropertyRow label="Project value"><LocalizedValue>{new Intl.NumberFormat("en-AE", { style: "currency", currency: row.currency, maximumFractionDigits: 0 }).format(row.value)}</LocalizedValue></PropertyRow><Button variant="primary">Open full project <ArrowUpRight size={14} /></Button></Stack>} renderSubtable={(row) => <div className={styles.subtable}><span className={styles.subtableIcon}><FileText size={15} /></span><span><strong>Design review · {row.project}</strong><small>Client comments consolidated into revision 04</small></span><Badge tone="warning">Due tomorrow</Badge><Button size="compact" variant="quiet">Open <ChevronRight data-directional="true" size={13} /></Button></div>} savedViews={[{ id: "all", label: "All projects" }, { id: "mine", label: "My projects" }, { id: "risk", label: "At risk" }]} selectedView={projectView} />
          </section>

          <section className={styles.section} id="foundations">
            <SectionHeader description="Exact tokens create the density and calm visible in every Wodana module." eyebrow="Foundations" title="One rhythm, everywhere" />
            <div className={styles.twoColumn}>
              <Specimen description="Action, selection and state—not decoration." title="Color roles"><div className={styles.tokens}>{["action", "aqua", "ink", "muted", "line", "surface", "canvas", "success", "warning", "danger"].map((token) => <span data-token={token} key={token}><i /><small>{token}</small></span>)}</div></Specimen>
              <Specimen description="No marketing-sized type inside the app." title="Type hierarchy"><div className={styles.typeSample}><Heading size="lg">24px page title</Heading><Heading size="md">18px section title</Heading><Text>14px interface copy for calm, readable work.</Text><Text size="xs" tone="muted">12PX LABEL · UPDATED 4 MINUTES AGO</Text></div></Specimen>
            </div>
            <div className={styles.motionStrip}><span><strong>150ms</strong> hover and focus</span><span><strong>200ms</strong> interface movement</span><span><strong>320ms</strong> large transitions</span><span><strong>480ms</strong> marketing reveal only</span></div>
          </section>

          <section className={styles.section} id="actions">
            <SectionHeader description="One primary action per area, quiet secondary controls, and no decorative pills." eyebrow="Actions" title="Obvious without being loud" />
            <Specimen description="Hover, press, focus, loading and disabled states are built in." title="Button hierarchy"><Inline gap={2}><Button onPress={() => notify("Changes saved", "The example record is up to date.", "success")} variant="primary">Save changes</Button><Button onPress={() => notify("Preview opened", "This demonstrates a secondary action.", "info")}>Preview document</Button><Button onPress={() => notify("Action cancelled", "No changes were applied.")} variant="quiet">Cancel</Button><Button onPress={() => notify("Archive confirmation", "Destructive actions open a confirmation before execution.", "warning")} variant="danger">Archive</Button><Button isLoading>Saving</Button><Button isDisabled>Unavailable</Button></Inline></Specimen>
            <div className={styles.componentGrid}>
              <Specimen description="Compact controls stay discoverable through labels and menus." title="Icon buttons & menus"><Inline gap={2}><TooltipBubble content="Notifications"><IconButton aria-label="Notifications"><Bell size={16} /></IconButton></TooltipBubble><TooltipBubble content="Workspace settings"><IconButton aria-label="Workspace settings"><Settings2 size={16} /></IconButton></TooltipBubble><MenuButton items={[{ id: "duplicate", label: "Duplicate" }, { id: "archive", label: "Archive", tone: "danger" }]} label={<><MoreHorizontal size={15} /> More</>} onAction={(action) => notify("Menu action", action, "info")} /></Inline></Specimen>
              <Specimen description="Initials remain distinct without using brand green for everyone." title="Avatars & presence"><Inline gap={3}><AvatarGroup><Avatar name="Diya Nair" /><Avatar name="Kabir Arora" /><Avatar name="Rhea Mehta" /><Avatar name="Manoj Pillai" /></AvatarGroup><Persona description="Design lead · Online" name="Diya Nair" presence="online" /></Inline></Specimen>
              <Specimen description="Color is never the only status signal." title="Status & selection"><Inline gap={2}><Badge tone="success">Approved</Badge><Badge tone="warning">Needs review</Badge><Badge tone="danger">Blocked</Badge><Badge tone="info">Syncing</Badge><Switch>Client can view</Switch><Checkbox>Include tax</Checkbox></Inline></Specimen>
              <Specimen description="Modals confirm focused tasks; side sheets preserve list context." title="Modal & inspector"><Inline gap={2}><ModalDialog description="Review the scope before creating a client-visible record." footer={<div className="wd-dialog-actions"><Button slot="close">Cancel</Button><Button slot="close" variant="primary">Create</Button></div>} title="Create requirement" trigger={<Button>Open modal</Button>}><FieldStack><TextInput label="Requirement" placeholder="e.g. Concealed shoe storage" /><SelectField items={[{ id: "living", label: "Living room" }, { id: "foyer", label: "Foyer" }]} label="Space" /></FieldStack></ModalDialog><SideSheet description="Edit without losing the table position." footer={<div className="wd-dialog-actions"><Button slot="close">Cancel</Button><Button slot="close" variant="primary">Save changes</Button></div>} size="sm" title="Project inspector" trigger={<Button>Open side panel</Button>}><Stack gap={4}><Persona description="Primary client" name="Nadia Rahman" /><PropertyRow label="Stage"><Badge tone="warning">BOQ approval</Badge></PropertyRow><PropertyRow label="Owner"><Persona name="Diya Nair" /></PropertyRow><TextAreaField label="Internal note" placeholder="Add context for the team…" /></Stack></SideSheet></Inline></Specimen>
              <Specimen description="Async work communicates progress without shifting the surrounding layout." title="Loading & progress"><Stack gap={4}><Inline gap={2}><Spinner label="Syncing workspace" /><Text>Syncing workspace data…</Text></Inline><Skeleton lines={3} /><Stack gap={2}><Inline gap={2}><Text>Uploading technical drawings</Text><Text size="xs" tone="muted">64%</Text></Inline><Progress label="Uploading technical drawings" value={64} /></Stack></Stack></Specimen>
            </div>
          </section>

          <section className={styles.section} id="forms">
            <SectionHeader description="48px controls, clear labels, softly raised actions, and a single gradient focus sweep that settles into a stable border." eyebrow="Forms" title="Focused data entry" />
            <div className={styles.formLayout}>
              <Specimen description="The reusable input, grouped field, repeat action, and submit hierarchy from the approved reference." title="Input module"><form className={styles.referenceForm} onSubmit={(event) => { event.preventDefault(); notify("Form submitted", "The input module is working.", "success"); }}><TextInput isRequired label="Full name" placeholder="Type your name" /><TextInput inputType="url" isRequired label="Website" onChange={setWebsite} prefix="https://" suffix={<InputAction aria-label="Copy website" onPress={() => { void navigator.clipboard?.writeText(`https://${website}`).catch(() => undefined); notify("Website copied", `https://${website}`, "info"); }}><Copy aria-hidden="true" size={15} />Copy</InputAction>} value={website} /> <TextInput inputType="email" isRequired label="Email" placeholder="Type your email address" />{additionalEmails.map((email, index) => <TextInput inputType="email" key={index} label={`Additional email ${index + 1}`} onChange={(value) => setAdditionalEmails((items) => items.map((item, itemIndex) => itemIndex === index ? value : item))} placeholder="Type another email address" value={email} />)}<Button className={styles.formAdd} onPress={() => setAdditionalEmails((items) => [...items, ""])} size="large"><Plus aria-hidden="true" size={17} />Add another</Button><div aria-hidden="true" className={styles.formDivider} /><Button className={styles.formSubmit} size="large" type="submit" variant="gradient">Submit <ArrowUpRight aria-hidden="true" size={17} /></Button></form></Specimen>
              <Specimen description="Select, money, error, disabled, radio, and inspector states use the same focus behavior." title="Field states"><FieldStack><SelectField items={[{ id: "residential", label: "Residential" }, { id: "hospitality", label: "Hospitality" }]} label="Project type" placeholder="Choose a project type" /><MoneyInput currency="AED" label="Contract value" minValue={0} /><TextInput errorMessage="Enter a valid work email." inputType="email" isInvalid label="Client email · error" value="nadia@" /><TextInput isDisabled label="Project ID · read only" value="PRJ-1043" /><RadioSet items={[{ id: "standard", label: "Standard", description: "Normal approval flow" }, { id: "fast", label: "Fast-track", description: "Shortened client review" }]} label="Delivery path" /></FieldStack></Specimen>
              <Specimen description="Inspectors and record details." title="Property rows"><div className={styles.propertySheet}><PropertyRow label="Client"><Persona description="Primary contact" name="Nadia Rahman" /></PropertyRow><PropertyRow label="Design owner"><SelectField aria-label="Design owner" items={[{ id: "diya", label: "Diya Nair" }, { id: "kabir", label: "Kabir Arora" }]} label={<span className="wd-visually-hidden">Design owner</span>} selectedKey="diya" /></PropertyRow><PropertyRow label="Target date"><LocalizedValue>24 Sep 2026</LocalizedValue></PropertyRow><PropertyRow label="Notes"><TextAreaField aria-label="Project notes" label={<span className="wd-visually-hidden">Notes</span>} placeholder="Add context…" /></PropertyRow></div></Specimen>
            </div>
            <Callout title="International by default" tone="info">Use the direction control in the top bar. Directional icons mirror while emails, IDs, phone numbers, and monetary values remain isolated.</Callout>
          </section>

          <section className={styles.section} id="workflow">
            <SectionHeader description="The next decision stays visible without dumping the complete project history on the screen." eyebrow="Workflow" title="Interior projects, end to end" />
            <Specimen description="Contract, design, BOQ, payment, production, installation and handover." title="Project lifecycle"><InteriorProjectFlow current="technical" /><div className={styles.approvals}><ApprovalRow description="Client approved version 4" label="Interior design" state="approved" /><ApprovalRow description="Deposit verified by finance" label="Production payment" state="approved" /><ApprovalRow description="Joinery and electrical set pending" label="Production drawings" onApprove={() => { setApprovalState("approved"); notify("Drawings approved", "Production drawings can move to release checks.", "success"); }} onReject={() => { setApprovalState("rejected"); notify("Revision requested", "Production drawings were returned with feedback.", "warning"); }} state={approvalState} /></div></Specimen>
            <Specimen description="Material-specific quantity, quotation, delivery, inspection and bill evidence." title="Procurement chain"><ProcurementChain current={procurementStage} material="Kitchen cabinet hardware" onAdvance={(stage) => { setProcurementStage(stage); notify("Procurement advanced", `Kitchen cabinet hardware moved to ${stage}.`, "success"); }} quantity={42} unit="sets" /></Specimen>
          </section>

          <section className={styles.section} id="collaboration">
            <SectionHeader description="Files, approvals, versions and point comments share one interaction language." eyebrow="Collaboration" title="Context stays attached" />
            <Specimen description="Rows for documents; visual cards only for visual assets." title="File browser"><FileBrowser items={[{ id: "f1", name: "Production drawings", kind: "folder", updatedAt: "Today" }, { id: "f2", name: "Kitchen joinery — Rev 04.pdf", kind: "pdf", updatedAt: "Today", size: "4.2 MB", version: 4, status: "review" }, { id: "f3", name: "Client-approved BOQ.pdf", kind: "pdf", updatedAt: "1 Sep", size: "860 KB", status: "approved" }]} onOpen={(item) => notify("Document selected", item.name, "info")} /></Specimen>
            <Callout title="Point comments are live on this page" tone="success">Use the comment control in the lower corner, click a point, mention a teammate, add replies, react, resolve and reopen. When comment mode is off, it does not intercept the interface.</Callout>
          </section>

          <section className={styles.section} id="domain">
            <SectionHeader description="Business patterns compose the same primitives instead of inventing new UI in every module." eyebrow="Domain patterns" title="Built for Wodana’s real work" />
            <Tabs defaultSelectedKey="finance" items={[
              { id: "finance", label: "BOQ & finance", panel: <BoqEditor currency="AED" lines={boq} locale="en-AE" onChange={setBoq} /> },
              { id: "integrations", label: "Integrations", panel: <div><IntegrationConnectionRow account="operations@palmlivingae.com" icon={<CalendarDays size={17} />} lastSync="2 min ago" name="Google Workspace" onManage={() => notify("Google Workspace", "Connection settings opened.", "info")} state="connected" /><IntegrationConnectionRow account="Palm Living UAE" icon={<Building2 size={17} />} lastSync="8 min ago" name="QuickBooks Online" onManage={() => notify("QuickBooks Online", "Connection settings opened.", "info")} state="connected" /><IntegrationConnectionRow icon={<Users size={17} />} name="WhatsApp Business" onManage={() => notify("WhatsApp needs attention", "Reconnect the business account to resume sync.", "warning")} state="attention" /></div> },
              { id: "ai", label: "AI review", panel: <AIResult citations={[{ id: "c1", label: "Approved BOQ v3" }, { id: "c2", label: "Kitchen drawing Rev 04" }]} confidence={0.91} onAccept={() => notify("AI review accepted", "The suggested checks were added to the release queue.", "success")} onReject={() => notify("AI review dismissed", "No project data was changed.")} rationale={<Text>This check compares approved dimensions, BOQ quantities, drawing revisions, and production release rules.</Text>} title="Two release risks found"><Stack gap={2}><Text><strong>Wall cabinet quantity differs:</strong> drawing shows 9 units, approved BOQ shows 8.</Text><Text><strong>Handle finish is missing:</strong> vendor order cannot be released until selection is approved.</Text></Stack></AIResult> },
              { id: "payments", label: "Payments", panel: <div className={styles.paymentRows}><span><CircleDollarSign size={16} /><strong>Booking payment</strong><small>AED 18,640 · Verified</small><Badge tone="success">Paid</Badge></span><span><CircleDollarSign size={16} /><strong>Production release</strong><small>AED 74,560 · Due 24 Sep</small><Badge tone="warning">Due</Badge></span></div> },
            ]} />
          </section>

          <footer className={styles.footer}><span>Wodana design system</span><span>React Aria · TanStack Table · Inter · RTL ready</span></footer>
        </article>
        <CommentLayer comments={comments} currentUser={people[0]} onChange={setComments} people={people.slice(1)} scopeId="design-system" />
      </main>
    </DesignSystemProvider>
  );
}

export function DesignSystemShowcase() {
  return <ToastProvider><DesignSystemShowcaseContent /></ToastProvider>;
}
