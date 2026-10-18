/**
 * The part of what a client pays that is before tax (a payment stage is the amount the client pays), exactly:
 * fixed-point on BigInt (6 places), half away from zero, to the currency's minor units — as the server does.
 */
export function netOfTax(gross: string, taxRate: string, decimals: number) {
  const parse = (value: string) => {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
    return match ? BigInt(match[1]) * 1_000_000n + BigInt(((match[2] ?? "") + "000000").slice(0, 6)) : null;
  };
  const amount = parse(gross), rate = parse(taxRate || "0");
  if (amount === null || rate === null) return "";
  const divRound = (value: bigint, divisor: bigint) => { const quotient = value / divisor; return (value % divisor) * 2n >= divisor ? quotient + 1n : quotient; };
  const net = divRound(amount * 100_000_000n, 100_000_000n + rate);
  const step = 10n ** BigInt(6 - decimals);
  const rounded = divRound(net, step);
  const text = rounded.toString().padStart(decimals + 1, "0");
  return decimals ? `${text.slice(0, -decimals)}.${text.slice(-decimals)}` : text;
}
