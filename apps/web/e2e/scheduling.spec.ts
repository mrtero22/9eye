// The Scheduling page, end to end (docs/design/scheduling-page.md "Done when"): the order list, one
// order (first airings, repeats, copy week, undo / redo, save), promos, a new order with the shared
// catalog picker, a programmes-mode order on a main-only channel and a drop-frame channel.

import { expect, test, type Page } from '@playwright/test';
import { addDays } from '@9eye/core';
import { SLUG, disconnect, makeCompany, removeCompany, schedToday, signIn } from './fixture';

test.beforeEach(async ({ page }) => {
  await makeCompany();
  await signIn(page);
  await page.addInitScript((slug) => localStorage.setItem('9eye.company', slug), SLUG);
});

test.afterAll(async () => {
  await removeCompany();
  await disconnect();
});

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return `${WD[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`;
};
/** A week-grid cell by day and clock time. */
const cell = (page: Page, date: string, clock: string) => page.getByRole('button', { name: new RegExp(`^${shortDay(date)} ${clock} · `) });
const side = (page: Page, name: string) => page.getByRole('complementary', { name });

async function openList(page: Page, channel: string) {
  await page.goto('/scheduling');
  await page.getByRole('button', { name: /^Channel:/ }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: new RegExp(`^${channel}`) }).click();
  await expect(page.getByRole('button', { name: `Channel: ${channel}` })).toBeVisible();
}

async function openOrder(page: Page, name: string) {
  await openList(page, 'E2E SCHED');
  await page.getByRole('row', { name: `Open ${name}` }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test('the list: plans grouped by mode with this week, status, filters and their first issue', async ({ page }) => {
  await openList(page, 'E2E SCHED');
  await expect(page.getByText('Week starts Saturday · day starts 09:00 · 25 fps')).toBeVisible();
  const table = page.getByRole('table', { name: 'Plans' });
  await expect(table.getByText('· episodes in list order')).toBeVisible();
  await expect(table.getByText('· trailers, idents and music clips')).toBeVisible();
  const harbor = page.getByRole('row', { name: 'Open Harbor - E2E' });
  await expect(harbor).toContainText('Sat Mon Wed · 15:00');
  await expect(harbor).toContainText('Ep. 4–6 · 3 first, 9 repeats');
  await expect(harbor).toContainText('3 of 12 aired');
  await expect(page.getByRole('row', { name: 'Open Lumen Plus idents - E2E' })).toContainText('2 plays a block');
  await expect(page.getByRole('row', { name: 'Open Lumen Plus idents - E2E' })).toContainText('Every day, every block');
  const bright = page.getByRole('row', { name: 'Open Bright Lanes - E2E' });
  await expect(bright).toContainText('Draft');
  await expect(bright.getByRole('cell').nth(6)).not.toBeEmpty();

  await page.getByRole('button', { name: /^Trailers/ }).click();
  await expect(harbor).toBeHidden();
  await expect(page.getByRole('row', { name: 'Open Lumen Plus idents - E2E' })).toBeVisible();
  await page.getByRole('button', { name: /^All/ }).first().click();
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Draft' }).click();
  await expect(page.getByRole('row', { name: /^Open / })).toHaveCount(1);
  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'All' }).click();
  await page.getByRole('button', { name: /^Needs attention/ }).click();
  await expect(bright).toBeVisible();
  await page.getByRole('button', { name: /^Needs attention/ }).click();
  await page.getByLabel('Search plans').fill('harbor');
  await expect(page.getByRole('row', { name: /^Open / })).toHaveCount(1);
  await harbor.click();
  await expect(page.getByRole('heading', { name: 'Harbor - E2E', level: 1 })).toBeVisible();
});

