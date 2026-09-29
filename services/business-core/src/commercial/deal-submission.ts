import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../common/currency";

export type CommissionLine = {
  recipientName: string;
  type: "sales" | "designer" | "referral";
  basis: "amount" | "percent";
  value: number;
  amount: number;
};

const commissionTypes = new Set(["sales", "designer", "referral"]);
const commissionBases = new Set(["amount", "percent"]);

/** A commission row nobody filled in: no recipient and no value. */
function isBlankCommission(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const row = raw as Record<string, unknown>;
  const recipient = typeof row.recipientName === "string" ? row.recipientName.trim() : row.recipientName;
  return !recipient && (row.value === undefined || row.value === null || row.value === "" || row.value === 0);
}

export function normalizeCommissionLines(input: unknown, dealValue: number, currencyCode?: string): CommissionLine[] {
  const places = currencyCode ? currencyDecimals(currencyCode) : 2;
  if (input !== undefined && input !== null && !Array.isArray(input)) throw new Error("The commission lines are invalid.");
  // No commission is a valid deal; a row left completely empty is not a commission.
  const rows = (Array.isArray(input) ? input : []).filter((raw) => !isBlankCommission(raw));
  if (rows.length > 3) throw new Error("Add up to three commission recipients.");
  if (!Number.isFinite(dealValue) || dealValue < 0) throw new Error("The deal value is invalid.");
  const lines = rows.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Commission ${index + 1} is invalid.`);
    const row = raw as Record<string, unknown>;
    const recipientName = typeof row.recipientName === "string" ? row.recipientName.trim() : "";
    const type = row.type;
    const basis = row.basis;
    const value = Number(row.value);
    if (!recipientName || recipientName.length > 160) throw new Error(`Enter the recipient for commission ${index + 1}.`);
    if (typeof type !== "string" || !commissionTypes.has(type)) throw new Error(`Choose the type for commission ${index + 1}.`);
    if (typeof basis !== "string" || !commissionBases.has(basis)) throw new Error(`Choose amount or percentage for commission ${index + 1}.`);
    if (!Number.isFinite(value) || value <= 0 || (basis === "percent" && value > 100)) throw new Error(`Enter a valid value for commission ${index + 1}.`);
    // Exact money in the deal currency's minor units, never float math.
    const amount = (basis === "percent" ? Dec.of(dealValue).mul(value).div(100) : Dec.of(value)).round(places).toNumber();
    return { recipientName, type: type as CommissionLine["type"], basis: basis as CommissionLine["basis"], value, amount };
  });
  if (lines.reduce((total, line) => total.add(line.amount), Dec.ZERO).cmp(Dec.of(dealValue)) > 0)
    throw new Error("Total commissions cannot exceed the accepted deal value.");
  return lines;
}

export function confirmCommissionAmounts(provisional: CommissionLine[], input: unknown, dealValue: number, currencyCode?: string) {
  const final = normalizeCommissionLines(input, dealValue, currencyCode);
  if (final.length !== provisional.length || final.some((line, index) => line.recipientName !== provisional[index].recipientName || line.type !== provisional[index].type)) {
    throw new Error("Finance may correct commission amounts; return the submission to Sales to change recipients or types.");
  }
  return final;
}

export function paymentProofLink(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 2048) throw new Error("Add a proof-of-payment link.");
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new Error("Use a secure HTTPS proof-of-payment link.");
  }
}
