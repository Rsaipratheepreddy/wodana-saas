import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";
import { canonicalHash } from "../shared/crm-types";
import { hasResolvedEnquiryType } from "./lead-options";

type QualificationQuestion = {
  id?: string;
  key: string;
  label: string;
  dataType: string;
  required?: boolean;
  position: number;
  scoring?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
};

export type QualificationEvidence = {
  version: 1;
  leadId: string;
  serviceType: string | null;
  selection: "service_specific" | "global" | "none";
  form: null | {
    id: string;
    code: string;
    name: string;
    serviceType: string | null;
    version: number;
    questions: Array<{
      id: string;
      key: string;
      label: string;
      dataType: string;
      required: boolean;
      position: number;
      scoring: Record<string, unknown>;
      configuration: Record<string, unknown>;
    }>;
  };
  answers: Array<{ questionKey: string; value: unknown; capturedAt: string | null }>;
  requiredKeys: string[];
  evaluatedAt: string;
};

export type QualificationEvaluation = {
  ready: boolean;
  missingRequired: string[];
  evidence: QualificationEvidence;
  evidenceHash: string;
};

function optionValues(configuration: Record<string, unknown>): string[] | null {
  const options = configuration.options;
  return Array.isArray(options) && options.every(option => typeof option === "string") ? options : null;
}

function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function assertBoundedJson(key: string, value: unknown) {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new UnprocessableEntityException(`Qualification answer ${key} must be valid JSON`);
  }
  if (encoded === undefined || encoded.length > 20_000) {
    throw new UnprocessableEntityException(`Qualification answer ${key} is too large`);
  }
}

