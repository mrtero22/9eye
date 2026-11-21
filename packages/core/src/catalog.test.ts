import { describe, expect, it } from 'vitest';
import { betweenValues, productionIdFrom, relationTabs, seriesTitles, splitSegments } from './catalog';

describe('catalog rules', () => {
  it('numbers a series from the initial episode', () => {
    expect(seriesTitles('Harbor Nights ', 41, 3)).toEqual(['Harbor Nights - 41', 'Harbor Nights - 42', 'Harbor Nights - 43']);
    expect(seriesTitles('X', 1, 500)).toHaveLength(200);
  });

  it('splits a length into equal parts, back to back, ending at the length', () => {
    const s = splitSegments(1000, 3);
    expect(s).toEqual([
      { tcIn: 0, tcOut: 333, length: 333 },
      { tcIn: 333, tcOut: 666, length: 333 },
      { tcIn: 666, tcOut: 1000, length: 334 },
    ]);
    expect(splitSegments(100, 0)).toEqual([{ tcIn: 0, tcOut: 100, length: 100 }]);
  });

  it('makes an item Id from the source pattern', () => {
    const ctx = { typeCode: 'TVSeriesDrama', contentCode: 'Bright Lanes', chapter: 41, next: 42 };
    expect(productionIdFrom('%T-%C-%A', ctx)).toBe('TVSeriesDrama-Bright Lanes-000042');
    expect(productionIdFrom('TV S-%A - %P', ctx)).toBe('TV S-000042 - 41');
    expect(productionIdFrom('', ctx)).toBe('TVSeriesDrama-Bright Lanes-000042');
  });

  it('reads a Between value', () => {
    expect(betweenValues('00:10:00 .. 00:20:00')).toEqual(['00:10:00', '00:20:00']);
    expect(betweenValues('3 to 9')).toEqual(['3', '9']);
    expect(betweenValues('5')).toEqual(['5', '5']);
  });

  it('shows the Related items tabs of each level', () => {
    expect(relationTabs('production', false)).toEqual(['linear', 'graphics', 'time-window', 'rights', 'history']);
    expect(relationTabs('content', true)).toEqual(['linear', 'graphics', 'time-window', 'product-code']);
    expect(relationTabs('segment', false)).toEqual(['time-window']);
    expect(relationTabs('rotation-list', false)).toEqual([]);
  });
});
