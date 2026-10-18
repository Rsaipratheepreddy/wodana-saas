"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type Key } from "react";
import { ArrowLeft, Plus, Redo2, Undo2 } from "lucide-react";
import {
  Avatar, Badge, Button, Checkbox, ConfirmationDialog, FormDialog, GroupedTable, IconButton, IconMenuButton, InlineNotice, ListTabs, NoAccessState, NumericInput, PageShell,
  ProblemSummary, SelectField, TextInput, useToast, type StatusTone,
} from "@/design-system";
import { CrmRequestError, crmRequest } from "@/lib/crm/client";
import {
  BRANCH_QUESTIONS, CHECK_CATALOGUE, DEADLINE_UNITS, DEADLINE_UNIT_LABELS, DESIGN_STAGES, DESIGN_STAGE_LABELS, QUESTION_LABELS, WON_COLUMN,
  checkMeta, columnLabel, roleName, type AnswerOptions, type BranchQuestion, type DeadlineUnit, type DesignStage, type FlowCheck, type FlowDetail,
  type FlowValidationError, type RoleOption,
} from "@/lib/flows/flow-model";
import {
  ALL_PATHS, CELL_RULES, CELL_RULE_LABELS, addRow, canChangeQuestion, canRemoveRow, definitionToTable, isMaterialSelectionRow, moveRow, problemKeyFor,
  removeRow, rowsByStage, sameOnEveryPath, setCell, setQuestion, tableProblems, tableToDefinition, updateRow, type CellRule, type StepRow, type StepsTable,
} from "@/lib/flows/steps-table";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { CLOSING_EVENT_LABEL, DealClosingDialog } from "./deal-closing-dialog";
import { areasFor, areasText, WonAreasDialog, type WonAreasView } from "./won-areas-dialog";
import { TypeDot } from "./enquiry-type-colors";
import { FlowMigrationDialog } from "./flow-migration-dialog";
import { answerLabel, deadlineText, doneWhen } from "./flow-text";
import styles from "./steps-table.module.css";

export type StepsTableEditorProps = {
  answerOptions: AnswerOptions; canManage: boolean; columnNames: Record<string, string>; flow: FlowDetail | null; roles: RoleOption[]; workspaceId: string;
};

const TONE: Record<CellRule, StatusTone> = { required: "info", auto: "success", optional: "neutral", skipped: "neutral" };
const LIMIT = 100;
type History = { past: StepsTable[]; present: StepsTable; future: StepsTable[] };
type Closing = { rules: Array<{ furniturePath: string | null; closingEvent: string }> };
type Editing = { kind: "cell"; row: string; path: string } | { kind: "row"; row: string } | { kind: "add"; after: string | null } | null;

/**
 * Enquiry types › a type, "Steps" (plan §6.9a): CeCe's table. Stages as rows, paths as columns, each cell the step's
 * rule on that path with its owner team and lead time, and the type's closing event. It edits the same flow
 * definition as the canvas and publishes a new version the same way; running jobs keep theirs until an admin
 * moves them (E2-3). Every problem is listed at once before publishing.
 */
export function StepsTableEditor(props: StepsTableEditorProps) {
  const t = useT();
  if (!props.canManage || !props.flow) return <NoAccessState area={t("Enquiry types")} />;
  return <Editor {...props} flow={props.flow} />;
}

