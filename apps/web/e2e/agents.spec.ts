// Agents (decision 0024; mockups AgentTeam / AgentProfile, page doc docs/design/agents-page.md), end
// to end without calling any provider: a room where one agent handed work to another and its change
// waits — approved, applied and undone; the gallery, an agent's chat and settings; the keys card.
// SHOT_DIR=<folder> also saves screenshots there.

import { expect, test, type Page } from '@playwright/test';
import { SLUG, dayApproved, disconnect, itemWithLength, makeAgentTeam, makeCompany, prepareFill, removeCompany, seedAgentChange, seedDayChange, signIn, weeksFrom } from './fixture';

test.beforeEach(async ({ page }) => {
  await makeCompany();
  await signIn(page);
  await page.addInitScript((slug) => localStorage.setItem('9eye.company', slug), SLUG);
});

test.afterAll(async () => {
  await removeCompany();
  await disconnect();
});

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true });
};

test('a room: a hand-off, a change that waits, approved, applied and undone', async ({ page }) => {
  const team = await makeAgentTeam();
  await page.goto('/agents');
  // something waits for a person: the page opens there, and the top bar counts it
  await expect(page).toHaveURL(/\/agents\/waiting$/);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByLabel('1 waiting for a person')).toBeVisible();
  await expect(page.getByText('Waiting for a person')).toBeVisible();
  await expect(page.getByRole('link', { name: 'in #playlist-checks' })).toBeVisible();
  await shot(page, 'agents-waiting');

  await page.getByRole('navigation', { name: 'Rooms and agents' }).getByRole('link', { name: 'playlist-checks' }).click();
  await expect(page.getByText('# playlist-checks')).toBeVisible();
  await expect(page.getByText('@Playlist checker are the coming weeks of E2E TV ready?')).toBeVisible();
  await expect(page.getByText('Saved to its memory: “E2E TV weeks are made eight weeks ahead.”')).toBeVisible();
  const card = page.getByText('Waiting for a person').locator('..').locator('..');
  await expect(card.getByText('E2E TV · 2 weeks to create (preview — nothing is created)', { exact: true })).toBeVisible();
  await shot(page, 'agents-room');

  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved and applied')).toBeVisible();
  await expect(page.getByText('Approved · applied')).toBeVisible();
  expect(await weeksFrom(team.week)).toBe(2);
  await shot(page, 'agents-approved');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Undone', { exact: true }).first()).toBeVisible();
  expect(await weeksFrom(team.week)).toBe(0);
});

