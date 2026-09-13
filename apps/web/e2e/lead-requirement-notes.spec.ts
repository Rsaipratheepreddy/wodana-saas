import { expect, test } from '@playwright/test';
import { leadsPageFixture } from '../lib/crm/leads';
import type { RequirementNote } from '../lib/crm/note-document';

test('lead requirement notes use cards and a full-width form on desktop and mobile', async ({ page }, testInfo) => {
  const lead = leadsPageFixture.items[0];
  const longTitle = 'Kitchen storage, utility area and full-height pantry requirements';
  let notes: RequirementNote[] = [{ id: 'note-one', version: 2, title: longTitle, note: 'Deep drawers and a pull-out pantry.', archived: false }];
  const saves: RequirementNote[] = [];
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // Browser-only fixture. No live notes or leads are modified.
  await page.route(`**/api/workspace/crm/data/leads/${lead.id}?**`, route => route.fulfill({ json: lead }));
  await page.route(`**/api/workspace/crm/data/leads/${lead.id}/requirement-notes?**`, async route => {
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON(); saves.push(input);
      notes = [{ ...input, version: input.version + 1 }, ...notes.filter(note => note.id !== input.id)];
    }
    await route.fulfill({ json: { items: notes, canEdit: true } });
  });
  await page.goto('/workspace/crm/leads');
  await page.getByRole('button', { name: `Open ${lead.partyName} — ${lead.title}`, exact: true }).click();
  await page.getByRole('tab', { name: 'Requirement notes', exact: true }).click();
  const card = page.getByRole('article', { name: longTitle });
  await expect(card).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Requirement notes', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('lead-note-cards.png'), animations: 'disabled' });
  const overflow = await card.evaluate(element => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: `Open ${longTitle}`, exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Requirement note', exact: true });
  await expect(form.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(longTitle);
  await expect(form.getByRole('textbox', { name: 'Requirement notes', exact: true })).toHaveJSProperty('tagName', 'TEXTAREA');
  await expect(form.getByRole('toolbar')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('lead-note-form.png'), animations: 'disabled' });
  await form.getByRole('textbox', { name: 'Requirement notes', exact: true }).fill('Deep drawers\nAdd a pantry');
  await form.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByText('Requirement note saved.', { exact: true })).toBeVisible();
  expect(saves[0]).toMatchObject({ id: 'note-one', version: 2, title: longTitle, note: 'Deep drawers\nAdd a pantry' });
  await page.getByRole('button', { name: `Open ${longTitle}`, exact: true }).click();
  await expect(form.getByRole('textbox', { name: 'Requirement notes', exact: true })).toHaveValue('Deep drawers\nAdd a pantry');
  const formOverflow = await form.evaluate(element => element.scrollWidth - element.clientWidth);
  expect(formOverflow).toBeLessThanOrEqual(1);
  await form.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add requirement note', exact: true });
  await add.getByRole('textbox', { name: 'Title', exact: true }).fill('Bedroom');
  await add.getByRole('textbox', { name: 'Requirement notes', exact: true }).fill('Quiet palette');
  await add.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Bedroom' })).toBeVisible();
  expect(saves[1]).toMatchObject({ title: 'Bedroom', version: 0, note: 'Quiet palette' });
  expect(errors).toEqual([]);
});
