import { test, expect } from "@playwright/test";
import { designData, designItems, designOptions } from "./fixtures/design-data";
const preview =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#fafaf8"/><g fill="none" stroke="#52645e" stroke-width="5"><path d="M100 100H700V500H100Z M440 100V310H700 M100 370H295 M395 370H440V500"/><rect x="155" y="165" width="140" height="65"/><rect x="510" y="160" width="120" height="75"/><path d="M295 370V270A100 100 0 0 1 395 370" stroke-width="1"/><path d="M100 70H700M100 60V80M700 60V80" stroke-width="1"/></g><g font-family="Arial" font-size="18" fill="#52645e"><text x="350" y="60">6,000 mm</text><text x="170" y="290">RECEPTION</text><text x="507" y="270">MEETING</text><text x="480" y="430">LOUNGE</text><text x="100" y="550" font-size="13">SAMPLE DESIGN · R1 · FOR REVIEW</text></g></svg>';
test("designer workspace: folders, review, remarks, revisions and portal decision", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let items = structuredClone(designItems);
  const folders = structuredClone(designOptions.folders);
  await page.route("**/api/workspace/pre-projects/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    if (path.includes("/assets/")) {
      if (req.method() === "POST")
        return route.fulfill({
          json: {
            id: "revised-asset",
            name: "reception-r2.png",
            mimeType: "image/png",
            hasPreview: true,
            byteSize: 2000,
          },
        });
      return route.fulfill({ contentType: "image/svg+xml", body: preview });
    }
    if (path.endsWith("/brief")) return route.fulfill({ json: designData });
    if (path.endsWith("/design-folders")) {
      const input = req.postDataJSON();
      const f = { ...input, version: 1 };
      folders.push(f);
      return route.fulfill({ json: f });
    }
    if (path.endsWith("/designs") && req.method() === "GET")
      return route.fulfill({ json: { ...designOptions, folders, items } });
    const input = req.postDataJSON();
    const id = path.endsWith("/designs") ? input.id : path.split("/").at(-2);
    let d = items.find((d) => d.id === id)!;
    if (path.endsWith("/activity")) {
      d = {
        ...d,
        version: d.version + 1,
        versions: d.versions.map((v, i) =>
          i === 0 && input.action !== "comment"
            ? {
                ...v,
                status: input.action,
                reviewerId: input.reviewerId ?? v.reviewerId,
              }
            : v,
        ),
        activity: [
          ...d.activity,
          {
            ...input,
            createdAt: new Date().toISOString(),
            createdByName: "Alex Morgan",
          },
        ],
      };
    } else if (path.endsWith("/versions")) {
      d = {
        ...d,
        version: d.version + 1,
        description: input.note,
        versions: [
          {
            ...d.versions[0],
            id: input.id,
            number: d.versions[0].number + 1,
            status: "draft",
            note: input.note,
            asset: {
              ...d.versions[0].asset,
              id: input.assetId,
              name: "reception-r2.png",
            },
          },
          ...d.versions,
        ],
      };
    } else if (path.endsWith("/designs"))
      d = {
        ...d,
        ...input,
        archivedAt: input.archived ? new Date().toISOString() : null,
        version: d.version + 1,
      };
    items = items.map((row) => (row.id === d.id ? d : row));
    return route.fulfill({ json: d });
  });
  await page.goto("/testing/designs");
  await page
    .getByRole("searchbox", { name: "Search designs", exact: true })
    .fill("Reception");
  await expect(
    page.getByRole("button", { name: "Open folder Reception", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search designs", exact: true })
    .fill("");
  await expect(page.getByRole("tab", { name: /^Designs/ })).toContainText("5");
  await page.screenshot({
    path: testInfo.outputPath("design-library.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page
    .getByRole("button", { name: "Choose a room Room", exact: true })
    .click();
  await page.getByRole("option", { name: "Workplace", exact: true }).click();
  await page
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open folder Workplace", exact: true }),
  ).toBeVisible();
  expect(page.url()).not.toContain("folder=");
  await page
    .getByRole("button", { name: "Open folder Reception", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open Reception joinery.png",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open Reception layout.png", exact: true })
    .click();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Note", exact: true })
    .fill("Confirm the entrance clearance.");
  await page.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(
    page.getByText("Confirm the entrance clearance.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Add a comment", exact: true })
    .fill("Check door swing before approval.");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: "Check door swing before approval." }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("design-file.png"),
    animations: "disabled",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Send for review", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I checked the preview and it matches this folder, room, item and design type.",
      exact: true,
    })
    .check();
  await page
    .getByRole("dialog", { name: "Send for review", exact: true })
    .getByRole("button", { name: "Send for review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toBeVisible();
  expect(page.url()).toContain("file=layout");
  await page
    .getByRole("button", { name: "Reject / remarks", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Changes needed", exact: true })
    .fill("Increase the door clearance to 900 mm.");
  await page
    .getByRole("dialog", { name: "Reject / remarks", exact: true })
    .getByRole("button", { name: "Reject / remarks", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Upload revised file", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Increase the door clearance to 900 mm.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Upload revised file", exact: true })
    .click();
  await page.getByLabel("Upload design file", { exact: true }).setInputFiles({
    name: "reception-r2.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page
    .getByRole("textbox", { name: "What changed?", exact: true })
    .fill("Door clearance updated to 900 mm.");
  await page
    .getByRole("button", { name: "Save draft revision", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "reception-r2.png", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Send for review", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I checked the preview and it matches this folder, room, item and design type.",
      exact: true,
    })
    .check();
  await page
    .getByRole("dialog", { name: "Send for review", exact: true })
    .getByRole("button", { name: "Send for review", exact: true })
    .click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Approve", exact: true })
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Send to client", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Send to client", exact: true })
    .getByRole("button", { name: "Send to client", exact: true })
    .click();
  await expect(
    page.getByText(
      "Waiting for the client’s decision in their portal. This screen updates automatically.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  // The authenticated portal decision is independently verified by portal UI/service tests.
  items = items.map((d) =>
    d.id === "layout"
      ? {
          ...d,
          version: d.version + 1,
          versions: [
            { ...d.versions[0], status: "approved" },
            ...d.versions.slice(1),
          ],
          activity: [
            ...d.activity,
            {
              id: "client-decision",
              versionId: d.versions[0].id,
              action: "approved",
              note: "Approved as shown.",
              decisionBy: "Sample Client",
              createdAt: new Date().toISOString(),
              createdByName: "Client portal",
            },
          ],
        }
      : d,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText(
      "Approved by the client. This revision and its decision are kept in history.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(page.url()).toContain("file=layout");
  await page
    .getByRole("button", { name: "Back to files", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open Reception layout.png",
      exact: true,
    }),
  ).toContainText("Approved");
  await page.getByRole("tab", { name: /^Approved/ }).click();
  await expect(
    page.getByRole("button", {
      name: "Open Reception layout.png",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Internal approval/ }).click();
  await page.screenshot({
    path: testInfo.outputPath("design-review-queue.png"),
    animations: "disabled",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Open Lighting layout.png", exact: true }),
  ).toContainText("Ready to send to client");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page
    .getByRole("button", { name: "Open Reception joinery.png", exact: true })
    .click();
  await page.getByRole("button", { name: "File actions", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Archive file", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Archive file", exact: true })
    .getByRole("button", { name: "Archive file", exact: true })
    .click();
  await expect(
    page.getByText("Archived. Restore this file to continue working on it.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to files", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Open Reception joinery.png",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /^Designs/ }).click();
  await page.getByRole("checkbox", { name: "Archived", exact: true }).focus();
  await page.getByRole("checkbox", { name: "Archived", exact: true }).press("Space");
  await expect(page.getByRole("checkbox", { name: "Archived", exact: true })).toBeChecked();
  await page
    .getByRole("button", { name: "Open folder Reception", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open Reception joinery.png", exact: true })
    .click();
  await page.getByRole("button", { name: "File actions", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Restore file", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Restore file", exact: true })
    .getByRole("button", { name: "Restore file", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
