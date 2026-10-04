"use client";

import { Radio, RadioGroup } from "react-aria-components";
import { typeHue } from "@/design-system";
import { TYPE_COLORS, type TypeColor } from "@/lib/flows/flow-model";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./flows.module.css";

/** An enquiry type's colour as a small dot: the colour the firm picked, or one derived from its code. */
export function TypeDot({ code, color }: { code: string; color?: TypeColor | null }) {
  return <span aria-hidden="true" className={styles.typeDot} data-hue={color ?? typeHue(code)} />;
}

/** The six colours an enquiry type can have, as a row of dots (a radio group). */
export function ColorSwatches({ isDisabled, onChange, value }: { isDisabled?: boolean; onChange: (color: TypeColor) => void; value: TypeColor }) {
  const t = useT();
  return <RadioGroup aria-label={t("Colour")} className={styles.swatches} isDisabled={isDisabled} onChange={(next) => onChange(Number(next) as TypeColor)} orientation="horizontal" value={String(value)}>
    <span className={styles.swatchesLabel}>{t("Colour")}</span>
    <span className={styles.swatchRow}>{TYPE_COLORS.map((color) => <Radio aria-label={t("Colour {number}", { number: color })} className={styles.swatch} data-hue={color} key={color} value={String(color)} />)}</span>
  </RadioGroup>;
}
