import { describe, expect, it } from 'vitest';
import { analyzeDocument, getStatistics } from '../src/statistics.js';

describe('getStatistics', () => {
  it('counts Latin words without Markdown markers', () => {
    const result = getStatistics('# Hello **brave** world');
    expect(result.words).toBe(3);
    expect(result.lines).toBe(1);
  });

  it('counts each CJK character as one word', () => {
    const result = getStatistics('\u65e5\u672c\u8a9e test');
    expect(result.words).toBe(4);
  });

  it('reports selection statistics separately', () => {
    const result = getStatistics('one two three', 'two three');
    expect(result.words).toBe(3);
    expect(result.selectionWords).toBe(2);
    expect(result.selectionCharacters).toBe(9);
  });

  it('counts Unicode code points and mixed line endings', () => {
    const result = getStatistics('😀 a\r\n\u65e5\u672c\rb\nc');
    expect(result.characters).toBe(11);
    expect(result.charactersWithoutSpaces).toBe(6);
    expect(result.lines).toBe(4);
    expect(result.words).toBe(5);
  });

  it('handles ECMAScript Unicode whitespace without counting surrogate halves', () => {
    const result = getStatistics(`a\u00a0b\u3000😀\ufeffc`);
    expect(result.characters).toBe(7);
    expect(result.charactersWithoutSpaces).toBe(4);
  });

  it('counts CJK characters individually when adjacent to Latin text', () => {
    expect(getStatistics('abc\u65e5\u672cdef').words).toBe(4);
  });

  it('collects headings and statistics in one document analysis', () => {
    const result = analyzeDocument('# One\r\ntext \u65e5\u672c\n## Two');
    expect(result.headings).toEqual([
      { level: 1, text: 'One', from: 0, to: 5 },
      { level: 2, text: 'Two', from: 15, to: 21 },
    ]);
    expect(result.statistics.lines).toBe(3);
    expect(result.statistics.words).toBe(5);
  });

  it('collects Setext headings and ignores heading-like text inside code fences', () => {
    const source = [
      'Document title',
      '==============',
      '',
      'Section',
      '---',
      '',
      '```md',
      '# Not an outline entry',
      'Fake title',
      '===',
      '```',
      '',
      '## Real section',
    ].join('\n');
    expect(analyzeDocument(source).headings).toEqual([
      { level: 1, text: 'Document title', from: 0, to: 29 },
      { level: 2, text: 'Section', from: 31, to: 42 },
      { level: 2, text: 'Real section', from: 93, to: 108 },
    ]);
  });

  it('analyzes a long document without an input-path-sized pause', () => {
    const source = Array.from({ length: 50_000 }, (_value, index) => index % 100 === 0 ? `## Section ${index}\n` : 'ordinary text \u65e5\u672c\n').join('');
    const started = performance.now();
    const result = analyzeDocument(source);
    const elapsed = performance.now() - started;
    expect(result.statistics.lines).toBe(50_001);
    expect(result.headings).toHaveLength(500);
    expect(elapsed).toBeLessThan(1_500);
  });
});
