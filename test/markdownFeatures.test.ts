import { describe, expect, it } from 'vitest';
import {
  collectMathReferences, headingAnchors, prepareMathExpression, slugifyHeading,
} from '../src/markdownFeatures.js';

describe('Typora-compatible document features', () => {
  it('creates stable Unicode heading anchors and suffixes duplicates', () => {
    const markdown = ['---', 'title: Hidden', '---', '# Hello, World!', '## 日本語 見出し', '# Hello World'].join('\n');
    expect(slugifyHeading('日本語 見出し')).toBe('日本語-見出し');
    expect(headingAnchors(markdown).map(({ slug }) => slug)).toEqual([
      'hello-world', '日本語-見出し', 'hello-world-1',
    ]);
  });

  it('numbers labeled display math and resolves ref and eqref', () => {
    const markdown = [
      '$$',
      'a=b\\label{first}',
      '$$',
      '$$',
      'c=d\\tag{A}\\label{second}',
      '$$',
    ].join('\n');
    const references = collectMathReferences(markdown);
    expect(references.labels.get('first')).toBe('1');
    expect(references.labels.get('second')).toBe('A');
    expect(prepareMathExpression('a=b\\label{first}', references, true)).toContain('\\tag{1}');
    expect(prepareMathExpression('\\ref{first}+\\eqref{second}', references, false)).toBe('1+(A)');
  });
});
