import { describe, expect, it } from 'vitest';
import { browserExportContentSecurityPolicy, createHtmlDocument, isNetworkPathReference } from '../src/htmlExport.js';
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

  it('locks down the page rendered by the PDF and image export browser', () => {
    const policy = browserExportContentSecurityPolicy(false);
    const html = createHtmlDocument('Title', '<script>fetch("file:///etc/passwd")</script>', 'en', '', 'file:///docs/', policy);
    const head = html.slice(0, html.indexOf('<base'));
    expect(head).toContain(`<meta http-equiv="Content-Security-Policy" content="${policy.replaceAll("'", '&#39;')}">`);
    expect(policy).toMatch(/^default-src 'none';/u);
    expect(policy).not.toMatch(/script-src|connect-src|https:/u);
    expect(browserExportContentSecurityPolicy(true)).toContain('img-src file: data: https:');
    expect(createHtmlDocument('Title', '<p>x</p>')).not.toContain('Content-Security-Policy');
  });

  it('recognizes image references that a file:// page would load from a network share', () => {
    expect(isNetworkPathReference('//attacker.example/share/x.png')).toBe(true);
    expect(isNetworkPathReference('\\\\attacker.example\\share\\x.png')).toBe(true);
    expect(isNetworkPathReference('images/x.png')).toBe(false);
    expect(isNetworkPathReference('/images/x.png')).toBe(false);
    expect(isNetworkPathReference('data:image/png;base64,AA==')).toBe(false);
  });
});
