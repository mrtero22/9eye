// Dev helper: screenshots of the running app (not part of the product build).
// node shot.mjs <url path> <out.png> [width] [height] [actions-json]
// Pages behind sign-in: SHOT_AS=<email> signs in as that person with a session for this shot only.
import { createHash, randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
const [, , path = '/templates', out = 'shot.png', w = '1440', h = '1120', actions = '[]'] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
let signOut = async () => {};
if (process.env.SHOT_AS) {
  process.loadEnvFile(new URL('../../../.env', import.meta.url).pathname);
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const user = await db.user.findUniqueOrThrow({ where: { email: process.env.SHOT_AS } });
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const session = await db.session.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 600_000) } });
  await page.context().addCookies([{ name: 'nineeye_session', value: token, url: 'http://127.0.0.1:4101' }]);
  signOut = async () => {
    await db.session.delete({ where: { id: session.id } });
    await db.$disconnect();
  };
}
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://127.0.0.1:4101${path}`);
await page.waitForLoadState('networkidle');
for (const a of JSON.parse(actions)) {
  if (a.click) await page.getByRole(a.role ?? 'button', { name: a.click, exact: a.exact ?? false }).first().click();
  if (a.clickText) await page.getByText(a.clickText, { exact: true }).first().click();
  if (a.type) await page.keyboard.type(a.type);
  if (a.press) await page.keyboard.press(a.press);
  if (a.eval) await page.evaluate(a.eval);
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.reload) { await page.reload(); await page.waitForLoadState('networkidle'); }
}
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: false });
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no errors');
await browser.close();
await signOut();
