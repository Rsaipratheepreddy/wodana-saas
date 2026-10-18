import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * Where a file behind a decision is kept, so the web can open it through that module's own (permission-checked) file
 * route: a project file, a file the client added, a site photo, a petty-cash receipt, a supplier bill, a proof on an
 * opportunity, a finance request's file, a change's file, or a file added to a decision (decision evidence).
 */
export type ApprovalFileStore = "case_asset" | "client_file" | "site_photo" | "petty_cash_receipt" | "bill" | "opportunity_proof" | "request_file" | "change_file" | "evidence";

/** One file behind a decision: its store, its id, the record it belongs to (case, project, claim…), its name, and whether it has a picture. */
export type ApprovalFile = { store: ApprovalFileStore; id: string; owner: string; name: string; preview: boolean };

type FileRow = ApprovalFile & { key: string };

const group = (rows: FileRow[]) => {
  const map = new Map<string, ApprovalFile[]>();
  for (const { key, ...file } of rows) map.set(key, [...(map.get(key) ?? []), file]);
  return map;
};

/** Reported client payments (by payment id): the files the client sent with each report, and any proof the team attached. */
export async function receiptFiles(db: Db, workspaceId: string, paymentIds: string[]) {
  if (!paymentIds.length) return new Map<string, ApprovalFile[]>();
  return group((await db.query<FileRow>(
    `SELECT notice.payment_id AS key, 'client_file' AS store, asset.id::text AS id, notice.case_id::text AS owner, asset.original_name AS name, asset.preview_key IS NOT NULL AS preview
       FROM client_portal_payment_notices notice
       JOIN client_portal_attachments attachment ON attachment.workspace_id = notice.workspace_id AND attachment.case_id = notice.case_id
            AND attachment.target_kind = 'payment' AND attachment.target_id = notice.id::text
       JOIN pre_project_brief_assets asset ON asset.workspace_id = attachment.workspace_id AND asset.id = attachment.asset_id
      WHERE notice.workspace_id = $1 AND notice.payment_id = ANY($2::text[]) AND notice.status <> 'not_received'
     UNION ALL
     SELECT receipt.payment_id AS key, 'evidence' AS store, file.id::text AS id, receipt.case_id::text AS owner, file.file_name AS name, file.has_preview AS preview
       FROM commercial_receipts receipt
       JOIN decision_evidence_files file ON file.workspace_id = receipt.workspace_id AND file.kind = 'receipt' AND file.subject_id = receipt.id
      WHERE receipt.workspace_id = $1 AND receipt.payment_id = ANY($2::text[]) AND receipt.status IN ('reported', 'provider_confirmed')`,
    [workspaceId, paymentIds])).rows);
}

/** Files added to decisions of one kind (factory output, a stock count…), by the record they belong to. */
export async function decisionFiles(db: Db, workspaceId: string, kind: "factory_output" | "stock_correction", subjectIds: string[]) {
  if (!subjectIds.length) return new Map<string, ApprovalFile[]>();
  return group((await db.query<FileRow>(
    `SELECT file.subject_id AS key, 'evidence' AS store, file.id::text AS id, file.subject_id AS owner, file.file_name AS name, file.has_preview AS preview
       FROM decision_evidence_files file WHERE file.workspace_id = $1 AND file.kind = $2 AND file.subject_id = ANY($3::text[]) ORDER BY file.uploaded_at`,
    [workspaceId, kind, subjectIds])).rows);
}

/** Daily reports (by report id): their photos, the client's first. */
export async function reportPhotos(db: Db, workspaceId: string, reportIds: string[]) {
  if (!reportIds.length) return new Map<string, ApprovalFile[]>();
  return group((await db.query<FileRow>(
    `SELECT photo.report_id::text AS key, 'site_photo' AS store, photo.id::text AS id, report.project_id::text AS owner, photo.original_name AS name, true AS preview
       FROM site_report_photos photo JOIN site_reports report ON report.workspace_id = photo.workspace_id AND report.id = photo.report_id
      WHERE photo.workspace_id = $1 AND photo.report_id = ANY($2::uuid[])
      ORDER BY photo.for_client DESC, photo.position, photo.created_at`, [workspaceId, reportIds])).rows);
}

/** Petty-cash claims (by claim id): the receipt photographed with the claim. */
export async function claimReceipts(db: Db, workspaceId: string, claimIds: string[]) {
  if (!claimIds.length) return new Map<string, ApprovalFile[]>();
  return group((await db.query<FileRow>(
    `SELECT claim.id::text AS key, 'petty_cash_receipt' AS store, claim.id::text AS id, claim.id::text AS owner, coalesce(claim.receipt_name, 'Receipt') AS name,
            coalesce(claim.receipt_type, '') LIKE 'image/%' AS preview
       FROM petty_cash_claims claim WHERE claim.workspace_id = $1 AND claim.id = ANY($2::uuid[]) AND claim.receipt_key IS NOT NULL`, [workspaceId, claimIds])).rows);
}

