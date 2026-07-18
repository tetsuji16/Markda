import { describe, expect, it } from 'vitest';
import { getStatistics } from '../src/statistics.js';

describe('getStatistics', () => {
  it('counts Latin words without Markdown markers', () => {
    const result = getStatistics('# Hello **brave** world');
    expect(result.words).toBe(3);
    expect(result.lines).toBe(1);
  });

  it('counts each CJK character as one word', () => {
    const result = getStatistics('日本語 test');
    expect(result.words).toBe(4);
  });

  it('reports selection statistics separately', () => {
    const result = getStatistics('one two three', 'two three');
    expect(result.words).toBe(3);
    expect(result.selectionWords).toBe(2);
    expect(result.selectionCharacters).toBe(9);
  });

  it('counts Unicode code points and mixed line endings', () => {
    const result = getStatistics('😀 a\r\n日本\rb\nc');
    expect(result.characters).toBe(11);
    expect(result.charactersWithoutSpaces).toBe(6);
    expect(result.lines).toBe(4);
    expect(result.words).toBe(5);
  });

  it('counts CJK characters individually when adjacent to Latin text', () => {
    expect(getStatistics('abc日本def').words).toBe(4);
  });
});
