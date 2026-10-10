import { describe, expect, it } from 'vitest';
import { extractLocalLinks, renameLinkEdits } from '../src/workspaceLinks';

describe('workspace Markdown links', () => {
  it('extracts inline links, images, angle destinations and definitions with precise ranges', () => {
    const text = '[a](./some%20file.md?q=1#top) ![img](<../pic%20one.png>)\n[ref]: ./ref.md "title"';
    const links=extractLocalLinks(text);
    expect(links.map(l=>l.href)).toEqual(['./some%20file.md?q=1#top','../pic%20one.png','./ref.md']);
    for (const link of links) expect(text.slice(link.from,link.to).replace(/\\([()<>\\])/gu,'$1')).toBe(link.href);
  });

  it('ignores fenced, indented, inline code, comments and front matter', () => {
    const text = '---\ntitle: "[fake](bad.md)"\n---\n`[x](inline.md)` [ok](real.md)\n\n```md\n[x](fenced.md)\n```\n    [x](indented.md)\n<!-- [x](comment.md) -->';
    expect(extractLocalLinks(text).map(l=>l.href)).toEqual(['real.md']);
  });

  it('ignores code fences nested in blockquotes and lists', () => {
    const text = '> ```md\n> [quoted](hidden.md)\n> ```\n\n- item\n  ```md\n  [listed](hidden-too.md)\n  ```\n\n[visible](visible.md)';
    expect(extractLocalLinks(text).map(link => link.href)).toEqual(['visible.md']);
  });

  it('requires an unescaped opening bracket and decodes HTML entities in destinations', () => {
    const text = 'plain](not-a-link.md) \\[escaped](not-a-link-either.md) [real](file&#32;name.md)';
    expect(extractLocalLinks(text).map(link => link.href)).toEqual(['file name.md']);
  });

  it('handles reference definitions with CR-only line endings', () => {
    const text = '[doc]: <some%20file.md> "title"\r\n\r\n[another]: other.md\r';
    expect(extractLocalLinks(text).map(link => link.href)).toEqual(['some%20file.md', 'other.md']);
  });

  it('rewrites only matching local destinations relative to the moved source and preserves suffixes', () => {
    const text='[doc](../old%20folder/page.md?view=1#part) and [anchor](#part) and [web](https://example.com)\n![pic](./old.png)';
    const edits=renameLinkEdits(text,'notes/sub/source.md',[{oldPath:'notes/old folder/page.md',newPath:'notes/new folder/page.md'},{oldPath:'notes/sub/old.png',newPath:'notes/sub/assets/old.png'}]);
    expect(edits).toEqual([
      {from:text.indexOf('../old%20folder/page.md'),to:text.indexOf('../old%20folder/page.md')+'../old%20folder/page.md?view=1#part'.length,insert:'../new%20folder/page.md?view=1#part'},
      {from:text.indexOf('./old.png'),to:text.indexOf('./old.png')+'./old.png'.length,insert:'./assets/old.png'}
    ]);
  });

  it('handles escaped and nested parentheses in destinations', () => {
    const text='[a](dir/file\\(one\\).md) [b](dir/(nested).md)';
    expect(extractLocalLinks(text).map(l=>l.href)).toEqual(['dir/file(one).md','dir/(nested).md']);
  });

  it('extracts anchor links, accepts inline titles, and ignores multiline code spans', () => {
    const text = '[same](#part) [title](local.md "a title") [multi](local.md\n\'title\')\n``code\n[x](hidden.md)\ncode`` [visible](shown.md)';
    expect(extractLocalLinks(text).map(link => link.href)).toEqual(['#part', 'local.md', 'local.md', 'shown.md']);
  });

  it('updates relative links when only the source document moves', () => {
    const text = '[inside](./sibling.md) [outside](../shared.md) [anchor](#section)';
    const edits = renameLinkEdits(text, '/repo/docs/a/source.md', [{ oldPath: '/repo/docs/a/source.md', newPath: '/repo/archive/source.md' }]);
    expect(edits.map(edit => edit.insert)).toEqual(['../docs/a/sibling.md', '../docs/shared.md']);
  });

  it('maps folder moves and individual target moves while retaining absolute destinations', () => {
    const text = '[inside](../guide/page.md) [outside](../../shared.md) [absolute](/repo/shared.md)';
    const edits = renameLinkEdits(text, '/repo/docs/a/source.md', [
      { oldPath: '/repo/docs', newPath: '/repo/archive/docs' },
      { oldPath: '/repo/shared.md', newPath: '/repo/assets/shared.md' }
    ]);
    expect(edits.map(edit => edit.insert)).toEqual(['../../../assets/shared.md', '/repo/assets/shared.md']);
  });
});
