import { describe, expect, it } from 'vitest';
import {
  browserExportContentSecurityPolicy, createHtmlDocument, heightProbeScript, isNetworkPathReference, parseProbedHeight,
} from '../src/htmlExport.js';
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

  it('lets only the nonce-tagged height probe run in the image export page', () => {
    const policy = browserExportContentSecurityPolicy(false, 'n0nce');
    expect(policy).toMatch(/; script-src 'nonce-n0nce'$/u);
    const html = createHtmlDocument('Title', '<p>body</p>', 'en', '', '', policy, heightProbeScript('n0nce'));
    expect(html).toMatch(/<\/main><script nonce="n0nce">[^<]*'n0nce:'[^<]*<\/script><\/body>/u);
    expect(() => heightProbeScript(`x'</script>`)).toThrow();
  });

  it('accepts only a probed height bound to the export nonce on the root element', () => {
    expect(parseProbedHeight('<!DOCTYPE html>\n<html lang="en" data-markda-height="n0nce:2317"><head>', 'n0nce')).toBe(2317);
    // Raw HTML can merge `<html data-markda-height>` onto the root element, but it cannot know the nonce.
    expect(parseProbedHeight('<html data-markda-height="99999"><head>', 'n0nce')).toBeUndefined();
    expect(parseProbedHeight('<html data-markda-height="other:99999"><head>', 'n0nce')).toBeUndefined();
    expect(parseProbedHeight('<html data-markda-height="n0nce:0"><head>', 'n0nce')).toBeUndefined();
    expect(parseProbedHeight('<html data-markda-height="n0nce:12px"><head>', 'n0nce')).toBeUndefined();
    expect(parseProbedHeight('<html><head></head><body><div data-markda-height="n0nce:99999">', 'n0nce')).toBeUndefined();
    expect(parseProbedHeight('', 'n0nce')).toBeUndefined();
  });
});
