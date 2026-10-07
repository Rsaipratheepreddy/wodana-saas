"use client";

import { SelectField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { BillCoding } from "@/lib/books/capture-client";
import styles from "./capture.module.css";

const NONE = "none";

/** A bill line's tax treatment and the account it's charged to, from the company's Ledger. */
export function BillLineCoding({ coding, item, taxCode, booksAccountId, onChange }: {
  coding: BillCoding; item: string; taxCode: string | null; booksAccountId: string | null;
  onChange: (patch: { taxCode?: string | null; booksAccountId?: string | null }) => void;
}) {
  const t = useT();
  return <span className={styles.coding}>
    {coding.taxCodes.length ? <SelectField accent="neutral" aria-label={t("Tax treatment for {item}", { item })} label={null}
      items={[{ id: NONE, label: t("No tax code") }, ...coding.taxCodes.map((code) => ({ id: code.code, label: `${code.code} · ${code.name}` }))]}
      onSelectionChange={(key) => onChange({ taxCode: key && key !== NONE ? String(key) : null })} placeholder={t("Tax treatment")} selectedKey={taxCode ?? NONE} /> : null}
    {coding.accounts.length ? <SelectField accent="neutral" aria-label={t("Account for {item}", { item })} label={null}
      items={[{ id: NONE, label: t("Default account") }, ...coding.accounts.map((account) => ({ id: account.id, label: `${account.code} · ${account.name}` }))]}
      onSelectionChange={(key) => onChange({ booksAccountId: key && key !== NONE ? String(key) : null })} placeholder={t("Account")} selectedKey={booksAccountId ?? NONE} /> : null}
  </span>;
}
