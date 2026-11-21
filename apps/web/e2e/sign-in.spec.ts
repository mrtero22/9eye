// Sign-in (decision 0021, docs/design/sign-in-page.md): every page asks for it first, wrong passwords
// are refused, the person and Sign out are in the user menu, a session that ran out comes back here.

import { expect, test } from '@playwright/test';
import { SLUG, disconnect, endSessions, makeCompany, makePerson, removeCompany, signIn } from './fixture';

const EMAIL = 'night.desk@e2e.example';
const PASSWORD = 'a long test password';

test.beforeEach(async ({ page }) => {
  await makeCompany();
  await page.addInitScript((slug) => localStorage.setItem('9eye.company', slug), SLUG);
});

test.afterAll(async () => {
  await removeCompany();
  await disconnect();
});

test('a page asks for sign-in first, then opens; sign out closes it again', async ({ page }) => {
  await makePerson(EMAIL, 'Night desk', PASSWORD);
  await page.goto('/scheduling');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fscheduling$/);
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeFocused();

  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Type your email and password.')).toBeVisible();

  await page.getByLabel('Email').fill(EMAIL);
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('not the password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await password.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Email or password is not right.');
  await expect(password).toHaveValue('');
  await expect(password).toBeFocused();

  await password.fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/scheduling$/);
  await expect(page.getByRole('heading', { name: 'Scheduling' })).toBeVisible();

  await page.getByRole('button', { name: 'Account, admin and display settings' }).click();
  await expect(page.getByText(EMAIL)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/templates');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Ftemplates$/);
});

test('a session that ran out comes back to sign-in and says so', async ({ page }) => {
  await signIn(page);
  await page.goto('/templates');
  await expect(page.getByRole('button', { name: /^Channel:/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await endSessions();
  await page.getByRole('link', { name: 'Media' }).first().click();
  await expect(page).toHaveURL(/\/sign-in\?reason=expired&next=%2Fcatalog$/);
  await expect(page.getByText('You were signed out. Sign in again to continue.')).toBeVisible();
});

test('the theme can change before sign-in; on a phone only the form shows', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('figure', { name: 'A sample day on a channel' })).toBeVisible();
  await page.getByRole('button', { name: 'Light theme' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole('figure', { name: 'A sample day on a channel' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
