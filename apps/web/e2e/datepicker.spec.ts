// The shared date picker (docs/design/date-picker.md) where it is used today: Templates (whole-week
// ranges) and Channel settings (the day of the export file name).

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

async function openTemplates(page: Page) {
  await page.goto('/templates');
  await page.getByRole('button', { name: /^Channel:/ }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: /^E2E TV/ }).click();
  await expect(page.getByRole('button', { name: 'Channel: E2E TV' })).toBeVisible();
}

test('a whole-week range: typed, then picked on the calendar with two clicks', async ({ page }) => {
  await openTemplates(page);
  await page.getByRole('button', { name: 'Change dates' }).click();
  const pop = page.getByRole('dialog', { name: 'Valid dates' });
  const from = pop.getByLabel('Valid dates, from');
  await expect(from).toHaveValue('23 Mar 2024');
  await expect(page.getByRole('grid')).toBeHidden(); // opening the popover does not open the calendar

  // a wrong day says what is wrong and keeps the text
  await from.fill('31/9/2026');
  await from.press('Enter');
  await expect(pop.getByText('There is no 31 September 2026.')).toBeVisible();
  await from.fill('17 Oct 2026');
  await from.press('Enter');
  await expect(from).toHaveValue('17 Oct 2026');

  await pop.getByRole('button', { name: 'Open calendar' }).click();
  const cal = page.getByRole('dialog', { name: 'Valid dates calendar' });
  await expect(cal.getByRole('grid', { name: 'October 2026' })).toBeVisible();
  await expect(cal.getByRole('columnheader').first()).toHaveAccessibleName('Saturday'); // the channel's week
  await cal.getByRole('gridcell', { name: /^Wednesday 21 October 2026/ }).click();
  await expect(cal.getByText(/From 17 Oct 2026\. Now pick the last day/)).toBeVisible();
  await cal.getByRole('gridcell', { name: /^Tuesday 3 November 2026/ }).click();
  await expect(cal).toBeHidden();
  await expect(pop.getByLabel('Valid dates, to')).toHaveValue('6 Nov 2026');
  await pop.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Valid 17 Oct 2026 → 6 Nov 2026')).toBeVisible();
});

test('the keyboard: Down opens the calendar, arrows move, Enter picks, Escape closes', async ({ page }) => {
  await openTemplates(page);
  await page.getByRole('button', { name: 'Change dates' }).click();
  const pop = page.getByRole('dialog', { name: 'Valid dates' });
  const to = pop.getByLabel('Valid dates, to');
  await to.fill('29 Oct 2026');
  await to.press('Enter');
  await expect(to).toHaveValue('30 Oct 2026'); // the end of its week
  await to.press('ArrowDown');
  const grid = page.getByRole('grid', { name: 'October 2026' });
  await expect(grid).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(grid).toBeHidden();
  await expect(pop).toBeVisible();
});

test('channel settings: the export file name follows the picked broadcast day', async ({ page }) => {
  await page.goto('/admin/channels');
  await page.getByRole('link', { name: 'E2E EMPTY settings' }).click();
  await page.getByLabel('Default export').selectOption('bxf');
  const card = page.getByRole('region', { name: 'Export file name' });
  const fileDay = async () => /BXF(\d{8})_/.exec((await card.textContent()) ?? '')?.[1];
  const today = await fileDay();
  expect(today).toMatch(/^\d{8}$/);
  const next = (ymd: string, n: number) => {
    const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n));
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  };
  await expect(card.getByText('Today', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Next day' }).click();
  await expect(card).toContainText(`BXF${next(today!, 1)}_E2EEMPTY.xml`);
  await card.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(card).toContainText(`BXF${today}_E2EEMPTY.xml`);
  // keyboard: the calendar opens on the picked day; two days right, Enter
  await card.getByRole('button', { name: /^Pick day, current/ }).click();
  await expect(page.getByRole('grid')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(card).toContainText(`BXF${next(today!, 2)}_E2EEMPTY.xml`);
});
