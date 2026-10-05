import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { LifecycleOverview } from "@/lib/internal/console";
import { CreateTenantPage } from "./create-tenant-page";
import { ReasonDialog, TransitionDialog } from "./overview-tab";

// §5c D.4: operator forms are one column with titled sections, errors at the top and the primary action at the end.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/internal" }));
afterEach(() => vi.unstubAllGlobals());

const sectionTitles = (root: ParentNode) => [...root.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (root: ParentNode) => root.querySelectorAll(".wd-form-row").length;
const lastAction = (dialog: HTMLElement) => dialog.querySelector(".wd-dialog-actions")?.lastElementChild?.textContent;

const profiles = [
  { kind: "region", code: "SG", version: 1, configuration: { countryCode: "SG", currency: "SGD", locale: "en-SG", timezone: "Asia/Singapore", unitSystem: "metric", weekStartsOn: 1 } },
  { kind: "firm_kit", code: "interior_studio", version: 2, configuration: { label: "Interior design studio" } },
  { kind: "plan", code: "starter", version: 1, configuration: { seatLimit: 5, projectLimit: 25 } },
];
const lifecycle: LifecycleOverview = {
  workspaceId: "11111111-1111-4111-8111-111111111111", externalTenantId: "tenant_acme", state: "active", version: 2,
  workspaceStatus: "active", graceEndsAt: null, nextStates: ["grace", "suspended", "archived"],
  readiness: { onboardingStatus: "completed", ownerInvitationStatus: "accepted", retentionPolicySet: true, legalHold: false,
    exportReady: true, exportExpiresAt: null, entitlementStatus: "active" },
  history: [], notices: [],
};

describe("Operator forms", () => {
  it("creates a tenant in one column: Account, Organization, Owner", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).endsWith("/profiles") ? profiles : {})));
    const { container } = render(<DesignSystemProvider><CreateTenantPage /></DesignSystemProvider>);
    await screen.findByRole("textbox", { name: /Account name/ });
    expect(sectionTitles(container)).toEqual(["Account", "Organization", "Owner"]);
    expect(rows(container)).toBe(0);
    expect(container.querySelector("form > :last-child")?.textContent).toBe("Review");
  });

  it("asks for a reason in one field, Save at the end", async () => {
    render(<DesignSystemProvider><ReasonDialog title="Request export" action="Request" onClose={vi.fn()} onSave={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Request export" });
    expect(rows(dialog)).toBe(0);
    expect(dialog.querySelector(".wd-form-footer .wd-dialog-actions")?.lastElementChild?.textContent).toBe("Request");
  });

  it("changes state with the primary action last", async () => {
    render(<DesignSystemProvider><TransitionDialog orgKey="tenant_acme" lifecycle={lifecycle} onClose={vi.fn()} onDone={vi.fn()} /></DesignSystemProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Change state" });
    expect(rows(dialog)).toBe(0);
    expect(lastAction(dialog)).toBe("Save");
  });

  it("keeps two-column grids out of the operator form styles, except read-only facts and cards", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    const allowed = [
      /^\.properties$/, // read-only facts (<dl>), not fields
      /^\.connectionGrid$/, // one card per provider
    ];
    for (const sheet of ["control-plane", "sales", "operator-notifications"]) {
      const css = readFileSync(join(__dirname, `${sheet}.module.css`), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
      const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, selector, body]) => ({ selector: selector.trim().replace(/\s+/g, " "), body }))
        .filter(({ selector, body }) => twoColumns.test(body) && !allowed.some((pattern) => pattern.test(selector)))
        .map(({ selector }) => selector);
      expect(offenders, `${sheet}.module.css`).toEqual([]);
    }
  });
});
