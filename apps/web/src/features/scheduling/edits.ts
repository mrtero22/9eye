// Changes to the open order, one undo step each (the page wraps them in its history). Each returns
// the new draft, or a sentence saying why it cannot be done.

import { isRepeat, nextItemFor, uuidv7, type AiringDraft, type OrderDraft, type OrderRuleContext } from '@9eye/core';
import { cellOf, isProgrammeMode } from './model';

export type Edit = { draft: OrderDraft } | { refused: string };

const put = (d: OrderDraft, airings: AiringDraft[]): Edit => ({ draft: { ...d, airings } });

/** A first airing in an empty block: series / programmes take the next item; other modes 1 pass of the whole list. */
export function addFirst(d: OrderDraft, ctx: OrderRuleContext, channelId: string, date: string, blockTypeId: string): Edit {
  if (cellOf(d, channelId, date, blockTypeId)) return { refused: 'This block already has an airing of this plan.' };
  if (!d.items.length) return { refused: 'The plan has no items yet: add some from Media first.' };
  if (!isProgrammeMode(d.mode)) {
    return put(d, [...d.airings, { id: uuidv7(), channelId, date, blockTypeId, passes: 1, repeatOfId: null, repeatIndex: 0, blockColor: null, items: d.items.map((i) => ({ itemId: i.id, passes: 0, jingle: d.mode === 'jingles' ? 'pre' : null })) }]);
  }
  const itemId = nextItemFor(d, ctx, channelId, date, blockTypeId);
  if (!itemId) return { refused: 'No episode is left in the list. Add episodes, or turn on "Start again when episodes run out".' };
  return put(d, [...d.airings, { id: uuidv7(), channelId, date, blockTypeId, passes: 1, repeatOfId: null, repeatIndex: 0, blockColor: null, items: [{ itemId, passes: 0, jingle: null }] }]);
}

/** Removes this order's airing (a first airing takes its repeats with it). */
export function removeAiring(d: OrderDraft, id: string): Edit {
  return put(d, d.airings.filter((a) => a.id !== id && a.repeatOfId !== id));
}

export function removeAirings(d: OrderDraft, ids: string[]): Edit {
  const gone = new Set(ids);
  return put(d, d.airings.filter((a) => !gone.has(a.id) && !(a.repeatOfId && gone.has(a.repeatOfId))));
}

/** A repeat of a first airing in another block. */
export function addRepeat(d: OrderDraft, firstId: string, date: string, blockTypeId: string): Edit {
  const f = d.airings.find((a) => a.id === firstId);
  if (!f || isRepeat(f)) return { refused: 'Pick a first airing to repeat.' };
  if (date < f.date) return { refused: 'A repeat comes on the same broadcast day as its first airing or later.' };
  if (cellOf(d, f.channelId, date, blockTypeId)) return { refused: 'That block already has an airing of this plan.' };
  return put(d, [...d.airings, { id: uuidv7(), channelId: f.channelId, date, blockTypeId, passes: 0, repeatOfId: f.id, repeatIndex: 0, blockColor: null, items: [] }]);
}

/** The block's airing becomes a repeat of another first airing (a first airing here gives up its item). */
export function makeRepeatOf(d: OrderDraft, channelId: string, date: string, blockTypeId: string, firstId: string): Edit {
  const f = d.airings.find((a) => a.id === firstId);
  if (!f || isRepeat(f)) return { refused: 'Pick a first airing to repeat.' };
  if (date < f.date) return { refused: 'A repeat comes on the same broadcast day as its first airing or later.' };
  const here = cellOf(d, channelId, date, blockTypeId);
  if (here?.id === firstId) return { refused: 'A first airing cannot repeat itself.' };
  const rest = here ? d.airings.filter((a) => a.id !== here.id && a.repeatOfId !== here.id) : d.airings;
  return put(d, [...rest, { id: here?.id ?? uuidv7(), channelId, date, blockTypeId, passes: 0, repeatOfId: f.id, repeatIndex: 0, blockColor: here?.blockColor ?? null, items: [] }]);
}

/** The episode of a first airing. */
export function changeItem(d: OrderDraft, airingId: string, itemId: string): Edit {
  return put(d, d.airings.map((a) => (a.id === airingId ? { ...a, items: [{ itemId, passes: a.items[0]?.passes ?? 0, jingle: a.items[0]?.jingle ?? null }, ...a.items.slice(1)], passes: Math.max(1, a.items.length) } : a)));
}

/** Promos: passes in a block (0 removes the block's airing; a new one rotates the whole list). */
export function setPasses(d: OrderDraft, channelId: string, date: string, blockTypeId: string, passes: number): Edit {
  const here = cellOf(d, channelId, date, blockTypeId);
  if (passes <= 0) return here ? removeAiring(d, here.id) : { draft: d };
  if (here) return put(d, d.airings.map((a) => (a.id === here.id ? { ...a, passes } : a)));
  return put(d, [
    ...d.airings,
    { id: uuidv7(), channelId, date, blockTypeId, passes, repeatOfId: null, repeatIndex: 0, blockColor: null, items: d.items.map((i) => ({ itemId: i.id, passes: 0, jingle: d.mode === 'jingles' ? 'pre' : null })) },
  ]);
}

export function setBlockColor(d: OrderDraft, airingId: string, color: string | null): Edit {
  return put(d, d.airings.map((a) => (a.id === airingId ? { ...a, blockColor: color } : a)));
}

/** Removes items that no airing uses ("An item used in airings cannot be removed"). */
export function removeItem(d: OrderDraft, itemId: string): Edit {
  if (d.airings.some((a) => a.items.some((x) => x.itemId === itemId))) return { refused: 'This item has airings. Delete them first, then remove the item.' };
  return { draft: { ...d, items: d.items.filter((i) => i.id !== itemId), firstItemId: d.firstItemId === itemId ? null : d.firstItemId } };
}
