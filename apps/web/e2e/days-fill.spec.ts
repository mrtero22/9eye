// Playlist page, Day tab, part 3 (docs/design/day-playlist-page.md): filling a day from what exists —
// the steps and issues of the day, Import program placements (a programme split across its block's
// linked breaks), Import break events, Fill gaps from a rotation list (a gap row), running a step
// again, Undo / Save; a published day and the ads playlist. A step runs at once: a short note says
// what it did, its Details show the rest.

import { expect, test, type Page } from '@playwright/test';
import { SLUG, disconnect, makeCompany, prepareFill, publishDay, removeCompany, signIn } from './fixture';

test.beforeEach(async ({ page }) => {
  await makeCompany();
  await signIn(page);
  await page.addInitScript((slug) => localStorage.setItem('9eye.company', slug), SLUG);
});

test.afterAll(async () => {
  await removeCompany();
  await disconnect();
});

/** E2E TV, week 22 of 2030 (both playlists) with what Saturday 1 June is filled from, on the Day tab. */
async function openSaturday(page: Page, publish = false) {
  await page.goto('/playlist');
  await page.getByRole('button', { name: /^Channel:/ }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: 'E2E TV', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Channel: E2E TV' })).toBeVisible();
  const url = new URL(page.url());
  url.searchParams.set('month', '2030-06');
  await page.goto(url.toString());
  await page.getByRole('button', { name: 'Create week 22' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create weeks' });
  await dialog.getByRole('button', { name: 'Create 1 week' }).click();
  await expect(dialog).toBeHidden();
  await prepareFill('2030-06-01');
  if (publish) await publishDay('2030-06-01');
  url.searchParams.set('tab', 'day');
  url.searchParams.set('date', '2030-06-01');
  await page.goto(url.toString());
  await expect(page.getByRole('table', { name: 'Main playlist of Sat 1 Jun 2030' })).toBeVisible();
  return url;
}

const block = (page: Page, name: string) => page.getByRole('table').getByRole('rowgroup', { name });
const rowsOf = (page: Page, name: string) => block(page, name).getByRole('row');
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Add to playlist' });
const steps = (page: Page) => sidebar(page).getByRole('group', { name: 'Steps for this day' });
const step = (page: Page, name: string) => steps(page).getByRole('group', { name });
const imports = (page: Page) => sidebar(page).getByRole('group', { name: 'Pull into this day' });
const B1 = '06:00 Run Block 1';
const B2 = '07:00 Run Block 2';

test('a day is filled from its plans, the ads playlist and a rotation list, then saved', async ({ page }) => {
  await openSaturday(page);
  await expect(step(page, 'Program placements')).toContainText('2 airings to place');
  await expect(step(page, 'Break events')).toContainText('2 breaks to fill');
  await expect(step(page, 'Rotation lists')).toContainText('2 blocks have gaps');
  await expect(page.getByText('3 issues: 2 airings of confirmed plans are not in the day, and more.')).toBeVisible();

  // the issues, each with the step that resolves it
  await page.getByRole('button', { name: 'Show issues' }).click();
  const issues = page.getByRole('dialog', { name: 'Issues of this day' });
  await expect(issues).toContainText('2 linked breaks differ from the ads playlist');
  await expect(issues).toContainText('2 blocks have gaps to fill');
  await issues.getByRole('button', { name: 'Program placements' }).click();

  // program placements, at once: the episode split around the block's two breaks, its repeat in block 2
  await expect(issues).toBeHidden();
  await expect(page.getByText('Program placements: 2 airings placed. Save to keep it.')).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  // the note's Details: what went in, and what was left out
  await page.getByRole('button', { name: 'Details' }).click();
  const programs = page.getByRole('dialog', { name: 'Import program placements' });
  await expect(programs.getByText('2 placed', { exact: true })).toBeVisible();
  await expect(programs).toContainText('1 airing of draft plans was left out: only confirmed plans reach the playlist.');
  await expect(programs.getByText('Lumen Story - E2E · 3 parts', { exact: true })).toBeVisible();
  await expect(programs.getByText('Lumen Story - E2E · 3 parts · repeat')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(programs).toBeHidden();
  await expect(rowsOf(page, B1)).toHaveCount(6);
  await expect(rowsOf(page, B1).nth(0)).toContainText('Lumen Story - 1');
  await expect(rowsOf(page, B1).nth(1)).toContainText('Billboard 1 06:00');
  await expect(rowsOf(page, B1).nth(2)).toContainText('06:15:00:00');
  await expect(rowsOf(page, B1).nth(3)).toContainText('Ad Pod 06:30');
  await expect(rowsOf(page, B1).nth(4)).toContainText('06:30:00:00');
  await expect(rowsOf(page, B1).nth(5)).toContainText('Gap holder');
  await expect(rowsOf(page, B2)).toHaveCount(4);
  await expect(step(page, 'Program placements')).toContainText('All 2 placed');

  // break events: the ads playlist's spots under their breaks
  await imports(page).getByRole('button', { name: /^Break events/ }).click();
  await expect(page.getByText('Break events: 2 breaks filled. Save to keep it.')).toBeVisible();
  await expect(rowsOf(page, B1)).toHaveCount(9);
  await expect(rowsOf(page, B1).nth(2)).toContainText('Spot_Alpha');
  await expect(rowsOf(page, B1).nth(2)).toContainText('Billboard 1 06:00'); // the Break column
  await expect(rowsOf(page, B1).nth(1)).toContainText('00:00:50:00'); // the break's filled length
  await expect(step(page, 'Break events')).toContainText('All 2 linked breaks match the ads playlist');

  // a gap row fills its block at once, from the channel's default rotation list (the block has none)
  await block(page, B1).getByRole('button', { name: 'Fill gaps automatically' }).click();
  await expect(page.getByText('Gap of Run Block 1: 3 items put in. Save to keep it.')).toBeVisible();
  await expect(rowsOf(page, B1)).toHaveCount(12);
  await expect(rowsOf(page, B1).nth(10)).toContainText('Filler_C');
  await expect(step(page, 'Rotation lists')).toContainText('2 blocks still have gaps');

  // one Undo step each
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rowsOf(page, B1)).toHaveCount(9);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(rowsOf(page, B1)).toHaveCount(12);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Day saved')).toBeVisible();
  await page.reload();
  await expect(rowsOf(page, B1)).toHaveCount(12);
  await expect(step(page, 'Program placements')).toContainText('All 2 placed');

  // running a step again only adds what is missing: here nothing, so the day stays as saved
  await step(page, 'Program placements').getByRole('button', { name: 'Run again: Program placements' }).click();
  await expect(page.getByText('Program placements: nothing new, it is all in the day already.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Unsaved changes')).toBeHidden();
});

test('an approved day cannot be filled; the ads playlist imports campaigns and rotation lists', async ({ page }) => {
  const url = await openSaturday(page, true);
  await expect(imports(page).getByRole('button', { name: /^Program placements/ })).toBeDisabled();
  await expect(imports(page).getByRole('button', { name: /^Program placements/ })).toContainText('Reopen the day first');
  await expect(step(page, 'Break events').getByRole('button', { name: 'Run: Break events' })).toBeDisabled();

  url.searchParams.set('playlist', 'ads');
  await page.goto(url.toString());
  await expect(page.getByRole('table', { name: 'Ads playlist of Sat 1 Jun 2030' })).toBeVisible();
  await expect(imports(page).getByRole('button')).toHaveCount(2);
  await expect(imports(page).getByRole('button', { name: /^Campaigns/ })).toBeVisible();
  await expect(imports(page).getByRole('button', { name: /^Rotation lists/ })).toBeVisible();
  await expect(steps(page).getByRole('group')).toHaveCount(2);
});
