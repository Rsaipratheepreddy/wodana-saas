/** Bill capture (Ledger): a bill's photo or PDF read by Woddy into a draft supplier invoice a person checks and saves. */

export const CAPTURE_MAX_BYTES = 6 * 1024 * 1024;

export type CaptureStatus = "reading" | "read" | "failed" | "drafted" | "discarded";
export type CaptureField = "supplierName" | "supplierTaxNumber" | "buyerTaxNumber" | "invoiceNumber" | "invoiceDate" | "dueDate" | "currency" | "poNumber" | "lines" | "net" | "tax" | "total";

export type CaptureWarning =
  | { code: "duplicate_bill"; billId: string; number: string }
  | { code: "total_mismatch"; stated: string; computed: string }
  | { code: "supplier_not_found"; name: string | null; taxNumber: string | null }
  | { code: "order_other_currency"; order: string; currency: string }
  | { code: "future_date"; date: string };

/** A line the reading proposes: on the matched order where it pairs, else a charge. */
export type CaptureLine = {
  orderLineId: string | null; orderNumber: string | null; projectId: string | null; projectReference: string | null; description: string; unit: string;
  quantity: string; unitPrice: string | null; taxRate: string; taxCode: string | null;
};

export type CaptureProposal = {
  vendorId: string | null; vendorName: string | null; vendorMatch: "tax_number" | "name" | "partial_name" | null; legalEntityId: string | null; currency: string | null;
  orderId: string | null; orderNumber: string | null; number: string | null; invoiceDate: string | null; dueDate: string | null; statedTotal: string | null;
  lines: CaptureLine[]; warnings: CaptureWarning[]; hints: Partial<Record<CaptureField, "check" | "missing">>; ready: boolean;
};

export type CaptureReading = {
  supplierName: string | null; supplierNameAlt: string | null; supplierTaxNumber: string | null; invoiceNumber: string | null; total: string | null; currency: string | null; confidence: number;
};

export type CaptureState = {
  capture: {
    id: string; status: CaptureStatus; fileName: string; contentType: string; byteSize: number | null; model: string | null; confidence: string | null; error: string | null;
    billId: string | null; legalEntityId: string | null; matchedVendorId: string | null; matchedOrderId: string | null; confirmedBy: string | null; confirmedAt: string | null;
    createdByName: string; createdAt: string; version: number;
  };
  reading: CaptureReading | null;
  proposal: CaptureProposal | null;
  /** The same file was captured before: this is that capture. */
  duplicate?: boolean;
};

export type BillTaxCode = { code: string; name: string; rate: string; treatment: string };
export type BillAccount = { id: string; code: string; name: string; type: string };
/** What a company's bill lines can name in its Ledger; empty when it doesn't keep its books in Wodana. */
export type BillCoding = { enabled: boolean; ledgerOn: boolean; taxCodes: BillTaxCode[]; accounts: BillAccount[] };

export class CaptureRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, init: RequestInit = {}, fallback = "Could not save."): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new CaptureRequestError(typeof data?.message === "string" ? data.message : fallback, response.status);
  return data as T;
}

/** The bill capture API for one workspace. Commands carry their own id, so a retry never runs twice. */
export function captureApi(workspaceId: string) {
  const at = (path: string, extra: Record<string, string> = {}) => `/api/books/capture/${path}?${new URLSearchParams({ workspaceId, ...extra })}`;
  const command = (id: string, input: Record<string, unknown>) =>
    request<CaptureState>(at(`captures/${id}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, commandId: crypto.randomUUID() }) });
  return {
    upload: (file: File) => {
      const body = new FormData(); body.set("file", file);
      return request<CaptureState>(at("captures"), { method: "POST", body }, "The bill could not be read.");
    },
    get: (id: string) => request<CaptureState>(at(`captures/${id}`), {}, "Could not load."),
    /** The person saved the draft: the capture names the invoice, and its file becomes the invoice's document. */
    confirm: (id: string, version: number, billId: string) => command(id, { action: "confirm", version, billId }),
    discard: (id: string, version: number) => command(id, { action: "discard", version }),
    /** Woddy reads a bill again after its reading failed: the same capture and file. */
    retry: (id: string, version: number) => command(id, { action: "retry", version }),
    coding: (legalEntityId: string, date?: string | null) => request<BillCoding>(at(`bill-coding/${legalEntityId}`, date ? { date } : {}), {}, "Could not load."),
    fileUrl: (id: string) => at(`captures/${id}/file`),
  };
}
export type CaptureApi = ReturnType<typeof captureApi>;

/** A coding answer that isn't one (an older server, a stand-in in tests) counts as no Ledger. */
export function usableCoding(value: unknown): BillCoding | null {
  const coding = value as Partial<BillCoding> | null;
  if (!coding || !coding.enabled || !Array.isArray(coding.taxCodes) || !Array.isArray(coding.accounts)) return null;
  return coding.taxCodes.length || coding.accounts.length ? coding as BillCoding : null;
}

/** The standard purchase code at a line's rate; a zero rate (zero, exempt, out of scope) is left to the person. */
export function defaultTaxCode(rate: string, codes: BillTaxCode[]) {
  const value = Number(rate);
  if (!rate || !Number.isFinite(value) || value === 0) return null;
  const matching = codes.filter((code) => code.treatment === "standard" && Number(code.rate) === value);
  return matching.length === 1 ? matching[0].code : null;
}

/** Waits while Woddy reads, checking now and then; a reading still going after `timeoutMs` comes back as it is. */
export async function waitForReading(api: Pick<CaptureApi, "get">, state: CaptureState, { intervalMs = 1500, timeoutMs = 30_000 } = {}) {
  let current = state;
  const started = Date.now();
  while (current.capture.status === "reading" && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    current = await api.get(current.capture.id);
  }
  return current;
}

/**
 * A phone photo above the upload limit, scaled down in the browser (long edge 2400 px, JPEG) where the browser
 * can; anything else is sent as it is.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (file.size <= CAPTURE_MAX_BYTES || !file.type.startsWith("image/") || typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}
