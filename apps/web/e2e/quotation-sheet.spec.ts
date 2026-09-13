import { expect, test } from "@playwright/test";

test("compact table, materials modal, standard unit menus and variant editing", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (url.includes("kind=variant")) {
      expect(url).toContain("linkedTo=workstation-model");
      return route.fulfill({
        json: {
          items: [
            {
              id: "premium",
              name: "Premium oak",
              code: "PREM",
              kind: "variant",
              version: 1,
              catalogId: "catalog",
            },
          ],
          templates: [],
        },
      });
    }
    return route.fulfill({
      json: {
        items: url.includes("kind=unit")
          ? [
              {
                id: "sheet",
                name: "Sheet",
                code: "SHEET",
                kind: "unit",
                configuration: { symbol: "sheet" },
                version: 1,
                catalogId: "catalog",
              },
            ]
          : [],
        templates: [],
      },
    });
  });
  await page.goto("/testing/quotation");
  const sheet = page.getByRole("region", {
    name: "Editable quotation table",
    exact: true,
  });
  if (testInfo.project.name === "mobile")
    await expect(
      sheet.locator('td[data-label="Materials"]').first(),
    ).toBeVisible();
  else
    await expect(
      sheet.getByRole("columnheader", { name: "Materials", exact: true }),
    ).toBeVisible();
  await expect(sheet.locator("textarea")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Materials for Workstations", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Materials", exact: true });
  await expect(dialog).toBeVisible();
  await page
    .getByLabel("Material name l1-1", { exact: true })
    .fill("Cancelled");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByLabel("Description for Workstations", { exact: true }),
  ).toContainText("Plywood");
  await page
    .getByRole("button", { name: "Materials for Workstations", exact: true })
    .click();
  await page
    .getByLabel("Material name l1-1", { exact: true })
    .fill("Walnut veneer");
  await page
    .getByLabel("Specification for Walnut veneer", { exact: true })
    .fill("Natural grain, 18 mm");
  await page.getByRole("button", { name: /Type for Walnut veneer/ }).click();
  await page.getByRole("option", { name: "Finish", exact: true }).click();
  await page
    .getByRole("button", { name: /Unit for material Walnut veneer/ })
    .click();
  await page.getByRole("option", { name: "m²", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("materials-modal.png"),
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Apply materials", exact: true })
    .click();
  await expect(
    page.getByLabel("Description for Workstations", { exact: true }),
  ).toContainText("Walnut veneer · Natural grain, 18 mm");
  await page.getByRole("button", { name: /Unit for Workstations/ }).click();
  await page.getByRole("option", { name: "sheet", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Unit for Workstations/ }),
  ).toContainText("sheet");
  await page.getByRole("button", { name: /Unit for Workstations/ }).click();
  await page.getByRole("option", { name: "Custom unit…", exact: true }).click();
  await page.getByLabel("Unit name", { exact: true }).fill("bag");
  await page.getByRole("button", { name: "Apply unit", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Choose variant for Workstations",
      exact: true,
    })
    .click();
  await page
    .getByRole("combobox", { name: "Search catalog", exact: true })
    .fill("Premium");
  await page.getByRole("option", { name: /Premium oak/ }).click();
  await expect(
    page.getByRole("button", {
      name: "Choose variant for Workstations",
      exact: true,
    }),
  ).toContainText("Premium oak");
  await expect(
    page.getByLabel("Rate for Workstations", { exact: true }),
  ).toHaveValue("1800.00");
  await page
    .getByRole("button", {
      name: "Choose variant for Workstations",
      exact: true,
    })
    .click();
  await page.getByLabel("Custom variant", { exact: true }).fill("Custom oak");
  await page
    .getByRole("button", { name: "Apply variant", exact: true })
    .click();
  await page.getByRole("button", { name: "Save fixture", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Reopen fixture", exact: true })
    .click();
  await expect(
    page.getByLabel("Description for Workstations", { exact: true }),
  ).toContainText("Walnut veneer · Natural grain, 18 mm");
  await expect(
    page.getByRole("button", { name: /Unit for Workstations/ }),
  ).toContainText("bag");
  await expect(
    page.getByRole("dialog", { name: "Materials", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await page
    .getByLabel("Message Woody", { exact: true })
    .fill("Keep this draft request");
  await page
    .getByRole("button", { name: "Close AI assistant", exact: true })
    .click();
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await expect(page.getByLabel("Message Woody", { exact: true })).toHaveValue(
    "Keep this draft request",
  );
  await page
    .getByRole("button", { name: "Close AI assistant", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("quotation-final.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Preview quotation", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Quotation document", exact: true }),
  ).toContainText("Walnut veneer · Natural grain, 18 mm");
  expect(errors).toEqual([]);
});

test("quotation sheet edits, prices, catalog selections, photos and preview on desktop and mobile", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: {
        items: route.request().url().includes("kind=material")
          ? [
              {
                id: "oak",
                name: "Oak veneer",
                code: "OAK",
                kind: "material",
                catalogId: "c",
                version: 1,
              },
            ]
          : [],
        templates: [],
      },
    }),
  );
  await page.goto("/testing/quotation");
  await expect(
    page.getByRole("heading", { name: "Quotation builder", exact: true }),
  ).toBeVisible();
  const table = page.getByRole("region", { name: "Editable quotation table" });
  if (testInfo.project.name === "mobile")
    await expect(table.locator('td[data-label="Photo"]').first()).toBeVisible();
  else
    await expect(
      table.getByRole("columnheader", { name: "Photo", exact: true }),
    ).toBeVisible();
  await page
    .getByLabel("Search quotation rooms", { exact: true })
    .fill("Workplace");
  await expect(page.getByLabel("Item name l2", { exact: true })).toHaveCount(0);
  await page.getByLabel("Search quotation rooms", { exact: true }).fill("");
  await page.screenshot({
    path: testInfo.outputPath("quotation-sheet.png"),
    animations: "disabled",
  });
  await expect(
    page.getByLabel("Rate for material Plywood", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Materials for Workstations", exact: true })
    .click();
  await page
    .getByLabel("Rate for material Plywood", { exact: true })
    .fill("100");
  await page.getByLabel("Rate for material Plywood", { exact: true }).blur();
  await page
    .getByRole("button", { name: "Apply materials", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Quotation pricing and terms" }),
  ).toContainText("7,203.00");
  await page
    .getByRole("button", { name: "Materials for Workstations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add material to Workstations", exact: true })
    .click();
  await page
    .getByLabel("Material name l1-4", { exact: true })
    .fill("Cable tray");
  await page.getByLabel("Material name l1-4", { exact: true }).blur();
  await page
    .getByLabel("Rate for material Cable tray", { exact: true })
    .fill("50");
  await page.getByLabel("Rate for material Cable tray", { exact: true }).blur();
  await page
    .getByRole("button", {
      name: "Select material for Workstations",
      exact: true,
    })
    .click();
  await page
    .getByRole("combobox", { name: "Search catalog", exact: true })
    .fill("Oak");
  await page.getByRole("option", { name: /Oak veneer/ }).click();
  await expect(
    page.getByLabel("Material name l1-5", { exact: true }),
  ).toHaveValue("Oak veneer");
  await page
    .getByRole("button", { name: "Apply materials", exact: true })
    .click();
  await page
    .getByLabel("Upload photo for Workstations", { exact: true })
    .setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(
    page.getByRole("link", {
      name: "View photo for Workstations",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save fixture", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Reopen fixture", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Materials for Workstations", exact: true })
    .click();
  await expect(
    page.getByLabel("Material name l1-4", { exact: true }),
  ).toHaveValue("Cable tray");
  await expect(
    page.getByRole("link", {
      name: "View photo for Workstations",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("quotation-materials.png"),
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Apply materials", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Materials", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Add room / section", exact: true })
    .click();
  await page.getByLabel("Area / room name", { exact: true }).fill("Delivery");
  await page.getByRole("button", { name: "Save section", exact: true }).click();
  await page
    .getByRole("button", { name: "Add item to Delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preview quotation", exact: true })
    .click();
  const preview = page.getByRole("article", {
    name: "Quotation document",
    exact: true,
  });
  await expect(
    preview.getByRole("table", {
      name: "Materials for Workstations",
      exact: true,
    }),
  ).toContainText("Cable tray");
  await expect(
    preview.getByRole("img", { name: "Workstations", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("quotation-preview.png"),
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("header, manual editing and AI work together with explicit review and safe retries", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let requests = 0;
  const choice = (id: string, name: string, kind = "work") => ({
    id,
    name,
    kind,
    code: id,
    version: 1,
    catalogId: "catalog",
  });
  await page.route("**/api/**", async (route) => {
    if (!route.request().url().includes("quotation-assist"))
      return route.fulfill({ json: { items: [], templates: [] } });
    requests++;
    const body = route.request().postDataJSON();
    expect(
      body.currentRooms.find(
        (room: { name: string }) => room.name === "Workplace",
      ).selected,
    ).toBe(true);
    if (requests === 1)
      return route.fulfill({
        status: 503,
        json: {
          message:
            "Assistant temporarily unavailable. Your quotation is unchanged.",
        },
      });
    return route.fulfill({
      json: {
        summary: "Add storage to the existing Workplace.",
        rooms: [
          {
            id: "r1",
            name: "Workplace",
            room: choice("r1", "Workplace", "room"),
            reason: "Based on requirements",
            sourceIds: ["brief"],
            items: [
              {
                work: choice("work", "Workstations"),
                variant: null,
                materials: [],
                reason: "Already in the quotation",
                sourceIds: ["brief"],
              },
              {
                work: choice("storage", "Storage cabinet"),
                variant: null,
                materials: [choice("oak", "Oak veneer", "material")],
                reason: "Storage requirement",
                sourceIds: ["brief"],
              },
            ],
          },
        ],
        sources: {
          requirements: 2,
          inspirations: 0,
          layouts: 0,
          measurements: 0,
        },
        filesAnalyzed: 0,
        notes: [],
        review: [],
        coverage: { total: 2, linked: 2 },
        analyzedAt: new Date().toISOString(),
      },
    });
  });
  await page.goto("/testing/quotation");
  await expect(page.getByLabel("Quotation title", { exact: true })).toHaveValue(
    "Office fit-out proposal",
  );
  await expect(
    page.getByLabel("Quotation location", { exact: true }),
  ).toHaveValue("Sample site");
  await page
    .getByLabel("Quotation title", { exact: true })
    .fill("Final office proposal");
  await page.getByLabel("Rate for Workstations", { exact: true }).fill("2000");
  await page.getByLabel("Rate for Workstations", { exact: true }).blur();
  await expect(
    page.getByRole("button", {
      name: "Materials for Workstations",
      exact: true,
    }),
  ).toHaveAttribute("aria-haspopup", "dialog");
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await page.getByRole("button", { name: /AI room context/ }).click();
  await page.getByRole("option", { name: "Workplace", exact: true }).click();
  await page
    .getByLabel("Message Woody", { exact: true })
    .fill("Suggest storage for this room");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page
      .getByRole("complementary", { name: "AI quotation assistant" })
      .getByRole("alert"),
  ).toContainText("temporarily unavailable");
  await expect(
    page.getByLabel("Rate for Workstations", { exact: true }),
  ).toHaveValue("2000.00");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("button", { name: "Review room suggestions", exact: true })
    .click();
  await expect(
    page.getByLabel("Rate for Storage cabinet", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add selected items", exact: true })
    .click();
  await expect(
    page.getByLabel("Rate for Storage cabinet", { exact: true }),
  ).toHaveValue("0.00");
  await expect(
    page.getByLabel("Rate for Workstations", { exact: true }),
  ).toHaveValue("2000.00");
  await expect(
    page.getByLabel("Quantity for Workstations", { exact: true }),
  ).toHaveValue("3");
  await expect(page.getByLabel("Item name l1", { exact: true })).toHaveValue(
    "Workstations",
  );
  await expect(
    page.getByRole("button", {
      name: "Materials for Storage cabinet",
      exact: true,
    }),
  ).toHaveAttribute("aria-haspopup", "dialog");
  await page.getByRole("button", { name: "Save fixture", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Reopen fixture", exact: true })
    .click();
  await expect(page.getByLabel("Quotation title", { exact: true })).toHaveValue(
    "Final office proposal",
  );
  await expect(
    page.getByLabel("Rate for Storage cabinet", { exact: true }),
  ).toHaveValue("0.00");
  await expect(
    page.getByLabel("Rate for Workstations", { exact: true }),
  ).toHaveValue("2000.00");
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await page
    .getByRole("complementary", { name: "AI quotation assistant" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("quotation-ai.png"),
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
