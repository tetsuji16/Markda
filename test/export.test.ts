import { describe, expect, it } from 'vitest';
import { createHtmlDocument } from '../src/htmlExport.js';

describe('HTML export', () => {
  it('escapes document titles and includes print styles', () => {
    const html = createHtmlDocument('<unsafe>', '<p>safe</p>');
    expect(html).toContain('<title>&lt;unsafe&gt;</title>');
    expect(html).toContain('@media print');
    expect(html).toContain('<p>safe</p>');
  });
});