test('one plan: a first airing and its repeat, undo / redo, copy the week, save', async ({ page }) => {
  const { week } = schedToday();
  await openOrder(page, 'Harbor - E2E');
  await expect(page.getByText('3 of 12 aired · 3 first airings this week')).toBeVisible();
  const friday = addDays(week, 6);
  await cell(page, friday, '15:00').click();
  const block = side(page, 'Block');
  await expect(block.getByRole('heading', { name: '1H Run Block' })).toBeVisible();
  await expect(block.getByText('No programme in this block from any plan.')).toBeVisible();
  await block.getByRole('button', { name: 'Add first airing' }).click();
  await expect(block.getByText('Harbor Nights - 7')).toBeVisible();
  await expect(block.getByText('First airing · episode 7 of 12')).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  await block.getByRole('button', { name: 'Add repeat' }).click();
  const add = page.getByRole('dialog', { name: 'Add a repeat' });
  await add.getByLabel('When').selectOption({ label: '+1 day' });
  await add.getByLabel('Block').selectOption({ label: '11:00 · 1H Day Block' });
  await add.getByRole('button', { name: 'Add' }).click();
  await expect(block.getByText('+1 day')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(block.getByText('+1 day')).toBeHidden();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(block.getByText('No programme in this block from any plan.')).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(block.getByText('+1 day')).toBeVisible();

  await page.getByRole('button', { name: 'Copy week to the whole plan' }).click();
  const copy = page.getByRole('dialog', { name: 'Copy week to the whole plan' });
  await expect(copy.getByText(/^Complete week: /)).toBeVisible();
  await expect(copy.getByText('4 first airings and 9 repeats in this week')).toBeVisible();
  await expect(copy.getByText(/^After copying: 12 first airings/)).toBeVisible();
  await expect(copy.getByText(/Episodes 1–12/)).toBeVisible();
  await copy.getByRole('button', { name: 'Copy to 4 weeks' }).click();
  await expect(page.getByText('Week copied to 4 weeks')).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toBeHidden();
  await page.reload();
  await expect(page.getByText('4 of 12 aired · 4 first airings this week')).toBeVisible();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(cell(page, addDays(week, 7), '15:00')).toHaveAccessibleName(/Harbor Nights - 9, first airing/);
  await expect(cell(page, addDays(week, 13), '15:00')).toHaveAccessibleName(/Harbor Nights - 12, first airing/);
});

test('repeats: what a block repeats is changed from the days before it', async ({ page }) => {
  const { week } = schedToday();
  await openOrder(page, 'Harbor - E2E');
  const wed = addDays(week, 4);
  await cell(page, wed, '23:00').click();
  const block = side(page, 'Block');
  await expect(block.getByText('Repeat of Harbor Nights - 6')).toBeVisible();
  await expect(block.getByText(/same broadcast day/)).toBeVisible();
  await block.getByRole('button', { name: 'Change what it repeats…' }).click();
  const pick = page.getByRole('dialog', { name: 'Repeat which first airing?' });
  await pick.getByRole('button', { name: /Harbor Nights - 5/ }).click();
  await expect(block.getByText('Repeat of Harbor Nights - 5')).toBeVisible();
  await expect(block.getByText(/\+2 days/)).toBeVisible();
  await block.getByRole('button', { name: 'Open first airing' }).click();
  await expect(block.getByText('First airing · episode 5 of 12')).toBeVisible();
  await expect(block.getByText(/^Repeats/)).toBeVisible();
});

test('trailers: plays in a block and a rotation over the plan', async ({ page }) => {
  const { week } = schedToday();
  await openOrder(page, 'Lumen Plus idents - E2E');
  await expect(cell(page, week, '15:00')).toContainText('2×');
  await cell(page, week, '15:00').click();
  const block = side(page, 'Block');
  await block.getByRole('button', { name: 'More plays' }).click();
  await expect(cell(page, week, '15:00')).toContainText('3×');
  await block.getByRole('button', { name: 'Plan details' }).click();

  await side(page, 'Plan details').getByRole('button', { name: 'Rotation…' }).click();
  const rot = page.getByRole('dialog', { name: 'Rotation' });
  await rot.getByLabel(/Plays per day/).fill('15');
  await rot.getByRole('button', { name: 'Equal shares' }).click();
  await expect(rot.getByText('100 %', { exact: true })).toBeVisible();
  await rot.getByRole('button', { name: 'Place' }).click();
  await expect(page.getByText(/^Placed 15 plays a day on 21 days/)).toBeVisible();
  await expect(cell(page, addDays(week, 1), '11:00')).toContainText('3×');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});

test('new plan: pick a series from the catalog, see the free blocks, create the draft', async ({ page }) => {
  await openList(page, 'E2E SCHED');
  await page.getByRole('button', { name: 'New plan' }).click();
  await expect(page.getByRole('heading', { name: 'New plan', level: 1 })).toBeVisible();
  await page.getByLabel('Name').fill('Spider Noir - E2E');
  await page.getByRole('button', { name: 'Pick from Media…' }).click();
  const picker = page.getByRole('dialog', { name: 'Pick the series' });
  await expect(picker.getByRole('option', { name: /TV Series Drama/ })).toBeVisible();
  await picker.getByRole('option', { name: /^Harbor Nights/ }).click();
  await expect(picker.getByText('12 episodes · 1 layout episode hidden · 1 without a length')).toBeVisible();
  await expect(picker.getByText('No length in Media')).toBeVisible();
  await picker.getByRole('option', { name: /^Spider Noir/ }).click();
  await expect(picker.getByText('Spider Noir · 4 episodes (1–4)')).toBeVisible();
  await picker.getByRole('button', { name: 'Use 4 episodes' }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByText('4 episodes · 3 h 20 min known')).toBeVisible();
  await expect(page.getByText('Spider Noir - 4')).toBeVisible();

  // Add from catalog marks what the order already has
  await page.getByRole('button', { name: 'Add from Media' }).click();
  const more = page.getByRole('dialog', { name: 'Add more' });
  await expect(more.getByRole('option', { name: /Spider Noir - 1/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(more.getByText('All 4 episodes of Spider Noir are already in this plan.', { exact: false })).toBeVisible();
  await more.getByRole('button', { name: 'Cancel' }).click();

  const { week } = schedToday();
  const grid = page.getByRole('region', { name: 'Week' });
  await expect(grid.getByRole('button', { name: new RegExp(`^${shortDay(week)} 15:00 · 1H Run Block · Harbor - E2E`) })).toBeVisible();
  await expect(grid.getByText('Free').first()).toBeVisible();
  await page.getByRole('group', { name: 'What to show' }).getByRole('button', { name: 'Empty' }).click();
  await expect(grid.getByText('1H Run Block').first()).toBeVisible();

  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('heading', { name: 'Spider Noir - E2E', level: 1 })).toBeVisible();
  await expect(page.getByText('0 of 4 aired · 0 first airings this week')).toBeVisible();
  await expect(page).toHaveURL(/week=\d{4}-\d{2}-\d{2}/);
});

test('a programmes-mode plan on a main-only channel', async ({ page }) => {
  await openList(page, 'E2E PUBLIC');
  await expect(page.getByText('Week starts Monday · day starts 06:00 · 25 fps')).toBeVisible();
  await page.getByRole('button', { name: 'New plan' }).click();
  await page.getByRole('radio', { name: /^Programmes/ }).click();
  await page.getByLabel('Name').fill('Bright Lanes films - PUB');
  await page.getByRole('button', { name: 'Pick from Media…' }).click();
  const picker = page.getByRole('dialog', { name: 'Pick films or shows' });
  await picker.getByRole('option', { name: /^Bright Lanes/ }).click();
  await picker.getByRole('option', { name: /Bright Lanes - 1(?!\d)/ }).click();
  await picker.getByRole('option', { name: /Bright Lanes - 2(?!\d)/ }).click();
  await picker.getByRole('button', { name: 'Add 2 items' }).click();
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('heading', { name: 'Bright Lanes films - PUB', level: 1 })).toBeVisible();
  const monday = page.getByRole('button', { name: / 06:00 · News Hour · no programme$/ }).first();
  await monday.click();
  await side(page, 'Block').getByRole('button', { name: 'Add first airing' }).click();
  await expect(side(page, 'Block').getByText('Bright Lanes - 1')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});

test('a drop-frame channel shows times and lengths in its timecode', async ({ page }) => {
  await openList(page, 'E2E DF');
  await expect(page.getByText('Week starts Sunday · day starts 06:00 · 29.97 fps drop-frame')).toBeVisible();
  await page.getByRole('button', { name: 'New plan' }).click();
  await page.getByRole('button', { name: 'Pick from Media…' }).click();
  const picker = page.getByRole('dialog', { name: 'Pick the series' });
  await picker.getByRole('option', { name: /^Bright Lanes/ }).click();
  await expect(picker.getByRole('option', { name: /Bright Lanes - 1(?!\d)/ })).toContainText(/\d{2}:\d{2}:\d{2};\d{2}/);
  await picker.getByRole('button', { name: 'Use 12 episodes' }).click();
  await expect(page.getByRole('region', { name: 'Week' }).getByText('06:00', { exact: true }).first()).toBeVisible();
});
