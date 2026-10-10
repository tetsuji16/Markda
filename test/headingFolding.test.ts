import { describe, expect, it } from 'vitest';
import { headingFoldRanges } from '../src/webview/headingFolding.js';

describe('heading fold ranges', () => {
  it('folds section bodies up to the next heading of the same or higher level', () => {
    const markdown = '# One\nintro\n## Child\nchild text\n# Two\nlast';
    const ranges = headingFoldRanges(markdown);
    expect(ranges.map(({ heading, from, to }) => ({
      text: heading.text, body: markdown.slice(from, to),
    }))).toEqual([
      { text: 'One', body: '\nintro\n## Child\nchild text' },
      { text: 'Child', body: '\nchild text' },
      { text: 'Two', body: '\nlast' },
    ]);
    expect(ranges.map(({ heading }) => heading.text)).toEqual(['One', 'Child', 'Two']);
    expect(markdown.slice(ranges[0]!.to, ranges[0]!.to + 6)).toBe('\n# Two');
  });

  it('handles setext headings and ignores headings inside fences', () => {
    const markdown = ['Title', '=====', 'body', '```md', '# Hidden', '```', 'Next', '=====', 'end'].join('\n');
    const ranges = headingFoldRanges(markdown);
    expect(ranges.map(({ heading }) => [heading.level, heading.text])).toEqual([[1, 'Title'], [1, 'Next']]);
    expect(markdown.slice(ranges[0]!.from, ranges[0]!.to)).toBe('\nbody\n```md\n# Hidden\n```');
  });

  it('preserves CRLF offsets and keeps the newline before a sibling heading visible', () => {
    const markdown = '# First\r\n## Child\r\n# Last\r\n';
    const ranges = headingFoldRanges(markdown);
    expect(ranges.map(({ heading, from, to }) => [heading.text, markdown.slice(from, to)])).toEqual([
      ['First', '\r\n## Child'], ['Last', '\r\n'],
    ]);
    expect(markdown.slice(ranges[0]!.to, ranges[0]!.to + 8)).toBe('\r\n# Last');
  });
});
