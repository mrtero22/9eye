// Captures the product screenshots from the dev server's /shots pages into public/ (decision 0022).
// Run the dev server first (npm -w @9eye/site run dev), then: npm -w @9eye/site run shots
// Screenshots are 2× WebP (converted in the browser) with a 1200 px wide copy for phones and 1× screens;
// the social card is a 1200 × 630 PNG; logo.png is the mark at 512 × 512 (the Organization logo for search engines).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const BASE = process.env.SHOTS_URL ?? 'http://127.0.0.1:4102';
const out = new URL('../public/', import.meta.url);
const browser = await chromium.launch();

async function open(path, width, height, scale) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function toWebp(page, png, width, quality = 0.92) {
  const dataUrl = await page.evaluate(async ({ b64, w, q }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w ?? img.naturalWidth;
    canvas.height = Math.round((canvas.width * img.naturalHeight) / img.naturalWidth);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', q);
  }, { b64: png.toString('base64'), w: width, q: quality });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

// Names after the command (npm -w @9eye/site run shots -- checker-report) capture only those pictures.
const only = process.argv.slice(2);
const NAMES = ['templates', 'orders', 'order', 'checker-capture', 'checker-report', 'checker-playlist'];

await mkdir(new URL('images/', out), { recursive: true });
for (const name of only.length ? only : NAMES) {
  const page = await open(`/shots/${name}`, 1200, 760, 2);
  const png = await page.locator('#shot').screenshot({ type: 'png' });
  for (const [file, width] of [[`${name}.webp`], [`${name}-1200.webp`, 1200]]) {
    const webp = await toWebp(page, png, width);
    await writeFile(new URL(`images/${file}`, out), webp);
    console.log(`images/${file}  ${Math.round(webp.length / 1024)} KB`);
  }
  await page.close();
}

if (!only.length) {
  const svg = await readFile(new URL('favicon.svg', out));
  const mark = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await mark.setContent(`<body style="margin: 0"><img src="data:image/svg+xml;base64,${svg.toString('base64')}" width="512" height="512"></body>`);
  const logo = await mark.screenshot({ type: 'png', omitBackground: true });
  await writeFile(new URL('logo.png', out), logo);
  console.log(`logo.png  ${Math.round(logo.length / 1024)} KB`);
  await mark.close();

  const og = await open('/shots/og', 1200, 630, 1);
  const png = await og.locator('#shot').screenshot({ type: 'png' });
  await writeFile(new URL('og.png', out), png);
  console.log(`og.png  ${Math.round(png.length / 1024)} KB`);
}
await browser.close();
