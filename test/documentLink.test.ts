import { describe, expect, it } from 'vitest';
import { isMarkdownDocumentPath, parseDocumentLink } from '../src/documentLink.js';

describe('document links', () => {
  it('decodes local paths while preserving heading fragments', () => {
    expect(parseDocumentLink('notes/My%20Plan.md#next%20steps')).toEqual({
      kind: 'local',
      path: 'notes/My Plan.md',
      fragment: 'next%20steps',
    });
    expect(parseDocumentLink('%E6%97%A5%E6%9C%AC%E8%AA%9E.md')).toEqual({
      kind: 'local',
      path: '日本語.md',
    });
  });

  it('distinguishes same-document anchors and safe external schemes', () => {
    expect(parseDocumentLink('#overview')).toEqual({ kind: 'anchor', fragment: 'overview' });
    expect(parseDocumentLink('https://example.com/guide')).toEqual({
      kind: 'external',
      href: 'https://example.com/guide',
    });
    expect(parseDocumentLink('mailto:docs@example.com')).toEqual({
      kind: 'external',
      href: 'mailto:docs@example.com',
    });
  });

  it('rejects malformed and executable schemes', () => {
    expect(parseDocumentLink('command:workbench.action.closeWindow')).toEqual({ kind: 'unsupported' });
    expect(parseDocumentLink('javascript:alert(1)')).toEqual({ kind: 'unsupported' });
    expect(parseDocumentLink('broken%2')).toEqual({ kind: 'unsupported' });
    expect(parseDocumentLink('')).toEqual({ kind: 'unsupported' });
  });

  it('recognizes every document type handled by the custom editor', () => {
    for (const path of ['README.md', 'guide.markdown', 'note.mdown', 'a.mkd', 'b.mkdn', 'c.mdwn', 'plain.txt']) {
      expect(isMarkdownDocumentPath(path), path).toBe(true);
    }
    expect(isMarkdownDocumentPath('diagram.svg')).toBe(false);
  });
});
