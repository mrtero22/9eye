// "Repeat a time range": the blocks of one range of a day (e.g. 08:00–09:00) are repeated every
// interval until the end of the day, on chosen days. Every copy needs its own block types (a type
// is used once per day): the next numbers of each series ("sp 5, sp 6 …") or the name with the
// copy's time ("sp 1 09:00"), reusing existing unused ones first. All or nothing: the plan lists
// every problem, and nothing is created while there is one.

import {
  WEEKDAYS,
  breaksAtPositions,
  checkBlock,
  endOf,
  positionsOf,
  uuidv7,
  type BlockDraft,
  type BlockTypeInfo,
  type TemplateDraft,
} from '@9eye/core';
import type { BlockType } from '@/lib/types';
import { clock, seriesOf, type PageCtx } from './model';

export type RepeatNaming = 'number' | 'time';

export interface RepeatInput {
  weekday: number;
  from: number;
  to: number;
  every: number;
  /** Offset; 0 or the day length = the end of the broadcast day. */
  until: number;
  days: boolean[];
  naming: RepeatNaming;
}

export interface NewType {
  tempId: string;
  source: BlockType;
  name: string;
}

export interface RepeatPlan {
  sourceBlocks: BlockDraft[];
  copies: number;
  newTypes: NewType[];
  reused: BlockType[];
  /** New blocks; block types not created yet carry a NewType tempId. */
  blocks: BlockDraft[];
  skipped: number;
  problems: string[];
}

const NUMBERED = /^(.*?)\s*(\d+)$/;
const TIMED = /\s*\d{1,2}:\d{2}$/;

