import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { platformDb } from '../src/db';
import { auth, makeCompany, makeEmptyChannel, resetDb, type Fixture } from './fixtures';

const app = createApp();
let a: Fixture;
let b: Fixture;

beforeEach(async () => {
  await resetDb();
  a = await makeCompany('aurora');
  b = await makeCompany('other');
});

afterAll(async () => {
  await platformDb.$disconnect();
});

const get = (f: Fixture, id: string) => request(app).get(`/api/channels/${id}`).set(auth(f.slug));
const put = (f: Fixture, id: string, body: object) => request(app).put(`/api/channels/${id}`).set(auth(f.slug)).send(body);

async function settings(f: Fixture, id: string, patch: object = {}) {
  const c = (await get(f, id).expect(200)).body;
  return { version: c.version, name: c.name, code: c.code, frameRate: c.frameRate, dayStartFrames: c.dayStartFrames, weekStart: c.weekStart, timeZone: c.timeZone, dateLocale: c.dateLocale, hasAds: !!c.adsPlaylistId, ...patch };
}

describe('channel settings', () => {
  it('saves name, code, time zone and date locale, and bumps the version', async () => {
    const r = await put(a, a.channelId, await settings(a, a.channelId, { name: 'AURORA TV HD', code: 'AURHD', timeZone: 'Asia/Tehran', dateLocale: 'es' })).expect(200);
    expect(r.body).toMatchObject({ name: 'AURORA TV HD', code: 'AURHD', timeZone: 'Asia/Tehran', dateLocale: 'es', version: 2 });
  });

  it('is the company’s own', async () => {
    await get(a, b.channelId).expect(404);
    await put(a, b.channelId, await settings(b, b.channelId, { name: 'x' })).expect(404);
  });

  it('refuses invalid settings, taken names and codes, and stale versions', async () => {
    const other = await makeEmptyChannel(a, 'Second');
    const bad = await put(a, a.channelId, await settings(a, a.channelId, { code: 'has space', timeZone: 'Mars/Base', dateLocale: 'xx-nope-123', frameRate: '31' })).expect(422);
    expect(bad.body.problems.map((p: { code: string }) => p.code).sort()).toEqual(['code', 'date-locale', 'frame-rate', 'time-zone']);
    const taken = await put(a, other, await settings(a, other, { name: 'AURORA TV', code: 'AURORA' })).expect(422);
    expect(taken.body.problems.map((p: { code: string }) => p.code)).toEqual(['name', 'code']);
    const s = await settings(a, a.channelId);
    await put(a, a.channelId, { ...s, name: 'One' }).expect(200);
    await put(a, a.channelId, { ...s, name: 'Two' }).expect(409);
  });

  it('refuses a first weekday that the layouts do not fit, listing them, and saves nothing', async () => {
    const r = await put(a, a.channelId, await settings(a, a.channelId, { weekStart: 1, name: 'Renamed' })).expect(422);
    expect(r.body.error).toMatch(/every layout of AURORA TV starts on a Monday and ends on a Sunday/);
    expect(r.body.problems.map((p: { templateId: string }) => p.templateId).sort()).toEqual([a.mainTemplateId, a.adsTemplateId].sort());
    expect(r.body.problems.find((p: { templateId: string }) => p.templateId === a.mainTemplateId).message).toBe('MAIN · main playlist · 23 Mar 2024 (Sat) → 29 May 2099 (Fri)');
    const now = (await get(a, a.channelId).expect(200)).body;
    expect(now).toMatchObject({ name: 'AURORA TV', weekStart: 6, version: 1 });
  });

  it('changes the first weekday when no layout is in the way', async () => {
    const empty = await makeEmptyChannel(a, 'Empty');
    const r = await put(a, empty, await settings(a, empty, { weekStart: 1 })).expect(200);
    expect(r.body.weekStart).toBe(1);
    // a template that already fits the new week does not block it
    await request(app).post('/api/templates').set(auth(a.slug)).send({ playlistId: r.body.mainPlaylistId, name: 'Mon', validFrom: '2026-10-19', validTo: '2026-12-27' }).expect(201);
    await put(a, empty, await settings(a, empty, { weekStart: 1, name: 'Still Monday' })).expect(200);
  });

  it('keeps frame rate and day start while layouts or block types use them', async () => {
    const r = await put(a, a.channelId, await settings(a, a.channelId, { frameRate: '29.97df', dayStartFrames: 0 })).expect(422);
    expect(r.body.error).toMatch(/frame rate and day start can change only while AURORA TV has no layouts and no block types/);
    expect(r.body.problems.at(-1).message).toMatch(/block types belong to this channel/);
    // a new frame rate with the same time of day (06:00 at 30 fps) is not a new day start
    const rate = await put(a, a.channelId, await settings(a, a.channelId, { frameRate: '30', dayStartFrames: 6 * 3600 * 30 })).expect(422);
    expect(rate.body.error).toMatch(/The frame rate can change only/);
    // and a time-zone change alone is fine on the same channel
    await put(a, a.channelId, await settings(a, a.channelId, { timeZone: 'Asia/Tehran' })).expect(200);
    const empty = await makeEmptyChannel(a, 'Fresh');
    const ok = await put(a, empty, await settings(a, empty, { frameRate: '29.97df', dayStartFrames: 5 * 107892 })).expect(200);
    expect(ok.body).toMatchObject({ frameRate: '29.97df', dayStartFrames: 539460 });
    await put(a, empty, await settings(a, empty, { dayStartFrames: 24 * 107892 })).expect(422);
  });

  it('adds an ads playlist, and removes it only when nothing uses it', async () => {
    const r = await put(a, a.channelId, await settings(a, a.channelId, { hasAds: false })).expect(422);
    expect(r.body.problems.map((p: { code: string }) => p.code)).toContain('ads-in-use');
    expect(r.body.problems.some((p: { templateId?: string }) => p.templateId === a.adsTemplateId)).toBe(true);

    const solo = await makeEmptyChannel(a, 'Solo');
    const on = await put(a, solo, await settings(a, solo, { hasAds: true })).expect(200);
    expect(on.body.adsPlaylistId).toBeTruthy();
    const off = await put(a, solo, await settings(a, solo, { hasAds: false })).expect(200);
    expect(off.body.adsPlaylistId).toBeNull();
  });

  it('saves defaults, exports and checks, and refuses ones that do not fit', async () => {
    await request(app).post(`/api/channels/${a.channelId}/break-lists`).set(auth(a.slug)).send({ name: 'Hourly', positions: [0, 1] }).expect(201);
    const lists = (await request(app).get(`/api/channels/${a.channelId}/break-lists`).set(auth(a.slug)).expect(200)).body;
    const ok = await put(a, a.channelId, await settings(a, a.channelId, {
      ageLogoPosition: 'top-right', defaultBreakListId: lists[0].id, shortestBreakFrames: 25 * 30,
      allowedExports: ['playout-xml', 'bxf'], defaultExport: 'bxf', epgTypes: ['xmltv'], bxfTimesUtc: true, reconcileTolerance: 2,
    })).expect(200);
    expect(ok.body).toMatchObject({ ageLogoPosition: 'top-right', defaultBreakListId: lists[0].id, shortestBreakFrames: 750, allowedExports: ['playout-xml', 'bxf'], defaultExport: 'bxf', epgTypes: ['xmltv'], bxfTimesUtc: true, reconcileTolerance: 2 });
    const bad = await put(a, a.channelId, await settings(a, a.channelId, { allowedExports: ['playout-xml', 'nope'], defaultExport: 'csv', epgTypes: ['dvb'], ageLogoPosition: 'middle' })).expect(422);
    expect(bad.body.problems.map((p: { code: string }) => p.code).sort()).toEqual(['age-logo', 'default-export', 'epg', 'exports']);
    const other = await makeEmptyChannel(a, 'Other');
    const foreignList = await put(a, other, await settings(a, other, { hasAds: true, defaultBreakListId: lists[0].id })).expect(422);
    expect(foreignList.body.problems[0].code).toBe('break-list');
  });

  it('creates a channel with its playlists, and tells what uses a channel', async () => {
    const r = await request(app).post('/api/channels').set(auth(a.slug)).send({ name: 'New One', code: 'NEW1', frameRate: '29.97df', dayStartFrames: 0, weekStart: 1, hasAds: true }).expect(201);
    expect(r.body).toMatchObject({ name: 'New One', frameRate: '29.97df', weekStart: 1, templateCount: 0 });
    expect(r.body.mainPlaylistId).toBeTruthy();
    expect(r.body.adsPlaylistId).toBeTruthy();
    await request(app).post('/api/channels').set(auth(a.slug)).send({ name: 'New Two', code: 'NEW1', frameRate: '25', dayStartFrames: 0, weekStart: 1, hasAds: false }).expect(422);
    const u = (await request(app).get(`/api/channels/${a.channelId}/usage`).set(auth(a.slug)).expect(200)).body;
    expect(u.templates.map((t: { name: string }) => t.name).sort()).toEqual(['ADS', 'MAIN']);
    expect(u.blockTypeCount).toBe(4 + 48);
    expect(u.adsBlockTypeCount).toBe(48);
    expect(u.mainTemplatesWithBreaks).toEqual([]);
    await request(app).get(`/api/channels/${a.channelId}/usage`).set(auth(b.slug)).expect(404);
  });
});
