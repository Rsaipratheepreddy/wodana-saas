import { expect, test, type Page, type Route } from "@playwright/test";

const firstChatId = "e2e00000-0000-4000-8000-000000000001";
const secondChatId = "e2e00000-0000-4000-8000-000000000002";

type BrowserChat = Record<string, unknown> & { id: string; messages: Array<Record<string, unknown>> };

function chat(id: string, partyName: string, messages: Array<Record<string, unknown>> = []): BrowserChat {
  return {
    id, messages, version: 1, partyName, subject: "Browser-only WhatsApp test", channel: "whatsapp",
    status: "open", unreadCount: 0, ownerName: "Iglo Administrator", canSend: true,
    whatsappConnected: true, lastInboundAt: new Date().toISOString(), lastMessageAt: new Date().toISOString(),
    lastMessageDirection: "inbound", lastMessageText: String(messages.at(-1)?.bodyText ?? "New chat"),
  };
}

async function routeInbox(page: Page, current: BrowserChat, onMessages?: (route: Route, current: BrowserChat) => Promise<void>) {
  await page.route("**/api/workspace/crm/data/conversations**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith(`/${current.id}/messages`) && onMessages) {
      await onMessages(route, current);
      return;
    }
    if (path.endsWith(`/${current.id}`)) {
      if (route.request().method() === "PATCH") {
        const update = route.request().postDataJSON() as { status?: string };
        current.status = update.status ?? current.status;
        current.version = Number(current.version) + 1;
      }
      await route.fulfill({ json: current });
      return;
    }
    await route.fulfill({ json: { data: [current], nextCursor: null } });
  });
}

