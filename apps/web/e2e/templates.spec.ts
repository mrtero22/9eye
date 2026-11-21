// The Templates page, end to end (docs/design/templates-page.md "Done when").

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

async function openChannel(page: Page, name: string) {
  await page.goto('/templates');
  await page.getByRole('button', { name: /^Channel:/ }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('button', { name: `Channel: ${name}` })).toBeVisible();
}

const block = (page: Page, label: string) => page.getByRole('button', { name: new RegExp(`^${label}`) });
const panel = (page: Page, name = 'Block') => page.getByRole('complementary', { name });
const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });

test('linked breaks: add from the ads layout, undo / redo, save', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await block(page, 'Saturday, 07:00').click();
  await expect(panel(page).getByRole('heading', { name: 'Run Block 2' })).toBeVisible();
  await expect(panel(page).getByText('No breaks. The programme runs without interruption.')).toBeVisible();

  await panel(page).getByRole('button', { name: 'Add break' }).click();
  const picker = page.getByRole('dialog', { name: 'Add a break' });
  await expect(picker.getByRole('button', { name: /Billboard 1 07:00/ })).toBeVisible();
  await picker.getByRole('button', { name: /Ad Pod 07:30/ }).click();
  await expect(panel(page).getByText('Ad Pod 07:30')).toBeVisible();
  await expect(panel(page).getByText('18 min')).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(panel(page).getByText('No breaks. The programme runs without interruption.')).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(panel(page).getByText('Ad Pod 07:30')).toBeVisible();

  await save(page).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toBeHidden();
  await page.reload();
  await expect(block(page, 'Saturday, 07:00 to 08:00, Run Block 2, 1 linked breaks')).toBeVisible();
});

test('apply to other blocks matches by position and is all-or-nothing', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await block(page, 'Saturday, 06:00').click();
  await panel(page).getByRole('button', { name: 'Apply to other blocks…' }).click();
  const pop = page.getByRole('dialog', { name: 'Apply breaks to other blocks' });

  // Sunday has no breaks in its 07:00 hour, so "all 1 h blocks" cannot be applied.
  await pop.getByRole('radio', { name: 'All 1 h blocks' }).click();
  await expect(pop.getByText(/1 of 3 blocks have no break at the same position \(e\.g\. Sun 07:00\)\. Nothing will be applied\./)).toBeVisible();
  await expect(pop.getByRole('button', { name: 'Apply' })).toBeDisabled();

  await pop.getByRole('radio', { name: 'Same block type on other days' }).click();
  await expect(pop.getByText('1 block gets these 2 breaks.')).toBeVisible();
  await pop.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Applied to 1 block')).toBeVisible();
  await expect(block(page, 'Sunday, 06:00 to 07:00, Run Block 1, 2 linked breaks')).toBeVisible();
});

test('add block: right after the selected block; overlaps are refused', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await block(page, 'Saturday, 07:00').click();
  await page.getByRole('button', { name: 'Add block' }).click();
  const add = panel(page, 'Add block');
  await expect(add.getByLabel('Start')).toHaveValue('08:00:00:00');
  await add.getByRole('button', { name: /Run Block 3/ }).click();
  await expect(panel(page).getByRole('heading', { name: 'Run Block 3' })).toBeVisible();
  await expect(panel(page).getByText('Saturday · 08:00–09:00')).toBeVisible();

  await page.getByRole('button', { name: 'Add block' }).click();
  await add.getByLabel('Start').fill('06:30');
  await add.getByLabel('Start').press('Enter');
  await add.getByRole('button', { name: /Run Block 4/ }).click();
  await expect(add.getByText(/overlaps/)).toBeVisible();

  // a block type is used once per day
  await expect(add.getByRole('button', { name: /Run Block 1.*used on this day/ })).toBeDisabled();
});

