import { history, redo, undo, undoDepth } from '@codemirror/commands';
import { EditorState, Transaction, type Transaction as StateTransaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

function editor(initial = ''): { get: () => EditorState; dispatch: (transaction: StateTransaction) => void } {
  let state = EditorState.create({ doc: initial, extensions: [history()] });
  return {
    get: () => state,
    dispatch: (transaction) => { state = transaction.state; },
  };
}

describe('document history policy', () => {
  it('undoes an adjacent typing run as one operation and supports redo', () => {
    const model = editor();
    model.dispatch(model.get().update({ changes: { from: 0, insert: 'a' }, userEvent: 'input.type' }));
    model.dispatch(model.get().update({ changes: { from: 1, insert: 'b' }, userEvent: 'input.type' }));

    expect(undoDepth(model.get())).toBe(1);
    expect(undo({ state: model.get(), dispatch: model.dispatch } as EditorView)).toBe(true);
    expect(model.get().doc.toString()).toBe('');
    expect(redo({ state: model.get(), dispatch: model.dispatch } as EditorView)).toBe(true);
    expect(model.get().doc.toString()).toBe('ab');
  });

  it('maps external changes without making them locally undoable', () => {
    const model = editor();
    model.dispatch(model.get().update({ changes: { from: 0, insert: 'local' }, userEvent: 'input.type' }));
    model.dispatch(model.get().update({
      changes: { from: 0, insert: 'external ' },
      annotations: Transaction.addToHistory.of(false),
    }));

    expect(undoDepth(model.get())).toBe(1);
    expect(undo({ state: model.get(), dispatch: model.dispatch } as EditorView)).toBe(true);
    expect(model.get().doc.toString()).toBe('external ');
  });
});
