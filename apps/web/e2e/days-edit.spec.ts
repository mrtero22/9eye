// Playlist page, Day tab, part 2 (docs/design/day-playlist-page.md): changing a day by hand — add
// from the catalog, notes, jingles, linked breaks, the link question, move, cut / paste, delete,
// TC in / out, Undo / Redo, Save, leaving with unsaved changes, and a published day.

import { expect, test, type Page } from '@playwright/test';
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

/** E2E TV, week 22 of 2030 (both playlists), and the Day tab on Saturday 1 June. */
async function openSaturday(page: Page, fill = false) {
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
  if (fill) await fillDay('2030-06-01');
  url.searchParams.set('tab', 'day');
  url.searchParams.set('date', '2030-06-01');
  await page.goto(url.toString());
  await expect(page.getByRole('table', { name: 'Main playlist of Sat 1 Jun 2030' })).toBeVisible();
}

const table = (page: Page) => page.getByRole('table');
const block = (page: Page, name: string) => table(page).getByRole('rowgroup', { name });
const rowsOf = (page: Page, name: string) => block(page, name).getByRole('row');
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Add to playlist' });
const add = (page: Page, what: string) => sidebar(page).getByRole('button', { name: new RegExp(`^${what}`) }).first().click(); // Add comes before Import
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A row's button is named by its kind mark and its title ("Program Bright Lanes - 1"). */
const selectRow = (page: Page, blockName: string, title: string) => block(page, blockName).getByRole('button', { name: new RegExp(`(^| )${esc(title)}$`) }).first().click();
const B1 = '06:00 Run Block 1';
const B2 = '07:00 Run Block 2';

/** Picks items in the open catalog picker: a kind, a content, then its items. */
async function pickItems(page: Page, dialog: string, kind: string | null, content: string, items: RegExp[]) {
  const picker = page.getByRole('dialog', { name: dialog });
  if (kind) await picker.getByRole('group', { name: 'Kind' }).getByRole('button', { name: kind }).click();
  await picker.getByRole('option', { name: new RegExp(`^${content}`) }).click();
  for (const i of items) await picker.getByRole('option', { name: i }).click();
  await picker.getByRole('button', { name: items.length === 1 ? 'Add 1 item' : `Add ${items.length} items` }).click();
  await expect(picker).toBeHidden();
}

