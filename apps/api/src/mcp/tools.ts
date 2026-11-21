// The MCP server and its read tools (decision 0023). Each tool runs as the token's person in the
// token's company, checks their role, calls the same services as the REST API and answers in plain
// text an AI model reads well: clock times and lengths as timecode, 9eye's own words (glossary).
// A token made with --edit also gets the write tools (writes.ts).

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/server';
import { dayChecks, dayEnd, formatClock, formatTc, frameRate, uuidv7, type DayDraft, type FrameRate } from '@9eye/core';
import { demand, reachesChannel } from '../access';
import { record } from '../audit';
import { Prisma } from '@prisma/client';
import { cellOf } from '../aiPolicy';
import { db, platformDb, withTenant } from '../db';
import { HttpError } from '../errors';
import { listBreakPositions } from '../services/breakPositions';
import { searchCatalog, type Family } from '../services/catalog';
import { getCommercialOrder } from '../services/commercialOrders';
import { getContract, listContracts } from '../services/commercials';
import { getDay, type DayDto } from '../services/days';
import { listOrders } from '../services/orders';
import type { Principal } from './auth';
import {
  FAMILY, PLAN_MODE, ROW_KIND, STATUS, WEEKDAYS, capped, channelArg, channelList, dateArg, dayHead, errorText, findChannel, isUuid, isoDate, missingText, myChannels, playlistArg, plural, quote, range, weekdayOf, type DefineTool, type ToolDef, type ToolResult, checkText, rowRef,
} from './common';
import { registerLayoutRead } from './changes';
import { campaignRef, registerAdsRead } from './ads';
import { registerMediaRead } from './media';
import { registerPlanRead } from './plans';
import { registerPlaylistRead } from './playlist';
import { registerSetupRead } from './setup';
import { registerWriteTools } from './writes';

export const SERVER_VERSION = '0.2.0';

const READ_ONLY_TEXT = 'it is read only: it cannot change anything.';
const WRITE_TEXT = `it can read, and change things with the write tools and undo_change, as far as the company's AI access table and the person's role allow (where the table says Ask first, a change waits in 9eye for a person). Always call a write tool with apply: false first, show the person the preview, and apply only after they agree; every applied change has a change id that undo_change can put back. Approving or reopening a day for air and exporting a day's playout file follow the table too (Playlist › Approve, Playlist › Export).`;

/** 9eye's words and formats, for the MCP clients and the agents (decision 0024). */
export const WORDS_TEXT = `Words: Media holds Categories → Titles → Items (an episode or version of a title). A channel has a Layout of blocks per weekday; Plans place titles in those blocks (first airings and repeats), and a plan is Draft until it is Confirmed: then filling a day places its airings in the playlist. Every broadcast day has a main playlist and, on channels with ads, an ads playlist; a day is Draft until a person approves it (Approved). Deals with clients hold Campaigns, which book ad spots into the breaks of the ads playlist.

Times: clock times are times of day; lengths are HH:MM:SS:FF timecode at the channel's frame rate. A broadcast day starts at the channel's day start and can run past midnight. Dates are YYYY-MM-DD. A channel can be named by its name, code or id.`;

