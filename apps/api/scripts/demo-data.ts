// The demo's working data (docker/demo), made with 9eye's own MCP tools — the same calls an AI agent
// makes, each previewed and then applied. All names are made up. Dates follow the day it runs:
// this week and next get their playlists, this week's days are filled, and the sample station gets
// ad clients, deals and campaigns booked into its breaks. A step that fails is reported and skipped.
//   npm -w @9eye/api run demo:data      (after db:seed and demo:setup)

import { uuidv7 } from '@9eye/core';
import { platformDb, withTenant, db } from '../src/db';
import { accessOf } from '../src/access';
import type { Principal } from '../src/mcp/auth';
import { invokeTool, toolDefs } from '../src/mcp/tools';

const EMAIL = (process.env.NINEEYE_DEMO_EMAIL ?? 'demo@9eye.local').trim().toLowerCase();
let failures = 0;

async function principal(slug: string): Promise<Principal | null> {
  const user = await platformDb.user.findUnique({ where: { email: EMAIL } });
  const tenant = await platformDb.tenant.findUnique({ where: { slug } });
  if (!user || !tenant) return null;
  const access = await accessOf(user, tenant.id);
  if (!access) return null;
  return { user, tenant, tokenId: null, via: 'mcp', access, canWrite: true, approved: true };
}

/** One tool call as `p`: a preview, then the same call applied with what the preview hands back. */
async function apply(p: Principal, name: string, args: Record<string, unknown>): Promise<string | null> {
  const def = toolDefs(p).find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  const preview = await invokeTool(p, def, def.input.parse({ ...args, apply: false }));
  if (preview.isError) return fail(name, args, preview.text);
  if (/Nothing would change/.test(preview.text)) return preview.text;
  // Most previews hand back what applies them; the others name the version in their text.
  const version = /apply: true and version (\d+)/.exec(preview.text)?.[1];
  const more = preview.applyWith ?? (version ? { version: Number(version) } : {});
  const done = await invokeTool(p, def, def.input.parse({ ...args, ...more, apply: true }));
  if (done.isError) return fail(name, args, done.text);
  return done.text;
}

function fail(name: string, args: Record<string, unknown>, text: string): null {
  failures++;
  console.error(`demo data: ${name} ${JSON.stringify(args)} — ${text.split('\n')[0]}`);
  return null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000));
/** The first day of the week holding `today`, for a channel whose week starts on `weekStart` (0 = Sunday). */
const weekOf = (today: string, weekStart: number) => addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() - weekStart + 7) % 7));

async function channel(p: Principal) {
  // Prisma queries run when awaited, so each one is awaited inside the company's context.
  return withTenant(p.tenant.id, async () => await db.channel.findFirstOrThrow({ where: { deletedAt: null } }));
}

async function weeksAndDays(p: Principal, withAds: boolean) {
  const c = await channel(p);
  const today = iso(new Date());
  const first = weekOf(today, c.weekStart);
  await apply(p, 'create_weeks', { channel: c.name, from_week: first, to_week: addDays(first, 7) });
  for (let i = 0; i < 7; i++) {
    const date = addDays(first, i);
    if (withAds) await apply(p, 'fill_day', { channel: c.name, date, playlist: 'ads', step: 'campaigns' });
    await apply(p, 'fill_day', { channel: c.name, date, playlist: 'main', step: 'programs' });
    if (withAds) await apply(p, 'fill_day', { channel: c.name, date, playlist: 'main', step: 'breaks' });
    await apply(p, 'fill_day', { channel: c.name, date, playlist: 'main', step: 'rotation' });
  }
  return { c, first };
}

async function promoList(p: Principal, name: string, category: string) {
  const titles = await withTenant(p.tenant.id, async () =>
    await db.content.findMany({ where: { deletedAt: null, contentType: { name: category } }, select: { title: true } }),
  );
  if (titles.length) await apply(p, 'create_rotation_list', { name, items: titles.map((t) => t.title) });
}

const ADS = [
  { client: 'Brightmilk Dairy', type: 'advertiser', title: 'Brightmilk', items: [['Brightmilk 15s', '00:00:15:00'], ['Brightmilk 30s', '00:00:30:00']], value: 24000, booking: { break_in_block: 1 } },
  { client: 'Nordbank', type: 'advertiser', title: 'Nordbank', items: [['Nordbank 20s', '00:00:20:00']], value: 18000, booking: { break_in_block: 2 } },
  { client: 'Velora Cosmetics', type: 'advertiser', title: 'Velora', items: [['Velora 30s', '00:00:30:00'], ['Velora 10s', '00:00:10:00']], value: 31000, booking: { between: { from: '18:00', to: '23:30' } } },
] as const;

async function ads(p: Principal, channelName: string, first: string) {
  // New items need a media source (Settings, not open to AI): the playout server's.
  await withTenant(p.tenant.id, async () => {
    if (!(await db.source.findFirst())) await db.source.create({ data: { id: uuidv7(), name: 'Playout server', code: 'SRV' } as never });
  });
  await apply(p, 'create_category', { name: 'Commercials', kind: 'ads', colour: '#dc2626' });
  for (const a of ADS) {
    await apply(p, 'create_title', { category: 'Commercials', title: a.title });
    for (const [name, length] of a.items) await apply(p, 'create_item', { title: a.title, name, length, media: 'ready' });
    await apply(p, 'create_client', { name: a.client, type: a.type, country: 'United States' });
    const deal = `${a.title} · Winter ${first.slice(0, 4)}`;
    await apply(p, 'create_deal', { client: a.client, name: deal, from: first, to: addDays(first, 41), currency: 'USD', value: a.value, channels: [channelName] });
    await apply(p, 'create_campaigns', { deal, ads: [a.title] });
    const campaign = await withTenant(p.tenant.id, async () =>
      await db.order.findFirst({ where: { deletedAt: null, contract: { name: deal } }, select: { id: true } }),
    );
    if (campaign) {
      await apply(p, 'book_campaign_spots', { campaign: campaign.id, from: first, to: addDays(first, 13), ...a.booking });
      // Confirmed campaigns are what the ads playlists take (fill_day, step campaigns).
      await apply(p, 'confirm_campaign', { campaign: campaign.id });
    }
  }
}

// The sample station: ads first (the day fill copies the booked spots into the breaks).
const station = await principal('sample-station');
if (station) {
  const c = await channel(station);
  const first = weekOf(iso(new Date()), c.weekStart);
  await promoList(station, 'Station promos', 'Station promos');
  await ads(station, c.name, first);
  await weeksAndDays(station, true);
}
// The public broadcaster: no ads; idents fill the gaps.
const pub = await principal('sample-public');
if (pub) {
  await promoList(pub, 'Station idents', 'Station idents');
  await weeksAndDays(pub, false);
}

console.error(failures ? `Demo data made, ${failures} step(s) skipped (above).` : 'Demo data made.');
await platformDb.$disconnect();