/** Supplier bills (by bill id), and the bills in each payment run (by run id). */
export async function billFiles(db: Db, workspaceId: string, billIds: string[], runIds: string[]) {
  if (!billIds.length && !runIds.length) return new Map<string, ApprovalFile[]>();
  return group((await db.query<FileRow>(
    `SELECT bill.id::text AS key, 'bill' AS store, bill.id::text AS id, bill.id::text AS owner, coalesce(bill.file_name, bill.number) AS name, coalesce(bill.file_type, '') LIKE 'image/%' AS preview
       FROM supplier_invoices bill WHERE bill.workspace_id = $1 AND bill.id = ANY($2::uuid[]) AND bill.file_key IS NOT NULL
     UNION ALL
     SELECT item.run_id::text AS key, 'bill' AS store, bill.id::text AS id, bill.id::text AS owner, bill.number || ' · ' || coalesce(bill.file_name, '') AS name, coalesce(bill.file_type, '') LIKE 'image/%' AS preview
       FROM payment_run_items item JOIN supplier_invoices bill ON bill.workspace_id = item.workspace_id AND bill.id = item.invoice_id
      WHERE item.workspace_id = $1 AND item.run_id = ANY($3::uuid[]) AND bill.file_key IS NOT NULL`, [workspaceId, billIds, runIds])).rows);
}

/** Designs in review (by design id): the file of the version under review. */
export async function designFiles(db: Db, workspaceId: string, designIds: string[]) {
  if (!designIds.length) return new Map<string, ApprovalFile[]>();
  return group((await db.query<FileRow>(
    `SELECT DISTINCT ON (version.design_id) version.design_id::text AS key, 'case_asset' AS store, asset.id::text AS id, version.case_id::text AS owner,
            asset.original_name AS name, asset.preview_key IS NOT NULL AS preview
       FROM pre_project_design_versions version
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.case_id = version.case_id AND asset.id = version.asset_id
      WHERE version.workspace_id = $1 AND version.design_id = ANY($2::uuid[])
      ORDER BY version.design_id, version.number DESC`, [workspaceId, designIds])).rows);
}

/**
 * Requests on the approval engine (by request id), by what they are about: the payment proofs behind a proposal's
 * value, a refund's or supplier request's files, a change's files, an outsourced material's sample photo and evidence.
 */
export async function engineFiles(db: Db, workspaceId: string, requests: Array<{ id: string; kind: string; subjectId: string }>) {
  const of = (kinds: string[]) => requests.filter((request) => kinds.includes(request.kind));
  const ids = (kinds: string[]) => of(kinds).map((request) => request.subjectId);
  const bySubject = new Map<string, ApprovalFile[]>();
  const add = (rows: FileRow[]) => { for (const { key, ...file } of rows) bySubject.set(key, [...(bySubject.get(key) ?? []), file]); };
  if (of(["opportunity_value"]).length) add((await db.query<FileRow>(
    `SELECT proposal.id::text AS key, 'opportunity_proof' AS store, proof.id::text AS id, proposal.opportunity_id::text AS owner, proof.file_name AS name, proof.has_preview AS preview
       FROM crm_opportunity_proposals proposal
       JOIN crm_opportunity_payment_proofs proof ON proof.workspace_id = proposal.workspace_id AND proof.opportunity_id = proposal.opportunity_id
            AND (proof.proposal_kind IS NULL OR proof.proposal_kind = proposal.kind)
      WHERE proposal.workspace_id = $1 AND proposal.id = ANY($2::uuid[]) ORDER BY proof.recorded_at`, [workspaceId, ids(["opportunity_value"])])).rows);
  if (of(["refund", "payable_request"]).length) add((await db.query<FileRow>(
    `SELECT file.request_id::text AS key, 'request_file' AS store, file.id::text AS id, file.request_id::text AS owner, file.name, file.content_type LIKE 'image/%' AS preview
       FROM finance_request_files file WHERE file.workspace_id = $1 AND file.request_id = ANY($2::uuid[]) ORDER BY file.uploaded_at`,
    [workspaceId, ids(["refund", "payable_request"])])).rows);
  if (of(["change_request"]).length) add((await db.query<FileRow>(
    `SELECT file.change_request_id::text AS key, 'change_file' AS store, file.id::text AS id, change.project_id::text AS owner, file.original_name AS name, file.preview_key IS NOT NULL AS preview
       FROM change_request_files file JOIN change_requests change ON change.workspace_id = file.workspace_id AND change.id = file.change_request_id
      WHERE file.workspace_id = $1 AND file.change_request_id = ANY($2::uuid[]) AND change.project_id IS NOT NULL ORDER BY file.created_at`,
    [workspaceId, ids(["change_request"])])).rows);
  if (of(["outsourced_material"]).length) add((await db.query<FileRow>(
    `SELECT version.id::text AS key, 'case_asset' AS store, asset.id::text AS id, version.case_id::text AS owner, asset.original_name AS name, asset.preview_key IS NOT NULL AS preview
       FROM design_ledger_versions version
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.case_id = version.case_id
            AND asset.id IN (version.sample_photo_asset_id, version.evidence_asset_id)
      WHERE version.workspace_id = $1 AND version.id = ANY($2::uuid[])`, [workspaceId, ids(["outsourced_material"])])).rows);
  return new Map(requests.map((request) => [request.id, bySubject.get(request.subjectId) ?? []]));
}

/** The kinds whose review always rests on a file: an empty list there says plainly that nothing was attached. */
export const ENGINE_KINDS_WITH_FILES = new Set(["opportunity_value", "refund", "payable_request", "change_request", "outsourced_material"]);