function Editor({ answerOptions, columnNames, flow, roles, workspaceId }: StepsTableEditorProps & { flow: FlowDetail }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const read = useMemo(() => definitionToTable(flow.selected.definition, answerOptions), [flow.selected.definition, answerOptions]);
  const columns = flow.selected.definition.columns;
  const type = flow.enquiryType ?? { code: flow.code, label: flow.name, color: null };
  const back = "/workspace/enquiry-types";
  const canvas = `/workspace/enquiry-types/${flow.enquiryType?.id ?? flow.id}?view=canvas`;
  const [baseline, setBaseline] = useState<StepsTable | null>("unsupported" in read ? null : read);
  const [history, setHistory] = useState<History | null>("unsupported" in read ? null : { past: [], present: read, future: [] });
  const [version, setVersion] = useState(flow.selected.version);
  const [serverProblems, setServerProblems] = useState<Array<{ key: string; text: string }>>([]);
  const [showProblems, setShowProblems] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [closingOpen, setClosingOpen] = useState(false);
  const [closing, setClosing] = useState<Closing | null>(null);
  const [areasOpen, setAreasOpen] = useState(false);
  const [wonAreas, setWonAreas] = useState<WonAreasView | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [olderJobs, setOlderJobs] = useState(0);
  const table = history?.present ?? null;
  const dirty = Boolean(table && baseline && JSON.stringify(table) !== JSON.stringify(baseline));

  const loadClosing = useCallback(() => {
    const controller = new AbortController();
    crmRequest<Closing>(workspaceId, `flows/${flow.id}/closing`, "GET", undefined, controller.signal).then(setClosing).catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId, flow.id]);
  useEffect(() => loadClosing(), [loadClosing]);
  // PLM-098: the areas each path shows after Won.
  const loadAreas = useCallback(() => {
    const controller = new AbortController();
    crmRequest<WonAreasView>(workspaceId, `flows/${flow.id}/won-areas`, "GET", undefined, controller.signal).then(setWonAreas).catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId, flow.id]);
  useEffect(() => loadAreas(), [loadAreas]);
  const loadOlder = useCallback(() => {
    const controller = new AbortController();
    crmRequest<{ jobs: unknown[] }>(workspaceId, `flows/${flow.id}/migration`, "GET", undefined, controller.signal).then((preview) => setOlderJobs(preview.jobs.length)).catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId, flow.id]);
  useEffect(() => loadOlder(), [loadOlder, version]);

  // Unpublished changes are lost on leaving: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const commit = (next: StepsTable) => {
    setHistory((current) => current && next !== current.present ? { past: [...current.past, current.present].slice(-LIMIT), present: next, future: [] } : current);
    setServerProblems([]);
  };
  const undo = () => setHistory((current) => current?.past.length ? { past: current.past.slice(0, -1), present: current.past.at(-1)!, future: [current.present, ...current.future] } : current);
  const redo = () => setHistory((current) => current?.future.length ? { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) } : current);
  const go = (to: string) => { if (dirty) setLeaving(to); else router.push(to); };

  const pathLabel = (path: string) => {
    if (!table?.question || path === ALL_PATHS) return { letter: undefined, label: t("Every job") };
    return answerLabel(table.question, path, answerOptions, t);
  };
  const pathName = (path: string) => { const label = pathLabel(path); return `${label.letter ? `${label.letter} · ` : ""}${label.label}`; };
  const local = table ? tableProblems(table, columns, answerOptions) : [];
  const problems = [
    ...local.map((problem) => ({ key: problem.key, text: describe(problem.key, translateKnown(t, t(problem.message, problem.values))) })),
    ...serverProblems.filter((problem) => !local.some((item) => item.key === problem.key)),
  ];
  function describe(key: string, text: string) {
    if (!table) return text;
    const [, rowKey, path] = key.split(":");
    const row = table.rows.find((item) => item.key === rowKey);
    if (!row) return text;
    if (key.startsWith("cell:")) return `${row.name} · ${pathName(path)}: ${text}`;
    return `${row.name}: ${text}`;
  }
  const problemKeys = new Set(problems.map((problem) => problem.key));

  async function publish() {
    if (!table) return;
    setShowProblems(true);
    if (local.length) return;
    setPublishing(true);
    try {
      const { definition } = tableToDefinition(table, columns, answerOptions);
      const check = await crmRequest<{ valid: boolean; errors: FlowValidationError[] }>(workspaceId, "flows/validate", "POST", { definition });
      if (!check.valid) {
        setServerProblems(check.errors.map((error) => ({ key: problemKeyFor(error, definition, table, answerOptions), text: describe(problemKeyFor(error, definition, table, answerOptions), translateKnown(t, error.message)) })));
        return;
      }
      const published = await crmRequest<{ version: number }>(workspaceId, `flows/${flow.id}/versions`, "POST", { expectedVersion: version, definition });
      const fresh = definitionToTable(definition, answerOptions);
      const settled = "unsupported" in fresh ? table : fresh;
      setBaseline(settled);
      setHistory({ past: [], present: settled, future: [] });
      setVersion(published.version);
      setShowProblems(false);
      toast.push({ tone: "success", title: t("Version {version} published", { version: published.version }), message: type.label });
      router.refresh();
    } catch (error) {
      const message = error instanceof CrmRequestError || error instanceof Error ? error.message : t("Please try again.");
      toast.push({ tone: "danger", title: t("Not published"), message: translateKnown(t, message) });
    } finally {
      setPublishing(false);
    }
  }

  const select = (key: string) => {
    const target = document.querySelector<HTMLElement>(`[data-problem-key="${CSS.escape(key)}"]`);
    target?.scrollIntoView?.({ block: "center", inline: "center", behavior: "smooth" });
    target?.focus({ preventScroll: true });
  };
  const addMaterial = table && !table.rows.some(isMaterialSelectionRow) ? () => {
    const proposal = columns.includes("proposal") ? "proposal" : columns[0];
    const quotation = table.rows.find((row) => row.check === "quote_exists");
    const before = quotation ? table.rows[table.rows.indexOf(quotation) - 1]?.key ?? null : null;
    commit(addRow(table, { check: "design_stage_done", designStage: "material_selection", name: t("Choose the materials"), column: quotation?.column ?? proposal, afterKey: before }).table);
  } : null;

  const tabs = <ListTabs label={t("View")} items={[{ id: "table", label: t("Table") }, { id: "canvas", label: t("Canvas") }]} value="table" onChange={(id) => { if (id === "canvas") go(canvas); }} />;
  if (!table) return <PageShell title={<span className={styles.title}><TypeDot code={type.code} color={type.color} />{type.label}</span>} tabs={tabs} kind="record">
    <InlineNotice title={t("These steps split on more than one question")} message={t("Edit them on the canvas.")} />
    <div><Button variant="primary" onPress={() => router.push(canvas)}>{t("Open the canvas")}</Button></div>
  </PageShell>;

  const questionItems = [{ id: "none", label: t("One path") }, ...BRANCH_QUESTIONS.filter((question) => question === "subPath" || (answerOptions[question]?.length ?? 0) > 0)
    .map((question) => ({ id: question, label: t(QUESTION_LABELS[question]) }))];
  const toolbar = <div className={styles.toolbar}>
    <Link className={`wd-button ${styles.back}`} data-size="compact" data-variant="quiet" href={back} onClick={(event) => { if (dirty) { event.preventDefault(); setLeaving(back); } }}>
      <ArrowLeft aria-hidden="true" size={14} />{t("Enquiry types")}
    </Link>
    <div className={styles.paths}>
      <SelectField accent="neutral" aria-label={canChangeQuestion(table) ? t("Paths") : `${t("Paths")}: ${t("Make every path the same to change this")}`} label={null}
        isDisabled={!canChangeQuestion(table)} selectedKey={table.question ?? "none"} items={questionItems}
        onSelectionChange={(key: Key | null) => commit(setQuestion(table, key === "none" || key === null ? null : key as BranchQuestion, answerOptions))} />
    </div>
    <span className={styles.spacer} />
    <span className={styles.version}>{t("Version {version}", { version })}</span>
    {olderJobs ? <Button size="compact" variant="quiet" onPress={() => setMigrating(true)}>{t("{count} jobs on older versions", { count: olderJobs })}</Button> : null}
    <IconButton aria-label={t("Undo")} isDisabled={!history?.past.length} onPress={undo}><Undo2 size={16} /></IconButton>
    <IconButton aria-label={t("Redo")} isDisabled={!history?.future.length} onPress={redo}><Redo2 size={16} /></IconButton>
    <Button size="compact" onPress={() => setEditing({ kind: "add", after: null })}><Plus aria-hidden="true" size={14} />{t("Add step")}</Button>
  </div>;

  const closingFor = (path: string) => {
    if (!closing) return null;
    const own = table.question === "subPath" ? closing.rules.find((rule) => rule.furniturePath === path) : null;
    const event = (own ?? closing.rules.find((rule) => rule.furniturePath === null))?.closingEvent;
    return event ? t(CLOSING_EVENT_LABEL[event] ?? event) : t("Not set");
  };
  const areasOn = (path: string) => wonAreas ? areasText(areasFor(wonAreas.rules, table.question === "subPath" && path !== ALL_PATHS ? path : null), t) : null;

  return <PageShell aria-label={t("Steps")} kind="record" title={<span className={styles.title}><TypeDot code={type.code} color={type.color} />{type.label}</span>}
    tabs={tabs} toolbar={toolbar}
    action={<Button isDisabled={!dirty} isLoading={publishing} onPress={() => void publish()} variant="primary">{t("Publish changes")}</Button>}>
    {showProblems && problems.length ? <ProblemSummary title={t("Fix these to publish")} onSelect={select}
      problems={problems.map((problem) => ({ key: problem.key, label: problem.text }))}
      actions={addMaterial && problemKeys.has("material") ? <Button size="compact" onPress={addMaterial}>{t("Add material selection")}</Button> : undefined} /> : null}
    <div className={styles.matrix}>
      <GroupedTable<Line> ariaLabel={t("Steps")} collapsible={false} selectable={false} getRowId={(line) => line.kind === "step" ? line.row.key : line.kind}
        columns={[
          { id: "step", label: t("Step"), width: "16rem", mobileWidth: "10rem", render: (line) => line.kind === "closing"
            ? <button className={styles.rowButton} onClick={() => setClosingOpen(true)} type="button"><strong>{t("Deal closed when")}</strong></button>
            : line.kind === "areas" ? <button className={styles.rowButton} onClick={() => setAreasOpen(true)} type="button"><strong>{t("Areas after Won")}</strong></button>
            : <StepName flagged={showProblems ? problemKeys : NONE} onMenu={(action) => {
                if (action === "edit") setEditing({ kind: "row", row: line.row.key });
                else if (action === "up" || action === "down") commit(moveRow(table, line.row.key, action === "up" ? -1 : 1));
                else if (action === "remove") commit(removeRow(table, line.row.key));
                else if (action === "below") setEditing({ kind: "add", after: line.row.key });
              }} onRow={() => setEditing({ kind: "row", row: line.row.key })} row={line.row} table={table} /> },
          ...table.paths.map((path) => ({ id: `path:${path}`, label: pathName(path), render: (line: Line) => line.kind === "closing"
            ? <button className={styles.cellButton} onClick={() => setClosingOpen(true)} type="button">{closingFor(path) ?? "…"}</button>
            : line.kind === "areas" ? <button className={styles.cellButton} onClick={() => setAreasOpen(true)} type="button">{areasOn(path) ?? "…"}</button>
            : <Cell flagged={showProblems ? problemKeys : NONE} onCell={() => setEditing({ kind: "cell", row: line.row.key, path })} path={path} pathName={pathName} roles={roles} row={line.row} /> })),
        ]}
        sections={[
          ...rowsByStage(table).map((group, index) => ({ id: `${group.column}-${index}`, label: columnLabel(group.column, columnNames), emptyMessage: "", rows: group.rows.map((row): Line => ({ kind: "step", row })) })),
          { id: "closing", label: t("Deal closed"), emptyMessage: "", rows: [{ kind: "closing" } as Line, { kind: "areas" } as Line] },
        ]} />
    </div>
    {editing?.kind === "cell" ? <CellDialog answerOptions={answerOptions} onClose={() => setEditing(null)} path={editing.path} roles={roles} row={table.rows.find((row) => row.key === editing.row)!} table={table}
      onSave={(patch, everyPath) => { let next = setCell(table, editing.row, editing.path, patch); if (everyPath) next = sameOnEveryPath(next, editing.row, editing.path); commit(next); setEditing(null); }} /> : null}
    {editing?.kind === "row" ? <RowDialog columns={columns} columnNames={columnNames} onClose={() => setEditing(null)} row={table.rows.find((row) => row.key === editing.row)!}
      onSave={(patch) => { commit(updateRow(table, editing.row, patch)); setEditing(null); }} /> : null}
    {editing?.kind === "add" ? <AddDialog columns={columns} columnNames={columnNames} onClose={() => setEditing(null)}
      after={editing.after ? table.rows.find((row) => row.key === editing.after) ?? null : null}
      onSave={(input) => { commit(addRow(table, { ...input, afterKey: editing.after }).table); setEditing(null); }} /> : null}
    {areasOpen ? <WonAreasDialog workspaceId={workspaceId} flowId={flow.id} typeName={type.label} onClose={() => { setAreasOpen(false); loadAreas(); }} /> : null}
    {closingOpen ? <DealClosingDialog workspaceId={workspaceId} flowId={flow.id} typeName={type.label} onClose={() => { setClosingOpen(false); loadClosing(); }} /> : null}
    {migrating ? <FlowMigrationDialog workspaceId={workspaceId} flowId={flow.id} typeName={type.label} onClose={() => setMigrating(false)} onMoved={() => { setMigrating(false); loadOlder(); }} /> : null}
    {leaving ? <ConfirmationDialog body={t("Your changes are not published. Leave and lose them?")} confirmLabel={t("Leave")} cancelLabel={t("Keep editing")} isOpen
      onConfirm={() => { const to = leaving; setLeaving(null); setBaseline(table); router.push(to); }} onOpenChange={(open) => { if (!open) setLeaving(null); }}
      title={t("Leave without publishing?")} /> : null}
  </PageShell>;
}

