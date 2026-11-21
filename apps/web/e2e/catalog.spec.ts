// The Catalog page, end to end (docs/design/catalog-page.md "Done when"): create / create from
// template / save, create series, the bulk-edit limit, delete refused while used, regenerate a
// segmentation, advanced search, every Relations tab, rotation lists (add, clone, shuffle).

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

const col = (page: Page, title: string) => page.getByRole('region', { name: title });
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A row of a column by its name (the meta on the right follows it). */
const row = (page: Page, column: string, name: string) => col(page, column).getByRole('button', { name: new RegExp(`^${esc(name)}( |$)`) });
const form = (page: Page, entity: string) => page.getByRole('complementary', { name: `${entity} form` });

async function open(page: Page, ...path: [string, string][]) {
  await page.goto('/catalog');
  for (const [column, name] of path) {
    await row(page, column, name).click();
    await expect(row(page, column, name)).toHaveAttribute('aria-pressed', 'true');
  }
}

async function menu(page: Page, column: string, item: string) {
  await col(page, column).getByRole('button', { name: `${column} actions` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('create a category, create an item from a layout, save an item', async ({ page }) => {
  await open(page);
  await col(page, 'Categories').getByRole('button', { name: 'Create', exact: true }).click();
  const ctForm = form(page, 'Category');
  await expect(ctForm.getByText('New category')).toBeVisible();
  await ctForm.getByRole('textbox', { name: /^Name/ }).fill('Movies Hollywood');
  await ctForm.getByRole('textbox', { name: /^Id/ }).fill('MoviesHollywood');
  await ctForm.getByRole('switch', { name: 'Show in grid' }).click();
  await ctForm.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Category created')).toBeVisible();
  await expect(row(page, 'Categories', 'Movies Hollywood')).toHaveAttribute('aria-pressed', 'true');

  // from a template: the ticked production's fields, "(copy)"
  await row(page, 'Categories', 'TV Series Drama').click();
  await row(page, 'Titles', 'Harbor Nights').click();
  await col(page, 'Items').getByRole('checkbox', { name: 'Tick Harbor Nights - 2', exact: true }).check();
  await menu(page, 'Items', 'Create from layout');
  const pForm = form(page, 'Item');
  await expect(pForm.getByText('New item')).toBeVisible();
  await expect(pForm.getByRole('textbox', { name: /^Title/ })).toHaveValue('Harbor Nights - 2 (copy)');
  await expect(pForm.getByText('Unsaved')).toBeVisible();
  await pForm.getByRole('textbox', { name: /^Chapter/ }).fill('40');
  await pForm.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Item created')).toBeVisible();
  await expect(row(page, 'Items', 'Harbor Nights - 2 (copy)')).toBeVisible();

  // save: a description field and a custom field, then read back
  await row(page, 'Items', 'Harbor Nights - 4').click();
  await pForm.getByRole('button', { name: 'Description' }).click();
  await pForm.getByLabel('Genres').fill('Crime');
  await pForm.getByLabel('STAR', { exact: true }).fill('WAGNER MOURA');
  await expect(pForm.getByText('Unsaved')).toBeVisible();
  await pForm.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Item saved')).toBeVisible();
  await expect(pForm.getByText('Unsaved')).toBeHidden();
  await page.reload();
  await row(page, 'Categories', 'TV Series Drama').click();
  await row(page, 'Titles', 'Harbor Nights').click();
  await row(page, 'Items', 'Harbor Nights - 4').click();
  await expect(pForm.getByLabel('STAR', { exact: true })).toHaveValue('WAGNER MOURA');
  await pForm.getByRole('button', { name: 'Description' }).click();
  await expect(pForm.getByLabel('Genres')).toHaveValue('Crime');
});

test('create series: numbered episodes from the next free number', async ({ page }) => {
  await open(page, ['Categories', 'TV Series Drama'], ['Titles', 'Spider Noir']);
  await menu(page, 'Items', 'Create series');
  const dlg = page.getByRole('dialog', { name: 'Create series' });
  await expect(dlg.getByLabel('Initial episode')).toHaveValue('5');
  await dlg.getByLabel('Number of episodes').fill('3');
  await expect(dlg.getByText('Spider Noir - 7')).toBeVisible();
  await dlg.getByRole('button', { name: 'Create 3 items' }).click();
  await expect(page.getByText('3 items created in Spider Noir')).toBeVisible();
  await expect(row(page, 'Items', 'Spider Noir - 7')).toBeVisible();
  await expect(col(page, 'Items').getByText('7 results')).toBeVisible();
});

test('bulk edit: more than 50 ticked is refused; the ticked items are changed', async ({ page }) => {
  await open(page, ['Categories', 'TV Series Drama'], ['Titles', 'Night Desk 2020']);
  const prods = col(page, 'Items');
  await prods.getByRole('checkbox', { name: 'Tick all Items' }).check();
  await menu(page, 'Items', 'Bulk edit');
  let dlg = page.getByRole('dialog', { name: 'Bulk edit items' });
  await expect(dlg.getByText('You have ticked 55 items. Bulk edit takes at most 50; tick fewer.')).toBeVisible();
  await dlg.getByRole('checkbox', { name: 'Genres' }).check();
  await expect(dlg.getByRole('button', { name: 'Apply to 55' })).toBeDisabled();
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  await prods.getByRole('checkbox', { name: 'Tick all Items' }).uncheck();
  await prods.getByRole('checkbox', { name: 'Tick Night Desk 2020 - 1', exact: true }).check();
  await prods.getByRole('checkbox', { name: 'Tick Night Desk 2020 - 2', exact: true }).check();
  await menu(page, 'Items', 'Bulk edit');
  dlg = page.getByRole('dialog', { name: 'Bulk edit items' });
  await dlg.getByRole('checkbox', { name: 'Genres' }).check();
  await dlg.getByLabel('New value for Genres').fill('Crime');
  await dlg.getByRole('checkbox', { name: 'GRAPHICS' }).check();
  await dlg.getByLabel('New value for GRAPHICS').fill('SERIES');
  await dlg.getByRole('button', { name: 'Apply to 2' }).click();
  await expect(page.getByText('Bulk edit applied to 2 items')).toBeVisible();
  await row(page, 'Items', 'Night Desk 2020 - 2').click();
  const f = form(page, 'Item');
  await expect(f.getByLabel('GRAPHICS', { exact: true })).toHaveValue('SERIES');
  await f.getByRole('button', { name: 'Description' }).click();
  await expect(f.getByLabel('Genres')).toHaveValue('Crime');
});

test('delete: refused while a plan uses the items, otherwise they go', async ({ page }) => {
  await open(page, ['Categories', 'TV Series Drama'], ['Titles', 'Harbor Nights']);
  const prods = col(page, 'Items');
  await prods.getByRole('checkbox', { name: 'Tick Harbor Nights - 1', exact: true }).check();
  await menu(page, 'Items', 'Delete selected items');
  let dlg = page.getByRole('dialog', { name: 'Delete 1 item' });
  await expect(dlg.getByText('Used in plans or playlists')).toBeVisible();
  await expect(dlg.getByText(/Nothing is deleted while any of them is used/)).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  await row(page, 'Titles', 'Spider Noir').click();
  await prods.getByRole('checkbox', { name: 'Tick Spider Noir - 3', exact: true }).check();
  await prods.getByRole('checkbox', { name: 'Tick Spider Noir - 4', exact: true }).check();
  await menu(page, 'Items', 'Delete selected items');
  dlg = page.getByRole('dialog', { name: 'Delete 2 items' });
  await expect(dlg.getByText('Can be deleted')).toHaveCount(2);
  await dlg.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('2 items deleted')).toBeVisible();
  await expect(row(page, 'Items', 'Spider Noir - 4')).toBeHidden();
  await expect(prods.getByText('2 results')).toBeVisible();
});

test('cuts: regenerate replaces the parts; create adds one', async ({ page }) => {
  await open(page, ['Categories', 'TV Series Drama'], ['Titles', 'Harbor Nights'], ['Items', 'Harbor Nights - 1'], ['Cuts', 'HAR-1-1']);
  await expect(col(page, 'Parts').getByText('3 results')).toBeVisible();
  await expect(row(page, 'Parts', 'Part 3')).toContainText('00:30:00–00:45:00');
  await menu(page, 'Parts', 'Regenerate');
  const dlg = page.getByRole('dialog', { name: 'Regenerate cut' });
  await expect(dlg.getByText('Replaces the 3 parts of HAR-1-1 (now ending at 00:45:00:00).')).toBeVisible();
  await dlg.getByLabel('Number of parts').fill('4');
  await expect(dlg.getByText('00:33:45:00').first()).toBeVisible();
  await dlg.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByText('HAR-1-1 regenerated with 4 parts')).toBeVisible();
  await expect(col(page, 'Parts').getByText('4 results')).toBeVisible();
  await expect(row(page, 'Parts', 'Part 4')).toContainText('00:33:45–00:45:00');

  await col(page, 'Cuts').getByRole('button', { name: 'Create', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create cut' });
  await expect(create.getByLabel('Name', { exact: true })).toHaveValue('HAR-1-2');
  await create.getByRole('button', { name: 'Create cut' }).click();
  await expect(page.getByText('Cut created')).toBeVisible();
  await expect(col(page, 'Cuts').getByText('2 results')).toBeVisible();
});

test('advanced search and order by', async ({ page }) => {
  await open(page, ['Categories', 'TV Series Drama'], ['Titles', 'Harbor Nights']);
  const prods = col(page, 'Items');
  await expect(prods.getByText('13 results')).toBeVisible();
  await prods.getByRole('button', { name: 'Advanced search' }).click();
  const dlg = page.getByRole('dialog', { name: 'Advanced search · Items' });
  await dlg.getByLabel('Field', { exact: true }).selectOption('Duration');
  await dlg.getByLabel('Condition', { exact: true }).selectOption('empty');
  await dlg.getByRole('button', { name: 'Search' }).click();
  await expect(prods.getByText('2 results')).toBeVisible();
  await expect(row(page, 'Items', 'Harbor Nights - 3')).toContainText('no length');
  await expect(prods.getByRole('button', { name: /^Advanced search · Duration is empty/ })).toBeVisible();
  await prods.getByRole('button', { name: /^Advanced search/ }).click();
  await page.getByRole('dialog', { name: 'Advanced search · Items' }).getByRole('button', { name: 'Clear' }).click();
  await expect(prods.getByText('13 results')).toBeVisible();

  await prods.getByRole('button', { name: 'Order by' }).click();
  await page.getByRole('menuitem', { name: /^Chapter/ }).click();
  await prods.getByRole('button', { name: 'Order by' }).click();
  await page.getByRole('menuitem', { name: /^Chapter/ }).click();
  await expect(prods.getByText('Ordered by Chapter')).toBeVisible();
  await expect(prods.getByRole('listitem').first()).toContainText('Harbor Nights - 12');
});

test('relations: every tab, own rows saved, the title\'s rows inherited', async ({ page }) => {
  await open(page, ['Categories', 'TV Series Drama'], ['Titles', 'Harbor Nights']);
  // a time window on the content, inherited by its productions
  await col(page, 'Titles').getByRole('button', { name: 'Related items' }).click();
  let dlg = page.getByRole('dialog', { name: 'Related items' });
  await dlg.getByRole('tab', { name: 'Time windows' }).click();
  await dlg.getByRole('button', { name: 'Add time window' }).click();
  await expect(dlg.getByRole('tab', { name: /Time windows/ })).toContainText('!');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Related items saved')).toBeVisible();

  await row(page, 'Items', 'Harbor Nights - 1').click();
  await form(page, 'Item').getByRole('button', { name: 'Related items' }).click();
  dlg = page.getByRole('dialog', { name: 'Related items' });
  await expect(dlg.getByRole('tab')).toHaveText(['Bumpers', 'Graphics relations', 'Time windows', 'Linear rights', 'Broadcast history']);
  // linear: a jingle picked from the catalog
  await dlg.getByRole('button', { name: 'Add sting' }).click();
  const pick = page.getByRole('dialog', { name: 'Pick a sting' });
  await pick.getByRole('option', { name: /^Idents/ }).click();
  await pick.getByRole('option', { name: /^Lumen Plus/ }).click();
  await pick.getByRole('option', { name: /LumenPlus_Ident_1/ }).click();
  await pick.getByRole('button', { name: 'Pick' }).click();
  await expect(dlg.getByRole('button', { name: 'LumenPlus_Ident_1' })).toBeVisible();
  // graphics
  await dlg.getByRole('tab', { name: 'Graphics relations' }).click();
  await dlg.getByRole('button', { name: 'Add graphic' }).click();
  await expect(dlg.getByText('Time to end 00:00:40')).toBeVisible();
  // time windows: the inherited row and an own one
  await dlg.getByRole('tab', { name: 'Time windows' }).click();
  await expect(dlg.getByText('Yes')).toBeVisible();
  await dlg.getByRole('button', { name: 'Add time window' }).click();
  await expect(dlg.getByLabel('Time window')).toHaveValue(/.+/);
  // rights and history are read only
  await dlg.getByRole('tab', { name: 'Linear rights' }).click();
  await expect(dlg.getByText(/No rights bundles for this item/)).toBeVisible();
  await dlg.getByRole('tab', { name: 'Broadcast history' }).click();
  await expect(dlg.getByText(/Not broadcast yet/)).toBeVisible();
  await expect(dlg.getByRole('tab', { name: /Bumpers/ })).toContainText('!');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Related items saved')).toBeVisible();

  await form(page, 'Item').getByRole('button', { name: 'Related items' }).click();
  dlg = page.getByRole('dialog', { name: 'Related items' });
  await expect(dlg.getByRole('button', { name: 'LumenPlus_Ident_1' })).toBeVisible();
  await dlg.getByRole('tab', { name: 'Graphics relations' }).click();
  await expect(dlg.getByLabel('Graphic')).toHaveValue(/.+/);
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  // product codes only for advertising
  await row(page, 'Categories', '2026 OCT COMMERCIAL').click();
  await row(page, 'Titles', '15 OCT 2026').click();
  await col(page, 'Titles').getByRole('button', { name: 'Related items' }).click();
  dlg = page.getByRole('dialog', { name: 'Related items' });
  await dlg.getByRole('tab', { name: 'Product codes' }).click();
  await expect(dlg.getByText('No product codes defined in Settings.')).toBeVisible();
});

test('rotation lists: add items from the catalog, clone, shuffle', async ({ page }) => {
  await page.goto('/catalog');
  await page.getByRole('group', { name: 'Media mode' }).getByRole('button', { name: 'Rotation lists' }).click();
  await row(page, 'Rotation lists', 'Lumen Fillers').click();
  const items = col(page, 'List items');
  await expect(items.getByText('3 results')).toBeVisible();
  await expect(items.getByRole('img', { name: 'Last item inserted' })).toBeVisible();
  await expect(items.getByText('Last inserted #2')).toBeVisible();

  await items.getByRole('button', { name: 'Add items' }).click();
  const pick = page.getByRole('dialog', { name: 'Add items' });
  await pick.getByRole('option', { name: /^TV Series Drama/ }).click();
  await pick.getByRole('option', { name: /^Spider Noir/ }).click();
  await pick.getByRole('option', { name: /Spider Noir - 1/ }).click();
  await pick.getByRole('button', { name: 'Add 1 item' }).click();
  await expect(page.getByText('1 added to Lumen Fillers')).toBeVisible();
  await expect(items.getByText('4 results')).toBeVisible();
  await expect(row(page, 'List items', 'Spider Noir - 1')).toContainText('#4');

  await menu(page, 'Rotation lists', 'Clone');
  await expect(page.getByText('Created Lumen Fillers (Clone)')).toBeVisible();
  await expect(row(page, 'Rotation lists', 'Lumen Fillers (Clone)')).toContainText('4');

  await menu(page, 'List items', 'Shuffle');
  await expect(page.getByText('Shuffled Lumen Fillers (4 items)')).toBeVisible();
});
