// Playlist page, Day tab, part 1 (docs/design/day-playlist-page.md): a day's blocks and rows at the
// times they really start, gap / over, the details panel, publish / unpublish, a day without a
// week, the ads playlist and a drop-frame channel. Changing a day by hand: days-edit.spec.ts.

import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { playoutXmlFirstItemId } from '@9eye/core';
import { SLUG, disconnect, fillDay, makeCompany, removeCompany, signIn } from './fixture';

test.beforeEach(async ({ page }) => {
  await makeCompany();
  await signIn(page);
  await page.addInitScript((slug) => localStorage.setItem('9eye.company', slug), SLUG);
});

test.afterAll(async () => {
  await removeCompany();
  await disconnect();
});

async function pickChannel(page: Page, channel: string) {
  await page.goto('/playlist');
  await page.getByRole('button', { name: /^Channel:/ }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: channel, exact: true }).click();
  await expect(page.getByRole('button', { name: `Channel: ${channel}` })).toBeVisible();
}

async function goto(page: Page, params: Record<string, string>) {
  const url = new URL(page.url());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  await page.goto(url.toString());
}

/** Creates the week of a month's row (both playlists where the channel has two) and stays on Weeks. */
async function createWeek(page: Page, channel: string, month: string, n: number) {
  await pickChannel(page, channel);
  await goto(page, { month });
  await page.getByRole('button', { name: `Create week ${n}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Create weeks' });
  await dialog.getByRole('button', { name: 'Create 1 week' }).click();
  await expect(dialog).toBeHidden();
}

const table = (page: Page) => page.getByRole('table');
const block = (page: Page, name: string) => table(page).getByRole('rowgroup', { name });
const row = (page: Page, title: string) => table(page).getByRole('row').filter({ hasText: title });
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Add to playlist' });

test('a new day shows the layout’s blocks with their linked breaks, all gap', async ({ page }) => {
  await createWeek(page, 'E2E TV', '2030-06', 22);
  await page.getByRole('button', { name: 'Sat 1 Jun 2030, draft, 2 blocks' }).click();
  await expect(page.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('table', { name: 'Main playlist of Sat 1 Jun 2030' })).toBeVisible();
  await expect(page.getByText('Week 22 · Week 22 2030 E2E TV M')).toBeVisible();
  await expect(page.getByText('Nothing is placed yet')).toBeVisible();
  await expect(table(page).getByRole('rowgroup')).toHaveCount(2);

  const first = block(page, '06:00 Run Block 1');
  await expect(first).toContainText('Gap 01:00:00:00');
  await expect(first).toContainText('00:00:00:00 / 01:00:00:00');
  await expect(first.getByRole('row')).toHaveCount(3);
  await expect(first.getByRole('row').nth(0)).toContainText('Billboard 1 06:00');
  await expect(first.getByRole('row').nth(0)).toContainText('empty');
  await expect(first.getByRole('row').nth(1)).toContainText('Ad Pod 06:30');
  await expect(first.getByRole('row').nth(2)).toContainText('Gap holder');
  await expect(block(page, '07:00 Run Block 2').getByRole('row')).toHaveCount(1);

  // nothing is changed yet, and adding waits for a place in the day
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(sidebar(page).getByRole('button', { name: /^Item/ })).toBeDisabled();
  await expect(sidebar(page).getByRole('button', { name: /^Item/ })).toContainText('Select a row or a block first');
  await expect(sidebar(page).getByRole('group', { name: 'Pull into this day' })).toContainText('Program placements');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sidebar(page)).toBeHidden();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sidebar(page)).toBeVisible();
});

test('rows run back to back through the day; blocks show their gap or overrun; a row opens its details', async ({ page }) => {
  await createWeek(page, 'E2E TV', '2030-06', 22);
  await fillDay('2030-06-01');
  await goto(page, { tab: 'day', date: '2030-06-01' });

  const first = block(page, '06:00 Run Block 1');
  await expect(first).toContainText('Over 00:05:22:00');
  await expect(first).toContainText('01:05:22:00 / 01:00:00:00');
  const rows = first.getByRole('row');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(1)).toContainText('06:00:00:00');
  await expect(rows.nth(1)).toContainText('Strong Fit - 255');
  await expect(rows.nth(2)).toContainText('Check the subtitles');
  await expect(rows.nth(3)).toContainText('Ad Pod 06:30');
  await expect(rows.nth(3)).toContainText('00:00:22:00'); // the break's filled length
  await expect(rows.nth(3)).toContainText('linked break');
  await expect(rows.nth(4)).toContainText('06:20:00:00');
  await expect(rows.nth(4)).toContainText('Ident_E2E_27_May');
  await expect(rows.nth(5)).toContainText('06:20:15:00');
  await expect(rows.nth(6)).toContainText('06:20:22:00'); // the programme goes on after the break
  await expect(rows.nth(7)).toContainText('07:05:22:00');

  // the second block is planned at 07:00 but starts where the first ended
  const second = block(page, '07:00 Run Block 2');
  await expect(second).toContainText('Gap 00:30:00:00');
  await expect(second.getByRole('row').nth(0)).toContainText('07:05:22:00');
  await expect(second.getByRole('row').nth(0)).toContainText('Not ready');
  await expect(second).toContainText('Gap of 00:30:00:00');
  await expect(page.getByText('1 row has media that is not ready.')).toBeVisible();
  await expect(page.getByText('Day runs 01:35:22:00 · ends 07:35:22:00')).toBeVisible();

  // details of a row, a linked break and a block
  await rows.nth(6).getByRole('button', { name: 'Strong Fit - 255' }).click();
  const program = page.getByRole('complementary', { name: 'Program' });
  await expect(program).toContainText('06:20:22:00');
  await expect(program).toContainText('00:45:00:00');
  await expect(program.getByLabel('TC out')).toHaveValue('01:05:00:00');
  await expect(program).toContainText('Fitness shows');
  await expect(program).toContainText('255');
  await expect(program.getByRole('button', { name: 'Remove' })).toBeEnabled();
  await rows.nth(4).getByRole('button', { name: 'Ident_E2E_27_May' }).click();
  await expect(page.getByRole('complementary', { name: 'Ident' })).toContainText('Ad Pod 06:30');
  await first.getByRole('button', { name: /^06:00/ }).click();
  const blockPanel = page.getByRole('complementary', { name: 'Block' });
  await expect(blockPanel).toContainText('Over 00:05:22:00');
  await blockPanel.getByRole('button', { name: 'Close panel' }).click();
  await expect(blockPanel).toBeHidden();

  // view: gaps and collapsing
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show gaps' }).click();
  await page.keyboard.press('Escape');
  await expect(second).not.toContainText('Gap of 00:30:00:00');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Collapse all blocks' }).click();
  await expect(table(page).getByRole('row')).toHaveCount(1); // the column heads
  await first.getByRole('button', { name: 'Expand the 06:00 block' }).click();
  await expect(first.getByRole('row')).toHaveCount(8);

  // from a linked break to the ads playlist of the same day
  await rows.nth(3).getByRole('button', { name: 'Ad Pod 06:30' }).click();
  await page.getByRole('complementary', { name: 'Linked break' }).getByRole('button', { name: 'Open the ads playlist' }).click();
  await expect(page.getByRole('table', { name: 'Ads playlist of Sat 1 Jun 2030' })).toBeVisible();
  await expect(page.getByText('Times in the ads playlist run on from the start of the day.')).toBeVisible();
  await expect(table(page).getByRole('rowgroup')).toHaveCount(48);
  await expect(page.getByText('Spots placed 00:00:00:00 in 48 breaks')).toBeVisible();
  await expect(sidebar(page).getByRole('button', { name: /^Auto-place ads/ })).toBeEnabled(); // built in Orders part C
});

test('a day is approved and reopened; the weeks show it', async ({ page }) => {
  await createWeek(page, 'E2E TV', '2030-06', 22);
  await goto(page, { tab: 'day', date: '2030-06-02' });
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Day approved')).toBeVisible();
  await expect(page.getByText('This day is approved, so it is read-only. Reopen it to change it.')).toBeVisible();
  await expect(sidebar(page).getByRole('button', { name: /^Item/ })).toContainText('Reopen the day first');
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeHidden();

  await page.getByRole('tab', { name: 'Weeks' }).click();
  await goto(page, { month: '2030-06' });
  await expect(page.getByRole('button', { name: 'Sun 2 Jun 2030, approved, 2 blocks' })).toBeVisible();
  await page.getByRole('button', { name: 'Sun 2 Jun 2030, approved, 2 blocks' }).click();
  await page.getByRole('status').getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('Day reopened')).toBeVisible();
  await expect(page.getByText('This day is approved')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
});

test('a day without a week offers to create it; the date steps day by day', async ({ page }) => {
  await pickChannel(page, 'E2E TV');
  await goto(page, { tab: 'day', date: '2030-06-10' });
  await expect(page.getByText('No week has been created for Mon 10 Jun 2030 in this playlist')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Create this week' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create weeks' });
  await expect(dialog.getByLabel('From week')).toHaveValue('8 – 14 Jun 2030');
  await dialog.getByRole('button', { name: 'Create 1 week' }).click();
  await expect(page.getByRole('table', { name: 'Main playlist of Mon 10 Jun 2030' })).toBeVisible();
  await expect(table(page).getByRole('rowgroup')).toHaveCount(0); // the template has no blocks on Monday

  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('table', { name: 'Main playlist of Sun 9 Jun 2030' })).toBeVisible();
  await expect(table(page).getByRole('rowgroup')).toHaveCount(2);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByText('No week has been created for Fri 7 Jun 2030 in this playlist')).toBeVisible();
});

test('a 29.97 drop-frame channel shows its times with a semicolon; a main-only channel has one playlist', async ({ page }) => {
  await createWeek(page, 'E2E DF', '2026-12', 49);
  await page.getByRole('button', { name: 'Mon 7 Dec 2026, draft, 1 block' }).click();
  await expect(page.getByRole('table', { name: 'Main playlist of Mon 7 Dec 2026' })).toBeVisible();
  await expect(block(page, '06:00 Morning Show')).toContainText(/Gap 01:00:00;\d\d/);
  await expect(page.getByRole('group', { name: 'Playlist', exact: true })).toBeHidden();
  await expect(sidebar(page).getByRole('group', { name: 'Pull into this day' })).toContainText('Break events');
});

test('a day exports to Playout XML: the saved main playlist as the playout file', async ({ page }) => {
  await createWeek(page, 'E2E TV', '2030-06', 22);
  await fillDay('2030-06-01');
  await goto(page, { tab: 'day', date: '2030-06-01' });
  await expect(block(page, '06:00 Run Block 1').getByRole('row')).toHaveCount(8);

  await page.getByRole('button', { name: 'More actions' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Export to Playout XML' }).click()]);
  expect(download.suggestedFilename()).toBe('2030_06_01_06_00_00.xml');
  const lines = (await readFile((await download.path())!, 'utf8')).split('\n');
  const id = playoutXmlFirstItemId('2030-06-01');
  // the programme in two parts around the Ad Pod, its two spots between them, then block 2; the note,
  // the linked breaks and the gap rows are not in the file
  expect(lines.slice(2)).toEqual([
    `  <ITEM type="video_clip" file="M:\\FTP\\Strong Fit\\SF-255.mp4" id="${id}" inp="0" outp="1200" duration="1200" title="Strong Fit - 255" color="$64748b" category="Program" star="" notes="" />`,
    `  <ITEM type="video_clip" file="" id="${id + 1}" inp="0" outp="15" duration="15" title="Ident_E2E_27_May" color="" category="" star="" notes="" />`,
    `  <ITEM type="video_clip" file="" id="${id + 2}" inp="0" outp="7" duration="7" title="Instagram_Social" color="" category="" star="" notes="" />`,
    `  <ITEM type="video_clip" file="M:\\FTP\\Strong Fit\\SF-255.mp4" id="${id + 3}" inp="1200" outp="3900" duration="2700" title="Strong Fit - 255" color="$64748b" category="Program" star="" notes="" />`,
    `  <ITEM type="video_clip" file="" id="${id + 4}" inp="0" outp="1800" duration="1800" title="Strong Fit - 256" color="$64748b" category="" star="" notes="" />`,
    '</PBPlaylist>',
    '',
  ]);
  expect(lines[1]).toMatch(/^<PBPlaylist   id="\d+" name="[a-z0-9_]+_2030_06_01\.xml - 06:00:00:00">$/);
  // rows without a playout file are named
  await expect(page.getByText('2030_06_01_06_00_00.xml: 5 items. 3 items have no playout file: Ident_E2E_27_May, Instagram_Social, Strong Fit - 256')).toBeVisible();

  // unsaved changes: the file is made from the saved day
  await block(page, '06:00 Run Block 1').getByRole('checkbox', { name: 'Tick Check the subtitles' }).check();
  await page.getByRole('region', { name: 'Selection' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export to Playout XML' })).toBeDisabled();
});

test('rows move by drag and drop: to another block, a break with its spots, into a break; one Undo each', async ({ page }) => {
  await createWeek(page, 'E2E TV', '2030-06', 22);
  await fillDay('2030-06-01');
  await goto(page, { tab: 'day', date: '2030-06-01' });
  const b1 = block(page, '06:00 Run Block 1');
  const b2 = block(page, '07:00 Run Block 2');
  await expect(b1.getByRole('row')).toHaveCount(8);
  const lower = async (target: ReturnType<typeof row>) => ({ x: 300, y: ((await target.boundingBox())?.height ?? 32) - 4 });

  // the note goes below Strong Fit - 256, in block 2
  const sf256 = b2.getByRole('row').filter({ hasText: 'Strong Fit - 256' });
  await row(page, 'Check the subtitles').dragTo(sf256, { targetPosition: await lower(sf256) });
  await expect(b2.getByRole('row').nth(1)).toContainText('Check the subtitles');
  await expect(b1.getByRole('row')).toHaveCount(7);
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  // the Ad Pod break with its two spots onto block 2's header: at the block's end, still linked
  await row(page, 'Ad Pod 06:30').first().dragTo(b2.getByRole('button', { name: /Run Block 2/ }));
  await expect(b1.getByRole('row')).toHaveCount(4);
  await expect(b2.getByRole('row').nth(2)).toContainText('Ad Pod 06:30');
  await expect(b2.getByRole('row').nth(3)).toContainText('Ident_E2E_27_May');
  await expect(b2.getByRole('row').nth(4)).toContainText('Instagram_Social');
  await expect(b2.getByRole('row').nth(4)).toContainText('Ad Pod 06:30'); // the Break column: still its spot

  // a programme dropped under the break asks to link
  const lastSpot = b2.getByRole('row').filter({ hasText: 'Instagram_Social' });
  await row(page, 'Strong Fit - 256').dragTo(lastSpot, { targetPosition: await lower(lastSpot) });
  const ask = page.getByRole('dialog', { name: 'Link to Ad Pod 06:30?' });
  await ask.getByRole('button', { name: 'Move without linking' }).click();
  await expect(b2.getByRole('row').nth(4)).toContainText('Strong Fit - 256');
  await expect(b2.getByRole('row').nth(4)).not.toContainText('Ad Pod 06:30');

  // the grip moves a row with the arrow keys (the note is first in block 2 now)
  await expect(b2.getByRole('row').nth(0)).toContainText('Check the subtitles');
  await row(page, 'Check the subtitles').getByRole('button', { name: 'Move row' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(b2.getByRole('row').nth(1)).toContainText('Check the subtitles');

  // one Undo step each
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(b2.getByRole('row').nth(0)).toContainText('Check the subtitles');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(b2.getByRole('row').nth(0)).toContainText('Strong Fit - 256');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(b1.getByRole('row')).toHaveCount(7);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(b1.getByRole('row')).toHaveCount(8);
  await expect(page.getByText('Unsaved changes')).toBeHidden();
});