const NONE = new Set<string>();
type Line = { kind: "step"; row: StepRow } | { kind: "closing" } | { kind: "areas" };

function StepName({ flagged, onMenu, onRow, row, table }: { flagged: Set<string>; onMenu: (action: string) => void; onRow: () => void; row: StepRow; table: StepsTable }) {
  const t = useT();
  const first = Object.values(row.cells).find((cell) => cell.step)?.step;
  const index = table.rows.indexOf(row);
  const last = table.rows.length - 1;
  const proofLast = table.rows[last]?.check === "payment_proof_attached";
  return <span className={styles.stepCell}>
    <button className={styles.rowButton} data-invalid={flagged.has(`row:${row.key}`) || undefined} data-problem-key={`row:${row.key}`} onClick={onRow} type="button">
      <strong>{row.name}</strong>
      {first ? <small>{doneWhen({ ...first, check: row.check, designStage: row.designStage, needs: row.needs }, t)}</small> : null}
    </button>
    <IconMenuButton ariaLabel={t("More actions for {name}", { name: row.name })} onAction={(id) => onMenu(String(id))} items={[
      { id: "edit", label: t("Edit step") },
      ...(proofLast && index === last ? [] : [{ id: "below", label: t("Add a step below") }]),
      ...(index > 0 && !(proofLast && index === last) ? [{ id: "up", label: t("Move up") }] : []),
      ...(index < last - (proofLast ? 1 : 0) ? [{ id: "down", label: t("Move down") }] : []),
      ...(canRemoveRow(table, row.key) ? [{ id: "remove", label: t("Remove"), tone: "danger" as const }] : []),
    ]} />
  </span>;
}

