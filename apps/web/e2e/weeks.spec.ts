// Playlist page, Weeks tab (docs/design/weeks-page.md): the month as a table of the channel's weeks,
// Create weeks (one or a run, all-or-nothing), Rename, Delete (refused while in use), the Day tab's
// placeholder, a main-only channel and channels whose week starts on Monday / Sunday.

import { expect, test, type Page } from '@playwright/test';
import { SLUG, disconnect, makeCompany, publishDay, removeCompany, signIn } from './fixture';

test.beforeEach(async ({ page }) => {
  await makeCompany();
  await signIn(page);
  await page.addInitScript((slug) => localStorage.setItem('9eye.company', slug), SLUG);
});

test.afterAll(async () => {
  await removeCompany();
  await disconnect();
});

/** Opens the Weeks tab of a channel on a month ("2030-06"). */
async function openWeeks(page: Page, channel: string, month: string) {
  await page.goto('/playlist');
  await page.getByRole('button', { name: /^Channel:/ }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: channel, exact: true }).click();
  await expect(page.getByRole('button', { name: `Channel: ${channel}` })).toBeVisible();
  const url = new URL(page.url());
  url.searchParams.set('month', month);
  await page.goto(url.toString());
  await expect(page.getByRole('button', { name: `Channel: ${channel}` })).toBeVisible();
}

const table = (page: Page) => page.getByRole('region', { name: /^Weeks of / });
const week = (page: Page, n: number) => table(page).getByRole('group', { name: `Week ${n}`, exact: true });
const months = (page: Page) => page.getByRole('complementary', { name: 'Months' });

