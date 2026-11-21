// Admin (mockup the Admin mockup (private)), end to end: channels and their settings with the
// current rules, roles, users, companies, connections, and the sections that come later.

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

async function pickTemplatesChannel(page: Page, name: string) {
  await page.getByRole('button', { name: /^Channel:/ }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('button', { name: `Channel: ${name}` })).toBeVisible();
}

const openChannel = async (page: Page, name: string) => {
  await page.goto('/admin/channels');
  await page.getByRole('link', { name: `${name} settings` }).click();
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
};
const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
const card = (page: Page, name: string) => page.getByRole('region', { name });

test('channels: the table, sections that come later, and a new channel', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/channels$/);
  await expect(page.getByText('Settings for E2E Test Company: channels, people, rules and connections.')).toBeVisible();
  const row = page.getByRole('link', { name: 'E2E TV settings' });
  await expect(row).toContainText('E2E TV');
  await expect(row).toContainText('06:00');
  await expect(row).toContainText('Saturday');
  await expect(row).toContainText('25 fps');
  await expect(page.getByRole('link', { name: 'E2E DF settings' })).toContainText('29.97 DF');

  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: /Clash codes/ }).click();
  await expect(page.getByText('Clash codes is not built yet.')).toBeVisible();

  await page.getByRole('link', { name: /^Channels/ }).click();
  await page.getByRole('button', { name: 'New channel' }).click();
  const dlg = page.getByRole('dialog', { name: 'New channel' });
  await dlg.getByLabel('Name').fill('E2E NEW');
  await dlg.getByLabel('Code').fill('E2ENEW');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'E2E NEW', level: 2 })).toBeVisible();
  await expect(card(page, 'Used by')).toContainText('No layouts');
});

test('the first weekday cannot change while layouts do not fit the new week', async ({ page }) => {
  await page.goto('/templates');
  await pickTemplatesChannel(page, 'E2E TV');
  await page.getByRole('link', { name: 'Change in channel settings' }).click();
  await expect(page.getByRole('heading', { name: 'E2E TV', level: 2 })).toBeVisible();
  await expect(card(page, 'Used by')).toContainText('2 layouts');

  await page.getByLabel('Name', { exact: true }).fill('E2E TV renamed');
  await page.getByLabel('First weekday').selectOption('1');
  const time = card(page, 'Time');
  await expect(time).toContainText('Both layouts of this channel run Saturday to Friday. They do not fit a week that starts on Monday, so this cannot be saved.');
  await expect(time).toContainText('E2E ADS · ads playlist · 6 Jan 2024 → 25 Dec 2099');
  await expect(time).toContainText('E2E MAIN · main playlist · 23 Mar 2024 → 29 May 2099');
  await expect(card(page, 'What can change')).toContainText('Blocked: the layouts do not fit the new week');
  await expect(page.getByText('2 changes')).toBeVisible();
  await expect(save(page)).toBeDisabled();

  await time.getByRole('link', { name: 'Open' }).last().click();
  await expect(page.getByText('Valid 23 Mar 2024 → 29 May 2099')).toBeVisible();
  await expect(page.getByText('Week starts Saturday · day starts 06:00 · 25 fps')).toBeVisible();
});

test('frame rate and day start stay locked while layouts and block types use them', async ({ page }) => {
  await openChannel(page, 'E2E TV');
  await expect(page.getByLabel(/Frame rate/)).toBeDisabled();
  await expect(page.getByLabel(/Broadcast day starts/)).toBeDisabled();
  await expect(card(page, 'What can change')).toContainText('Locked: the channel has layouts and block types.');
});

test('every setting can change on a channel without layouts', async ({ page }) => {
  await openChannel(page, 'E2E EMPTY');
  await expect(card(page, 'What can change')).toContainText('Can change: no layout or block type uses them yet');
  await page.getByLabel(/Frame rate/).selectOption('29.97df');
  await page.getByLabel(/Broadcast day starts/).fill('05:00');
  await page.getByLabel('First weekday').selectOption('0');
  await page.getByLabel('Time zone').fill('Europe/London');
  await page.getByLabel('Date locale').selectOption('fa');
  await page.getByLabel('Age logo position').selectOption('top-left');
  await page.getByLabel('Shortest break').fill('00:00:30');
  await page.getByLabel('Default export').selectOption('bxf');
  await page.getByLabel('EPG types').selectOption('xmltv');
  await page.getByRole('switch', { name: 'BXF times in UTC' }).click();
  await page.getByLabel('Reconciliation timing margin').fill('3');
  await expect(page.getByText('12 changes')).toBeVisible();
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  await expect(card(page, 'Export file name')).toContainText(`BXF${ymd}_E2EEMPTY.xml`);
  await save(page).click();
  await expect(page.getByText('Channel settings saved')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(/Broadcast day starts/)).toHaveValue('05:00');
  await expect(page.getByLabel('Time zone')).toHaveValue('Europe/London');
  await expect(page.getByLabel('Date locale')).toHaveValue('fa');
  await expect(page.getByLabel('Shortest break')).toHaveValue('00:00:30');
  await expect(card(page, 'Export and EPG')).toContainText('BXF');
  await expect(page.getByLabel('Reconciliation timing margin')).toHaveValue('3');

  await page.goto('/templates');
  await pickTemplatesChannel(page, 'E2E EMPTY');
  await expect(page.getByText('Week starts Sunday · day starts 05:00 · 29.97 fps drop-frame')).toBeVisible();
});