function Cell({ flagged, onCell, path, pathName, roles, row }: { flagged: Set<string>; onCell: () => void; path: string; pathName: (path: string) => string; roles: RoleOption[]; row: StepRow }) {
  const t = useT();
  const cell = row.cells[path];
  const who = cell.step ? roleName(cell.step.role, roles) : null;
  const lead = cell.step && cell.rule !== "skipped" ? deadlineText(cell.step.deadline, t) : null;
  const key = `cell:${row.key}:${path}`;
  return <button aria-label={t("{step} on {path}: {rule}", { step: row.name, path: pathName(path), rule: t(CELL_RULE_LABELS[cell.rule]) })}
    className={styles.cellButton} data-invalid={flagged.has(key) || undefined} data-problem-key={key} data-rule={cell.rule} onClick={onCell} type="button">
    <Badge tone={TONE[cell.rule]}>{t(CELL_RULE_LABELS[cell.rule])}</Badge>
    {cell.rule !== "skipped" && who ? <span className={styles.owner}><Avatar name={who} roles={[cell.step!.role]} seed={cell.step!.role} size="sm" /><span>{who}</span></span> : null}
    {lead ? <small className={styles.lead}>{lead}</small> : null}
  </button>;
}

function CellDialog({ answerOptions, onClose, onSave, path, roles, row, table }: {
  answerOptions: AnswerOptions; onClose: () => void; path: string; roles: RoleOption[]; row: StepRow; table: StepsTable;
  onSave: (patch: { rule: CellRule; role: string; deadline: { amount: number; unit: DeadlineUnit } | null }, everyPath: boolean) => void;
}) {
  const t = useT();
  const cell = row.cells[path];
  const base = cell.step ?? Object.values(row.cells).find((item) => item.step)?.step ?? null;
  const [rule, setRule] = useState<CellRule>(cell.rule);
  const [role, setRole] = useState(base?.role ?? checkMeta(row.check).role);
  const [amount, setAmount] = useState<number>(base?.deadline?.amount ?? Number.NaN);
  const [unit, setUnit] = useState<DeadlineUnit>(base?.deadline?.unit ?? "days");
  const [everyPath, setEveryPath] = useState(false);
  const proof = row.check === "payment_proof_attached";
  const rules = proof ? (["required"] as CellRule[]) : [...CELL_RULES];
  const roleItems = [...roles.map((item) => ({ id: item.code, label: item.name })), ...(roles.some((item) => item.code === role) ? [] : [{ id: role, label: roleName(role, roles) }])];
  const label = table.question && path !== ALL_PATHS ? answerLabel(table.question, path, answerOptions, t) : { letter: undefined, label: t("Every job") };
  const deadline = Number.isInteger(amount) && amount >= 1 ? { amount, unit } : null;
  const validLead = Number.isNaN(amount) || (Number.isInteger(amount) && amount >= 1 && amount <= 1000);
  return <FormDialog title={row.name} description={`${label.letter ? `${label.letter} · ` : ""}${label.label}`} submitLabel={t("Done")} onClose={onClose} isSubmitDisabled={!validLead}
    isDirty={rule !== cell.rule || role !== (base?.role ?? "") || JSON.stringify(deadline) !== JSON.stringify(base?.deadline ?? null) || everyPath}
    onSubmit={async () => onSave({ rule, role, deadline }, everyPath)}>
    <SelectField isRequired label={t("Rule")} selectedKey={rule} onSelectionChange={(key) => setRule(String(key) as CellRule)}
      items={rules.map((id) => ({ id, label: t(CELL_RULE_LABELS[id]) }))} description={proof ? t("Won needs the payment proof on every path") : undefined} />
    {rule !== "skipped" ? <>
      <SelectField isRequired label={t("Owner team")} selectedKey={role} onSelectionChange={(key) => setRole(String(key))} items={roleItems} />
      <div className={styles.leadFields}>
        <NumericInput label={t("Lead time")} minValue={1} maxValue={1000} step={1} value={amount} onChange={setAmount} errorMessage={validLead ? undefined : t("A whole number from 1 to 1000")} />
        <SelectField label={t("Unit")} selectedKey={unit} onSelectionChange={(key) => setUnit(String(key) as DeadlineUnit)} items={DEADLINE_UNITS.map((id) => ({ id, label: t(DEADLINE_UNIT_LABELS[id]) }))} />
      </div>
    </> : null}
    {table.question ? <Checkbox isSelected={everyPath} onChange={setEveryPath}>{t("Same on every path")}</Checkbox> : null}
  </FormDialog>;
}

