import { describe, expect, it } from 'vitest';
import {
  browserExportContentSecurityPolicy, createHtmlDocument, exportReadinessScript, heightProbeScript,
  isNetworkPathReference, mermaidExportScript, parseProbedHeight, pdfPageCss,
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

  it('fits rendered diagrams on one PDF page instead of leaving an empty frame', () => {
    // A4 is 297mm tall; 15mm margins leave 267mm (1009px), less 160px for a heading.
    const css = pdfPageCss('A4', 15);
    expect(css).toContain('@page{size:A4;margin:15mm}');
    expect(css).toContain('pre[data-markda-diagram]{break-inside:avoid');
    expect(css).toContain('max-height:849px');
    expect(css).toContain('h1,h2,h3,h4,h5,h6{break-after:avoid}');
    // Print scrollbars are hidden and code blocks stop scrolling so they print fully.
    expect(css).toContain('*{scrollbar-width:none}');
    expect(css).toContain('::-webkit-scrollbar{display:none}');
    expect(css).toContain('pre{overflow:visible;white-space:pre-wrap;overflow-wrap:anywhere}');
    expect(css.startsWith('@page')).toBe(true);
    // Diagram rules apply to print only, so image export keeps full-size diagrams.
    expect(css.slice(css.indexOf('@media print'))).toContain('pre[data-markda-diagram] svg');
    expect(pdfPageCss('Letter', 10)).toContain('max-height:820px');
    expect(pdfPageCss('Legal', 0)).toContain('max-height:1184px');
    expect(pdfPageCss('Unknown', 15)).toContain('@page{size:A4;margin:15mm}');
    // The largest allowed margin still leaves a visible diagram.
    expect(pdfPageCss('A5', 80)).toContain('max-height:120px');
    expect(mermaidExportScript('window.markdaMermaid={};', 'export-nonce')).toContain("host.dataset.markdaDiagram='true'");
  });

  it('allows only nonce-tagged local Mermaid export code and signals readiness', () => {
    const script = mermaidExportScript('window.markdaMermaid={initialize(){},render(){}};', 'export-nonce');
    const policy = browserExportContentSecurityPolicy(false, 'export-nonce');
    const html = createHtmlDocument('Title', '<pre><code class="language-mermaid">graph TD</code></pre>', 'en', '', '', policy, script);
    expect(policy).toContain("script-src 'nonce-export-nonce'");
    expect(html).toContain('dataset.markdaExportState');
    expect(html).toContain('securityLevel:\'strict\'');
    expect(html).toContain('htmlLabels:false');
    expect(exportReadinessScript('export-nonce')).toContain("dataset.markdaExportState='export-nonce:ready'");
    expect(mermaidExportScript('window.markdaMermaid={};', 'export-nonce')).toContain("image.dataset.markdaRemoteBlocked='true'");
    expect(mermaidExportScript('window.markdaMermaid={};', 'export-nonce', true)).not.toContain('markdaRemoteBlocked');
    expect(() => mermaidExportScript('', 'bad\'nonce')).toThrow();
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
