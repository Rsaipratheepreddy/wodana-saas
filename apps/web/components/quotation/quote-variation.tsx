"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, ControlledModalDialog, EmptyState, InlineNotice, SearchInput, SegmentedControl, SelectField, Skeleton, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import { money, plain } from "@/lib/quotation/format";
import type { BoqPick, BuilderState, LineOp } from "@/lib/quotation/types";
import styles from "./quote-builder.module.css";

type Api = ReturnType<typeof quoteApi>;
type Change = "omit" | "move" | "replace";

/**
 * On a variation: pick a line of the project's agreed scope, then remove some or all of it (a credit
 * at what the client paid for it), move it to another area, or replace it (a removal plus a new line).
 * New scope is simply added as a line.
 */
export function ChangeAgreedItem({ state, api, onApply, onClose }: { state: BuilderState; api: Api; onApply: (ops: LineOp[]) => Promise<boolean>; onClose: () => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [lines, setLines] = useState<BoqPick[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<BoqPick | null>(null);
  const [change, setChange] = useState<Change>("omit");
  const [quantity, setQuantity] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api.boq().then((next) => { if (alive) setLines(next.lines); }).catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [api]);
  const visible = useMemo(() => (lines ?? []).filter((line) => !search.trim() || `${line.title} ${line.areaName ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [lines, search]);
  const pick = (line: BoqPick) => { setPicked(line); setQuantity(plain(line.quantity, locale, 4)); setArea(null); };
  const qty = quantity.replace(/[^\d.]/g, "");
  const valid = picked && (change === "move" ? Boolean(area) : Number(qty) > 0 && Number(qty) <= Number(picked.quantity));
  const submit = async () => {
    if (!picked || !valid) return;
    setBusy(true);
    const op: LineOp = change === "move"
      ? { op: "change", change, id: crypto.randomUUID(), boqLineId: picked.id, areaId: area === "general" ? null : area }
      : { op: "change", change, id: crypto.randomUUID(), boqLineId: picked.id, quantity: qty, ...(change === "replace" ? { replacementId: crypto.randomUUID() } : {}) };
    if (await onApply([op])) onClose();
    setBusy(false);
  };
  const areaItems = [{ id: "general", label: t("General") }, ...state.areas.map((item) => ({ id: item.id, label: item.name }))].filter((item) => item.id !== (picked?.areaId ?? "general"));

  return <ControlledModalDialog isOpen size="lg" title={t("Change an agreed item")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions">
      {picked ? <Button onPress={() => setPicked(null)}>{t("Back")}</Button> : null}
      <span className={styles.spacer} />
      <Button onPress={onClose}>{t("Cancel")}</Button>
      {picked ? <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={() => void submit()}>{t("Add to variation")}</Button> : null}
    </div>}>
    {error ? <InlineNotice tone="error" message={error} /> : !lines ? <Skeleton lines={4} /> : !picked ? <div className={styles.dialogForm}>
      <SearchInput aria-label={t("Search the agreed items")} placeholder={t("Search the agreed items")} value={search} onChange={setSearch} />
      {visible.length ? <ul className={styles.boqPick} aria-label={t("Agreed items")}>
        {visible.map((line) => <li key={line.id}><button type="button" onClick={() => pick(line)}>
          <span><strong>{line.title}</strong><small>{line.areaName ?? t("General")} · {plain(line.quantity, locale, 4)} {line.unit}</small></span>
          <span>{money(line.net, state.quote.currency, state.quote.decimals, locale)}</span>
        </button></li>)}
      </ul> : <EmptyState illustration={null} title={t("No agreed items match")} />}
    </div> : <div className={styles.dialogForm}>
      <p className={styles.pickedLine}><strong>{picked.title}</strong> · {picked.areaName ?? t("General")} · {plain(picked.quantity, locale, 4)} {picked.unit}</p>
      <SegmentedControl label={t("Change")} value={change} onChange={(value) => setChange(value as Change)}
        options={[{ id: "omit", label: t("Remove") }, { id: "move", label: t("Move") }, { id: "replace", label: t("Replace") }]} />
      {change === "move"
        ? <SelectField label={t("Move to")} isRequired placeholder={t("Choose an area")} selectedKey={area} onSelectionChange={(key) => setArea(String(key))} items={areaItems} />
        : <TextInput label={change === "replace" ? t("How much to replace") : t("How much to remove")} inputMode="decimal" value={quantity} onChange={setQuantity}
            description={t("Up to {quantity} {unit}", { quantity: plain(picked.quantity, locale, 4), unit: picked.unit })} />}
      <p className={styles.mutedText}>{change === "omit" ? t("It's credited at what the client paid for it.")
        : change === "move" ? t("Price the labour for the move on the new line.")
        : t("The old item is credited and a new line is added for you to fill in.")}</p>
    </div>}
  </ControlledModalDialog>;
}
