import { allSteps, type FlowDefinition } from "./flow-definition";
import { flowProgress, requirementsUpTo, type CheckFacts } from "./flow-interpreter";

/**
 * E2-3 (plan §5a engine rule 3): a running job keeps the version of its steps it started on; moving it to a newer
 * version is an explicit command, previewed per job first. Pure: what a job's line looks like on each version.
 * Facts carry over (they are records, not steps); steps the new version no longer has are reported as dropped
 * and kept in the audit with the reason (E2-1); what the job's column now also needs is flagged, never undone (E2-2).
 */
export type MigrationEffect = {
  /** The step the job is on now, and the one it would be on. */
  nowBefore: { key: string; name: string } | null;
  nowAfter: { key: string; name: string } | null;
  /** What the job's current column needs on the new version that it didn't need before. */
  newlyMissing: Array<{ key: string; label: string; stepKey: string }>;
  /** Steps done on the old version that the new version doesn't have. */
  dropped: Array<{ key: string; name: string }>;
  /** Steps only the new version has. */
  added: Array<{ key: string; name: string }>;
  changed: boolean;
};

export function migrationEffect(input: { from: FlowDefinition; to: FlowDefinition; facts: CheckFacts; column: string | null }): MigrationEffect {
  const { from, to, facts } = input;
  const before = flowProgress(from, facts);
  const after = flowProgress(to, facts);
  const toKeys = new Set(allSteps(to).map((step) => step.key));
  const fromKeys = new Set(allSteps(from).map((step) => step.key));
  const dropped = before.line.filter((step) => step.state === "done" && !toKeys.has(step.key)).map(({ key, name }) => ({ key, name }));
  const added = allSteps(to).filter((step) => !fromKeys.has(step.key)).map(({ key, name }) => ({ key, name }));
  const column = (definition: FlowDefinition) => input.column === null ? -1 : definition.columns.indexOf(input.column);
  const had = new Set(column(from) >= 0 ? requirementsUpTo(from, facts, column(from)).map((item) => `${item.stepKey}:${item.key}`) : []);
  const newlyMissing = column(to) >= 0 ? requirementsUpTo(to, facts, column(to)).filter((item) => !had.has(`${item.stepKey}:${item.key}`))
    .map(({ key, label, stepKey }) => ({ key, label, stepKey })) : [];
  const now = (step: { key: string; name: string } | null) => step ? { key: step.key, name: step.name } : null;
  return {
    nowBefore: now(before.current), nowAfter: now(after.current), newlyMissing, dropped, added,
    changed: JSON.stringify(from) !== JSON.stringify(to),
  };
}