const instructions = (p: Principal) => `9eye is a broadcast scheduling and traffic system. This connection works in one company, "${p.tenant.name}", as ${p.user.name}, and ${p.canWrite ? WRITE_TEXT : READ_ONLY_TEXT}

${WORDS_TEXT} Start with list_channels.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
/** Write tools: the client asks the person before each call. */
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

// ---------------------------------------------------------------- day playlist

function dayText(d: DayDto, withRows: boolean): string {
  if (!d.day) return `${dayHead(d)}\n${missingText(d)}`;
  const r = frameRate(d.channel.frameRate);
  const clock = (f: number) => formatClock(f, d.channel.dayStartFrames, r);
  const tc = (f: number) => formatTc(f, r);
  const end = dayEnd(d.day.totalFrames, d.channel.dayStartFrames, r);
  const rows = d.day.blocks.reduce((n, b) => n + b.events.length, 0);
  const short = d.day.blocks.filter((b) => b.gapFrames < 0).length;
  const over = d.day.blocks.filter((b) => b.gapFrames > 0).length;
  const out = [
    dayHead(d),
    [
      `version ${d.day.version}`,
      d.week ? `Week ${d.week.number} ${quote(d.week.name)}, layout ${quote(d.week.templateName)}` : null,
      `${clock(0)} → ${tc(end.endClockFrames)}${end.nextDay ? ' next day' : ''} (${tc(d.day.totalFrames)})`,
      plural(d.day.blocks.length, 'block'),
      plural(rows, 'row'),
      short ? `${plural(short, 'block')} short` : null,
      over ? `${plural(over, 'block')} over` : null,
      d.day.notReady ? `${plural(d.day.notReady, 'row')} with media not ready` : null,
    ].filter(Boolean).join(' · '),
    `Clock times are times of day; lengths are timecode at ${r.label}.`,
    '',
  ];
  for (const b of d.day.blocks) {
    const off = b.gapFrames < 0 ? `${tc(-b.gapFrames)} short` : b.gapFrames > 0 ? `${tc(b.gapFrames)} over` : 'full';
    out.push(`${clock(b.realStartFrames)}  ${b.name}  · planned ${clock(b.plannedStartFrames)} for ${tc(b.plannedLengthFrames)} · real ${tc(b.realLengthFrames)} · ${off}${b.note ? ` · note: ${b.note}` : ''}`);
    if (!withRows) continue;
    for (const e of b.events) {
      const what = [
        ROW_KIND[e.kind] ?? e.kind,
        e.title || null,
        e.episode ? `ep ${e.episode}` : null,
        e.media === 'not-ready' ? 'MEDIA NOT READY' : null,
        e.note ? `note: ${e.note}` : null,
      ].filter(Boolean).join(' · ');
      out.push(`${e.inBreak ? '      ' : '  '}${clock(e.startFrames)}  ${tc(e.lengthFrames)}  ${what} · row ${rowRef(e.id)}`);
    }
  }
  return out.join('\n');
}


// ---------------------------------------------------------------- the server

/** One MCP server for one request, as the token's person in the token's company. */
export function buildServer(p: Principal): McpServer {
  const server = new McpServer({ name: '9eye', title: '9eye', version: SERVER_VERSION }, { instructions: instructions(p) });
  for (const def of toolDefs(p)) {
    const call = async (args: unknown) => {
      const r = await invokeTool(p, def, args);
      return r.isError ? { content: [{ type: 'text' as const, text: r.text }], isError: true } : { content: [{ type: 'text' as const, text: r.text }] };
    };
    // The SDK checks `args` against `input` before the call; its callback type does not follow a generic schema.
    const annotations = { title: def.title, ...(def.kind === 'write' ? WRITE : READ_ONLY) };
    server.registerTool(def.name, { title: def.title, description: def.description, inputSchema: def.input, annotations }, call as never);
  }
  return server;
}

/**
 * Runs one tool as `p`, in its company: every call goes to the audit log, reads and failures
 * included; an applied change keeps its before and after under the change id its answer names
 * (decision 0023). The MCP endpoint and the agents (decision 0024) both call tools through here.
 */
export async function invokeTool(
  p: Principal, def: ToolDef, args: unknown,
): Promise<{ text: string; isError: boolean; status: number | null; changeId: string | null; applyWith: Record<string, unknown> | null }> {
  if (p.via === 'mcp' && !p.approved && def.kind === 'write' && (args as { apply?: boolean } | null)?.apply === true && cellOf(p.policy, def.name) === 'ask') {
    return askFirst(p, def, args as Record<string, unknown>);
  }
  const changeId = uuidv7();
  let result: ToolResult | null = null;
  let failure: string | null = null;
  let status: number | null = null;
  try {
    result = await withTenant(p.tenant.id, () => def.run(args as never, { changeId }));
  } catch (e) {
    failure = errorText(e);
    status = e instanceof HttpError ? e.status : 500;
  }
  const change = result && typeof result === 'object' ? (result.change ?? null) : null;
  await record({
    id: change ? changeId : undefined, tenantId: p.tenant.id, userId: p.user.id, via: p.via, tokenId: p.tokenId, action: `tool ${def.name}`,
    ok: failure === null, message: failure, input: args,
    ...(change ? { targetId: change.targetId, channelIds: change.channelIds, before: change.before, after: change.after } : {}),
  }).catch((err) => console.error('audit', err));
  if (failure !== null) return { text: failure, isError: true, status, changeId: null, applyWith: null };
  if (typeof result === 'string') return { text: result, isError: false, status: null, changeId: null, applyWith: null };
  return { text: result!.text, isError: false, status: null, changeId: change ? changeId : null, applyWith: result!.applyWith ?? null };
}

/** Every tool `p` may use: the read tools, and the write tools when `p.canWrite`. */
export function toolDefs(p: Principal): ToolDef[] {
  const defs: ToolDef[] = [];
  const tool: DefineTool = (name, title, description, input, run, kind = 'read') => {
    defs.push({ name, title, description, input, run: run as ToolDef['run'], kind });
  };

  tool('list_channels', 'List channels', 'The channels you can open in this company: code, frame rate, day start, current broadcast day and playlists.', z.object({}), async () => {
    const rows = await myChannels(p);
    if (!rows.length) return 'You cannot open any channel in this company.';
    return rows
      .map((c) => {
        const r = frameRate(c.frameRate);
        return [
          `- ${c.name}`,
          `code ${c.code}`,
          r.label,
          `day starts ${formatTc(c.dayStartFrames, r)}`,
          `week starts ${WEEKDAYS[c.weekStart]}`,
          c.timeZone ? `time zone ${c.timeZone}` : null,
          `today ${c.today}`,
          c.adsPlaylistId ? 'main + ads playlists' : 'main playlist only',
          `id ${c.id}`,
        ].filter(Boolean).join(' · ');
      })
      .join('\n');
  });

  tool(
    'get_day_playlist',
    'Day playlist',
    "One broadcast day of a channel: every block with its planned and real start and length, and (rows: true) every row — clock time, length, kind, title, episode, media state, note. Use check_day to see what is wrong with a day.",
    z.object({ channel: channelArg, date: dateArg, playlist: playlistArg, rows: z.boolean().default(true).describe('false = blocks only (shorter).') }),
    async ({ channel, date, playlist, rows }) => {
      const c = await findChannel(p, channel);
      demand(p.access, 'playlist', 'view', c.id);
      return dayText(await getDay(c.id, playlist, date ?? c.today), rows);
    },
  );

  tool(
    'check_day',
    'Check a day',
    'What is still to do or wrong on one broadcast day, the same checks as the day page: the steps that fill the day and how far each got, issues (with the step that fixes each), blocks short or over their planned length, and rows whose media is not ready.',
    z.object({ channel: channelArg, date: dateArg, playlist: playlistArg }),
    async ({ channel, date, playlist }) => {
      const c = await findChannel(p, channel);
      demand(p.access, 'playlist', 'view', c.id);
      return checkText(await getDay(c.id, playlist, date ?? c.today));
    },
  );

  tool(
    'search_media',
    'Search media',
    'Find titles and items in Media by name or code: category, episode, length, media state and rights dates.',
    z.object({
      query: z.string().min(1).max(200).describe('Words in the title or item name, or an item code.'),
      kind: z.enum(['programmes', 'trailers_and_stings', 'ads']).optional().describe('Only this kind of media. Default: all.'),
    }),
    async ({ query, kind }) => {
      demand(p.access, 'catalog', 'view');
      const families: Family[] = kind ? [FAMILY[kind]] : ['program', 'filling', 'advert'];
      const found = await searchCatalog(query, families);
      const r: FrameRate = frameRate(p.tenant.catalogFrameRate);
      const out = [`Titles (${found.contents.length}):`];
      if (!found.contents.length) out.push('- none');
      for (const c of found.contents) {
        out.push([`- ${quote(c.title)}`, `category ${quote(c.typeName)}`, c.code && c.code !== c.title ? `code ${c.code}` : null, plural(c.productionCount, 'item'), `id ${c.id}`].filter(Boolean).join(' · '));
      }
      out.push('', `Items (${found.productions.length}):`);
      if (!found.productions.length) out.push('- none');
      const items = found.productions.map((x) =>
        [
          `- ${quote(x.title)}`,
          x.code && x.code !== x.title ? `code ${x.code}` : null,
          x.chapter ? `ep ${x.chapter}` : null,
          x.lengthFrames !== null ? formatTc(x.lengthFrames, r) : 'no length',
          x.mediaStatus === 'ready' ? 'media ready' : x.mediaStatus === 'not-ready' ? 'MEDIA NOT READY' : null,
          x.starts || x.expires ? `rights ${x.starts ?? '…'} → ${x.expires ?? '…'}` : null,
          `title ${quote(x.contentTitle)} (${x.typeName})`,
          `id ${x.id}`,
        ].filter(Boolean).join(' · '),
      );
      out.push(...capped(items, 'search with more words'));
      return out.join('\n');
    },
  );

  tool(
    'list_plans',
    'List plans',
    "A channel's Scheduling plans (which titles air in which blocks): kind, status, dates, items, this week's first airings and repeats, the last airing, and any issue.",
    z.object({ channel: channelArg, query: z.string().max(200).optional().describe('Only plans whose name contains these words.') }),
    async ({ channel, query }) => {
      const c = await findChannel(p, channel);
      demand(p.access, 'orders', 'view', c.id);
      const list = await listOrders(c.id);
      const low = query?.trim().toLowerCase();
      const plans = low ? list.orders.filter((o) => o.name.toLowerCase().includes(low)) : list.orders;
      const out = [`${c.name} · ${plural(plans.length, 'plan')} · "this week" starts ${list.weekFrom}`];
      const lines = plans.flatMap((o) => {
        const firsts = o.week.firsts.map((f) => `${weekdayOf(f.date).slice(0, 3)} ${f.date} ${f.clock}${f.chapter ? ` ep ${f.chapter}` : ''}`);
        return [
          [
            `- ${quote(o.name)}`,
            PLAN_MODE[o.mode] ?? o.mode,
            STATUS[o.status] ?? o.status,
            range(o.startDate, o.endDate),
            plural(o.itemCount, 'item'),
            o.mode === 'series' ? `${o.placed} placed, ${o.aired} aired before this week` : null,
            `id ${o.id}`,
          ].filter(Boolean).join(' · '),
          `  This week: ${firsts.length ? `first airings ${firsts.join(', ')}` : 'no first airings'}${o.week.repeats ? `; ${plural(o.week.repeats, 'repeat')}` : ''}`,
          ...(o.lastAiring ? [`  Last airing ${o.lastAiring}`] : []),
          ...(o.issue ? [`  Issue: ${o.issue.text}`] : []),
        ];
      });
      out.push(...capped(lines, 'narrow it with query'));
      return out.join('\n');
    },
  );

  tool(
    'list_deals',
    'List deals',
    'Deals with ad clients: client, dates, channels, campaigns and booked spots. Use get_deal for one deal with its campaigns.',
    z.object({
      query: z.string().max(200).optional().describe('Only deals whose name or client contains these words.'),
      on: isoDate.optional().describe('Only deals running on this date (YYYY-MM-DD).'),
    }),
    async ({ query, on }) => {
      demand(p.access, 'orders', 'view');
      // Deals belong to the whole company (src/rules.ts); campaigns to their channel.
      const rows = await db.channel.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
      const channels = new Map(rows.map((c) => [c.id, c.name]));
      const low = query?.trim().toLowerCase();
      const deals = (await listContracts()).filter(
        (d) => (!low || d.name.toLowerCase().includes(low) || d.clientName.toLowerCase().includes(low)) && (!on || (d.startDate <= on && on <= d.endDate)),
      );
      const lines = deals.map((d) =>
        [
          `- ${quote(d.name)}`,
          `client ${quote(d.clientName)}`,
          range(d.startDate, d.endDate),
          plural(d.orders, 'campaign'),
          `${d.spotsBooked} booked spots`,
          d.channelIds.length ? channelList(d.channelIds.flatMap((id) => channels.get(id) ?? [])) : null,
          `id ${d.id}`,
        ].filter(Boolean).join(' · '),
      );
      return [`${plural(deals.length, 'deal')}`, ...capped(lines, 'narrow it with query or on')].join('\n');
    },
  );

  tool(
    'get_deal',
    'Get a deal',
    'One deal: client, dates, deal value, notes and its campaigns per channel with their booked spots.',
    z.object({ deal: z.string().min(1).max(300).describe("The deal's id or its exact name (list_deals shows both).") }),
    async ({ deal }) => {
      demand(p.access, 'orders', 'view');
      let id = deal.trim();
      if (!isUuid(id)) {
        const low = id.toLowerCase();
        const hits = (await listContracts()).filter((d) => d.name.toLowerCase() === low);
        if (hits.length !== 1) throw new HttpError(hits.length ? 400 : 404, hits.length ? `${hits.length} deals are called "${deal}": use the id (list_deals).` : `No deal "${deal}". list_deals finds deals by name or client.`);
        id = hits[0].id;
      }
      const d = await getContract(id);
      const campaigns = d.ordersList.filter((o) => reachesChannel(p.access, o.channelId));
      const hidden = d.ordersList.length - campaigns.length;
      const out = [
        [`Deal ${quote(d.name)}`, `client ${quote(d.clientName)}`, range(d.startDate, d.endDate), `deal value ${d.totalAgreed.toLocaleString('en-US')} ${d.currency}`, `id ${d.id}`].join(' · '),
        d.notes ? `Notes: ${d.notes}` : null,
        '',
        `Campaigns (${campaigns.length}${hidden ? `; ${hidden} more on channels your role does not reach` : ''}):`,
      ].filter((x) => x !== null) as string[];
      if (!campaigns.length) out.push('- none');
      for (const o of campaigns) {
        out.push([`- ${quote(o.name)}`, o.channelName, range(o.startDate, o.endDate), STATUS[o.status] ?? o.status, plural(o.spots, 'ad'), `${o.spotsBooked} booked spots`, `id ${o.id}`].join(' · '));
      }
      return out.join('\n');
    },
  );

  tool(
    'get_campaign',
    'Get a campaign',
    'One ad campaign: status, dates, version, channel, its deal and client, the ads it may book with how often each is booked, the breaks it can book into, and the break positions.',
    z.object({ campaign: z.string().trim().min(1).max(300).describe('The campaign: its id or name (get_deal lists them).') }),
    async ({ campaign }) => {
      const o = await campaignRef(p, campaign, 'view');
      const r = frameRate(o.channel.frameRate);
      const cr = frameRate(p.tenant.catalogFrameRate);
      const positions = await listBreakPositions();
      const out = [
        [`Campaign ${quote(o.name)}`, STATUS[o.status] ?? o.status, range(o.startDate, o.endDate), `channel ${o.channel.name}`, `layout ${quote(o.template.name)}`, `version ${o.version}`, `id ${o.id}`].join(' · '),
        `Deal ${quote(o.contract.name)} · client ${quote(o.contract.clientName)} · ${range(o.contract.startDate, o.contract.endDate)} · id ${o.contract.id}`,
        positions.length ? `Break positions: ${positions.map((x) => `${x.name}${x.isDefault ? ' (default)' : ''}`).join(', ')}` : 'Break positions: none',
        '',
        `Ads it may book (${o.booked} booked spots in all):`,
      ];
      if (!o.items.length) out.push('- none');
      o.items.forEach((x, i) =>
        out.push([`- V${i + 1} ${quote(x.title)}`, `code ${x.code}`, x.lengthFrames !== null ? formatTc(x.lengthFrames, cr) : 'no length', `${x.booked} booked`].join(' · ')),
      );
      out.push('', `Breaks it can book into (${o.breaks.length}):`);
      const breaks = o.breaks.map((b) => {
        const days = b.weekdays.every(Boolean) ? 'every day' : WEEKDAYS.filter((_, i) => b.weekdays[i]).map((w) => w.slice(0, 3)).join(' ');
        return `- ${formatClock(b.startFrames, o.channel.dayStartFrames, r)} ${b.name} · ${days}`;
      });
      out.push(...capped(breaks, 'book_campaign_spots can pick breaks by words in their name and a time range', 30));
      return out.join('\n');
    },
  );

  registerLayoutRead(tool, p);
  registerSetupRead(tool, p);
  registerPlanRead(tool, p);
  registerAdsRead(tool, p);
  registerMediaRead(tool, p);
  registerPlaylistRead(tool, p);
  if (p.canWrite) registerWriteTools(tool, p);
  // What AI may do (decision 0025): a tool whose cell is Off is not there; Ask first says so.
  return defs
    .filter((d) => cellOf(p.policy, d.name) !== 'off')
    .map((d) => (p.via === 'mcp' && !p.approved && d.kind === 'write' && cellOf(p.policy, d.name) === 'ask' ? { ...d, description: `${d.description} ${ASK_FIRST}` } : d));
}

const ASK_FIRST =
  'In this company a person approves this in 9eye first: with apply: true it is not applied but waits in 9eye (Agents › Waiting for you) for someone who may do it. Tell the person so.';

/**
 * Ask first (decision 0025): an AI app's change is previewed and left waiting as a change card for a
 * person in 9eye, with the arguments that apply exactly that preview; nothing changes now.
 */
async function askFirst(p: Principal, def: ToolDef, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; status: number | null; changeId: string | null; applyWith: Record<string, unknown> | null }> {
  const previewArgs: Record<string, unknown> = { ...args, apply: false };
  delete previewArgs.version;
  let result: ToolResult;
  try {
    result = await withTenant(p.tenant.id, () => def.run(previewArgs as never, { changeId: uuidv7() }));
  } catch (e) {
    return { text: errorText(e), isError: true, status: e instanceof HttpError ? e.status : 500, changeId: null, applyWith: null };
  }
  if (typeof result === 'string' || !result.applyWith) return { text: typeof result === 'string' ? result : result.text, isError: false, status: null, changeId: null, applyWith: null };
  const applyArgs = { ...previewArgs, ...result.applyWith } as Prisma.InputJsonValue;
  const same = await platformDb.agentChange.findFirst({ where: { tenantId: p.tenant.id, tokenId: p.tokenId, tool: def.name, status: 'waiting', args: { equals: applyArgs } } });
  if (!same) {
    await platformDb.agentChange.create({
      data: { id: uuidv7(), tenantId: p.tenant.id, agentId: null, runId: null, tokenId: p.tokenId, userId: p.user.id, tool: def.name, args: applyArgs, preview: result.text },
    });
  }
  await record({ tenantId: p.tenant.id, userId: p.user.id, via: p.via, tokenId: p.tokenId, action: `tool ${def.name}`, ok: true, message: 'asked first: waits for a person', input: args }).catch((err) =>
    console.error('audit', err),
  );
  return {
    text: `${result.text}\n\n${same ? 'This same change is already waiting' : 'This now waits'} for a person in 9eye (Agents › Waiting for you): ${p.tenant.name} asks first for this. It is not applied yet; once someone who may do it approves it there, it is done — nothing more to call.`,
    isError: false, status: null, changeId: null, applyWith: null,
  };
}
