// A commercial order's week board (design/orders-page.md §3, part B), end to end: book a spot with a
// click, save, open the break, remove it, and Book spots… over the order's dates.

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

/** The client, contract and order through the API (the Orders pages have their own test). */
async function makeOrder(page: Page) {
  await page.goto('/orders');
  return page.evaluate(async (slug) => {
    const call = async (method: string, url: string, body?: object) => {
      const r = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant': slug }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
      return r.status === 204 ? null : r.json();
    };
    const channels = await call('GET', '/channels');
    const tv = channels.find((c: { name: string }) => c.name === 'E2E TV');
    // a week from Saturday that holds today, two weeks long
    const t = new Date(`${tv.today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() - 6 + 7) % 7));
    const start = t.toISOString().slice(0, 10);
    t.setUTCDate(t.getUTCDate() + 13);
    const end = t.toISOString().slice(0, 10);
    const client = await call('POST', '/commercials/clients', { name: 'NOVAMART', type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null });
    const contract = await call('POST', '/commercials/contracts', { clientId: client.id, name: 'NOVAMART', startDate: start, endDate: end, currency: 'USD', totalAgreed: 0, notes: '', channelIds: [tv.id] });
    const { ids } = await call('POST', `/commercials/contracts/${contract.id}/orders`, { channelIds: [tv.id], startDate: start });
    const found = await call('GET', '/catalog/search?q=LumenPlus_Ident&families=program,filling,advert');
    const prod = (found.productions ?? found.items ?? found).find?.((x: { title: string }) => x.title === 'LumenPlus_Ident_1') ?? null;
    const order = await call('GET', `/commercials/orders/${ids[0]}`);
    if (prod) await call('PUT', `/commercials/orders/${ids[0]}`, { version: order.version, name: order.name, status: 'confirmed', startDate: order.startDate, endDate: order.endDate, items: [{ id: null, productionId: prod.productionId ?? prod.id }] });
    return { id: ids[0] as string, start, withSpot: !!prod };
  }, SLUG);
}

test('book a spot with a click, save it, open and remove it, then book spots over the campaign', async ({ page }) => {
  const o = await makeOrder(page);
  expect(o.withSpot).toBe(true);
  await page.goto(`/orders/${o.id}`);
  await expect(page.getByRole('heading', { name: /^E2E TV - NOVAMART - START/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /V1/ })).toBeChecked();

  // Saturday's Run Block 1 has Billboard 1 06:00 and Ad Pod 06:30; a click on Billboard 1 books V1 there
  const sp1 = page.getByRole('button', { name: /^Billboard 1 06:00 · Run Block 1/ });
  const laterBlock = page.getByTitle(/^Run Block 2 · 07:00/).first();
  await expect(laterBlock).toBeVisible();
  await sp1.click();
  await expect(sp1).toContainText('V1');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  // booking a break never hides the other blocks of the day
  await expect(laterBlock).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Week saved')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Billboard 1 06:00 · Run Block 1/ })).toContainText('V1');

  // the break's panel: remove the spot, save
  await page.getByRole('button', { name: /^Billboard 1 06:00 · Run Block 1/ }).click();
  const panel = page.getByRole('complementary', { name: 'Billboard 1 06:00' });
  await expect(panel).toContainText('This campaign · 1 spot');
  await panel.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Week saved')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Billboard 1 06:00 · Run Block 1/ })).not.toContainText('V1');

  // Book spots…: the Ad Pod on every Saturday of the order
  await page.getByRole('button', { name: 'Book spots…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Book spots' });
  await dlg.getByRole('checkbox', { name: /Ad Pod/ }).check();
  await expect(dlg.getByText('Books 2 new spots')).toBeVisible();
  await dlg.getByRole('button', { name: 'Book 2 spots' }).click();
  await expect(page.getByText('Booked 2 spots')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ad Pod 06:30 · Run Block 1/ })).toContainText('V1');
});

test('the Break field: the board shows the blocks, and a click on one books into that break of it', async ({ page }) => {
  const o = await makeOrder(page);
  await page.goto(`/orders/${o.id}`);
  await expect(page.getByRole('radio', { name: /V1/ })).toBeChecked();

  // every Run Block has Billboard 1 hh:00 then Ad Pod hh:30
  const field = page.getByRole('combobox', { name: 'Break' });
  await expect(field.locator('option')).toHaveText(['The one I click', 'Billboard 1 :00', 'Ad Pod :30']);
  await field.selectOption({ label: 'Ad Pod :30' });
  await expect(page.getByRole('table', { name: /^Blocks of .*Ad Pod :30$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Billboard 1 06:00 · Run Block 1/ })).toHaveCount(0);
  await expect(page.getByText('A click on a block books the chosen spot into its Ad Pod :30.')).toBeVisible();

  const block = page.getByRole('button', { name: /^Run Block 1 · Ad Pod 06:30/ }).first();
  await block.click();
  await expect(block).toContainText('V1');
  await expect(page.getByText(/^Booked V1 in Ad Pod 06:30/)).toBeVisible();

  // back to every break: V1 sits in the Ad Pod of the block, not in its Billboard 1
  await field.selectOption({ label: 'The one I click' });
  await expect(page.getByRole('button', { name: /^Ad Pod 06:30 · Run Block 1/ }).first()).toContainText('V1');
  await expect(page.getByRole('button', { name: /^Billboard 1 06:00 · Run Block 1/ }).first()).not.toContainText('V1');
});
