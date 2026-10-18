import type { PoolClient } from "pg";
import type { DiscoveryQuestion } from "./discovery.domain";

type Db = Pick<PoolClient, "query">;

/**
 * Guide F: what the intro meeting asks, until the firm writes its own consultation questions (Enquiry types ›
 * Consultation). All optional: a firm makes one required, and so a gate item, when it edits the questionnaire.
 */
export const KIT_CONSULTATION_QUESTIONS: readonly DiscoveryQuestion[] = [
  { key: "home", label: "About the home", required: false, dataType: "text" },
  { key: "style", label: "Style they like", required: false, dataType: "text" },
  { key: "living", label: "How they live in the space", required: false, dataType: "text" },
  { key: "non_negotiables", label: "Non-negotiables", required: false, dataType: "text" },
  { key: "budget", label: "Budget", required: false, dataType: "text" },
  { key: "scope", label: "Scope of work", required: false, dataType: "text" },
  { key: "deadlines", label: "Deadlines", required: false, dataType: "text" },
  { key: "tenure", label: "Own or rent", required: false, dataType: "select", options: [{ id: "own", label: "Own" }, { id: "rent", label: "Rent" }] },
];

/**
 * The consultation questions for an enquiry type: the firm's own (its type's form first, then the form for every
 * type), else the kit's set when the firm has no consultation form at all.
 */
export async function consultationQuestions(db: Db, workspaceId: string, enquiryType: string | null): Promise<DiscoveryQuestion[]> {
  const rows = (await db.query<DiscoveryQuestion & { configuration: { options?: unknown } | null }>(
    `SELECT question.key, question.label, question.required, question.data_type AS "dataType", question.configuration FROM crm_qualification_forms form
     JOIN crm_qualification_questions question ON question.workspace_id = form.workspace_id AND question.form_id = form.id
     WHERE form.workspace_id = $1 AND form.purpose = 'discovery' AND form.status = 'active'
       AND (form.service_type IS NULL OR form.service_type = $2)
     ORDER BY (form.service_type IS NULL), question.position`, [workspaceId, enquiryType])).rows
    .filter((question, index, all) => all.findIndex((other) => other.key === question.key) === index)
    .map(({ configuration, ...question }) => ({ ...question, options: Array.isArray(configuration?.options)
      ? (configuration.options as unknown[]).map((option) => typeof option === "string" ? { id: option, label: option } : option as { id: string; label: string }).filter((option) => option?.id)
      : undefined }));
  if (rows.length) return rows;
  const anyForm = await db.query(`SELECT 1 FROM crm_qualification_forms WHERE workspace_id = $1 AND purpose = 'discovery' AND status = 'active' LIMIT 1`, [workspaceId]);
  return anyForm.rowCount ? [] : KIT_CONSULTATION_QUESTIONS.map((question) => ({ ...question, options: question.options?.map((option) => ({ ...option })) }));
}