export function planRepeat(ctx: PageCtx, draft: TemplateDraft, input: RepeatInput): RepeatPlan {
  const plan: RepeatPlan = { sourceBlocks: [], copies: 0, newTypes: [], reused: [], blocks: [], skipped: 0, problems: [] };
  const len = input.to - input.from;
  const until = input.until <= 0 || input.until > ctx.dayFrames ? ctx.dayFrames : input.until;
  if (len <= 0) plan.problems.push('The range must end after it starts.');
  if (input.every < len) plan.problems.push('"Every" must be at least as long as the range, or the copies would overlap.');
  if (plan.problems.length) return plan;

  const day = draft.blocks.filter((b) => b.weekday === input.weekday).sort((a, b) => a.startFrames - b.startFrames);
  plan.sourceBlocks = day.filter((b) => b.startFrames >= input.from && endOf(b) <= input.to);
  for (const b of day.filter((b) => b.startFrames >= input.from && b.startFrames < input.to && endOf(b) > input.to)) {
    plan.problems.push(`${ctx.types.get(b.blockTypeId)?.name ?? 'A block'} at ${clock(ctx, b.startFrames)} runs past the end of the range.`);
  }
  if (!plan.sourceBlocks.length) plan.problems.push(`${WEEKDAYS[input.weekday].long} has no blocks between ${clock(ctx, input.from)} and ${clock(ctx, input.to)}.`);
  while (input.from + (plan.copies + 1) * input.every + len <= until) plan.copies++;
  if (!plan.copies && !plan.problems.length) plan.problems.push('There is no room for a copy before the end.');
  if (plan.problems.length) return plan;

  const targetDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => input.days[d] || d === input.weekday);
  const usedOnTargets = new Set(draft.blocks.filter((b) => targetDays.includes(b.weekday)).map((b) => b.blockTypeId));
  const taken = new Set<string>();
  const virtual = new Map<string, BlockTypeInfo>();
  const newByName = new Map<string, NewType>();

  // ------------------------------------------------ which block type each copy of each block uses
  const numberPools = new Map<string, { free: BlockType[]; next: number; base: string }>();
  const nextNumbered = (src: BlockType): string => {
    const { base, types } = seriesOf(ctx, src);
    const key = `${src.groupId}|${src.kind}|${base}`;
    let pool = numberPools.get(key);
    if (!pool) {
      const nums = types.map((t) => Number(NUMBERED.exec(t.name)?.[2] ?? 1));
      pool = {
        base,
        free: types.filter((t) => !usedOnTargets.has(t.id)),
        next: Math.max(1, ...nums) + 1,
      };
      numberPools.set(key, pool);
    }
    const reuse = pool.free.shift();
    if (reuse) return reuse.id;
    const t: NewType = { tempId: `new:${uuidv7()}`, source: src, name: `${pool.base} ${pool.next++}` };
    return register(t);
  };
  const register = (t: NewType): string => {
    plan.newTypes.push(t);
    newByName.set(t.name, t);
    const s = t.source;
    virtual.set(t.tempId, { id: t.tempId, name: t.name, groupId: s.groupId, color: s.color, lengthFrames: s.lengthFrames, validWeekdays: s.validWeekdays, validFrom: s.validFrom, validTo: s.validTo, playlistId: s.playlistId });
    return t.tempId;
  };
  const timedName = (src: BlockType, start: number) => `${src.name.replace(TIMED, '')} ${clock(ctx, start).slice(0, 5)}`;
  const withTime = (src: BlockType, start: number): string => {
    const name = timedName(src, start);
    const existing = [...ctx.types.values()].find((t) => t.name === name && t.groupId === src.groupId && t.kind === src.kind);
    if (existing) {
      if (usedOnTargets.has(existing.id) || taken.has(existing.id)) {
        plan.problems.push(`${name} already exists and is used on these days.`);
        return existing.id;
      }
      taken.add(existing.id);
      return existing.id;
    }
    return newByName.get(name)?.tempId ?? register({ tempId: `new:${uuidv7()}`, source: src, name });
  };

  const typeFor: string[][] = [];
  for (let k = 1; k <= plan.copies; k++) {
    typeFor[k] = plan.sourceBlocks.map((b) => {
      const src = ctx.types.get(b.blockTypeId)!;
      const id = input.naming === 'number' ? nextNumbered(src) : withTime(src, b.startFrames + k * input.every);
      const existing = ctx.types.get(id);
      if (existing && !plan.reused.includes(existing)) plan.reused.push(existing);
      return id;
    });
  }

  // ------------------------------------------------ the blocks, day by day
  const lookup = new Map<string, BlockTypeInfo>([...ctx.types, ...virtual]);
  const rule = { ...ctx.rule, blockTypes: lookup };
  const problems = new Set<string>(plan.problems);
  for (const d of targetDays) {
    const existing = draft.blocks.filter((b) => b.weekday === d);
    const added: BlockDraft[] = [];
    for (let k = d === input.weekday ? 1 : 0; k <= plan.copies; k++) {
      plan.sourceBlocks.forEach((b, i) => {
        const typeId = k === 0 ? b.blockTypeId : typeFor[k][i];
        const start = b.startFrames + k * input.every;
        if (existing.some((x) => x.blockTypeId === typeId && x.startFrames === start && x.lengthFrames === b.lengthFrames)) {
          plan.skipped++;
          return;
        }
        const block: BlockDraft = { ...b, id: uuidv7(), weekday: d, blockTypeId: typeId, startFrames: start, breaks: [] };
        if (ctx.allowsBreaks && b.breaks.length) {
          const positions = positionsOf(b, ctx.adsDays);
          const ids = positions.every((p) => p >= 0) ? breaksAtPositions(positions, block, ctx.adsDays) : null;
          if (ids) block.breaks = ids;
          else problems.add(`The linked breaks of ${lookup.get(b.blockTypeId)?.name} do not fit at ${clock(ctx, start)} on ${WEEKDAYS[d].long}.`);
        }
        added.push(block);
      });
    }
    for (const block of added) {
      for (const p of checkBlock(block, [...existing, ...added], rule)) problems.add(p.message);
    }
    plan.blocks.push(...added);
  }
  plan.problems = [...problems];
  return plan;
}