// All message content below is browser-only test data. No messages are sent or seeded.
test("compact WhatsApp inbox fits the viewport and distinguishes contact and team messages", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const current = chat(firstChatId, "Noura Haddad", [
    { id: "client", direction: "inbound", status: "received", bodyText: "Could we review the living room concept tomorrow?", createdAt: "2026-09-06T10:00:00Z" },
    { id: "reply", direction: "outbound", status: "delivered", bodyText: "Absolutely. I’ll check the schedule with your sales owner.", createdAt: "2026-09-06T10:02:00Z" },
    { id: "legacy-note", direction: "internal", status: "sent", bodyText: "This old internal note stays out of the client inbox.", createdAt: "2026-09-06T10:03:00Z" },
  ]);
  await routeInbox(page, current);
  await page.goto(`/workspace/crm/conversations?record=${firstChatId}`);

  const history = page.getByRole("log", { name: "Message history" });
  await expect(history.getByRole("article", { name: "Contact message" })).toBeVisible();
  await expect(history.getByRole("article", { name: "Your message" })).toBeVisible();
  await expect(history).not.toContainText("This old internal note");
  await expect(page.getByRole("button", { name: "Private team note" })).toHaveCount(0);

  for (const theme of ["light", "dark"] as const) {
    const themeButton = page.getByRole("button", { name: `Use ${theme} mode` });
    if (await themeButton.count()) await themeButton.click();
    const colors = await history.getByRole("article").evaluateAll((items) => items.map((item) => getComputedStyle(item).backgroundColor));
    expect(new Set(colors).size).toBe(2);
    const incoming = (await history.getByRole("article", { name: "Contact message" }).boundingBox())!;
    const outgoing = (await history.getByRole("article", { name: "Your message" }).boundingBox())!;
    expect(outgoing.x).toBeGreaterThan(incoming.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Send message" })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`inbox-${theme}.png`) });
  }

  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  if (testInfo.project.name === "mobile") await expect(page.getByRole("button", { name: "Back to chats" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("today uses Workspace colors and keeps the customer work view useful on mobile", async ({ page }, testInfo) => {
  await page.goto("/workspace/crm");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Enquiry sources over six months" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "CRM key metrics" }).getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Upcoming reminders" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Enquiry pipeline" })).toBeVisible();
  for (const theme of ["light", "dark"]) {
    const toggle = page.getByRole("button", { name: `Use ${theme} mode` });
    if (await toggle.count()) await toggle.click();
    const today = page.getByRole("region", { name: "Today workspace" });
    const appearance = await today.evaluate((element) => ({ accent: getComputedStyle(element).getPropertyValue("--wd-color-action-primary").trim(), overflow: document.documentElement.scrollWidth - innerWidth }));
    expect(appearance.accent).toBe(theme === "light" ? "#694f7a" : "#d6b9f3");
    expect(appearance.overflow).toBeLessThanOrEqual(1);
    const actionAppearance = await page.getByRole("link", { name: "Add enquiry", exact: true }).evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, image: getComputedStyle(element).backgroundImage }));
    expect(actionAppearance.image).toBe("none");
    expect(actionAppearance.background).toBe(theme === "light" ? "rgb(105, 79, 122)" : "rgb(214, 185, 243)");
    await page.screenshot({ path: testInfo.outputPath(`overview-${theme}.png`), fullPage: true });
  }
  const search = page.getByRole("searchbox", { name: "Search today" });
  await search.fill("no matching customer in browser test");
  await expect(page.getByText("No reminders match your search.")).toBeVisible();
});

test("WhatsApp Enter and send button save once, preserve failures, and never fake delivery", async ({ page }) => {
  const messages: Array<Record<string, unknown>> = [];
  const current = chat(secondChatId, "Test client", messages);
  let posts = 0;
  let failNext = false;
  let release!: () => void;
  let gate: Promise<void> | undefined;
  await routeInbox(page, current, async (route) => {
    expect(route.request().method()).toBe("POST");
    posts++;
    if (gate) await gate;
    if (failNext) {
      failNext = false;
      await route.fulfill({ status: 503, json: { message: "Could not queue test reply. Try again." } });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ direction: "outbound", purpose: "service", bodyText: expect.any(String), clientMessageId: expect.any(String) });
    messages.push({ ...body, id: `reply-${posts}`, status: "sent", createdAt: new Date().toISOString() });
    current.version = Number(current.version) + 1;
    await route.fulfill({ json: messages.at(-1) });
  });
  await page.goto(`/workspace/crm/conversations?record=${secondChatId}`);
  const input = page.getByRole("textbox", { name: "Message" });
  await input.fill("First line");
  await input.press("Shift+Enter");
  await input.pressSequentially("Second line");
  await expect(input).toHaveValue("First line\nSecond line");

  gate = new Promise<void>((resolve) => { release = resolve; });
  await input.press("Enter");
  await input.press("Enter");
  await expect.poll(() => posts).toBe(1);
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  release();
  gate = undefined;
  await expect(page.getByRole("article", { name: "Your message" })).toContainText("First line\nSecond line");
  await expect(page.getByLabel("Sent")).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();

  failNext = true;
  await input.fill("Keep this failed draft");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Could not queue test reply. Try again.", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("Keep this failed draft");
  await input.press("Enter");
  await expect(page.getByRole("article", { name: "Your message" })).toHaveCount(2);
  await expect(input).toHaveValue("");
  expect(posts).toBe(3);
});

test("Woddy shows avatar replies and typing dots in the Workspace theme", async ({ page }, testInfo) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route("**/api/workspace/crm/chat", async (route) => { calls++; await gate; await route.fulfill({ json: { answer: "Start with your overdue customer follow-ups. Open the linked lead to review its next action." } }); });
  await page.goto("/workspace/crm");
  await page.getByRole("button", { name: "Ask Woddy" }).click();
  const dialog = page.getByRole("dialog", { name: "Woddy chat" });
  const input = dialog.getByRole("textbox", { name: "Message Woddy" });
  await input.fill("What should I do next?");
  await input.press("Enter");
  await expect(dialog.getByRole("status", { name: "Woddy is typing" })).toBeVisible();
  await expect(dialog.getByRole("log").getByRole("img", { name: "Woddy" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("woddy-typing.png"), animations: "disabled" });
  release();
  await expect(dialog.getByRole("article", { name: "Woddy reply" })).toContainText("Start with your overdue");
  await expect(input).toBeFocused();
  expect(calls).toBe(1);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const appearance = await dialog.evaluate((element) => ({ accent: getComputedStyle(element).getPropertyValue("--wd-color-action-primary").trim(), overflow: document.documentElement.scrollWidth - innerWidth }));
    expect(appearance.accent).toBe(theme === "light" ? "#694f7a" : "#d6b9f3");
    expect(appearance.overflow).toBeLessThanOrEqual(1);
    await expect(dialog.getByRole("button", { name: "Send message to Woddy" })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`woddy-${theme}.png`) });
  }
});
