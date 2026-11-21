// AI access (decision 0023; mockups AiAccess.dc.html and MyAiAccess.dc.html, page doc
// docs/design/ai-access-page.md), end to end: the company's policy, a token made once from the
// account menu, listed and revoked in Settings, and the Activity of it all.

import { expect, test, type Page } from '@playwright/test';
import { SLUG, disconnect, makeCompany, removeCompany, seedAppChange, signIn } from './fixture';

test.beforeEach(async ({ page }) => {
  await makeCompany();
  await signIn(page);
  await page.addInitScript((slug) => localStorage.setItem('9eye.company', slug), SLUG);
});

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true });
};

test.afterAll(async () => {
  await removeCompany();
  await disconnect();
});

test('policy, a token shown once, Settings list and revoke, and Activity', async ({ page }) => {
  // Settings › AI access: from Read only to Drafts, then Layouts › Create and delete asks first;
  // tokens of up to 30 days (decision 0025)
  await page.goto('/admin/ai-access');
  await expect(page.getByRole('heading', { name: 'AI access', level: 2 })).toBeVisible();
  const presets = page.getByRole('group', { name: 'Preset' });
  await expect(presets.getByRole('button', { name: 'Read only' })).toHaveAttribute('aria-pressed', 'true');
  await presets.getByRole('button', { name: 'Drafts' }).click();
  const grid = page.getByRole('group', { name: 'What AI may do in E2E Test Company' });
  await expect(grid.getByRole('radiogroup', { name: 'Playlist, Change' }).getByRole('radio', { name: 'Allowed' })).toHaveAttribute('aria-checked', 'true');
  await grid.getByRole('radiogroup', { name: 'Layouts, Create and delete' }).getByRole('radio', { name: 'Ask first' }).click();
  await expect(presets.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Longest token life').selectOption('30');
  await expect(page.getByText('5 changes')).toBeVisible();
  await expect(page.getByText(/^Never open to AI: people and roles/)).toBeVisible();
  await shot(page, 'ai-access-table');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('AI access saved')).toBeVisible();
  await expect(page.getByText('Nobody has made a token yet.')).toBeVisible();

  // the account menu › AI access › New token
  await page.getByRole('button', { name: 'Account, admin and display settings' }).click();
  await page.getByRole('dialog', { name: 'Account and settings' }).getByRole('link', { name: 'AI access' }).click();
  await expect(page).toHaveURL(/\/account\/ai-access$/);
  await page.getByRole('button', { name: 'New token' }).click();
  const panel = page.getByRole('complementary', { name: 'New token' });
  await panel.getByLabel('Name').fill('E2E agent');
  await expect(panel.getByRole('group', { name: 'Expires in' }).getByRole('button')).toHaveText(['30 days']);
  await expect(panel.getByRole('radio', { name: /^Same as E2E Test Company/ })).toHaveAttribute('aria-checked', 'true');
  // its own limits: never more than the company (Layouts › Create and delete: up to Ask first)
  await panel.getByRole('radio', { name: /^Custom/ }).click();
  const own = panel.getByRole('group', { name: 'What this token can do' });
  await expect(own.getByRole('radiogroup', { name: 'Layouts, Create and delete' }).getByRole('radio', { name: 'Allowed' })).toBeDisabled();
  await shot(page, 'ai-access-token-limits');
  await panel.getByRole('radio', { name: /^Same as E2E Test Company/ }).click();
  await panel.getByRole('button', { name: 'Make token' }).click();

  const made = page.getByRole('complementary', { name: 'Token made: E2E agent' });
  await expect(made.getByLabel('The new token')).toHaveText(/^9eye_pat_[A-Za-z0-9_-]{40,}$/);
  await expect(made.getByText(/^claude mcp add --transport http 9eye http:\/\/[^ ]+\/api\/mcp --header "Authorization: Bearer 9eye_pat_/)).toBeVisible();
  await made.getByRole('button', { name: 'Other MCP app' }).click();
  await expect(made.getByText('Streamable HTTP (MCP)')).toBeVisible();
  await made.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('The new token')).toHaveCount(0);
  await expect(page.getByText('E2E agent')).toBeVisible();

  // Settings lists it with its person, and revokes it after asking
  await page.goto('/admin/ai-access');
  await expect(page.getByText('E2E agent')).toBeVisible();
  await expect(page.getByText('Same as the company', { exact: true })).toBeVisible();
  await expect(page.getByText('Layouts, Playlist, Ads: change; the rest read · follows the company')).toBeVisible();
  await page.getByRole('button', { name: 'Revoke' }).click();
  const ask = page.getByRole('dialog', { name: 'Revoke "E2E agent"?' });
  await ask.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('"E2E agent" revoked')).toBeVisible();
  await expect(page.getByText('No working tokens.')).toBeVisible();
  await page.getByRole('switch', { name: 'Show expired and revoked' }).click();
  await expect(page.getByText(/^Revoked /)).toBeVisible();

  // Activity: newest first, each with its words; a row opens what was sent
  await page.goto('/admin/activity');
  const table = page.getByRole('table', { name: 'Activity' });
  await expect(table.getByRole('row', { name: /^Details of / })).toHaveText([/Revoked an AI token/, /Made an AI token/, /Changed AI access/]);
  await table.getByRole('row', { name: 'Details of Made an AI token' }).click();
  const details = page.getByRole('complementary', { name: 'Made an AI token' });
  await expect(details.getByText('What was sent')).toBeVisible();
  await expect(details.getByText('"E2E agent"', { exact: true })).toBeVisible(); // the item
  await expect(details.getByText('E2E agent', { exact: true })).toBeVisible(); // what was sent: name
  await expect(details).not.toContainText('9eye_pat_');
  await page.getByRole('button', { name: 'AI apps' }).click();
  await expect(page.getByText('Nothing yet.')).toBeVisible();
});

test('Ask first: a change an AI app prepared waits in Waiting for you until a person approves it', async ({ page }) => {
  const layouts = await seedAppChange();
  await page.goto('/agents/waiting');
  await expect(page.getByText('AI app · via Claude on my laptop · asked first')).toBeVisible();
  const card = page.getByText('Create a layout', { exact: true }).locator('..').locator('..');
  await expect(card.getByText(/^E2E TV · new main layout "WINTER 2031"/).first()).toBeVisible();
  await shot(page, 'ai-access-waiting');
  expect(await layouts()).toBe(0);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved and applied')).toBeVisible();
  expect(await layouts()).toBe(1);
});

