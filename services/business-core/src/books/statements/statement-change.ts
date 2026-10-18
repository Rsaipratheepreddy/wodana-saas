import { money, units } from "../reports/report-math";
import { percent } from "./statement-builder";

/**
 * Change from the comparison to the current amount, and as a percentage of the comparison's size (null when it is
 * zero). Mirrors `statementChange` in packages/contracts/src/financial-statements.ts.
 */
export function statementChangeOf(current: string, previous: string): { change: string; percent: string | null } {
  const change = money(units(current) - units(previous));
  const base = units(previous);
  return { change, percent: percent(change, money(base < 0n ? -base : base)) };
}