test('days: copy, active days, dates, rename — saved together', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await page.getByRole('button', { name: 'Saturday actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy this day to…' }).click();
  const copy = page.getByRole('dialog', { name: 'Copy Saturday to' });
  await copy.getByLabel('Sunday').check();
  await copy.getByLabel('Monday').check();
  await copy.getByRole('button', { name: 'Copy' }).click();
  await expect(block(page, 'Monday, 06:00 to 07:00, Run Block 1, 2 linked breaks')).toBeVisible();

  await page.getByRole('button', { name: 'Friday, active' }).click();
  await expect(page.getByRole('button', { name: 'Friday, not active' })).toBeVisible();

  await page.getByRole('button', { name: 'Change dates' }).click();
  const dates = page.getByRole('dialog', { name: 'Valid dates' });
  // whole channel weeks: a Sunday is taken back to the Saturday its week starts on
  await dates.getByLabel('Valid dates, from').fill('2024-03-31');
  await dates.getByLabel('Valid dates, from').press('Enter');
  await expect(dates.getByLabel('Valid dates, from')).toHaveValue('30 Mar 2024');
  await dates.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Valid 30 Mar 2024 → 29 May 2099')).toBeVisible();

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByRole('dialog', { name: 'Rename layout' }).getByLabel('Name').fill('E2E Renamed');
  await page.getByRole('dialog', { name: 'Rename layout' }).getByRole('button', { name: 'Rename' }).click();

  await save(page).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Valid 30 Mar 2024 → 29 May 2099')).toBeVisible();
  await expect(page.getByText('E2E Renamed').first()).toBeVisible();
  await expect(page.getByText('Same as Sat')).toHaveCount(2);
  await expect(page.getByText('Not active')).toBeVisible();
});

test('break lists: save a block’s breaks as a list and use it elsewhere', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await block(page, 'Saturday, 06:00').click();
  await panel(page).getByRole('button', { name: 'Use a list' }).click();
  await page.getByRole('button', { name: 'Save these breaks as a list…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Save these breaks as a list' });
  await expect(dlg.getByText('2 breaks · 1st, 2nd')).toBeVisible();
  await dlg.getByLabel('Name').fill('Hourly');
  await dlg.getByRole('button', { name: 'Save list' }).click();
  await expect(page.getByText('List "Hourly" saved')).toBeVisible();

  await block(page, 'Saturday, 07:00').click();
  await panel(page).getByRole('button', { name: 'Use a list' }).click();
  await page.getByRole('button', { name: /Hourly.*Billboard 1 07:00 · Ad Pod 07:30/ }).click();
  await expect(panel(page).getByText('Ad Pod 07:30')).toBeVisible();

  // Sunday 07:00 has no ads-template breaks: the list does not fit there
  await block(page, 'Sunday, 07:00').click();
  await panel(page).getByRole('button', { name: 'Use a list' }).click();
  await expect(page.getByRole('button', { name: /Hourly.*Does not fit this block/ })).toBeDisabled();
});

test('ads layout: which main blocks use a break; open it from the main block', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await block(page, 'Saturday, 06:00').click();
  await panel(page).getByRole('button', { name: 'Open Billboard 1 06:00 in the ads layout' }).click();
  await expect(panel(page).getByRole('heading', { name: 'Billboard 1 06:00' })).toBeVisible();
  await expect(panel(page).getByText('Linked from the main layout')).toBeVisible();
  await panel(page).getByRole('button', { name: /Run Block 1/ }).click();
  await expect(panel(page).getByRole('heading', { name: 'Run Block 1' })).toBeVisible();
});

test('unsaved changes are kept or discarded on purpose', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await page.getByRole('button', { name: 'Friday, active' }).click();
  await page.getByRole('button', { name: /^E2E ADS/ }).click();
  const guard = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByText('Valid 6 Jan 2024 → 25 Dec 2099')).toBeVisible();
});

test('layouts: new, clone, delete', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'New layout…' }).click();
  const dlg = page.getByRole('dialog', { name: 'New layout' });
  await dlg.getByLabel('Name').fill('Winter');
  await dlg.getByLabel('Valid dates, from').fill('24 Oct 2026');
  await dlg.getByLabel('Valid dates, from').press('Enter');
  await dlg.getByLabel('Valid dates, to').fill('1/1/2027');
  await dlg.getByLabel('Valid dates, to').press('Enter');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Valid 24 Oct 2026 → 1 Jan 2027')).toBeVisible();

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Clone this layout…' }).click();
  await page.getByRole('dialog', { name: 'Clone this layout' }).getByRole('button', { name: 'Clone' }).click();
  await expect(page.getByRole('button', { name: /^Copy of Winter/ })).toBeVisible();

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete layout…' }).click();
  await page.getByRole('dialog', { name: /Delete Copy of Winter/ }).getByRole('button', { name: 'Delete layout' }).click();
  await expect(page.getByText('Layout deleted')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Copy of Winter/ })).toBeHidden();
});

