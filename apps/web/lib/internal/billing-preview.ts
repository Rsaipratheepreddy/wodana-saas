export type BillingPreviewTerm = {
  status: "trial_uncontracted" | "contracted" | "expired";
  currency: string;
  recurringAmount: number;
  seatLimit: number;
  projectLimit: number;
  termStartsAt: string;
  renewsAt: string | null;
};

export function previewBillingContractChange(current: BillingPreviewTerm | null, next: BillingPreviewTerm, observedAt = new Date()) {
  const recurringDelta = next.status === "expired"
    ? -(current?.recurringAmount ?? 0)
    : next.recurringAmount - (current?.recurringAmount ?? 0);
  const capacityDelta = {
    seats: next.seatLimit - (current?.seatLimit ?? 0),
    projects: next.projectLimit - (current?.projectLimit ?? 0),
  };
  let proratedDelta: number | null = null;
  if (current && current.currency === next.currency && current.renewsAt) {
    const periodStart = new Date(current.termStartsAt).getTime();
    const periodEnd = new Date(current.renewsAt).getTime();
    const at = observedAt.getTime();
    if (Number.isFinite(periodStart) && Number.isFinite(periodEnd) && periodEnd > periodStart && at >= periodStart && at < periodEnd) {
      const remaining = (periodEnd - at) / (periodEnd - periodStart);
      proratedDelta = Math.round(recurringDelta * remaining * 100) / 100;
    }
  }
  const direction = next.status === "expired" ? "cancellation"
    : recurringDelta > 0 || capacityDelta.seats > 0 || capacityDelta.projects > 0 ? "upgrade"
      : recurringDelta < 0 || capacityDelta.seats < 0 || capacityDelta.projects < 0 ? "downgrade" : "no_change";
  return {
    direction,
    recurringDelta,
    proratedDelta,
    nextBillAmount: next.status === "expired" ? 0 : next.recurringAmount,
    capacityDelta,
    accessEffect: "none" as const,
    prorationIsEstimate: proratedDelta !== null,
  };
}
