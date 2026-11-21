// The AI table's presets and limits on the page (decision 0025; the API holds the same rules in
// apps/api/src/aiPolicy.ts and checks every save).

import type { AiAction, AiCell, AiPart, AiPreset, AiTable, AiTableShape } from './types';

const RANK: Record<AiCell, number> = { off: 0, ask: 1, on: 2 };

export function presetTable(shape: AiTableShape, id: Exclude<AiPreset, 'custom'>): AiTable {
  const t = {} as AiTable;
  for (const p of shape.parts) {
    const row: Partial<Record<AiAction, AiCell>> = {};
    for (const a of p.actions) {
      if (id === 'full') row[a] = 'on';
      else if (a === 'read') row[a] = 'on';
      else if (id === 'drafts' && ((p.key === 'playlist' && (a === 'change' || a === 'create')) || (p.key === 'ads' && a === 'change'))) row[a] = 'on';
      else row[a] = 'off';
    }
    t[p.key] = row;
  }
  return t;
}

export const sameTable = (shape: AiTableShape, a: AiTable, b: AiTable) => shape.parts.every((p) => p.actions.every((x) => (a[p.key]?.[x] ?? 'off') === (b[p.key]?.[x] ?? 'off')));

export function presetOf(shape: AiTableShape, t: AiTable): AiPreset {
  for (const id of ['read', 'drafts', 'full'] as const) if (sameTable(shape, t, presetTable(shape, id))) return id;
  return 'custom';
}

export const PRESET_WORDS: Record<AiPreset, { label: string; text: string }> = {
  read: { label: 'Read only', text: 'Look things up everywhere; change nothing.' },
  drafts: { label: 'Drafts', text: 'Read everything; change drafts of Playlist and Ads (weeks, days, bookings).' },
  full: { label: 'Full', text: 'Everything Allowed: all that a person with the same role can do.' },
  custom: { label: 'Custom', text: 'Your own choice, cell by cell.' },
};

/** Cell by cell, the smaller. */
export const smaller = (a: AiCell, b: AiCell): AiCell => (RANK[a] <= RANK[b] ? a : b);

/** A table set to at most `cap` in every cell. */
export function capTable(shape: AiTableShape, t: AiTable, cap: (part: AiPart, action: AiAction) => AiCell): AiTable {
  const out = {} as AiTable;
  for (const p of shape.parts) {
    out[p.key] = {};
    for (const a of p.actions) out[p.key][a] = smaller(t[p.key]?.[a] ?? 'off', cap(p.key, a));
  }
  return out;
}

export const cellCount = (shape: AiTableShape, a: AiTable, b: AiTable) =>
  shape.parts.reduce((n, p) => n + p.actions.filter((x) => (a[p.key]?.[x] ?? 'off') !== (b[p.key]?.[x] ?? 'off')).length, 0);
