import { describe, expect, it } from 'vitest';
import type { TemplateDraft } from '@9eye/core';
import { editorReducer, emptyEditor, isDirty } from './editor';

const d = (name: string): TemplateDraft => ({ name, validFrom: '2024-03-23', validTo: '2099-05-29', activeWeekdays: [true, true, true, true, true, true, true], blocks: [] });

describe('layout editor', () => {
  it('tracks changes with undo, redo and saved state', () => {
    let s = editorReducer(emptyEditor, { type: 'load', templateId: 't', version: 1, draft: d('A') });
    expect(isDirty(s)).toBe(false);
    s = editorReducer(s, { type: 'change', draft: d('B') });
    s = editorReducer(s, { type: 'change', draft: d('C') });
    expect(isDirty(s)).toBe(true);
    s = editorReducer(s, { type: 'undo' });
    expect(s.present?.name).toBe('B');
    s = editorReducer(s, { type: 'redo' });
    expect(s.present?.name).toBe('C');
    s = editorReducer(s, { type: 'undo' });
    s = editorReducer(s, { type: 'undo' });
    expect(s.present?.name).toBe('A');
    expect(isDirty(s)).toBe(false);
    s = editorReducer(s, { type: 'change', draft: d('D') });
    expect(s.future).toEqual([]);
    s = editorReducer(s, { type: 'saved', version: 2, draft: d('D') });
    expect(isDirty(s)).toBe(false);
    expect(s.version).toBe(2);
    expect(s.past).toEqual([]);
  });

  it('discards back to the saved version', () => {
    let s = editorReducer(emptyEditor, { type: 'load', templateId: 't', version: 1, draft: d('A') });
    s = editorReducer(s, { type: 'change', draft: d('B') });
    s = editorReducer(s, { type: 'discard' });
    expect(s.present?.name).toBe('A');
    expect(isDirty(s)).toBe(false);
  });
});