test('block types: create several numbered ones', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await page.getByRole('button', { name: 'Block types', exact: true }).click();
  await panel(page, 'Block types').getByRole('button', { name: 'New' }).click();
  const dlg = page.getByRole('dialog', { name: 'New block type' });
  await dlg.getByRole('button', { name: 'Several, numbered' }).click();
  await dlg.getByLabel('Base name').fill('Repeat Block');
  await dlg.getByLabel('How many').fill('3');
  await expect(dlg.getByText('Repeat Block 1, Repeat Block 2, Repeat Block 3')).toBeVisible();
  await dlg.getByRole('button', { name: 'Create 3' }).click();
  await expect(page.getByText('3 block types created')).toBeVisible();
  await panel(page, 'Block types').getByLabel('Search block types').fill('Repeat');
  await expect(panel(page, 'Block types').getByText('Repeat Block 3')).toBeVisible();
});

test('a main-only channel has no linked breaks', async ({ page }) => {
  await openChannel(page, 'E2E PUBLIC');
  await expect(page.getByText('Week starts Monday · day starts 06:00 · 25 fps')).toBeVisible();
  await expect(page.getByText(/Main playlist only: this channel has no ads playlist/)).toBeVisible();
  await block(page, 'Monday, 06:00').click();
  await expect(panel(page).getByText('This channel has no ads playlist, so its blocks have no linked breaks.')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Add break' })).toHaveCount(0);
});

test('a drop-frame channel shows its times with ;', async ({ page }) => {
  await openChannel(page, 'E2E DF');
  await expect(page.getByText('Week starts Sunday · day starts 06:00 · 29.97 fps drop-frame')).toBeVisible();
  await block(page, 'Monday, 06:00').click();
  await expect(panel(page).getByLabel('Start time')).toHaveValue('06:00:00;00');
  await expect(panel(page).getByLabel('Length')).toHaveValue('01:00:00;00');
  await panel(page).getByLabel('Length').fill('00:30:00;00');
  await panel(page).getByLabel('Length').press('Enter');
  await expect(panel(page).getByText('Monday · 06:00–06:30')).toBeVisible();
});

test('drag and drop: add from the block types, move, copy with Ctrl, refusals, undo', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  // zoom 32 px per hour; the week starts on Saturday, so the columns are Sat, Sun, Mon, …
  const saturday = block(page, 'Saturday, 06:00').locator('..');
  const monday = saturday.locator('xpath=following-sibling::div[2]');

  // a block type dragged from the library onto Saturday 10:00
  await page.getByRole('button', { name: 'Block types', exact: true }).click();
  await panel(page, 'Block types').getByLabel('Search block types').fill('Run Block 3');
  await panel(page, 'Block types').getByText('Run Block 3', { exact: true }).dragTo(saturday, { targetPosition: { x: 40, y: 4 * 32 + 1 } });
  await expect(block(page, 'Saturday, 10:00 to 11:00, Run Block 3')).toBeVisible();

  // move Saturday 07:00 to Monday 09:00 (grabbed in its middle)
  await block(page, 'Saturday, 07:00').dragTo(monday, { targetPosition: { x: 40, y: 3 * 32 + 16 } });
  await expect(block(page, 'Monday, 09:00 to 10:00, Run Block 2')).toBeVisible();
  await expect(block(page, 'Saturday, 07:00')).toHaveCount(0);

  // Ctrl copies it to Saturday 12:00
  await page.keyboard.down('Control');
  await block(page, 'Monday, 09:00').dragTo(saturday, { targetPosition: { x: 40, y: 6 * 32 + 16 } });
  await page.keyboard.up('Control');
  await expect(block(page, 'Saturday, 12:00 to 13:00, Run Block 2')).toBeVisible();
  await expect(block(page, 'Monday, 09:00 to 10:00, Run Block 2')).toBeVisible();

  // a block type is used once per day: Sunday's Run Block 1 cannot go to Saturday
  await block(page, 'Sunday, 06:00').dragTo(saturday, { targetPosition: { x: 40, y: 8 * 32 + 16 } });
  await expect(page.getByText(/Run Block 1 is already used on Saturday/)).toBeVisible();
  await expect(block(page, 'Sunday, 06:00 to 07:00, Run Block 1')).toBeVisible();

  // every drop is one undo step
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(block(page, 'Saturday, 12:00')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(block(page, 'Saturday, 07:00 to 08:00, Run Block 2')).toBeVisible();
});

test('drag from the Add block list, with its break list; the panel stays open', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  const saturday = block(page, 'Saturday, 06:00').locator('..');
  const sunday = saturday.locator('xpath=following-sibling::div[1]');
  await page.getByRole('button', { name: 'Add block' }).click();
  const add = panel(page, 'Add block');
  await add.getByLabel('Break list').selectOption({ label: 'First two · 2 breaks' });
  await add.getByLabel('Search block types').fill('Run Block 3');
  await add.getByRole('button', { name: /Run Block 3/ }).dragTo(saturday, { targetPosition: { x: 40, y: 4 * 32 + 1 } });
  await expect(block(page, 'Saturday, 10:00 to 11:00, Run Block 3, 2 linked breaks')).toBeVisible();
  await expect(panel(page, 'Add block')).toBeVisible();

  // Sunday has no ads-template breaks in its 07:00 hour: the list does not fit there
  await add.getByLabel('Search block types').fill('Run Block 4');
  await add.getByRole('button', { name: /Run Block 4/ }).dragTo(sunday, { targetPosition: { x: 40, y: 32 + 1 } });
  await expect(page.getByText(/The chosen break list does not fit Run Block 4 at 07:00–08:00/)).toBeVisible();
  await expect(block(page, 'Sunday, 07:00 to 08:00, Run Block 2')).toBeVisible();
});

