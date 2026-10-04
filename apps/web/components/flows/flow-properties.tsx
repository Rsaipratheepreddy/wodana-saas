"use client";

import type { Key } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Avatar, Button, IconButton, MultiSelectField, NumericInput, SelectField, Switch, TextInput } from "@/design-system";
import {
  BRANCH_QUESTIONS, CHECK_CATALOGUE, DEADLINE_UNITS, DEADLINE_UNIT_LABELS, DESIGN_STAGES, DESIGN_STAGE_LABELS, FIELD_LABELS, FLOW_FIELDS, QUESTION_LABELS,
  answerOptions, canMove, canRemove, columnLabel, locate, roleName, type AnswerOptions, type BranchQuestion, type DeadlineUnit, type DesignStage,
  type FlowBranch, type FlowCheck, type FlowDefinition, type FlowField, type FlowProblem, type FlowStep, type RoleOption,
} from "@/lib/flows/flow-model";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { answerLabel } from "./flow-text";
import styles from "./flows.module.css";

type Props = {
  answerOptions: AnswerOptions; columnNames: Record<string, string>; definition: FlowDefinition; problems: FlowProblem[]; roles: RoleOption[]; selectedId: string;
  onBranchChange: (key: string, patch: { question?: BranchQuestion; answers?: string[] }) => void;
  onMove: (key: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onStepChange: (key: string, patch: Partial<Omit<FlowStep, "key">>, field: string) => void;
};

/** The right panel (plan §5a): the selected card's properties, in plain words, with pickers only. */
export function FlowProperties(props: Props) {
  const at = locate(props.definition, props.selectedId);
  if (!at) return null;
  return at.kind === "branch" ? <BranchProperties {...props} branch={at.branch} /> : <StepProperties {...props} step={at.step} />;
}

function errorFor(problems: FlowProblem[], id: string, ...fields: string[]) {
  return problems.find((problem) => problem.nodeId === id && problem.field !== null && fields.includes(problem.field))?.message;
}

function StepProperties({ columnNames, definition, onMove, onRemove, onStepChange, problems, roles, step }: Props & { step: FlowStep }) {
  const t = useT();
  const error = (...fields: string[]) => { const message = errorFor(problems, step.key, ...fields); return message ? translateKnown(t, message) : undefined; };
  const change = (field: string, patch: Partial<Omit<FlowStep, "key">>) => onStepChange(step.key, patch, field);
  const roleItems = [...roles.map((role) => ({ id: role.code, label: role.name })), ...(roles.some((role) => role.code === step.role) ? [] : [{ id: step.role, label: roleName(step.role, roles) }])];
  const notifyItems = [...roleItems, ...(step.notify ?? []).filter((code) => !roleItems.some((item) => item.id === code)).map((code) => ({ id: code, label: roleName(code, roles) }))];
  const keys = (values: Set<Key>) => [...values].map(String);
  return <div className={styles.properties} aria-label={t("Step properties")} role="region">
    <TextInput errorMessage={error("name")} isInvalid={Boolean(error("name"))} label={t("Name")} maxLength={120} onChange={(name) => change("name", { name })} value={step.name} />
    <SelectField errorMessage={error("role")} isInvalid={Boolean(error("role"))} items={roleItems} label={t("Who")}
      onSelectionChange={(key) => { if (key) change("role", { role: String(key) }); }}
      prefix={<Avatar name={roleName(step.role, roles)} roles={[step.role]} seed={step.role} size="sm" />} selectedKey={step.role} />
    <SelectField errorMessage={error("check")} isInvalid={Boolean(error("check"))} label={t("Done when")}
      items={CHECK_CATALOGUE.map((item) => ({ id: item.check, label: t(item.label), description: t(item.hint) }))}
      onSelectionChange={(key) => { if (key) change("check", { check: String(key) as FlowCheck }); }} selectedKey={step.check} />
    {step.check === "design_stage_done" ? <SelectField errorMessage={error("designStage")} isInvalid={Boolean(error("designStage"))} label={t("Design stage")}
      items={DESIGN_STAGES.map((stage) => ({ id: stage, label: t(DESIGN_STAGE_LABELS[stage]) }))}
      onSelectionChange={(key) => { if (key) change("designStage", { designStage: String(key) as DesignStage }); }} selectedKey={step.designStage ?? null} /> : null}
    <MultiSelectField items={FLOW_FIELDS.map((field) => ({ id: field, label: t(FIELD_LABELS[field]) }))} label={t("Needs")}
      onSelectionChange={(values) => change("needs", { needs: keys(values) as FlowField[] })} selectedKeys={new Set(step.needs ?? [])} />
    {error("needs") ? <p className={styles.fieldError} role="alert">{error("needs")}</p> : null}
    <SelectField errorMessage={error("column")} isInvalid={Boolean(error("column"))} label={t("Moves the job to")}
      items={definition.columns.map((column) => ({ id: column, label: columnLabel(column, columnNames) }))}
      onSelectionChange={(key) => { if (key) change("column", { column: String(key) }); }} selectedKey={step.column} />
    <div className={styles.deadline} role="group" aria-label={t("Deadline")}>
      <NumericInput errorMessage={error("deadline", "amount")} isInvalid={Boolean(error("deadline", "amount"))} label={t("Deadline")} maxValue={1000} minValue={1}
        onChange={(amount) => change("deadline", { deadline: Number.isFinite(amount) && amount >= 1 ? { amount: Math.round(amount), unit: step.deadline?.unit ?? "days" } : undefined })}
        step={1} value={step.deadline?.amount ?? Number.NaN} />
      <SelectField accent="neutral" aria-label={t("Deadline unit")} isDisabled={!step.deadline} items={DEADLINE_UNITS.map((unit) => ({ id: unit, label: t(DEADLINE_UNIT_LABELS[unit]) }))}
        label={<span className="wd-visually-hidden">{t("Deadline unit")}</span>}
        onSelectionChange={(key) => { if (key && step.deadline) change("deadline", { deadline: { ...step.deadline, unit: String(key) as DeadlineUnit } }); }} selectedKey={step.deadline?.unit ?? "days"} />
    </div>
    <MultiSelectField items={notifyItems} label={t("Tell")} onSelectionChange={(values) => change("notify", { notify: keys(values) })} selectedKeys={new Set(step.notify ?? [])} />
    {error("notify") ? <p className={styles.fieldError} role="alert">{error("notify")}</p> : null}
    <Switch isSelected={Boolean(step.clientVisible)} onChange={(clientVisible) => change("clientVisible", { clientVisible })}>{t("Client sees it")}</Switch>
    <Switch isSelected={Boolean(step.optional)} onChange={(optional) => change("optional", { optional })}>{t("Optional")}</Switch>
    <div className={styles.propertyActions}>
      <IconButton aria-label={t("Move up")} isDisabled={!canMove(definition, step.key, -1)} onPress={() => onMove(step.key, -1)}><ArrowUp size={16} /></IconButton>
      <IconButton aria-label={t("Move down")} isDisabled={!canMove(definition, step.key, 1)} onPress={() => onMove(step.key, 1)}><ArrowDown size={16} /></IconButton>
      <span className={styles.spacer} />
      <Button isDisabled={!canRemove(definition, step.key)} onPress={() => onRemove(step.key)} size="compact" variant="danger"><Trash2 aria-hidden="true" size={15} />{t("Remove step")}</Button>
    </div>
  </div>;
}

function BranchProperties({ answerOptions: options, branch, onBranchChange, onRemove, problems }: Props & { branch: FlowBranch }) {
  const t = useT();
  const error = (...fields: string[]) => { const message = errorFor(problems, branch.key, ...fields); return message ? translateKnown(t, message) : undefined; };
  const choices = answerOptions(branch.question, options);
  const items = [...choices.map((option) => option.value), ...branch.answers.map((answer) => answer.value).filter((value) => !choices.some((option) => option.value === value))]
    .map((value) => { const answer = answerLabel(branch.question, value, options, t); return { id: value, label: answer.letter ? `${answer.letter} · ${answer.label}` : answer.label }; });
  return <div className={styles.properties} aria-label={t("Branch properties")} role="region">
    <SelectField errorMessage={error("question")} isInvalid={Boolean(error("question"))} items={BRANCH_QUESTIONS.map((question) => ({ id: question, label: t(QUESTION_LABELS[question]) }))}
      label={t("Question")} onSelectionChange={(key) => { if (key) onBranchChange(branch.key, { question: String(key) as BranchQuestion }); }} selectedKey={branch.question} />
    <MultiSelectField items={items} label={t("Answers")} onSelectionChange={(values) => onBranchChange(branch.key, { answers: [...values].map(String) })}
      selectedKeys={new Set(branch.answers.map((answer) => answer.value))} />
    {error("answers", "after", "rejoin") ? <p className={styles.fieldError} role="alert">{error("answers", "after", "rejoin")}</p> : null}
    <div className={styles.propertyActions}>
      <span className={styles.spacer} />
      <Button onPress={() => onRemove(branch.key)} size="compact" variant="danger"><Trash2 aria-hidden="true" size={15} />{t("Remove branch")}</Button>
    </div>
  </div>;
}
