// Shared helpers of the Orders page (design/orders-page.md): contract state, dates, the API calls.

import { framesToParts, type FrameRate } from '@9eye/core';
import type { Client, ContractListItem } from '@/lib/types';

export type ContractState = 'running' | 'upcoming' | 'ended';

const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / 86_400_000);

export function contractState(c: Pick<ContractListItem, 'startDate' | 'endDate'>, today: string): ContractState {
  if (c.startDate > today) return 'upcoming';
  if (c.endDate < today) return 'ended';
  return 'running';
}

/** "Starts in 3 days", "Ends in 4 days" (amber from 7 days), "21 days left", "Ended". */
export function stateNote(c: Pick<ContractListItem, 'startDate' | 'endDate'>, today: string): { text: string; soon: boolean } {
  const s = contractState(c, today);
  if (s === 'upcoming') {
    const n = daysBetween(today, c.startDate);
    return { text: `Starts in ${n} ${n === 1 ? 'day' : 'days'}`, soon: false };
  }
  if (s === 'ended') return { text: 'Ended', soon: false };
  const left = daysBetween(today, c.endDate);
  if (left === 0) return { text: 'Ends today', soon: true };
  return left <= 7 ? { text: `Ends in ${left} ${left === 1 ? 'day' : 'days'}`, soon: true } : { text: `${left} days left`, soon: false };
}

export const STATE_LABEL: Record<ContractState, string> = { running: 'Running', upcoming: 'Upcoming', ended: 'Ended' };

export const CLIENT_TYPE_LABEL: Record<Client['type'], string> = { advertiser: 'Advertiser', agency: 'Agency', both: 'Advertiser and agency' };

/** Currencies offered first; any three-letter ISO code can be typed. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'TRY', 'AFN', 'TJS', 'AZN'];

export const fmtCount = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** "AURORA SD - NOVAMART - START 23 OCT 2026", as Aurora Media names commercial orders (the server makes the same). */
export function orderName(channel: string, contract: string, start: string) {
  const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${channel} - ${contract} - START ${start.slice(8, 10)} ${M[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;
}

/** A spot or break length the way traffic reads it: "0:15", "18:00", "1:02:30" (frames left out). */
export function spotLength(frames: number, rate: FrameRate): string {
  const { h, m, s } = framesToParts(Math.max(0, frames), rate);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