test('place by clicking: each click adds the next block of the series', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  const saturday = block(page, 'Saturday, 06:00').locator('..');
  const monday = saturday.locator('xpath=following-sibling::div[2]');
  await page.getByRole('button', { name: 'Add block' }).click();
  const add = panel(page, 'Add block');
  await add.getByRole('button', { name: 'Place on the grid' }).click();
  await add.getByRole('button', { name: /Run Block 1/ }).click();
  await expect(page.getByText('Placing Run Block (1–4)')).toBeVisible();

  // Saturday already has Run Block 1 and 2 (06:00, 07:00): the clicks add 3, then 4
  await saturday.click({ position: { x: 40, y: 2 * 32 + 3 } });
  await expect(block(page, 'Saturday, 08:00 to 09:00, Run Block 3')).toBeVisible();
  // a click a few minutes below a block sticks to its end
  await saturday.click({ position: { x: 40, y: 3 * 32 + 6 } });
  await expect(block(page, 'Saturday, 09:00 to 10:00, Run Block 4')).toBeVisible();
  // the series is used up on Saturday
  await saturday.click({ position: { x: 40, y: 6 * 32 + 3 } });
  await expect(page.getByText('All 4 block types of Run Block are used on Saturday.')).toBeVisible();
  // Monday is empty: Run Block 1 first
  await monday.click({ position: { x: 40, y: 3 } });
  await expect(block(page, 'Monday, 06:00 to 07:00, Run Block 1')).toBeVisible();
  await expect(panel(page, 'Add block')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(block(page, 'Monday, 06:00')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Placing Run Block (1–4)')).toBeHidden();
  // clicks on the grid do nothing any more
  await monday.click({ position: { x: 40, y: 3 } });
  await expect(block(page, 'Monday, 06:00')).toHaveCount(0);
});

test('ads layouts zoom deep enough to read 5-minute breaks; each kind keeps its zoom', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await page.getByRole('button', { name: /^E2E ADS/ }).click();
  const sp1 = block(page, 'Saturday, 06:00 to 06:05, Billboard 1 06:00');
  await expect(sp1).not.toContainText('Billboard 1 06:00');
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  while (await zoomIn.isEnabled()) await zoomIn.click();
  await expect(sp1).toContainText('Billboard 1 06:00');
  const box = await sp1.boundingBox();
  expect(box!.height).toBeGreaterThan(25);

  await page.reload();
  await expect(block(page, 'Saturday, 06:00 to 06:05, Billboard 1 06:00')).toContainText('Billboard 1 06:00');
  await page.getByRole('button', { name: /^E2E MAIN/ }).click();
  const run = await block(page, 'Saturday, 06:00 to 07:00, Run Block 1').boundingBox();
  expect(run!.height).toBeLessThan(40);
});

