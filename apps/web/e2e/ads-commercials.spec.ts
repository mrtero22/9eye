// Orders part C, end to end: a booked spot of a confirmed commercial order goes into the day's ads
// playlist with Auto-place ads, is saved, and the step and the Unplaced ads report follow it.

import { expect, test, type Page } from '@playwright/test';
import { SLUG, disconnect, makeCompany, prepareFill, removeCompany, signIn } from './fixture';

test.beforeEach(async ({ page }) => {
  await makeCompany();
  await signIn(page);
  await page.addInitScript((slug) => localStorage.setItem('9eye.company', slug), SLUG);
});

test.afterAll(async () => {
  await removeCompany();
  await disconnect();
});

/** Week 22 of 2030 for E2E TV, and a confirmed order booking LumenPlus_Ident_1 into Saturday's Ad Pod 06:30. */
async function setUp(page: Page) {
  await page.goto('/playlist');
  const r = await page.evaluate(async (slug) => {
    const call = async (method: string, url: string, body?: object) => {
      const res = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant': slug }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
      return res.status === 204 ? null : res.json();
    };
    const tv = (await call('GET', '/channels')).find((c: { name: string }) => c.name === 'E2E TV');
    await call('POST', `/channels/${tv.id}/weeks`, { kinds: ['main', 'ads'], fromWeek: '2030-06-01', toWeek: '2030-06-01' });
    const empty = { type: 'advertiser', country: '', address: '', billingAddress: '', web: '', email: '', phone: '', fax: '', vatNumber: '', notes: '', toleranceSeconds: null };
    const client = await call('POST', '/commercials/clients', { name: 'NOVAMART', ...empty });
    const contract = await call('POST', '/commercials/contracts', { clientId: client.id, name: 'NOVAMART', startDate: '2030-05-25', endDate: '2030-06-30', currency: 'USD', totalAgreed: 0, notes: '', channelIds: [tv.id] });
    const { ids } = await call('POST', `/commercials/contracts/${contract.id}/orders`, { channelIds: [tv.id], startDate: '2030-05-25' });
    const found = await call('GET', '/catalog/search?q=LumenPlus_Ident_1&families=program,filling,advert');
    const prod = found.productions.find((x: { title: string }) => x.title === 'LumenPlus_Ident_1');
    let o = await call('GET', `/commercials/orders/${ids[0]}`);
    await call('PUT', `/commercials/orders/${ids[0]}`, { version: o.version, name: o.name, status: 'confirmed', startDate: o.startDate, endDate: o.endDate, items: [{ id: null, productionId: prod.productionId ?? prod.id }] });
    o = await call('GET', `/commercials/orders/${ids[0]}`);
    const week = await call('GET', `/commercials/orders/${ids[0]}/week?from=2030-06-01`);
    const sat = week.days.find((d: { date: string }) => d.date === '2030-06-01');
    const box = sat.boxes.find((b: { breaks: { name: string }[] }) => b.breaks.some((x) => x.name === 'Ad Pod 06:30'));
    const ab = box.breaks.find((x: { name: string }) => x.name === 'Ad Pod 06:30');
    await call('PUT', `/commercials/orders/${ids[0]}/week`, { version: o.version, from: week.from, to: week.to, bookings: [{ date: '2030-06-01', blockTypeId: box.blockTypeId, breakTypeId: ab.breakTypeId, orderItemId: o.items[0].id, positionId: null, passes: 1 }] });
    return { channelId: tv.id as string };
  }, SLUG);
  await prepareFill('2030-06-01');
  await page.goto(`/playlist?channel=${r.channelId}&tab=day&date=2030-06-01&playlist=ads`);
  await expect(page.getByRole('table', { name: 'Ads playlist of Sat 1 Jun 2030' })).toBeVisible();
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Add to playlist' });
const step = (page: Page) => sidebar(page).getByRole('group', { name: 'Steps for this day' }).getByRole('group', { name: 'Campaigns' });

test('Auto-place ads puts the booked spot into its break; saved, the step says it is placed', async ({ page }) => {
  await setUp(page);
  await expect(step(page)).toContainText('1 spot to place');
  await expect(page.getByText(/1 booked spot is not in the ads playlist/)).toBeVisible();

  // the report first: it says what can go in
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Unplaced ads report' }).click();
  const report = page.getByRole('dialog', { name: 'Unplaced ads report' });
  await expect(report.getByRole('status')).toHaveText('1 can go in');
  await expect(report).toContainText('LumenPlus_Ident_1');
  await expect(report).toContainText('Ad Pod 06:30');
  await report.getByRole('button', { name: 'Cancel' }).click();

  // Auto-place ads runs at once
  await sidebar(page).getByRole('button', { name: /^Auto-place ads/ }).click();
  await expect(page.getByText('Campaigns: 1 spot placed. Save to keep it.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(step(page)).toContainText('Placed');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Unsaved changes')).toBeHidden();
  await page.reload();
  await expect(step(page)).toContainText('Placed');
  await expect(page.getByRole('table', { name: 'Ads playlist of Sat 1 Jun 2030' })).toContainText('LumenPlus_Ident_1');
});
