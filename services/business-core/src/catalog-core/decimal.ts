/**
 * Exact fixed-point decimal (6 places) on BigInt, for quantities and money arithmetic.
 * Never goes through binary floats; rounds half away from zero only when asked.
 */
const SCALE = 6n;
const FACTOR = 10n ** SCALE;

export class Dec {
  private constructor(readonly units: bigint) {}

  static readonly ZERO = new Dec(0n);
  static readonly ONE = new Dec(FACTOR);

  static of(value: string | number | bigint | Dec): Dec {
    if (value instanceof Dec) return value;
    if (typeof value === "bigint") return new Dec(value * FACTOR);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new RangeError("Not a finite number");
      return Dec.of(value.toFixed(Number(SCALE)));
    }
    const text = value.trim();
    const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) throw new RangeError(`"${value}" is not a decimal number`);
    const [, sign, whole, fraction = ""] = match;
    const padded = (fraction + "000000").slice(0, Number(SCALE));
    const rest = fraction.slice(Number(SCALE));
    let units = BigInt(whole) * FACTOR + BigInt(padded);
    if (rest && Number(rest[0]) >= 5) units += 1n; // half away from zero on input beyond 6 places
    return new Dec(sign === "-" ? -units : units);
  }

  add(other: Dec | string | number) { return new Dec(this.units + Dec.of(other).units); }
  sub(other: Dec | string | number) { return new Dec(this.units - Dec.of(other).units); }
  mul(other: Dec | string | number) { return new Dec(divRound(this.units * Dec.of(other).units, FACTOR)); }
  div(other: Dec | string | number) {
    const divisor = Dec.of(other).units;
    if (divisor === 0n) throw new RangeError("Division by zero");
    return new Dec(divRound(this.units * FACTOR, divisor));
  }
  neg() { return new Dec(-this.units); }
  abs() { return this.units < 0n ? this.neg() : this; }
  cmp(other: Dec | string | number) { const b = Dec.of(other).units; return this.units === b ? 0 : this.units < b ? -1 : 1; }
  isZero() { return this.units === 0n; }
  isNegative() { return this.units < 0n; }

  /** Round to `places` decimals, half away from zero. */
  round(places: number) {
    const step = 10n ** (SCALE - BigInt(places));
    return new Dec(divRound(this.units, step) * step);
  }
  ceil(places = 0) { return this.step(places, "ceil"); }
  floor(places = 0) { return this.step(places, "floor"); }

  toFixed(places: number) {
    const rounded = this.round(places).units;
    const negative = rounded < 0n;
    const abs = negative ? -rounded : rounded;
    const whole = abs / FACTOR;
    const fraction = (abs % FACTOR).toString().padStart(Number(SCALE), "0").slice(0, places);
    return `${negative ? "-" : ""}${whole}${places ? `.${fraction}` : ""}`;
  }
  /** Shortest exact text (no trailing zeros). */
  toString() {
    const text = this.toFixed(Number(SCALE));
    return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
  }
  toNumber() { return Number(this.toString()); }

  private step(places: number, mode: "ceil" | "floor") {
    const step = 10n ** (SCALE - BigInt(places));
    const q = this.units / step, r = this.units % step;
    let result = q;
    if (r !== 0n && mode === "ceil" && this.units > 0n) result += 1n;
    if (r !== 0n && mode === "floor" && this.units < 0n) result -= 1n;
    return new Dec(result * step);
  }
}

function divRound(numerator: bigint, denominator: bigint) {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return negative ? -q : q;
}
