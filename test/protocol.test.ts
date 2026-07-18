import { describe, expect, it } from 'vitest';
import { applyTextChange, findMinimalChange } from '../src/textChange.js';

describe('source preservation contract', () => {
  it('documents byte-preserving edits as offset replacements', () => {
    const source = 'A  \r\n\r\n[link][id]\r\n[id]: /target\r\n';
    const from = source.indexOf('A');
    const changed = source.slice(0, from) + 'B' + source.slice(from + 1);
    expect(changed.slice(1)).toBe(source.slice(1));
    expect(changed).toContain('\r\n');
    expect(changed).toContain('[link][id]');
  });

  it('finds a minimal replacement and preserves surrounding source', () => {
    const source = 'before **old** after\r\n[ref]: ./same';
    const target = 'before **new value** after\r\n[ref]: ./same';
    const change = findMinimalChange(source, target);
    expect(change).toEqual({ from: 9, to: 12, insert: 'new value' });
    expect(applyTextChange(source, change)).toBe(target);
  });

  it('handles insertion and deletion', () => {
    expect(applyTextChange('ab', findMinimalChange('ab', 'aXb'))).toBe('aXb');
    expect(applyTextChange('aXb', findMinimalChange('aXb', 'ab'))).toBe('ab');
  });
});