test('title, a note and a spot under a linked break are added by hand, undone, redone and saved', async ({ page }) => {
  await openSaturday(page);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  // at the end of block 1: two episodes from the catalog
  await block(page, B1).getByRole('button', { name: /^06:00/ }).click();
  await expect(sidebar(page).getByRole('group', { name: 'Add at the end of the block' })).toBeVisible();
  await add(page, 'Item');
  await pickItems(page, 'Add item', null, 'Bright Lanes', [/Bright Lanes - 1(?!\d)/, /Bright Lanes - 2(?!\d)/]);
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await expect(rowsOf(page, B1)).toHaveCount(5);
  await expect(rowsOf(page, B1).nth(2)).toContainText('06:00:00:00');
  await expect(rowsOf(page, B1).nth(2)).toContainText('Bright Lanes - 1');
  await expect(rowsOf(page, B1).nth(3)).toContainText('06:40:00:00');
  await expect(rowsOf(page, B1).nth(4)).toContainText('Gap holder'); // stays last
  await expect(block(page, B1)).toContainText('Over 00:20:00:00');
  await expect(page.getByText('Day runs 01:20:00:00 · ends 07:20:00:00')).toBeVisible();

  // after the first episode: a note
  await selectRow(page, B1, 'Bright Lanes - 1');
  await expect(sidebar(page).getByRole('group', { name: 'Add after the selected row' })).toBeVisible();
  await add(page, 'Note');
  const note = page.getByRole('dialog', { name: 'Add a note' });
  await note.getByLabel('Note').fill('Check the subtitles');
  await note.getByRole('button', { name: 'Add note' }).click();
  await expect(rowsOf(page, B1).nth(3)).toContainText('Check the subtitles');
  await expect(rowsOf(page, B1).nth(3)).toContainText('06:40:00:00');

  // at the Ad Pod break: a commercial, linked as its spot
  await selectRow(page, B1, 'Ad Pod 06:30');
  await add(page, 'Item');
  await pickItems(page, 'Add item', 'Ads', '15 OCT 2026', [/ENT-081/]);
  const ask = page.getByRole('dialog', { name: 'Link to Ad Pod 06:30?' });
  await ask.getByRole('button', { name: 'Insert and link' }).click();
  const spot = rowsOf(page, B1).nth(2);
  await expect(spot).toContainText('[ENT-081]_[P-C] - 0');
  await expect(spot).toContainText('Ad Pod 06:30'); // the Break column
  await expect(rowsOf(page, B1).nth(1)).toContainText('00:00:30:00'); // the break's filled length
  await expect(rowsOf(page, B1).nth(1)).toContainText('linked break');
  await expect(rowsOf(page, B1).nth(3)).toContainText('06:00:30:00'); // Bright Lanes - 1 moved on by the spot

  // undo takes the spot out, redo puts it back
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rowsOf(page, B1)).toHaveCount(6);
  await expect(rowsOf(page, B1).nth(1)).toContainText('empty');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(rowsOf(page, B1)).toHaveCount(7);

  // Publish waits for the save; Save keeps it all
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Day saved')).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toBeHidden();
  await page.reload();
  await expect(rowsOf(page, B1)).toHaveCount(7);
  await expect(rowsOf(page, B1).nth(2)).toContainText('Ad Pod 06:30');
  await expect(rowsOf(page, B1).nth(4)).toContainText('Check the subtitles');
  await expect(block(page, B1)).toContainText('Over 00:20:30:00');

  // the week shows the day's blocks; a day that holds rows keeps its week
  await page.getByRole('tab', { name: 'Weeks' }).click();
  await page.getByRole('group', { name: 'Week 22', exact: true }).getByRole('button', { name: 'Actions for week 22' }).click();
  await page.getByRole('menuitem', { name: 'Delete week…' }).click();
  const del = page.getByRole('dialog', { name: 'Delete week 22?' });
  await del.getByRole('button', { name: 'Delete week' }).click();
  await expect(del.getByText('Sat 1 Jun 2030 holds 4 placed events.')).toBeVisible();
});