test('at a deep zoom a break can be placed on any minute', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await page.getByRole('button', { name: /^E2E ADS/ }).click();
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });
  while (await zoomIn.isEnabled()) await zoomIn.click();
  // 400 px per hour; Sunday has no breaks in its 07:00 hour, and Ad Pod 06:30 ends at 06:28
  const sunday = block(page, 'Sunday, 06:00').locator('..');
  await page.getByRole('button', { name: 'Add block' }).click();
  const add = panel(page, 'Add block');
  await add.getByRole('button', { name: 'Place on the grid' }).click();
  await add.getByLabel('Search block types').fill('Billboard 1 07:00');
  await add.getByRole('button', { name: /Billboard 1 07:00/ }).click();
  const y = (minutes: number) => (minutes / 60) * 400 + 1;
  await sunday.click({ position: { x: 40, y: y(31) } });
  await expect(block(page, 'Sunday, 06:31 to 06:36, Billboard 1 07:00')).toBeVisible();
  // within a few pixels of an edge it still sticks: Ad Pod 07:30 right after Billboard 1 07:00
  await add.getByLabel('Search block types').fill('Ad Pod 07:30');
  await add.getByRole('button', { name: /Ad Pod 07:30/ }).click();
  await sunday.click({ position: { x: 40, y: y(36) + 0.5 } });
  await expect(block(page, 'Sunday, 06:36 to 06:54, Ad Pod 07:30')).toBeVisible();
});

test('repeat a time range: one hour of breaks fills the week, all-or-nothing', async ({ page }) => {
  await openChannel(page, 'E2E REPEAT');
  await page.getByRole('button', { name: 'Saturday actions' }).click();
  await page.getByRole('menuitem', { name: 'Repeat a time range…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Repeat a time range of Saturday' });
  await expect(dlg.getByLabel('From')).toHaveValue('06:00');
  await expect(dlg.getByLabel('To')).toHaveValue('07:00');
  await expect(dlg).toContainText('6 blocks of 06:00–07:00, repeated 23 times every 01:00, until the end of the day.');
  await expect(dlg).toContainText('Creates 136 block types: drama addbox 3 … drama addbox 48 (46), sp 7 … sp 96 (90).');
  await expect(dlg).toContainText('Uses 2 unused ones: sp 5, sp 6.');
  await expect(dlg).toContainText('Places 1002 blocks on Sat–Fri');
  await dlg.getByRole('button', { name: 'Repeat' }).click();
  await expect(page.getByText('Repeated: 1002 blocks, 136 new block types')).toBeVisible();
  await expect(block(page, 'Saturday, 07:00 to 07:05, sp 5')).toHaveCount(1);
  await expect(block(page, 'Saturday, 07:10 to 07:28, drama addbox 3')).toHaveCount(1);
  await expect(block(page, 'Friday, 05:40 to 05:58, drama addbox 48')).toHaveCount(1);
  await expect(block(page, 'Sunday, 06:00 to 06:05, sp 1')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(block(page, 'Friday, 05:40 to 05:58, drama addbox 48')).toHaveCount(1);

  // a day that is already full cannot take the copies: nothing is created
  await openChannel(page, 'E2E TV');
  await page.getByRole('button', { name: /^E2E ADS/ }).click();
  await page.getByRole('button', { name: 'Saturday actions' }).click();
  await page.getByRole('menuitem', { name: 'Repeat a time range…' }).click();
  const full = page.getByRole('dialog', { name: 'Repeat a time range of Saturday' });
  await expect(full).toContainText('Nothing will be repeated:');
  await expect(full.getByRole('button', { name: 'Repeat' })).toBeDisabled();
});
