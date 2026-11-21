// Admin → Break positions, end to end: an empty list, adding positions, the one default, reordering
// with the keyboard and by dragging, removing, Discard, and what is saved.

import { expect, test, type Page } from '@playwright/test';
import { SLUG, disconnect, makeCompany, removeCompany, signIn } from './fixture';

test.beforeEach(async ({ page }) => {
  await makeCompany();
  await signIn(page);
  await page.addInitScript((slug) => localStorage.setItem('9eye.company', slug), SLUG);
});

test.afterAll(async () => {
  await removeCompany();
  await disconnect();
});

const panel = (page: Page) => page.getByRole('complementary');
const names = (page: Page) => page.getByRole('button', { name: /^Open / });

async function addPosition(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add position' }).first().click();
  await panel(page).getByLabel('Name').fill(name);
}

test('builds the list, keeps one default, reorders, removes and saves', async ({ page }) => {
  await page.goto('/admin/break-positions');
  await expect(page.getByRole('heading', { name: 'Break positions', level: 2 })).toBeVisible();
  await expect(page.getByText('No break positions yet.')).toBeVisible();

  await addPosition(page, 'Commercial');
  // the first position starts as the default
  await expect(page.getByRole('button', { name: 'Open Commercial' })).toContainText('Default');
  await addPosition(page, 'Channel Ident');
  await addPosition(page, 'Promos');
  await panel(page).getByLabel('Price modifier').fill('12.5');
  await expect(page.getByText('3 changes')).toBeVisible();

  // a new default turns the old one off
  await page.getByRole('button', { name: 'Open Channel Ident' }).click();
  await panel(page).getByRole('switch', { name: 'Default position' }).click();
  await expect(page.getByRole('button', { name: 'Open Channel Ident' })).toContainText('Default');
  await expect(page.getByRole('button', { name: 'Open Commercial' })).not.toContainText('Default');

  // the keyboard on a grip: Channel Ident goes first
  await page.getByRole('button', { name: 'Move Channel Ident' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(names(page)).toHaveText([/^1Channel Ident/, /^2Commercial/, /^3Promos/]);

  // drag Promos above Commercial
  await page.getByRole('row').filter({ hasText: 'Promos' }).dragTo(page.getByRole('row').filter({ hasText: 'Commercial' }), { targetPosition: { x: 40, y: 4 } });
  await expect(names(page)).toHaveText([/^1Channel Ident/, /^2Promos/, /^3Commercial/]);
  await expect(page.getByRole('button', { name: 'Open Promos' })).toContainText('+12.5 %');

  // a position without a name cannot be saved
  await page.getByRole('button', { name: 'Add position' }).first().click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Remove position' }).click();

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Break positions saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);

  await page.reload();
  await expect(names(page)).toHaveText([/^1Channel Ident.*Default/, /^2Promos/, /^3Commercial/]);

  // remove one, then think again
  await page.getByRole('button', { name: 'Open Commercial' }).click();
  await panel(page).getByRole('button', { name: 'Remove position' }).click();
  await expect(names(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(names(page)).toHaveCount(3);

  // remove it for real
  await page.getByRole('button', { name: 'Open Commercial' }).click();
  await panel(page).getByRole('button', { name: 'Remove position' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Break positions saved')).toBeVisible();
  await page.reload();
  await expect(names(page)).toHaveText([/^1Channel Ident/, /^2Promos/]);
});