test('rows are moved, cut and pasted, deleted and trimmed; a linked break and stings are added', async ({ page }) => {
  await openSaturday(page, true);
  await expect(rowsOf(page, B1)).toHaveCount(8);

  // tick the two spots of the Ad Pod break, cut them, paste them at the end of block 2
  await block(page, B1).getByRole('checkbox', { name: 'Tick Ident_E2E_27_May' }).check();
  await block(page, B1).getByRole('checkbox', { name: 'Tick Instagram_Social' }).check();
  const bar = page.getByRole('region', { name: 'Selection' });
  await expect(bar).toContainText('2 rows ticked');
  await expect(bar).toContainText('00:00:22:00');
  await bar.getByRole('button', { name: 'Cut' }).click();
  await expect(rowsOf(page, B1)).toHaveCount(6);
  await expect(rowsOf(page, B1).nth(3)).toContainText('empty');
  await block(page, B2).getByRole('button', { name: /^07:00/ }).click();
  await add(page, 'Paste 2 rows');
  await expect(rowsOf(page, B2)).toHaveCount(4);
  await expect(rowsOf(page, B2).nth(1)).toContainText('Ident_E2E_27_May');
  await expect(rowsOf(page, B2).nth(1)).not.toContainText('Ad Pod 06:30'); // no longer a spot
  await expect(sidebar(page).getByRole('button', { name: /^Paste/ })).toBeHidden(); // a cut is pasted once

  // move the note down: it goes under the break, which it never belongs to
  await selectRow(page, B1, 'Check the subtitles');
  const notePanel = page.getByRole('complementary', { name: 'Note' });
  await notePanel.getByRole('button', { name: 'Move down' }).click();
  await expect(rowsOf(page, B1).nth(3)).toContainText('Check the subtitles');
  await expect(notePanel.getByRole('button', { name: 'Move up' })).toBeEnabled();
  // and it is deleted from its panel
  await notePanel.getByRole('button', { name: 'Remove' }).click();
  await expect(rowsOf(page, B1)).toHaveCount(5);

  // trim the episode of block 2 to 20 minutes with TC out
  await selectRow(page, B2, 'Strong Fit - 256');
  const panel = page.getByRole('complementary', { name: 'Program' });
  const tcOut = panel.getByLabel('TC out');
  await tcOut.fill('00:20:00:00');
  await tcOut.press('Enter');
  await expect(rowsOf(page, B2).nth(0)).toContainText('00:20:00:00');
  await expect(block(page, B2)).toContainText('00:20:22:00 / 01:00:00:00');
  await tcOut.fill('00:00:00:00');
  await tcOut.press('Enter');
  await expect(panel.getByText('TC out must be after TC in.')).toBeVisible();
  await panel.getByRole('switch', { name: 'Hold' }).click();

  // a linked break at the end of block 2, picked from the ads playlist
  await block(page, B2).getByRole('button', { name: /^07:00/ }).click();
  await add(page, 'Linked break');
  const breaks = page.getByRole('dialog', { name: 'Add a linked break' });
  await breaks.getByRole('searchbox', { name: 'Search breaks' }).fill('07:');
  await breaks.getByRole('button', { name: /^Billboard 1 07:00/ }).click();
  await expect(rowsOf(page, B2).nth(3)).toContainText('Billboard 1 07:00');
  // block 1 already links Billboard 1 06:00: it cannot be picked there again
  await block(page, B1).getByRole('button', { name: /^06:00/ }).click();
  await add(page, 'Linked break');
  await breaks.getByRole('searchbox', { name: 'Search breaks' }).fill('Billboard 1 06');
  await expect(breaks.getByRole('button', { name: /^Billboard 1 06:00/ })).toBeDisabled();
  await breaks.getByRole('button', { name: 'Close' }).click();

  // jingles at the end of block 1 come from the fillers
  await add(page, 'Stings');
  await pickItems(page, 'Add stings', null, 'Lumen Plus', [/LumenPlus_Ident_1/]);
  await expect(rowsOf(page, B1).nth(4)).toContainText('LumenPlus_Ident_1');
  // a new row is selected right away: its panel is open
  await expect(page.getByRole('complementary', { name: 'Sting' })).toContainText('Idents');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Day saved')).toBeVisible();
  await page.reload();
  await expect(rowsOf(page, B2)).toHaveCount(5);
  await expect(rowsOf(page, B2).nth(0)).toContainText('00:20:00:00');
  await expect(rowsOf(page, B2).nth(3)).toContainText('Billboard 1 07:00');
  await expect(rowsOf(page, B1).nth(4)).toContainText('LumenPlus_Ident_1');
});

test('unsaved changes are asked about before leaving; an approved day cannot be changed', async ({ page }) => {
  await openSaturday(page, true);
  await block(page, B1).getByRole('checkbox', { name: 'Tick Check the subtitles' }).check();
  await page.getByRole('region', { name: 'Selection' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Unsaved changes')).toBeVisible();

  // another day: asked first; staying keeps the change
  await page.getByRole('button', { name: 'Next day' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  await leave.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('table', { name: 'Main playlist of Sat 1 Jun 2030' })).toBeVisible();
  await expect(rowsOf(page, B1)).toHaveCount(7);
  // the Weeks tab: dropping the change goes there
  await page.getByRole('tab', { name: 'Weeks' }).click();
  await leave.getByRole('button', { name: 'Drop the changes' }).click();
  await expect(page.getByRole('tab', { name: 'Weeks' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /^Sat 1 Jun 2030, draft/ }).click();
  await expect(rowsOf(page, B1)).toHaveCount(8);

  // published: read-only until unpublished
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Day approved')).toBeVisible();
  await selectRow(page, B1, 'Strong Fit - 255');
  await expect(sidebar(page).getByRole('button', { name: /^Note/ })).toBeDisabled();
  await expect(sidebar(page).getByRole('button', { name: /^Note/ })).toContainText('Reopen the day first');
  await expect(page.getByRole('complementary', { name: 'Program' }).getByRole('button', { name: 'Remove' })).toBeDisabled();
  await block(page, B1).getByRole('checkbox', { name: 'Tick Instagram_Social' }).check();
  await expect(page.getByRole('region', { name: 'Selection' }).getByRole('button', { name: 'Delete' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Selection' }).getByRole('button', { name: 'Copy' })).toBeEnabled();
});