function assertAnswer(question: QualificationQuestion, value: unknown) {
  if (!isAnswered(value)) return;
  const invalid = (): never => {
    throw new UnprocessableEntityException(`Qualification answer ${question.key} must match ${question.dataType}`);
  };
  if (question.dataType === "text") {
    if (typeof value !== "string") invalid();
  } else if (question.dataType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) invalid();
  } else if (question.dataType === "boolean") {
    if (typeof value !== "boolean") invalid();
  } else if (question.dataType === "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
    const parsed = new Date(`${String(value)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid();
  } else if (question.dataType === "select") {
    if (typeof value !== "string") invalid();
    const options = optionValues(question.configuration ?? {});
    if (options && !options.includes(value as string)) invalid();
  } else if (question.dataType === "multi_select") {
    if (!Array.isArray(value) || !value.every(item => typeof item === "string")) invalid();
    const selections = value as string[];
    if (new Set(selections).size !== selections.length) invalid();
    const options = optionValues(question.configuration ?? {});
    if (options && selections.some(item => !options.includes(item))) invalid();
  } else {
    invalid();
  }
}

export function validateQualificationQuestionDefinitions(questions: QualificationQuestion[]) {
  if (questions.length > 200) throw new UnprocessableEntityException("A qualification form may contain at most 200 questions");
  for (const question of questions) {
    const configuration = question.configuration ?? {};
    const scoring = question.scoring ?? {};
    if (["select", "multi_select"].includes(question.dataType)) {
      const options = optionValues(configuration);
      if (!options?.length || options.length > 200 || new Set(options).size !== options.length
        || options.some(option => !option.trim() || option.length > 160)) {
        throw new UnprocessableEntityException(`Qualification question ${question.key} requires unique string options`);
      }
    }
    if (Object.values(scoring).some(value => typeof value !== "number" || !Number.isFinite(value))) {
      throw new UnprocessableEntityException(`Qualification scoring for ${question.key} must contain numeric values`);
    }
  }
}

export async function evaluateQualification(
  client: PoolClient,
  workspaceId: string,
  leadId: string,
  pendingValues: Record<string, unknown> = {},
  requireComplete = false,
): Promise<QualificationEvaluation> {
  const lead = await client.query<{ service_type: string | null }>(
    `SELECT enquiry.service_type
     FROM crm_leads lead
     JOIN crm_enquiries enquiry ON enquiry.workspace_id=lead.workspace_id AND enquiry.id=lead.enquiry_id
     WHERE lead.workspace_id=$1 AND lead.id=$2`,
    [workspaceId, leadId],
  );
  if (!lead.rowCount) throw new NotFoundException("Lead not found");
  const serviceType = lead.rows[0].service_type;
  const formResult = await client.query<Record<string, unknown>>(
    `SELECT id,code,name,service_type,version
     FROM crm_qualification_forms
     WHERE workspace_id=$1 AND status='active'
       AND (service_type IS NULL OR service_type IS NOT DISTINCT FROM $2::text)
     ORDER BY CASE WHEN $2::text IS NOT NULL AND service_type=$2::text THEN 0 ELSE 1 END,
              updated_at DESC,id DESC
     LIMIT 1 FOR SHARE`,
    [workspaceId, serviceType],
  );
  const form = formResult.rows[0];
  const questionResult = form
    ? await client.query<Record<string, unknown>>(
      `SELECT id,key,label,data_type,required,position,scoring,configuration
       FROM crm_qualification_questions
       WHERE workspace_id=$1 AND form_id=$2 ORDER BY position,id`,
      [workspaceId, form.id],
    )
    : { rows: [] as Record<string, unknown>[] };
  const answerResult = await client.query<{ questionKey: string; value: unknown; capturedAt: Date | string }>(
    `SELECT question_key AS "questionKey",value,captured_at AS "capturedAt"
     FROM crm_lead_qualification_values WHERE workspace_id=$1 AND lead_id=$2 ORDER BY question_key`,
    [workspaceId, leadId],
  );
  const answers = new Map<string, { value: unknown; capturedAt: string | null }>();
  for (const answer of answerResult.rows) {
    answers.set(answer.questionKey, { value: answer.value, capturedAt: new Date(answer.capturedAt).toISOString() });
  }
  for (const [key, value] of Object.entries(pendingValues)) {
    assertBoundedJson(key, value);
    answers.set(key, { value, capturedAt: null });
  }
  const questions: QualificationQuestion[] = questionResult.rows.map(row => ({
    id: String(row.id), key: String(row.key), label: String(row.label), dataType: String(row.data_type),
    required: Boolean(row.required), position: Number(row.position),
    scoring: (row.scoring ?? {}) as Record<string, unknown>,
    configuration: (row.configuration ?? {}) as Record<string, unknown>,
  }));
  validateQualificationQuestionDefinitions(questions);
  for (const question of questions) assertAnswer(question, answers.get(question.key)?.value);
  const missingRequired = [
    ...(!hasResolvedEnquiryType(serviceType) ? ["serviceType"] : []),
    ...questions
    .filter(question => question.required && !isAnswered(answers.get(question.key)?.value))
    .map(question => question.key),
  ];
  if (requireComplete && missingRequired.length) {
    throw new UnprocessableEntityException({
      message: missingRequired.includes("serviceType")
        ? "Choose a specific enquiry type before qualifying this enquiry"
        : "Qualification requirements are not met",
      missing: missingRequired,
    });
  }
  const evaluatedAt = new Date().toISOString();
  const evidence: QualificationEvidence = {
    version: 1,
    leadId,
    serviceType,
    selection: form ? form.service_type == null ? "global" : "service_specific" : "none",
    form: form ? {
      id: String(form.id), code: String(form.code), name: String(form.name),
      serviceType: form.service_type == null ? null : String(form.service_type), version: Number(form.version),
      questions: questions.map(question => ({
        id: String(question.id), key: question.key, label: question.label, dataType: question.dataType,
        required: Boolean(question.required), position: question.position,
        scoring: question.scoring ?? {}, configuration: question.configuration ?? {},
      })),
    } : null,
    answers: [...answers.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([questionKey, answer]) => ({ questionKey, value: answer.value, capturedAt: answer.capturedAt })),
    requiredKeys: questions.filter(question => question.required).map(question => question.key),
    evaluatedAt,
  };
  return { ready: missingRequired.length === 0, missingRequired, evidence, evidenceHash: canonicalHash(evidence) };
}
