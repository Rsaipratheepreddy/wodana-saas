import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every workspace page has the same anatomy (§5c D): its one title comes from PageShell, PageHeader or SettingsPage,
// so a module never draws its own header. Lists use DataGrid / RecordTable / GroupedTable, never a div grid with
// role="table". These lists only shrink: a file leaves when its module is rebuilt (P1–P8); nothing is added.
const views = execSync("git ls-files 'app/**/*.tsx' 'components/**/*.tsx'", { encoding: "utf8" })
  .split("\n").filter((file) => file && !/\.(test|stories)\.tsx$/.test(file) && !file.startsWith("app/zz-") && existsSync(file));

/** Surfaces outside the staff workspace (public pages, the client portal, print documents) own their title. */
const OWN_TITLE = new Set([
  "app/login/login-screen.tsx",
  "app/onboarding/onboarding-flow.tsx",
  "components/booking/manage-booking.tsx",
  "components/booking/public-booking.tsx",
  "components/client-portal/confirm-name.tsx",
  "components/client-portal/portal-document-print.tsx",
  "components/client-portal/project-profile.tsx",
  "components/client-portal/sign-in.tsx",
  "components/commercial/quotation-cover.tsx",
  "components/commercial/quotation-rich-text.tsx",
  "components/crm/public-enquiry-form.tsx",
  "components/gallery/gallery-view.tsx",
  "components/inventory/move-print.tsx",
  "components/landing/landing-page.tsx",
  "components/landing/marketing-frame.tsx",
  "components/oauth/consent-screen.tsx",
  "components/projects/vendor-order-form.tsx",
  "components/purchasing/order-print.tsx",
  "components/site/progress-print.tsx",
]);

/** Staff screens still drawing their own header; each moves to PageShell when its module is rebuilt. */
const OWN_HEADER_TO_FIX = new Set([
  "app/workspace/[[...section]]/page.tsx",
  "app/workspace/pre-projects/cases/[caseId]/[[...section]]/page.tsx",
  "components/flows/flow-builder.tsx",
  "components/quotation/quote-builder.tsx",
]);

/** Div grids standing in for tables; each becomes DataGrid / GroupedTable / DocumentTable when its module is rebuilt. */
const DIV_TABLE_CEILING = 12;

describe("page anatomy", () => {
  it("gives every staff page its title through the shared page header", () => {
    const own = views.filter((file) => /<h1[\s>]/.test(readFileSync(file, "utf8")) && !OWN_TITLE.has(file));
    expect(own.filter((file) => !OWN_HEADER_TO_FIX.has(file)), "use PageShell (or PageHeader / SettingsPage) for the page title").toEqual([]);
    // Fixed files leave the list, so it can only shrink.
    expect([...OWN_HEADER_TO_FIX].filter((file) => !own.includes(file)), "remove fixed files from OWN_HEADER_TO_FIX").toEqual([]);
  });

  it("does not add div grids that pretend to be tables", () => {
    const count = views.filter((file) => /role="(table|row)"/.test(readFileSync(file, "utf8"))).length;
    expect(count, "use DataGrid, RecordTable, GroupedTable or DocumentTable").toBeLessThanOrEqual(DIV_TABLE_CEILING);
  });
});