test('the gallery, an agent’s chat and settings, and the keys for agents', async ({ page }) => {
  await makeAgentTeam();
  await page.goto('/agents/waiting');
  await expect(page.getByText(/Agents need a key of Claude, ChatGPT or Grok/)).toBeVisible();

  await page.getByRole('button', { name: 'New agent' }).first().click();
  const gallery = page.getByRole('dialog', { name: 'New agent' });
  await expect(gallery.getByRole('button', { name: /^Start empty/ })).toBeVisible();
  await shot(page, 'agents-gallery');
  await gallery.getByRole('button', { name: /^Gap filler/ }).click();
  const form = page.getByRole('dialog', { name: 'Gap filler' });
  await expect(form.getByLabel('Name')).toHaveValue('Gap filler');
  await expect(form.getByLabel('Model')).toHaveValue('claude-opus-5-5');
  await form.getByLabel('Acts with the role').selectOption({ label: 'Scheduler' });
  await form.getByRole('button', { name: 'Add to the team' }).click();
  await expect(page.getByText('Gap filler is on the team')).toBeVisible();

  // its chat: without a key it says so, in the chat
  const box = page.getByRole('textbox', { name: 'Message Gap filler' });
  await box.fill('Fill the short blocks of Saturday');
  await box.press('Enter');
  await expect(page.getByText('Fill the short blocks of Saturday')).toBeVisible();
  await expect(page.getByText('There is no key for Claude (Anthropic): a company admin adds one in Settings › AI access.')).toBeVisible();
  await shot(page, 'agents-chat');

  // its settings
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Colour of its mark' })).toBeVisible();
  await page.getByLabel('Its job').fill('Fills short blocks from the rotation lists, idents first.');
  await expect(page.getByText('1 change', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Agent saved')).toBeVisible();
  await shot(page, 'agents-settings');

  // Settings › AI access › Keys for agents: a person pastes the key; only its end is shown again
  await page.goto('/admin/ai-access');
  const keysCard = page.getByRole('region', { name: 'Keys for agents' });
  await expect(keysCard.getByText('Claude (Anthropic)')).toBeVisible();
  await keysCard.getByRole('button', { name: 'Add key' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Key of Claude (Anthropic)' });
  await dialog.getByLabel('API key').fill('sk-ant-e2e-0123456789abcdefWXYZ');
  await dialog.getByRole('button', { name: 'Save key' }).click();
  await expect(keysCard.getByText(/^Key ending WXYZ/)).toBeVisible();
  await expect(page.getByText('sk-ant-e2e')).toHaveCount(0);
  await shot(page, 'agents-keys');
  await keysCard.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog', { name: 'Remove the key of Claude (Anthropic)?' }).getByRole('button', { name: 'Remove key' }).click();
  await expect(keysCard.getByText('No key').first()).toBeVisible();
});

test('the agent in a page: a change of the day previewed on the grid, approved and saved, then a routine', async ({ page }) => {
  await makeAgentTeam();
  // E2E TV, week 22 of 2030, with what Saturday 1 June is filled from
  await page.goto('/playlist');
  await page.getByRole('button', { name: /^Channel:/ }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: 'E2E TV', exact: true }).click();
  const url = new URL(page.url());
  url.searchParams.set('month', '2030-06');
  await page.goto(url.toString());
  await page.getByRole('button', { name: 'Create week 22' }).click();
  await page.getByRole('dialog', { name: 'Create weeks' }).getByRole('button', { name: 'Create 1 week' }).click();
  await prepareFill('2030-06-01');
  await seedDayChange('2030-06-01');
  url.searchParams.set('tab', 'day');
  url.searchParams.set('date', '2030-06-01');
  await page.goto(url.toString());
  const table = page.getByRole('table', { name: 'Main playlist of Sat 1 Jun 2030' });
  await expect(table).toBeVisible();
  await expect(table.getByText('new', { exact: true })).toHaveCount(0);

  // the Agent button opens the panel of the agents of Playlist; it sees this day
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Agent panel' });
  await expect(panel.getByText('E2E TV (code E2ETV) · main playlist · the broadcast day 2030-06-01')).toBeVisible();
  await panel.getByRole('combobox', { name: 'Agent' }).selectOption({ label: 'Weeks builder' });
  await expect(panel.getByText('Put the plans of 2030-06-01 into the day')).toBeVisible();
  await panel.getByRole('button', { name: 'Preview on the page' }).click();

  // on the grid: the new rows green, and the agent's change waiting to be approved and saved
  await expect(page.getByText('Weeks builder’s change, not saved yet: Fill a day')).toBeVisible();
  await expect(table.getByText('new', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^\d+ new or changed rows \(green\)/)).toBeVisible();
  await shot(page, 'agents-day-preview');
  await page.getByRole('button', { name: 'Approve and save' }).click();
  await expect(page.getByText('Approved and saved')).toBeVisible();
  await expect(page.getByText('Weeks builder’s change, not saved yet: Fill a day')).toHaveCount(0);
  await expect(table.getByText('new', { exact: true })).toHaveCount(0);
  await expect(table.getByText('Lumen Story - 1').first()).toBeVisible();
  await expect(panel.getByText('Approved · applied')).toBeVisible();

  // do it every day: a routine of this person
  await panel.getByRole('button', { name: 'Make it a routine' }).click();
  await expect(panel.getByText(/^Routine made: every day at 19:00/)).toBeVisible();
  await shot(page, 'agents-day-approved');

  // the Agent button is on every part, and the panel says what each page shows
  for (const [path, sees] of [
    ['/templates', /\(code [A-Z0-9]+\) · /],
    ['/scheduling', /the plans of /],
    ['/orders', /the list of deals and their campaigns/],
    ['/catalog', /nothing picked|·/],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Agent', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByText(sees).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(panel).toHaveCount(0);
});

test('routines in an agent’s settings: made, run now, paused', async ({ page }) => {
  const team = await makeAgentTeam();
  await page.goto(`/agents/${team.checker}/settings`);
  const card = page.getByRole('region', { name: 'Routines' });
  await expect(card.getByText('No routines yet.')).toBeVisible();
  await card.getByRole('button', { name: 'New routine' }).click();
  const dialog = page.getByRole('dialog', { name: 'New routine of Playlist checker' });
  await dialog.getByLabel('Name').fill('Check tomorrow');
  await dialog.getByLabel('At', { exact: true }).fill('18:00');
  await dialog.getByLabel('Time zone').fill('Asia/Tehran');
  await dialog.getByLabel('What Playlist checker does each time').fill('Check tomorrow on every channel.');
  await dialog.getByLabel('It answers in').selectOption({ label: '#playlist-checks' });
  await dialog.getByRole('button', { name: 'Make routine' }).click();
  await expect(page.getByText('Routine made')).toBeVisible();
  await expect(card.getByText('Every day at 18:00 (Asia/Tehran) · answers in #playlist-checks')).toBeVisible();
  await expect(card.getByText(/· next /)).toBeVisible();
  await shot(page, 'agents-routines');

  // run now: without a key it says why, in its room
  await card.getByRole('button', { name: 'Run now' }).click();
  await expect(page.getByText('“Check tomorrow” did not run: see why in #playlist-checks')).toBeVisible();
  await page.goto(`/agents/rooms/${team.room}`);
  await expect(page.getByText('The routine "Check tomorrow" did not run: There is no key for Claude (Anthropic): a company admin adds one in Settings › AI access.')).toBeVisible();

  await page.goto(`/agents/${team.checker}/settings`);
  await card.getByRole('switch', { name: 'Check tomorrow on' }).click();
  await expect(page.getByText('“Check tomorrow” is paused')).toBeVisible();
  await expect(card.getByText(/· paused/)).toBeVisible();
});

/** E2E TV, week 22 of 2030, with what Saturday 1 June is filled from; the URL of its Day tab. */
async function saturday(page: Page) {
  await page.goto('/playlist');
  await page.getByRole('button', { name: /^Channel:/ }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: 'E2E TV', exact: true }).click();
  const url = new URL(page.url());
  url.searchParams.set('month', '2030-06');
  await page.goto(url.toString());
  await page.getByRole('button', { name: 'Create week 22' }).click();
  await page.getByRole('dialog', { name: 'Create weeks' }).getByRole('button', { name: 'Create 1 week' }).click();
  await prepareFill('2030-06-01');
  url.searchParams.set('tab', 'day');
  url.searchParams.set('date', '2030-06-01');
  return url;
}

test('phase C1: rows of a day changed by an agent, previewed on the grid and saved', async ({ page }) => {
  await makeAgentTeam();
  const url = await saturday(page);
  const filler = await itemWithLength();
  await seedAgentChange('edit_day', '2030-06-01', { changes: [{ op: 'add', item: filler.id, block: 'Run Block 1' }] });
  await page.goto(url.toString());
  const table = page.getByRole('table', { name: 'Main playlist of Sat 1 Jun 2030' });
  await expect(table).toBeVisible();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Agent panel' });
  await panel.getByRole('combobox', { name: 'Agent' }).selectOption({ label: 'Weeks builder' });
  await panel.getByRole('button', { name: 'Preview on the page' }).click();
  await expect(page.getByText('Weeks builder’s change, not saved yet: Change rows of a day')).toBeVisible();
  await expect(page.getByText('1 new or changed row (green).')).toBeVisible();
  await expect(table.getByText('new', { exact: true })).toHaveCount(1);
  await shot(page, 'agents-edit-day-preview');
  await page.getByRole('button', { name: 'Approve and save' }).click();
  await expect(page.getByText('Approved and saved')).toBeVisible();
  await expect(table.getByText('new', { exact: true })).toHaveCount(0);
  await expect(table.getByText(filler.title).first()).toBeVisible();
});

test('phase C1: a day approved for air is approved twice', async ({ page }) => {
  await makeAgentTeam();
  await saturday(page);
  await seedAgentChange('approve_day', '2030-06-01');
  await page.goto('/agents/waiting');
  const card = page.getByText('Approve a day for air', { exact: true }).locator('..').locator('..');
  await expect(card.getByText('Puts the day on air: you approve it twice.')).toBeVisible();
  await card.getByRole('button', { name: 'Approve' }).click();
  const ask = page.getByRole('dialog', { name: 'Approve this day for air?' });
  await expect(ask).toBeVisible();
  await shot(page, 'agents-approve-twice');
  expect(await dayApproved('2030-06-01')).toBe(false);
  await ask.getByRole('button', { name: 'Approve for air' }).click();
  await expect(page.getByText('Approved and applied')).toBeVisible();
  expect(await dayApproved('2030-06-01')).toBe(true);
});