test('an ads playlist is added, and removed only when nothing uses it', async ({ page }) => {
  await openChannel(page, 'E2E PUBLIC');
  await page.getByRole('switch', { name: 'Ads playlist' }).click();
  await save(page).click();
  await expect(page.getByText('Channel settings saved')).toBeVisible();
  await page.goto('/templates');
  await pickTemplatesChannel(page, 'E2E PUBLIC');
  await expect(page.getByText('Public Autumn').first()).toBeVisible();
  await expect(page.getByText(/Main playlist only/)).toBeHidden();

  await openChannel(page, 'E2E TV');
  await page.getByRole('switch', { name: 'Ads playlist' }).click();
  await expect(card(page, 'Playlists')).toContainText('The ads playlist is in use (1 ads layout, 48 block types, main layouts with linked breaks), so it cannot be turned off.');
  await expect(save(page)).toBeDisabled();
});

test('roles: permissions and channels of a role', async ({ page }) => {
  await page.goto('/admin/roles');
  await page.getByRole('button', { name: /^Sales/ }).click();
  await expect(page.getByRole('heading', { name: 'Sales', level: 3 })).toBeVisible();
  await page.getByLabel('Layouts · View').check();
  await page.getByLabel('Selected channels').check();
  await page.getByRole('button', { name: 'Add channel' }).click();
  await page.getByRole('menuitem', { name: 'E2E TV' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Sales saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Sales/ }).click();
  await expect(page.getByLabel('Layouts · View')).toBeChecked();
  await expect(page.getByLabel('Selected channels')).toBeChecked();
  await expect(page.getByText('E2E TV', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Company admin/ }).click();
  await expect(page.getByLabel('Plans and campaigns · Approve')).toBeDisabled();
});

test('users: invite, change the role, remove', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page.getByText('E2E tester')).toBeVisible();
  await page.getByRole('button', { name: 'Invite user' }).click();
  const dlg = page.getByRole('dialog', { name: 'Invite user' });
  await dlg.getByLabel('Name').fill('Night traffic');
  await dlg.getByLabel('E-mail').fill('night.traffic@e2e.example');
  await dlg.getByLabel('Role').selectOption({ label: 'Traffic operator' });
  await dlg.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText('Night traffic invited')).toBeVisible();
  await expect(page.getByText('Invited', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Actions for Night traffic' }).click();
  await page.getByRole('menuitem', { name: 'Change role…' }).click();
  await page.getByRole('dialog', { name: 'Role of Night traffic' }).getByLabel('Role').selectOption({ label: 'Viewer' });
  await page.getByRole('button', { name: 'Change role' }).click();
  await expect(page.getByText('E2E Test Company · Viewer')).toBeVisible();

  await page.getByRole('button', { name: 'Actions for Night traffic' }).click();
  await page.getByRole('menuitem', { name: /Remove from/ }).click();
  await page.getByRole('dialog', { name: /Remove Night traffic/ }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Night traffic', { exact: true })).toBeHidden();
});

test('companies and connections', async ({ page }) => {
  await page.goto('/admin/companies');
  await expect(page.getByText('Live · 6 channels · this company')).toBeVisible();

  await page.goto('/admin/plugins');
  await page.getByRole('button', { name: 'Add connection' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add connection' });
  await dlg.getByLabel('Address').fill('https://mam.e2e.example');
  await dlg.getByLabel('Password or key').fill('top-secret');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('MAM · Compact MAM')).toBeVisible();
  await expect(page.getByText('Set up, not checked')).toBeVisible();
  await page.getByRole('button', { name: 'Configure' }).click();
  await expect(page.getByRole('dialog', { name: 'MAM · Compact MAM' }).getByLabel('Password or key')).toHaveAttribute('placeholder', 'Saved — type to replace');
  await expect(page.getByRole('dialog', { name: 'MAM · Compact MAM' }).getByLabel('Password or key')).toHaveValue('');
});
