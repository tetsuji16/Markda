import { describe, expect, it } from 'vitest';
import { areValidTextChanges, parseEditorToHostMessage } from '../src/protocol.js';

describe('webview message validation', () => {
  it('accepts a complete edit message', () => {
    const message = parseEditorToHostMessage({
      type: 'edit', uri: 'file:///document.md', baseVersion: 3, transactionId: 'transaction-1',
      changes: [{ from: 0, to: 1, insert: 'A' }], selection: { anchor: 1, head: 1 },
    });
    expect(message?.type).toBe('edit');
  });

  it.each([
    { type: 'edit', uri: 'file:///document.md', baseVersion: 3, transactionId: '', changes: [], selection: { anchor: 0, head: 0 } },
    { type: 'edit', uri: 'file:///document.md', baseVersion: 3, transactionId: 'x', changes: [{ from: -1, to: 0, insert: '' }], selection: { anchor: 0, head: 0 } },
    { type: 'statistics', statistics: { words: Number.NaN } },
    { type: 'openLink', href: 42 },
    { type: 'unknown' },
    null,
  ])('rejects malformed host-bound input: %j', (message) => {
    expect(parseEditorToHostMessage(message)).toBeUndefined();
  });

  it('normalizes ready messages instead of retaining attacker-controlled fields', () => {
    expect(parseEditorToHostMessage({ type: 'ready', unexpected: 'discarded' })).toEqual({ type: 'ready' });
  });

  it('accepts a bounded final synchronization snapshot', () => {
    expect(parseEditorToHostMessage({
      type: 'finalSync', uri: 'file:///document.md', expectedText: 'before', text: 'after',
    })).toEqual({ type: 'finalSync', uri: 'file:///document.md', expectedText: 'before', text: 'after' });
    expect(parseEditorToHostMessage({ type: 'finalSync', uri: 1, expectedText: '', text: '' })).toBeUndefined();
  });

  it('accepts bounded pasted image data and rejects oversized batches', () => {
    expect(parseEditorToHostMessage({
      type: 'saveImages', selection: { anchor: 0, head: 0 },
      images: [{ name: 'paste.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
    })?.type).toBe('saveImages');
    expect(parseEditorToHostMessage({
      type: 'saveImages', selection: { anchor: 0, head: 0 },
      images: Array.from({ length: 33 }, () => ({ name: 'x.png', dataUrl: 'data:image/png;base64,eA==' })),
    })).toBeUndefined();
  });

  it('validates local image management requests', () => {
    expect(parseEditorToHostMessage({ type: 'manageImage', source: 'assets/photo.png', from: 12, action: 'move' }))
      .toEqual({ type: 'manageImage', source: 'assets/photo.png', from: 12, action: 'move' });
    expect(parseEditorToHostMessage({ type: 'manageImage', source: 'assets/photo.png', from: -1, action: 'erase' })).toBeUndefined();
  });

  it('rejects overlapping, duplicate and out-of-bounds edit ranges', () => {
    expect(areValidTextChanges([{ from: 1, to: 3, insert: '' }, { from: 2, to: 4, insert: '' }], 10)).toBe(false);
    expect(areValidTextChanges([{ from: 1, to: 1, insert: 'a' }, { from: 1, to: 1, insert: 'b' }], 10)).toBe(false);
    expect(areValidTextChanges([{ from: 9, to: 11, insert: '' }], 10)).toBe(false);
    expect(areValidTextChanges([{ from: 1, to: 3, insert: '' }, { from: 4, to: 5, insert: '' }], 10)).toBe(true);
  });
});
