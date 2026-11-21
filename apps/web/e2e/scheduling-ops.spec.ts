// Scheduling, the order's operations end to end (scheduling-page.md: table view, report, the "⋯"
// menu, other orders in the week, the issue action, unsaved changes).

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
const longDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return `${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
};
const cell = (page: Page, date: string, clock: string) => page.getByRole('button', { name: new RegExp(`^${shortDay(date)} ${clock} · `) });
const side = (page: Page, name: string) => page.getByRole('complementary', { name });
const menu = async (page: Page, item: string | RegExp) => {
  await page.getByRole('button', { name: 'Plan actions' }).click();
  await page.getByRole('menuitem', { name: item }).click();
};
const save = async (page: Page) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
};

async function openList(page: Page) {
  await page.goto('/scheduling');
  await page.getByRole('button', { name: /^Channel:/ }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: /^E2E SCHED/ }).click();
  await expect(page.getByRole('button', { name: 'Channel: E2E SCHED' })).toBeVisible();
}

async function openOrder(page: Page, name: string) {
  await openList(page);
  await page.getByRole('row', { name: `Open ${name}` }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test('table view: bulk edit and delete the selected airings; a row opens its block', async ({ page }) => {
  const { week } = schedToday();
  await openOrder(page, 'Harbor - E2E');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Table' }).click();
  const table = page.getByRole('table', { name: 'Airings this week' });
  await expect(table.getByText('12 airings this week')).toBeVisible();
  await table.getByLabel(`Select ${shortDay(addDays(week, 4))} 23:00`).check();
  await table.getByRole('button', { name: 'Delete' }).click();
  await expect(table.getByText('11 airings this week')).toBeVisible();

  await table.getByLabel(`Select ${shortDay(week)} 15:00`).check();
  await table.getByRole('button', { name: 'Bulk edit…' }).click();
  const bulk = page.getByRole('dialog', { name: 'Bulk edit 1 airing' });
  await bulk.getByLabel('Episode / item (first airings)').selectOption({ label: 'Harbor Nights - 10' });
  await bulk.getByRole('button', { name: 'Apply' }).click();
  await expect(table.getByRole('row', { name: new RegExp(`${shortDay(week)} 15:00`) })).toContainText('Harbor Nights - 10');
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  await table.getByRole('row', { name: new RegExp(`${shortDay(addDays(week, 2))} 15:00`) }).click();
  await expect(side(page, 'Block').getByRole('heading', { name: '1H Run Block' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Week' })).toBeVisible();
});

test('report: totals per item and per week', async ({ page }) => {
  await openOrder(page, 'Harbor - E2E');
  await menu(page, 'Report');
  await expect(page.getByRole('heading', { name: 'Report' })).toBeVisible();
  await expect(page.getByText(/^Harbor - E2E · 12 first airings and \d+ repeats/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Per item' }).getByText('Harbor Nights - 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Per week' }).getByRole('row')).toHaveCount(2 + 5);
  await page.getByRole('button', { name: 'Back to the week' }).click();
  await expect(page.getByRole('region', { name: 'Week' })).toBeVisible();
});

test('duplicate from the list, split, delete', async ({ page }) => {
  const { week } = schedToday();
  await openList(page);
  await page.getByRole('button', { name: 'Actions for Bright Lanes - E2E' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate…' }).click();
  const dup = page.getByRole('dialog', { name: 'Duplicate plan' });
  await dup.getByLabel('Name').fill('Bright Lanes copy');
  await dup.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByRole('heading', { name: 'Bright Lanes copy', level: 1 })).toBeVisible();

  await menu(page, /^Split plan…/);
  const split = page.getByRole('dialog', { name: 'Split plan' });
  const starts = split.getByLabel(/^New plan starts/);
  await starts.fill(longDay(addDays(week, 7)));
  await starts.press('Enter');
  await split.getByLabel('Name of the new plan').fill('Bright Lanes part 2');
  await expect(split.getByText(new RegExp(`ends ${shortDay(addDays(week, 6))} with`))).toBeVisible();
  await split.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByRole('heading', { name: 'Bright Lanes part 2', level: 1 })).toBeVisible();

  await menu(page, 'Delete plan…');
  await page.getByRole('dialog', { name: 'Delete Bright Lanes part 2?' }).getByRole('button', { name: 'Delete plan' }).click();
  await expect(page.getByRole('heading', { name: 'Scheduling', level: 1 })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Open Bright Lanes part 2' })).toBeHidden();
  await expect(page.getByRole('row', { name: 'Open Bright Lanes copy' })).toBeVisible();
});

test('move airings to a plan of the same kind, and replace an item', async ({ page }) => {
  const { week } = schedToday();
  // a twin of Harbor (same dates, channel and mode) without airings
  await openOrder(page, 'Harbor - E2E');
  await menu(page, 'Duplicate plan…');
  await page.getByRole('dialog', { name: 'Duplicate plan' }).getByLabel('Name').fill('Harbor twin');
  await page.getByRole('dialog', { name: 'Duplicate plan' }).getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByRole('heading', { name: 'Harbor twin', level: 1 })).toBeVisible();
  await menu(page, 'Clear all airings…');
  await page.getByRole('dialog', { name: 'Clear all airings?' }).getByRole('button', { name: 'Clear all airings' }).click();
  await save(page);

  await openOrder(page, 'Harbor - E2E');
  await menu(page, /^Move airings…/);
  const move = page.getByRole('dialog', { name: 'Move airings' });
  await move.getByLabel(/Harbor Nights - 4/).check();
  await move.getByLabel('To the plan').selectOption({ label: 'Harbor twin (draft)' });
  await expect(move.getByText('Moves 4 airings (1 first airing and their repeats).')).toBeVisible();
  await move.getByRole('button', { name: 'Move 4 airings' }).click();
  await expect(page.getByText('4 airings moved')).toBeVisible();
  await expect(cell(page, week, '15:00')).toHaveAccessibleName(/Harbor twin, Harbor Nights - 4/);

  await menu(page, /^Replace items…/);
  const rep = page.getByRole('dialog', { name: 'Replace items' });
  // next week's Monday: always after tomorrow
  await rep.getByLabel('Harbor Nights - 8').check();
  await rep.getByRole('button', { name: 'Pick the new item…' }).click();
  const pick = page.getByRole('dialog', { name: 'Pick the new item' });
  await pick.getByRole('option', { name: /^Spider Noir/ }).click();
  await pick.getByRole('option', { name: /Spider Noir - 1/ }).click();
  await pick.getByRole('button', { name: 'Pick', exact: true }).click();
  await expect(rep.getByText('1 airing found')).toBeVisible();
  await rep.getByRole('button', { name: 'Replace in 1 airing' }).click();
  await expect(page.getByText('1 airing changed')).toBeVisible();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(cell(page, addDays(week, 9), '15:00')).toHaveAccessibleName(/Spider Noir - 1, first airing/);
  await save(page);
});

test('limits and auto-place, quick placement, refresh durations', async ({ page }) => {
  const { week } = schedToday();
  await openOrder(page, 'Bright Lanes - E2E');
  await side(page, 'Plan details').getByRole('button', { name: 'Edit' }).click();
  const limits = page.getByRole('dialog', { name: 'Limits' });
  await limits.getByRole('button', { name: 'Add allowed window' }).click();
  await limits.getByRole('button', { name: 'Apply' }).click();
  await expect(side(page, 'Plan details').getByText('No airing limit · 1 time window')).toBeVisible();
  await menu(page, /^Auto-place…/);
  const auto = page.getByRole('dialog', { name: 'Auto-place' });
  await expect(auto.getByText('12 items will be placed.')).toBeVisible();
  await auto.getByRole('button', { name: 'Place' }).click();
  await expect(page.getByText('12 airings placed')).toBeVisible();
  // the window 09:00–15:00 holds the 11:00 block; days where Harbor repeats at 11:00 are skipped
  await expect(cell(page, week, '11:00')).toHaveAccessibleName(/Bright Lanes - \d+, first airing/);
  await expect(cell(page, addDays(week, 1), '11:00')).toHaveAccessibleName(/Harbor - E2E/);

  await openOrder(page, 'Harbor - E2E');
  await page.getByRole('button', { name: 'Plan actions' }).click();
  await page.getByRole('menuitem', { name: /^Quick placement/ }).click();
  await expect(page.getByText(/^Quick placement: click an empty block/)).toBeVisible();
  await cell(page, addDays(week, 6), '15:00').click();
  await expect(cell(page, addDays(week, 6), '15:00')).toHaveAccessibleName(/Harbor Nights - 7, first airing/);
  // the copy button of a first airing: clicks add its repeats; Esc goes back one step at a time
  await page.getByRole('button', { name: 'Add repeats of Harbor Nights - 7', exact: true }).click();
  await expect(page.getByText(/^Quick placement: click an empty block to add a repeat of Harbor Nights - 7/)).toBeVisible();
  await cell(page, addDays(week, 6), '19:00').click();
  await expect(cell(page, addDays(week, 6), '19:00')).toHaveAccessibleName(/Harbor Nights - 7, repeat/);
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^Quick placement: click an empty block to add a first airing/)).toBeVisible();
  // a block another order holds is placed too; its panel names the other order
  await cell(page, addDays(week, 5), '15:00').click();
  await expect(cell(page, addDays(week, 5), '15:00')).toHaveAccessibleName(/Harbor - E2E, Harbor Nights - \d+, first airing/);
  await cell(page, addDays(week, 5), '15:00').click();
  await expect(side(page, 'Block').getByText('Bright Lanes - E2E')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^Quick placement: click an empty block/)).toBeHidden();

  await menu(page, /^Refresh durations/);
  const refresh = page.getByRole('dialog', { name: 'Refresh durations' });
  await refresh.getByRole('button', { name: 'Refresh 11 lengths' }).click();
  await expect(page.getByText('11 lengths refreshed')).toBeVisible();
  await save(page);
});

test('shift airings: the episodes move along the airing days, later or (the mirror) earlier; the days, blocks and repeats stay', async ({ page }) => {
  const { week } = schedToday();
  const [sat, mon, wed] = [week, addDays(week, 2), addDays(week, 4)];
  await openOrder(page, 'Harbor - E2E');
  const episode = async (date: string) => (await cell(page, date, '15:00').getAttribute('aria-label'))!.match(/Harbor Nights - \d+/)![0];
  const [atMon, atWed] = [await episode(mon), await episode(wed)];
  const shift = page.getByRole('dialog', { name: 'Shift airings' });
  const direction = (d: 'Later' | 'Earlier') => shift.getByRole('group', { name: 'Direction' }).getByRole('button', { name: d }).click();

  // later: Monday's episode and the ones after it go one airing day on; Monday empties
  await cell(page, mon, '15:00').click();
  await menu(page, /^Shift airings…/);
  await expect(shift.getByText(new RegExp(`^\\d+ episodes from ${atMon} on move 1 airing day later\\.$`))).toBeVisible();
  await expect(shift.getByText(`Left empty: ${shortDay(mon)} 15:00 with 3 repeats.`)).toBeVisible();
  await expect(shift.getByText(/^New at the end, from the weekly pattern: /)).toBeVisible();
  await shift.getByRole('button', { name: /^Shift \d+ episodes$/ }).click();
  await expect(page.getByText(/^\d+ episodes shifted 1 airing day later$/)).toBeVisible();
  await expect(cell(page, mon, '15:00')).toHaveAccessibleName(/no programme$/);
  await expect(cell(page, mon, '19:00')).toHaveAccessibleName(/no programme$/);
  await expect(cell(page, wed, '15:00')).toHaveAccessibleName(new RegExp(`${atMon}, first airing$`));
  await expect(cell(page, wed, '19:00')).toHaveAccessibleName(new RegExp(`${atMon}, repeat$`));
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(cell(page, mon, '15:00')).toHaveAccessibleName(new RegExp(`${atMon}, first airing$`));

  // earlier: Monday's episode and the ones before it go back; the first one needs a day before the start
  await menu(page, /^Shift airings…/);
  await direction('Earlier');
  await expect(shift.getByText(/^The plan starts on .*: 1 episode has no airing day left\. Change the start date first\.$/)).toBeVisible();
  await expect(shift.getByRole('button', { name: /^Shift/ })).toBeDisabled();
  await shift.getByRole('button', { name: 'Cancel' }).click();
  await side(page, 'Block').getByRole('button', { name: 'Plan details' }).click();
  const startDate = side(page, 'Plan details').getByRole('group', { name: 'Dates' }).getByLabel(/^Start date/);
  await startDate.fill(longDay(addDays(week, -14)));
  await startDate.press('Enter');
  await cell(page, mon, '15:00').click();
  await menu(page, /^Shift airings…/);
  await direction('Earlier');
  await expect(shift.getByText(new RegExp(`^\\d+ episodes up to ${atMon} move 1 airing day earlier\\.$`))).toBeVisible();
  await expect(shift.getByText(`Left empty: ${shortDay(mon)} 15:00 with 3 repeats.`)).toBeVisible();
  await expect(shift.getByText(/^New at the start, from the weekly pattern: /)).toBeVisible();
  await shift.getByRole('button', { name: /^Shift \d+ episodes$/ }).click();
  await expect(page.getByText(/^\d+ episodes shifted 1 airing day earlier$/)).toBeVisible();
  await expect(cell(page, mon, '15:00')).toHaveAccessibleName(/no programme$/);
  await expect(cell(page, sat, '15:00')).toHaveAccessibleName(new RegExp(`${atMon}, first airing$`));
  await expect(cell(page, sat, '19:00')).toHaveAccessibleName(new RegExp(`${atMon}, repeat$`));
  await expect(cell(page, wed, '15:00')).toHaveAccessibleName(new RegExp(`${atWed}, first airing$`));
});

test('plan dates: the start and the end are picked apart, each limited by the other', async ({ page }) => {
  const { week } = schedToday();
  await openOrder(page, 'Harbor - E2E');
  const dates = side(page, 'Plan details').getByRole('group', { name: 'Dates' });
  const end = dates.getByLabel(/^End date/);
  await end.fill(longDay(addDays(week, 30)));
  await end.press('Enter');
  await expect(page.getByText(`${longDay(addDays(week, -7))} → ${longDay(addDays(week, 30))}`)).toBeVisible();
  const start = dates.getByLabel(/^Start date/);
  await start.fill(longDay(addDays(week, 31)));
  await start.press('Enter');
  await expect(dates.getByText(`On or before the end, ${longDay(addDays(week, 30))}.`)).toBeVisible();
  await expect(page.getByText(`${longDay(addDays(week, -7))} → ${longDay(addDays(week, 30))}`)).toBeVisible();
});

test('all programmes and other plans; the issue’s action; unsaved changes are kept on purpose', async ({ page }) => {
  const { week } = schedToday();
  await openOrder(page, 'Harbor - E2E');
  const sunday = addDays(week, 1);
  await expect(cell(page, sunday, '15:00')).toContainText('Bright Lanes - 4');
  await page.getByRole('button', { name: 'Plan actions' }).click();
  await page.getByRole('menuitemcheckbox', { name: "Other plans' programmes" }).click();
  await page.keyboard.press('Escape');
  await expect(cell(page, sunday, '15:00')).not.toContainText('Bright Lanes');

  await page.getByRole('group', { name: 'Which plans to draw' }).getByRole('button', { name: 'All programmes' }).click();
  await cell(page, sunday, '15:00').click();
  await expect(page.getByRole('heading', { name: 'Bright Lanes - E2E', level: 1 })).toBeVisible();
  await expect(side(page, 'Block').getByText('Bright Lanes - 4')).toBeVisible();

  await side(page, 'Block').getByRole('button', { name: 'Plan details' }).click();
  const details = side(page, 'Plan details');
  await expect(details.getByText(/^Draft: its airings from .* are left out of the playlist\.$/)).toBeVisible();
  await details.getByRole('button', { name: 'Confirm plan' }).click();
  await expect(details.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Confirmed' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Scheduling · E2E SCHED' }).click();
  const leave = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Bright Lanes - E2E', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Scheduling · E2E SCHED' }).click();
  await leave.getByRole('button', { name: 'Save and leave' }).click();
  await expect(page.getByRole('heading', { name: 'Scheduling', level: 1 })).toBeVisible();
  await expect(page.getByRole('row', { name: 'Open Bright Lanes - E2E' })).toContainText('Confirmed');
});