const designStageItems = (t: ReturnType<typeof useT>) => DESIGN_STAGES.map((id) => ({ id, label: t(DESIGN_STAGE_LABELS[id]) }));
const checkItems = (t: ReturnType<typeof useT>, proof: boolean) => CHECK_CATALOGUE.filter((item) => proof ? item.check === "payment_proof_attached" : item.check !== "payment_proof_attached")
  .map((item) => ({ id: item.check, label: t(item.label) }));

function RowDialog({ columns, columnNames, onClose, onSave, row }: {
  columns: string[]; columnNames: Record<string, string>; onClose: () => void; row: StepRow;
  onSave: (patch: { name: string; column: string; check: FlowCheck; designStage?: DesignStage }) => void;
}) {
  const t = useT();
  const proof = row.check === "payment_proof_attached";
  const [name, setName] = useState(row.name);
  const [column, setColumn] = useState(row.column);
  const [check, setCheck] = useState<FlowCheck>(row.check);
  const [designStage, setDesignStage] = useState<DesignStage>(row.designStage ?? "concepts");
  const stages = columns.filter((code) => proof ? code === WON_COLUMN : code !== WON_COLUMN).map((id) => ({ id, label: columnLabel(id, columnNames) }));
  return <FormDialog title={t("Edit step")} submitLabel={t("Done")} onClose={onClose} isSubmitDisabled={!name.trim()}
    isDirty={name !== row.name || column !== row.column || check !== row.check || (check === "design_stage_done" && designStage !== row.designStage)}
    onSubmit={async () => onSave({ name: name.trim(), column, check, ...(check === "design_stage_done" ? { designStage } : {}) })}>
    <TextInput isRequired label={t("Name")} maxLength={120} value={name} onChange={setName} />
    <SelectField isRequired label={t("Stage")} selectedKey={column} onSelectionChange={(key) => setColumn(String(key))} items={stages} />
    <SelectField isRequired isDisabled={proof} label={t("Done when")} selectedKey={check} onSelectionChange={(key) => setCheck(String(key) as FlowCheck)} items={checkItems(t, proof)} />
    {check === "design_stage_done" ? <SelectField isRequired label={t("Design stage")} selectedKey={designStage} onSelectionChange={(key) => setDesignStage(String(key) as DesignStage)} items={designStageItems(t)} /> : null}
  </FormDialog>;
}

