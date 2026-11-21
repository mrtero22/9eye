// Editing a template draft. Every operation is pure and all-or-nothing: it returns a new draft, or
// the problems and no change.

import { checkBlock, type BlockDraft, type Problem, type RuleContext, type TemplateDraft } from './template';

export type EditResult = { ok: true; draft: TemplateDraft } | { ok: false; problems: Problem[] };

export function addBlock(draft: TemplateDraft, block: BlockDraft, ctx: RuleContext): EditResult {
  const problems = checkBlock(block, draft.blocks, ctx);
  if (problems.length) return { ok: false, problems };
  return { ok: true, draft: { ...draft, blocks: [...draft.blocks, block] } };
}

export function updateBlock(
  draft: TemplateDraft,
  id: string,
  patch: Partial<Omit<BlockDraft, 'id'>>,
  ctx: RuleContext,
): EditResult {
  const cur = draft.blocks.find((b) => b.id === id);
  if (!cur) return { ok: false, problems: [{ code: 'unknown-block-type', message: 'The block no longer exists.' }] };
  const next = { ...cur, ...patch };
  const problems = checkBlock(next, draft.blocks, ctx);
  if (problems.length) return { ok: false, problems };
  return { ok: true, draft: { ...draft, blocks: draft.blocks.map((b) => (b.id === id ? next : b)) } };
}

export function removeBlock(draft: TemplateDraft, id: string): TemplateDraft {
  return { ...draft, blocks: draft.blocks.filter((b) => b.id !== id) };
}

export function setBreaks(draft: TemplateDraft, id: string, breaks: string[]): TemplateDraft {
  return { ...draft, blocks: draft.blocks.map((b) => (b.id === id ? { ...b, breaks } : b)) };
}

export function moveBreak(draft: TemplateDraft, id: string, index: number, delta: -1 | 1): TemplateDraft {
  const b = draft.blocks.find((x) => x.id === id);
  if (!b) return draft;
  const j = index + delta;
  if (index < 0 || j < 0 || index >= b.breaks.length || j >= b.breaks.length) return draft;
  const breaks = b.breaks.slice();
  [breaks[index], breaks[j]] = [breaks[j], breaks[index]];
  return setBreaks(draft, id, breaks);
}

export function setActiveDay(draft: TemplateDraft, weekday: number, on: boolean): TemplateDraft {
  const activeWeekdays = draft.activeWeekdays.slice();
  activeWeekdays[weekday] = on;
  return { ...draft, activeWeekdays };
}

/** "Copy this day to…": the blocks of the target days are replaced by copies of the source day. */
export function copyDay(
  draft: TemplateDraft,
  from: number,
  to: number[],
  ctx: RuleContext,
  newId: () => string,
): EditResult {
  const targets = [...new Set(to)].filter((d) => d !== from);
  const source = draft.blocks.filter((b) => b.weekday === from);
  let blocks = draft.blocks.filter((b) => !targets.includes(b.weekday));
  const problems: Problem[] = [];
  for (const d of targets) {
    const copies = source.map((b) => ({ ...b, id: newId(), weekday: d, breaks: b.breaks.slice() }));
    for (const c of copies) problems.push(...checkBlock(c, copies, ctx));
    blocks = blocks.concat(copies);
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, draft: { ...draft, blocks } };
}

/**
 * Where a dragged or placed block lands: on a step grid (e.g. 5 minutes), pulled to a neighbour's
 * edge or to the start / end of the broadcast day when it is within `magnet`, and kept inside the day.
 */
export function snapStart(
  blocks: BlockDraft[],
  weekday: number,
  start: number,
  length: number,
  opts: { step: number; magnet: number; dayFrames: number; exceptId?: string },
): number {
  let s = Math.round(start / opts.step) * opts.step;
  let best: number | null = null;
  let bestDist = Infinity;
  const edges = [[0, opts.dayFrames - length]];
  for (const b of blocks) {
    if (b.weekday !== weekday || b.id === opts.exceptId) continue;
    edges.push([b.startFrames + b.lengthFrames, b.startFrames - length]);
  }
  for (const pair of edges) {
    for (const candidate of pair) {
      const d = Math.abs(start - candidate);
      if (d <= opts.magnet && d < bestDist) {
        best = candidate;
        bestDist = d;
      }
    }
  }
  if (best !== null) s = best;
  return Math.min(Math.max(0, s), Math.max(0, opts.dayFrames - length));
}
