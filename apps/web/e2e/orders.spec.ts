// Orders (design/orders-page.md, part A), end to end: a client, a contract, its orders one per
// channel with Aurora Media's names, the contract's details, and what cannot be deleted while it is used.

import { expect, test } from '@playwright/test';
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

test('a client, its deal and one campaign per channel', async ({ page }) => {
  await page.goto('/orders');
  await expect(page.getByText('No deals yet.')).toBeVisible();

  // the client
  await page.getByRole('tab', { name: 'Clients' }).click();
  await expect(page).toHaveURL(/\/orders\/clients$/);
  await page.getByRole('button', { name: 'New client' }).first().click();
  const panel = page.getByRole('complementary', { name: 'New client' });
  await panel.getByLabel('Name').fill('NOVAMART');
  await panel.getByLabel('Country').fill('Iran');
  await panel.getByRole('button', { name: 'Create client' }).click();
  await expect(page.getByText('NOVAMART saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open NOVAMART' })).toContainText('Advertiser');

  // the contract, named after its client
  await page.getByRole('tab', { name: 'Deals' }).click();
  await page.getByRole('button', { name: 'New deal' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New deal' });
  await dlg.getByRole('combobox', { name: /^Client/ }).selectOption({ label: 'NOVAMART' });
  await expect(dlg.getByRole('textbox', { name: /^Name/ })).toHaveValue('NOVAMART');
  await dlg.getByLabel('Add to Channels').selectOption({ label: 'E2E TV' });
  await dlg.getByRole('button', { name: 'Create deal' }).click();
  await expect(page.getByRole('heading', { name: 'NOVAMART', level: 1 })).toBeVisible();
  await expect(page.getByText('No campaigns yet')).toBeVisible();

  // one order per channel, named as Aurora Media names them
  await page.getByRole('button', { name: 'New campaign' }).first().click();
  const nd = page.getByRole('dialog', { name: 'New campaign' });
  await expect(nd.getByRole('checkbox', { name: 'E2E TV' })).toBeChecked();
  await expect(nd.getByText(/^E2E TV - NOVAMART - START /)).toBeVisible();
  await nd.getByRole('button', { name: 'Make campaign' }).click();
  await expect(page.getByText('Campaign made')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'E2E TV - NOVAMART - START' });
  await expect(row).toContainText('Draft');

  // the contract cannot go while it has an order
  await page.getByRole('button', { name: 'More actions for this deal' }).click();
  await expect(page.getByRole('menuitem', { name: /Delete deal/ })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  // details: rename and save
  await page.getByRole('tab', { name: 'Details' }).click();
  await page.getByRole('region', { name: 'Deal details' }).getByLabel('Name').fill('NOVAMART 2026');
  await expect(page.getByText('1 change')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('NOVAMART 2026 saved')).toBeVisible();

  // back on the list
  await page.getByRole('button', { name: /^Ads$/ }).or(page.getByRole('link', { name: /^Ads$/ })).first().click();
  await page.getByRole('button', { name: 'All 1' }).click();
  await expect(page.getByRole('row', { name: 'Open NOVAMART 2026' })).toContainText('NOVAMART');
});
