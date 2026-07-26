import { describe, expect, it } from 'vitest';
import { createMarkdownRenderer, extractTitle } from '../src/markdown.js';

describe('Markdown renderer', () => {
  it('renders GFM-style tables and links safely', () => {
    const renderer = createMarkdownRenderer();
    const output = renderer.render('| A | B |\n| - | - |\n| 1 | 2 |\n\n[link](https://example.com)');
    expect(output).toContain('<table>');
    expect(output).toContain('rel="noopener noreferrer"');
  });

  it('does not render raw HTML by default', () => {
    const output = createMarkdownRenderer().render('<script>alert(1)</script>');
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('extracts the first level-one title', () => {
    expect(extractTitle('text\n# Project\n', 'fallback')).toBe('Project');
    expect(extractTitle('text', 'fallback')).toBe('fallback');
  });

  it('renders heading anchors, a live TOC, emoji, and numbered math', () => {
    const output = createMarkdownRenderer().render([
      '# Start',
      '',
      '[toc]',
      '',
      'Ready :rocket: and $\\ref{energy}$.',
      '',
      '$$',
      'E=mc^2\\label{energy}',
      '$$',
    ].join('\n'));
    expect(output).toContain('<h1 id="start">');
    expect(output).toContain('class="markda-toc"');
    expect(output).toContain('href="#start"');
    expect(output).toContain('🚀');
    expect(output).toContain('tag');
    expect(output).not.toContain('\\label{energy}');
  });
});