function AddDialog({ after, columns, columnNames, onClose, onSave }: {
  after: StepRow | null; columns: string[]; columnNames: Record<string, string>; onClose: () => void;
  onSave: (input: { check: FlowCheck; name: string; column: string; designStage?: DesignStage }) => void;
}) {
  const t = useT();
  const [check, setCheck] = useState<FlowCheck>("quote_exists");
  const [name, setName] = useState(t(checkMeta("quote_exists").step));
  const [named, setNamed] = useState(false);
  const [column, setColumn] = useState(after?.column && after.column !== WON_COLUMN ? after.column : columns.at(-2) ?? columns[0]);
  const [designStage, setDesignStage] = useState<DesignStage>("material_selection");
  const stages = columns.filter((code) => code !== WON_COLUMN).map((id) => ({ id, label: columnLabel(id, columnNames) }));
  return <FormDialog title={t("Add step")} submitLabel={t("Add")} onClose={onClose} isSubmitDisabled={!name.trim()} isDirty={named}
    onSubmit={async () => onSave({ check, name: name.trim(), column, ...(check === "design_stage_done" ? { designStage } : {}) })}>
    <SelectField isRequired label={t("Done when")} selectedKey={check} items={checkItems(t, false)}
      onSelectionChange={(key) => { const next = String(key) as FlowCheck; setCheck(next); if (!named) setName(t(checkMeta(next).step)); }} />
    {check === "design_stage_done" ? <SelectField isRequired label={t("Design stage")} selectedKey={designStage} onSelectionChange={(key) => setDesignStage(String(key) as DesignStage)} items={designStageItems(t)} /> : null}
    <TextInput isRequired label={t("Name")} maxLength={120} value={name} onChange={(value) => { setName(value); setNamed(true); }} />
    <SelectField isRequired label={t("Stage")} selectedKey={column} onSelectionChange={(key) => setColumn(String(key))} items={stages} />
  </FormDialog>;
}
