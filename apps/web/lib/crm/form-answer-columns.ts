import type { CrmLeadListItem } from "./leads";

export type FormAnswerColumn = { id: string; title: string; formId: string; questionId: string };

export function formAnswerColumns(leads: CrmLeadListItem[]): FormAnswerColumn[] {
  const columns = new Map<string, FormAnswerColumn>();
  for (const lead of leads) {
    if (!lead.formId || !Array.isArray(lead.formAnswers)) continue;
    for (const answer of lead.formAnswers) {
      if (answer.field !== "custom" || !answer.questionId || !answer.title?.trim()) continue;
      const id = `form:${lead.formId}:${answer.questionId}`;
      if (!columns.has(id)) columns.set(id, { id, title: answer.title.trim(), formId: lead.formId, questionId: answer.questionId });
    }
  }
  return [...columns.values()];
}

export function formAnswerValue(lead: CrmLeadListItem, column: FormAnswerColumn): string {
  if (lead.formId !== column.formId) return "—";
  const value = lead.formAnswers?.find(answer => answer.questionId === column.questionId && answer.field === "custom")?.value;
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return typeof value === "string" && value.trim() ? value.trim() : "—";
}
