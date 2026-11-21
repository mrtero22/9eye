// Linked breaks of a main-template block (decision 0016).
// A break is matched by its POSITION among the ads-template blocks inside a block's time
// (1st, 2nd, …), never by its name — names differ per company and channel (reference scenario #8).

import type { AdsBlock, AdsDays, BlockDraft, BlockTypeLookup, TemplateDraft } from './template';

/** Ads-template blocks of one weekday whose start lies inside [start, start + length), by start. */
export function breaksInside(adsDay: AdsBlock[] | undefined, startFrames: number, lengthFrames: number): AdsBlock[] {
  return (adsDay ?? [])
    .filter((a) => a.startFrames >= startFrames && a.startFrames < startFrames + lengthFrames)
    .sort((a, b) => a.startFrames - b.startFrames);
}

/** Position (0-based) of each of the block's breaks inside its own time; -1 = outside. */
export function positionsOf(block: Pick<BlockDraft, 'weekday' | 'startFrames' | 'lengthFrames' | 'breaks'>, adsDays: AdsDays): number[] {
  const win = breaksInside(adsDays[block.weekday], block.startFrames, block.lengthFrames);
  return block.breaks.map((id) => win.findIndex((a) => a.blockTypeId === id));
}

/** The block's breaks for a list of positions, or null when one position does not exist there. */
export function breaksAtPositions(
  positions: number[],
  block: Pick<BlockDraft, 'weekday' | 'startFrames' | 'lengthFrames'>,
  adsDays: AdsDays,
): string[] | null {
  const win = breaksInside(adsDays[block.weekday], block.startFrames, block.lengthFrames);
  const out: string[] = [];
  for (const k of positions) {
    const a = win[k];
    if (!a) return null;
    out.push(a.blockTypeId);
  }
  return out;
}

export type ApplyScope = 'type' | 'group' | 'length';

export interface ApplyPlan {
  /** Blocks in scope (without the source block). */
  targets: BlockDraft[];
  /** New breaks per target block id — only meaningful when ok. */
  updates: Map<string, string[]>;
  /** Targets without a break at one of the needed positions. */
  failures: BlockDraft[];
  /** Breaks of the source block that are not inside its own time (they have no position). */
  outside: string[];
  ok: boolean;
}

/** Which blocks "Apply to other blocks…" would change, and with what (all-or-nothing). */
export function planApply(
  draft: TemplateDraft,
  sourceId: string,
  scope: ApplyScope,
  days: boolean[],
  blockTypes: BlockTypeLookup,
  adsDays: AdsDays,
): ApplyPlan {
  const source = draft.blocks.find((b) => b.id === sourceId);
  const empty: ApplyPlan = { targets: [], updates: new Map(), failures: [], outside: [], ok: false };
  if (!source) return empty;
  const group = blockTypes.get(source.blockTypeId)?.groupId;
  const targets = draft.blocks
    .filter((b) => b.id !== source.id && days[b.weekday])
    .filter((b) =>
      scope === 'type'
        ? b.blockTypeId === source.blockTypeId
        : scope === 'group'
          ? group !== undefined && blockTypes.get(b.blockTypeId)?.groupId === group
          : b.lengthFrames === source.lengthFrames,
    )
    .sort((a, b) => a.weekday - b.weekday || a.startFrames - b.startFrames);
  const positions = positionsOf(source, adsDays);
  const outside = source.breaks.filter((_, i) => positions[i] < 0);
  if (outside.length) return { ...empty, targets, outside };
  const updates = new Map<string, string[]>();
  const failures: BlockDraft[] = [];
  for (const t of targets) {
    const ids = breaksAtPositions(positions, t, adsDays);
    if (ids) updates.set(t.id, ids);
    else failures.push(t);
  }
  return { targets, updates, failures, outside, ok: targets.length > 0 && failures.length === 0 };
}

/** Writes an ok plan into the draft (the same result as editing each block by hand). */
export function applyPlan(draft: TemplateDraft, plan: ApplyPlan): TemplateDraft {
  if (!plan.ok) return draft;
  return { ...draft, blocks: draft.blocks.map((b) => (plan.updates.has(b.id) ? { ...b, breaks: plan.updates.get(b.id)! } : b)) };
}

/** Ordinal for list descriptions: 1st, 2nd, 3rd, 4th, … */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}