async function createOne(page: Page, n: number) {
  await week(page, n).getByRole('button', { name: `Create week ${n}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Create weeks' });
  await dialog.getByRole('button', { name: 'Create 1 week' }).click();
  await expect(dialog).toBeHidden();
}

test('a month lists the channel’s weeks; one week is created for both playlists', async ({ page }) => {
  await openWeeks(page, 'E2E TV', '2030-06');
  await expect(page.getByText('0 of 5 weeks created · main playlist')).toBeVisible();
  await expect(table(page).getByRole('group')).toHaveCount(5);
  await expect(week(page, 22)).toContainText('No week yet');
  await expect(months(page).getByRole('button', { name: /^June/ })).toContainText('0 of 5');
  await expect(months(page).getByRole('button', { name: /^June/ })).toHaveAttribute('aria-pressed', 'true');

  await week(page, 22).getByRole('button', { name: 'Create week 22' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create weeks' });
  await expect(dialog.getByLabel('From week')).toHaveValue('1 – 7 Jun 2030');
  await expect(dialog.getByText('1 week: week 22, 1 – 7 Jun 2030.')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Main playlist' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Ads playlist' })).toBeChecked();
  await expect(dialog.getByText('E2E MAIN')).toBeVisible();
  await expect(dialog.getByText('E2E ADS')).toBeVisible();
  const names = dialog.getByRole('group', { name: 'Names of the new weeks' });
  await expect(names).toContainText('Week 22 2030 E2E TV M');
  await expect(names).toContainText('Week 22 2030 E2E TV Ads');
  await expect(dialog.getByRole('group', { name: 'Checks' })).toContainText('None of these weeks exists yet.');
  await dialog.getByRole('button', { name: 'Create 1 week' }).click();
  await expect(page.getByText('1 week created')).toBeVisible();
  await expect(dialog).toBeHidden();

  await expect(week(page, 22)).toContainText('Week 22 2030 E2E TV M');
  await expect(week(page, 22).getByRole('button', { name: 'Sat 1 Jun 2030, draft, 2 blocks' })).toBeVisible();
  await expect(week(page, 22).getByRole('button', { name: 'Sun 2 Jun 2030, draft, 2 blocks' })).toBeVisible();
  await expect(week(page, 22).getByRole('button', { name: 'Mon 3 Jun 2030, draft, 0 blocks' })).toBeVisible();
  await expect(page.getByText('1 of 5 weeks created · main playlist')).toBeVisible();
  await expect(months(page).getByRole('button', { name: /^June/ })).toContainText('1 of 5');

  // the ads playlist got its own week of the same dates
  await page.getByRole('group', { name: 'Playlist' }).getByRole('button', { name: 'Ads playlist' }).click();
  await expect(week(page, 22)).toContainText('Week 22 2030 E2E TV Ads');
  await expect(week(page, 22).getByRole('button', { name: 'Sat 1 Jun 2030, draft, 48 blocks' })).toBeVisible();
  await expect(week(page, 22).getByRole('button', { name: 'Sun 2 Jun 2030, draft, 46 blocks' })).toBeVisible();
});

test('a run of weeks is created at once; a week that exists stops the whole run', async ({ page }) => {
  await openWeeks(page, 'E2E TV', '2030-06');
  await createOne(page, 22);

  // the header button starts with the month's first week without one
  await page.getByRole('button', { name: 'Create weeks', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create weeks' });
  await expect(dialog.getByLabel('From week')).toHaveValue('8 – 14 Jun 2030');
  const to = dialog.getByLabel('To week');
  await to.fill('22 Jun 2030');
  await to.press('Enter');
  await expect(to).toHaveValue('22 – 28 Jun 2030');
  await expect(dialog.getByText('3 weeks: week 23 to week 25, 8 – 28 Jun 2030.')).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Names of the new weeks' })).toContainText('+ 2 more');
  await dialog.getByRole('button', { name: 'Create 3 weeks' }).click();
  await expect(page.getByText('3 weeks created')).toBeVisible();
  await expect(page.getByText('4 of 5 weeks created · main playlist')).toBeVisible();
  await expect(week(page, 25)).toContainText('Week 25 2030 E2E TV M');
  await expect(week(page, 26)).toContainText('No week yet');

  // week 22 to 26: four of them exist, so nothing can be created
  await page.getByRole('button', { name: 'Create weeks', exact: true }).click();
  await expect(dialog.getByLabel('From week')).toHaveValue('29 Jun – 5 Jul 2030');
  const from = dialog.getByLabel('From week');
  await from.fill('1 Jun 2030');
  await from.press('Enter');
  await expect(dialog.getByText('Nothing is created until this is solved:')).toBeVisible();
  await expect(dialog.getByText('Week 22 (1 Jun 2030) already exists in the main playlist.')).toBeVisible();
  await expect(dialog.getByText('And 2 more.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create 5 weeks' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(week(page, 26)).toContainText('No week yet');

  // only one playlist: the ads box off
  await week(page, 26).getByRole('button', { name: 'Create week 26' }).click();
  await dialog.getByRole('checkbox', { name: 'Ads playlist' }).uncheck();
  await expect(dialog.getByRole('group', { name: 'Names of the new weeks' })).not.toContainText('Ads');
  await dialog.getByRole('button', { name: 'Create 1 week' }).click();
  await expect(page.getByText('5 of 5 weeks created · main playlist')).toBeVisible();
  await page.getByRole('group', { name: 'Playlist' }).getByRole('button', { name: 'Ads playlist' }).click();
  await expect(page.getByText('4 of 5 weeks created · ads playlist')).toBeVisible();
});

test('a week is renamed and deleted from its menu; a week in use stays', async ({ page }) => {
  await openWeeks(page, 'E2E TV', '2030-06');
  await createOne(page, 22);

  await week(page, 22).getByRole('button', { name: 'Actions for week 22' }).click();
  await expect(page.getByRole('menuitem', { name: 'Open week' })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename week 22' });
  await expect(rename.getByLabel('Name')).toHaveValue('Week 22 2030 E2E TV M');
  await expect(rename.getByRole('button', { name: 'Rename' })).toBeDisabled();
  await rename.getByLabel('Name').fill('Eid special');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByText('Week renamed')).toBeVisible();
  await expect(week(page, 22)).toContainText('Eid special');

  // published on Saturday: the ads week cannot go
  await publishDay('2030-06-01');
  await page.reload();
  await expect(week(page, 22).getByRole('button', { name: 'Sat 1 Jun 2030, approved, 2 blocks' })).toBeVisible();
  await week(page, 22).getByRole('button', { name: 'Actions for week 22' }).click();
  await page.getByRole('menuitem', { name: 'Delete week…' }).click();
  const del = page.getByRole('dialog', { name: 'Delete week 22?' });
  await expect(del).toContainText('Eid special (1 – 7 Jun 2030) is removed with its 7 day playlists.');
  await del.getByRole('button', { name: 'Delete week' }).click();
  await expect(del.getByText('This week is in use: nothing was deleted.')).toBeVisible();
  await expect(del.getByText('Sat 1 Jun 2030 is approved.')).toBeVisible();
  await expect(del.getByRole('button', { name: 'Delete week' })).toBeDisabled();
  await del.getByRole('button', { name: 'Cancel' }).click();
  await expect(week(page, 22)).toContainText('Eid special');

  // a week nothing uses is deleted, and can be created again
  await createOne(page, 23);
  await week(page, 23).getByRole('button', { name: 'Actions for week 23' }).click();
  await page.getByRole('menuitem', { name: 'Delete week…' }).click();
  await page.getByRole('dialog', { name: 'Delete week 23?' }).getByRole('button', { name: 'Delete week' }).click();
  await expect(page.getByText('Week deleted')).toBeVisible();
  await expect(week(page, 23)).toContainText('No week yet');
  await expect(week(page, 23).getByRole('button', { name: 'Create week 23' })).toBeVisible();
});

test('a day opens the Day tab on that date; the Weeks tab comes back to the month', async ({ page }) => {
  await openWeeks(page, 'E2E TV', '2030-06');
  await createOne(page, 22);
  await week(page, 22).getByRole('button', { name: 'Sun 2 Jun 2030, draft, 2 blocks' }).click();
  await expect(page.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('table', { name: 'Main playlist of Sun 2 Jun 2030' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create weeks', exact: true })).toBeHidden();
  await page.getByRole('tab', { name: 'Weeks' }).click();
  await expect(page.getByRole('tab', { name: 'Weeks' })).toHaveAttribute('aria-selected', 'true');
  await expect(week(page, 22)).toContainText('Week 22 2030 E2E TV M');
});

test('the month follows each channel’s own week; a main-only channel has no ads playlist', async ({ page }) => {
  // week from Monday, main only
  await openWeeks(page, 'E2E PUBLIC', '2026-12');
  await expect(page.getByRole('group', { name: 'Playlist' })).toBeHidden();
  await expect(table(page).getByRole('group')).toHaveCount(4);
  await expect(table(page)).toContainText('Mon');
  await expect(week(page, 50)).toContainText('7 Dec');
  await week(page, 50).getByRole('button', { name: 'Create week 50' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create weeks' });
  await expect(dialog.getByRole('group', { name: 'Playlists' })).toBeHidden();
  await expect(dialog.getByLabel('From week')).toHaveValue('7 – 13 Dec 2026');
  await expect(dialog.getByText('Public Autumn')).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Names of the new weeks' })).toHaveText('Week 50 2026 E2E PUBLIC M');
  await dialog.getByRole('button', { name: 'Create 1 week' }).click();
  await expect(week(page, 50).getByRole('button', { name: 'Mon 7 Dec 2026, draft, 1 block' })).toBeVisible();
  await expect(week(page, 50).getByRole('button', { name: 'Tue 8 Dec 2026, draft, 0 blocks' })).toBeVisible();

  // a day switched off gets no playlist
  await week(page, 51).getByRole('button', { name: 'Create week 51' }).click();
  await dialog.getByRole('group', { name: 'Active days' }).getByRole('button', { name: 'Sunday' }).click();
  await dialog.getByRole('button', { name: 'Create 1 week' }).click();
  await expect(week(page, 51).getByRole('img', { name: 'Sun 20 Dec 2026, not active' })).toBeVisible();
  await expect(week(page, 51).getByRole('button', { name: 'Sat 19 Dec 2026, draft, 0 blocks' })).toBeVisible();

  // week from Sunday, 29.97 drop-frame
  await openWeeks(page, 'E2E DF', '2026-12');
  await expect(page.getByText('Week starts Sunday')).toBeVisible();
  await expect(table(page).getByRole('group')).toHaveCount(4);
  await expect(week(page, 49)).toContainText('6 Dec');
  await createOne(page, 49);
  await expect(week(page, 49)).toContainText('Week 49 2026 E2E DF M');
  await expect(week(page, 49).getByRole('button', { name: 'Mon 7 Dec 2026, draft, 1 block' })).toBeVisible();
});
