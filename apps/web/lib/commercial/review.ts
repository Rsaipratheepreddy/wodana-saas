import type { Quote } from "./types";
export function quoteReviewChecks(q: Quote) {
  const unpriced = q.lines.filter(
    (l) => l.rate <= 0 || l.quantity <= 0 || !l.title.trim() || !l.unit.trim(),
  ).length;
  const unspecified = q.lines.filter(
    (l) =>
      (!l.material.trim() && !l.specification.trim() && !l.customMaterials?.length) ||
      /^(to select|to confirm|tbc)/i.test(l.material.trim()),
  ).length;
  const percent = q.paymentTerms.reduce((n, m) => n + m.percent, 0);
  return [
    {
      id: "cover",
      page: "cover",
      label: "Quotation details",
      ready: !!q.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(q.validUntil),
      detail: "Project title, currency and validity.",
    },
    {
      id: "items",
      page: "items",
      label: "Scope & selling rates",
      ready: q.lines.length > 0 && !unpriced,
      detail: !q.lines.length
        ? "Add your first room and item."
        : unpriced
          ? `${unpriced} items need a quantity, unit or selling rate.`
          : `${q.lines.length} items priced.`,
    },
    {
      id: "materials",
      page: "items",
      label: "Materials & specifications",
      ready: q.lines.length > 0 && !unspecified,
      detail: unspecified
        ? `${unspecified} items need a material or specification.`
        : "Material choices are visible alongside each item.",
    },
    {
      id: "payment",
      page: "payments",
      label: q.direction === "deduction" ? "Client credit" : "Payment schedule",
      ready:
        q.direction === "deduction"
          ? q.paymentTerms.length === 0
          : q.paymentTerms.length > 0 &&
            Math.abs(percent - 100) < 0.001 &&
            q.paymentTerms.every(
              (m) => m.title.trim() && m.trigger.trim() && m.percent > 0,
            ),
      detail:
        q.direction === "deduction"
          ? "Acceptance creates a client credit for accounting reconciliation."
          : q.paymentTerms.length
            ? `${q.paymentTerms.length} milestones · ${percent.toFixed(0)}% allocated.`
            : "Choose a schedule or add milestones totalling 100%.",
    },
    {
      id: "terms",
      page: "terms",
      label: "Terms & conditions",
      ready: !!q.terms.trim(),
      detail: q.terms.trim()
        ? "Terms are included in this version."
        : "Add the conditions that apply to this proposal.",
    },
  ];
}
