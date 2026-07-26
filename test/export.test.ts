import { describe, expect, it } from 'vitest';
import { createHtmlDocument } from '../src/htmlExport.js';
import { substituteVariables } from '../src/externalExport.js';

describe('HTML export', () => {
  it('escapes document titles and includes print styles', () => {
    const html = createHtmlDocument('<unsafe>', '<p>safe</p>');
    expect(html).toContain('<title>&lt;unsafe&gt;</title>');
    expect(html).toContain('@media print');
    expect(html).toContain('<p>safe</p>');
  });

  it('adds a base URL and substitutes external export arguments without invoking a shell', () => {
    const html = createHtmlDocument('Title', '<p>body</p>', 'en', '.x{color:red}', 'file:///docs/');
    expect(html).toContain('<base href="file:///docs/">');
    expect(html).toContain('.x{color:red}');
    expect(substituteVariables('${source} -> ${destination}', {
      source: 'input.md',
      destination: 'output.docx',
    })).toBe('input.md -> output.docx');
  });
});
