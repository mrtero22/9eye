// The open template while it is being edited: the saved version, the working draft and its history.
// Every change goes through here, so Undo / Redo and "Unsaved changes" cover all of them.

import type { TemplateDraft } from '@9eye/core';

export interface EditorState {
  templateId: string | null;
  version: number;
  base: TemplateDraft | null;
  present: TemplateDraft | null;
  past: TemplateDraft[];
  future: TemplateDraft[];
}

export type EditorAction =
  | { type: 'load'; templateId: string; version: number; draft: TemplateDraft }
  | { type: 'change'; draft: TemplateDraft }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'discard' }
  | { type: 'saved'; version: number; draft: TemplateDraft };

const HISTORY = 200;

export const emptyEditor: EditorState = { templateId: null, version: 0, base: null, present: null, past: [], future: [] };

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case 'load':
      return { templateId: a.templateId, version: a.version, base: a.draft, present: a.draft, past: [], future: [] };
    case 'change':
      if (!s.present || a.draft === s.present) return s;
      return { ...s, present: a.draft, past: [...s.past, s.present].slice(-HISTORY), future: [] };
    case 'undo': {
      if (!s.past.length || !s.present) return s;
      const prev = s.past[s.past.length - 1];
      return { ...s, present: prev, past: s.past.slice(0, -1), future: [s.present, ...s.future] };
    }
    case 'redo': {
      if (!s.future.length || !s.present) return s;
      const [next, ...rest] = s.future;
      return { ...s, present: next, past: [...s.past, s.present], future: rest };
    }
    case 'discard':
      return { ...s, present: s.base, past: [], future: [] };
    case 'saved':
      return { ...s, version: a.version, base: a.draft, present: a.draft, past: [], future: [] };
  }
}

export function isDirty(s: EditorState): boolean {
  if (s.present === s.base) return false;
  return JSON.stringify(s.present) !== JSON.stringify(s.base);
}
